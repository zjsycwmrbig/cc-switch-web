use rusqlite::Connection;

pub(crate) fn create(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(r#"
CREATE TABLE IF NOT EXISTS hub_users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT,
 role TEXT NOT NULL CHECK(role IN ('admin','user','legacy')), active INTEGER NOT NULL DEFAULT 1,
 budget TEXT NOT NULL DEFAULT '{}', period TEXT NOT NULL DEFAULT 'month',
 rpm INTEGER NOT NULL DEFAULT 30, concurrency INTEGER NOT NULL DEFAULT 2, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES hub_users(id), csrf TEXT NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_api_keys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES hub_users(id), name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS hub_resources (
 id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, app_type TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES hub_users(id),
 route_key TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,
 policy TEXT NOT NULL DEFAULT '{}', models TEXT NOT NULL DEFAULT '[]', official INTEGER NOT NULL DEFAULT 0,
 account_id TEXT, cooldown_until INTEGER NOT NULL DEFAULT 0, health TEXT NOT NULL DEFAULT 'unknown',
 last_used_at INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 UNIQUE(provider_id,app_type), UNIQUE(route_key,app_type)
);
CREATE UNIQUE INDEX IF NOT EXISTS hub_unique_official_account ON hub_resources(account_id)
 WHERE official=1 AND account_id IS NOT NULL AND deleted=0;
CREATE TABLE IF NOT EXISTS hub_grants (
 resource_id TEXT NOT NULL REFERENCES hub_resources(id), user_id TEXT NOT NULL REFERENCES hub_users(id),
 allowed INTEGER NOT NULL DEFAULT 1, budget TEXT NOT NULL DEFAULT '{}', models TEXT NOT NULL DEFAULT '[]',
 expires_at INTEGER, PRIMARY KEY(resource_id,user_id)
);
CREATE TABLE IF NOT EXISTS hub_share_codes (
 id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES hub_resources(id),
 created_by TEXT NOT NULL REFERENCES hub_users(id), token_hash TEXT NOT NULL UNIQUE,
 budget TEXT NOT NULL DEFAULT '{}', models TEXT NOT NULL DEFAULT '[]', expires_at INTEGER,
 max_claims INTEGER NOT NULL DEFAULT 1, claimed_count INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hub_share_code_resource ON hub_share_codes(resource_id,created_at);
CREATE TABLE IF NOT EXISTS hub_share_claims (
 share_id TEXT NOT NULL REFERENCES hub_share_codes(id), user_id TEXT NOT NULL REFERENCES hub_users(id),
 claimed_at INTEGER NOT NULL, PRIMARY KEY(share_id,user_id)
);
CREATE TABLE IF NOT EXISTS hub_preferences (user_id TEXT PRIMARY KEY REFERENCES hub_users(id), value TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS hub_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hub_account_owners (account_id TEXT NOT NULL, auth_provider TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES hub_users(id), PRIMARY KEY(account_id,auth_provider));
CREATE TABLE IF NOT EXISTS hub_oauth_flows (device_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES hub_users(id),
 expires_at INTEGER NOT NULL, auth_provider TEXT NOT NULL, target_account_id TEXT);
CREATE TABLE IF NOT EXISTS hub_auth_limits (key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, until_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES hub_users(id), key_id TEXT, device TEXT NOT NULL,
 request_model TEXT NOT NULL, app_type TEXT NOT NULL, resource_id TEXT, owner_id TEXT, provider_id TEXT,
 account_id TEXT, upstream_model TEXT, state TEXT NOT NULL DEFAULT 'reserved', status INTEGER NOT NULL DEFAULT 0,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
 cost_credits INTEGER, pricing TEXT, usage_source TEXT NOT NULL DEFAULT 'gateway', error_code TEXT,
 created_at INTEGER NOT NULL, completed_at INTEGER, latency_ms INTEGER NOT NULL DEFAULT 0, first_token_ms INTEGER,
 response_id TEXT, stream INTEGER NOT NULL DEFAULT 0, owner_name TEXT, provider_name TEXT
);
CREATE INDEX IF NOT EXISTS hub_request_user_time ON hub_requests(user_id,created_at);
CREATE INDEX IF NOT EXISTS hub_request_owner_time ON hub_requests(owner_id,created_at);
CREATE INDEX IF NOT EXISTS hub_request_state ON hub_requests(state);
CREATE TABLE IF NOT EXISTS hub_attempts (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES hub_requests(id), resource_id TEXT NOT NULL,
 owner_id TEXT NOT NULL, account_id TEXT, model TEXT NOT NULL, status INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, created_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS hub_buckets (
 id TEXT PRIMARY KEY, used_requests INTEGER NOT NULL DEFAULT 0, used_tokens INTEGER NOT NULL DEFAULT 0,
 used_credits INTEGER NOT NULL DEFAULT 0, reserved_requests INTEGER NOT NULL DEFAULT 0,
 reserved_tokens INTEGER NOT NULL DEFAULT 0, reserved_credits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS hub_reservations (
 request_id TEXT NOT NULL REFERENCES hub_requests(id), bucket_id TEXT NOT NULL REFERENCES hub_buckets(id),
 scope TEXT NOT NULL, requests INTEGER NOT NULL, tokens INTEGER NOT NULL, credits INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'reserved', PRIMARY KEY(request_id,bucket_id)
);
CREATE TABLE IF NOT EXISTS hub_ledger (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL, bucket_id TEXT NOT NULL,
 requests INTEGER NOT NULL, tokens INTEGER NOT NULL, credits INTEGER NOT NULL, kind TEXT NOT NULL,
 created_at INTEGER NOT NULL, UNIQUE(request_id,bucket_id,kind)
);
CREATE TABLE IF NOT EXISTS hub_affinity (
 user_id TEXT NOT NULL, response_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL, PRIMARY KEY(user_id,response_id)
);
CREATE TABLE IF NOT EXISTS hub_model_health (resource_id TEXT NOT NULL,model TEXT NOT NULL,
 until_at INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(resource_id,model));
CREATE TABLE IF NOT EXISTS hub_audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
 target TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
"#)
}
