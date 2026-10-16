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
            "/api/unit/resources/:id/models/refresh",
            post(refresh_models),
        )
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
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
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
                || (r.published && resources::grant(&app.db, &user, r, None).is_ok())
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
    let rows = if v.models.is_empty() && previous.is_none() {
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
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET deleted=1,published=0 WHERE id=?1",
        [&resource],
    )?;
    audit(&app.db, &user.id, "resource.delete", &resource, json!({}))?;
    Ok(Json(json!({"ok":true})))
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
        return Err(Error::bad("请先添加或获取模型"));
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
async fn save_grant(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
    Json(v): Json<resources::Grant>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    resources::own(&user, &r)?;
    v.budget.validate()?;
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
async fn refresh_models(
    State(app): State<Arc<AppState>>,
    Extension(user): Extension<Identity>,
    Path(resource): Path<String>,
) -> Result<Json<Value>> {
    let r = resources::get(&app.db, &resource)?;
    let rows = catalog::refresh(&app, &user, &r).await?;
    audit(
        &app.db,
        &user.id,
        "models.refresh",
        &resource,
        json!({"count":rows.len()}),
    )?;
    Ok(Json(json!(rows)))
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
    let script = include_str!("../../scripts/cc-switch-update-models.sh")
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
    owns_account(&app.db, &user, &account)?;
    app.codex_oauth_state
        .read()
        .await
        .remove_account(&account)
        .await
        .map_err(|_| Error::bad("账号删除失败"))?;
    conn(&app.db)?.execute(
        "UPDATE hub_resources SET published=0,health='removed' WHERE account_id=?1",
        [&account],
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
        || !(1..=10000).contains(&v.rpm)
        || !(1..=1000).contains(&v.concurrency)
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
