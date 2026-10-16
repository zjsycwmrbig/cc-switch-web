//! 导出当前聚合成员的模型。每行都包含稳定的供应商 key，不做跨供应商模型映射。
use crate::app_config::AppType;
use crate::codex_config::{codex_stack_third_party_rows, CodexCatalogRow};
use crate::error::AppError;
use crate::live::engine::DeviceStore;
use crate::mode::{stack, state};
use crate::store::AppState;
use serde_json::{json, Value};

const SAFE_EFFORTS: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];

pub(crate) fn publish(
    entry: &mut Value,
    key: &str,
    provider_name: &str,
    priority: usize,
) -> Result<(), AppError> {
    let model = entry
        .get("slug")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Message("模型目录缺少 slug".into()))?
        .to_string();
    let display = entry
        .get("display_name")
        .and_then(Value::as_str)
        .unwrap_or(&model)
        .to_string();
    entry["slug"] = json!(stack::encode(&AppType::Codex, key, &model, false));
    entry["display_name"] = json!(stack::display_name(&display, provider_name));
    entry["description"] = json!(format!("{provider_name} · {model}"));
    entry["priority"] = json!(priority);
    entry["visibility"] = json!("list");
    entry["supported_in_api"] = json!(true);
    entry["upgrade"] = Value::Null;
    entry["comp_hash"] = json!("cc-switch");
    entry["use_responses_lite"] = json!(false);
    if let Some(object) = entry.as_object_mut() {
        object.remove("minimal_client_version");
    }
    // 兼容仍在使用的 Codex 0.133：未知思考等级会导致整份目录被丢弃。
    if let Some(levels) = entry
        .get_mut("supported_reasoning_levels")
        .and_then(Value::as_array_mut)
    {
        levels.retain(|level| {
            level
                .get("effort")
                .and_then(Value::as_str)
                .is_some_and(|effort| SAFE_EFFORTS.contains(&effort))
        });
    }
    if let Some(effort) = entry.get("default_reasoning_level").and_then(Value::as_str) {
        if !SAFE_EFFORTS.contains(&effort) {
            entry["default_reasoning_level"] = json!("xhigh");
        }
    }
    Ok(())
}

pub(crate) async fn export_aggregation(app: &AppState) -> Result<Value, AppError> {
    let store = DeviceStore::for_device();
    if !state::stack_mode(&store, "codex")? {
        return Err(AppError::Message(
            "请先开启 Codex 聚合模式，再同步聚合模型".into(),
        ));
    }
    let mode = state::mode_state(&store, "codex")?;
    let roster = state::stack(&store, "codex")?;
    // 默认供应商也导出带 key 的行，切换默认路由不会改变已选模型的去向。
    let members = stack::members(
        &app.db,
        &AppType::Codex,
        &roster,
        mode.proxy_route.as_deref(),
    )?;
    let mut models = Vec::new();
    let mut default_model = None;
    let mut warnings = Vec::new();
    for member in members {
        let provider = &member.provider;
        let mut rows = if crate::proxy::providers::is_codex_official_provider(provider) {
            let fetched: Result<Vec<Value>, AppError> = async {
                let manager = app.codex_oauth_state.read().await;
                let id = match provider
                    .meta
                    .as_ref()
                    .and_then(|m| m.managed_account_id_for("codex_oauth"))
                {
                    Some(id) => id,
                    None => manager.default_account_id().await.ok_or_else(|| {
                        AppError::Message("请先在 CC Switch 网页中登录 ChatGPT 账号".into())
                    })?,
                };
                let token = manager
                    .get_valid_token_for_account(&id)
                    .await
                    .map_err(|e| AppError::Message(format!("官方账号认证失败：{e}")))?;
                let workspace = manager
                    .chatgpt_account_id_for_account(&id)
                    .await
                    .map_err(|e| AppError::Message(e.to_string()))?;
                drop(manager);
                let catalog = crate::services::codex_oauth_models::fetch_catalog_with_token(
                    &token, &workspace,
                )
                .await
                .map_err(|e| AppError::Message(format!("获取官方模型失败：{e}")))?;
                let raw = catalog
                    .get("models")
                    .or_else(|| catalog.get("data"))
                    .and_then(Value::as_array)
                    .ok_or_else(|| AppError::Message("官方模型列表格式无效".into()))?;
                let rows = crate::codex_config::normalize_codex_native_rows(raw.clone())
                    .ok_or_else(|| AppError::Message("官方模型列表缺少必要字段".into()))?
                    .into_iter()
                    .filter(|row| row.get("visibility").and_then(Value::as_str) != Some("hide"))
                    .collect();
                Ok(rows)
            }
            .await;
            match fetched {
                Ok(rows) => rows,
                Err(error) => {
                    // 登录暂时失效仍允许同步其余渠道；明确标明官方目录来自 CLI 自带列表。
                    let bundled =
                        tokio::task::spawn_blocking(crate::codex_config::load_codex_bundled_models)
                            .await
                            .map_err(|e| AppError::Message(e.to_string()))?
                            .ok_or_else(|| {
                                AppError::Message(format!("{error}；本机也没有可用的官方模型目录"))
                            })?;
                    warnings.push(format!(
                        "{}：{}；暂用本机 Codex 自带模型列表，官方转发需在网页重新登录。",
                        provider.name, error
                    ));
                    bundled
                        .into_iter()
                        .filter(|row| row.get("visibility").and_then(Value::as_str) != Some("hide"))
                        .collect()
                }
            }
        } else {
            codex_stack_third_party_rows(&CodexCatalogRow {
                settings: &provider.settings_config,
                config_text: provider
                    .settings_config
                    .get("config")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                profile: crate::proxy::providers::resolve_codex_catalog_tool_profile(provider),
            })?
        };
        for row in &mut rows {
            publish(row, &member.key, &provider.name, models.len() + 1)?;
            if member.route {
                let preferred = crate::proxy::providers::codex_provider_upstream_model(provider);
                let slug = row["slug"].as_str().unwrap_or("");
                if default_model.is_none()
                    || preferred.as_deref().is_some_and(|model| {
                        slug == stack::encode(&AppType::Codex, &member.key, model, false)
                    })
                {
                    default_model = Some(slug.to_string());
                }
            }
            models.push(row.clone());
        }
    }
    if models.is_empty() {
        return Err(AppError::Message(
            "聚合成员没有可导出的模型，请先配置供应商的模型列表".into(),
        ));
    }
    Ok(
        json!({"default_model": default_model.unwrap_or_else(|| models[0]["slug"].as_str().unwrap().to_string()), "warnings": warnings, "models": models}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn same_model_in_two_providers_keeps_distinct_routes() {
        let mut left = json!({"slug":"gpt-test","supported_reasoning_levels":[{"effort":"high"},{"effort":"ultra"}],"default_reasoning_level":"ultra"});
        let mut right = left.clone();
        publish(&mut left, "a", "A", 1).unwrap();
        publish(&mut right, "b", "B", 2).unwrap();
        assert_eq!(left["slug"], "ccs-a/gpt-test");
        assert_eq!(right["slug"], "ccs-b/gpt-test");
        assert_eq!(
            left["supported_reasoning_levels"].as_array().unwrap().len(),
            1
        );
        assert_eq!(left["default_reasoning_level"], "xhigh");
        assert!(matches!(
            stack::decode(&AppType::Codex, left["slug"].as_str().unwrap()),
            stack::Decoded::Stack {
                key: "a",
                model: "gpt-test",
                ..
            }
        ));
    }
}
