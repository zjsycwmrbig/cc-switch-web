//! Multi-user gateway. Identity, grants, metering and settlement share this boundary.
pub(crate) mod api;
pub(crate) mod ui;
pub(crate) mod auth;
pub(crate) mod catalog;
pub(crate) mod gateway;
pub(crate) mod metering;
pub(crate) mod network;
pub(crate) mod resources;
pub(crate) mod schema;
#[cfg(test)]
mod tests;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::MutexGuard;

pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug)]
pub struct Error(pub StatusCode, pub &'static str, pub String);
impl Error {
    pub fn bad(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, "invalid_request", message.into())
    }
    pub fn bad_code(code: &'static str, message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, code, message.into())
    }
    pub fn forbidden() -> Self {
        Self(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "没有此资源的操作权限".into(),
        )
    }
    /// 带具体原因的访问拒绝：把“为什么不能用”直接回给客户端。
    pub fn denied(code: &'static str, message: impl Into<String>) -> Self {
        Self(StatusCode::FORBIDDEN, code, message.into())
    }
    pub fn unauthorized() -> Self {
        Self(
            StatusCode::UNAUTHORIZED,
            "authentication_required",
            "请登录或提供有效的个人 API Key".into(),
        )
    }
    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        Self(StatusCode::NOT_FOUND, code, message.into())
    }
    pub fn too_large(code: &'static str, message: impl Into<String>) -> Self {
        Self(StatusCode::PAYLOAD_TOO_LARGE, code, message.into())
    }
    pub fn unavailable(code: &'static str, message: impl Into<String>) -> Self {
        Self(StatusCode::SERVICE_UNAVAILABLE, code, message.into())
    }
    pub fn limited(code: &'static str, message: impl Into<String>) -> Self {
        Self(StatusCode::TOO_MANY_REQUESTS, code, message.into())
    }
    pub fn internal(code: &'static str, message: impl Into<String>) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, code, message.into())
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({"error":{"code":self.1,"message":self.2,"type":"ccswitchunit_error"}})),
        )
            .into_response()
    }
}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        log::error!("[unit-db] {error}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "storage_error",
            "数据库操作失败".into(),
        )
    }
}
impl From<crate::error::AppError> for Error {
    fn from(error: crate::error::AppError) -> Self {
        log::error!("[unit] {error}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "operation_failed",
            "操作失败，请查看服务日志".into(),
        )
    }
}
pub fn conn(db: &crate::database::Database) -> Result<MutexGuard<'_, Connection>> {
    db.conn.lock().map_err(|_| {
        Error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "storage_unavailable",
            "数据库暂时不可用".into(),
        )
    })
}
pub fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn json_text(value: &impl Serialize) -> String {
    serde_json::to_string(value).expect("serializable gateway value")
}
pub fn parse<T: serde::de::DeserializeOwned + Default>(text: &str) -> T {
    serde_json::from_str(text).unwrap_or_default()
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Budget {
    pub requests: Option<i64>,
    pub tokens: Option<i64>,
    pub credits: Option<i64>,
}
impl Budget {
    pub fn validate(&self) -> Result<()> {
        if [self.requests, self.tokens, self.credits]
            .iter()
            .flatten()
            .any(|n| *n < 0 || *n > 1_000_000_000_000_000)
        {
            return Err(Error::bad("额度必须为非负整数，留空表示无限"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct AutoApprove {
    pub enabled: bool,
    pub max_users: Option<i64>,
    pub total_tokens: Option<i64>,
    pub per_user_tokens: Option<i64>,
}
impl AutoApprove {
    pub fn validate(&self) -> Result<()> {
        if [self.max_users, self.total_tokens, self.per_user_tokens]
            .iter()
            .flatten()
            .any(|n| *n < 0 || *n > 1_000_000_000_000_000)
        {
            return Err(Error::bad("免审设置必须为非负整数，留空表示不限"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Policy {
    pub visibility: String,
    pub period: String,
    pub default_budget: Budget,
    pub shared_budget: Budget,
    pub models: Vec<String>,
    pub expires_at: Option<i64>,
    pub auto_approve: AutoApprove,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            visibility: "private".into(),
            period: "lifetime".into(),
            default_budget: Budget::default(),
            shared_budget: Budget::default(),
            models: vec![],
            expires_at: None,
            auto_approve: AutoApprove::default(),
        }
    }
}
impl Policy {
    pub fn validate(&self) -> Result<()> {
        if !["public", "private", "selected"].contains(&self.visibility.as_str())
            || !["day", "month", "lifetime"].contains(&self.period.as_str())
        {
            return Err(Error::bad("无效的共享范围或额度周期"));
        }
        self.default_budget.validate()?;
        self.shared_budget.validate()?;
        self.auto_approve.validate()
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub username: String,
    pub role: String,
    pub key_id: Option<String>,
    pub csrf: Option<String>,
}
impl Identity {
    pub fn admin(&self) -> bool {
        self.role == "admin"
    }
    pub fn web(&self) -> bool {
        self.csrf.is_some()
    }
}

pub fn audit(
    db: &crate::database::Database,
    actor: &str,
    action: &str,
    target: &str,
    details: Value,
) -> Result<()> {
    conn(db)?.execute("INSERT INTO hub_audit(id,actor,action,target,details,created_at) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![id(),actor,action,target,json_text(&details),now()])?;
    Ok(())
}
