//! Web 尚在使用通用片段；收紧提取规则时，旧片段不能污染切走供应商的回填。
use super::{ProviderService, SwitchResult};
use crate::app_config::AppType;
use crate::database::Database;
use crate::provider::{Provider, ProviderMeta};
use crate::settings::{get_settings, update_settings, AppSettings};
use crate::store::AppState;
use serde_json::{json, Value};
use serial_test::serial;
use std::{ffi::OsString, sync::Arc};

struct Fixture {
    state: AppState,
    previous_home: Option<OsString>,
    previous_settings: AppSettings,
    _dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let previous_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
        let previous_settings = get_settings();
        update_settings(AppSettings::default()).unwrap();
        Self {
            state: AppState::new(Arc::new(Database::memory().unwrap())),
            previous_home,
            previous_settings,
            _dir: dir,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // 在临时 HOME 内恢复缓存，避免恢复 settings 时写入真实目录。
        update_settings(self.previous_settings.clone()).unwrap();
        match &self.previous_home {
            Some(home) => std::env::set_var("CC_SWITCH_TEST_HOME", home),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }
}

fn provider(id: &str, settings: Value) -> Provider {
    let mut provider = Provider::with_id(id.into(), id.into(), settings, None);
    provider.meta = Some(ProviderMeta {
        common_config_enabled: Some(true),
        ..Default::default()
    });
    provider
}

#[test]
#[serial]
fn claude_switch_freezes_legacy_snippet_and_does_not_backfill() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    let old = json!({"env": {
        "ANTHROPIC_CUSTOM_HEADERS": "Authorization: Bearer legacy-shared",
        "CLAUDE_CODE_USE_BEDROCK": "1",
        "AWS_REGION": "us-west-2"
    }, "model": "old-shared-model", "theme": "dark"});
    state
        .db
        .set_config_snippet("claude", Some(old.to_string()))
        .unwrap();
    let a = provider("a", json!({"env": {"ANTHROPIC_AUTH_TOKEN": "a-key"}}));
    let b = provider("b", json!({"env": {"ANTHROPIC_AUTH_TOKEN": "b-key"}}));
    state.db.save_provider("claude", &a).unwrap();
    state.db.save_provider("claude", &b).unwrap();
    state.db.set_current_provider("claude", "a").unwrap();
    crate::settings::set_current_provider(&AppType::Claude, Some("a")).unwrap();
    let mut live = old.clone();
    live["env"]["ANTHROPIC_AUTH_TOKEN"] = json!("a-key");
    // 用户修改过的 model 不与旧片段等值，仍是当前供应商自己的设置。
    live["model"] = json!("a-picked-model");
    live["hooks"] = json!({"Stop": []});
    crate::config::write_json_file(&crate::config::get_claude_settings_path(), &live).unwrap();

    ProviderService::switch(state, AppType::Claude, "b").unwrap();
    let saved = state.db.get_provider_by_id("a", "claude").unwrap().unwrap();
    assert_eq!(saved.settings_config, a.settings_config);
    let next: Value =
        crate::config::read_json_file(&crate::config::get_claude_settings_path()).unwrap();
    assert_eq!(
        next,
        json!({"env": {"ANTHROPIC_AUTH_TOKEN": "b-key"},
        "hooks": {"Stop": []}, "theme": "dark"})
    );
    let snippet: Value =
        serde_json::from_str(&state.db.get_config_snippet("claude").unwrap().unwrap()).unwrap();
    assert_eq!(snippet, old);
}

#[test]
fn retired_entries_preserve_google_family_and_different_values() {
    let snippet = json!({"env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "old-path",
        "CLAUDE_CODE_USE_VERTEX": "1", "CLOUD_ML_REGION": "us-east5",
        "ANTHROPIC_CUSTOM_HEADERS": "old-header"
    }})
    .to_string();
    let live = json!({"env": {"GOOGLE_APPLICATION_CREDENTIALS": "own-path",
        "CLAUDE_CODE_USE_VERTEX": "1", "CLOUD_ML_REGION": "us-east5",
        "ANTHROPIC_CUSTOM_HEADERS": "new-header"}});
    let retired =
        ProviderService::retired_snippet_entries(&AppType::Claude, &snippet, &live).unwrap();
    let cleaned =
        super::live::remove_common_config_from_settings(&AppType::Claude, &live, &retired).unwrap();
    assert_eq!(cleaned, live);
}

#[test]
#[serial]
fn codex_retired_model_fields_are_removed_before_backfill() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    let old = "model_reasoning_effort = \"high\"\napproval_policy = \"on-request\"\n[agents]\ndefault_subagent_model = \"shared-model\"\nmax_threads = 4\n";
    state
        .db
        .set_config_snippet("codex", Some(old.into()))
        .unwrap();
    let current = provider(
        "a",
        json!({"auth": {"OPENAI_API_KEY": "a-key"}, "config": ""}),
    );
    let live = json!({"auth": {"OPENAI_API_KEY": "a-key"}, "config": format!("model = \"a-model\"\n{old}")});
    let mut result = SwitchResult::default();
    let retired = ProviderService::sync_common_config_snippet_from_live(
        state,
        &AppType::Codex,
        &current,
        &live,
        &mut result,
    )
    .unwrap();
    let stripped = super::live::strip_common_config_from_live_settings(
        &state.db,
        &AppType::Codex,
        &current,
        live,
    );
    let cleaned =
        super::live::remove_common_config_from_settings(&AppType::Codex, &stripped, &retired)
            .unwrap();
    let doc = cleaned["config"]
        .as_str()
        .unwrap()
        .parse::<toml_edit::DocumentMut>()
        .unwrap();
    assert_eq!(doc["model"].as_str(), Some("a-model"));
    assert!(doc.get("model_reasoning_effort").is_none());
    assert!(doc.get("agents").is_none());
    assert_eq!(cleaned["auth"]["OPENAI_API_KEY"], "a-key");
    assert!(result.warnings.is_empty());
}

#[test]
#[serial]
fn disabled_or_cleared_common_config_is_not_reextracted() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    let old = "{\"env\":{\"CLAUDE_CODE_USE_BEDROCK\":\"1\"}}";
    state
        .db
        .set_config_snippet("claude", Some(old.into()))
        .unwrap();
    let mut current = provider("a", json!({"env": {"ANTHROPIC_AUTH_TOKEN": "a-key"}}));
    current.meta.as_mut().unwrap().common_config_enabled = Some(false);
    let mut result = SwitchResult::default();
    assert!(ProviderService::sync_common_config_snippet_from_live(
        state,
        &AppType::Claude,
        &current,
        &json!({"theme":"dark"}),
        &mut result
    )
    .is_none());
    assert_eq!(
        state.db.get_config_snippet("claude").unwrap().as_deref(),
        Some(old)
    );
    state
        .db
        .set_config_snippet("claude", Some(String::new()))
        .unwrap();
    state.db.set_config_snippet_cleared("claude", true).unwrap();
    current.meta.as_mut().unwrap().common_config_enabled = Some(true);
    assert!(ProviderService::sync_common_config_snippet_from_live(
        state,
        &AppType::Claude,
        &current,
        &json!({"theme":"dark"}),
        &mut result
    )
    .is_none());
    assert!(state.db.is_config_snippet_cleared("claude").unwrap());
    assert!(result.warnings.is_empty());
}
