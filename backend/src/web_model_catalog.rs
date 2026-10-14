//! 只读导出全部供应商的模型并集；复用已有 Codex 目录生成器，不写服务端 live 文件。
use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::codex_config::plan_codex_model_catalog;
use crate::error::AppError;
use crate::provider::Provider;

pub(crate) const POOL_SETTING: &str = "ccswitch_codex_client_model_pool";

/// 旧版 Codex 客户端（如 0.133）只认识到 xhigh；目录里出现 max/ultra 会让整份
/// `model_catalog_json` 解析失败，客户端于是只剩内置模型。导出时统一裁掉更高的档位。
const CLIENT_SAFE_REASONING_LEVELS: [&str; 6] =
    ["none", "minimal", "low", "medium", "high", "xhigh"];

fn clamp_reasoning_levels(entry: &mut Value) {
    if let Some(levels) = entry
        .get_mut("supported_reasoning_levels")
        .and_then(Value::as_array_mut)
    {
        levels.retain(|level| {
            level
                .get("effort")
                .and_then(Value::as_str)
                .map(|effort| CLIENT_SAFE_REASONING_LEVELS.contains(&effort))
                .unwrap_or(true)
        });
    }
    let default = entry
        .get("default_reasoning_level")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(default) = default {
        if !CLIENT_SAFE_REASONING_LEVELS.contains(&default.as_str()) {
            entry["default_reasoning_level"] = json!("xhigh");
        }
    }
}

pub(crate) fn available_models(providers: &IndexMap<String, Provider>) -> BTreeMap<String, Vec<String>> {
    let mut available: BTreeMap<String, Vec<String>> = BTreeMap::new();
    available.insert("cc-auto".into(), Vec::new());
    available.insert("cc-switch-auto".into(), Vec::new());
    for provider in providers.values() {
        let mut names = Vec::new();
        if let Some(specs) = provider.settings_config.pointer("/modelCatalog/models").and_then(Value::as_array) {
            names.extend(specs.iter().filter_map(|s| s.get("model").and_then(Value::as_str)).map(str::to_string));
        }
        if let Some(mapping) = provider.settings_config.get("modelMapping").and_then(Value::as_object) {
            names.extend(mapping.keys().cloned());
            names.extend(mapping.values().filter_map(Value::as_str).map(str::to_string));
        }
        let config = provider.settings_config.get("config").and_then(Value::as_str).unwrap_or("");
        if let Some(model) = provider.settings_config.get("model").and_then(Value::as_str).map(str::to_string)
            .or_else(|| config.parse::<toml_edit::DocumentMut>().ok()
                .and_then(|doc| doc.get("model").and_then(|v| v.as_str()).map(str::to_string))) {
            names.push(model);
        }
        for name in names {
            let name = name.trim();
            if name.is_empty() { continue; }
            let sources = available.entry(name.to_string()).or_default();
            if !sources.contains(&provider.name) { sources.push(provider.name.clone()); }
        }
    }
    available
}

pub(crate) fn normalize_pool(models: Vec<String>) -> Result<Vec<String>, AppError> {
    if models.len() > 2048 { return Err(AppError::Message("模型清单最多允许 2048 项".into())); }
    let mut unique = BTreeMap::new();
    for model in models {
        let model = model.trim();
        if model.is_empty() || model.len() > 512 || model.chars().any(char::is_control) {
            return Err(AppError::Message("模型名称不能为空、超过 512 字节或包含控制字符".into()));
        }
        unique.entry(model.to_ascii_lowercase()).or_insert_with(|| model.to_string());
    }
    Ok(unique.into_values().collect())
}

pub(crate) fn selected_pool(providers: &IndexMap<String, Provider>, saved: Option<&str>) -> Result<Vec<String>, AppError> {
    match saved {
        Some(value) => normalize_pool(serde_json::from_str(value).map_err(|e| AppError::Message(format!("模型清单解析失败：{e}")))?),
        None => normalize_pool(available_models(providers).into_keys().collect()),
    }
}

fn add_model(pool: &mut BTreeMap<String, (Value, Vec<String>)>, mut entry: Value, name: &str) {
    let Some(slug) = entry.get("slug").and_then(Value::as_str).map(str::to_string) else {
        return;
    };
    // 远程旧版 Codex 也应显示这些配置的模型，不继承官方条目的升级提示及版本门槛。
    entry["visibility"] = json!("list");
    entry["supported_in_api"] = json!(true);
    entry["upgrade"] = Value::Null;
    clamp_reasoning_levels(&mut entry);
    if let Some(object) = entry.as_object_mut() {
        object.remove("minimal_client_version");
    }
    let key = slug.to_ascii_lowercase();
    if let Some((existing, names)) = pool.get_mut(&key) {
        if !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
        // 同名模型的声明有冲突时选较小窗口，避免向客户端宣称较大的容量。
        for field in ["context_window", "max_context_window", "auto_compact_token_limit"] {
            if let (Some(left), Some(right)) = (existing[field].as_u64(), entry[field].as_u64()) {
                existing[field] = json!(left.min(right));
            }
        }
    } else {
        pool.insert(key, (entry, vec![name.to_string()]));
    }
}

pub(crate) fn export_all(providers: &IndexMap<String, Provider>, selected: &[String]) -> Result<Value, AppError> {
    let mut pool = BTreeMap::new();
    // 名称排序保证同一份配置的导出结果稳定。
    let mut rows: Vec<_> = providers.values().collect();
    rows.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    for provider in rows {
        let mut settings = provider.settings_config.clone();
        let config = settings.get("config").and_then(Value::as_str).unwrap_or("").to_string();
        let mut specs = settings.pointer("/modelCatalog/models").and_then(Value::as_array)
            .cloned().unwrap_or_default();
        let default_model = settings.get("model").and_then(Value::as_str).map(str::to_string)
            .or_else(|| config.parse::<toml_edit::DocumentMut>().ok()
                .and_then(|doc| doc.get("model").and_then(|v| v.as_str()).map(str::to_string)));
        if let Some(model) = default_model.as_deref() {
            if !specs.iter().any(|spec| spec.get("model").and_then(Value::as_str) == Some(model)) {
                specs.push(json!({"model": model}));
            }
        }
        let mappings = settings.get("modelMapping").and_then(Value::as_object).cloned().unwrap_or_default();
        for target in mappings.values().filter_map(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
            if !specs.iter().any(|spec| spec.get("model").and_then(Value::as_str) == Some(target)) {
                specs.push(json!({"model": target}));
            }
        }
        if specs.is_empty() { continue; }
        settings["modelCatalog"] = json!({"models": specs});
        let plan = plan_codex_model_catalog(&settings, &config,
            crate::proxy::providers::resolve_codex_catalog_tool_profile(provider))?;
        let entries = plan.catalog.as_ref().and_then(|v| v.get("models")).and_then(Value::as_array)
            .cloned().unwrap_or_default();
        for entry in &entries { add_model(&mut pool, entry.clone(), &provider.name); }
        let default_entry = entries.iter().find(|entry| entry.get("slug").and_then(Value::as_str) == default_model.as_deref())
            .or_else(|| entries.first());
        for (from, target) in &mappings {
            if from.trim().is_empty() { continue; }
            let Some(target) = target.as_str().map(str::trim).filter(|s| !s.is_empty()) else { continue; };
            if let Some(template) = entries.iter().find(|entry| entry.get("slug").and_then(Value::as_str) == Some(target)).or(default_entry) {
                let mut alias = template.clone();
                alias["slug"] = json!(from.trim());
                alias["display_name"] = json!(from.trim());
                add_model(&mut pool, alias, &provider.name);
            }
        }
        if let Some(template) = default_entry {
            for name in ["cc-auto", "cc-switch-auto"] {
                let mut alias = template.clone();
                alias["slug"] = json!(name);
                alias["display_name"] = json!(format!("{name}（当前供应商默认模型）"));
                add_model(&mut pool, alias, &provider.name);
            }
        }
    }
    // 手动添加的客户端名也可导出；实际目标仍由当前供应商的映射或默认模型决定。
    let template = pool.values().next().map(|(entry, _)| entry.clone());
    let mut selected_entries = Vec::new();
    for name in selected {
        let (mut entry, names) = if let Some(found) = pool.get(&name.to_ascii_lowercase()) {
            found.clone()
        } else if let Some(template) = template.as_ref() {
            let mut entry = template.clone();
            entry["slug"] = json!(name);
            entry["display_name"] = json!(name);
            (entry, vec!["手动添加".into()])
        } else { continue; };
        entry["slug"] = json!(name);
        selected_entries.push((entry, names));
    }
    let entries: Vec<_> = selected_entries.into_iter().enumerate().map(|(index, (mut entry, names))| {
        entry["priority"] = json!(index + 1);
        entry["description"] = json!(format!("CC Switch 配置的模型；来源：{}。实际目标按网页映射及当前供应商解析。", names.join("、")));
        entry
    }).collect();
    if entries.is_empty() {
        return Err(AppError::Message("没有可导出的模型，请先配置 Codex 供应商的模型目录或默认模型".into()));
    }
    Ok(json!({"models": entries}))
}
