//! Grok runtime integration, always isolated in a temporary home.
use super::claude_editor::{ConflictPolicy, EditorSave};
use super::ProviderService;
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
        crate::mode::operation::failpoint::crash_at(None);
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

fn row(id: &str) -> Provider {
    provider(
        id,
        json!({"config":format!("[models]\ndefault = \"{id}\"\n[model.{id}]\nmodel = \"grok-4.5\"\nbase_url = \"https://{id}.example/v1\"\nname = \"{id}\"\napi_key = \"{id}-key\"\napi_backend = \"responses\"\ncontext_window = 500000\n")}),
    )
}
fn live_text() -> String {
    std::fs::read_to_string(crate::grok_config::get_grok_config_path()).unwrap()
}
fn seed(text: &str) {
    let path = crate::grok_config::get_grok_config_path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

#[test]
#[serial]
fn written_table_is_removed_even_after_cli_default_changes_and_other_tables_survive() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    let globals = "# user settings\n[ui]\ntheme = 'dark' # keep\n[model.mine]\nmodel = 'mine'\n[mcp_servers.local]\ncommand = 'local'\n";
    seed(globals);
    for id in ["a", "b"] {
        state.db.save_provider("grokbuild", &row(id)).unwrap();
    }
    ProviderService::switch(state, AppType::GrokBuild, "a").unwrap();
    seed(&live_text().replace("default = \"a\"", "default = \"builtin\""));
    ProviderService::switch(state, AppType::GrokBuild, "b").unwrap();
    assert!(!live_text().contains("[model.a]"));
    assert!(!live_text().contains("a-key"));
    assert!(live_text().contains("[model.b]"));
    assert!(live_text().contains("theme = 'dark' # keep"));
    assert!(live_text().contains("[model.mine]"));
    let mut official = provider("official", json!({"config":""}));
    official.category = Some("official".into());
    state.db.save_provider("grokbuild", &official).unwrap();
    ProviderService::switch(state, AppType::GrokBuild, "official").unwrap();
    assert!(!live_text().contains("b-key"));
    assert!(live_text().contains("[model.mine]"));
    assert!(live_text().contains("[mcp_servers.local]"));
}

#[test]
#[serial]
fn interrupted_write_recovers_pointer_and_table_record() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    seed("# keep\n");
    crate::mode::operation::failpoint::crash_at(Some("published:0"));
    assert!(ProviderService::add(state, AppType::GrokBuild, row("a"), true).is_err());
    crate::mode::operation::failpoint::crash_at(None);
    assert_eq!(
        ProviderService::current(state, AppType::GrokBuild).unwrap(),
        "a"
    );
    assert_eq!(
        super::grok_direct::retired_tables(&crate::live::engine::DeviceStore::for_device(), None)
            .unwrap(),
        vec!["a"]
    );
    seed("[broken");
    let before_row = state
        .db
        .get_provider_by_id("a", "grokbuild")
        .unwrap()
        .unwrap();
    let mut updated = before_row.clone();
    updated.name = "new-name".into();
    assert!(ProviderService::update(state, AppType::GrokBuild, None, updated).is_err());
    assert_eq!(
        state
            .db
            .get_provider_by_id("a", "grokbuild")
            .unwrap()
            .unwrap()
            .name,
        before_row.name
    );
    assert_eq!(live_text(), "[broken");
}

#[test]
#[serial]
fn new_editor_baseline_does_not_claim_a_users_unselected_model_table() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    seed("[model.mine]\nmodel = 'user-model'\n[ui]\ntheme = 'dark'\n");
    let base = ProviderService::grok_editor_view(state, &json!({"config":""}), Some("official"))
        .unwrap()
        .settings;
    let mut edited = row("a");
    edited.settings_config["config"] = json!(format!(
        "{}\n{}",
        base["config"]
            .as_str()
            .unwrap()
            .replace("user-model", "user-edit"),
        edited.settings_config["config"].as_str().unwrap()
    ));
    ProviderService::save_grok(
        state,
        edited,
        Some(EditorSave {
            base,
            on_conflict: ConflictPolicy::Refuse,
        }),
        true,
    )
    .unwrap();
    assert!(live_text().contains("user-edit"));
    let stored = state
        .db
        .get_provider_by_id("a", "grokbuild")
        .unwrap()
        .unwrap();
    assert!(!stored.settings_config["config"]
        .as_str()
        .unwrap()
        .contains("model.mine"));
}
