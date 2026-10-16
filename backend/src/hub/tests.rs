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
use rusqlite::params;
use std::future::IntoFuture;
use std::sync::Arc;
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
#[test]
fn public_private_and_model_specific_grants_are_enforced() {
    let db = database();
    let mut r = resource(&db, "test", "admin", "https://example.com/v1", false);
    let alice = identity("alice");
    assert!(resources::usable(&db, &alice, &r, "test-model").is_ok());
    r.policy.visibility = "selected".into();
    assert!(resources::grant(&db, &alice, &r, None).is_err());
    conn(&db).unwrap().execute("INSERT INTO hub_grants(resource_id,user_id,allowed,models,budget) VALUES('test','alice',1,'[\"test-model\"]','{\"requests\":5}')",[]).unwrap();
    assert_eq!(
        resources::grant(&db, &alice, &r, Some("test-model"))
            .unwrap()
            .requests,
        Some(5)
    );
    assert!(resources::grant(&db, &alice, &r, Some("another")).is_err());
    r.policy.visibility = "private".into();
    assert!(resources::grant(&db, &alice, &r, None).is_err());
    assert!(resources::grant(&db, &identity("admin"), &r, None)
        .unwrap()
        .requests
        .is_none());
}
#[test]
fn reservations_serialize_competing_requests_and_settle_once() {
    let db = database();
    conn(&db)
        .unwrap()
        .execute(
            "UPDATE hub_users SET budget='{\"requests\":1}' WHERE id='alice'",
            [],
        )
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
        .header("x-csrf-token", me["user"]["csrf"].as_str().unwrap())
        .json(&json!({"name":"device"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(created["key"].as_str().unwrap().starts_with("ccu_"));
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
