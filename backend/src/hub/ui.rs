//! Compatibility endpoints for the original CC Switch interface.
//! User identity and resource ownership are enforced here, independently of disabled UI controls.
use super::*;
use crate::{provider::Provider, store::AppState};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Router,
};
use rusqlite::params;
use std::sync::Arc;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/unit/ui/providers/:app", get(providers))
        .route("/api/unit/ui/providers/:app/save", post(save_provider))
        .route("/api/unit/ui/mode/:app", get(mode))
        .route("/api/unit/ui/status", get(status))
        .route("/api/unit/ui/settings", get(settings).put(save_settings))
        .route("/api/unit/ui/usage/request-logs", post(request_logs))
        .route("/api/unit/ui/usage/request-logs/:id", get(request_detail))
        .route("/api/unit/ui/usage/:kind", get(usage))
        .route("/api/unit/ui/accounts/:id/models", get(account_models))
}
fn visible(db: &crate::database::Database, user: &Identity, r: &resources::Resource) -> bool {
    r.owner_id == user.id
        || user.admin()
        || (r.published && resources::grant(db, user, r, None).is_ok())
}
async fn providers(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
) -> Result<Json<Value>> {
    let mut rows = serde_json::Map::new();
    for r in resources::all(&app.db)?
        .into_iter()
        .filter(|r| r.app_type == kind && visible(&app.db, &user, r))
    {
        let Some(p) = app.db.get_provider_by_id(&r.provider_id, &r.app_type)? else {
            continue;
        };
        let mut value = if r.owner_id == user.id {
            serde_json::to_value(&p).map_err(|_| Error::bad("供应商配置读取失败"))?
        } else {
            json!({"id":p.id,"name":p.name,"settingsConfig":{},"icon":p.icon,"iconColor":p.icon_color,"category":p.category})
        };
        value["unitResource"] = resources::safe_view(&app.db, &user, &r);
        rows.insert(p.id, value);
    }
    Ok(Json(json!({"providers":rows,"currentProviderId":""})))
}
async fn mode(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
) -> Result<Json<Value>> {
    let rows = resources::all(&app.db)?
        .into_iter()
        .filter(|r| r.app_type == kind && visible(&app.db, &user, r))
        .collect::<Vec<_>>();
    let members=rows.iter().filter(|r|r.published && !r.disabled).map(|r|json!({"providerId":r.provider_id,"modelIds":r.models.iter().filter_map(|m|m["slug"].as_str()).collect::<Vec<_>>(),"route":false})).collect::<Vec<_>>();
    Ok(Json(
        json!({"mode":"aggregation","attached":true,"directProviderId":null,"routeProviderId":null,"eligibleProviderIds":rows.iter().filter(|r|r.owner_id==user.id && !r.disabled).map(|r|&r.provider_id).collect::<Vec<_>>(),"aggregation":{"active":true,"members":members}}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveProvider {
    provider: Provider,
    add: bool,
    base_config: Option<Value>,
}
async fn save_provider(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
    Json(v): Json<SaveProvider>,
) -> Result<Json<Value>> {
    let previous = if v.add {
        None
    } else {
        Some(
            resources::all(&app.db)?
                .into_iter()
                .find(|r| r.provider_id == v.provider.id && r.app_type == kind)
                .ok_or_else(Error::forbidden)?,
        )
    };
    if let Some(r) = &previous {
        resources::own(&user, r)?;
    }
    let config = v.provider.settings_config.clone();
    let models = previous
        .as_ref()
        .map(|r| {
            r.models
                .iter()
                .filter_map(|m| m["slug"].as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let input = serde_json::from_value::<api::ResourceInput>(json!({
        "name":v.provider.name,"appType":kind,"settingsConfig":config,
        "apiFormat":v.provider.meta.as_ref().and_then(|m|m.api_format.clone()),
        "models":models,"policy":previous.as_ref().map(|r|r.policy.clone()).unwrap_or_default(),
        "provider":v.provider,"baseConfig":v.base_config,
    }))
    .map_err(|_| Error::bad("供应商表单数据无效"))?;
    let _ = api::save_resource_impl(&app, &user, previous.as_ref().map(|r| r.id.as_str()), input)
        .await?;
    Ok(Json(json!(true)))
}
async fn status(State(app): State<Arc<AppState>>) -> Result<Json<Value>> {
    let status = crate::commands::get_proxy_status_internal(&app)
        .await
        .map_err(|_| Error::bad("代理状态暂不可用"))?;
    Ok(Json(
        json!({"running":status.running,"address":status.address,"port":status.port}),
    ))
}
async fn settings(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    let mut v = serde_json::to_value(crate::settings::AppSettings::default())
        .map_err(|_| Error::bad("设置读取失败"))?;
    if let Some(personal) = catalog::preferences(&app.db, &user)?
        .get("uiSettings")
        .and_then(Value::as_object)
    {
        for key in ["language", "visibleApps"] {
            if let Some(value) = personal.get(key) {
                v[key] = value.clone();
            }
        }
    }
    v["firstRunNoticeConfirmed"] = json!(true);
    v["showProfileSwitcher"] = json!(false);
    v["sessionAutoSyncEnabled"] = json!(false);
    Ok(Json(v))
}
async fn save_settings(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let mut prefs = catalog::preferences(&app.db, &user)?;
    let mut personal = serde_json::Map::new();
    for key in ["language", "visibleApps"] {
        if let Some(value) = v.get(key) {
            personal.insert(key.to_owned(), value.clone());
        }
    }
    prefs["uiSettings"] = json!(personal);
    conn(&app.db)?.execute("INSERT INTO hub_preferences(user_id,value) VALUES(?1,?2) ON CONFLICT(user_id) DO UPDATE SET value=?2",params![user.id,json_text(&prefs)])?;
    Ok(Json(json!(true)))
}
async fn account_models(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(account): Path<String>,
) -> Result<Json<Value>> {
    let owned:bool=conn(&app.db)?.query_row("SELECT EXISTS(SELECT 1 FROM hub_account_owners WHERE account_id=?1 AND owner_id=?2 AND auth_provider='codex_oauth')",params![account,user.id],|r|r.get(0))?;
    if !owned {
        return Err(Error::forbidden());
    }
    let models =
        crate::commands::fetch_codex_oauth_models_internal(Some(account), &app.codex_oauth_state)
            .await
            .map_err(|_| Error::bad("模型读取失败，请检查官方账号登录状态"))?;
    Ok(Json(json!(models)))
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct UsageFilter {
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<String>,
    username: Option<String>,
    provider_name: Option<String>,
    model: Option<String>,
    status_code: Option<i64>,
    scope: Option<String>,
}
fn filtered(user: &Identity, q: &UsageFilter) -> Result<(String, Vec<rusqlite::types::Value>)> {
    let mut sql = "r.created_at>=? AND r.created_at<=?".to_string();
    let mut args = vec![
        q.start_date.unwrap_or(0).into(),
        q.end_date.unwrap_or(now()).into(),
    ];
    match q.scope.as_deref().unwrap_or("mine") {
        "mine" => {
            sql.push_str(" AND r.user_id=?");
            args.push(user.id.clone().into());
        }
        "provided" => {
            sql.push_str(" AND r.owner_id=?");
            args.push(user.id.clone().into());
        }
        "all" if user.admin() => {}
        _ => return Err(Error::forbidden()),
    }
    for (col, value) in [
        ("r.app_type", &q.app_type),
        ("r.provider_name", &q.provider_name),
        ("r.request_model", &q.model),
    ] {
        if let Some(v) = value.as_ref().filter(|v| !v.is_empty() && *v != "all") {
            sql.push_str(&format!(" AND {col}=?"));
            args.push(v.clone().into());
        }
    }
    if let Some(status) = q.status_code {
        sql.push_str(" AND r.status=?");
        args.push(status.into());
    }
    if let Some(username) = q
        .username
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        sql.push_str(
            " AND r.user_id IN (SELECT id FROM hub_users WHERE LOWER(username) LIKE LOWER(?))",
        );
        args.push(format!("%{}%", username.trim()).into());
    }
    Ok((sql, args))
}
fn query(
    db: &crate::database::Database,
    sql: &str,
    args: &[rusqlite::types::Value],
) -> Result<Vec<Value>> {
    let refs = args
        .iter()
        .map(|v| v as &dyn rusqlite::ToSql)
        .collect::<Vec<_>>();
    api::query_json(&*conn(db)?, sql, &refs)
}
const METRICS:&str="COUNT(*) AS totalRequests,printf('%.6f',COALESCE(SUM(r.cost_credits),0)/1000000.0) AS totalCost,COALESCE(SUM(r.input_tokens),0) AS totalInputTokens,COALESCE(SUM(r.output_tokens),0) AS totalOutputTokens,COALESCE(SUM(r.cache_read_tokens),0) AS totalCacheReadTokens,COALESCE(SUM(r.cache_creation_tokens),0) AS totalCacheCreationTokens,COALESCE(SUM(r.input_tokens+r.output_tokens+r.cache_read_tokens+r.cache_creation_tokens),0) AS totalTokens,COALESCE(AVG(CASE WHEN r.state='completed' THEN 100.0 ELSE 0.0 END),0) AS successRate,COALESCE(AVG(r.latency_ms),0) AS avgLatencyMs";
async fn usage(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
    Query(q): Query<UsageFilter>,
) -> Result<Json<Value>> {
    let (filter, args) = filtered(&user, &q)?;
    if kind == "last-session-scan" {
        return Ok(Json(Value::Null));
    }
    if kind == "data-sources" {
        return Ok(Json(json!(query(&app.db,&format!("SELECT 'gateway' AS dataSource,COUNT(*) AS requestCount,printf('%.6f',COALESCE(SUM(r.cost_credits),0)/1000000.0) AS totalCostUsd FROM hub_requests r WHERE {filter}"),&args)?)));
    }
    let (extra,group)=match kind.as_str() {
        "summary"=>("".to_string(),""),
        "trends"=>("date(r.created_at,'unixepoch') AS date,".to_string(),"date(r.created_at,'unixepoch')"),
        "provider-stats"=>("COALESCE(r.provider_id,'unrouted') AS providerId,COALESCE(r.provider_name,'未路由') AS providerName,".to_string(),"r.provider_id"),
        "model-stats"=>("r.request_model AS model,printf('%.6f',COALESCE(AVG(r.cost_credits),0)/1000000.0) AS avgCostPerRequest,".to_string(),"r.request_model"),
        _=>return Err(Error::bad("未知统计类型")),
    };
    let suffix = if group.is_empty() {
        String::new()
    } else {
        format!(" GROUP BY {group} ORDER BY {group}")
    };
    let mut rows = query(
        &app.db,
        &format!("SELECT {extra}{METRICS} FROM hub_requests r WHERE {filter}{suffix}"),
        &args,
    )?;
    for row in &mut rows {
        row["requestCount"] = row["totalRequests"].clone();
    }
    Ok(Json(if kind == "summary" {
        rows.into_iter().next().unwrap_or(json!({}))
    } else {
        json!(rows)
    }))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Logs {
    filters: UsageFilter,
    page: i64,
    page_size: i64,
    scope: Option<String>,
}
fn log_row(r: &Value) -> Value {
    json!({"requestId":r["id"],"providerId":r["provider_id"].as_str().unwrap_or("unrouted"),"providerName":r["provider_name"],"appType":r["app_type"],"model":r["upstream_model"].as_str().unwrap_or_else(||r["request_model"].as_str().unwrap_or("")),"requestModel":r["request_model"],"costMultiplier":"1","inputTokens":r["input_tokens"],"outputTokens":r["output_tokens"],"cacheReadTokens":r["cache_read_tokens"],"cacheCreationTokens":r["cache_creation_tokens"],"inputCostUsd":"0","outputCostUsd":"0","cacheReadCostUsd":"0","cacheCreationCostUsd":"0","totalCostUsd":format!("{:.6}",r["cost_credits"].as_i64().unwrap_or(0) as f64/1_000_000.0),"costUnknown":r["cost_credits"].is_null(),"isStreaming":r["stream"].as_i64()==Some(1),"latencyMs":r["latency_ms"],"firstTokenMs":r["first_token_ms"],"durationMs":r["latency_ms"],"statusCode":r["status"],"errorMessage":r["error_code"],"createdAt":r["created_at"],"dataSource":"gateway","username":r["username"],"device":r["device"],"state":r["state"]})
}
async fn request_logs(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(mut q): Json<Logs>,
) -> Result<Json<Value>> {
    q.filters.scope = q.scope;
    let (filter, mut args) = filtered(&user, &q.filters)?;
    let total = query(
        &app.db,
        &format!("SELECT COUNT(*) AS total FROM hub_requests r WHERE {filter}"),
        &args,
    )?
    .first()
    .map(|r| r["total"].clone())
    .unwrap_or(json!(0));
    let page = q.page.max(0);
    let size = q.page_size.clamp(1, 100);
    args.push(size.into());
    args.push((page * size).into());
    let rows=query(&app.db,&format!("SELECT r.*,u.username FROM hub_requests r JOIN hub_users u ON u.id=r.user_id WHERE {filter} ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?"),&args)?.iter().map(log_row).collect::<Vec<_>>();
    Ok(Json(
        json!({"data":rows,"total":total,"page":page,"pageSize":size}),
    ))
}
async fn request_detail(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let rows=query(&app.db,"SELECT r.*,u.username FROM hub_requests r JOIN hub_users u ON u.id=r.user_id WHERE r.id=? AND (r.user_id=? OR r.owner_id=? OR ?=1)",&[id.into(),user.id.clone().into(),user.id.clone().into(),user.admin().into()])?;
    Ok(Json(log_row(rows.first().ok_or_else(Error::forbidden)?)))
}
