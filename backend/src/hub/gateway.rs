use super::*;
use crate::{app_config::AppType, database::Database, proxy::server::ProxyState};
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderValue, Method},
    middleware::Next,
    response::Response,
};
use futures::StreamExt;
use rusqlite::{params, OptionalExtension};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

static REQUEST_WORK: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(16);

/// Extensions are created after authentication, never accepted from HTTP headers.
#[derive(Clone)]
pub struct Authenticated {
    pub user_id: String,
    pub request_id: String,
}
#[derive(Clone)]
pub struct ForcedStack(pub crate::mode::stack::StackTarget);

pub async fn guard(State(state): State<ProxyState>, request: Request, next: Next) -> Response {
    if !auth::initialized(&state.db) {
        #[cfg(test)]
        return next.run(request).await;
        #[cfg(not(test))]
        return Error::unauthorized().into_response();
    }
    if request.uri().path() == "/health" {
        return next.run(request).await;
    }
    match run(state, request, next).await {
        Ok(r) => r,
        Err(e) => e.into_response(),
    }
}
async fn run(state: ProxyState, request: Request, next: Next) -> Result<Response> {
    let user = auth::authenticate(&state.db, request.headers(), true)?;
    if user.key_id.is_none() {
        return Err(Error::unauthorized());
    }
    let path = request.uri().path().to_owned();
    if request.method() == Method::GET {
        if path.ends_with("/models") || path == "/models" {
            let cat = catalog::export(&state.db, &user, true)?;
            let rows = cat["models"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| json!({"id":m["slug"],"object":"model","owned_by":"ccSwitchUint"}))
                .collect::<Vec<_>>();
            return Ok(Json(json!({"object":"list","data":rows})).into_response());
        }
        if path.ends_with("/responses") {
            return Ok((
                StatusCode::UPGRADE_REQUIRED,
                Json(json!({"error":{"code":"http_required","message":"请使用 HTTP Responses"}})),
            )
                .into_response());
        }
        return Err(Error::forbidden());
    }
    if request.method() != Method::POST {
        return Err(Error::bad("不支持的代理请求方法"));
    }
    let _permit = REQUEST_WORK
        .try_acquire()
        .map_err(|_| Error::limited("gateway_busy", "网关当前繁忙，请稍后重试"))?;
    let app = if path.ends_with("/messages") {
        AppType::Claude
    } else {
        AppType::Codex
    };
    if path.contains("gemini")
        || path.contains("v1beta")
        || path.contains("claude-desktop")
        || path.contains("grokbuild")
    {
        return Err(Error::bad(
            "共享聚合入口支持 Codex 和 Claude；其他客户端请使用对应聚合协议",
        ));
    }
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, 32 * 1024 * 1024)
        .await
        .map_err(|_| Error::bad("请求体超过限制或读取失败"))?;
    let mut body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| Error::bad("聚合请求必须使用 JSON 格式并包含模型 ID"))?;
    let original = body
        .get("model")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::bad("请求缺少模型 ID"))?
        .to_owned();
    let (key, model) = match crate::mode::stack::decode(&app, &original) {
        crate::mode::stack::Decoded::Stack { key, model, .. } => (key.to_owned(), model.to_owned()),
        _ => {
            return Err(Error::bad(
                "请选择带 ccs- 供应商标识的聚合模型；服务端没有默认供应商",
            ))
        }
    };
    if body
        .get("input")
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|i| i["type"] == "item_reference"))
    {
        return Err(Error::bad(
            "共享账号请求请发送完整历史，不支持无归属的 item_reference",
        ));
    }
    let pooled =
        app == AppType::Codex && key == auth::setting(&state.db, "officialPoolKey", "official");
    let previous = body
        .get("previous_response_id")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let affinity = if let Some(previous) = &previous {
        Some(conn(&state.db)?.query_row("SELECT resource_id FROM hub_affinity WHERE user_id=?1 AND response_id=?2 AND expires_at>?3",params![user.id,previous,now()],|r|r.get::<_,String>(0)).optional()?.ok_or_else(||Error(StatusCode::CONFLICT,"unknown_session_affinity","此响应 ID 不属于当前用户或已过期，请开启新会话或发送完整历史".into()))?)
    } else {
        None
    };
    let mut candidates = resources::all(&state.db)?
        .into_iter()
        .filter(|r| {
            r.app_type == app.as_str()
                && if pooled {
                    r.official
                } else {
                    r.route_key == key
                }
        })
        .filter(|r| affinity.as_ref().is_none_or(|a| a == &r.id))
        .filter(|r| resources::usable(&state.db, &user, r, &model).is_ok())
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Err(Error::forbidden());
    }
    candidates.sort_by_key(|r| (r.owner_id != user.id, r.last_used_at, r.id.clone()));
    if pooled {
        let c = conn(&state.db)?;
        candidates.retain(|r|r.cooldown_until<=now() && !["reauth_required","removed"].contains(&r.health.as_str()) && !c.query_row("SELECT EXISTS(SELECT 1 FROM hub_model_health WHERE resource_id=?1 AND model=?2 AND until_at>?3)",params![r.id,model,now()],|r|r.get::<_,bool>(0)).unwrap_or(true));
    }
    if candidates.is_empty() {
        return Err(Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "no_eligible_account",
            "当前没有获授权且可用的账号，请稍后重试或选择其他模型".into(),
        ));
    }
    // Bound the reservation window. It remains an estimate, not a tokenizer.
    let output = body
        .get("max_output_tokens")
        .or_else(|| body.get("max_completion_tokens"))
        .or_else(|| body.get("max_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(8192)
        .clamp(1, 131072);
    let input = ((bytes.len() as i64 + 2) / 3).min(2_000_000);
    let mut priced = Vec::new();
    let mut maximum_cost = 0;
    for r in candidates {
        let provider = state
            .db
            .get_provider_by_id(&r.provider_id, &r.app_type)?
            .ok_or_else(Error::forbidden)?;
        let price = metering::Price::load(&state.db, &model, &provider)?;
        let cost = price
            .as_ref()
            .and_then(|p| {
                p.cost(
                    app.as_str(),
                    &metering::Usage {
                        input,
                        output,
                        known: true,
                        ..Default::default()
                    }
                    .parsed(),
                )
            })
            .unwrap_or(0);
        maximum_cost = maximum_cost.max(cost);
        priced.push((r, provider, price, cost));
    }
    let user_budget: String = conn(&state.db)?.query_row(
        "SELECT budget FROM hub_users WHERE id=?1",
        [&user.id],
        |r| r.get(0),
    )?;
    if parse::<Budget>(&user_budget).credits.is_some()
        && priced.iter().any(|(_, _, p, _)| p.is_none())
    {
        return Err(Error::bad("该模型缺少定价，无法执行个人点数额度限制"));
    }
    let stream = body["stream"].as_bool().unwrap_or(false);
    let estimate = metering::Amount {
        requests: 1,
        tokens: input + output,
        credits: maximum_cost,
    };
    let request_id = metering::start(&state.db, &user, &original, app.as_str(), stream, estimate)?;
    let mut finish = Finalizer {
        db: state.db.clone(),
        request: request_id.clone(),
        attempt: None,
        status: 499,
        start: Instant::now(),
        usage: Default::default(),
        first: None,
        finished: false,
    };
    let mut last_error = None;
    for (r, provider, price, cost) in priced {
        let attempt = match metering::attempt(
            &state.db,
            &user,
            &request_id,
            &r,
            &model,
            metering::Amount {
                credits: cost,
                ..estimate
            },
            price.as_ref(),
        ) {
            Ok(a) => a,
            Err(e) => {
                if !pooled {
                    finish.status = e.0.as_u16();
                    finish.complete(true);
                    return Err(e);
                }
                last_error = Some(e);
                continue;
            }
        };
        finish.attempt = Some(attempt.clone());
        body["model"] = json!(catalog::encode(app.as_str(), &r.route_key, &model));
        // Server-side response references are tracked per consumer. New requests
        // still send complete history; do not let callers share stored objects.
        if app == AppType::Codex && previous.is_none() {
            body["store"] = json!(false);
        }
        let encoded = serde_json::to_vec(&body).map_err(|_| Error::bad("请求序列化失败"))?;
        let mut req = Request::new(Body::from(encoded));
        *req.method_mut() = parts.method.clone();
        *req.uri_mut() = parts.uri.clone();
        *req.version_mut() = parts.version;
        *req.headers_mut() = parts.headers.clone();
        *req.extensions_mut() = parts.extensions.clone();
        for name in [
            header::AUTHORIZATION,
            header::COOKIE,
            header::PROXY_AUTHORIZATION,
            header::CONTENT_LENGTH,
        ] {
            req.headers_mut().remove(name);
        }
        req.headers_mut().remove("x-api-key");
        req.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        req.extensions_mut().insert(Authenticated {
            user_id: user.id.clone(),
            request_id: request_id.clone(),
        });
        req.extensions_mut().insert(super::network::OutboundPolicy {
            allow_private: r.owner_id == "admin" || r.official,
        });
        req.extensions_mut()
            .insert(ForcedStack(crate::mode::stack::StackTarget {
                provider,
                upstream_model: model.clone(),
                original_model: original.clone(),
            }));
        let response = tokio::time::timeout(Duration::from_secs(600), next.clone().run(req))
            .await
            .map_err(|_| {
                Error(
                    StatusCode::GATEWAY_TIMEOUT,
                    "upstream_timeout",
                    "上游响应超时，请凭请求记录核对用量".into(),
                )
            })?;
        let status = response.status().as_u16();
        finish.status = status;
        if !(200..300).contains(&status) {
            let retry_seconds = response
                .headers()
                .get(header::RETRY_AFTER)
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(60)
                .clamp(1, 86400);
            let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
                .await
                .unwrap_or_default();
            let mut error_usage = metering::Usage::default();
            if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                error_usage.observe(&v);
            }
            let text = String::from_utf8_lossy(&bytes).to_lowercase();
            let code = if status == 401 && (text.contains("refresh") || text.contains("重新登录"))
            {
                "reauth_required"
            } else if status == 403 {
                "model_not_entitled"
            } else if status == 429 {
                "upstream_rate_or_quota_limit"
            } else {
                "upstream_error"
            };
            if r.official {
                let c = conn(&state.db)?;
                if code == "reauth_required" {
                    c.execute(
                        "UPDATE hub_resources SET health='reauth_required' WHERE id=?1",
                        [&r.id],
                    )?;
                } else if status == 403 {
                    c.execute("INSERT OR REPLACE INTO hub_model_health(resource_id,model,until_at,reason) VALUES(?1,?2,?3,?4)",params![r.id,model,now()+3600,code])?;
                } else if status == 429 || status == 401 {
                    c.execute(
                        "UPDATE hub_resources SET health=?1,cooldown_until=?2 WHERE id=?3",
                        params![code, now() + retry_seconds, r.id],
                    )?;
                }
            }
            if pooled
                && previous.is_none()
                && matches!(status, 401 | 403 | 429)
                && !error_usage.known
            {
                metering::retry(&state.db, &request_id, &attempt, status, code)?;
                finish.attempt = None;
                last_error = Some(Error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    code,
                    "官方账号暂不可用，已尝试其他获授权账号".into(),
                ));
                continue;
            }
            finish.usage = error_usage;
            finish.complete(status < 500);
            return Err(Error(
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                code,
                format!("上游请求失败；请求编号：{request_id}。账号持有者可在资源页检查状态。"),
            ));
        }
        conn(&state.db)?.execute(
            "UPDATE hub_resources SET health='ready',cooldown_until=0 WHERE id=?1",
            [&r.id],
        )?;
        let (mut response_parts, response_body) = response.into_parts();
        response_parts.headers.remove(header::SET_COOKIE);
        response_parts.headers.remove(header::CONTENT_LENGTH);
        response_parts.headers.insert(
            "x-ccswitch-request-id",
            HeaderValue::from_str(&request_id).map_err(|_| Error::bad("无效请求编号"))?,
        );
        response_parts
            .headers
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        let sse = response_parts
            .headers
            .get(header::CONTENT_TYPE)
            .and_then(|h| h.to_str().ok())
            .is_some_and(|s| s.contains("text/event-stream"));
        let observed = async_stream::stream! {
            let mut chunks=response_body.into_data_stream();let mut buffer=Vec::new();let mut terminal=false;let mut readable=true;
            loop {
                match tokio::time::timeout(Duration::from_secs(180),chunks.next()).await {
                    Ok(Some(Ok(chunk)))=>{
                        if buffer.len()+chunk.len()<16*1024*1024 {buffer.extend_from_slice(&chunk);}else{readable=false;buffer.clear();}
                        if sse && readable {
                            while let Some(newline)=buffer.iter().position(|b|*b==b'\n') {
                                let line=buffer.drain(..=newline).collect::<Vec<_>>();
                                let line=String::from_utf8_lossy(&line);
                                if let Some(data)=line.trim().strip_prefix("data:") {
                                    if data.trim()=="[DONE]" {terminal=true;continue;}
                                    if let Ok(v)=serde_json::from_str::<Value>(data.trim()) {
                                        let kind=v["type"].as_str().unwrap_or("");
                                        if matches!(kind,"response.completed"|"response.failed"|"message_stop"){terminal=true;}
                                        if finish.first.is_none() && !matches!(kind,"response.created"|"response.in_progress"|"ping") {finish.first=Some(finish.start.elapsed().as_millis() as i64);}
                                        finish.usage.observe(&v);
                                    }
                                }
                            }
                        }
                        yield Ok::<_,std::io::Error>(chunk);
                    }
                    Ok(Some(Err(_)))|Err(_)=>{yield Err(std::io::Error::other("上游流中断或超时"));break;}
                    Ok(None)=>{
                        if !sse && readable {if let Ok(v)=serde_json::from_slice::<Value>(&buffer){finish.usage.observe(&v);terminal=true;}}
                        finish.complete(terminal && readable);break;
                    }
                }
            }
        };
        return Ok(Response::from_parts(
            response_parts,
            Body::from_stream(observed),
        ));
    }
    finish.status = 503;
    finish.complete(true);
    Err(last_error.unwrap_or_else(|| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "no_eligible_account",
            "没有可用账号或分配额度".into(),
        )
    }))
}
struct Finalizer {
    db: Arc<Database>,
    request: String,
    attempt: Option<String>,
    status: u16,
    start: Instant,
    usage: metering::Usage,
    first: Option<i64>,
    finished: bool,
}
impl Finalizer {
    fn complete(&mut self, complete: bool) {
        if self.finished {
            return;
        }
        match metering::finish(
            &self.db,
            &self.request,
            self.attempt.as_deref(),
            self.status,
            &self.usage,
            self.start.elapsed().as_millis() as i64,
            self.first,
            complete,
        ) {
            Ok(()) => self.finished = true,
            Err(e) => log::error!("[unit-meter] request={} code={}", self.request, e.1),
        }
    }
}
impl Drop for Finalizer {
    fn drop(&mut self) {
        if !self.finished {
            self.complete(false);
        }
    }
}
