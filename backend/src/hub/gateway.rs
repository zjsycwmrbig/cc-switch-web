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

fn compact_upstream_detail(value: &str) -> Option<String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = value.trim();
    if value.is_empty()
        || value.starts_with('<')
        || value.to_ascii_lowercase().contains("<!doctype html")
    {
        return None;
    }
    let mut chars = value.chars();
    let compact = chars.by_ref().take(240).collect::<String>();
    Some(if chars.next().is_some() {
        format!("{compact}…")
    } else {
        compact
    })
}

fn upstream_error_detail(bytes: &[u8]) -> Option<String> {
    if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
        for candidate in [
            value.pointer("/error/message"),
            value.get("message"),
            value.get("detail"),
            value.pointer("/error/detail"),
        ]
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        {
            if let Some(detail) = compact_upstream_detail(candidate) {
                return Some(detail);
            }
        }
    }
    compact_upstream_detail(&String::from_utf8_lossy(bytes))
}

fn upstream_error_code(status: u16, text: &str) -> &'static str {
    if status == 401 && (text.contains("refresh") || text.contains("重新登录")) {
        "reauth_required"
    } else if status == 400
        && text.contains("model is not supported when using codex with a chatgpt account")
    {
        "official_model_not_supported"
    } else {
        match status {
            400 => "upstream_bad_request",
            401 => "upstream_auth_failed",
            403 => "model_not_entitled",
            404 => "upstream_endpoint_not_found",
            408 | 504 => "upstream_timeout",
            409 => "upstream_conflict",
            413 => "upstream_payload_too_large",
            422 => "upstream_invalid_parameters",
            429 => "upstream_rate_or_quota_limit",
            500..=599 => "upstream_server_error",
            _ => "upstream_error",
        }
    }
}

fn upstream_failure_message(
    provider: &str,
    model: &str,
    status: u16,
    code: &str,
    detail: Option<&str>,
    retry_seconds: i64,
    request_id: &str,
) -> String {
    let suffix = detail
        .map(|detail| format!("：{detail}"))
        .unwrap_or_default();
    match code {
        "official_model_not_supported" => format!(
            "官方账号不支持模型 {model}，已暂停该模型 24 小时；请求编号：{request_id}"
        ),
        "reauth_required" => format!(
            "供应商 {provider} 的登录授权已失效，需要账号持有者重新登录；请求编号：{request_id}{suffix}"
        ),
        "upstream_auth_failed" => format!(
            "供应商 {provider} 认证失败（HTTP {status}），请检查 API Key；请求编号：{request_id}{suffix}"
        ),
        "model_not_entitled" => format!(
            "供应商 {provider} 拒绝访问模型 {model}（HTTP 403），请检查账号权限；请求编号：{request_id}{suffix}"
        ),
        "upstream_endpoint_not_found" => format!(
            "供应商 {provider} 不存在对应接口或模型（HTTP 404）；请求编号：{request_id}{suffix}"
        ),
        "upstream_timeout" => format!(
            "供应商 {provider} 响应超时（HTTP {status}）；请求编号：{request_id}{suffix}"
        ),
        "upstream_payload_too_large" => format!(
            "供应商 {provider} 拒绝过大的请求体（HTTP 413）；请压缩上下文；请求编号：{request_id}{suffix}"
        ),
        "upstream_invalid_parameters" => format!(
            "供应商 {provider} 认为请求参数无效（HTTP 422）；请求编号：{request_id}{suffix}"
        ),
        "upstream_rate_or_quota_limit" => format!(
            "供应商 {provider} 触发限流或额度不足（HTTP 429），建议 {retry_seconds} 秒后重试；请求编号：{request_id}{suffix}"
        ),
        "upstream_server_error" => format!(
            "供应商 {provider} 服务异常（HTTP {status}），请稍后重试；请求编号：{request_id}{suffix}"
        ),
        "upstream_bad_request" => format!(
            "供应商 {provider} 拒绝了请求（HTTP 400）；请求编号：{request_id}{suffix}"
        ),
        _ => format!(
            "供应商 {provider} 请求失败（HTTP {status}）；请求编号：{request_id}{suffix}"
        ),
    }
}

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
                Json(json!({"error":{"code":"http_required","message":"共享入口仅接受 HTTP POST Responses 请求；请将 base_url 配置到 /v1 并使用 responses 协议"}})),
            )
                .into_response());
        }
        return Err(Error::forbidden());
    }
    if request.method() != Method::POST {
        return Err(Error::bad_code(
            "unsupported_method",
            "共享聚合入口只支持 POST；模型列表请使用 GET /v1/models",
        ));
    }
    let _permit = REQUEST_WORK
        .try_acquire()
        .map_err(|_| {
            Error::limited(
                "gateway_busy",
                "中转网关并发已满（同时最多处理 16 个请求），请稍后重试",
            )
        })?;
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
        return Err(Error::bad_code(
            "unsupported_endpoint",
            "当前端点只支持 Codex /v1/responses 和 Claude /v1/messages；Gemini、Claude Desktop、Grok Build 请使用各自协议入口",
        ));
    }
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, 32 * 1024 * 1024)
        .await
        .map_err(|_| {
            Error::too_large(
                "request_body_too_large",
                "请求体超过 32 MiB，或读取过程中连接中断；请压缩历史后重试",
            )
        })?;
    let mut body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| {
            Error::bad_code(
                "invalid_json",
                "请求体不是有效 JSON；请检查 Responses 请求格式",
            )
        })?;
    let original = body
        .get("model")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            Error::bad_code("missing_model", "请求缺少字符串类型的 model 字段")
        })?
        .to_owned();
    let (key, model) = match crate::mode::stack::decode(&app, &original) {
        crate::mode::stack::Decoded::Stack { key, model, .. } => (key.to_owned(), model.to_owned()),
        _ => {
            return Err(Error::bad_code(
                "invalid_model_id",
                "model 必须是 ccs-<供应商>/<模型> 或 ccs-auto/<模型> 形式的聚合模型 ID",
            ))
        }
    };
    if body
        .get("input")
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|i| i["type"] == "item_reference"))
    {
        return Err(Error::bad_code(
            "item_reference_not_supported",
            "共享账号请求必须携带完整历史；当前不支持 item_reference，请重新开启会话或发送完整 input",
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
    let auto_targets = if key == "auto" {
        let route = super::api::list_model_routes(&state.db, &user.id)?
            .into_iter()
            .find(|row| {
                row["model"].as_str() == Some(model.as_str())
                    && row["enabled"].as_bool().unwrap_or(false)
                    && row["auto"].as_bool().unwrap_or(false)
            })
            .ok_or_else(|| {
                Error::not_found(
                    "auto_route_not_found",
                    format!(
                        "未找到模型 {model} 的自动路由映射；请先在“模型与接入”中保存，或同步最新模型目录"
                    ),
                )
            })?;
        Some(
            route["targets"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        )
    } else {
        None
    };
    let mut candidates: Vec<resources::Resource> = Vec::new();
    let mut reasons: Vec<Error> = Vec::new();
    let mut matched = 0usize;
    for r in resources::all(&state.db)?
        .into_iter()
        .filter(|r| {
            r.app_type == app.as_str()
                && match &auto_targets {
                    Some(targets) => targets.contains(&r.id),
                    None => {
                        if pooled {
                            r.official
                        } else {
                            r.route_key == key
                        }
                    }
                }
        })
    {
        if affinity.as_ref().is_some_and(|a| a != &r.id) {
            continue;
        }
        matched += 1;
        // 逐个记录失败原因，鉴权失败时直接把原因回给客户端。
        match resources::usable(&state.db, &user, &r, &model) {
            Ok(_) => candidates.push(r),
            Err(error) => reasons.push(error),
        }
    }
    if candidates.is_empty() {
        let (code, message) = match reasons.into_iter().next() {
            Some(Error(_, code, message)) => (code, message),
            None => (
                "model_unavailable",
                format!("没有可用的供应商提供模型 {model}"),
            ),
        };
        return Err(if auto_targets.is_some() {
            Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "no_eligible_account",
                format!("自动路由组里没有可用供应商：{message}"),
            )
        } else if matched == 0 {
            Error::denied(
                code,
                format!("{message}（供应商可能已下架或不在你的授权范围内）"),
            )
        } else {
            Error::denied(code, message)
        });
    }
    match &auto_targets {
        // 自动路由严格按用户设置的顺序尝试。
        Some(targets) => candidates.sort_by_key(|r| {
            targets
                .iter()
                .position(|target| target == &r.id)
                .unwrap_or(usize::MAX)
        }),
        None => candidates.sort_by_key(|r| (r.owner_id != user.id, r.last_used_at, r.id.clone())),
    }
    if pooled {
        let c = conn(&state.db)?;
        candidates.retain(|r|r.cooldown_until<=now() && !["reauth_required","removed"].contains(&r.health.as_str()) && !c.query_row("SELECT EXISTS(SELECT 1 FROM hub_model_health WHERE resource_id=?1 AND model=?2 AND until_at>?3)",params![r.id,model,now()],|r|r.get::<_,bool>(0)).unwrap_or(true));
    }
    if candidates.is_empty() {
        return Err(Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "no_eligible_account",
            format!(
                "模型 {model} 当前没有获授权且可用的账号；请检查供应商状态、共享额度和模型可见范围"
            ),
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
            .ok_or_else(|| {
                Error::unavailable(
                    "provider_config_missing",
                    format!(
                        "供应商 {} 的底层配置已删除；请让提供者重新保存该供应商后再试",
                        r.name
                    ),
                )
            })?;
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
        return Err(Error::bad_code(
            "pricing_missing",
            format!("模型 {model} 缺少定价，无法计算个人点数额度；请管理员在“成本定价”中补齐"),
        ));
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
        // 同一路由可能匹配不同供应商的不同原始 slug，转发前解析成该供应商的实际模型名。
        let upstream_model = resources::match_model_slug(&r, &model).unwrap_or_else(|| model.clone());
        let attempt = match metering::attempt(
            &state.db,
            &user,
            &request_id,
            &r,
            &upstream_model,
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
        body["model"] = json!(catalog::encode(app.as_str(), &r.route_key, &upstream_model));
        // Server-side response references are tracked per consumer. New requests
        // still send complete history; do not let callers share stored objects.
        if app == AppType::Codex && previous.is_none() {
            body["store"] = json!(false);
        }
        let encoded = serde_json::to_vec(&body).map_err(|_| {
            Error::internal(
                "serialization_failed",
                "转换后的上游请求无法序列化；请将请求编号反馈给管理员",
            )
        })?;
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
                upstream_model: upstream_model.clone(),
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
            let detail = upstream_error_detail(&bytes);
            let code = upstream_error_code(status, &text);
            if r.official {
                let c = conn(&state.db)?;
                if code == "reauth_required" {
                    c.execute(
                        "UPDATE hub_resources SET health='reauth_required' WHERE id=?1",
                        [&r.id],
                    )?;
                } else if status == 403 || code == "official_model_not_supported" {
                    let seconds = if code == "official_model_not_supported" {
                        86400
                    } else {
                        3600
                    };
                    c.execute("INSERT OR REPLACE INTO hub_model_health(resource_id,model,until_at,reason) VALUES(?1,?2,?3,?4)",params![r.id,model,now()+seconds,code])?;
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
                upstream_failure_message(
                    &r.name,
                    &upstream_model,
                    status,
                    code,
                    detail.as_deref(),
                    retry_seconds,
                    &request_id,
                ),
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
            HeaderValue::from_str(&request_id).map_err(|_| {
                Error::internal(
                    "request_id_invalid",
                    "服务生成的请求编号无效；请联系管理员检查服务日志",
                )
            })?,
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
