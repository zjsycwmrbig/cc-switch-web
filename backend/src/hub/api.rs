use super::*;
use crate::store::AppState;
use axum::{
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{header, HeaderMap, Method},
    middleware::{self, Next},
    response::Response,
    routing::{get, post, put},
    Extension, Router,
};
use rusqlite::{params, types::ValueRef, OptionalExtension};
use std::sync::Arc;
static PASSWORD_WORK: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

pub fn routes(app: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/unit/auth/status", get(status))
        .route("/api/unit/auth/register", post(register))
        .route("/api/unit/auth/login", post(login))
        .route("/api/unit/auth/logout", post(logout))
        .route("/api/unit/me", get(me))
        .merge(super::ui::routes())
        .route("/api/unit/password", put(password))
        .route("/api/unit/account", axum::routing::delete(delete_account))
        .route("/api/unit/keys", get(keys).post(create_key))
        .route("/api/unit/keys/:id", axum::routing::delete(revoke_key))
        .route(
            "/api/unit/preferences",
            get(get_preferences).put(save_preferences),
        )
        .route(
            "/api/unit/resources",
            get(resources_list).post(save_resource),
        )
        .route(
            "/api/unit/resources/:id",
            get(resource_detail)
                .put(update_resource)
                .delete(delete_resource),
        )
        .route("/api/unit/resources/:id/publication", put(publication))
        .route("/api/unit/resources/:id/policy", put(save_policy))
        .route(
            "/api/unit/resources/:id/grants",
            get(grants).put(save_grant),
        )
        .route(
            "/api/unit/resources/:id/grants/:user",
            axum::routing::delete(delete_grant),
        )
        .route(
            "/api/unit/resources/:id/user-usage",
            get(resource_user_usage),
        )
        .route(
            "/api/unit/applications",
            get(applications).post(create_application),
        )
        .route(
            "/api/unit/applications/:id/decision",
            post(decide_application),
        )
        .route(
            "/api/unit/applications/:id",
            axum::routing::delete(cancel_application),
        )
        .route("/api/unit/notices", get(notices))
        .route(
            "/api/unit/model-routes",
            get(model_routes).post(save_model_route),
        )
        .route(
            "/api/unit/model-routes/detect",
            post(detect_model_routes),
        )
        .route(
            "/api/unit/model-routes/:id",
            axum::routing::delete(delete_model_route),
        )
        .route("/api/unit/share-codes", get(share_codes))
        .route(
            "/api/unit/resources/:id/share-codes",
            post(create_share_code),
        )
        .route(
            "/api/unit/share-codes/:id",
            axum::routing::delete(revoke_share_code),
        )
        .route("/api/unit/share-claims", post(claim_share))
        .route("/api/unit/profile/overview", get(profile_overview))
        .route(
            "/api/unit/resources/:id/models/refresh",
            post(refresh_models),
        )
        .route("/api/unit/resources/:id/models", put(save_models))
        .route("/api/unit/resources/:id/usage", get(resource_usage))
        .route("/api/unit/catalog", get(catalog))
        .route("/api/unit/install.sh", get(installer))
        .route("/api/unit/directory", get(directory))
        .route("/api/unit/usage", get(usage))
        .route("/api/unit/requests", get(requests))
        .route("/api/unit/requests/:id", get(request_detail))
        .route("/api/unit/usage/export", get(export_usage))
        .route("/api/unit/accounts", get(accounts))
        .route("/api/unit/accounts/login", post(account_login))
        .route("/api/unit/accounts/poll", post(account_poll))
        .route("/api/unit/accounts/cancel", post(account_cancel))
        .route(
            "/api/unit/accounts/:id",
            axum::routing::delete(account_delete),
        )
        .route("/api/unit/accounts/:id/quota", get(account_quota))
        .route("/api/unit/admin/users", get(users))
        .route("/api/unit/admin/users/:id", put(update_user))
        .route("/api/unit/admin/resources/:id", put(disable_resource))
        .route("/api/unit/admin/settings", get(settings).put(save_settings))
        .route("/api/unit/admin/audit", get(audit_log))
        .route("/api/unit/admin/reconcile/:id", post(reconcile))
        // 供应商模型目录可能是几万个模型（编辑保存时会把目录整体回传），
        // 4MB 会触发 “length limit exceeded”，这里放宽到 32MB。
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(app.clone(), guard))
        .with_state(app)
}
async fn guard(State(app): State<Arc<AppState>>, mut request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let public = matches!(
        path,
        "/api/unit/auth/status" | "/api/unit/auth/register" | "/api/unit/auth/login"
    );
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        if let Err(e) = auth::check_origin(&app.db, request.headers()) {
            return e.into_response();
        }
    }
    if !public {
        let allow_key = matches!(path, "/api/unit/catalog" | "/api/unit/install.sh");
        let user = match auth::authenticate(&app.db, request.headers(), allow_key) {
            Ok(u) => u,
            Err(e) => return e.into_response(),
        };
        if !matches!(*request.method(), Method::GET | Method::HEAD) {
            if let Err(e) = auth::check_csrf(&user, request.headers()) {
                return e.into_response();
            }
        }
        request.extensions_mut().insert(user);
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        header::HeaderValue::from_static("nosniff"),
    );
    response
}
fn admin(user: &Identity) -> Result<()> {
    if !user.admin() {
        return Err(Error::forbidden());
    }
    Ok(())
}
async fn status(State(app): State<Arc<AppState>>) -> Json<Value> {
    Json(
        json!({"name":"ccSwitchUint","registrationOpen":auth::setting(&app.db,"registration","open")=="open"}),
    )
}
#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
}
async fn register(
    State(app): State<Arc<AppState>>,
    Json(v): Json<Credentials>,
) -> Result<Response> {
    let secure = public_url(&app.db).starts_with("https://");
    let permit = PASSWORD_WORK
        .try_acquire()
        .map_err(|_| Error::limited("authentication_busy", "认证请求繁忙，请稍后重试"))?;
    let token = tokio::task::spawn_blocking(move || {
        auth::register(&app.db, &v.username, &v.password)?;
        auth::login(&app.db, &v.username, &v.password)
    })
    .await
    .map_err(|_| Error::bad("注册暂时不可用"))??;
    drop(permit);
    Ok((
        [(
            header::SET_COOKIE,
            auth::session_cookie(&token, 7 * 86400, secure),
        )],
        Json(json!({"ok":true})),
    )
        .into_response())
}
async fn login(State(app): State<Arc<AppState>>, Json(v): Json<Credentials>) -> Result<Response> {
    let secure = public_url(&app.db).starts_with("https://");
    let permit = PASSWORD_WORK
        .try_acquire()
        .map_err(|_| Error::limited("authentication_busy", "认证请求繁忙，请稍后重试"))?;
    let token = tokio::task::spawn_blocking(move || auth::login(&app.db, &v.username, &v.password))
        .await
        .map_err(|_| Error::bad("登录暂时不可用"))??;
    drop(permit);
    Ok((
        [(
            header::SET_COOKIE,
            auth::session_cookie(&token, 7 * 86400, secure),
        )],
        Json(json!({"ok":true})),
    )
        .into_response())
}
async fn logout(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Response> {
    conn(&app.db)?.execute(
        "DELETE FROM hub_sessions WHERE user_id=?1 AND csrf=?2",
        params![user.id, user.csrf],
    )?;
    Ok((
        [(
            header::SET_COOKIE,
            auth::session_cookie("", 0, public_url(&app.db).starts_with("https://")),
        )],
        Json(json!({"ok":true})),
    )
        .into_response())
}
pub fn public_url(db: &crate::database::Database) -> String {
    auth::setting(
        db,
        "publicUrl",
        &std::env::var("CC_SWITCH_PUBLIC_URL").unwrap_or_else(|_| "http://127.0.0.1:8890".into()),
    )
    .trim_end_matches('/')
    .into()
}
pub fn proxy_url(db: &crate::database::Database) -> String {
    auth::setting(
        db,
        "publicProxyUrl",
        &std::env::var("CC_SWITCH_PUBLIC_PROXY_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:15721/v1".into()),
    )
    .trim_end_matches('/')
    .into()
}
async fn me(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    Ok(Json(
        json!({"user":user,"quota":metering::remaining(&app.db,&user)?,"publicUrl":public_url(&app.db),"proxyUrl":proxy_url(&app.db)}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Password {
    current_password: String,
    new_password: String,
}
async fn password(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<Password>,
) -> Result<Response> {
    use argon2::{Argon2, PasswordHash, PasswordVerifier};
    let db = app.db.clone();
    let uid = user.id.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let current: String = conn(&db)?.query_row(
            "SELECT password_hash FROM hub_users WHERE id=?1",
            [&uid],
            |r| r.get(0),
        )?;
        if !PasswordHash::new(&current).ok().is_some_and(|h| {
            Argon2::default()
                .verify_password(v.current_password.as_bytes(), &h)
                .is_ok()
        }) {
            return Err(Error::bad("当前密码错误"));
        }
        let hash = auth::password_hash(&v.new_password)?;
        let mut c = conn(&db)?;
        let tx = c.transaction()?;
        tx.execute(
            "UPDATE hub_users SET password_hash=?1 WHERE id=?2",
            params![hash, uid],
        )?;
        tx.execute("DELETE FROM hub_sessions WHERE user_id=?1", [uid])?;
        tx.commit()?;
        Ok(())
    })
    .await
    .map_err(|_| Error::bad("密码修改失败"))??;
    audit(&app.db, &user.id, "user.password", &user.id, json!({}))?;
    Ok((
        [(
            header::SET_COOKIE,
            auth::session_cookie("", 0, public_url(&app.db).starts_with("https://")),
        )],
        Json(json!({"ok":true})),
    )
        .into_response())
}
pub(super) fn query_json(
    c: &rusqlite::Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Value>> {
    let mut stmt = c.prepare(sql)?;
    let names = stmt
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    let mut rows = stmt.query(args)?;
    let mut output = vec![];
    while let Some(row) = rows.next()? {
        let mut obj = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(n) => json!(n),
                ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                ValueRef::Blob(_) => Value::Null,
            };
            obj.insert(name.clone(), value);
        }
        output.push(Value::Object(obj));
    }
    Ok(output)
}
async fn keys(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    Ok(Json(json!(query_json(&*conn(&app.db)?,"SELECT id,name,prefix,active,created_at,last_used_at,expires_at FROM hub_api_keys WHERE user_id=?1 ORDER BY created_at DESC",&[&user.id])?)))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyRequest {
    name: String,
    expires_at: Option<i64>,
}
async fn create_key(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<KeyRequest>,
) -> Result<Json<Value>> {
    let name = v.name.trim();
    if name.is_empty() || name.len() > 100 || v.expires_at.is_some_and(|t| t <= now()) {
        return Err(Error::bad("请填写设备名称和有效的到期时间"));
    }
    let token = auth::secret();
    let key = id();
    conn(&app.db)?.execute("INSERT INTO hub_api_keys(id,user_id,name,token_hash,prefix,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![key,user.id,name,auth::hash(&token),&token[..12],now(),v.expires_at])?;
    audit(&app.db, &user.id, "key.create", &key, json!({"name":name}))?;
    Ok(Json(
        json!({"id":key,"key":token,"command":format!("curl -fsSL -H 'Authorization: Bearer {token}' '{}/api/unit/install.sh' | CC_SWITCH_CONFIGURE_ROUTE=1 CC_SWITCH_RESTART_APP_SERVER=1 bash",public_url(&app.db))}),
    ))
}
async fn revoke_key(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(key): Path<String>,
) -> Result<Json<Value>> {
    conn(&app.db)?.execute(
        "UPDATE hub_api_keys SET active=0 WHERE id=?1 AND user_id=?2",
        params![key, user.id],
    )?;
    audit(&app.db, &user.id, "key.revoke", &key, json!({}))?;
    Ok(Json(json!({"ok":true})))
}
async fn get_preferences(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    Ok(Json(catalog::preferences(&app.db, &user)?))
}
async fn save_preferences(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    if !v.is_object() || json_text(&v).len() > 256 * 1024 {
        return Err(Error::bad("无效的个人配置"));
    }
    if let Some(choices) = v.get("models") {
        let allowed = catalog::export(&app.db, &user, false)?;
        let choices = choices
            .as_array()
            .ok_or_else(|| Error::bad("模型选择必须是数组"))?;
        if choices.iter().any(|choice| {
            !allowed["models"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["slug"] == *choice)
        }) {
            return Err(Error::bad("选择中存在已撤销或无权使用的模型，请刷新列表"));
        }
    }
    conn(&app.db)?.execute("INSERT INTO hub_preferences(user_id,value) VALUES(?1,?2) ON CONFLICT(user_id) DO UPDATE SET value=?2",params![user.id,json_text(&v)])?;
    Ok(Json(v))
}
async fn resources_list(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    let list = resources::all(&app.db)?
        .iter()
        .filter(|r| {
            r.owner_id == user.id
                || user.admin()
                || resources::grant(&app.db, &user, r, None).is_ok()
        })
        .map(|r| resources::safe_view(&app.db, &user, r))
        .collect::<Vec<_>>();
    Ok(Json(json!(list)))
}
async fn resource_detail(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    Ok(Json(
        json!({"resource":r,"provider":app.db.get_provider_by_id(&r.provider_id,&r.app_type)?}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ResourceInput {
    name: String,
    app_type: String,
    settings_config: Value,
    api_format: Option<String>,
    models: Vec<String>,
    account_id: Option<String>,
    policy: Policy,
    #[serde(default)]
    provider: Option<crate::provider::Provider>,
    #[serde(default)]
    base_config: Option<Value>,
    #[serde(default)]
    model_rows: Option<Vec<Value>>,
}
async fn save_resource(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<ResourceInput>,
) -> Result<Json<Value>> {
    save_resource_impl(&app, &user, None, v).await
}
async fn update_resource(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
    Json(v): Json<ResourceInput>,
) -> Result<Json<Value>> {
    save_resource_impl(&app, &user, Some(&resource), v).await
}
pub(super) async fn save_resource_impl(
    app: &AppState,
    user: &Identity,
    resource: Option<&str>,
    v: ResourceInput,
) -> Result<Json<Value>> {
    if v.name.trim().is_empty()
        || v.name.len() > 100
        || !["codex", "claude"].contains(&v.app_type.as_str())
        || !v.settings_config.is_object()
    {
        return Err(Error::bad(
            "请填写供应商名称，选择 Codex/Claude 并提供 JSON 对象配置",
        ));
    }
    v.policy.validate()?;
    let previous = resource.map(|r| resources::get(&app.db, r)).transpose()?;
    if let Some(r) = &previous {
        resources::own(user, r)?;
        if r.app_type != v.app_type {
            return Err(Error::bad("创建后不能更改供应商应用类型"));
        }
    }
    let existing = if let Some(r) = &previous {
        Some(
            app.db
                .get_provider_by_id(&r.provider_id, &r.app_type)?
                .ok_or_else(Error::forbidden)?,
        )
    } else {
        None
    };
    if let (Some(base), Some(row)) = (&v.base_config, &existing) {
        if *base != row.settings_config {
            return Err(Error::bad(
                "供应商配置已被其他窗口修改，请关闭编辑器并重新打开后再保存",
            ));
        }
    }
    let mut provider = v.provider.or_else(|| existing.clone()).unwrap_or_else(|| {
        crate::provider::Provider::with_id(id(), v.name.clone(), v.settings_config.clone(), None)
    });
    // Provider IDs are assigned by the service and cannot overwrite another owner's row.
    provider.id = existing.as_ref().map(|p| p.id.clone()).unwrap_or_else(id);
    provider.name = v.name.trim().into();
    provider.settings_config = v.settings_config;
    provider
        .meta
        .get_or_insert_with(Default::default)
        .api_format = v.api_format;
    if let Some(account) = &v.account_id {
        resources::bind_account(&mut provider, account);
    }
    let account = resources::check_binding(&app.db, user, &provider)?;
    let official =
        v.app_type == "codex" && crate::proxy::providers::is_codex_official_provider(&provider);
    let app_type = if v.app_type == "codex" {
        crate::app_config::AppType::Codex
    } else {
        crate::app_config::AppType::Claude
    };
    crate::services::provider::ProviderService::validate_provider_settings(&app_type, &provider)?;
    if !official {
        let (base, _) = provider.resolve_usage_credentials(&app_type);
        if !base.is_empty() {
            catalog::validate_upstream(&base)?;
        }
    }
    let previous_rows = previous
        .as_ref()
        .map(|r| r.models.clone())
        .unwrap_or_else(|| catalog::stored_rows(&provider, &v.app_type));
    let rows = if let Some(model_rows) = &v.model_rows {
        catalog::rows_from_values(model_rows, &previous_rows)?
    } else if v.models.is_empty() && previous.is_none() {
        previous_rows
    } else {
        catalog::rows_from_names(&v.models, &previous_rows)?
    };
    if let Some(r) = &previous {
        if r.account_id.is_some() && r.account_id != account {
            return Err(Error::bad(
                "已绑定账号的供应商不能换绑，请为新账号新建供应商",
            ));
        }
    }
    let resource_id = previous.as_ref().map(|r| r.id.clone()).unwrap_or_else(id);
    let mut c = conn(&app.db)?;
    let tx = c.transaction()?;
    tx.execute("INSERT INTO providers(id,app_type,name,settings_config,meta,created_at,website_url,category,notes,icon,icon_color) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(id,app_type) DO UPDATE SET name=?3,settings_config=?4,meta=?5,website_url=?7,category=?8,notes=?9,icon=?10,icon_color=?11",params![provider.id,v.app_type,provider.name,json_text(&provider.settings_config),json_text(&provider.meta.clone().unwrap_or_default()),provider.created_at.unwrap_or(now()),provider.website_url,provider.category,provider.notes,provider.icon,provider.icon_color])?;
    if previous.is_some() {
        tx.execute(
            "UPDATE hub_resources SET policy=?1,models=?2,official=?3,account_id=?4 WHERE id=?5",
            params![
                json_text(&v.policy),
                json_text(&rows),
                official,
                account,
                resource_id
            ],
        )?;
    } else {
        let route = format!("u{}", &resource_id[..8]);
        tx.execute("INSERT INTO hub_resources(id,provider_id,app_type,owner_id,route_key,policy,models,official,account_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![resource_id,provider.id,v.app_type,user.id,route,json_text(&v.policy),json_text(&rows),official,account,now()])?;
    }
    tx.commit()?;
    drop(c);
    let saved_resource = resources::get(&app.db, &resource_id)?;
    prune_model_routes_for_resource(&app.db, &saved_resource)?;
    audit(
        &app.db,
        &user.id,
        "resource.save",
        &resource_id,
        json!({"name":provider.name,"policy":v.policy}),
    )?;
    Ok(Json(json!({"id":resource_id})))
}
async fn delete_resource(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    purge_resource(&app, &user.id, &resource).await?;
    audit(&app.db, &user.id, "resource.delete", &resource, json!({}))?;
    Ok(Json(json!({"ok":true})))
}

/// 删除供应商时的统一清理：解绑官方账号并软删除资源。
pub(super) async fn purge_resource(
    app: &AppState,
    owner: &str,
    resource: &str,
) -> Result<()> {
    let r = resources::get(&app.db, resource)?;
    // 官方供应商与官方账号一一对应：删除供应商时同步解绑并移除授权账号，避免账号残留。
    if r.official {
        if let Some(account) = r.account_id.clone() {
            let _ = app
                .codex_oauth_state
                .read()
                .await
                .remove_account(&account)
                .await;
            conn(&app.db)?.execute(
                "DELETE FROM hub_account_owners WHERE account_id=?1 AND owner_id=?2",
                params![account, owner],
            )?;
        }
    }
    // 清掉所有用户模型路由里指向这个供应商的目标（等价于模型被全部下架）。
    let mut gone = r.clone();
    gone.models.clear();
    prune_model_routes_for_resource(&app.db, &gone)?;
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET deleted=1,published=0,official=0,account_id=NULL WHERE id=?1",
        [resource],
    )?;
    Ok(())
}
#[derive(Deserialize)]
struct Published {
    published: bool,
}
async fn publication(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
    Json(v): Json<Published>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    if v.published && r.models.is_empty() {
        return Err(Error::bad(
            "该供应商还没有模型：请先在卡片上点击“获取模型”，再点“加入”",
        ));
    }
    if v.published && r.official && r.account_id.is_none() {
        // 兼容在“授权中心”登录后未回写绑定的情况：发布时自动绑定该用户最新的官方账号。
        let account: Option<String> = conn(&app.db)?
            .query_row(
                "SELECT account_id FROM hub_account_owners
                 WHERE owner_id=?1 AND auth_provider='codex_oauth'
                 ORDER BY rowid DESC LIMIT 1",
                [&user.id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(account) = account else {
            return Err(Error::bad(
                "请先在“授权中心”登录官方账号，再回来点“加入”",
            ));
        };
        conn(&app.db)?.execute(
            "UPDATE hub_resources SET account_id=?1 WHERE id=?2",
            params![account, resource],
        )?;
    }
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET published=?1 WHERE id=?2",
        params![v.published, resource],
    )?;
    audit(
        &app.db,
        &user.id,
        "resource.publish",
        &resource,
        json!({"published":v.published}),
    )?;
    Ok(Json(json!({"ok":true})))
}
async fn save_policy(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
    Json(policy): Json<Policy>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    policy.validate()?;
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET policy=?1 WHERE id=?2",
        params![json_text(&policy), resource],
    )?;
    audit(&app.db, &user.id, "resource.policy", &r.id, json!(policy))?;
    Ok(Json(json!({"ok":true})))
}
async fn grants(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    let values=query_json(&*conn(&app.db)?,"SELECT g.user_id,u.username,g.allowed,g.budget,g.models,g.expires_at FROM hub_grants g JOIN hub_users u ON u.id=g.user_id WHERE g.resource_id=?1",&[&resource])?;
    Ok(Json(json!(values)))
}
/// 某个供应商下所有用户的权限 + 近 30 天用量（按请求次数排行）。
async fn resource_user_usage(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    let rows = query_json(
        &*conn(&app.db)?,
        "SELECT g.user_id, u.username, g.allowed, g.budget, g.models, g.expires_at,
                COALESCE(x.requests,0) AS requests,
                COALESCE(x.tokens,0) AS tokens,
                COALESCE(x.cost_credits,0) AS costCredits
         FROM hub_grants g
         JOIN hub_users u ON u.id=g.user_id
         LEFT JOIN (
             SELECT user_id, COUNT(*) AS requests,
                    SUM(input_tokens+output_tokens+cache_read_tokens+cache_creation_tokens) AS tokens,
                    SUM(cost_credits) AS cost_credits
             FROM hub_requests
             WHERE resource_id=?1 AND created_at>=?2
             GROUP BY user_id
         ) x ON x.user_id=g.user_id
         WHERE g.resource_id=?1
         ORDER BY requests DESC, u.username",
        &[&resource, &(now() - 30 * 86400)],
    )?;
    Ok(Json(json!(rows)))
}

async fn save_grant(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
    Json(v): Json<resources::Grant>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    v.budget.validate()?;
    if v.expires_at.is_some_and(|expires| expires <= now()) {
        return Err(Error::bad("授权到期时间必须晚于当前时间"));
    }
    let allowed_models = resources::visible_model_slugs(&r);
    if v.models.iter().any(|model| !allowed_models.contains(model)) {
        return Err(Error::bad("授权包含该供应商未共享的模型"));
    }
    let username = auth::username(&v.username)?;
    let uid: Option<String> = conn(&app.db)?
        .query_row(
            "SELECT id FROM hub_users WHERE username=?1 AND active=1",
            [username],
            |r| r.get(0),
        )
        .optional()?;
    let uid = uid.ok_or_else(|| Error::bad("用户不存在"))?;
    conn(&app.db)?.execute("INSERT INTO hub_grants(resource_id,user_id,allowed,budget,models,expires_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(resource_id,user_id) DO UPDATE SET allowed=?3,budget=?4,models=?5,expires_at=?6",params![resource,uid,v.allowed,json_text(&v.budget),json_text(&v.models),v.expires_at])?;
    audit(&app.db, &user.id, "grant.save", &resource, json!(v))?;
    Ok(Json(json!({"ok":true})))
}
async fn delete_grant(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path((resource, target)): Path<(String, String)>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    let changed = conn(&app.db)?.execute(
        "DELETE FROM hub_grants WHERE resource_id=?1 AND user_id=?2",
        params![resource, target],
    )?;
    if changed == 0 {
        return Err(Error::bad("该用户没有单独分配"));
    }
    audit(
        &app.db,
        &user.id,
        "grant.delete",
        &resource,
        json!({"userId":target}),
    )?;
    Ok(Json(json!({"ok":true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplicationInput {
    resource_id: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    budget: Budget,
    #[serde(default)]
    models: Vec<String>,
    /// 期望的时间截止（unix 秒）；留空表示不限时间。
    #[serde(default)]
    expires_at: Option<i64>,
}

fn validate_requested_deadline(expires_at: Option<i64>) -> Result<()> {
    if expires_at.is_some_and(|expires| expires <= now()) {
        return Err(Error::bad("时间截止必须晚于当前时间"));
    }
    Ok(())
}

fn normalize_application_models(
    r: &resources::Resource,
    models: &[String],
) -> Result<Vec<String>> {
    if models.len() > 500 || models.iter().any(|model| model.len() > 200) {
        return Err(Error::bad("申请的模型列表过长"));
    }
    // 只能申请供应商对外可见/共享的模型，留空表示全部可见模型。
    let available = resources::visible_model_slugs(r)
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    if models
        .iter()
        .any(|model| !available.contains(model.as_str()))
    {
        return Err(Error::bad("申请包含该供应商未共享的模型"));
    }
    Ok(models.to_vec())
}

/// 免审规则：满足提供者设定的上限时自动通过；超出上限则转人工审批。
fn auto_approve_budget(
    db: &crate::database::Database,
    resource: &resources::Resource,
    requested: &Budget,
) -> Result<Option<Budget>> {
    let rule = &resource.policy.auto_approve;
    if !rule.enabled {
        return Ok(None);
    }
    if (rule.per_user_tokens.is_some() || rule.total_tokens.is_some()) && requested.tokens.is_none()
    {
        return Ok(None);
    }
    let (users, tokens) = conn(db)?.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CAST(json_extract(budget,'$.tokens') AS INTEGER)),0)
         FROM hub_grants WHERE resource_id=?1 AND allowed=1",
        [&resource.id],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if rule.max_users.is_some_and(|max| users + 1 > max) {
        return Ok(None);
    }
    if let (Some(per_user), Some(want)) = (rule.per_user_tokens, requested.tokens) {
        if want > per_user {
            return Ok(None);
        }
    }
    if let (Some(total), Some(want)) = (rule.total_tokens, requested.tokens) {
        if tokens + want > total {
            return Ok(None);
        }
    }
    Ok(Some(requested.clone()))
}

async fn applications(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    let c = conn(&app.db)?;
    let mut mine_statement = c.prepare(
        "SELECT a.id,a.resource_id,p.name,u.username,a.message,a.budget,a.models,a.state,a.decided_by,a.created_at,a.decided_at,
                a.requested_expires_at,a.decided_expires_at,a.decided_models,a.decided_budget,a.decision_kind,a.decision_note
         FROM hub_applications a
         JOIN hub_resources r ON r.id=a.resource_id
         JOIN providers p ON p.id=r.provider_id AND p.app_type=r.app_type
         JOIN hub_users u ON u.id=a.owner_id
         WHERE a.applicant_id=?1 ORDER BY a.created_at DESC LIMIT 300",
    )?;
    let mine = mine_statement
        .query_map([&user.id], application_view)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut received_statement = c.prepare(
        "SELECT a.id,a.resource_id,p.name,u.username,a.message,a.budget,a.models,a.state,a.decided_by,a.created_at,a.decided_at,
                a.requested_expires_at,a.decided_expires_at,a.decided_models,a.decided_budget,a.decision_kind,a.decision_note
         FROM hub_applications a
         JOIN hub_resources r ON r.id=a.resource_id
         JOIN providers p ON p.id=r.provider_id AND p.app_type=r.app_type
         JOIN hub_users u ON u.id=a.applicant_id
         WHERE a.owner_id=?1 ORDER BY a.created_at DESC LIMIT 300",
    )?;
    let received = received_statement
        .query_map([&user.id], application_view)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(Json(json!({"mine":mine,"received":received})))
}

fn application_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "resourceId": row.get::<_, String>(1)?,
        "resourceName": row.get::<_, String>(2)?,
        "counterpartyName": row.get::<_, String>(3)?,
        "message": row.get::<_, String>(4)?,
        "budget": parse::<Budget>(&row.get::<_, String>(5)?),
        "models": parse::<Vec<String>>(&row.get::<_, String>(6)?),
        "state": row.get::<_, String>(7)?,
        "decidedBy": row.get::<_, Option<String>>(8)?,
        "createdAt": row.get::<_, i64>(9)?,
        "decidedAt": row.get::<_, Option<i64>>(10)?,
        "requestedExpiresAt": row.get::<_, Option<i64>>(11)?,
        "decidedExpiresAt": row.get::<_, Option<i64>>(12)?,
        "decidedModels": parse::<Vec<String>>(&row.get::<_, String>(13)?),
        "decidedBudget": parse::<Budget>(&row.get::<_, String>(14)?),
        "decisionKind": row.get::<_, String>(15)?,
        "decisionNote": row.get::<_, String>(16)?,
    }))
}

/// 用户的模型路由映射（自动路由 = 多个供应商目标，单对单 = 一个目标）。
pub(super) fn list_model_routes(
    db: &crate::database::Database,
    user_id: &str,
) -> Result<Vec<Value>> {
    let c = conn(db)?;
    let mut statement = c.prepare(
        "SELECT id,display_name,model,targets,enabled,auto,created_at,updated_at FROM hub_model_routes
         WHERE user_id=?1 ORDER BY created_at,id",
    )?;
    let rows = statement
        .query_map([user_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "displayName": row.get::<_, String>(1)?,
                "model": row.get::<_, String>(2)?,
                "targets": parse::<Vec<String>>(&row.get::<_, String>(3)?),
                "enabled": row.get::<_, bool>(4)?,
                "auto": row.get::<_, bool>(5)?,
                "createdAt": row.get::<_, i64>(6)?,
                "updatedAt": row.get::<_, i64>(7)?,
            }))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    // 自动路由按归一化模型合并；单对单映射保持独立，不能覆盖或吞并。
    let mut merged: Vec<Value> = vec![];
    for row in rows {
        let is_auto = row["auto"].as_bool().unwrap_or(false);
        if let Some(existing) = is_auto.then(|| {
            let key = resources::model_group_key(row["model"].as_str().unwrap_or_default());
            merged.iter_mut().find(|item| {
                item["auto"].as_bool().unwrap_or(false)
                    && resources::model_group_key(item["model"].as_str().unwrap_or_default())
                        == key
            })
        }).flatten() {
            if row["updatedAt"].as_i64().unwrap_or(0) >= existing["updatedAt"].as_i64().unwrap_or(0) {
                existing["displayName"] = row["displayName"].clone();
                existing["model"] = row["model"].clone();
                existing["updatedAt"] = row["updatedAt"].clone();
            }
            let mut targets = existing["targets"].as_array().cloned().unwrap_or_default();
            for target in row["targets"].as_array().cloned().unwrap_or_default() {
                if !targets.contains(&target) {
                    targets.push(target);
                }
            }
            existing["targets"] = Value::Array(targets);
        } else {
            merged.push(row);
        }
    }
    Ok(merged)
}

async fn model_routes(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    seed_model_routes(&app.db, &user)?;
    sanitize_model_routes(&app.db, &user)?;
    let all = resources::all(&app.db)?;
    let mut routes = list_model_routes(&app.db, &user.id)?;
    for route in &mut routes {
        let model = route["model"].as_str().unwrap_or_default();
        let mut available = 0usize;
        let mut details = Vec::new();
        for target in route["targets"].as_array().into_iter().flatten() {
            let Some(id) = target.as_str() else {
                continue;
            };
            let Some(resource) = all.iter().find(|resource| resource.id == id) else {
                details.push(json!({
                    "id":id,
                    "name":"已删除的供应商",
                    "ownerName":"",
                    "routeKey":"",
                    "usable":false
                }));
                continue;
            };
            let usable = resources::usable(&app.db, &user, resource, model).is_ok();
            if usable {
                available += 1;
            }
            details.push(json!({
                "id":resource.id,
                "name":resource.name,
                "ownerName":resource.owner_name,
                "routeKey":resource.route_key,
                "usable":usable
            }));
        }
        route["targetDetails"] = Value::Array(details);
        route["availableTargetCount"] = json!(available);
    }
    Ok(Json(json!(routes)))
}

/// 清理已经失效的路由目标：只删除供应商已删除或不再提供该模型的目标。
/// 当前用户暂时无权限的目标保留并标记为不可用，由请求时鉴权决定是否可路由，
/// 这样全平台自动识别得到的“有映射但本人暂无可用供应商”也能持续展示。
fn sanitize_model_routes(db: &crate::database::Database, user: &Identity) -> Result<()> {
    let all = resources::all(db)?;
    for route in list_model_routes(db, &user.id)? {
        let Some(id) = route["id"].as_str() else {
            continue;
        };
        let model = route["model"].as_str().unwrap_or_default().to_string();
        let targets = route["targets"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let kept = targets
            .iter()
            .filter(|target| {
                all.iter()
                    .find(|r| &r.id == *target)
                    .is_some_and(|r| resources::match_model_slug(r, &model).is_some())
            })
            .cloned()
            .collect::<Vec<_>>();
        if kept.is_empty() {
            conn(db)?.execute("DELETE FROM hub_model_routes WHERE id=?1", [id])?;
        } else if kept != targets {
            conn(db)?.execute(
                "UPDATE hub_model_routes SET targets=?1,updated_at=?2 WHERE id=?3",
                params![json_text(&kept), now(), id],
            )?;
        }
    }
    Ok(())
}

/// 首次进入模型页时，为当前可用的「资源 × 模型」补单对单映射。
/// 自动路由由单独的识别流程追加，不能覆盖或合并这里的单对单记录。
pub(super) fn seed_model_routes(db: &crate::database::Database, user: &Identity) -> Result<()> {
    let existing = list_model_routes(db, &user.id)?;
    let mut have = std::collections::HashSet::new();
    for row in existing.iter().filter(|row| !row["auto"].as_bool().unwrap_or(false)) {
        let Some(model) = row["model"].as_str() else {
            continue;
        };
        let key = resources::model_group_key(model);
        for target in row["targets"].as_array().into_iter().flatten() {
            if let Some(target) = target.as_str() {
                have.insert((target.to_string(), key.clone()));
            }
        }
    }
    for r in resources::all(db)?
        .into_iter()
        .filter(|r| {
            r.app_type == "codex" && !r.disabled
        })
    {
        for raw in &r.models {
            let Some(model) = raw["slug"].as_str() else {
                continue;
            };
            let key = resources::model_group_key(model);
            if key.is_empty() || have.contains(&(r.id.clone(), key.clone())) {
                continue;
            }
            if resources::usable(db, user, &r, model).is_err() {
                continue;
            }
            have.insert((r.id.clone(), key));
            let last = model.rsplit('/').next().unwrap_or(model);
            let name = format!("{last}（{}）", r.name);
            conn(db)?.execute(
                "INSERT INTO hub_model_routes(id,user_id,display_name,model,targets,enabled,auto,created_at,updated_at)
                 VALUES(?1,?2,?3,?4,?5,1,0,?6,?6)",
                params![
                    super::id(),
                    &user.id,
                    name,
                    model,
                    json_text(&vec![r.id.clone()]),
                    now()
                ],
            )?;
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelRouteInput {
    #[serde(default)]
    id: Option<String>,
    display_name: String,
    model: String,
    #[serde(default)]
    targets: Vec<String>,
    #[serde(default)]
    auto: bool,
}

async fn save_model_route(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<ModelRouteInput>,
) -> Result<Json<Value>> {
    let display_name = v.display_name.trim().to_string();
    if display_name.is_empty() || display_name.chars().count() > 60 {
        return Err(Error::bad("名称需为 1-60 个字符"));
    }
    let model = v.model.trim().to_string();
    // 上游模型 ID 允许包含 "/"（如 deepseek/deepseek-v4-pro）。
    if model.is_empty() || model.len() > 200 || model.starts_with("ccs-") {
        return Err(Error::bad("基础模型 ID 无效"));
    }
    if v.targets.is_empty() || v.targets.len() > 50 {
        return Err(Error::bad("请选择 1-50 个供应商目标"));
    }
    let all = resources::all(&app.db)?;
    let mut seen = std::collections::HashSet::new();
    for target in &v.targets {
        if !seen.insert(target.clone()) {
            return Err(Error::bad("同一供应商只能出现一次"));
        }
        let r = all
            .iter()
            .find(|r| &r.id == target)
            .ok_or_else(|| Error::bad("目标供应商不存在"))?;
        // 全平台自动识别允许保留当前用户不可用的目标，是否可路由由请求时鉴权决定。
        if resources::match_model_slug(r, &model).is_none() {
            return Err(Error::bad("包含不提供此模型的供应商目标"));
        }
    }
    let id = v.id.clone().unwrap_or_else(super::id);
    let existing: Option<String> = conn(&app.db)?
        .query_row(
            "SELECT user_id FROM hub_model_routes WHERE id=?1",
            [&id],
            |row| row.get(0),
        )
        .optional()?;
    if existing.is_some_and(|owner| owner != user.id) {
        return Err(Error::forbidden());
    }
    if v.auto {
        conn(&app.db)?.execute(
            "DELETE FROM hub_model_routes WHERE user_id=?1 AND model=?2 AND auto=1 AND id<>?3",
            params![&user.id, &model, &id],
        )?;
    }
    conn(&app.db)?.execute(
        "INSERT INTO hub_model_routes(id,user_id,display_name,model,targets,enabled,auto,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,1,?6,?7,?7)
         ON CONFLICT(id) DO UPDATE SET display_name=?3,model=?4,targets=?5,auto=?6,updated_at=?7",
        params![
            id,
            &user.id,
            display_name,
            model,
            json_text(&v.targets),
            v.auto,
            now()
        ],
    )?;
    audit(
        &app.db,
        &user.id,
        "modelRoute.save",
        &id,
        json!({"model":model,"targets":v.targets,"auto":v.auto}),
    )?;
    Ok(Json(json!({"id":id})))
}

async fn delete_model_route(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(route): Path<String>,
) -> Result<Json<Value>> {
    let changed = conn(&app.db)?.execute(
        "DELETE FROM hub_model_routes WHERE id=?1 AND user_id=?2",
        params![route, &user.id],
    )?;
    if changed == 0 {
        return Err(Error::bad("映射不存在"));
    }
    Ok(Json(json!({"ok":true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DetectInput {
    #[serde(default)]
    apply: bool,
    #[serde(default)]
    include_all_models: bool,
}

fn looks_generated_auto_name(name: &str, model: &str) -> bool {
    let last = model.rsplit('/').next().unwrap_or(model);
    name == model
        || name == last
        || name.ends_with("[auto]")
        || name.ends_with("（自动路由）")
        || name
            .strip_prefix(last)
            .is_some_and(|suffix| suffix.starts_with('（') && suffix.ends_with('）'))
}

/// 自动识别映射：把同一模型出现在多个供应商的情形整理成候选自动路由组。
async fn detect_model_routes(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<DetectInput>,
) -> Result<Json<Value>> {
    let all = resources::all(&app.db)?;
    // 分组键：最后一个 `/` 之后、转小写、去掉特殊字符。
    // 成员保留完整原始模型 ID，用于还原自动路由的基础模型名。
    let mut groups: std::collections::BTreeMap<String, Vec<(String, String)>> =
        Default::default();
    for r in &all {
        if r.app_type != "codex" || r.disabled {
            continue;
        }
        for raw in &r.models {
            let Some(model) = raw["slug"].as_str() else {
                continue;
            };
            if !v.include_all_models && resources::usable(&app.db, &user, r, model).is_err() {
                continue;
            }
            let key = resources::model_group_key(model);
            if key.is_empty() {
                continue;
            }
            let entry = groups.entry(key).or_default();
            if !entry.iter().any(|(id, _)| id == &r.id) {
                entry.push((r.id.clone(), model.to_string()));
            }
        }
    }
    let existing = list_model_routes(&app.db, &user.id)?;
    let mut existing_by_key: std::collections::HashMap<String, (String, String, String, Vec<String>)> =
        Default::default();
    for row in &existing {
        if !row["auto"].as_bool().unwrap_or(false) {
            continue;
        }
        let Some(model) = row["model"].as_str() else { continue };
        existing_by_key.insert(
            resources::model_group_key(model),
            (
                row["id"].as_str().unwrap_or_default().to_string(),
                row["displayName"].as_str().unwrap_or(model).to_string(),
                model.to_string(),
                row["targets"]
                    .as_array()
                    .map(|list| list.iter().filter_map(Value::as_str).map(str::to_owned).collect())
                    .unwrap_or_default(),
            ),
        );
    }
    let mut candidates = vec![];
    for (key, members) in groups {
        if members.is_empty() {
            continue;
        }
        let mut counts: std::collections::HashMap<&str, usize> = Default::default();
        for (_, model) in &members {
            *counts.entry(model.as_str()).or_default() += 1;
        }
        let representative = counts
            .into_iter()
            .max_by_key(|(name, count)| (*count, name.len()))
            .map(|(name, _)| name.to_string())
            .unwrap_or_else(|| key.clone());
        let base_model = representative
            .rsplit('/')
            .next()
            .unwrap_or(&representative)
            .to_string();
        let member_ids = members.into_iter().map(|(id, _)| id).collect::<Vec<_>>();
        if let Some((id, name, model, mut targets)) = existing_by_key.get(&key).cloned() {
            let before = targets.len();
            for member in &member_ids {
                if !targets.contains(member) {
                    targets.push(member.clone());
                }
            }
            let generated_name =
                name == model || looks_generated_auto_name(&name, &base_model);
            let model_changed = model != base_model;
            if targets.len() == before && !generated_name && !model_changed {
                continue;
            }
            candidates.push(json!({
                "id": id,
                "model": base_model,
                "displayName": if generated_name { format!("{base_model}[auto]") } else { name },
                "targets": targets,
                "auto": true,
            }));
        } else {
            candidates.push(json!({
                "model": base_model,
                "displayName": format!("{base_model}[auto]"),
                "targets": member_ids,
                "auto": true,
            }));
        }
    }
    if v.apply {
        for candidate in &candidates {
            let id = candidate["id"].as_str().map(str::to_owned).unwrap_or_else(super::id);
            let model = candidate["model"].as_str().unwrap_or("");
            let group = resources::model_group_key(model);
            let stale = {
                let c = conn(&app.db)?;
                let mut statement =
                    c.prepare("SELECT id,model FROM hub_model_routes WHERE user_id=?1 AND auto=1")?;
                let rows = statement
                    .query_map([&user.id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            for (stale_id, stale_model) in stale {
                if stale_id != id && resources::model_group_key(&stale_model) == group {
                    conn(&app.db)?.execute(
                        "DELETE FROM hub_model_routes WHERE id=?1 AND user_id=?2",
                        params![stale_id, &user.id],
                    )?;
                }
            }
            conn(&app.db)?.execute(
                "INSERT INTO hub_model_routes(id,user_id,display_name,model,targets,enabled,auto,created_at,updated_at)
                 VALUES(?1,?2,?3,?4,?5,1,1,?6,?6)
                 ON CONFLICT(id) DO UPDATE SET display_name=?3,model=?4,targets=?5,auto=1,updated_at=?6",
                params![
                    id,
                    &user.id,
                    candidate["displayName"].as_str().unwrap_or(""),
                    model,
                    json_text(&candidate["targets"]),
                    now()
                ],
            )?;
        }
    }
    audit(
        &app.db,
        &user.id,
        if v.apply {
            "modelRoute.detectApply"
        } else {
            "modelRoute.detect"
        },
        "",
        json!({"count":candidates.len(),"includeAllModels":v.include_all_models}),
    )?;
    Ok(Json(json!({
        "candidates":candidates,
        "applied":v.apply,
        "includeAllModels":v.include_all_models
    })))
}

async fn create_application(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<ApplicationInput>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &v.resource_id)?;
    if r.owner_id == user.id {
        return Err(Error::bad("不能申请自己的供应商"));
    }
    if !r.published || r.disabled {
        return Err(Error::bad("该供应商当前不可申请"));
    }
    v.budget.validate()?;
    validate_requested_deadline(v.expires_at)?;
    let message = v.message.trim().to_string();
    if message.chars().count() > 500 {
        return Err(Error::bad("申请说明过长"));
    }
    let models = normalize_application_models(&r, &v.models)?;
    let auto = auto_approve_budget(&app.db, &r, &v.budget)?;
    let state = if auto.is_some() { "approved" } else { "pending" };
    let auto_decided = auto.is_some();
    let decided_models_text = if auto_decided {
        json_text(&models)
    } else {
        "[]".to_string()
    };
    let decided_budget_text = if auto_decided {
        json_text(&v.budget)
    } else {
        "{}".to_string()
    };
    let application_id = super::id();
    conn(&app.db)?
        .execute(
            "INSERT INTO hub_applications(id,resource_id,applicant_id,owner_id,message,budget,models,state,created_at,decided_at,decided_by,
                    requested_expires_at,decided_expires_at,decided_models,decided_budget,decision_kind)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                application_id,
                r.id,
                &user.id,
                r.owner_id,
                message,
                json_text(&v.budget),
                json_text(&models),
                state,
                now(),
                auto.as_ref().map(|_| now()),
                auto.as_ref().map(|_| "auto"),
                v.expires_at,
                if auto_decided { v.expires_at } else { None },
                decided_models_text,
                decided_budget_text,
                if auto_decided { "auto" } else { "" },
            ],
        )
        .map_err(|error| {
            if error.to_string().contains("UNIQUE") {
                Error::bad("你已提交过申请，请在额度分配页查看进度")
            } else {
                Error::from(error)
            }
        })?;
    if auto.is_some() {
        conn(&app.db)?.execute(
            "INSERT INTO hub_grants(resource_id,user_id,allowed,budget,models,expires_at)
             VALUES(?1,?2,1,?3,?4,?5)
             ON CONFLICT(resource_id,user_id) DO UPDATE SET allowed=1,budget=?3,models=?4,expires_at=?5",
            params![
                r.id,
                &user.id,
                json_text(&v.budget),
                json_text(&models),
                v.expires_at
            ],
        )?;
    }
    audit(
        &app.db,
        &user.id,
        if auto.is_some() {
            "application.auto_approve"
        } else {
            "application.create"
        },
        &r.id,
        json!({"applicationId":application_id,"budget":v.budget,"models":models,"expiresAt":v.expires_at}),
    )?;
    Ok(Json(json!({"id":application_id,"state":state})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplicationDecision {
    approve: bool,
    #[serde(default)]
    budget: Budget,
    #[serde(default)]
    models: Vec<String>,
    /// 批阅后实际生效的时间截止；留空表示不限时间。
    #[serde(default)]
    expires_at: Option<i64>,
    /// 批阅说明，驳回或修改参数时用来解释原因。
    #[serde(default)]
    note: String,
}

async fn decide_application(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(application): Path<String>,
    Json(v): Json<ApplicationDecision>,
) -> Result<Json<Value>> {
    let (resource_id, applicant_id, state, requested_models, requested_expires, requested_budget): (
        String,
        String,
        String,
        String,
        Option<i64>,
        String,
    ) = conn(&app.db)?
        .query_row(
            "SELECT resource_id,applicant_id,state,models,requested_expires_at,budget FROM hub_applications WHERE id=?1",
            [&application],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| Error::bad("申请不存在"))?;
    let r = resources::get(&app.db, &resource_id)?;
    resources::own(&user, &r)?;
    if state != "pending" {
        return Err(Error::bad("该申请已处理"));
    }
    let note = v.note.trim().to_string();
    if note.chars().count() > 300 {
        return Err(Error::bad("批阅说明过长"));
    }
    let mut models = v.models.clone();
    if v.approve {
        v.budget.validate()?;
        validate_requested_deadline(v.expires_at)?;
        models = normalize_application_models(&r, &v.models)?;
        conn(&app.db)?.execute(
            "INSERT INTO hub_grants(resource_id,user_id,allowed,budget,models,expires_at)
             VALUES(?1,?2,1,?3,?4,?5)
             ON CONFLICT(resource_id,user_id) DO UPDATE SET allowed=1,budget=?3,models=?4,expires_at=?5",
            params![
                resource_id,
                applicant_id,
                json_text(&v.budget),
                json_text(&models),
                v.expires_at
            ],
        )?;
    }
    let requested_models = parse::<Vec<String>>(&requested_models);
    let requested_budget = parse::<Budget>(&requested_budget);
    let kind = if !v.approve {
        "reject"
    } else if models != requested_models
        || v.expires_at != requested_expires
        || v.budget != requested_budget
    {
        "modify"
    } else {
        "approve"
    };
    conn(&app.db)?.execute(
        "UPDATE hub_applications SET state=?2,decided_at=?3,decided_by=?4,decided_expires_at=?5,
                decided_models=?6,decided_budget=?7,decision_kind=?8,decision_note=?9 WHERE id=?1",
        params![
            application,
            if v.approve { "approved" } else { "rejected" },
            now(),
            &user.id,
            if v.approve { v.expires_at } else { None },
            json_text(&models),
            if v.approve { json_text(&v.budget) } else { "{}".to_string() },
            kind,
            note
        ],
    )?;
    audit(
        &app.db,
        &user.id,
        if v.approve {
            "application.approve"
        } else {
            "application.reject"
        },
        &application,
        json!({
            "resourceId":resource_id,
            "applicantId":applicant_id,
            "budget":v.budget,
            "models":models,
            "expiresAt":if v.approve { v.expires_at } else { None },
            "expiresAtBefore":requested_expires,
            "kind":kind,
            "note":note,
        }),
    )?;
    Ok(Json(json!({"ok":true})))
}

async fn cancel_application(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(application): Path<String>,
) -> Result<Json<Value>> {
    let changed = conn(&app.db)?.execute(
        "DELETE FROM hub_applications WHERE id=?1 AND applicant_id=?2 AND state='pending'",
        params![application, &user.id],
    )?;
    if changed == 0 {
        return Err(Error::bad("申请不存在或已处理"));
    }
    Ok(Json(json!({"ok":true})))
}

/// 登录后的提醒：待我审批的申请数量。
async fn notices(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    let pending: i64 = conn(&app.db)?.query_row(
        "SELECT COUNT(*) FROM hub_applications WHERE owner_id=?1 AND state='pending'",
        [&user.id],
        |row| row.get(0),
    )?;
    Ok(Json(json!({"pendingApplications":pending})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountDeletion {
    password: String,
}

/// 注销自己的账号：清理个人数据并停用账号，管理员账号不允许自助注销。
async fn delete_account(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<AccountDeletion>,
) -> Result<Response> {
    use argon2::{Argon2, PasswordHash, PasswordVerifier};
    if user.role == "admin" {
        return Err(Error::bad(
            "管理员账号不能自助注销，请先在“用户与额度”里移交或删除该账号",
        ));
    }
    let db = app.db.clone();
    let uid = user.id.clone();
    tokio::task::spawn_blocking({
        let password = v.password.clone();
        move || -> Result<()> {
            let current: Option<String> = conn(&db)?
                .query_row(
                    "SELECT password_hash FROM hub_users WHERE id=?1",
                    [&uid],
                    |row| row.get(0),
                )
                .optional()?;
            let ok = current
                .as_deref()
                .and_then(|hash| PasswordHash::new(hash).ok())
                .is_some_and(|parsed| {
                    Argon2::default()
                        .verify_password(password.as_bytes(), &parsed)
                        .is_ok()
                });
            if !ok {
                return Err(Error::bad("密码错误，无法注销账号"));
            }
            Ok(())
        }
    })
    .await
    .map_err(|_| Error::bad("注销失败，请稍后重试"))??;

    // 先清掉自己名下的官方账号登录态，避免授权中心残留。
    let accounts: Vec<String> = {
        let c = conn(&app.db)?;
        let mut statement =
            c.prepare("SELECT account_id FROM hub_account_owners WHERE owner_id=?1")?;
        let rows = statement
            .query_map([&user.id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    for account in accounts {
        let _ = app
            .codex_oauth_state
            .read()
            .await
            .remove_account(&account)
            .await;
    }

    let owned: Vec<String> = resources::all(&app.db)?
        .into_iter()
        .filter(|resource| resource.owner_id == user.id)
        .map(|resource| resource.id)
        .collect();
    for resource in owned {
        purge_resource(&app, &user.id, &resource).await?;
    }

    {
        let mut c = conn(&app.db)?;
        let tx = c.transaction()?;
        tx.execute(
            "DELETE FROM hub_grants WHERE user_id=?1 OR resource_id IN
             (SELECT id FROM hub_resources WHERE owner_id=?1)",
            [&user.id],
        )?;
        tx.execute(
            "DELETE FROM hub_applications WHERE applicant_id=?1 OR owner_id=?1",
            [&user.id],
        )?;
        tx.execute(
            "DELETE FROM hub_share_claims WHERE user_id=?1 OR share_id IN
             (SELECT id FROM hub_share_codes WHERE created_by=?1)",
            [&user.id],
        )?;
        tx.execute("DELETE FROM hub_share_codes WHERE created_by=?1", [&user.id])?;
        tx.execute("DELETE FROM hub_sessions WHERE user_id=?1", [&user.id])?;
        tx.execute("DELETE FROM hub_api_keys WHERE user_id=?1", [&user.id])?;
        tx.execute("DELETE FROM hub_preferences WHERE user_id=?1", [&user.id])?;
        tx.execute(
            "DELETE FROM hub_account_owners WHERE owner_id=?1",
            [&user.id],
        )?;
        tx.execute(
            "UPDATE hub_users SET active=0,password_hash=NULL,budget='{}',username=?2 WHERE id=?1",
            params![&user.id, format!("deleted-{}", &user.id)],
        )?;
        tx.commit()?;
    }
    audit(&app.db, &user.id, "user.delete", &user.id, json!({}))?;
    Ok((
        [(
            header::SET_COOKIE,
            auth::session_cookie("", 0, public_url(&app.db).starts_with("https://")),
        )],
        Json(json!({"ok":true})),
    )
        .into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShareCodeInput {
    #[serde(default)]
    budget: Budget,
    #[serde(default)]
    models: Vec<String>,
    expires_at: Option<i64>,
    #[serde(default = "default_max_claims")]
    max_claims: i64,
}

fn default_max_claims() -> i64 {
    1
}

fn share_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "resourceId": row.get::<_, String>(1)?,
        "resourceName": row.get::<_, String>(2)?,
        "budget": parse::<Budget>(&row.get::<_, String>(3)?),
        "models": parse::<Vec<String>>(&row.get::<_, String>(4)?),
        "expiresAt": row.get::<_, Option<i64>>(5)?,
        "maxClaims": row.get::<_, i64>(6)?,
        "claimedCount": row.get::<_, i64>(7)?,
        "active": row.get::<_, bool>(8)?,
        "createdAt": row.get::<_, i64>(9)?,
    }))
}

async fn share_codes(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    let c = conn(&app.db)?;
    let mut statement = c.prepare(
        "SELECT s.id,s.resource_id,p.name,s.budget,s.models,s.expires_at,s.max_claims,s.claimed_count,s.active,s.created_at
         FROM hub_share_codes s
         JOIN hub_resources r ON r.id=s.resource_id
         JOIN providers p ON p.id=r.provider_id AND p.app_type=r.app_type
         WHERE s.created_by=?1
         ORDER BY s.created_at DESC,s.id DESC",
    )?;
    let rows = statement
        .query_map([&user.id], share_view)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(Json(json!(rows)))
}

async fn create_share_code(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
    Json(v): Json<ShareCodeInput>,
) -> Result<Json<Value>> {
    v.budget.validate()?;
    if !(1..=1_000_000).contains(&v.max_claims) {
        return Err(Error::bad("可领取次数须为 1—1000000"));
    }
    if v.expires_at.is_some_and(|expires| expires <= now()) {
        return Err(Error::bad("分享口令的到期时间必须晚于当前时间"));
    }
    if v.models.len() > 500 || v.models.iter().any(|model| model.len() > 200) {
        return Err(Error::bad("允许的模型列表过长"));
    }
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    if r.disabled {
        return Err(Error::bad("供应商已停用，无法创建分享口令"));
    }
    let available = resources::visible_model_slugs(&r)
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
    if v.models
        .iter()
        .any(|model| !available.contains(model.as_str()))
    {
        return Err(Error::bad("分享口令包含该供应商未共享的模型"));
    }

    let token = auth::secret();
    let share_id = id();
    let created_at = now();
    conn(&app.db)?.execute(
        "INSERT INTO hub_share_codes(id,resource_id,created_by,token_hash,budget,models,expires_at,max_claims,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            share_id,
            r.id,
            user.id,
            auth::hash(&token),
            json_text(&v.budget),
            json_text(&v.models),
            v.expires_at,
            v.max_claims,
            created_at
        ],
    )?;
    audit(
        &app.db,
        &user.id,
        "share.create",
        &share_id,
        json!({"resourceId":r.id,"maxClaims":v.max_claims,"expiresAt":v.expires_at}),
    )?;
    Ok(Json(json!({
        "id": share_id,
        "resourceId": r.id,
        "resourceName": r.name,
        "token": token,
        "url": format!("{}/?claim={}", public_url(&app.db), token),
        "budget": v.budget,
        "models": v.models,
        "expiresAt": v.expires_at,
        "maxClaims": v.max_claims,
        "claimedCount": 0,
        "active": true,
        "createdAt": created_at,
    })))
}

async fn revoke_share_code(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(share): Path<String>,
) -> Result<Json<Value>> {
    let changed = conn(&app.db)?.execute(
        "UPDATE hub_share_codes SET active=0 WHERE id=?1 AND created_by=?2",
        params![share, user.id],
    )?;
    if changed == 0 {
        return Err(Error::forbidden());
    }
    audit(
        &app.db,
        &user.id,
        "share.revoke",
        &share,
        json!({}),
    )?;
    Ok(Json(json!({"ok":true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClaimShare {
    token: String,
}

async fn claim_share(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<ClaimShare>,
) -> Result<Json<Value>> {
    Ok(Json(claim_share_code(&app, &user, &v.token)?))
}

pub(super) fn claim_share_code(
    app: &AppState,
    user: &Identity,
    token: &str,
) -> Result<Value> {
    let token = token.trim();
    if !(16..=256).contains(&token.len()) {
        return Err(Error::bad("分享口令无效或已失效"));
    }
    let mut c = conn(&app.db)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let row: Option<(String, String, String, String, String, Option<i64>, i64, i64, bool)> = tx
        .query_row(
            "SELECT s.id,s.resource_id,p.name,s.budget,s.models,s.expires_at,s.max_claims,s.claimed_count,s.active
             FROM hub_share_codes s
             JOIN hub_resources r ON r.id=s.resource_id AND r.deleted=0
             JOIN providers p ON p.id=r.provider_id AND p.app_type=r.app_type
             WHERE s.token_hash=?1",
            [auth::hash(token)],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .optional()?;
    let (share_id, resource_id, resource_name, budget, models, expires_at, max_claims, claimed, active) =
        row.ok_or_else(|| Error::bad("分享口令无效或已失效"))?;
    if !active
        || expires_at.is_some_and(|expires| expires <= now())
        || claimed >= max_claims
    {
        return Err(Error::bad("分享口令已失效或已被领完"));
    }
    let (owner_id, published, disabled): (String, bool, bool) = tx.query_row(
        "SELECT owner_id,published,disabled FROM hub_resources WHERE id=?1 AND deleted=0",
        [&resource_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if owner_id == user.id {
        return Err(Error::bad("不能领取自己创建的分享口令"));
    }
    if !published || disabled {
        return Err(Error::bad("该供应商暂时不可领取"));
    }
    let already_claimed: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM hub_share_claims WHERE share_id=?1 AND user_id=?2)",
        params![share_id, user.id],
        |row| row.get(0),
    )?;
    if already_claimed {
        return Err(Error::bad("你已经领取过该分享口令"));
    }
    let changed = tx.execute(
        "UPDATE hub_share_codes
         SET claimed_count=claimed_count+1
         WHERE id=?1 AND active=1 AND claimed_count<max_claims
           AND (expires_at IS NULL OR expires_at>?2)",
        params![share_id, now()],
    )?;
    if changed != 1 {
        return Err(Error::bad("分享口令已失效或已被领完"));
    }
    tx.execute(
        "INSERT INTO hub_share_claims(share_id,user_id,claimed_at) VALUES(?1,?2,?3)",
        params![share_id, user.id, now()],
    )?;
    tx.execute(
        "INSERT INTO hub_grants(resource_id,user_id,allowed,budget,models,expires_at)
         VALUES(?1,?2,1,?3,?4,?5)
         ON CONFLICT(resource_id,user_id) DO UPDATE
         SET allowed=1,budget=?3,models=?4,expires_at=?5",
        params![resource_id, user.id, budget, models, expires_at],
    )?;
    tx.commit()?;
    drop(c);
    audit(
        &app.db,
        &user.id,
        "share.claim",
        &share_id,
        json!({"resourceId":resource_id}),
    )?;
    Ok(json!({
        "resourceId": resource_id,
        "resourceName": resource_name,
        "budget": parse::<Budget>(&budget),
        "models": parse::<Vec<String>>(&models),
        "expiresAt": expires_at,
    }))
}

fn bucket_usage(db: &crate::database::Database, bucket: &str) -> Result<Value> {
    let c = conn(db)?;
    let usage = c
        .query_row(
            "SELECT used_requests,used_tokens,used_credits,reserved_requests,reserved_tokens,reserved_credits
             FROM hub_buckets WHERE id=?1",
            [bucket],
            |row| {
                Ok(json!({
                    "requests": row.get::<_, i64>(0)?,
                    "tokens": row.get::<_, i64>(1)?,
                    "credits": row.get::<_, i64>(2)?,
                    "reservedRequests": row.get::<_, i64>(3)?,
                    "reservedTokens": row.get::<_, i64>(4)?,
                    "reservedCredits": row.get::<_, i64>(5)?,
                }))
            },
        )
        .optional()?
        .unwrap_or_else(|| {
            json!({
                "requests": 0,
                "tokens": 0,
                "credits": 0,
                "reservedRequests": 0,
                "reservedTokens": 0,
                "reservedCredits": 0,
            })
        });
    Ok(usage)
}

fn remaining_budget(budget: &Budget, usage: &Value) -> Value {
    let remaining = |limit: Option<i64>, used: &str, reserved: &str| {
        limit.map(|limit| {
            (limit
                - usage.get(used).and_then(Value::as_i64).unwrap_or(0)
                - usage.get(reserved).and_then(Value::as_i64).unwrap_or(0))
            .max(0)
        })
    };
    json!({
        "requests": remaining(budget.requests, "requests", "reservedRequests"),
        "tokens": remaining(budget.tokens, "tokens", "reservedTokens"),
        "credits": remaining(budget.credits, "credits", "reservedCredits"),
    })
}

async fn profile_overview(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    let usage = metering::remaining(&app.db, &user)?;
    let mut suppliers = Vec::new();
    for r in resources::all(&app.db)? {
        let owned = r.owner_id == user.id;
        let period_key = metering::period(&r.policy.period);
        let grant_usage = bucket_usage(
            &app.db,
            &format!("grant:{}:{}:{}", r.id, user.id, period_key),
        )?;
        let shared_usage =
            bucket_usage(&app.db, &format!("shared:{}:{}", r.id, period_key))?;
        let (budget, supplier_usage, balance_kind) = if owned {
            (
                r.policy.shared_budget.clone(),
                shared_usage.clone(),
                "sharedPool",
            )
        } else {
            let budget = match resources::grant(&app.db, &user, &r, None) {
                Ok(budget) => budget,
                Err(_) => continue,
            };
            (budget, grant_usage, "personalGrant")
        };
        suppliers.push(json!({
            "id": r.id,
            "name": r.name,
            "appType": r.app_type,
            "ownerId": r.owner_id,
            "ownerName": r.owner_name,
            "owned": owned,
            "period": r.policy.period,
            "periodKey": period_key,
            "budget": budget,
            "usage": supplier_usage,
            "remaining": remaining_budget(&budget, &supplier_usage),
            "balanceKind": balance_kind,
            "sharedBudget": r.policy.shared_budget,
            "sharedUsage": shared_usage,
        }));
    }
    suppliers.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or_default()
            .cmp(b["name"].as_str().unwrap_or_default())
    });
    Ok(Json(json!({"usage":usage,"suppliers":suppliers})))
}

async fn refresh_models(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    let rows = catalog::refresh(&app, &user, &r).await?;
    let updated = resources::get(&app.db, &resource)?;
    prune_model_routes_for_resource(&app.db, &updated)?;
    audit(
        &app.db,
        &user.id,
        "models.refresh",
        &resource,
        json!({"count":rows.len()}),
    )?;
    Ok(Json(json!(rows)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelsInput {
    models: Vec<Value>,
}

async fn save_models(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
    Json(v): Json<ModelsInput>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    if v.models.len() > 1000 {
        return Err(Error::bad("模型数量不能超过 1000 个"));
    }
    let rows = catalog::rows_from_values(&v.models, &r.models)?;
    if rows.is_empty() {
        return Err(Error::bad("至少保留一个模型"));
    }
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET models=?1,health='ready',cooldown_until=0 WHERE id=?2",
        params![json_text(&rows), resource],
    )?;
    let updated = resources::get(&app.db, &resource)?;
    prune_model_routes_for_resource(&app.db, &updated)?;
    audit(
        &app.db,
        &user.id,
        "models.save",
        &resource,
        json!({"count":rows.len()}),
    )?;
    Ok(Json(json!(rows)))
}
fn prune_model_routes_for_resource(
    db: &crate::database::Database,
    resource: &resources::Resource,
) -> Result<()> {
    let rows = {
        let c = conn(db)?;
        let mut statement = c.prepare(
            "SELECT id,model,targets FROM hub_model_routes WHERE targets LIKE ?1",
        )?;
        let result = statement
            .query_map([format!("%{}%", resource.id)], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    parse::<Vec<String>>(&row.get::<_, String>(2)?),
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        result
    };
    for (id, model, mut targets) in rows {
        if !targets.contains(&resource.id)
            || resource
                .models
                .iter()
                .any(|item| item["slug"].as_str() == Some(model.as_str()))
        {
            continue;
        }
        targets.retain(|target| target != &resource.id);
        if targets.is_empty() {
            conn(db)?.execute("DELETE FROM hub_model_routes WHERE id=?1", [&id])?;
        } else {
            conn(db)?.execute(
                "UPDATE hub_model_routes SET targets=?1,updated_at=?2 WHERE id=?3",
                params![json_text(&targets), now(), id],
            )?;
        }
    }
    Ok(())
}

async fn resource_usage(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    if r.owner_id != user.id && !user.admin() {
        return Err(Error::forbidden());
    }
    let buckets = query_json(
        &*conn(&app.db)?,
        "SELECT * FROM hub_buckets WHERE id LIKE ?1 OR id LIKE ?2",
        &[&format!("grant:{}:%", r.id), &format!("shared:{}:%", r.id)],
    )?;
    Ok(Json(json!(buckets)))
}
#[derive(Default, Deserialize)]
struct CatalogQuery {
    all: Option<bool>,
}
async fn catalog(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Query(q): Query<CatalogQuery>,
) -> Result<Json<Value>> {
    Ok(Json(catalog::export(
        &app.db,
        &user,
        !q.all.unwrap_or(false),
    )?))
}
/// 安装脚本模板：优先读取磁盘文件（改文案不用重新编译），读不到时回退到内嵌版本。
pub(crate) fn installer_template() -> String {
    let configured = std::env::var("CC_SWITCH_INSTALL_SCRIPT").ok();
    let candidates = configured.into_iter().chain(std::iter::once(
        "/opt/cc-switch-web/cc-switch-update-models.sh".to_string(),
    ));
    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            return content;
        }
    }
    include_str!("../../scripts/cc-switch-update-models.sh").to_string()
}

pub fn installer_response(db: &crate::database::Database, headers: &HeaderMap) -> Result<Response> {
    let token =
        auth::bearer(headers).ok_or_else(|| Error::bad("请使用设备 API Key 下载接入脚本"))?;
    // Authenticate bearer separately: a cookie must not launder an arbitrary token
    // into the generated script.
    let mut only_key = HeaderMap::new();
    only_key.insert(
        header::AUTHORIZATION,
        headers[header::AUTHORIZATION].clone(),
    );
    auth::authenticate(db, &only_key, true)?;
    let escaped = |s: &str| {
        s.replace('\\', "\\\\")
            .replace('$', "\\$")
            .replace('`', "\\`")
            .replace('"', "\\\"")
    };
    let script = installer_template()
        .replace("__CC_SWITCH_ORIGIN__", &escaped(&public_url(db)))
        .replace("__CC_SWITCH_ACCESS_KEY__", &escaped(token))
        .replace("__CC_SWITCH_PROXY_URL__", &escaped(&proxy_url(db)));
    Ok((
        [
            (header::CONTENT_TYPE, "text/x-shellscript; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=ccswitchuint-install.sh",
            ),
        ],
        script,
    )
        .into_response())
}
async fn installer(State(app): State<Arc<AppState>>, headers: HeaderMap) -> Result<Response> {
    installer_response(&app.db, &headers)
}
async fn directory(State(app): State<Arc<AppState>>) -> Result<Json<Value>> {
    Ok(Json(json!(query_json(
        &*conn(&app.db)?,
        "SELECT id,username FROM hub_users WHERE active=1 AND role!='legacy' ORDER BY username",
        &[]
    )?)))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageQuery {
    scope: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    page: Option<i64>,
    group: Option<String>,
    user_id: Option<String>,
    resource_id: Option<String>,
    model: Option<String>,
}
fn scope(user: &Identity, q: &UsageQuery) -> Result<(String, Vec<rusqlite::types::Value>)> {
    let mut clause = String::from("r.created_at>=? AND r.created_at<=?");
    let mut args = vec![
        (q.from.unwrap_or(now() - 30 * 86400)).into(),
        q.to.unwrap_or(now()).into(),
    ];
    match q.scope.as_deref().unwrap_or("mine") {
        "mine" => {
            clause.push_str(" AND r.user_id=?");
            args.push(user.id.clone().into());
        }
        "provided" => {
            clause.push_str(" AND r.owner_id=?");
            args.push(user.id.clone().into());
        }
        "all" => admin(user)?,
        _ => return Err(Error::bad("无效的统计范围")),
    }
    if let Some(uid) = &q.user_id {
        clause.push_str(" AND r.user_id=?");
        args.push(uid.clone().into());
    }
    if let Some(resource) = &q.resource_id {
        clause.push_str(" AND r.resource_id=?");
        args.push(resource.clone().into());
    }
    if let Some(model) = &q.model {
        clause.push_str(" AND r.request_model=?");
        args.push(model.clone().into());
    }
    Ok((clause, args))
}
const AGG:&str="COUNT(*) AS requests,COALESCE(SUM(CASE WHEN r.state='completed' THEN 1 ELSE 0 END),0) AS successful,COALESCE(SUM(CASE WHEN r.state='pending_usage' THEN 1 ELSE 0 END),0) AS pending,COALESCE(SUM(r.input_tokens),0) AS input_tokens,COALESCE(SUM(r.output_tokens),0) AS output_tokens,COALESCE(SUM(r.cache_read_tokens),0) AS cache_read_tokens,COALESCE(SUM(r.cache_creation_tokens),0) AS cache_creation_tokens,COALESCE(SUM(r.cost_credits),0) AS cost_credits,COALESCE(SUM(CASE WHEN r.cost_credits IS NULL THEN 1 ELSE 0 END),0) AS unknown_cost,COALESCE(AVG(r.latency_ms),0) AS latency_ms";
fn stats(db: &crate::database::Database, user: &Identity, q: &UsageQuery) -> Result<Value> {
    let (filter, args) = scope(user, q)?;
    let refs = args
        .iter()
        .map(|v| v as &dyn rusqlite::ToSql)
        .collect::<Vec<_>>();
    let c = conn(db)?;
    let summary = query_json(
        &c,
        &format!("SELECT {AGG} FROM hub_requests r WHERE {filter}"),
        &refs,
    )?;
    let group = match q.group.as_deref().unwrap_or("day") {
        "day" => "date(r.created_at,'unixepoch')",
        "model" => "r.request_model",
        "provider" => "COALESCE(r.provider_name,'未路由')",
        "user" => "COALESCE(u.username,'迁移前用户')",
        "device" => "r.device",
        _ => return Err(Error::bad("无效的统计分组")),
    };
    let groups=query_json(&c,&format!("SELECT {group} AS label,{AGG} FROM hub_requests r JOIN hub_users u ON u.id=r.user_id WHERE {filter} GROUP BY {group} ORDER BY label"),&refs)?;
    Ok(
        json!({"summary":summary.first(),"groups":groups,"scope":q.scope.as_deref().unwrap_or("mine"),"timezone":"UTC","source":"gateway","creditsPerUsd":1000000}),
    )
}
async fn usage(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Query(q): Query<UsageQuery>,
) -> Result<Json<Value>> {
    Ok(Json(stats(&app.db, &user, &q)?))
}
async fn requests(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Query(q): Query<UsageQuery>,
) -> Result<Json<Value>> {
    let (filter, mut args) = scope(&user, &q)?;
    let total: i64 = {
        let c = conn(&app.db)?;
        let refs = args
            .iter()
            .map(|v| v as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        c.query_row(
            &format!("SELECT COUNT(*) FROM hub_requests r WHERE {filter}"),
            refs.as_slice(),
            |r| r.get(0),
        )?
    };
    let page = q.page.unwrap_or(1).clamp(1, 1000000);
    args.push(((page - 1) * 30).into());
    let refs = args
        .iter()
        .map(|v| v as &dyn rusqlite::ToSql)
        .collect::<Vec<_>>();
    let rows=query_json(&*conn(&app.db)?,&format!("SELECT r.*,u.username FROM hub_requests r JOIN hub_users u ON u.id=r.user_id WHERE {filter} ORDER BY r.created_at DESC,r.id DESC LIMIT 30 OFFSET ?"),&refs)?;
    Ok(Json(
        json!({"data":rows,"total":total,"page":page,"pageSize":30}),
    ))
}
async fn request_detail(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(request): Path<String>,
) -> Result<Json<Value>> {
    let c = conn(&app.db)?;
    let row = query_json(
        &c,
        "SELECT * FROM hub_requests WHERE id=?1 AND (user_id=?2 OR owner_id=?2 OR ?3=1)",
        &[&request, &user.id, &user.admin()],
    )?
    .into_iter()
    .next()
    .ok_or_else(Error::forbidden)?;
    let all_attempts = user.admin() || row["user_id"] == user.id;
    let attempts = query_json(
        &c,
        "SELECT * FROM hub_attempts WHERE request_id=?1 AND (?2=1 OR owner_id=?3)",
        &[&request, &all_attempts, &user.id],
    )?;
    Ok(Json(json!({"request":row,"attempts":attempts})))
}
async fn export_usage(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Query(q): Query<UsageQuery>,
) -> Result<Response> {
    Ok((
        [
            (header::CONTENT_TYPE, "application/json"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=ccswitchuint-usage.json",
            ),
        ],
        json_text(&stats(&app.db, &user, &q)?),
    )
        .into_response())
}

async fn accounts(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    let all = crate::commands::auth_list_accounts_internal(
        "codex_oauth",
        &app.copilot_auth_state,
        &app.codex_oauth_state,
        &app.xai_oauth_state,
    )
    .await
    .map_err(|_| Error::bad("账号读取失败"))?;
    let c = conn(&app.db)?;
    let own=query_json(&c,"SELECT account_id FROM hub_account_owners WHERE owner_id=?1 AND auth_provider='codex_oauth'",&[&user.id])?;
    Ok(Json(json!(all
        .into_iter()
        .filter(|a| own.iter().any(|r| r["account_id"] == a.id))
        .collect::<Vec<_>>())))
}
fn owns_account(db: &crate::database::Database, user: &Identity, account: &str) -> Result<()> {
    let owner:Option<String>=conn(db)?.query_row("SELECT owner_id FROM hub_account_owners WHERE account_id=?1 AND auth_provider='codex_oauth'",[account],|r|r.get(0)).optional()?;
    if owner.as_deref() != Some(user.id.as_str()) {
        return Err(Error::forbidden());
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginAccount {
    target_account_id: Option<String>,
}
async fn account_login(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<LoginAccount>,
) -> Result<Json<Value>> {
    if let Some(account) = &v.target_account_id {
        owns_account(&app.db, &user, account)?;
    }
    let flow = crate::commands::auth_start_login_internal(
        "codex_oauth",
        v.target_account_id.as_deref(),
        &app.copilot_auth_state,
        &app.codex_oauth_state,
        &app.xai_oauth_state,
    )
    .await
    .map_err(|_| Error::bad("官方授权暂时不可用"))?;
    conn(&app.db)?.execute("INSERT INTO hub_oauth_flows(device_hash,owner_id,expires_at,auth_provider,target_account_id) VALUES(?1,?2,?3,'codex_oauth',?4)",params![auth::hash(&flow.device_code),user.id,now()+flow.expires_in as i64,v.target_account_id])?;
    Ok(Json(json!(flow)))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceCode {
    device_code: String,
}
fn check_flow(db: &crate::database::Database, user: &Identity, code: &str) -> Result<()> {
    let valid:bool=conn(db)?.query_row("SELECT EXISTS(SELECT 1 FROM hub_oauth_flows WHERE device_hash=?1 AND owner_id=?2 AND expires_at>?3)",params![auth::hash(code),user.id,now()],|r|r.get(0))?;
    if !valid {
        return Err(Error::forbidden());
    }
    Ok(())
}
async fn account_poll(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<DeviceCode>,
) -> Result<Json<Value>> {
    check_flow(&app.db, &user, &v.device_code)?;
    let account = crate::commands::auth_poll_for_account_internal(
        "codex_oauth",
        &v.device_code,
        &app.proxy_service,
        &app.copilot_auth_state,
        &app.codex_oauth_state,
        &app.xai_oauth_state,
    )
    .await
    .map_err(|_| Error::bad("授权失败或已过期，请重新登录"))?;
    if let Some(account) = &account {
        let c = conn(&app.db)?;
        c.execute("INSERT OR IGNORE INTO hub_account_owners(account_id,auth_provider,owner_id) VALUES(?1,'codex_oauth',?2)",params![account.id,user.id])?;
        let owner:String=c.query_row("SELECT owner_id FROM hub_account_owners WHERE account_id=?1 AND auth_provider='codex_oauth'",[&account.id],|r|r.get(0))?;
        if owner != user.id {
            return Err(Error::bad("该官方账号已绑定其他平台用户，请联系管理员"));
        }
        c.execute(
            "DELETE FROM hub_oauth_flows WHERE device_hash=?1",
            [auth::hash(&v.device_code)],
        )?;
        c.execute(
            "UPDATE hub_resources SET health='ready',cooldown_until=0 WHERE account_id=?1",
            [&account.id],
        )?;
        drop(c);
        audit(&app.db, &user.id, "account.login", &account.id, json!({}))?;
    }
    Ok(Json(json!({"account":account})))
}
async fn account_cancel(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<DeviceCode>,
) -> Result<Json<Value>> {
    check_flow(&app.db, &user, &v.device_code)?;
    let _ = crate::commands::auth_cancel_login_internal(
        "codex_oauth",
        &v.device_code,
        &app.codex_oauth_state,
    )
    .await;
    conn(&app.db)?.execute(
        "DELETE FROM hub_oauth_flows WHERE device_hash=?1",
        [auth::hash(&v.device_code)],
    )?;
    Ok(Json(json!({"ok":true})))
}
async fn account_delete(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(account): Path<String>,
) -> Result<Json<Value>> {
    if owns_account(&app.db, &user, &account).is_err() {
        // 兼容旧授权中心遗留的孤立账号：只要没有被任何供应商引用就允许删除。
        let referenced: bool = conn(&app.db)?.query_row(
            "SELECT EXISTS(SELECT 1 FROM hub_resources WHERE account_id=?1 AND deleted=0)",
            [&account],
            |row| row.get(0),
        )?;
        if referenced {
            return Err(Error::forbidden());
        }
    }
    app.codex_oauth_state
        .read()
        .await
        .remove_account(&account)
        .await
        .map_err(|_| Error::bad("账号删除失败"))?;
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET published=0,health='removed',account_id=NULL WHERE account_id=?1",
        [&account],
    )?;
    conn(&app.db)?.execute(
        "DELETE FROM hub_account_owners WHERE account_id=?1 AND owner_id=?2",
        params![account, &user.id],
    )?;
    audit(&app.db, &user.id, "account.delete", &account, json!({}))?;
    Ok(Json(json!({"ok":true})))
}
async fn account_quota(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(account): Path<String>,
) -> Result<Json<Value>> {
    owns_account(&app.db, &user, &account)?;
    let quota =
        crate::commands::get_codex_oauth_quota_internal(Some(account), &app.codex_oauth_state)
            .await
            .map_err(|_| Error::bad("订阅额度读取失败"))?;
    Ok(Json(json!(quota)))
}
async fn users(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    admin(&user)?;
    Ok(Json(json!(query_json(&*conn(&app.db)?,"SELECT id,username,role,active,budget,period,rpm,concurrency,created_at FROM hub_users ORDER BY created_at",&[])?)))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UserUpdate {
    active: bool,
    budget: Budget,
    period: String,
    rpm: i64,
    concurrency: i64,
    new_password: Option<String>,
}
async fn update_user(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(uid): Path<String>,
    Json(v): Json<UserUpdate>,
) -> Result<Json<Value>> {
    admin(&user)?;
    v.budget.validate()?;
    if (!v.active && uid == user.id)
        || !["day", "month", "lifetime"].contains(&v.period.as_str())
        || !(0..=10000).contains(&v.rpm)
        || !(0..=1000).contains(&v.concurrency)
    {
        return Err(Error::bad("请检查用户状态、周期和限流设置"));
    }
    let password = v
        .new_password
        .as_deref()
        .map(auth::password_hash)
        .transpose()?;
    let mut c = conn(&app.db)?;
    let tx = c.transaction()?;
    tx.execute("UPDATE hub_users SET active=?1,budget=?2,period=?3,rpm=?4,concurrency=?5,password_hash=COALESCE(?6,password_hash) WHERE id=?7",params![v.active,json_text(&v.budget),v.period,v.rpm,v.concurrency,password,uid])?;
    if !v.active || password.is_some() {
        tx.execute("DELETE FROM hub_sessions WHERE user_id=?1", [&uid])?;
    }
    tx.commit()?;
    drop(c);
    audit(
        &app.db,
        &user.id,
        "user.update",
        &uid,
        json!({"active":v.active,"budget":v.budget,"period":v.period,"rpm":v.rpm,"concurrency":v.concurrency}),
    )?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct Disabled {
    disabled: bool,
}
async fn disable_resource(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
    Json(v): Json<Disabled>,
) -> Result<Json<Value>> {
    admin(&user)?;
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET disabled=?1 WHERE id=?2",
        params![v.disabled, resource],
    )?;
    audit(
        &app.db,
        &user.id,
        "resource.disable",
        &resource,
        json!({"disabled":v.disabled}),
    )?;
    Ok(Json(json!({"ok":true})))
}
async fn settings(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    admin(&user)?;
    Ok(Json(
        json!({"registration":auth::setting(&app.db,"registration","open"),"publicUrl":public_url(&app.db),"publicProxyUrl":proxy_url(&app.db)}),
    ))
}
async fn save_settings(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    admin(&user)?;
    for key in ["registration", "publicUrl", "publicProxyUrl"] {
        if let Some(value) = v.get(key).and_then(Value::as_str) {
            if key == "registration" {
                if !["open", "closed"].contains(&value) {
                    return Err(Error::bad("注册模式无效"));
                }
            } else {
                catalog::validate_upstream(value)?;
                if value.contains(['\'', '"', '\\', '\n', '\r', '$', '`']) {
                    return Err(Error::bad("无效的公开服务地址"));
                }
            }
            conn(&app.db)?.execute("INSERT INTO hub_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",params![key,value])?;
        }
    }
    audit(&app.db, &user.id, "settings.update", "platform", v)?;
    Ok(Json(json!({"ok":true})))
}
async fn audit_log(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
) -> Result<Json<Value>> {
    admin(&user)?;
    Ok(Json(json!(query_json(&*conn(&app.db)?,"SELECT a.*,u.username FROM hub_audit a LEFT JOIN hub_users u ON u.id=a.actor ORDER BY a.created_at DESC LIMIT 200",&[])?)))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reconcile {
    input: i64,
    output: i64,
    read: i64,
    write: i64,
    release_only: bool,
}
async fn reconcile(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(request): Path<String>,
    Json(v): Json<Reconcile>,
) -> Result<Json<Value>> {
    if [v.input, v.output, v.read, v.write]
        .iter()
        .any(|n| *n < 0 || *n > u32::MAX as i64)
    {
        return Err(Error::bad("无效的 token 数量"));
    }
    metering::reconcile(
        &app.db,
        &user,
        &request,
        metering::Usage {
            input: v.input,
            output: v.output,
            read: v.read,
            write: v.write,
            ..Default::default()
        },
        v.release_only,
    )?;
    Ok(Json(json!({"ok":true})))
}
