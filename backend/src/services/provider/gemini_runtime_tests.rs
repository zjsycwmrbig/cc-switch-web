//! Gemini runtime integration, always isolated in a temporary home.
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

fn seed_live() {
    let env = crate::gemini_config::get_gemini_env_path();
    std::fs::create_dir_all(env.parent().unwrap()).unwrap();
    std::fs::write(env, "# user\r\nDEBUG=1\r\nGEMINI_API_KEY=old\r\n").unwrap();
    crate::config::write_json_file(&crate::gemini_config::get_gemini_settings_path(), &json!({"mcpServers":{"mine":{"command":"local"}},"security":{"auth":{"selectedType":"oauth-personal","extra":true}},"model":{"name":"old","other":1},"ui":{"theme":"dark"}})).unwrap();
}
fn settings() -> Value {
    crate::config::read_json_file(&crate::gemini_config::get_gemini_settings_path()).unwrap()
}
fn env() -> String {
    std::fs::read_to_string(crate::gemini_config::get_gemini_env_path()).unwrap()
}

#[test]
#[serial]
fn switch_and_oauth_keep_global_settings_env_comments_and_credentials_store() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    seed_live();
    let oauth_path = crate::gemini_config::get_gemini_dir().join("oauth_creds.json");
    std::fs::write(&oauth_path, b"opaque login").unwrap();
    let row = provider(
        "a",
        json!({"env":{"GEMINI_API_KEY":"a-key","GOOGLE_GEMINI_BASE_URL":"https://a.example","DEBUG":"row-ignored"},"config":{"model":{"name":"gemini-test"},"ui":{"theme":"row-ignored"}}}),
    );
    state.db.save_provider("gemini", &row).unwrap();
    state
        .db
        .set_config_snippet("gemini", Some(json!({"SHARED":"ignored"}).to_string()))
        .unwrap();
    ProviderService::switch(state, AppType::Gemini, "a").unwrap();
    assert!(env().contains("# user\r\nDEBUG=1\r\n"));
    assert!(env().contains("GEMINI_API_KEY=a-key"));
    assert!(!env().contains("SHARED"));
    assert_eq!(settings()["model"], json!({"name":"gemini-test","other":1}));
    assert_eq!(settings()["ui"]["theme"], "dark");
    assert_eq!(
        settings()["security"]["auth"]["selectedType"],
        "gemini-api-key"
    );
    let mut official = provider("official", json!({"env":{}}));
    official.category = Some("official".into());
    state.db.save_provider("gemini", &official).unwrap();
    ProviderService::switch(state, AppType::Gemini, "official").unwrap();
    assert!(!env().contains("GEMINI_API_KEY"));
    assert!(env().contains("DEBUG=1"));
    assert_eq!(
        settings()["security"]["auth"],
        json!({"selectedType":"oauth-personal","extra":true})
    );
    assert_eq!(settings()["model"], json!({"other":1}));
    assert_eq!(settings()["mcpServers"]["mine"]["command"], "local");
    assert_eq!(std::fs::read(oauth_path).unwrap(), b"opaque login");
    assert_eq!(
        state
            .db
            .get_provider_by_id("a", "gemini")
            .unwrap()
            .unwrap()
            .settings_config,
        row.settings_config
    );
}

#[test]
#[serial]
fn corrupt_second_file_blocks_both_files_and_first_file_interruption_recovers() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    seed_live();
    let before_env = env();
    std::fs::write(crate::gemini_config::get_gemini_settings_path(), b"{broken").unwrap();
    let row = provider(
        "a",
        json!({"env":{"GEMINI_API_KEY":"new-key"},"config":{"model":{"name":"new-model"}}}),
    );
    assert!(ProviderService::add(state, AppType::Gemini, row.clone(), true).is_err());
    assert_eq!(env(), before_env);
    assert!(state
        .db
        .get_provider_by_id("a", "gemini")
        .unwrap()
        .is_none());
    seed_live();
    crate::mode::operation::failpoint::crash_at(Some("published:0"));
    assert!(ProviderService::add(state, AppType::Gemini, row, true).is_err());
    crate::mode::operation::failpoint::crash_at(None);
    assert_eq!(
        ProviderService::current(state, AppType::Gemini).unwrap(),
        "a"
    );
    assert!(env().contains("GEMINI_API_KEY=new-key"));
    assert_eq!(settings()["model"]["name"], "new-model");
}

#[test]
#[serial]
fn inactive_editor_changes_globals_but_conflicting_second_file_blocks_env_change() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    seed_live();
    let row = provider("b", json!({"env":{"GEMINI_API_KEY":"b-key"}}));
    state.db.save_provider("gemini", &row).unwrap();
    let base = ProviderService::gemini_editor_view(state, &row.settings_config, None)
        .unwrap()
        .settings;
    let mut edited = row.clone();
    edited.settings_config = base.clone();
    edited.settings_config["env"]["DEBUG"] = json!("2");
    edited.settings_config["config"]["ui"]["theme"] = json!("light");
    let mut external = settings();
    external["ui"]["theme"] = json!("external");
    crate::config::write_json_file(&crate::gemini_config::get_gemini_settings_path(), &external)
        .unwrap();
    let before_env = env();
    let context = |on_conflict| {
        Some(EditorSave {
            base: base.clone(),
            on_conflict,
        })
    };
    assert!(ProviderService::save_gemini(
        state,
        edited.clone(),
        context(ConflictPolicy::Refuse),
        false
    )
    .is_err());
    assert_eq!(env(), before_env);
    assert_eq!(settings(), external);
    assert_eq!(
        state
            .db
            .get_provider_by_id("b", "gemini")
            .unwrap()
            .unwrap()
            .settings_config,
        row.settings_config
    );
    ProviderService::save_gemini(state, edited, context(ConflictPolicy::KeepTheirs), false)
        .unwrap();
    assert!(env().contains("DEBUG=2"));
    assert!(env().contains("GEMINI_API_KEY=old"));
    assert_eq!(settings()["ui"]["theme"], "external");
}
