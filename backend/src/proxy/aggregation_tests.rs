use super::handler_context::RequestContext;
use super::server::ProxyState;
use crate::app_config::AppType;
use crate::provider::Provider;
use axum::http::{Extensions, HeaderMap};
use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use serde_json::json;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
struct Upstream {
    replies: Arc<Mutex<VecDeque<StatusCode>>>,
    requests: Arc<Mutex<Vec<Value>>>,
}

async fn receive(State(up): State<Upstream>, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    up.requests.lock().await.push(body);
    let status = up.replies.lock().await.pop_front().unwrap();
    let body = if status.is_success() {
        json!({"id":"test","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}})
    } else if status == StatusCode::BAD_REQUEST {
        json!({"error":{"message":"messages.1.content.0: Invalid `signature` in `thinking` block"}})
    } else {
        json!({"error":{"message":"upstream unavailable"}})
    };
    (status, Json(body))
}

#[tokio::test]
#[serial_test::serial]
async fn aggregation_preserves_model_and_routing_state_on_success_failure_and_retry() {
    let _home = crate::mode::controller::tests::Fixture::new();
    for replies in [
        vec![StatusCode::OK],
        vec![StatusCode::BAD_GATEWAY],
        vec![StatusCode::BAD_REQUEST, StatusCode::OK],
    ] {
        let expected = replies.len();
        let success = replies.last().unwrap().is_success();
        let up = Upstream {
            replies: Arc::new(Mutex::new(replies.into())),
            requests: Arc::new(Mutex::new(Vec::new())),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let router = Router::new()
            .route("/v1/messages", post(receive))
            .with_state(up.clone());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let state = ProxyState::for_test(Arc::new(crate::database::Database::memory().unwrap()));
        let provider = Provider::with_id(
            "member".into(),
            "Member".into(),
            json!({"env":{
                "ANTHROPIC_BASE_URL":format!("http://127.0.0.1:{port}"),
                "ANTHROPIC_AUTH_TOKEN":"test-key", "ANTHROPIC_MODEL":"wrong-default"
            }}),
            None,
        );
        state.db.save_provider("claude", &provider).unwrap();
        let before = serde_json::to_value(state.status.read().await.clone()).unwrap();
        let body = json!({"model":"chosen-model", "max_tokens":32,"messages":[
            {"role":"user","content":"hello"},
            {"role":"assistant","content":[{"type":"thinking","thinking":"test", "signature":"old"}]},
            {"role":"user","content":"continue"}
        ]});
        let ctx = RequestContext::new_with_stack(
            &state,
            &body,
            &HeaderMap::new(),
            AppType::Claude,
            "Claude",
            "claude",
            Some(crate::mode::stack::StackTarget {
                provider,
                upstream_model: "chosen-model".into(),
                original_model: "ccs-claude-member--chosen-model".into(),
            }),
        )
        .await
        .unwrap();
        let result = ctx
            .create_forwarder(&state)
            .forward_with_retry(
                &AppType::Claude,
                "/v1/messages",
                body,
                HeaderMap::new(),
                Extensions::new(),
                ctx.get_providers(),
            )
            .await;
        assert_eq!(result.is_ok(), success);
        let requests = up.requests.lock().await;
        assert_eq!(requests.len(), expected);
        assert!(requests.iter().all(|body| body["model"] == "chosen-model"));
        if expected == 2 {
            assert!(!requests[1].to_string().contains("\"signature\""));
        }
        assert_eq!(
            serde_json::to_value(state.status.read().await.clone()).unwrap(),
            before
        );
        assert!(state.current_providers.read().await.is_empty());
        assert_eq!(state.db.get_current_provider("claude").unwrap(), None);
        task.abort();
    }
}
