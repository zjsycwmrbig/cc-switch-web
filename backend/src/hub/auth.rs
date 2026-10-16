use super::*;
use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::http::{header, HeaderMap};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

pub const COOKIE: &str = "ccswitchuint_session";
pub fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn secret() -> String {
    format!(
        "ccu_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub fn password_hash(password: &str) -> Result<String> {
    if password.chars().count() < 8 || password.len() > 256 {
        return Err(Error::bad("密码长度须为 8—256 个字符"));
    }
    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes())
        .map_err(|_| Error::bad("密码初始化失败"))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| Error::bad("密码初始化失败"))
}
pub fn username(value: &str) -> Result<String> {
    let value = value.trim().to_lowercase();
    if !(3..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(Error::bad("用户名须为 3—32 位字母、数字、下划线或连字符"));
    }
    Ok(value)
}
pub fn bearer(headers: &HeaderMap) -> Option<&str> {
    if headers.get_all(header::AUTHORIZATION).iter().count() != 1 {
        return None;
    }
    let (scheme, value) = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer")
        && !value.is_empty()
        && !value.chars().any(char::is_whitespace))
    .then_some(value)
}
fn identity_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Identity> {
    Ok(Identity {
        id: row.get(0)?,
        username: row.get(1)?,
        role: row.get(2)?,
        key_id: None,
        csrf: None,
    })
}
pub fn authenticate(
    db: &crate::database::Database,
    headers: &HeaderMap,
    allow_key: bool,
) -> Result<Identity> {
    let c = conn(db)?;
    if let Some(token) = headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| {
            s.split(';')
                .find_map(|p| p.trim().strip_prefix(&format!("{COOKIE}=")))
        })
    {
        let found=c.query_row("SELECT u.id,u.username,u.role,s.csrf FROM hub_sessions s JOIN hub_users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.expires_at>?2 AND u.active=1",params![hash(token),now()],|row|{let mut u=identity_row(row)?;u.csrf=Some(row.get(3)?);Ok(u)}).optional()?;
        if let Some(u) = found {
            return Ok(u);
        }
    }
    if allow_key {
        if let Some(token) = bearer(headers) {
            let found=c.query_row("SELECT u.id,u.username,u.role,k.id FROM hub_api_keys k JOIN hub_users u ON u.id=k.user_id WHERE k.token_hash=?1 AND k.active=1 AND u.active=1 AND (k.expires_at IS NULL OR k.expires_at>?2)",params![hash(token),now()],|row|{let mut u=identity_row(row)?;u.key_id=Some(row.get(3)?);Ok(u)}).optional()?;
            if let Some(u) = found {
                c.execute(
                    "UPDATE hub_api_keys SET last_used_at=?1 WHERE id=?2",
                    params![now(), u.key_id],
                )?;
                return Ok(u);
            }
        }
    }
    Err(Error::unauthorized())
}
pub fn check_csrf(user: &Identity, headers: &HeaderMap) -> Result<()> {
    if user.csrf.as_deref() != headers.get("x-csrf-token").and_then(|h| h.to_str().ok())
        || user.csrf.is_none()
    {
        return Err(Error::forbidden());
    }
    Ok(())
}
pub fn check_origin(db: &crate::database::Database, headers: &HeaderMap) -> Result<()> {
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|h| h.to_str().ok()) {
        let url = url::Url::parse(origin).map_err(|_| Error::forbidden())?;
        let expected = url::Url::parse(&setting(
            db,
            "publicUrl",
            &std::env::var("CC_SWITCH_PUBLIC_URL").unwrap_or_default(),
        ))
        .ok();
        let good = if let Some(expected) = expected {
            url.origin() == expected.origin()
        } else {
            url[url::Position::BeforeHost..url::Position::AfterPort].eq(headers
                .get(header::HOST)
                .and_then(|h| h.to_str().ok())
                .unwrap_or(""))
        };
        if !good {
            return Err(Error::forbidden());
        }
    }
    Ok(())
}
pub fn session_cookie(token: &str, max_age: i64, secure: bool) -> String {
    format!(
        "{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{}",
        if secure { "; Secure" } else { "" }
    )
}
pub async fn initialize(app: &crate::store::AppState) -> Result<()> {
    let exists: i64 = conn(&app.db)?.query_row(
        "SELECT COUNT(*) FROM hub_users WHERE role='admin'",
        [],
        |r| r.get(0),
    )?;
    if exists == 0 {
        let password = std::env::var("CC_SWITCH_ADMIN_PASSWORD")
            .ok()
            .or_else(|| std::env::var("CC_SWITCH_WEB_ACCESS_KEY").ok())
            .unwrap_or_else(secret);
        let encoded = password_hash(&password)?;
        let c = conn(&app.db)?;
        c.execute("INSERT INTO hub_users(id,username,password_hash,role,rpm,concurrency,created_at) VALUES('admin','admin',?1,'admin',600,32,?2)",params![encoded,now()])?;
        drop(c);
        let path = crate::config::get_app_config_dir().join("ccswitchuint-admin-initial.txt");
        {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            if let Ok(mut file) = options.open(&path) {
                let _ = writeln!(
                    file,
                    "username: admin\npassword: {password}\n首次登录后可在个人设置中修改密码。"
                );
            }
        }
        log::info!("ccSwitchUint 初始管理员凭据已保存到 {}", path.display());
    }
    {
        let c = conn(&app.db)?;
        c.execute("INSERT OR IGNORE INTO hub_users(id,username,role,rpm,concurrency,created_at) VALUES('legacy-client','legacy-client','legacy',600,32,?1)",[now()])?;
        if let Ok(token) = std::env::var("CC_SWITCH_WEB_ACCESS_KEY") {
            if !token.is_empty() {
                c.execute("INSERT OR IGNORE INTO hub_api_keys(id,user_id,name,token_hash,prefix,created_at) VALUES('legacy','legacy-client','迁移前客户端',?1,'legacy',?2)",params![hash(&token),now()])?;
            }
        }
        c.execute("DELETE FROM hub_sessions WHERE expires_at<?1", [now()])?;
        // A crashed request may already have consumed upstream tokens. Preserve its
        // reservations for reconciliation, but release concurrency by changing state.
        c.execute("UPDATE hub_requests SET state='pending_usage',error_code='service_restarted' WHERE state='reserved'",[])?;
    }
    super::resources::migrate_existing(app).await?;
    {
        let c = conn(&app.db)?;
        let mut pool = "official".to_string();
        let mut suffix = 1;
        while c.query_row(
            "SELECT EXISTS(SELECT 1 FROM hub_resources WHERE route_key=?1 AND app_type='codex')",
            [&pool],
            |r| r.get::<_, bool>(0),
        )? {
            pool = format!("official-pool-{suffix}");
            suffix += 1;
        }
        c.execute(
            "INSERT OR IGNORE INTO hub_settings(key,value) VALUES('officialPoolKey',?1)",
            [pool],
        )?;
    }
    conn(&app.db)?.execute(
        "INSERT OR REPLACE INTO hub_settings(key,value) VALUES('initialized','true')",
        [],
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::config::get_app_config_dir();
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        for name in ["cc-switch.db", "cc-switch.db-wal", "cc-switch.db-shm"] {
            let _ =
                std::fs::set_permissions(dir.join(name), std::fs::Permissions::from_mode(0o600));
        }
    }
    Ok(())
}
pub fn initialized(db: &crate::database::Database) -> bool {
    conn(db)
        .ok()
        .and_then(|c| {
            c.query_row(
                "SELECT value FROM hub_settings WHERE key='initialized'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
        })
        .as_deref()
        == Some("true")
}
pub fn setting(db: &crate::database::Database, key: &str, default: &str) -> String {
    conn(db)
        .ok()
        .and_then(|c| {
            c.query_row("SELECT value FROM hub_settings WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .ok()
        })
        .unwrap_or_else(|| default.into())
}

pub fn register(db: &crate::database::Database, name: &str, password: &str) -> Result<()> {
    if setting(db, "registration", "open") != "open" {
        return Err(Error::bad("注册已关闭，请联系管理员"));
    }
    let name = username(name)?;
    let encoded = password_hash(password)?;
    let c = conn(db)?;
    let exists: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM hub_users WHERE username=?1)",
        [&name],
        |r| r.get(0),
    )?;
    if exists {
        return Err(Error::bad("用户名不可用"));
    }
    c.execute("INSERT INTO hub_users(id,username,password_hash,role,budget,created_at) VALUES(?1,?2,?3,'user',?4,?5)",params![id(),name,encoded,r#"{"requests":1000,"tokens":1000000}"#,now()])?;
    Ok(())
}
pub fn login(db: &crate::database::Database, name: &str, password: &str) -> Result<String> {
    if password.len() > 256 {
        return Err(Error::unauthorized());
    }
    let name = username(name)?;
    {
        let c = conn(db)?;
        let failures: Option<(i64, i64)> = c
            .query_row(
                "SELECT failures,until_at FROM hub_auth_limits WHERE key=?1",
                [&name],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if failures.is_some_and(|(n, until)| n >= 10 && until > now()) {
            return Err(Error::limited(
                "login_rate_limit",
                "登录尝试过多，请稍后再试",
            ));
        }
    }
    let stored:Option<(String,String)>=conn(db)?.query_row("SELECT id,password_hash FROM hub_users WHERE username=?1 AND active=1 AND role!='legacy'",[&name],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let dummy="$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$N5XK4DWDY9jVnKGmlBkSIiBL7RZv5SNobVRVV1KAAoQ";
    let verified = PasswordHash::new(stored.as_ref().map(|(_, h)| h.as_str()).unwrap_or(dummy))
        .ok()
        .is_some_and(|h| {
            Argon2::default()
                .verify_password(password.as_bytes(), &h)
                .is_ok()
        });
    if !verified {
        conn(db)?.execute("INSERT INTO hub_auth_limits(key,failures,until_at) VALUES(?1,1,?2) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN until_at<?3 THEN 1 ELSE failures+1 END,until_at=?2",params![name,now()+900,now()])?;
        return Err(Error(
            StatusCode::UNAUTHORIZED,
            "invalid_credentials",
            "用户名或密码错误".into(),
        ));
    }
    let token = secret();
    let c = conn(db)?;
    c.execute("DELETE FROM hub_auth_limits WHERE key=?1", [name])?;
    c.execute("INSERT INTO hub_sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?1,?2,?3,?4,?5)",params![hash(&token),stored.unwrap().0,secret(),now()+7*86400,now()])?;
    Ok(token)
}
