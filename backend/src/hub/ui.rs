//! Compatibility endpoints for the original CC Switch interface.
//! User identity and resource ownership are enforced here, independently of disabled UI controls.
use super::*;
use crate::{provider::Provider, store::AppState};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Router,
};
use rusqlite::{params, OptionalExtension};
use std::sync::Arc;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/unit/ui/providers/:app", get(providers))
        .route("/api/unit/ui/library/:app", get(library))
        .route("/api/unit/ui/providers/:app/save", post(save_provider))
        .route("/api/unit/ui/mode/:app", get(mode))
        .route("/api/unit/ui/status", get(status))
        .route("/api/unit/ui/settings", get(settings).put(save_settings))
        .route("/api/unit/ui/usage/request-logs", post(request_logs))
        .route("/api/unit/ui/usage/request-logs/:id", get(request_detail))
        .route("/api/unit/ui/usage/:kind", get(usage))
        .route(
            "/api/unit/ui/library/:app/:id/usage",
            get(library_usage).post(test_library_usage_script),
        )
        .route("/api/unit/ui/accounts/:id/models", get(account_models))
}
fn visible(db: &crate::database::Database, user: &Identity, r: &resources::Resource) -> bool {
    r.owner_id == user.id || user.admin() || resources::grant(db, user, r, None).is_ok()
}
async fn providers(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
) -> Result<Json<Value>> {
    let mut rows = serde_json::Map::new();
    for r in resources::all(&app.db)?
        .into_iter()
        .filter(|r| r.app_type == kind && visible(&app.db, &user, r))
    {
        let Some(p) = app.db.get_provider_by_id(&r.provider_id, &r.app_type)? else {
            continue;
        };
        let mut value = if r.owner_id == user.id {
            serde_json::to_value(&p).map_err(|_| Error::bad("供应商配置读取失败"))?
        } else {
            json!({"id":p.id,"name":p.name,"settingsConfig":{},"icon":p.icon,"iconColor":p.icon_color,"category":p.category})
        };
        value["unitResource"] = resources::safe_view(&app.db, &user, &r);
        rows.insert(p.id, value);
    }
    Ok(Json(json!({"providers":rows,"currentProviderId":""})))
}
/// 供应商库卡片上的余额/用量查询（官方号是套餐用量，其他供应商是余额）。
async fn library_usage(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path((kind, resource)): Path<(String, String)>,
) -> Result<Json<Value>> {
    use std::str::FromStr;
    let r = resources::get(&app.db, &resource)?;
    let publicly_usable = r.published && !r.disabled;
    if r.app_type != kind || !(visible(&app.db, &user, &r) || publicly_usable) {
        return Err(Error::forbidden());
    }
    // 官方账号没有 usage_script，用授权中心的订阅配额（5h/周额度）代替。
    if r.official {
        if let Some(account) = r.account_id.clone() {
            match crate::commands::get_codex_oauth_quota_internal(
                Some(account),
                &app.codex_oauth_state,
            )
            .await
            {
                Ok(quota) if quota.success => {
                    let data = quota
                        .tiers
                        .iter()
                        .map(|tier| {
                            json!({
                                "planName": tier.name,
                                "used": tier.utilization,
                                "remaining": (100.0 - tier.utilization).max(0.0),
                                "total": 100.0,
                                "unit": "%",
                                "extra": tier.resets_at,
                            })
                        })
                        .collect::<Vec<_>>();
                    return Ok(Json(json!({"success": true, "data": data})));
                }
                Ok(quota) => {
                    return Ok(Json(json!({
                        "success": false,
                        "error": quota.error.unwrap_or_else(|| "官方账号用量不可用".into()),
                    })))
                }
                Err(error) => return Ok(Json(json!({"success": false, "error": error}))),
            }
        }
    }
    let app_type =
        crate::app_config::AppType::from_str(&kind).map_err(|_| Error::bad("未知应用类型"))?;
    match crate::commands::query_provider_usage_internal(
        &app,
        &app.copilot_auth_state,
        app_type,
        &r.provider_id,
    )
    .await
    {
        Ok(result) => Ok(Json(serde_json::to_value(result).unwrap_or_else(
            |_| json!({"success": false, "error": "用量结果序列化失败"}),
        ))),
        Err(error) => Ok(Json(json!({"success": false, "error": format!("{error}")}))),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestLibraryUsageScript {
    script_code: String,
    timeout: Option<u64>,
    api_key: Option<String>,
    base_url: Option<String>,
    access_token: Option<String>,
    user_id: Option<String>,
    template_type: Option<String>,
}

/// 脚本测试只允许资源的提供者或管理员执行。
///
/// 请求体里可以携带任意脚本，不能把该能力开放给供应商市场的普通访问者。
async fn test_library_usage_script(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path((kind, resource)): Path<(String, String)>,
    Json(payload): Json<TestLibraryUsageScript>,
) -> Result<Json<Value>> {
    use std::str::FromStr;
    let r = resources::get(&app.db, &resource)?;
    if r.app_type != kind || (r.owner_id != user.id && !user.admin()) {
        return Err(Error::forbidden());
    }
    let app_type =
        crate::app_config::AppType::from_str(&kind).map_err(|_| Error::bad("未知应用类型"))?;
    match crate::commands::test_usage_script_internal(
        &app,
        app_type,
        &r.provider_id,
        &payload.script_code,
        payload.timeout,
        payload.api_key.as_deref(),
        payload.base_url.as_deref(),
        payload.access_token.as_deref(),
        payload.user_id.as_deref(),
        payload.template_type.as_deref(),
    )
    .await
    {
        Ok(result) => Ok(Json(serde_json::to_value(result).unwrap_or_else(
            |_| json!({"success": false, "error": "用量结果序列化失败"}),
        ))),
        Err(error) => Ok(Json(json!({"success": false, "error": format!("{error}")}))),
    }
}

/// 供应商库：平台上所有用户已发布（上传）的供应商，用于跨用户浏览与识别归属。
async fn library(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
) -> Result<Json<Value>> {
    let mut rows = serde_json::Map::new();
    for r in resources::all(&app.db)?
        .into_iter()
        .filter(|r| r.app_type == kind && r.published)
    {
        let Some(p) = app.db.get_provider_by_id(&r.provider_id, &r.app_type)? else {
            continue;
        };
        let mut value = if r.owner_id == user.id {
            serde_json::to_value(&p).map_err(|_| Error::bad("供应商配置读取失败"))?
        } else {
            json!({"id":p.id,"name":p.name,"settingsConfig":{},"icon":p.icon,"iconColor":p.icon_color,"category":p.category})
        };
        let mut view = resources::safe_view(&app.db, &user, &r);
        // 供应商库里展示的是“对外可见”的模型数量，而不是本人的可用模型。
        view["modelCount"] = json!(resources::visible_models(&r).len());
        // 近 7 天该供应商的实际用量（所有用户合计），用于市场卡片展示。
        let (requests, tokens, cost): (i64, i64, i64) = conn(&app.db)?.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(input_tokens+output_tokens+cache_read_tokens+cache_creation_tokens),0),
                    COALESCE(SUM(cost_credits),0)
             FROM hub_requests WHERE resource_id=?1 AND created_at>=?2",
            params![r.id, now() - 7 * 86400],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        view["usage7d"] = json!({"requests":requests,"tokens":tokens,"costCredits":cost});
        view["accessible"] = json!(visible(&app.db, &user, &r));
        let my_application: Option<String> = conn(&app.db)?
            .query_row(
                "SELECT state FROM hub_applications WHERE resource_id=?1 AND applicant_id=?2
                 ORDER BY created_at DESC LIMIT 1",
                params![r.id, &user.id],
                |row| row.get(0),
            )
            .optional()?;
        view["myApplication"] = json!(my_application);
        value["unitResource"] = view;
        rows.insert(p.id, value);
    }
    Ok(Json(json!({"providers": rows})))
}
async fn mode(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
) -> Result<Json<Value>> {
    let rows = resources::all(&app.db)?
        .into_iter()
        .filter(|r| r.app_type == kind && visible(&app.db, &user, r))
        .collect::<Vec<_>>();
    let members=rows.iter().filter(|r|r.published && !r.disabled).map(|r|json!({"providerId":r.provider_id,"modelIds":r.models.iter().filter_map(|m|m["slug"].as_str()).collect::<Vec<_>>(),"route":false})).collect::<Vec<_>>();
    Ok(Json(
        json!({"mode":"aggregation","attached":true,"directProviderId":null,"routeProviderId":null,"eligibleProviderIds":rows.iter().filter(|r|r.owner_id==user.id && !r.disabled).map(|r|&r.provider_id).collect::<Vec<_>>(),"aggregation":{"active":true,"members":members}}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveProvider {
    provider: Provider,
    add: bool,
    base_config: Option<Value>,
    #[serde(default)]
    models: Option<Vec<Value>>,
}
async fn save_provider(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
    Json(v): Json<SaveProvider>,
) -> Result<Json<Value>> {
    let previous = if v.add {
        None
    } else {
        Some(
            resources::all(&app.db)?
                .into_iter()
                .find(|r| r.provider_id == v.provider.id && r.app_type == kind)
                .ok_or_else(Error::forbidden)?,
        )
    };
    if let Some(r) = &previous {
        resources::own(&user, r)?;
    }
    let config = v.provider.settings_config.clone();
    let models = v
        .models
        .as_ref()
        .map(|rows| {
            rows.iter()
                .filter_map(|m| {
                    m.get("slug")
                        .or_else(|| m.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect::<Vec<_>>()
        })
        .or_else(|| {
            previous.as_ref().map(|r| {
                r.models
                    .iter()
                    .filter_map(|m| m["slug"].as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
        })
        .unwrap_or_default();
    let input = serde_json::from_value::<api::ResourceInput>(json!({
        "name":v.provider.name,"appType":kind,"settingsConfig":config,
        "apiFormat":v.provider.meta.as_ref().and_then(|m|m.api_format.clone()),
        "models":models,"policy":previous.as_ref().map(|r|r.policy.clone()).unwrap_or_default(),
        "modelRows":v.models,
        "provider":v.provider,"baseConfig":v.base_config,
    }))
    .map_err(|_| Error::bad("供应商表单数据无效"))?;
    let resource_id =
        api::save_resource_impl(&app, &user, previous.as_ref().map(|r| r.id.as_str()), input)
            .await?;
    if v.add {
        if let Some(id) = resource_id.get("id").and_then(Value::as_str) {
            if let Ok(resource) = resources::get(&app.db, id) {
                if let Err(error) = catalog::refresh(&app, &user, &resource).await {
                    audit(
                        &app.db,
                        &user.id,
                        "models.initial_refresh_failed",
                        id,
                        json!({"error":error.2}),
                    )?;
                }
            }
        }
    }
    Ok(Json(json!(true)))
}
async fn status(State(app): State<Arc<AppState>>) -> Result<Json<Value>> {
    let status = crate::commands::get_proxy_status_internal(&app)
        .await
        .map_err(|_| Error::bad("代理状态暂不可用"))?;
    Ok(Json(
        json!({"running":status.running,"address":status.address,"port":status.port}),
    ))
}
async fn settings(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    let mut v = serde_json::to_value(crate::settings::AppSettings::default())
        .map_err(|_| Error::bad("设置读取失败"))?;
    if let Some(personal) = catalog::preferences(&app.db, &user)?
        .get("uiSettings")
        .and_then(Value::as_object)
    {
        for key in ["language", "visibleApps"] {
            if let Some(value) = personal.get(key) {
                v[key] = value.clone();
            }
        }
    }
    v["firstRunNoticeConfirmed"] = json!(true);
    v["showProfileSwitcher"] = json!(false);
    v["sessionAutoSyncEnabled"] = json!(false);
    Ok(Json(v))
}
async fn save_settings(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let mut prefs = catalog::preferences(&app.db, &user)?;
    let mut personal = serde_json::Map::new();
    for key in ["language", "visibleApps"] {
        if let Some(value) = v.get(key) {
            personal.insert(key.to_owned(), value.clone());
        }
    }
    prefs["uiSettings"] = json!(personal);
    conn(&app.db)?.execute("INSERT INTO hub_preferences(user_id,value) VALUES(?1,?2) ON CONFLICT(user_id) DO UPDATE SET value=?2",params![user.id,json_text(&prefs)])?;
    Ok(Json(json!(true)))
}
async fn account_models(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(account): Path<String>,
) -> Result<Json<Value>> {
    let owned:bool=conn(&app.db)?.query_row("SELECT EXISTS(SELECT 1 FROM hub_account_owners WHERE account_id=?1 AND owner_id=?2 AND auth_provider='codex_oauth')",params![account,user.id],|r|r.get(0))?;
    if !owned {
        return Err(Error::forbidden());
    }
    let models =
        crate::commands::fetch_codex_oauth_models_internal(Some(account), &app.codex_oauth_state)
            .await
            .map_err(|_| Error::bad("模型读取失败，请检查官方账号登录状态"))?;
    Ok(Json(json!(models)))
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct UsageFilter {
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<String>,
    username: Option<String>,
    provider_name: Option<String>,
    model: Option<String>,
    status_code: Option<i64>,
    scope: Option<String>,
}
fn filtered(user: &Identity, q: &UsageFilter) -> Result<(String, Vec<rusqlite::types::Value>)> {
    let mut sql = "r.created_at>=? AND r.created_at<=?".to_string();
    let mut args = vec![
        q.start_date.unwrap_or(0).into(),
        q.end_date.unwrap_or(now()).into(),
    ];
    match q.scope.as_deref().unwrap_or("mine") {
        "mine" => {
            sql.push_str(" AND r.user_id=?");
            args.push(user.id.clone().into());
        }
        "provided" => {
            sql.push_str(" AND r.owner_id=?");
            args.push(user.id.clone().into());
        }
        "all" if user.admin() => {}
        _ => return Err(Error::forbidden()),
    }
    if let Some(value) = q
        .app_type
        .as_ref()
        .filter(|value| !value.is_empty() && *value != "all")
    {
        sql.push_str(" AND r.app_type=?");
        args.push(value.clone().into());
    }
    if let Some(value) = q
        .provider_name
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        sql.push_str(
            " AND (LOWER(COALESCE(owner.username,r.owner_name,'')) LIKE LOWER(?) OR LOWER(COALESCE(r.provider_name,'')) LIKE LOWER(?))",
        );
        let pattern = format!("%{}%", value.trim());
        args.push(pattern.clone().into());
        args.push(pattern.into());
    }
    if let Some(value) = q.model.as_ref().filter(|value| !value.trim().is_empty()) {
        sql.push_str(
            " AND LOWER(COALESCE(NULLIF(r.upstream_model,''),r.request_model,'')) LIKE LOWER(?)",
        );
        args.push(format!("%{}%", value.trim()).into());
    }
    if let Some(status) = q.status_code {
        sql.push_str(" AND r.status=?");
        args.push(status.into());
    }
    if let Some(username) = q.username.as_ref().filter(|value| !value.trim().is_empty()) {
        sql.push_str(" AND LOWER(u.username) LIKE LOWER(?)");
        args.push(format!("%{}%", username.trim()).into());
    }
    Ok((sql, args))
}
fn query(
    db: &crate::database::Database,
    sql: &str,
    args: &[rusqlite::types::Value],
) -> Result<Vec<Value>> {
    let refs = args
        .iter()
        .map(|v| v as &dyn rusqlite::ToSql)
        .collect::<Vec<_>>();
    api::query_json(&*conn(db)?, sql, &refs)
}
const USAGE_FROM: &str = "hub_requests r LEFT JOIN hub_users u ON u.id=r.user_id LEFT JOIN hub_users owner ON owner.id=r.owner_id";
const PROVIDER_NAME: &str =
    "COALESCE(NULLIF(r.provider_name,''),NULLIF(r.provider_id,''),'未路由')";
const OWNER_DISPLAY_NAME: &str =
    "COALESCE(NULLIF(owner.username,''),NULLIF(r.owner_name,''),'未知用户')";
const BILLING_MODEL: &str = "COALESCE(NULLIF(r.upstream_model,''),CASE WHEN instr(r.request_model,'/')>0 THEN substr(r.request_model,instr(r.request_model,'/')+1) ELSE NULLIF(r.request_model,'') END,'未知模型')";
const METRICS:&str="COUNT(*) AS totalRequests,printf('%.6f',COALESCE(SUM(r.cost_credits),0)/1000000.0) AS totalCost,COALESCE(SUM(r.input_tokens),0) AS totalInputTokens,COALESCE(SUM(r.output_tokens),0) AS totalOutputTokens,COALESCE(SUM(r.cache_read_tokens),0) AS totalCacheReadTokens,COALESCE(SUM(r.cache_creation_tokens),0) AS totalCacheCreationTokens,COALESCE(SUM(r.input_tokens+r.output_tokens+r.cache_read_tokens+r.cache_creation_tokens),0) AS totalTokens,COALESCE(AVG(CASE WHEN r.state='completed' THEN 100.0 ELSE 0.0 END),0) AS successRate,COALESCE(AVG(r.latency_ms),0) AS avgLatencyMs";
async fn usage(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(kind): Path<String>,
    Query(q): Query<UsageFilter>,
) -> Result<Json<Value>> {
    let (filter, args) = filtered(&user, &q)?;
    if kind == "last-session-scan" {
        return Ok(Json(Value::Null));
    }
    if kind == "data-sources" {
        return Ok(Json(json!(query(&app.db,&format!("SELECT 'gateway' AS dataSource,COUNT(*) AS requestCount,printf('%.6f',COALESCE(SUM(r.cost_credits),0)/1000000.0) AS totalCostUsd FROM {USAGE_FROM} WHERE {filter}"),&args)?)));
    }
    let (extra,group)=match kind.as_str() {
        "summary"=>("".to_string(),"".to_string()),
        "trends"=>("date(r.created_at,'unixepoch') AS date,".to_string(),"date(r.created_at,'unixepoch')".to_string()),
        "provider-stats"=>(format!("COALESCE(r.provider_id,'unrouted') AS providerId,{PROVIDER_NAME} AS providerName,{OWNER_DISPLAY_NAME} AS ownerName,"),format!("COALESCE(r.provider_id,'unrouted'),{PROVIDER_NAME},{OWNER_DISPLAY_NAME}")),
        "user-stats"=>("COALESCE(r.user_id,'unknown') AS userId,COALESCE(u.username,'未知用户') AS username,".to_string(),"r.user_id,u.username".to_string()),
        "model-stats"=>("COALESCE(NULLIF(r.upstream_model,''),CASE WHEN instr(r.request_model,'/')>0 THEN substr(r.request_model,instr(r.request_model,'/')+1) ELSE NULLIF(r.request_model,'') END,'未知模型') AS model,printf('%.6f',COALESCE(AVG(r.cost_credits),0)/1000000.0) AS avgCostPerRequest,".to_string(),BILLING_MODEL.to_string()),
        _=>return Err(Error::bad("未知统计类型")),
    };
    let suffix = if group.is_empty() {
        String::new()
    } else {
        format!(" GROUP BY {group} ORDER BY {group}")
    };
    let mut rows = query(
        &app.db,
        &format!("SELECT {extra}{METRICS} FROM {USAGE_FROM} WHERE {filter}{suffix}"),
        &args,
    )?;
    for row in &mut rows {
        row["requestCount"] = row["totalRequests"].clone();
    }
    Ok(Json(if kind == "summary" {
        rows.into_iter().next().unwrap_or(json!({}))
    } else {
        json!(rows)
    }))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Logs {
    filters: UsageFilter,
    page: i64,
    page_size: i64,
    scope: Option<String>,
}
fn log_row(r: &Value) -> Value {
    let provider_name = r["provider_name"]
        .as_str()
        .filter(|value| !value.is_empty())
        .or_else(|| r["provider_id"].as_str().filter(|value| !value.is_empty()))
        .unwrap_or("未路由");
    let owner_name = r["owner_display_name"]
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or("未知用户");
    let model = r["upstream_model"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            r["request_model"].as_str().map(|value| {
                value
                    .split_once('/')
                    .map(|(_, model)| model)
                    .filter(|model| !model.is_empty())
                    .unwrap_or(value)
                    .to_owned()
            })
        })
        .unwrap_or_default();
    json!({"requestId":r["id"],"providerId":r["owner_id"],"providerName":provider_name,"ownerName":owner_name,"appType":r["app_type"],"model":model,"requestModel":r["request_model"],"costMultiplier":"1","inputTokens":r["input_tokens"],"outputTokens":r["output_tokens"],"cacheReadTokens":r["cache_read_tokens"],"cacheCreationTokens":r["cache_creation_tokens"],"inputCostUsd":"0","outputCostUsd":"0","cacheReadCostUsd":"0","cacheCreationCostUsd":"0","totalCostUsd":format!("{:.6}",r["cost_credits"].as_i64().unwrap_or(0) as f64/1_000_000.0),"costUnknown":r["cost_credits"].is_null(),"isStreaming":r["stream"].as_i64()==Some(1),"latencyMs":r["latency_ms"],"firstTokenMs":r["first_token_ms"],"durationMs":r["latency_ms"],"statusCode":r["status"],"errorMessage":r["error_code"],"createdAt":r["created_at"],"dataSource":"gateway","username":r["username"],"device":r["device"],"state":r["state"]})
}
async fn request_logs(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(mut q): Json<Logs>,
) -> Result<Json<Value>> {
    q.filters.scope = q.scope;
    let (filter, mut args) = filtered(&user, &q.filters)?;
    let total = query(
        &app.db,
        &format!("SELECT COUNT(*) AS total FROM {USAGE_FROM} WHERE {filter}"),
        &args,
    )?
    .first()
    .map(|r| r["total"].clone())
    .unwrap_or(json!(0));
    let page = q.page.max(0);
    let size = q.page_size.clamp(1, 100);
    args.push(size.into());
    args.push((page * size).into());
    let rows=query(&app.db,&format!("SELECT r.*,u.username,{OWNER_DISPLAY_NAME} AS owner_display_name FROM {USAGE_FROM} WHERE {filter} ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?"),&args)?.iter().map(log_row).collect::<Vec<_>>();
    Ok(Json(
        json!({"data":rows,"total":total,"page":page,"pageSize":size}),
    ))
}
async fn request_detail(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let rows=query(&app.db,&format!("SELECT r.*,u.username,{OWNER_DISPLAY_NAME} AS owner_display_name FROM {USAGE_FROM} WHERE r.id=? AND (r.user_id=? OR r.owner_id=? OR ?=1)"),&[id.into(),user.id.clone().into(),user.id.clone().into(),user.admin().into()])?;
    Ok(Json(log_row(rows.first().ok_or_else(Error::forbidden)?)))
}
