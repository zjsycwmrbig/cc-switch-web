use super::ProviderService;
use crate::app_config::AppType;
use crate::database::Database;
use crate::provider::Provider;
use crate::store::AppState;
use serde_json::json;
use serial_test::serial;
use std::{ffi::OsString, fs, sync::Arc};

struct Fixture {
    previous_env: Vec<(&'static str, Option<OsString>)>,
    state: AppState,
    _dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let previous_env = ["CC_SWITCH_TEST_HOME", "MINIMAX_DATA_DIR", "MAVIS_DATA_DIR"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
        std::env::set_var("MINIMAX_DATA_DIR", dir.path().join("minimax"));
        std::env::remove_var("MAVIS_DATA_DIR");
        Self {
            previous_env,
            state: AppState::new(Arc::new(Database::memory().unwrap())),
            _dir: dir,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
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
fn adding_an_mcode_provider_rejects_a_key_already_in_use() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    let path = crate::mcode_config::config_path();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let native = "custom_provider:\n  handwritten:\n    name: Mine\n    models: {}\n  minimax:\n    kind: minimax\n    name: Account\n";
    fs::write(&path, native).unwrap();
    let provider = |id: &str| {
        Provider::with_id(
            id.into(),
            "Test".into(),
            json!({"name":"Test", "kind":"custom", "enabled":true, "api":"openai-completions",
                "options":{"baseURL":"https://api.example.com/v1","apiKey":"test-key"},
                "models":{"model":{"name":"Model"}}}),
            None,
        )
    };

    // Live nodes, custom or owned by MCode, are never overwritten.
    for id in ["handwritten", "minimax"] {
        assert!(ProviderService::add(state, AppType::Mcode, provider(id), true).is_err());
    }
    assert_eq!(fs::read_to_string(&path).unwrap(), native);
    assert!(state.db.get_all_providers("mcode").unwrap().is_empty());

    // Neither is a row that only lives in the database.
    ProviderService::add(state, AppType::Mcode, provider("fresh"), false).unwrap();
    let mut renamed = provider("fresh");
    renamed.name = "Other".into();
    assert!(ProviderService::add(state, AppType::Mcode, renamed, true).is_err());
    assert_eq!(
        state
            .db
            .get_provider_by_id("fresh", "mcode")
            .unwrap()
            .unwrap()
            .name,
        "Test"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), native);
}

#[test]
#[serial]
fn concurrent_mcode_adds_with_one_key_leave_exactly_one_winner() {
    let fixture = Fixture::new();
    let state = &fixture.state;
    let successes = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..16)
            .map(|index| {
                let state = &state;
                scope.spawn(move || {
                    let provider = Provider::with_id(
                        "same".into(),
                        format!("Racer {index}"),
                        json!({"name":"Racer", "kind":"custom", "enabled":true,
                            "api":"openai-completions",
                            "options":{"baseURL":"https://api.example.com/v1","apiKey":"test-key"},
                            "models":{"model":{"name":"Model"}}}),
                        None,
                    );
                    ProviderService::add(state, AppType::Mcode, provider, false)
                        .is_ok()
                        .then_some(index)
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(successes.len(), 1);
    assert_eq!(
        state
            .db
            .get_provider_by_id("same", "mcode")
            .unwrap()
            .unwrap()
            .name,
        format!("Racer {}", successes[0])
    );
}
