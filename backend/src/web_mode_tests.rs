use super::*;

#[tokio::test]
#[serial_test::serial]
async fn mode_http_round_trip_keeps_direct_pointer_and_validates_modes() {
    let fixture = crate::mode::controller::tests::Fixture::new();
    let state = Arc::new(fixture.state.clone());
    for id in ["a", "b"] {
        let row = Provider::with_id(
            id.into(),
            id.into(),
            json!({"env":{"ANTHROPIC_AUTH_TOKEN":"test-key","ANTHROPIC_BASE_URL":"https://example.invalid","ANTHROPIC_MODEL":"claude-sonnet-4-6"}}),
            None,
        );
        state.db.save_provider("claude", &row).unwrap();
    }
    crate::services::provider::ProviderService::switch(&state, AppType::Claude, "a").unwrap();
    let mut config = state.db.get_global_proxy_config().await.unwrap();
    config.listen_port = 0;
    state.db.update_global_proxy_config(config).await.unwrap();
    let web = WebApiState {
        app_state: state.clone(),
        copilot_auth_state: state.copilot_auth_state.clone(),
        codex_oauth_state: state.codex_oauth_state.clone(),
        xai_oauth_state: state.xai_oauth_state.clone(),
        access_key: WebAccessKey::new(None).unwrap(),
    };
    let app = Router::new()
        .route("/apps/:app/mode", get(get_app_mode).put(set_app_mode))
        .route("/apps/:app/aggregation/:id", put(set_aggregation_member))
        .with_state(web);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .put(format!("{url}/apps/claude/mode"))
        .json(&json!({"mode":"aggregation","routeProviderId":"b"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let view: Value = client
        .get(format!("{url}/apps/claude/mode"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(view["mode"], "aggregation");
    assert_eq!(view["directProviderId"], "a");
    assert_eq!(view["routeProviderId"], "b");
    assert_eq!(view["eligibleProviderIds"].as_array().unwrap().len(), 2);
    let response = client
        .put(format!("{url}/apps/claude/aggregation/a"))
        .json(&json!({"enabled":true}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let response = client
        .put(format!("{url}/apps/claude/mode"))
        .json(&json!({"mode":"unknown"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        state.db.get_current_provider("claude").unwrap().as_deref(),
        Some("a")
    );
    let response = client
        .put(format!("{url}/apps/claude/mode"))
        .json(&json!({"mode":"direct"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(!state.proxy_service.is_running().await);
    server.abort();
    let _ = server.await;
}
