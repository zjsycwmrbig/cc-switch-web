use super::*;
use crate::{
    app_config::AppType,
    codex_config::{codex_stack_third_party_rows, CodexCatalogRow},
    provider::Provider,
    store::AppState,
};
use futures::StreamExt;
use rusqlite::params;

pub fn stored_rows(provider: &Provider, app: &str) -> Vec<Value> {
    if app == "claude" {
        return crate::mode::stack::claude_models("", provider)
            .into_iter()
            .map(|m| json!({"slug":m.upstream,"display_name":m.name,"context_window":m.window}))
            .collect();
    }
    if crate::proxy::providers::is_codex_official_provider(provider) {
        return crate::codex_config::load_codex_bundled_models()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| r["visibility"] != "hide")
            .collect();
    }
    codex_stack_third_party_rows(&CodexCatalogRow {
        settings: &provider.settings_config,
        config_text: provider
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .unwrap_or(""),
        profile: crate::proxy::providers::resolve_codex_catalog_tool_profile(provider),
    })
    .unwrap_or_default()
}
pub fn rows_from_names(names: &[String], existing: &[Value]) -> Result<Vec<Value>> {
    let bundled: Value = serde_json::from_str(include_str!(
        "../resources/codex_deepseek_catalog_template.json"
    ))
    .map_err(|_| Error::bad("模型模板不可用"))?;
    let template = existing
        .first()
        .cloned()
        .or_else(|| {
            bundled
                .get("models")
                .and_then(Value::as_array)
                .and_then(|m| m.first())
                .cloned()
        })
        .or_else(|| bundled.as_array().and_then(|m| m.first()).cloned())
        .unwrap_or(bundled);
    let mut rows = vec![];
    for name in names {
        let name = name.trim();
        if name.is_empty()
            || name.len() > 256
            || name.chars().any(char::is_control)
            || name.starts_with("ccs-")
        {
            return Err(Error::bad("请输入原始上游模型 ID，每个模型独占一行"));
        }
        if rows.iter().any(|r: &Value| r["slug"] == name) {
            continue;
        }
        let mut row = existing
            .iter()
            .find(|r| r["slug"] == name)
            .cloned()
            .unwrap_or_else(|| template.clone());
        row["slug"] = json!(name);
        row["display_name"] = json!(name);
        row["visibility"] = json!("list");
        rows.push(row);
    }
    Ok(rows)
}

/// 将资源编辑器提交的模型行规范化，同时保留可编辑的展示名。
pub fn rows_from_values(values: &[Value], existing: &[Value]) -> Result<Vec<Value>> {
    let names = values
        .iter()
        .filter_map(|value| {
            value
                .get("slug")
                .or_else(|| value.get("id"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect::<Vec<_>>();
    let mut rows = rows_from_names(&names, existing)?;
    for row in &mut rows {
        let slug = row["slug"].as_str().unwrap_or_default();
        if let Some(input) = values.iter().find(|value| {
            value
                .get("slug")
                .or_else(|| value.get("id"))
                .and_then(Value::as_str)
                == Some(slug)
        }) {
            if let Some(display_name) = input.get("display_name").and_then(Value::as_str) {
                let display_name = display_name.trim();
                if !display_name.is_empty() && display_name.chars().count() <= 256 {
                    row["display_name"] = json!(display_name);
                }
            }
        }
    }
    Ok(rows)
}
pub async fn refresh(
    app: &AppState,
    user: &Identity,
    r: &resources::Resource,
) -> Result<Vec<Value>> {
    resources::own(user, r)?;
    let provider = app
        .db
        .get_provider_by_id(&r.provider_id, &r.app_type)?
        .ok_or_else(Error::forbidden)?;
    let rows = if r.official {
        let account = r
            .account_id
            .as_deref()
            .ok_or_else(|| Error::bad("请先绑定官方账号"))?;
        let manager = app.codex_oauth_state.read().await;
        let token = manager
            .get_valid_token_for_account(account)
            .await
            .map_err(|_| Error::bad("官方账号需要重新登录"))?;
        let workspace = manager
            .chatgpt_account_id_for_account(account)
            .await
            .map_err(|_| Error::bad("账号缺少工作区信息"))?;
        drop(manager);
        let raw = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            crate::services::codex_oauth_models::fetch_catalog_with_token(&token, &workspace),
        )
        .await
        .map_err(|_| Error::bad("模型获取超时"))?
        .map_err(|_| Error::bad("官方模型获取失败，请检查账号状态"))?;
        crate::codex_config::normalize_codex_native_rows(
            raw.get("models")
                .or_else(|| raw.get("data"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        )
        .ok_or_else(|| Error::bad("无效的官方模型目录"))?
        .into_iter()
        .filter(|m| m["visibility"] != "hide")
        .collect()
    } else {
        let (base, key) = provider.resolve_usage_credentials(&if r.app_type == "claude" {
            AppType::Claude
        } else {
            AppType::Codex
        });
        if !base.is_empty() && !key.is_empty() {
            let base = base.trim_end_matches('/');
            let endpoint = if base.ends_with("/v1") {
                format!("{base}/models")
            } else {
                format!("{base}/v1/models")
            };
            validate_upstream(&endpoint)?;
            let mut builder = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(25));
            if r.owner_id != "admin" {
                let u = url::Url::parse(&endpoint).map_err(|_| Error::bad("无效的模型目录地址"))?;
                let addresses = super::network::resolve(
                    u.host_str().unwrap_or(""),
                    u.port_or_known_default().unwrap_or(443),
                )
                .await?;
                builder = builder
                    .no_proxy()
                    .resolve_to_addrs(u.host_str().unwrap_or(""), &addresses);
            }
            let client = builder
                .build()
                .map_err(|_| Error::bad("模型客户端初始化失败"))?;
            let response = client
                .get(endpoint)
                .bearer_auth(key)
                .send()
                .await
                .map_err(|_| Error::bad("供应商模型获取失败"))?;
            if !response.status().is_success() {
                return Err(Error::bad("供应商拒绝了模型目录请求"));
            }
            let mut chunks = response.bytes_stream();
            let mut bytes = Vec::new();
            while let Some(chunk) = chunks.next().await {
                let chunk = chunk.map_err(|_| Error::bad("模型目录读取失败"))?;
                if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                    return Err(Error::bad("模型目录过大"));
                }
                bytes.extend_from_slice(&chunk);
            }
            let raw: Value =
                serde_json::from_slice(&bytes).map_err(|_| Error::bad("模型目录格式无效"))?;
            let names: Vec<String> = raw
                .get("data")
                .or_else(|| raw.get("models"))
                .and_then(Value::as_array)
                .ok_or_else(|| Error::bad("供应商没有返回模型列表"))?
                .iter()
                .filter_map(|m| {
                    m.get("id")
                        .or_else(|| m.get("slug"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .collect();
            rows_from_names(&names, &r.models)?
        } else {
            stored_rows(&provider, &r.app_type)
        }
    };
    if rows.is_empty() {
        return Err(Error::bad("未获取到模型，请手动填写上游模型 ID"));
    }
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET models=?1,health='ready',cooldown_until=0 WHERE id=?2",
        params![json_text(&rows), r.id],
    )?;
    Ok(rows)
}
pub fn validate_upstream(raw: &str) -> Result<()> {
    let u = url::Url::parse(raw).map_err(|_| Error::bad("无效的供应商地址"))?;
    if !["http", "https"].contains(&u.scheme())
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err(Error::bad("供应商地址仅支持无内嵌凭据的 HTTP/HTTPS URL"));
    }
    let host = u.host_str().unwrap_or("").to_lowercase();
    if host == "169.254.169.254" || host == "metadata.google.internal" || host == "0.0.0.0" {
        return Err(Error::bad("不允许使用云元数据服务地址"));
    }
    Ok(())
}
pub fn preferences(db: &crate::database::Database, user: &Identity) -> Result<Value> {
    use rusqlite::OptionalExtension;
    Ok(conn(db)?
        .query_row(
            "SELECT value FROM hub_preferences WHERE user_id=?1",
            [&user.id],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .map(|s| parse(&s))
        .unwrap_or(json!({})))
}
pub fn export(db: &crate::database::Database, user: &Identity, selected: bool) -> Result<Value> {
    let prefs = preferences(db, user)?;
    let chosen = prefs.get("models").and_then(Value::as_array);
    let mut models = vec![];
    let mut official = std::collections::BTreeMap::new();
    let mut templates: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    let mut route_keys: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let pool_key = auth::setting(db, "officialPoolKey", "official");
    for r in resources::all(db)? {
        // 自己未发布的供应商只对自己可用，不会出现在其他用户的目录里。
        if r.app_type != "codex" || r.disabled {
            continue;
        }
        for raw in &r.models {
            let Some(name) = raw["slug"].as_str() else {
                continue;
            };
            if resources::grant(db, user, &r, Some(name)).is_err() {
                continue;
            }
            templates
                .entry(resources::model_group_key(name))
                .or_insert_with(|| raw.clone());
            route_keys.insert(r.id.clone(), r.route_key.clone());
            if r.official {
                official.entry(name.to_owned()).or_insert_with(|| {
                    let mut row = raw.clone();
                    let _ =
                        crate::web_model_catalog::publish(&mut row, &pool_key, "官方共享账号池", 0);
                    crate::codex_config::normalize_codex_aggregate_catalog_row(&mut row);
                    row
                });
            }
        }
    }
    // 模型列表以用户映射为唯一来源。自动路由与直连映射是独立入口，允许同时展示。
    let route_rows = super::api::list_model_routes(db, &user.id)?;
    for route in route_rows {
        if !route["enabled"].as_bool().unwrap_or(false) {
            continue;
        }
        let Some(base) = route["model"].as_str() else {
            continue;
        };
        let Some(name) = route["displayName"].as_str() else {
            continue;
        };
        let group = resources::model_group_key(base);
        let mut row = templates.get(&group).cloned().unwrap_or_else(|| {
            json!({
                "slug":base,
                "display_name":base,
                "description":base,
                "default_reasoning_level":"medium",
                "supported_reasoning_levels":[
                    {"effort":"low","description":"Fast responses with lighter reasoning"},
                    {"effort":"medium","description":"Balances speed and reasoning depth"},
                    {"effort":"high","description":"Greater reasoning depth"}
                ],
                "shell_type":"unified_exec",
                "visibility":"list",
                "supported_in_api":true,
                "priority":1000
            })
        });
        let targets = route["targets"]
            .as_array()
            .map(|list| list.iter().filter_map(Value::as_str).collect::<Vec<_>>())
            .unwrap_or_default();
        let key = if route["auto"].as_bool().unwrap_or(false)
            || targets.len() >= 2
            || name.trim_end().ends_with("[auto]")
        {
            "auto".to_string()
        } else {
            targets
                .first()
                .and_then(|id| route_keys.get(*id).cloned())
                .unwrap_or_else(|| "auto".to_string())
        };
        row["slug"] = json!(encode("codex", &key, base));
        row["display_name"] = json!(name);
        row["visibility"] = json!("list");
        crate::codex_config::normalize_codex_aggregate_catalog_row(&mut row);
        models.push(row);
    }
    models.extend(official.into_values());
    models.retain(|row| !selected || chosen.is_none_or(|choices| choices.contains(&row["slug"])));
    for (i, row) in models.iter_mut().enumerate() {
        row["priority"] = json!(i + 1);
    }
    let startup = prefs
        .get("startupModel")
        .and_then(Value::as_str)
        .filter(|s| models.iter().any(|m| m["slug"] == *s))
        .map(str::to_owned)
        .or_else(|| {
            models
                .first()
                .and_then(|m| m["slug"].as_str())
                .map(str::to_owned)
        });
    Ok(
        json!({"models":models,"default_model":startup,"warnings":[],"user":user.username,"quotaUnit":"credits = 0.000001 USD 估算成本"}),
    )
}
pub fn encode(app: &str, key: &str, model: &str) -> String {
    crate::mode::stack::encode(
        &if app == "claude" {
            AppType::Claude
        } else {
            AppType::Codex
        },
        key,
        model,
        false,
    )
}
