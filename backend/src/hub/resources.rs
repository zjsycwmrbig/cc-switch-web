use super::*;
use crate::{
    app_config::AppType,
    provider::{AuthBinding, AuthBindingSource, Provider, ProviderMeta},
    store::AppState,
};
use rusqlite::{params, OptionalExtension};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub provider_id: String,
    pub app_type: String,
    pub owner_id: String,
    pub owner_name: String,
    pub name: String,
    pub route_key: String,
    pub published: bool,
    pub disabled: bool,
    pub policy: Policy,
    pub models: Vec<Value>,
    pub official: bool,
    pub account_id: Option<String>,
    pub cooldown_until: i64,
    pub health: String,
    pub last_used_at: i64,
}
const SELECT:&str="SELECT r.id,r.provider_id,r.app_type,r.owner_id,u.username,p.name,r.route_key,r.published,r.disabled,r.policy,r.models,r.official,r.account_id,r.cooldown_until,r.health,r.last_used_at FROM hub_resources r JOIN hub_users u ON u.id=r.owner_id JOIN providers p ON p.id=r.provider_id AND p.app_type=r.app_type WHERE r.deleted=0 AND u.active=1";
fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Resource> {
    Ok(Resource {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        app_type: row.get(2)?,
        owner_id: row.get(3)?,
        owner_name: row.get(4)?,
        name: row.get(5)?,
        route_key: row.get(6)?,
        published: row.get(7)?,
        disabled: row.get(8)?,
        policy: parse(&row.get::<_, String>(9)?),
        models: parse(&row.get::<_, String>(10)?),
        official: row.get(11)?,
        account_id: row.get(12)?,
        cooldown_until: row.get(13)?,
        health: row.get(14)?,
        last_used_at: row.get(15)?,
    })
}
pub fn all(db: &crate::database::Database) -> Result<Vec<Resource>> {
    let c = conn(db)?;
    let mut s = c.prepare(&format!("{SELECT} ORDER BY r.created_at,r.id"))?;
    let rows = s
        .query_map([], read)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn get(db: &crate::database::Database, resource_id: &str) -> Result<Resource> {
    conn(db)?
        .query_row(&format!("{SELECT} AND r.id=?1"), [resource_id], read)
        .optional()?
        .ok_or_else(Error::forbidden)
}
pub fn own(user: &Identity, r: &Resource) -> Result<()> {
    if r.owner_id != user.id {
        return Err(Error::forbidden());
    }
    Ok(())
}

fn provides_model(r: &Resource, model: &str) -> bool {
    r.models
        .iter()
        .any(|value| value.get("slug").and_then(Value::as_str) == Some(model))
}

/// 供应商「对外可见」的模型：由分享设置 `policy.models` 限定，留空表示目录里的全部模型。
///
/// 可见只代表别人能在供应商库里看到并申请，是否能用仍然取决于授权。
pub fn visible_models(r: &Resource) -> Vec<Value> {
    if r.policy.models.is_empty() {
        return r.models.clone();
    }
    r.models
        .iter()
        .filter(|value| {
            value
                .get("slug")
                .and_then(Value::as_str)
                .is_some_and(|slug| r.policy.models.iter().any(|allowed| allowed == slug))
        })
        .cloned()
        .collect()
}

pub fn visible_model_slugs(r: &Resource) -> Vec<String> {
    visible_models(r)
        .iter()
        .filter_map(|value| value.get("slug").and_then(Value::as_str).map(str::to_owned))
        .collect()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    pub username: String,
    pub allowed: bool,
    pub budget: Budget,
    pub models: Vec<String>,
    pub expires_at: Option<i64>,
}

pub fn grant(
    db: &crate::database::Database,
    user: &Identity,
    r: &Resource,
    model: Option<&str>,
) -> Result<Budget> {
    if r.disabled {
        return Err(Error::denied("supplier_disabled", "该供应商已被停用"));
    }
    if user.id == r.owner_id {
        return Ok(Budget::default());
    }
    if let Some(model) = model {
        if !provides_model(r, model) {
            return Err(Error::denied(
                "model_not_provided",
                format!("该供应商未提供模型 {model}"),
            ));
        }
        if !r.policy.models.is_empty() && !r.policy.models.iter().any(|allowed| allowed == model) {
            return Err(Error::denied(
                "model_not_shared",
                format!("模型 {model} 不在该供应商的共享范围内"),
            ));
        }
    }
    let override_rule:Option<(bool,String,String,Option<i64>)>=conn(db)?.query_row("SELECT allowed,budget,models,expires_at FROM hub_grants WHERE resource_id=?1 AND user_id=?2",params![r.id,user.id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?;
    let budget = match override_rule {
        Some((true, budget, models, expires)) if expires.is_none_or(|t| t > now()) => {
            let allowed_models: Vec<String> = parse(&models);
            if model.is_some_and(|m| {
                !allowed_models.is_empty() && !allowed_models.iter().any(|a| a == m)
            }) {
                return Err(Error::denied("model_not_granted", "你的授权不包含这个模型"));
            }
            parse(&budget)
        }
        Some((true, _, _, _)) => {
            return Err(Error::denied("grant_expired", "你的授权已过期，请重新申请"))
        }
        Some((false, _, _, _)) => {
            return Err(Error::denied("grant_revoked", "你的授权已被提供者取消"))
        }
        None if r.policy.visibility == "private"
            || (user.role == "legacy" && r.owner_id != "admin") =>
        {
            return Err(Error::denied(
                "not_shared",
                "该供应商没有对你开放，请先提交申请",
            ))
        }
        None if r.policy.visibility == "public" => r.policy.default_budget.clone(),
        _ => {
            return Err(Error::denied(
                "not_shared",
                "该供应商没有对你开放，请先提交申请",
            ))
        }
    };
    if r.policy.expires_at.is_some_and(|t| t <= now()) {
        return Err(Error::denied("share_expired", "供应商的共享已过期"));
    }
    Ok(budget)
}
pub fn usable(
    db: &crate::database::Database,
    user: &Identity,
    r: &Resource,
    model: &str,
) -> Result<Budget> {
    // 自己的供应商即使没有发布到供应商库，也应当对自己可用。
    if r.disabled {
        return Err(Error::denied("supplier_disabled", "该供应商已被停用"));
    }
    if !r.published && r.owner_id != user.id {
        return Err(Error::denied("supplier_unpublished", "该供应商尚未发布或已下架"));
    }
    if !provides_model(r, model) {
        return Err(Error::denied(
            "model_not_provided",
            format!("该供应商未提供模型 {model}"),
        ));
    }
    grant(db, user, r, Some(model))
}
pub fn safe_view(db: &crate::database::Database, user: &Identity, r: &Resource) -> Value {
    // `models` 是“我有权使用的模型”，`visibleModels` 是供应商对外可见（可被申请）的模型。
    let models: Vec<Value> = r
        .models
        .iter()
        .filter(|m| grant(db, user, r, m["slug"].as_str()).is_ok())
        .cloned()
        .collect();
    let visible = visible_models(r);
    let visible_count = visible.len();
    let mut v = json!({"id":r.id,"name":r.name,"appType":r.app_type,"ownerId":r.owner_id,"ownerName":r.owner_name,"routeKey":r.route_key,"published":r.published,"disabled":r.disabled,"official":r.official,"owned":r.owner_id==user.id,"models":models,"visibleModels":visible,"visibleModelCount":visible_count,"health":if r.health=="ready"{"ready"}else{"unknown"}});
    if r.owner_id == user.id || user.admin() {
        v["policy"] = json!(r.policy);
        v["accountId"] = json!(r.account_id);
        v["health"] = json!(r.health);
        v["cooldownUntil"] = json!(r.cooldown_until);
    }
    if let Ok(budget) = grant(db, user, r, None) {
        v["myBudget"] = json!(budget);
        // 共享授权的截止时间：申请审批时由提供者设定，null 表示不限时间。
        if let Ok(Some(expires)) = conn(db).and_then(|c| {
            c.query_row(
                "SELECT expires_at FROM hub_grants WHERE resource_id=?1 AND user_id=?2",
                params![r.id, user.id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(Error::from)
        }) {
            v["myExpiresAt"] = json!(expires);
        }
    }
    v
}
pub fn bind_account(provider: &mut Provider, account_id: &str) {
    provider
        .meta
        .get_or_insert_with(ProviderMeta::default)
        .auth_binding = Some(AuthBinding {
        source: AuthBindingSource::ManagedAccount,
        auth_provider: Some("codex_oauth".into()),
        account_id: Some(account_id.into()),
    });
}
pub fn check_binding(
    db: &crate::database::Database,
    user: &Identity,
    provider: &Provider,
) -> Result<Option<String>> {
    let meta = provider.meta.as_ref();
    for kind in ["codex_oauth", "github_copilot", "xai_oauth"] {
        if let Some(account) = meta.and_then(|m| m.managed_account_id_for(kind)) {
            let owner:Option<String>=conn(db)?.query_row("SELECT owner_id FROM hub_account_owners WHERE account_id=?1 AND auth_provider=?2",params![account,kind],|r|r.get(0)).optional()?;
            if owner.as_deref() != Some(&user.id) {
                return Err(Error::forbidden());
            }
            return Ok(Some(account));
        }
    }
    // 未绑定托管账号时允许先保存供应商，随后在卡片上通过“官方账号”入口绑定；
    // 发布与使用阶段会再校验账号是否已绑定。
    Ok(None)
}
pub async fn migrate_existing(app: &AppState) -> Result<()> {
    // Account ownership is seeded once. A later login can never claim somebody
    // else's persisted upstream identity.
    for kind in ["codex_oauth", "github_copilot", "xai_oauth"] {
        let accounts = crate::commands::auth_list_accounts_internal(
            kind,
            &app.copilot_auth_state,
            &app.codex_oauth_state,
            &app.xai_oauth_state,
        )
        .await
        .unwrap_or_default();
        let c = conn(&app.db)?;
        for account in accounts {
            c.execute("INSERT OR IGNORE INTO hub_account_owners(account_id,auth_provider,owner_id) VALUES(?1,?2,'admin')",params![account.id,kind])?;
        }
    }
    for app_type in [AppType::Codex, AppType::Claude] {
        let roster = crate::mode::state::stack(
            &crate::live::engine::DeviceStore::for_device(),
            app_type.as_str(),
        )
        .unwrap_or_default();
        for (_, mut provider) in app.db.get_all_providers(app_type.as_str())? {
            let exists: bool = conn(&app.db)?.query_row(
                "SELECT EXISTS(SELECT 1 FROM hub_resources WHERE provider_id=?1 AND app_type=?2)",
                params![provider.id, app_type.as_str()],
                |r| r.get(0),
            )?;
            if exists {
                continue;
            }
            let official = app_type == AppType::Codex
                && crate::proxy::providers::is_codex_official_provider(&provider);
            let account_id = if official {
                match provider
                    .meta
                    .as_ref()
                    .and_then(|m| m.managed_account_id_for("codex_oauth"))
                {
                    Some(id) => Some(id),
                    None => {
                        app.codex_oauth_state
                            .read()
                            .await
                            .default_account_id()
                            .await
                    }
                }
            } else {
                None
            };
            if let Some(account) = &account_id {
                bind_account(&mut provider, account);
                app.db.save_provider(app_type.as_str(), &provider)?;
            }
            let key = roster
                .key_of(&provider.id)
                .map(str::to_owned)
                .unwrap_or_else(|| format!("p{}", &id()[..8]));
            let rows = super::catalog::stored_rows(&provider, app_type.as_str());
            let c = conn(&app.db)?;
            c.execute("INSERT OR IGNORE INTO hub_resources(id,provider_id,app_type,owner_id,route_key,published,models,official,account_id,created_at) VALUES(?1,?2,?3,'admin',?4,?5,?6,?7,?8,?9)",params![id(),provider.id,app_type.as_str(),key,roster.members.contains(&provider.id),json_text(&rows),official,account_id,now()])?;
        }
    }
    Ok(())
}
