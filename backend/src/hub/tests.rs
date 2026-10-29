use super::*;
use crate::{
    database::Database,
    proxy::{
        providers::{
            codex_oauth_auth::CodexOAuthManager, copilot_auth::CopilotAuthManager,
            xai_oauth_auth::XaiOAuthManager,
        },
        server::ProxyServer,
        types::ProxyConfig,
    },
    store::AppState,
};
use axum::http::{header, HeaderMap};
use rusqlite::params;
use std::collections::HashSet;
use std::future::IntoFuture;
use std::sync::{Arc, Barrier};
use tokio::sync::RwLock;

fn database() -> Arc<Database> {
    let db = Arc::new(Database::memory().unwrap());
    let c = conn(&db).unwrap();
    for (id, role) in [("admin", "admin"), ("alice", "user"), ("bob", "user")] {
        c.execute("INSERT INTO hub_users(id,username,role,concurrency,rpm,created_at) VALUES(?1,?1,?2,10,100,?3)",params![id,role,now()]).unwrap();
        c.execute("INSERT INTO hub_api_keys(id,user_id,name,token_hash,prefix,created_at) VALUES(?1,?1,?1,?2,'test',?3)",params![id,auth::hash(&format!("test-{id}")),now()]).unwrap();
    }
    c.execute(
        "INSERT INTO hub_settings(key,value) VALUES('initialized','true')",
        [],
    )
    .unwrap();
    drop(c);
    db
}
fn identity(name: &str) -> Identity {
    Identity {
        id: name.into(),
        username: name.into(),
        role: if name == "admin" {
            "admin".into()
        } else {
            "user".into()
        },
        key_id: Some(name.into()),
        csrf: None,
    }
}
#[test]
fn request_addresses_follow_the_current_host_and_proxy_overrides() {
    let db = database();
    let c = conn(&db).unwrap();
    c.execute(
        "INSERT OR REPLACE INTO hub_settings(key,value) VALUES
            ('publicUrl','http://127.0.0.1:8890')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT OR REPLACE INTO hub_settings(key,value) VALUES
            ('publicProxyUrl','http://127.0.0.1:15721/v1')",
        [],
    )
    .unwrap();
    drop(c);
    let mut headers = HeaderMap::new();
    headers.insert(header::HOST, "192.168.1.20:8890".parse().unwrap());
    assert_eq!(
        api::request_origin(&db, &headers),
        "http://192.168.1.20:8890"
    );
    assert_eq!(
        api::request_proxy_url(&db, &headers),
        "http://192.168.1.20:15721/v1"
    );
    assert!(!api::request_secure(&db, &headers));

    headers.insert("x-forwarded-host", "cc.example.com".parse().unwrap());
    headers.insert("x-forwarded-proto", "https".parse().unwrap());
    assert_eq!(api::request_origin(&db, &headers), "https://cc.example.com");
    assert_eq!(
        api::request_proxy_url(&db, &headers),
        "http://cc.example.com:15721/v1"
    );
    assert!(api::request_secure(&db, &headers));

    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_settings SET value='https://gateway.example.com/v1'
             WHERE key='publicProxyUrl'",
            [],
        )
        .unwrap();
    assert_eq!(
        api::request_proxy_url(&db, &headers),
        "https://gateway.example.com/v1"
    );
}
#[test]
fn proxy_on_the_public_host_follows_the_current_request_host() {
    let db = database();
    conn(&db)
        .unwrap()
        .execute(
            "INSERT OR REPLACE INTO hub_settings(key,value) VALUES
                ('publicUrl','http://47.93.170.86:8890'),
                ('publicProxyUrl','http://47.93.170.86:15721/v1')",
            [],
        )
        .unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(header::HOST, "192.168.1.20:8890".parse().unwrap());
    assert_eq!(
        api::request_proxy_url(&db, &headers),
        "http://192.168.1.20:15721/v1"
    );

    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_settings SET value='http://gateway.internal:15721/v1'
             WHERE key='publicProxyUrl'",
            [],
        )
        .unwrap();
    assert_eq!(
        api::request_proxy_url(&db, &headers),
        "http://gateway.internal:15721/v1"
    );
}
#[test]
fn origin_check_accepts_the_current_request_host() {
    let db = database();
    conn(&db)
        .unwrap()
        .execute(
            "INSERT OR REPLACE INTO hub_settings(key,value) VALUES
                ('publicUrl','http://127.0.0.1:8890')",
            [],
        )
        .unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(header::HOST, "192.168.1.20:8890".parse().unwrap());
    headers.insert(header::ORIGIN, "http://192.168.1.20:8890".parse().unwrap());
    assert!(auth::check_origin(&db, &headers).is_ok());

    headers.insert(header::ORIGIN, "http://192.168.1.21:8890".parse().unwrap());
    assert!(auth::check_origin(&db, &headers).is_err());

    headers.insert("x-forwarded-host", "cc.example.com".parse().unwrap());
    headers.insert("x-forwarded-proto", "https".parse().unwrap());
    headers.insert(header::ORIGIN, "https://cc.example.com".parse().unwrap());
    assert!(auth::check_origin(&db, &headers).is_ok());
}
fn grant_access(db: &Database, resource: &str, user: &str, budget: &str, models: &str) {
    conn(db)
        .unwrap()
        .execute(
            "INSERT INTO hub_grants(resource_id,user_id,allowed,budget,models)
             VALUES(?1,?2,1,?3,?4)
             ON CONFLICT(resource_id,user_id) DO UPDATE SET
                allowed=1,budget=excluded.budget,models=excluded.models",
            params![resource, user, budget, models],
        )
        .unwrap();
}
fn app(db: Arc<Database>) -> Arc<AppState> {
    let dir = tempfile::tempdir().unwrap().keep();
    let cop = Arc::new(RwLock::new(CopilotAuthManager::new(dir.join("copilot"))));
    let cod = Arc::new(RwLock::new(CodexOAuthManager::new(dir.join("codex"))));
    let xai = Arc::new(RwLock::new(XaiOAuthManager::new(dir.join("xai"))));
    let proxy_service = crate::services::proxy::ProxyService::new_with_auth(
        db.clone(),
        cop.clone(),
        cod.clone(),
        xai.clone(),
    );
    Arc::new(AppState {
        db,
        copilot_auth_state: cop,
        codex_oauth_state: cod,
        xai_oauth_state: xai,
        proxy_service,
        mode_startup_errors: Arc::new(RwLock::new(Default::default())),
    })
}
async fn batch_device_keys(
    client: &reqwest::Client,
    base: &str,
    cookie: &str,
    ids: &[&str],
    action: &str,
) -> reqwest::Response {
    client
        .post(format!("{base}/api/unit/keys/batch"))
        .header("Cookie", cookie)
        .header("x-csrf-token", "alice-csrf")
        .json(&json!({"ids":ids,"action":action}))
        .send()
        .await
        .unwrap()
}
fn resource(
    db: &Database,
    key: &str,
    owner: &str,
    base: &str,
    official: bool,
) -> resources::Resource {
    let p = crate::provider::Provider::with_id(
        key.into(),
        key.into(),
        json!({"auth":{"OPENAI_API_KEY":"upstream-private-key"},"config":format!("model_provider = \"upstream\"\n[model_providers.upstream]\nname = \"test\"\nbase_url = \"{base}\"\nwire_api = \"responses\"\n")}),
        None,
    );
    db.save_provider("codex", &p).unwrap();
    conn(db).unwrap().execute("INSERT INTO hub_resources(id,provider_id,app_type,owner_id,route_key,published,models,official,account_id,created_at) VALUES(?1,?1,'codex',?2,?1,1,?3,?4,?5,?6)",params![key,owner,r#"[{"slug":"test-model","display_name":"Test"}]"#,official,if official{Some(format!("account-{key}"))}else{None},now()]).unwrap();
    resources::get(db, key).unwrap()
}
fn share_code(
    db: &Database,
    id: &str,
    resource: &str,
    owner: &str,
    token: &str,
    max_claims: i64,
    claimed_count: i64,
    expires_at: Option<i64>,
    active: bool,
) {
    conn(db)
        .unwrap()
        .execute(
            "INSERT INTO hub_share_codes(
                id,resource_id,created_by,token_hash,budget,models,expires_at,
                max_claims,claimed_count,active,created_at
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                id,
                resource,
                owner,
                auth::hash(token),
                r#"{"requests":5,"tokens":1000}"#,
                r#"["test-model"]"#,
                expires_at,
                max_claims,
                claimed_count,
                active,
                now()
            ],
        )
        .unwrap();
}
#[test]
fn public_private_and_model_specific_grants_are_enforced() {
    let db = database();
    let mut r = resource(&db, "test", "admin", "https://example.com/v1", false);
    let alice = identity("alice");
    assert!(resources::usable(&db, &alice, &r, "test-model").is_err());
    r.policy.visibility = "public".into();
    assert!(resources::usable(&db, &alice, &r, "test-model").is_err());
    r.policy.visibility = "selected".into();
    assert!(resources::grant(&db, &alice, &r, Some("test-model")).is_err());
    grant_access(
        &db,
        "test",
        "alice",
        r#"{"requests":5}"#,
        r#"["test-model"]"#,
    );
    assert_eq!(
        resources::grant(&db, &alice, &r, Some("test-model"))
            .unwrap()
            .requests,
        Some(5)
    );
    assert!(resources::grant(&db, &alice, &r, Some("another")).is_err());
    r.policy.visibility = "private".into();
    assert!(resources::grant(&db, &identity("bob"), &r, None).is_err());
    assert_eq!(
        resources::grant(&db, &alice, &r, Some("test-model"))
            .unwrap()
            .requests,
        Some(5)
    );
    assert!(resources::grant(&db, &identity("admin"), &r, None)
        .unwrap()
        .requests
        .is_none());
}

/// 自己的供应商不发布也应当出现在模型与路由里，别人的未发布供应商不能借用。
#[test]
fn own_unpublished_resource_feeds_routes_and_catalog() {
    let db = database();
    resource(&db, "mine", "alice", "https://example.com/v1", false);
    resource(&db, "theirs", "bob", "https://example.com/v1", false);
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_resources SET published=0 WHERE id IN ('mine','theirs')",
            [],
        )
        .unwrap();
    let alice = identity("alice");
    let mine = resources::get(&db, "mine").unwrap();
    let theirs = resources::get(&db, "theirs").unwrap();
    assert!(resources::usable(&db, &alice, &mine, "test-model").is_ok());
    assert!(resources::usable(&db, &alice, &theirs, "test-model").is_err());

    api::seed_model_routes(&db, &alice).unwrap();
    let routes = api::list_model_routes(&db, "alice").unwrap();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0]["targets"], json!(["mine"]));

    let export = catalog::export(&db, &alice, false).unwrap();
    let models = export["models"].as_array().unwrap();
    let slugs = models
        .iter()
        .filter_map(|m| m["slug"].as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    assert_eq!(slugs, vec!["ccs-mine/test-model".to_string()]);
    let row = &models[0];
    assert_eq!(row["support_verbosity"], json!(false));
    assert!(row["truncation_policy"].is_object());
    assert!(row["supports_search_tool"].is_boolean());
}

/// 显式同步展示选择只过滤 Codex 目录，不能删除或禁用请求路由。
#[test]
fn catalog_selection_does_not_change_request_routes() {
    let db = database();
    resource(&db, "mine", "alice", "https://example.com/v1", false);
    let alice = identity("alice");
    api::seed_model_routes(&db, &alice).unwrap();
    conn(&db)
        .unwrap()
        .execute(
            "INSERT INTO hub_preferences(user_id,value) VALUES('alice','{\"models\":[]}')
             ON CONFLICT(user_id) DO UPDATE SET value=excluded.value",
            [],
        )
        .unwrap();

    let selected = catalog::export(&db, &alice, true).unwrap();
    assert!(selected["models"].as_array().unwrap().is_empty());

    let routes = api::list_model_routes(&db, "alice").unwrap();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0]["targets"], json!(["mine"]));
    assert_eq!(routes[0]["enabled"], json!(true));
}

#[test]
fn share_codes_enforce_lifecycle_and_create_explicit_grants() {
    let db = database();
    let mut r = resource(&db, "test", "admin", "https://example.com/v1", false);
    r.policy.visibility = "private".into();
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_resources SET policy=?1 WHERE id='test'",
            [json_text(&r.policy)],
        )
        .unwrap();
    share_code(
        &db,
        "active",
        "test",
        "admin",
        "ccu_share_token_active",
        2,
        0,
        Some(now() + 60),
        true,
    );
    share_code(
        &db,
        "expired",
        "test",
        "admin",
        "ccu_share_token_expired",
        2,
        0,
        Some(now() - 1),
        true,
    );
    share_code(
        &db,
        "revoked",
        "test",
        "admin",
        "ccu_share_token_revoked",
        2,
        0,
        None,
        false,
    );
    share_code(
        &db,
        "exhausted",
        "test",
        "admin",
        "ccu_share_token_exhausted",
        1,
        1,
        None,
        true,
    );
    let state = app(db.clone());
    let alice = identity("alice");
    let claimed = api::claim_share_code(&state, &alice, "ccu_share_token_active").unwrap();
    assert_eq!(claimed["resourceId"], "test");
    assert_eq!(claimed["budget"]["requests"], 5);
    assert!(api::claim_share_code(&state, &alice, "ccu_share_token_active").is_err());
    assert!(api::claim_share_code(&state, &identity("bob"), "ccu_share_token_expired").is_err());
    assert!(api::claim_share_code(&state, &identity("bob"), "ccu_share_token_revoked").is_err());
    assert!(api::claim_share_code(&state, &identity("bob"), "ccu_share_token_exhausted").is_err());
    assert_eq!(
        resources::grant(&db, &alice, &r, Some("test-model"))
            .unwrap()
            .requests,
        Some(5)
    );
    let (grant_budget, grant_models): (String, String) = conn(&db)
        .unwrap()
        .query_row(
            "SELECT budget,models FROM hub_grants WHERE resource_id='test' AND user_id='alice'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(parse::<Budget>(&grant_budget).tokens, Some(1000));
    assert_eq!(parse::<Vec<String>>(&grant_models), vec!["test-model"]);
}

#[test]
fn concurrent_share_claims_allow_exactly_one_winner() {
    let db = database();
    resource(&db, "test", "admin", "https://example.com/v1", false);
    share_code(
        &db,
        "once",
        "test",
        "admin",
        "ccu_share_token_once",
        1,
        0,
        Some(now() + 60),
        true,
    );
    let state = app(db.clone());
    let start = Arc::new(Barrier::new(3));
    let workers = ["alice", "bob"]
        .into_iter()
        .map(|name| {
            let state = state.clone();
            let start = start.clone();
            std::thread::spawn(move || {
                start.wait();
                api::claim_share_code(&state, &identity(name), "ccu_share_token_once")
            })
        })
        .collect::<Vec<_>>();
    start.wait();
    let results = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    let (claimed_count, grants): (i64, i64) = conn(&db)
        .unwrap()
        .query_row(
            "SELECT
                (SELECT claimed_count FROM hub_share_codes WHERE id='once'),
                (SELECT COUNT(*) FROM hub_grants WHERE resource_id='test')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((claimed_count, grants), (1, 1));
}

#[tokio::test]
async fn profile_overview_only_returns_owned_or_authorized_suppliers() {
    let db = database();
    let mine = resource(&db, "mine", "alice", "https://example.com/v1", false);
    let mine_policy = Policy {
        shared_budget: Budget {
            requests: Some(11),
            ..Default::default()
        },
        ..Default::default()
    };
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_resources SET policy=?1 WHERE id='mine'",
            [json_text(&mine_policy)],
        )
        .unwrap();
    let shared_bucket = format!("shared:mine:{}", metering::period("lifetime"));
    conn(&db)
        .unwrap()
        .execute(
            "INSERT INTO hub_buckets(id,used_requests,reserved_requests)
             VALUES(?1,3,1)",
            [&shared_bucket],
        )
        .unwrap();
    resource(&db, "public", "admin", "https://example.com/v2", false);
    let hidden = resource(&db, "hidden", "admin", "https://example.com/v3", false);
    let selected = resource(&db, "selected", "admin", "https://example.com/v4", false);
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_resources SET policy=?1 WHERE id IN ('hidden','selected')",
            [json_text(&Policy {
                visibility: "private".into(),
                ..Default::default()
            })],
        )
        .unwrap();
    conn(&db)
        .unwrap()
        .execute(
            "INSERT INTO hub_grants(resource_id,user_id,allowed,budget,models)
             VALUES(?1,'alice',1,'{\"requests\":7}','[]')",
            [&selected.id],
        )
        .unwrap();
    let encoded = auth::password_hash("test-password-123").unwrap();
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_users SET password_hash=?1 WHERE id='alice'",
            [encoded],
        )
        .unwrap();
    let state = app(db);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(axum::serve(listener, api::routes(state)).into_future());
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let login = client
        .post(format!("{base}/api/unit/auth/login"))
        .json(&json!({"username":"alice","password":"test-password-123"}))
        .send()
        .await
        .unwrap();
    assert_eq!(login.status(), 200);
    let cookie = login.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let response = client
        .get(format!("{base}/api/unit/profile/overview"))
        .header("Cookie", cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    let suppliers = body["suppliers"].as_array().unwrap();
    let ids = suppliers
        .iter()
        .filter_map(|supplier| supplier["id"].as_str())
        .collect::<HashSet<_>>();
    assert_eq!(ids, HashSet::from(["mine", "selected"]));
    let mine = suppliers
        .iter()
        .find(|supplier| supplier["id"] == mine.id)
        .unwrap();
    assert_eq!(mine["owned"], true);
    assert_eq!(mine["balanceKind"], "sharedPool");
    assert_eq!(mine["budget"]["requests"], 11);
    assert_eq!(mine["usage"]["requests"], 3);
    assert_eq!(mine["usage"]["reservedRequests"], 1);
    assert_eq!(mine["remaining"]["requests"], 7);
    let selected = suppliers
        .iter()
        .find(|supplier| supplier["id"] == selected.id)
        .unwrap();
    assert_eq!(selected["owned"], false);
    assert_eq!(selected["budget"]["requests"], 7);
    assert!(!ids.contains(hidden.id.as_str()));
    task.abort();
}

#[test]
fn reservations_serialize_competing_requests_and_settle_once() {
    let db = database();
    conn(&db)
        .unwrap()
        .execute("UPDATE hub_users SET concurrency=1 WHERE id='alice'", [])
        .unwrap();
    let amount = metering::Amount {
        requests: 1,
        tokens: 100,
        credits: 10,
    };
    let workers = (0..2)
        .map(|_| {
            let db = db.clone();
            std::thread::spawn(move || {
                metering::start(
                    &db,
                    &identity("alice"),
                    "ccs-test/test-model",
                    "codex",
                    false,
                    amount,
                )
            })
        })
        .collect::<Vec<_>>();
    let results = workers
        .into_iter()
        .map(|w| w.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    let request = results.into_iter().find_map(|r| r.ok()).unwrap();
    let usage = metering::Usage {
        known: true,
        input: 5,
        output: 3,
        ..Default::default()
    };
    metering::finish(&db, &request, None, 200, &usage, 10, None, true).unwrap();
    metering::finish(&db, &request, None, 200, &usage, 10, None, true).unwrap();
    let q = metering::remaining(&db, &identity("alice")).unwrap();
    assert_eq!(q["usage"]["requests"], 1);
    assert_eq!(q["usage"]["reservedRequests"], 0);
    let count: i64 = conn(&db)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM hub_ledger", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}
#[test]
fn interrupted_usage_retains_holds_until_explicit_reconciliation() {
    let db = database();
    let request = metering::start(
        &db,
        &identity("alice"),
        "ccs-test/test-model",
        "codex",
        true,
        metering::Amount {
            requests: 1,
            tokens: 100,
            credits: 0,
        },
    )
    .unwrap();
    metering::finish(
        &db,
        &request,
        None,
        200,
        &metering::Usage {
            known: true,
            input: 4,
            ..Default::default()
        },
        100,
        None,
        false,
    )
    .unwrap();
    let q = metering::remaining(&db, &identity("alice")).unwrap();
    assert_eq!(q["usage"]["reservedRequests"], 1);
    assert!(
        metering::reconcile(&db, &identity("bob"), &request, Default::default(), true).is_err()
    );
    metering::reconcile(&db, &identity("admin"), &request, Default::default(), true).unwrap();
    let q = metering::remaining(&db, &identity("alice")).unwrap();
    assert_eq!(q["usage"]["reservedRequests"], 0);
    assert_eq!(q["usage"]["requests"], 0);
}
#[test]
fn retry_releases_resource_holds_but_keeps_one_consumer_reservation() {
    let db = database();
    let r = resource(&db, "test", "admin", "https://example.com/v1", false);
    let user = identity("alice");
    grant_access(&db, "test", "alice", "{}", "[]");
    let amount = metering::Amount {
        requests: 1,
        tokens: 100,
        credits: 0,
    };
    let request = metering::start(
        &db,
        &user,
        "ccs-official/test-model",
        "codex",
        false,
        amount,
    )
    .unwrap();
    let attempt = metering::attempt(&db, &user, &request, &r, "test-model", amount, None).unwrap();
    metering::retry(&db, &request, &attempt, 429, "quota").unwrap();
    let c = conn(&db).unwrap();
    let (user,shared):(i64,i64)=c.query_row("SELECT SUM(CASE WHEN scope='user' AND state='reserved' THEN 1 ELSE 0 END),SUM(CASE WHEN scope!='user' AND state='reserved' THEN 1 ELSE 0 END) FROM hub_reservations WHERE request_id=?1",[request],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!((user, shared), (1, 0));
}
#[test]
fn usage_parser_merges_anthropic_and_responses_without_double_counting() {
    let mut usage = metering::Usage::default();
    usage.observe(&json!({"type":"message_start","message":{"id":"msg-1","usage":{"input_tokens":10,"cache_read_input_tokens":5}}}));
    usage.observe(&json!({"type":"message_delta","usage":{"output_tokens":7}}));
    assert_eq!(usage.tokens("claude"), 22);
    let mut usage = metering::Usage::default();
    for _ in 0..2 {
        usage.observe(&json!({"type":"response.completed","response":{"id":"resp-1","usage":{"input_tokens":10,"output_tokens":5,"input_tokens_details":{"cached_tokens":3}}}}));
    }
    assert_eq!(usage.tokens("codex"), 15);
    assert_eq!(usage.read, 3);
}

#[tokio::test]
async fn ordinary_upstreams_cannot_resolve_private_or_mapped_private_addresses() {
    for address in [
        "127.0.0.1",
        "10.1.2.3",
        "169.254.169.254",
        "172.16.0.1",
        "192.168.1.1",
        "100.64.0.1",
        "::1",
        "::ffff:127.0.0.1",
        "fc00::1",
    ] {
        assert!(!network::is_public(address.parse().unwrap()), "{address}");
    }
    assert!(network::is_public("1.1.1.1".parse().unwrap()));
    assert!(network::resolve("localhost", 80).await.is_err());
}

#[tokio::test]
async fn streamed_usage_settles_and_disconnected_stream_keeps_its_reservation() {
    use futures::StreamExt;
    let upstream=axum::Router::new().route("/v1/responses",axum::routing::post(|Json(body):Json<Value>|async move {
        let cut=body["input"]=="cut";
        let stream=async_stream::stream! {
            if cut {
                yield Ok::<_,std::convert::Infallible>("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n");
                std::future::pending::<()>().await;
            }else{
                yield Ok::<_,std::convert::Infallible>("data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-stream\",\"model\":\"test-model\",\"output\":[],\"usage\":{\"input_tokens\":11,\"output_tokens\":7}}}\n\n");
            }
        };
        ([("content-type","text/event-stream")],axum::body::Body::from_stream(stream))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(axum::serve(listener, upstream).into_future());
    let db = database();
    resource(&db, "test", "admin", &base, false);
    grant_access(&db, "test", "alice", "{}", "[]");
    grant_access(&db, "test", "bob", "{}", "[]");
    let proxy = proxy(db.clone()).await;
    let endpoint = format!(
        "http://127.0.0.1:{}/v1/responses",
        proxy.get_status().await.port
    );
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .post(&endpoint)
        .bearer_auth("test-alice")
        .json(&json!({"model":"ccs-test/test-model","input":"complete","stream":true}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let text = response.text().await.unwrap();
    assert!(text.contains("response.completed"));
    let response = client
        .post(&endpoint)
        .bearer_auth("test-bob")
        .json(&json!({"model":"ccs-test/test-model","input":"cut","stream":true}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let mut chunks = response.bytes_stream();
    chunks.next().await.unwrap().unwrap();
    drop(chunks);
    for _ in 0..50 {
        let pending: i64 = conn(&db)
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM hub_requests WHERE user_id='bob' AND state='pending_usage'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        if pending == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let alice = metering::remaining(&db, &identity("alice")).unwrap();
    let bob = metering::remaining(&db, &identity("bob")).unwrap();
    assert_eq!(alice["usage"]["tokens"], 18);
    assert_eq!(alice["usage"]["reservedRequests"], 0);
    assert_eq!(bob["usage"]["reservedRequests"], 1);
    let pending: i64 = conn(&db)
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM hub_requests WHERE user_id='bob' AND state='pending_usage'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pending, 1);
    proxy.stop().await.unwrap();
    task.abort();
}
#[tokio::test]
async fn authentication_and_resource_routes_do_not_expose_other_users_secrets() {
    let db = database();
    conn(&db)
        .unwrap()
        .execute(
            "INSERT OR REPLACE INTO hub_settings(key,value)
             VALUES('publicProxyUrl','http://127.0.0.1:15721/v1')",
            [],
        )
        .unwrap();
    resource(&db, "test", "admin", "https://example.com/v1", false);
    let encoded = auth::password_hash("test-password-123").unwrap();
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_users SET password_hash=?1 WHERE id='alice'",
            [encoded],
        )
        .unwrap();
    let app = app(db.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(axum::serve(listener, api::routes(app)).into_future());
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let login = client
        .post(format!("{base}/api/unit/auth/login"))
        .json(&json!({"username":"alice","password":"test-password-123"}))
        .send()
        .await
        .unwrap();
    assert_eq!(login.status(), 200);
    let cookie = login.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert!(login.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .contains("HttpOnly"));
    let me: Value = client
        .get(format!("{base}/api/unit/me"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let resources = client
        .get(format!("{base}/api/unit/resources"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(!resources.contains("upstream-private-key"));
    assert!(!resources.contains("settingsConfig"));
    assert_eq!(
        client
            .get(format!("{base}/api/unit/resources/test"))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(format!("{base}/api/unit/admin/users"))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(format!("{base}/api/unit/keys"))
            .header("Cookie", &cookie)
            .json(&json!({"name":"device"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    let created: Value = client
        .post(format!("{base}/api/unit/keys"))
        .header("Cookie", &cookie)
        .header("Origin", base.as_str())
        .header("x-csrf-token", me["user"]["csrf"].as_str().unwrap())
        .json(&json!({"name":"device"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(created["key"].as_str().unwrap().starts_with("ccu_"));
    assert_eq!(created["token_version"], 1);
    assert!(created["command"]
        .as_str()
        .unwrap()
        .contains(&format!("{base}/api/unit/install.sh")));
    let copied: Value = client
        .get(format!(
            "{base}/api/unit/keys/{}/command",
            created["id"].as_str().unwrap()
        ))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(copied["command"], created["command"]);
    assert_eq!(
        client
            .get(format!(
                "{base}/api/unit/keys/{}/command",
                created["id"].as_str().unwrap()
            ))
            .bearer_auth(created["key"].as_str().unwrap())
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .get(format!("{base}/api/unit/catalog"))
            .bearer_auth(created["key"].as_str().unwrap())
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let installer = client
        .get(format!("{base}/api/unit/install.sh"))
        .bearer_auth(created["key"].as_str().unwrap())
        .header("x-forwarded-host", "cc.example.com")
        .header("x-forwarded-proto", "https")
        .send()
        .await
        .unwrap();
    assert_eq!(installer.status(), 200);
    let installer = installer.text().await.unwrap();
    assert!(installer.contains("https://cc.example.com"));
    assert!(installer.contains("http://cc.example.com:15721/v1"));
    let keys = client
        .get(format!("{base}/api/unit/keys"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(!keys.contains(created["key"].as_str().unwrap()));
    assert!(!keys.contains("token_hash"));
    assert!(keys.contains("\"token_version\":1"));
    conn(&db)
        .unwrap()
        .execute(
            "INSERT INTO hub_api_keys(
                id,user_id,name,token_hash,prefix,created_at,token_version
             ) VALUES('legacy-device','alice','legacy',?1,'legacy',?2,0)",
            params![auth::hash("legacy-token"), now()],
        )
        .unwrap();
    let legacy = client
        .get(format!("{base}/api/unit/keys/legacy-device/command"))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(legacy.status(), 400);
    assert!(legacy
        .text()
        .await
        .unwrap()
        .contains("历史设备码无法恢复原命令"));
    conn(&db)
        .unwrap()
        .execute(
            "INSERT INTO hub_sessions(token_hash,user_id,csrf,expires_at,created_at)
             VALUES(?1,'bob','bob-csrf',?2,?3)",
            params![auth::hash("bob-session-token"), now() + 3600, now()],
        )
        .unwrap();
    let other_user_command = client
        .get(format!(
            "{base}/api/unit/keys/{}/command",
            created["id"].as_str().unwrap()
        ))
        .header(
            "Cookie",
            format!("{}={}", auth::COOKIE, "bob-session-token"),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(other_user_command.status(), 404);
    task.abort();
}
#[tokio::test]
async fn library_usage_allows_private_owner_but_rejects_other_users() {
    let db = database();
    let upstream = axum::Router::new().route(
        "/balance",
        axum::routing::get(|| async { Json(json!({"balance":12.5})) }),
    );
    let upstream_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_base = format!("http://{}", upstream_listener.local_addr().unwrap());
    let upstream_task =
        tokio::spawn(axum::serve(upstream_listener, upstream).into_future());
    resource(&db, "alice-private", "alice", &upstream_base, false);
    resource(&db, "bob-private", "bob", "https://example.com/v1", false);
    let mut provider = db
        .get_provider_by_id("alice-private", "codex")
        .unwrap()
        .unwrap();
    let usage_code = r#"({
        request: {
            url: "__BALANCE_URL__",
            method: "GET",
            headers: {}
        },
        extractor: function(response) {
            return { remaining: response.balance, unit: "USD" };
        }
    })"#
        .replace("__BALANCE_URL__", &format!("{upstream_base}/balance"));
    provider.meta = Some(crate::provider::ProviderMeta {
        usage_script: Some(crate::provider::UsageScript {
            enabled: true,
            language: "javascript".into(),
            code: usage_code,
            timeout: Some(5),
            api_key: None,
            base_url: Some(upstream_base.clone()),
            access_token: None,
            user_id: None,
            template_type: Some("custom".into()),
            coding_plan_provider: None,
            auto_query_interval: None,
        }),
        ..Default::default()
    });
    db.save_provider("codex", &provider).unwrap();
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_resources SET published=0 WHERE id IN ('alice-private','bob-private')",
            [],
        )
        .unwrap();
    conn(&db)
        .unwrap()
        .execute(
            "INSERT INTO hub_sessions(token_hash,user_id,csrf,expires_at,created_at)
             VALUES(?1,'alice','alice-csrf',?2,?3)",
            params![auth::hash("alice-session-token"), now() + 3600, now()],
        )
        .unwrap();
    let state = app(db.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(axum::serve(listener, api::routes(state)).into_future());
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let cookie = format!("{}={}", auth::COOKIE, "alice-session-token");

    let own_private = client
        .get(format!(
            "{base}/api/unit/ui/library/codex/alice-private/usage"
        ))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(own_private.status(), 200);
    let own_private: Value = own_private.json().await.unwrap();
    assert_eq!(own_private["success"], true);
    assert_eq!(own_private["data"][0]["remaining"], 12.5);

    assert_eq!(
        client
            .get(format!(
                "{base}/api/unit/ui/library/codex/bob-private/usage"
            ))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );

    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_resources SET disabled=1 WHERE id='alice-private'",
            [],
        )
        .unwrap();
    assert_eq!(
        client
            .get(format!(
                "{base}/api/unit/ui/library/codex/alice-private/usage"
            ))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );

    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_resources SET disabled=0,published=1 WHERE id='alice-private'",
            [],
        )
        .unwrap();
    conn(&db)
        .unwrap()
        .execute(
            "INSERT INTO hub_sessions(token_hash,user_id,csrf,expires_at,created_at)
             VALUES(?1,'bob','bob-csrf',?2,?3)",
            params![auth::hash("bob-session-token"), now() + 3600, now()],
        )
        .unwrap();
    assert_eq!(
        client
            .get(format!(
                "{base}/api/unit/ui/library/codex/alice-private/usage"
            ))
            .header(
                "Cookie",
                format!("{}={}", auth::COOKIE, "bob-session-token"),
            )
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    task.abort();
    upstream_task.abort();
}
#[tokio::test]
async fn device_key_batch_actions_are_scoped_and_require_a_web_session() {
    let db = database();
    conn(&db)
        .unwrap()
        .execute(
            "INSERT INTO hub_sessions(token_hash,user_id,csrf,expires_at,created_at)
             VALUES(?1,'alice','alice-csrf',?2,?3)",
            params![auth::hash("alice-session-token"), now() + 3600, now()],
        )
        .unwrap();
    let app = app(db.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(axum::serve(listener, api::routes(app)).into_future());
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let cookie = format!("{}={}", auth::COOKIE, "alice-session-token");

    let mut created = Vec::new();
    for name in ["first", "second"] {
        let response = client
            .post(format!("{base}/api/unit/keys"))
            .header("Cookie", &cookie)
            .header("x-csrf-token", "alice-csrf")
            .json(&json!({"name":name,"expiresAt":null}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        created.push(response.json::<Value>().await.unwrap());
    }
    let first_id = created[0]["id"].as_str().unwrap();
    let second_id = created[1]["id"].as_str().unwrap();
    let first_token = created[0]["key"].as_str().unwrap();

    let disabled = batch_device_keys(
        &client,
        &base,
        &cookie,
        &[first_id, second_id, "bob"],
        "disable",
    )
    .await;
    assert_eq!(disabled.status(), 200);
    let disabled: Value = disabled.json().await.unwrap();
    assert_eq!(disabled["affected"], 2);
    assert_eq!(
        client
            .get(format!("{base}/api/unit/catalog"))
            .bearer_auth(first_token)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    {
        let c = conn(&db).unwrap();
        for id in [first_id, second_id] {
            let active: i64 = c
                .query_row("SELECT active FROM hub_api_keys WHERE id=?1", [id], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(active, 0);
        }
        let bob_active: i64 = c
            .query_row(
                "SELECT active FROM hub_api_keys WHERE id='bob'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(bob_active, 1);
    }

    assert_eq!(
        client
            .post(format!("{base}/api/unit/keys/batch"))
            .bearer_auth(first_token)
            .json(&json!({"ids":[first_id],"action":"enable"}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .post(format!("{base}/api/unit/keys/batch"))
            .header("Cookie", &cookie)
            .json(&json!({"ids":[first_id],"action":"enable"}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        batch_device_keys(&client, &base, &cookie, &[], "enable")
            .await
            .status(),
        400
    );
    assert_eq!(
        batch_device_keys(&client, &base, &cookie, &[first_id], "unknown")
            .await
            .status(),
        400
    );

    let enabled =
        batch_device_keys(&client, &base, &cookie, &[first_id, second_id], "enable").await;
    assert_eq!(enabled.status(), 200);
    assert_eq!(enabled.json::<Value>().await.unwrap()["affected"], 2);
    assert_eq!(
        client
            .get(format!("{base}/api/unit/catalog"))
            .bearer_auth(first_token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );

    let deleted = batch_device_keys(&client, &base, &cookie, &[first_id, "bob"], "delete").await;
    assert_eq!(deleted.status(), 200);
    assert_eq!(deleted.json::<Value>().await.unwrap()["affected"], 1);
    {
        let c = conn(&db).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM hub_api_keys WHERE id=?1",
                [first_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM hub_api_keys WHERE id='bob'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM hub_audit WHERE action='key.delete' AND target=?1",
                [first_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );
    }
    task.abort();
}
async fn proxy(db: Arc<Database>) -> ProxyServer {
    let a = app(db.clone());
    let proxy = ProxyServer::new(
        ProxyConfig {
            listen_address: "127.0.0.1".into(),
            listen_port: 0,
            ..Default::default()
        },
        db,
        a.copilot_auth_state.clone(),
        a.codex_oauth_state.clone(),
        a.xai_oauth_state.clone(),
    );
    proxy.start().await.unwrap();
    proxy
}
#[tokio::test]
async fn gateway_injects_upstream_key_and_records_consumer_provider_device() {
    use std::future::IntoFuture;
    let upstream=axum::Router::new().route("/v1/responses",axum::routing::post(|headers:axum::http::HeaderMap,Json(body):Json<Value>|async move {
        assert_eq!(headers["authorization"],"Bearer upstream-private-key");assert!(!headers.contains_key("cookie"));assert_eq!(body["model"],"test-model");
        Json(json!({"id":"resp-unit-1","model":"test-model","output":[],"usage":{"input_tokens":10,"output_tokens":5}}))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_base = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(axum::serve(listener, upstream).into_future());
    let db = database();
    resource(&db, "test", "admin", &upstream_base, false);
    grant_access(&db, "test", "alice", "{}", "[]");
    grant_access(&db, "test", "bob", "{}", "[]");
    let proxy = proxy(db.clone()).await;
    let base = format!("http://127.0.0.1:{}", proxy.get_status().await.port);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    assert_eq!(
        client
            .post(format!("{base}/v1/responses"))
            .json(&json!({"model":"ccs-test/test-model"}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .post(format!("{base}/v1/responses"))
            .bearer_auth("test-alice")
            .json(&json!({"model":"test-model"}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let response = client
        .post(format!("{base}/v1/responses"))
        .bearer_auth("test-alice")
        .json(&json!({"model":"ccs-test/test-model","input":"hello","stream":false}))
        .send()
        .await
        .unwrap();
    let status = response.status();
    let body = response.text().await.unwrap();
    assert_eq!(status, 200, "{body}");
    let c = conn(&db).unwrap();
    let (user,owner,device,input,output):(String,String,String,i64,i64)=c.query_row("SELECT user_id,owner_id,device,input_tokens,output_tokens FROM hub_requests WHERE state='completed'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap();
    assert_eq!(
        (
            user.as_str(),
            owner.as_str(),
            device.as_str(),
            input,
            output
        ),
        ("alice", "admin", "alice", 10, 5)
    );
    drop(c);
    assert_eq!(
        client
            .post(format!("{base}/v1/responses"))
            .bearer_auth("test-bob")
            .json(&json!({"model":"ccs-test/test-model","previous_response_id":"resp-unit-1"}))
            .send()
            .await
            .unwrap()
            .status(),
        409
    );
    proxy.stop().await.unwrap();
    task.abort();
}
#[tokio::test]
async fn official_pool_rotates_only_among_authorized_candidates() {
    use std::future::IntoFuture;
    let rejected = axum::Router::new().route(
        "/v1/responses",
        axum::routing::post(|| async {
            (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"error":{"message":"quota exhausted"}})),
            )
        }),
    );
    let accepted=axum::Router::new().route("/v1/responses",axum::routing::post(||async{Json(json!({"id":"resp-pool","model":"test-model","output":[],"usage":{"input_tokens":3,"output_tokens":2}}))}));
    let first = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let first_base = format!("http://{}/v1", first.local_addr().unwrap());
    let second = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let second_base = format!("http://{}/v1", second.local_addr().unwrap());
    let t1 = tokio::spawn(axum::serve(first, rejected).into_future());
    let t2 = tokio::spawn(axum::serve(second, accepted).into_future());
    let db = database();
    resource(&db, "a", "admin", &first_base, true);
    resource(&db, "b", "bob", &second_base, true);
    grant_access(&db, "a", "alice", "{}", "[]");
    grant_access(&db, "b", "alice", "{}", "[]");
    let hidden = resource(&db, "c", "bob", &second_base, true);
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_resources SET policy=?1 WHERE id=?2",
            params![
                json_text(&Policy {
                    visibility: "private".into(),
                    ..Default::default()
                }),
                hidden.id
            ],
        )
        .unwrap();
    let proxy = proxy(db.clone()).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .post(format!(
            "http://127.0.0.1:{}/v1/responses",
            proxy.get_status().await.port
        ))
        .bearer_auth("test-alice")
        .json(&json!({"model":"ccs-official/test-model","input":"hello","stream":false}))
        .send()
        .await
        .unwrap();
    let status = response.status();
    let text = response.text().await.unwrap();
    assert_eq!(status, 200, "{text}");
    let c = conn(&db).unwrap();
    let (requests, attempts): (i64, i64) = c
        .query_row(
            "SELECT (SELECT COUNT(*) FROM hub_requests),(SELECT COUNT(*) FROM hub_attempts)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((requests, attempts), (1, 2));
    let actual: String = c
        .query_row("SELECT owner_id FROM hub_requests", [], |r| r.get(0))
        .unwrap();
    assert_eq!(actual, "bob");
    let hidden_attempts: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM hub_attempts WHERE resource_id='c'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hidden_attempts, 0);
    drop(c);
    proxy.stop().await.unwrap();
    t1.abort();
    t2.abort();
}
