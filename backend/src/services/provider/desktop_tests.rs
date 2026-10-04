use super::ProviderService;
use crate::app_config::AppType;
use crate::database::{Database, CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID};
use crate::provider::Provider;
use crate::settings::{get_settings, update_settings, AppSettings};
use crate::store::AppState;
use serde_json::{json, Value};
use serial_test::serial;
use std::{ffi::OsString, fs, path::PathBuf, sync::Arc};

struct Fixture {
    previous_env: Vec<(&'static str, Option<OsString>)>,
    previous_settings: AppSettings,
    state: AppState,
    claude_settings: PathBuf,
    _dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let previous_env = ["CC_SWITCH_TEST_HOME", "LOCALAPPDATA", "XDG_CONFIG_HOME"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
        std::env::set_var("LOCALAPPDATA", dir.path().join("local"));
        std::env::set_var("XDG_CONFIG_HOME", dir.path().join("config"));
        let previous_settings = get_settings();
        update_settings(AppSettings::default()).unwrap();
        let claude_settings = crate::config::get_claude_settings_path();
        fs::create_dir_all(claude_settings.parent().unwrap()).unwrap();
        fs::write(&claude_settings, b"{\"claudeCodeOnly\":true}\n").unwrap();
        let state = AppState::new(Arc::new(Database::memory().unwrap()));
        for id in ["desktop-a", "desktop-b"] {
            state
                .db
                .save_provider(
                    "claude-desktop",
                    &Provider::with_id(
                        id.into(),
                        id.into(),
                        json!({"env": {
                            "ANTHROPIC_BASE_URL": format!("https://{id}.example.com"),
                            "ANTHROPIC_AUTH_TOKEN": format!("test-{id}")
                        }}),
                        None,
                    ),
                )
                .unwrap();
        }
        let mut official = Provider::with_id(
            CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID.into(),
            "Official".into(),
            json!({"env":{}}),
            None,
        );
        official.category = Some("official".into());
        state.db.save_provider("claude-desktop", &official).unwrap();
        Self {
            previous_env,
            previous_settings,
            state,
            claude_settings,
            _dir: dir,
        }
    }

    fn switch(&self, id: &str) -> Result<super::SwitchResult, crate::error::AppError> {
        ProviderService::switch(&self.state, AppType::ClaudeDesktop, id)
    }

    fn assert_isolated(&self) {
        assert_eq!(
            fs::read(&self.claude_settings).unwrap(),
            b"{\"claudeCodeOnly\":true}\n"
        );
        assert!(!self._dir.path().join(".cc-switch").exists());
        assert!(self
            ._dir
            .path()
            .join(".cc-switch-web/backups/live-first-write")
            .exists());
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        crate::mode::operation::failpoint::crash_at(None);
        update_settings(self.previous_settings.clone()).unwrap();
        for (key, value) in &self.previous_env {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }
}

#[test]
#[serial]
fn desktop_switch_preserves_user_profile_and_never_writes_claude_code() {
    let fixture = Fixture::new();
    assert_eq!(
        "claude-desktop".parse::<AppType>().unwrap(),
        AppType::ClaudeDesktop
    );
    fixture.switch("desktop-a").unwrap();
    let status = crate::claude_desktop_config::get_status(&fixture.state.db, false).unwrap();
    let profile_path = PathBuf::from(status.profile_path.unwrap());
    let mut profile: Value = serde_json::from_slice(&fs::read(&profile_path).unwrap()).unwrap();
    profile["userSetting"] = json!({"keep": true});
    profile["disableDeploymentModeChooser"] = json!(false);
    crate::config::write_json_file(&profile_path, &profile).unwrap();

    fixture.switch("desktop-b").unwrap();
    let switched: Value = serde_json::from_slice(&fs::read(&profile_path).unwrap()).unwrap();
    assert_eq!(switched["inferenceGatewayApiKey"], "test-desktop-b");
    assert_eq!(switched["userSetting"], profile["userSetting"]);
    assert_eq!(switched["disableDeploymentModeChooser"], false);

    fixture.switch(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID).unwrap();
    let official: Value = serde_json::from_slice(&fs::read(&profile_path).unwrap()).unwrap();
    assert!(official.get("inferenceGatewayApiKey").is_none());
    assert_eq!(official["userSetting"], profile["userSetting"]);
    assert!(
        !crate::claude_desktop_config::get_status(&fixture.state.db, false)
            .unwrap()
            .configured
    );
    fixture.assert_isolated();
}

#[test]
#[serial]
fn desktop_rejects_corrupt_meta_without_switching_current() {
    let fixture = Fixture::new();
    fixture.switch("desktop-a").unwrap();
    let status = crate::claude_desktop_config::get_status(&fixture.state.db, false).unwrap();
    let profile = PathBuf::from(status.profile_path.unwrap());
    let original = fs::read(&profile).unwrap();
    let meta = profile.parent().unwrap().join("_meta.json");
    fs::write(&meta, b"[]").unwrap();
    assert!(fixture.switch("desktop-b").is_err());
    assert_eq!(
        ProviderService::current(&fixture.state, AppType::ClaudeDesktop).unwrap(),
        "desktop-a"
    );
    assert_eq!(fs::read(&profile).unwrap(), original);
    assert_eq!(fs::read(&meta).unwrap(), b"[]");
    fixture.assert_isolated();
}

#[test]
#[serial]
fn desktop_current_read_recovers_interrupted_files_and_pointer() {
    let fixture = Fixture::new();
    crate::mode::operation::failpoint::crash_at(Some("published:0"));
    assert!(fixture.switch("desktop-b").is_err());
    crate::mode::operation::failpoint::crash_at(None);
    assert_eq!(
        ProviderService::current(&fixture.state, AppType::ClaudeDesktop).unwrap(),
        "desktop-b"
    );
    let status = crate::claude_desktop_config::get_status(&fixture.state.db, false).unwrap();
    assert!(status.configured);
    assert_eq!(
        status.actual_base_url.as_deref(),
        Some("https://desktop-b.example.com")
    );
    assert!(crate::mode::state::pending(
        &crate::live::engine::DeviceStore::for_device(),
        "claude-desktop"
    )
    .unwrap()
    .is_none());
    fixture.assert_isolated();
}

#[tokio::test]
#[serial]
async fn desktop_mapping_starts_service_and_editing_back_to_direct_stops_it() {
    use crate::provider::{ClaudeDesktopMode, ClaudeDesktopModelRoute, ProviderMeta};
    let f = Fixture::new();
    let state = &f.state;
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let mut global = state.db.get_global_proxy_config().await.unwrap();
    global.listen_port = port;
    state.db.update_global_proxy_config(global).await.unwrap();
    let mut row = state
        .db
        .get_provider_by_id("desktop-a", "claude-desktop")
        .unwrap()
        .unwrap();
    row.meta = Some(ProviderMeta {
        claude_desktop_mode: Some(ClaudeDesktopMode::Proxy),
        api_format: Some("openai_chat".into()),
        claude_desktop_model_routes: std::collections::HashMap::from([(
            "claude-sonnet-4-6".into(),
            ClaudeDesktopModelRoute {
                model: "kimi-k2".into(),
                label_override: None,
                supports_1m: None,
            },
        )]),
        ..Default::default()
    });
    let saved_state = state.clone();
    let saved_row = row.clone();
    tokio::task::spawn_blocking(move || {
        ProviderService::update(&saved_state, AppType::ClaudeDesktop, None, saved_row)
    })
    .await
    .unwrap()
    .unwrap();
    crate::mode::controller::switch_desktop(state, "desktop-a")
        .await
        .unwrap();
    assert!(state.proxy_service.is_running().await);
    let status = crate::claude_desktop_config::get_status(&state.db, true).unwrap();
    assert!(status
        .actual_base_url
        .unwrap()
        .contains(&format!(":{port}")));
    row.meta.as_mut().unwrap().claude_desktop_mode = Some(ClaudeDesktopMode::Direct);
    row.meta.as_mut().unwrap().api_format = Some("anthropic".into());
    let saved_state = state.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::task::spawn_blocking(move || {
            ProviderService::update(&saved_state, AppType::ClaudeDesktop, None, row)
        }),
    )
    .await
    .expect("同步保存不能阻塞服务停止")
    .unwrap()
    .unwrap();
    assert!(!state.proxy_service.is_running().await);
    f.assert_isolated();
}
