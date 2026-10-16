//! Durable quota reservations are independent of diagnostic/session logs.
use super::*;
use crate::proxy::usage::{
    calculator::{CostCalculator, ModelPricing},
    parser::TokenUsage,
};
use rusqlite::{params, OptionalExtension, Transaction};
use rust_decimal::{prelude::ToPrimitive, Decimal};
use std::str::FromStr;

#[derive(Debug, Clone, Copy, Default)]
pub struct Amount {
    pub requests: i64,
    pub tokens: i64,
    pub credits: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Price {
    pub input: String,
    pub output: String,
    pub read: String,
    pub write: String,
    pub multiplier: String,
}
impl Price {
    pub fn load(
        db: &crate::database::Database,
        model: &str,
        provider: &crate::provider::Provider,
    ) -> Result<Option<Self>> {
        let c = conn(db)?;
        let p = crate::services::usage_stats::find_model_pricing_row(&c, model)?;
        Ok(p.map(|(input, output, read, write)| Self {
            input,
            output,
            read,
            write,
            multiplier: provider
                .meta
                .as_ref()
                .and_then(|m| m.cost_multiplier.clone())
                .unwrap_or_else(|| "1".into()),
        }))
    }
    pub fn cost(&self, app: &str, usage: &TokenUsage) -> Option<i64> {
        let p =
            ModelPricing::from_strings(&self.input, &self.output, &self.read, &self.write).ok()?;
        let multiplier = Decimal::from_str(&self.multiplier).ok()?;
        if multiplier < Decimal::ZERO {
            return None;
        }
        (CostCalculator::calculate_for_app(app, usage, &p, multiplier).total_cost
            * Decimal::from(1_000_000))
        .ceil()
        .to_i64()
    }
}
pub fn period(period: &str) -> String {
    match period {
        "day" => chrono::Utc::now().format("%Y-%m-%d").to_string(),
        "lifetime" => "lifetime".into(),
        _ => chrono::Utc::now().format("%Y-%m").to_string(),
    }
}
fn reserve(
    tx: &Transaction<'_>,
    request: &str,
    scope: &str,
    budget: &Budget,
    amount: Amount,
) -> Result<()> {
    let current:(i64,i64,i64,i64,i64,i64)=tx.query_row("SELECT used_requests,used_tokens,used_credits,reserved_requests,reserved_tokens,reserved_credits FROM hub_buckets WHERE id=?1",[scope],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional()?.unwrap_or_default();
    for (label, limit, used, held, requested) in [
        (
            "请求次数",
            budget.requests,
            current.0,
            current.3,
            amount.requests,
        ),
        ("token", budget.tokens, current.1, current.4, amount.tokens),
        ("点数", budget.credits, current.2, current.5, amount.credits),
    ] {
        if limit.is_some_and(|n| used.saturating_add(held).saturating_add(requested) > n) {
            return Err(Error::limited(
                "quota_exceeded",
                format!(
                    "{label}额度不足（含进行中请求的预留），范围：{}",
                    scope.split(':').next().unwrap_or("user")
                ),
            ));
        }
    }
    tx.execute("INSERT INTO hub_buckets(id,reserved_requests,reserved_tokens,reserved_credits) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET reserved_requests=reserved_requests+?2,reserved_tokens=reserved_tokens+?3,reserved_credits=reserved_credits+?4",params![scope,amount.requests,amount.tokens,amount.credits])?;
    tx.execute("INSERT INTO hub_reservations(request_id,bucket_id,scope,requests,tokens,credits) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(request_id,bucket_id) DO UPDATE SET requests=?4,tokens=?5,credits=?6,state='reserved'",params![request,scope,scope.split(':').next().unwrap_or("user"),amount.requests,amount.tokens,amount.credits])?;
    Ok(())
}
pub fn start(
    db: &crate::database::Database,
    user: &Identity,
    model: &str,
    app: &str,
    stream: bool,
    estimate: Amount,
) -> Result<String> {
    let mut c = conn(db)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let (budget, p, rpm, concurrency, active): (String, String, i64, i64, bool) = tx.query_row(
        "SELECT budget,period,rpm,concurrency,active FROM hub_users WHERE id=?1",
        [&user.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )?;
    if !active {
        return Err(Error::unauthorized());
    }
    let global_running: i64 = tx.query_row(
        "SELECT COUNT(*) FROM hub_requests WHERE state='reserved'",
        [],
        |r| r.get(0),
    )?;
    if global_running >= 32 {
        return Err(Error::limited(
            "gateway_concurrency_limit",
            "网关进行中的请求过多，请稍后重试",
        ));
    }
    let (running,recent):(i64,i64)=tx.query_row("SELECT SUM(CASE WHEN state='reserved' THEN 1 ELSE 0 END),SUM(CASE WHEN created_at>?2 THEN 1 ELSE 0 END) FROM hub_requests WHERE user_id=?1 AND (state='reserved' OR created_at>?2)",params![user.id,now()-60],|r|Ok((r.get::<_,Option<i64>>(0)?.unwrap_or(0),r.get::<_,Option<i64>>(1)?.unwrap_or(0))))?;
    if running >= concurrency {
        return Err(Error::limited("concurrency_limit", "进行中的请求过多"));
    }
    if recent >= rpm {
        return Err(Error::limited("rate_limit", "请求过于频繁，请稍后再试"));
    }
    let request = id();
    let device = if let Some(key) = &user.key_id {
        tx.query_row("SELECT name FROM hub_api_keys WHERE id=?1", [key], |r| {
            r.get::<_, String>(0)
        })
        .optional()?
        .unwrap_or_else(|| "API".into())
    } else {
        "网页".into()
    };
    tx.execute("INSERT INTO hub_requests(id,user_id,key_id,device,request_model,app_type,created_at,stream) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![request,user.id,user.key_id,device,model,app,now(),stream])?;
    reserve(
        &tx,
        &request,
        &format!("user:{}:{}", user.id, period(&p)),
        &parse(&budget),
        estimate,
    )?;
    tx.commit()?;
    Ok(request)
}
pub fn attempt(
    db: &crate::database::Database,
    user: &Identity,
    request: &str,
    r: &resources::Resource,
    model: &str,
    estimate: Amount,
    price: Option<&Price>,
) -> Result<String> {
    let budget = resources::usable(db, user, r, model)?;
    let mut c = conn(db)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if user.id != r.owner_id {
        if (budget.credits.is_some() || r.policy.shared_budget.credits.is_some()) && price.is_none()
        {
            return Err(Error::bad("该模型尚未配置价格，无法执行点数额度限制"));
        }
        reserve(
            &tx,
            request,
            &format!("grant:{}:{}:{}", r.id, user.id, period(&r.policy.period)),
            &budget,
            estimate,
        )?;
        reserve(
            &tx,
            request,
            &format!("shared:{}:{}", r.id, period(&r.policy.period)),
            &r.policy.shared_budget,
            estimate,
        )?;
    }
    let attempt = id();
    tx.execute("INSERT INTO hub_attempts(id,request_id,resource_id,owner_id,account_id,model,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![attempt,request,r.id,r.owner_id,r.account_id,model,now()])?;
    tx.execute("UPDATE hub_requests SET resource_id=?1,owner_id=?2,provider_id=?3,account_id=?4,upstream_model=?5,pricing=?6,owner_name=?7,provider_name=?8 WHERE id=?9",params![r.id,r.owner_id,r.provider_id,r.account_id,model,price.map(json_text),r.owner_name,r.name,request])?;
    tx.execute(
        "UPDATE hub_resources SET last_used_at=?1 WHERE id=?2",
        params![now(), r.id],
    )?;
    tx.commit()?;
    Ok(attempt)
}
fn release(tx: &Transaction<'_>, request: &str, only_resources: bool) -> Result<()> {
    let mut s=tx.prepare("SELECT bucket_id,requests,tokens,credits FROM hub_reservations WHERE request_id=?1 AND state='reserved' AND (?2=0 OR scope!='user')")?;
    let rows = s
        .query_map(params![request, only_resources], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(s);
    for (bucket, req, tokens, credits) in rows {
        tx.execute("UPDATE hub_buckets SET reserved_requests=MAX(0,reserved_requests-?1),reserved_tokens=MAX(0,reserved_tokens-?2),reserved_credits=MAX(0,reserved_credits-?3) WHERE id=?4",params![req,tokens,credits,bucket])?;
        tx.execute(
            "UPDATE hub_reservations SET state='released' WHERE request_id=?1 AND bucket_id=?2",
            params![request, bucket],
        )?;
    }
    Ok(())
}
pub fn retry(
    db: &crate::database::Database,
    request: &str,
    attempt: &str,
    status: u16,
    code: &str,
) -> Result<()> {
    let mut c = conn(db)?;
    let tx = c.transaction()?;
    tx.execute(
        "UPDATE hub_attempts SET status=?1,error_code=?2,completed_at=?3 WHERE id=?4",
        params![status, code, now(), attempt],
    )?;
    release(&tx, request, true)?;
    tx.commit()?;
    Ok(())
}
#[derive(Debug, Clone, Default)]
pub struct Usage {
    pub input: i64,
    pub output: i64,
    pub read: i64,
    pub write: i64,
    pub known: bool,
    pub response_id: Option<String>,
    pub failed: bool,
}
impl Usage {
    pub fn observe(&mut self, value: &Value) {
        if matches!(
            value.get("type").and_then(Value::as_str),
            Some("response.failed" | "error")
        ) || value.get("error").is_some_and(|v| !v.is_null())
        {
            self.failed = true;
        }
        if let Some(response) = value.get("response").or_else(|| value.get("message")) {
            if let Some(id) = response.get("id").and_then(Value::as_str) {
                self.response_id = Some(id.into());
            }
        } else if let Some(id) = value.get("id").and_then(Value::as_str) {
            self.response_id = Some(id.into());
        }
        let usage = value
            .get("usage")
            .or_else(|| value.pointer("/response/usage"))
            .or_else(|| value.pointer("/message/usage"));
        if let Some(u) = usage.filter(|v| v.is_object()) {
            let num = |keys: &[&str]| {
                keys.iter()
                    .find_map(|k| u.pointer(k).and_then(Value::as_i64))
                    .unwrap_or(0)
                    .max(0)
            };
            self.known |= u.get("input_tokens").is_some()
                || u.get("prompt_tokens").is_some()
                || u.get("output_tokens").is_some()
                || u.get("completion_tokens").is_some();
            self.input = self.input.max(num(&["/input_tokens", "/prompt_tokens"]));
            self.output = self
                .output
                .max(num(&["/output_tokens", "/completion_tokens"]));
            self.read = self.read.max(num(&[
                "/cache_read_input_tokens",
                "/input_tokens_details/cached_tokens",
                "/prompt_tokens_details/cached_tokens",
                "/prompt_cache_hit_tokens",
            ]));
            self.write = self.write.max(num(&[
                "/cache_creation_input_tokens",
                "/input_tokens_details/cache_write_tokens",
                "/prompt_tokens_details/cache_write_tokens",
            ]));
        }
    }
    pub fn tokens(&self, app: &str) -> i64 {
        if app == "claude" {
            self.input + self.output + self.read + self.write
        } else {
            self.input + self.output
        }
    }
    pub fn parsed(&self) -> TokenUsage {
        TokenUsage {
            input_tokens: self.input.min(u32::MAX as i64) as u32,
            output_tokens: self.output.min(u32::MAX as i64) as u32,
            cache_read_tokens: self.read.min(u32::MAX as i64) as u32,
            cache_creation_tokens: self.write.min(u32::MAX as i64) as u32,
            model: None,
            message_id: self.response_id.clone(),
        }
    }
}
#[allow(clippy::too_many_arguments)]
pub fn finish(
    db: &crate::database::Database,
    request: &str,
    attempt: Option<&str>,
    status: u16,
    usage: &Usage,
    latency: i64,
    first: Option<i64>,
    complete: bool,
) -> Result<()> {
    let mut c = conn(db)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let (state, app, pricing, user, resource): (
        String,
        String,
        Option<String>,
        String,
        Option<String>,
    ) = tx.query_row(
        "SELECT state,app_type,pricing,user_id,resource_id FROM hub_requests WHERE id=?1",
        [request],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )?;
    if ["completed", "failed", "reconciled"].contains(&state.as_str()) {
        return Ok(());
    }
    let success = (200..300).contains(&status) && !usage.failed;
    // Unknown execution on disconnect or missing usage retains budget holds.
    let pending = !complete || (success && !usage.known);
    let cost = pricing
        .and_then(|p| serde_json::from_str::<Price>(&p).ok())
        .and_then(|p| p.cost(&app, &usage.parsed()));
    if !pending {
        let amount = Amount {
            requests: if success || usage.known { 1 } else { 0 },
            tokens: usage.tokens(&app),
            credits: cost.unwrap_or(0),
        };
        let mut s=tx.prepare("SELECT bucket_id,requests,tokens,credits FROM hub_reservations WHERE request_id=?1 AND state='reserved'")?;
        let held = s
            .query_map([request], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(s);
        for (bucket, req, tokens, credits) in held {
            tx.execute("UPDATE hub_buckets SET reserved_requests=MAX(0,reserved_requests-?1),reserved_tokens=MAX(0,reserved_tokens-?2),reserved_credits=MAX(0,reserved_credits-?3),used_requests=used_requests+?4,used_tokens=used_tokens+?5,used_credits=used_credits+?6 WHERE id=?7",params![req,tokens,credits,amount.requests,amount.tokens,amount.credits,bucket])?;
            tx.execute("INSERT OR IGNORE INTO hub_ledger(id,request_id,bucket_id,requests,tokens,credits,kind,created_at) VALUES(?1,?2,?3,?4,?5,?6,'settlement',?7)",params![id(),request,bucket,amount.requests,amount.tokens,amount.credits,now()])?;
        }
        tx.execute(
            "UPDATE hub_reservations SET state='settled' WHERE request_id=?1 AND state='reserved'",
            [request],
        )?;
    }
    let state = if pending {
        "pending_usage"
    } else if success {
        "completed"
    } else {
        "failed"
    };
    let code = if pending {
        Some("usage_unavailable")
    } else if usage.failed {
        Some("upstream_stream_error")
    } else if !success {
        Some("upstream_error")
    } else {
        None
    };
    tx.execute("UPDATE hub_requests SET state=?1,status=?2,input_tokens=?3,output_tokens=?4,cache_read_tokens=?5,cache_creation_tokens=?6,cost_credits=?7,error_code=?8,completed_at=?9,latency_ms=?10,first_token_ms=?11,response_id=?12 WHERE id=?13",params![state,status,usage.input,usage.output,usage.read,usage.write,cost,code,now(),latency,first,usage.response_id,request])?;
    if let Some(attempt) = attempt {
        tx.execute(
            "UPDATE hub_attempts SET status=?1,error_code=?2,completed_at=?3 WHERE id=?4",
            params![status, code, now(), attempt],
        )?;
    }
    if success {
        if let (Some(response), Some(resource)) = (&usage.response_id, resource) {
            tx.execute("INSERT OR REPLACE INTO hub_affinity(user_id,response_id,resource_id,expires_at) VALUES(?1,?2,?3,?4)",params![user,response,resource,now()+7*86400])?;
        }
    }
    tx.commit()?;
    Ok(())
}
pub fn reconcile(
    db: &crate::database::Database,
    actor: &Identity,
    request: &str,
    usage: Usage,
    release_only: bool,
) -> Result<()> {
    if !actor.admin() {
        return Err(Error::forbidden());
    }
    let state: String = conn(db)?.query_row(
        "SELECT state FROM hub_requests WHERE id=?1",
        [request],
        |r| r.get(0),
    )?;
    if state != "pending_usage" {
        return Err(Error::bad("仅待核算请求可以对账"));
    }
    let usage = if release_only {
        Usage::default()
    } else {
        Usage {
            known: true,
            ..usage
        }
    };
    finish(
        db,
        request,
        None,
        if release_only { 499 } else { 200 },
        &usage,
        0,
        None,
        true,
    )?;
    audit(
        db,
        &actor.id,
        "quota.reconcile",
        request,
        json!({"releaseOnly":release_only}),
    )
}
pub fn remaining(db: &crate::database::Database, user: &Identity) -> Result<Value> {
    let c = conn(db)?;
    let (budget, p): (String, String) = c.query_row(
        "SELECT budget,period FROM hub_users WHERE id=?1",
        [&user.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let key = format!("user:{}:{}", user.id, period(&p));
    let values=c.query_row("SELECT used_requests,used_tokens,used_credits,reserved_requests,reserved_tokens,reserved_credits FROM hub_buckets WHERE id=?1",[key],|r|Ok(json!({"requests":r.get::<_,i64>(0)?,"tokens":r.get::<_,i64>(1)?,"credits":r.get::<_,i64>(2)?,"reservedRequests":r.get::<_,i64>(3)?,"reservedTokens":r.get::<_,i64>(4)?,"reservedCredits":r.get::<_,i64>(5)?}))).optional()?.unwrap_or(json!({}));
    Ok(json!({"budget":parse::<Budget>(&budget),"period":p,"periodKey":period(&p),"usage":values}))
}
