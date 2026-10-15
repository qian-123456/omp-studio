//! [E] Cloudflare DDNS (AAAA record, DNS-only) for IPv6 direct access.

use std::net::Ipv6Addr;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as TokioMutex;

use crate::contracts::DdnsStatus;
use crate::state::AppState;

pub const VAULT_SLUG: &str = "cloudflare-ddns";
const CF_API_BASE: &str = "https://api.cloudflare.com/client/v4";
const RECORD_TTL: u32 = 120; // 2 minutes (short TTL)
const HTTP_TIMEOUT_SECS: u64 = 15;

/// In-memory runtime state for Cloudflare DDNS syncing.
#[derive(Debug, Clone, Default)]
pub struct DdnsRuntime {
    pub last_ip: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub halted: bool,
    pub consecutive_failures: u32,
    /// Hostname/zone of the last successful sync. When the configured settings
    /// differ, the AAAA record for the current settings does not exist yet, so
    /// the DDNS record is NOT synced.
    pub last_synced_host: Option<String>,
    pub last_synced_zone: Option<String>,
}

static RUNTIME: Mutex<DdnsRuntime> = Mutex::new(DdnsRuntime {
    last_ip: None,
    last_sync_at: None,
    last_error: None,
    halted: false,
    consecutive_failures: 0,
    last_synced_host: None,
    last_synced_zone: None,
});

/// Mutex ensuring only a single in-flight sync operation at any time.
static SYNC_LOCK: TokioMutex<()> = TokioMutex::const_new(());

// ─── Cloudflare API DTOs ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct CfApiResponse<T> {
    success: bool,
    #[serde(default)]
    errors: Option<Vec<CfApiMessage>>,
    #[serde(default)]
    #[allow(dead_code)]
    messages: Option<Vec<CfApiMessage>>,
    result: Option<T>,
}

#[derive(Debug, Deserialize)]
struct CfApiMessage {
    #[allow(dead_code)]
    code: Option<i64>,
    message: String,
}

#[derive(Debug, Deserialize)]
struct CfTokenVerifyResult {
    #[allow(dead_code)]
    id: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DnsRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub record_type: Option<String>,
    pub name: Option<String>,
    pub content: Option<String>,
    pub proxied: Option<bool>,
    pub ttl: Option<u32>,
}

#[derive(Debug, Serialize)]
struct DnsRecordPayload<'a> {
    #[serde(rename = "type")]
    record_type: &'a str,
    name: &'a str,
    content: &'a str,
    proxied: bool,
    ttl: u32,
}

// ─── Error Handling ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DdnsError {
    AuthFailed(String),     // 401, 403
    RateLimited(String),    // 429
    ApiError(String),       // Cloudflare response success: false
    HttpError(u16, String), // 5xx, 404, etc.
    Network(String),        // Connection / timeout
    InvalidResponse(String),
}

impl DdnsError {
    pub fn is_fatal(&self) -> bool {
        matches!(self, DdnsError::AuthFailed(_) | DdnsError::RateLimited(_))
    }

    pub fn to_user_message(&self) -> String {
        match self {
            DdnsError::AuthFailed(msg) => {
                if msg.is_empty() {
                    "Cloudflare API 认证失败: 请检查 Token 是否有效或权限充足".to_string()
                } else {
                    format!("Cloudflare API 认证失败: {msg}")
                }
            }
            DdnsError::RateLimited(msg) => {
                if msg.is_empty() {
                    "Cloudflare API 请求过于频繁，已触发限流".to_string()
                } else {
                    format!("Cloudflare API 请求限流: {msg}")
                }
            }
            DdnsError::ApiError(msg) => format!("Cloudflare API 错误: {msg}"),
            DdnsError::HttpError(code, msg) => {
                if msg.is_empty() {
                    format!("Cloudflare 服务端异常 (HTTP {code})")
                } else {
                    format!("Cloudflare 服务端异常 (HTTP {code}): {msg}")
                }
            }
            DdnsError::Network(msg) => format!("网络请求失败: {msg}"),
            DdnsError::InvalidResponse(msg) => format!("解析 Cloudflare 响应失败: {msg}"),
        }
    }
}

fn sanitize_network_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "请求超时".to_string()
    } else if err.is_connect() {
        "连接失败，请检查网络连接".to_string()
    } else {
        "网络连接异常".to_string()
    }
}

// ─── Pure Response Parsers (Unit-Testable without Network) ───────────────────

pub fn parse_token_verify_response(status: u16, body: &str) -> Result<(), DdnsError> {
    if status == 401 || status == 403 {
        return Err(DdnsError::AuthFailed("Token 无效或权限不足".to_string()));
    }
    if status == 429 {
        return Err(DdnsError::RateLimited("请求过于频繁".to_string()));
    }
    if !(200..300).contains(&status) {
        return Err(DdnsError::HttpError(status, "HTTP 状态码异常".to_string()));
    }

    let parsed: CfApiResponse<CfTokenVerifyResult> =
        serde_json::from_str(body).map_err(|e| DdnsError::InvalidResponse(e.to_string()))?;

    if !parsed.success {
        let err_msg = parsed
            .errors
            .and_then(|errs| errs.into_iter().next())
            .map(|e| e.message)
            .unwrap_or_else(|| "Token 验证失败".to_string());
        return Err(DdnsError::ApiError(err_msg));
    }

    match parsed.result {
        Some(res) if res.status.as_deref() == Some("active") => Ok(()),
        Some(res) => Err(DdnsError::AuthFailed(format!(
            "Token 状态非 active (当前状态: {})",
            res.status.unwrap_or_else(|| "unknown".to_string())
        ))),
        None => Err(DdnsError::AuthFailed("Token 验证结果为空".to_string())),
    }
}

pub fn parse_dns_records_response(status: u16, body: &str) -> Result<Vec<DnsRecord>, DdnsError> {
    if status == 401 || status == 403 {
        return Err(DdnsError::AuthFailed(
            "认证失败，无法读取 DNS 记录".to_string(),
        ));
    }
    if status == 429 {
        return Err(DdnsError::RateLimited("请求过于频繁".to_string()));
    }
    if !(200..300).contains(&status) {
        return Err(DdnsError::HttpError(
            status,
            "读取 DNS 记录失败".to_string(),
        ));
    }

    let parsed: CfApiResponse<Vec<DnsRecord>> =
        serde_json::from_str(body).map_err(|e| DdnsError::InvalidResponse(e.to_string()))?;

    if !parsed.success {
        let err_msg = parsed
            .errors
            .and_then(|errs| errs.into_iter().next())
            .map(|e| e.message)
            .unwrap_or_else(|| "获取 DNS 记录失败".to_string());
        return Err(DdnsError::ApiError(err_msg));
    }

    Ok(parsed.result.unwrap_or_default())
}

pub fn find_matching_record<'a>(records: &'a [DnsRecord], hostname: &str) -> Option<&'a DnsRecord> {
    let target = hostname.trim_end_matches('.');
    records.iter().find(|r| {
        let r_type = r.record_type.as_deref().unwrap_or("");
        let r_name = r.name.as_deref().unwrap_or("").trim_end_matches('.');
        r_type.eq_ignore_ascii_case("AAAA") && r_name.eq_ignore_ascii_case(target)
    })
}

pub fn parse_dns_mutation_response(status: u16, body: &str) -> Result<DnsRecord, DdnsError> {
    if status == 401 || status == 403 {
        return Err(DdnsError::AuthFailed(
            "认证失败，无法更新 DNS 记录".to_string(),
        ));
    }
    if status == 429 {
        return Err(DdnsError::RateLimited("请求过于频繁".to_string()));
    }
    if !(200..300).contains(&status) {
        if let Ok(parsed) = serde_json::from_str::<CfApiResponse<serde_json::Value>>(body) {
            if let Some(err) = parsed.errors.and_then(|errs| errs.into_iter().next()) {
                return Err(DdnsError::ApiError(err.message));
            }
        }
        return Err(DdnsError::HttpError(
            status,
            "更新 DNS 记录失败".to_string(),
        ));
    }

    let parsed: CfApiResponse<DnsRecord> =
        serde_json::from_str(body).map_err(|e| DdnsError::InvalidResponse(e.to_string()))?;

    if !parsed.success {
        let err_msg = parsed
            .errors
            .and_then(|errs| errs.into_iter().next())
            .map(|e| e.message)
            .unwrap_or_else(|| "更新 DNS 记录失败".to_string());
        return Err(DdnsError::ApiError(err_msg));
    }

    parsed
        .result
        .ok_or_else(|| DdnsError::InvalidResponse("缺少更新后的记录信息".to_string()))
}

// ─── Pure Decision & State Transition Logic ─────────────────────────────────

/// Case-insensitive DNS-name equality; a trailing dot is semantically null.
fn dns_name_eq(a: &str, b: &str) -> bool {
    a.trim()
        .trim_end_matches('.')
        .eq_ignore_ascii_case(b.trim().trim_end_matches('.'))
}

impl DdnsRuntime {
    /// True when the last successful sync was performed with these settings.
    pub fn synced_with(&self, zone_id: &str, hostname: &str) -> bool {
        let (Some(synced_zone), Some(synced_host)) = (
            self.last_synced_zone.as_deref(),
            self.last_synced_host.as_deref(),
        ) else {
            return false;
        };
        dns_name_eq(synced_zone, zone_id) && dns_name_eq(synced_host, hostname)
    }
}

/// The last synced IP, but only while the current settings still match the
/// settings of that sync. After a hostname/zone change the AAAA record for the
/// new settings has not been written yet, so this reports `None` (not synced).
pub fn effective_last_ip(runtime: &DdnsRuntime, zone_id: &str, hostname: &str) -> Option<String> {
    if runtime.synced_with(zone_id, hostname) {
        runtime.last_ip.clone()
    } else {
        None
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum SyncDecision {
    SkipDisabled,
    SkipMissingConfig(&'static str),
    SkipHalted,
    SkipNoAddress,
    SkipIpUnchanged,
    Proceed,
}

pub fn should_sync(
    enabled: bool,
    zone_id: Option<&str>,
    hostname: Option<&str>,
    token_present: bool,
    current_ip: Option<Ipv6Addr>,
    runtime: &DdnsRuntime,
    is_manual: bool,
) -> SyncDecision {
    if !enabled {
        return SyncDecision::SkipDisabled;
    }
    if zone_id.map(|s| s.trim().is_empty()).unwrap_or(true) {
        return SyncDecision::SkipMissingConfig("zone_id");
    }
    if hostname.map(|s| s.trim().is_empty()).unwrap_or(true) {
        return SyncDecision::SkipMissingConfig("hostname");
    }
    if !token_present {
        return SyncDecision::SkipMissingConfig("token");
    }
    if runtime.halted && !is_manual {
        return SyncDecision::SkipHalted;
    }
    let Some(ip) = current_ip else {
        return SyncDecision::SkipNoAddress;
    };
    if !is_manual {
        let ip_str = ip.to_string();
        // Skip only when the last successful sync used the current hostname/zone:
        // after a settings change the AAAA record for the new name does not exist yet.
        if runtime.last_ip.as_deref() == Some(&ip_str)
            && runtime.synced_with(zone_id.unwrap_or_default(), hostname.unwrap_or_default())
        {
            return SyncDecision::SkipIpUnchanged;
        }
    }
    SyncDecision::Proceed
}

pub fn apply_manual_sync_trigger(runtime: &mut DdnsRuntime) {
    runtime.halted = false;
    runtime.consecutive_failures = 0;
}

pub fn apply_sync_success(
    runtime: &mut DdnsRuntime,
    new_ip: &str,
    timestamp: &str,
    hostname: &str,
    zone_id: &str,
) {
    runtime.halted = false;
    runtime.consecutive_failures = 0;
    runtime.last_ip = Some(new_ip.to_string());
    runtime.last_sync_at = Some(timestamp.to_string());
    runtime.last_error = None;
    runtime.last_synced_host = Some(hostname.to_string());
    runtime.last_synced_zone = Some(zone_id.to_string());
}

pub fn apply_sync_failure(runtime: &mut DdnsRuntime, error: &DdnsError) {
    let msg = error.to_user_message();
    runtime.last_error = Some(msg);
    if error.is_fatal() {
        runtime.halted = true;
    } else {
        runtime.consecutive_failures += 1;
        if runtime.consecutive_failures >= 3 {
            runtime.halted = true;
        }
    }
}

pub fn backoff_duration(consecutive_failures: u32) -> Duration {
    match consecutive_failures {
        0 => Duration::from_secs(300),
        1 => Duration::from_secs(30),
        2 => Duration::from_secs(60),
        _ => Duration::from_secs(300),
    }
}

// ─── Cloudflare Network Calls ────────────────────────────────────────────────

async fn verify_cf_token(token: &str) -> Result<(), DdnsError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?;

    let url = format!("{CF_API_BASE}/user/tokens/verify");
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?;

    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?;

    parse_token_verify_response(status, &body)
}

async fn execute_cf_sync(
    zone_id: &str,
    hostname: &str,
    token: &str,
    ipv6: &str,
) -> Result<(), DdnsError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?;

    // Step 1: Query existing AAAA records
    let list_url = format!("{CF_API_BASE}/zones/{zone_id}/dns_records?type=AAAA&name={hostname}");
    let resp = client
        .get(&list_url)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?;

    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?;

    let records = parse_dns_records_response(status, &body)?;
    let existing = find_matching_record(&records, hostname);

    let payload = DnsRecordPayload {
        record_type: "AAAA",
        name: hostname,
        content: ipv6,
        proxied: false,
        ttl: RECORD_TTL,
    };

    let mutate_resp = if let Some(rec) = existing {
        // Step 2a: Update existing record (PUT)
        let update_url = format!("{CF_API_BASE}/zones/{zone_id}/dns_records/{}", rec.id);
        client
            .put(&update_url)
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?
    } else {
        // Step 2b: Create new record (POST)
        let create_url = format!("{CF_API_BASE}/zones/{zone_id}/dns_records");
        client
            .post(&create_url)
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?
    };

    let mutate_status = mutate_resp.status().as_u16();
    let mutate_body = mutate_resp
        .text()
        .await
        .map_err(|e| DdnsError::Network(sanitize_network_error(&e)))?;

    parse_dns_mutation_response(mutate_status, &mutate_body)?;
    Ok(())
}

async fn perform_sync(state: &AppState, is_manual: bool) -> Result<(), String> {
    let _guard = if is_manual {
        SYNC_LOCK.lock().await
    } else {
        match SYNC_LOCK.try_lock() {
            Ok(g) => g,
            Err(_) => return Ok(()),
        }
    };

    // Manual reset happens while holding the lock so no in-flight sync can
    // overwrite it with a failure that predates the reset.
    if is_manual {
        let mut rt = RUNTIME.lock();
        apply_manual_sync_trigger(&mut rt);
    }

    let (enabled, zone_id, hostname) = {
        let s = state.settings.read();
        (
            s.ddns_enabled,
            s.ddns_zone_id.clone().unwrap_or_default(),
            s.ddns_hostname.clone().unwrap_or_default(),
        )
    };

    let token = crate::providers::vault::read_entry(VAULT_SLUG)
        .map_err(|e| format!("读取密钥库失败: {e}"))?;
    let token_present = token
        .as_deref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    let current_ip = super::ipv6::current_address();

    let decision = {
        let rt = RUNTIME.lock();
        should_sync(
            enabled,
            Some(&zone_id),
            Some(&hostname),
            token_present,
            current_ip,
            &rt,
            is_manual,
        )
    };

    match decision {
        SyncDecision::SkipDisabled => {
            if is_manual {
                return Err("DDNS 功能未启用".to_string());
            }
            return Ok(());
        }
        SyncDecision::SkipMissingConfig(which) => {
            if is_manual {
                let msg = match which {
                    "zone_id" => "未配置 Cloudflare Zone ID",
                    "hostname" => "未配置 DDNS 域名",
                    "token" => "未在密钥库中配置 Cloudflare API Token",
                    _ => "DDNS 配置不完整",
                };
                return Err(msg.to_string());
            }
            return Ok(());
        }
        SyncDecision::SkipHalted => {
            return Ok(());
        }
        SyncDecision::SkipNoAddress => {
            if is_manual {
                return Err("未检测到可用的公网 IPv6 地址".to_string());
            }
            return Ok(());
        }
        SyncDecision::SkipIpUnchanged => {
            return Ok(());
        }
        SyncDecision::Proceed => {}
    }

    let token_str = token.unwrap_or_default();
    let ip = current_ip.expect("checked in should_sync");
    let ip_str = ip.to_string();

    match execute_cf_sync(&zone_id, &hostname, &token_str, &ip_str).await {
        Ok(()) => {
            let now = chrono::Utc::now().to_rfc3339();
            let mut rt = RUNTIME.lock();
            apply_sync_success(&mut rt, &ip_str, &now, &hostname, &zone_id);
            Ok(())
        }
        Err(err) => {
            let user_msg = err.to_user_message();
            let mut rt = RUNTIME.lock();
            apply_sync_failure(&mut rt, &err);
            Err(user_msg)
        }
    }
}

// ─── Module Public API ───────────────────────────────────────────────────────

/// Query current DDNS status (cheap, in-memory, no network).
pub fn status(state: &AppState) -> DdnsStatus {
    let (enabled, hostname, zone_id) = {
        let s = state.settings.read();
        (
            s.ddns_enabled,
            s.ddns_hostname.clone(),
            s.ddns_zone_id.clone().unwrap_or_default(),
        )
    };
    let token_set = crate::providers::vault::contains(VAULT_SLUG);
    let rt = RUNTIME.lock();
    let last_ip = effective_last_ip(&rt, &zone_id, hostname.as_deref().unwrap_or_default());
    DdnsStatus {
        enabled,
        token_set,
        hostname,
        last_ip,
        last_sync_at: rt.last_sync_at.clone(),
        last_error: rt.last_error.clone(),
        halted: rt.halted,
    }
}

/// Initialize background DDNS sync loop.
pub fn init(state: AppState) {
    tauri::async_runtime::spawn(async move {
        // Initial sync attempt on startup
        let _ = perform_sync(&state, false).await;

        loop {
            let delay = {
                let rt = RUNTIME.lock();
                backoff_duration(rt.consecutive_failures)
            };
            tokio::time::sleep(delay).await;

            let _ = perform_sync(&state, false).await;
        }
    });
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mobile_ddns_set_token(
    state: tauri::State<'_, AppState>,
    token: String,
) -> Result<DdnsStatus, String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("API Token 不能为空".to_string());
    }

    // Hold the single sync lock across verify + store + reset: token verify counts
    // as an in-flight API call, and no concurrent sync may overwrite the halted
    // reset below with a failure from the old token.
    let _guard = SYNC_LOCK.lock().await;

    // Verify token with Cloudflare API
    verify_cf_token(trimmed)
        .await
        .map_err(|e| e.to_user_message())?;

    // Store in encrypted vault
    crate::providers::vault::write_entry(VAULT_SLUG, trimmed)?;

    // Reset halted and error state upon setting a fresh valid token
    {
        let mut rt = RUNTIME.lock();
        rt.halted = false;
        rt.consecutive_failures = 0;
        rt.last_error = None;
    }

    Ok(status(&state))
}

#[tauri::command]
pub async fn mobile_ddns_clear_token(
    state: tauri::State<'_, AppState>,
) -> Result<DdnsStatus, String> {
    // Hold the sync lock so removal cannot race an in-flight sync still using the token.
    let _guard = SYNC_LOCK.lock().await;
    crate::providers::vault::remove_entry(VAULT_SLUG)?;
    Ok(status(&state))
}

#[tauri::command]
pub async fn mobile_ddns_sync(state: tauri::State<'_, AppState>) -> Result<DdnsStatus, String> {
    // perform_sync applies the manual trigger while holding SYNC_LOCK, so the
    // reset cannot interleave with an in-flight sync's failure.
    perform_sync(&state, true).await?;

    Ok(status(&state))
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    // 1. Response parsing tests (Token verify)

    #[test]
    fn test_parse_token_verify_success() {
        let body = r#"{
            "result": { "id": "tok-123", "status": "active" },
            "success": true,
            "errors": [],
            "messages": []
        }"#;
        assert!(parse_token_verify_response(200, body).is_ok());
    }

    #[test]
    fn test_parse_token_verify_inactive() {
        let body = r#"{
            "result": { "id": "tok-123", "status": "disabled" },
            "success": true,
            "errors": [],
            "messages": []
        }"#;
        let res = parse_token_verify_response(200, body);
        assert!(matches!(res, Err(DdnsError::AuthFailed(_))));
    }

    #[test]
    fn test_parse_token_verify_auth_failed_401() {
        let res = parse_token_verify_response(401, "{}");
        assert_eq!(
            res,
            Err(DdnsError::AuthFailed("Token 无效或权限不足".to_string()))
        );
        assert!(res.unwrap_err().is_fatal());
    }

    #[test]
    fn test_parse_token_verify_auth_failed_403() {
        let res = parse_token_verify_response(403, "{}");
        assert_eq!(
            res,
            Err(DdnsError::AuthFailed("Token 无效或权限不足".to_string()))
        );
        assert!(res.unwrap_err().is_fatal());
    }

    #[test]
    fn test_parse_token_verify_rate_limit_429() {
        let res = parse_token_verify_response(429, "{}");
        assert_eq!(res, Err(DdnsError::RateLimited("请求过于频繁".to_string())));
        assert!(res.unwrap_err().is_fatal());
    }

    #[test]
    fn test_parse_token_verify_cloudflare_error() {
        let body = r#"{
            "result": null,
            "success": false,
            "errors": [{ "code": 1000, "message": "Invalid token format" }],
            "messages": []
        }"#;
        let res = parse_token_verify_response(200, body);
        assert_eq!(
            res,
            Err(DdnsError::ApiError("Invalid token format".to_string()))
        );
    }

    // 2. Response parsing tests (DNS records)

    #[test]
    fn test_parse_dns_records_found() {
        let body = r#"{
            "result": [
                {
                    "id": "rec-1",
                    "type": "AAAA",
                    "name": "home.example.com",
                    "content": "2400:cb00::1",
                    "proxied": false,
                    "ttl": 120
                },
                {
                    "id": "rec-2",
                    "type": "A",
                    "name": "home.example.com",
                    "content": "1.2.3.4",
                    "proxied": false,
                    "ttl": 120
                }
            ],
            "success": true,
            "errors": [],
            "messages": []
        }"#;
        let records = parse_dns_records_response(200, body).unwrap();
        assert_eq!(records.len(), 2);

        let matched = find_matching_record(&records, "home.example.com").unwrap();
        assert_eq!(matched.id, "rec-1");
        assert_eq!(matched.content.as_deref(), Some("2400:cb00::1"));
    }

    #[test]
    fn test_parse_dns_records_not_found() {
        let body = r#"{
            "result": [],
            "success": true,
            "errors": [],
            "messages": []
        }"#;
        let records = parse_dns_records_response(200, body).unwrap();
        assert!(records.is_empty());
        assert!(find_matching_record(&records, "home.example.com").is_none());
    }

    #[test]
    fn test_parse_dns_records_cf_error() {
        let body = r#"{
            "result": null,
            "success": false,
            "errors": [{ "code": 1001, "message": "Invalid zone identifier" }]
        }"#;
        let res = parse_dns_records_response(200, body);
        assert_eq!(
            res,
            Err(DdnsError::ApiError("Invalid zone identifier".to_string()))
        );
    }

    // 3. Response parsing tests (Mutation PUT/POST)

    #[test]
    fn test_parse_dns_mutation_success() {
        let body = r#"{
            "result": {
                "id": "rec-new",
                "type": "AAAA",
                "name": "home.example.com",
                "content": "2400:cb00::2",
                "proxied": false,
                "ttl": 120
            },
            "success": true,
            "errors": []
        }"#;
        let rec = parse_dns_mutation_response(200, body).unwrap();
        assert_eq!(rec.id, "rec-new");
        assert_eq!(rec.content.as_deref(), Some("2400:cb00::2"));
    }

    #[test]
    fn test_parse_dns_mutation_failure_status_401() {
        let res = parse_dns_mutation_response(401, "{}");
        assert!(matches!(res, Err(DdnsError::AuthFailed(_))));
        assert!(res.unwrap_err().is_fatal());
    }

    #[test]
    fn test_parse_dns_mutation_cf_error() {
        let body = r#"{
            "result": null,
            "success": false,
            "errors": [{ "code": 1004, "message": "DNS Validation Error" }]
        }"#;
        let res = parse_dns_mutation_response(400, body);
        assert_eq!(
            res,
            Err(DdnsError::ApiError("DNS Validation Error".to_string()))
        );
    }

    // 4. Decision logic tests

    #[test]
    fn test_decision_skip_when_disabled() {
        let rt = DdnsRuntime::default();
        let ip = Ipv6Addr::from_str("2400:cb00::1").ok();
        let dec = should_sync(
            false,
            Some("zone-1"),
            Some("home.com"),
            true,
            ip,
            &rt,
            false,
        );
        assert_eq!(dec, SyncDecision::SkipDisabled);
    }

    #[test]
    fn test_decision_skip_when_missing_config() {
        let rt = DdnsRuntime::default();
        let ip = Ipv6Addr::from_str("2400:cb00::1").ok();

        // Missing zone_id
        assert_eq!(
            should_sync(true, None, Some("home.com"), true, ip, &rt, false),
            SyncDecision::SkipMissingConfig("zone_id")
        );
        assert_eq!(
            should_sync(true, Some("   "), Some("home.com"), true, ip, &rt, false),
            SyncDecision::SkipMissingConfig("zone_id")
        );

        // Missing hostname
        assert_eq!(
            should_sync(true, Some("zone-1"), None, true, ip, &rt, false),
            SyncDecision::SkipMissingConfig("hostname")
        );

        // Missing token
        assert_eq!(
            should_sync(
                true,
                Some("zone-1"),
                Some("home.com"),
                false,
                ip,
                &rt,
                false
            ),
            SyncDecision::SkipMissingConfig("token")
        );
    }

    #[test]
    fn test_decision_skip_when_no_ipv6() {
        let rt = DdnsRuntime::default();
        assert_eq!(
            should_sync(
                true,
                Some("zone-1"),
                Some("home.com"),
                true,
                None,
                &rt,
                false
            ),
            SyncDecision::SkipNoAddress
        );
    }

    #[test]
    fn test_decision_skip_when_ip_unchanged() {
        let rt = DdnsRuntime {
            last_ip: Some("2400:cb00::1".to_string()),
            last_synced_host: Some("home.com".to_string()),
            last_synced_zone: Some("zone-1".to_string()),
            ..Default::default()
        };
        let ip = Ipv6Addr::from_str("2400:cb00::1").ok();
        // Background sync skips when IP is unchanged and settings match the last sync
        assert_eq!(
            should_sync(true, Some("zone-1"), Some("home.com"), true, ip, &rt, false),
            SyncDecision::SkipIpUnchanged
        );
        // Manual sync proceeds even when IP is unchanged
        assert_eq!(
            should_sync(true, Some("zone-1"), Some("home.com"), true, ip, &rt, true),
            SyncDecision::Proceed
        );
    }

    #[test]
    fn test_decision_proceed_when_ip_changed_or_initial() {
        // Initial sync (last_ip is None)
        let rt = DdnsRuntime::default();
        let ip = Ipv6Addr::from_str("2400:cb00::1").ok();
        assert_eq!(
            should_sync(true, Some("zone-1"), Some("home.com"), true, ip, &rt, false),
            SyncDecision::Proceed
        );

        // Changed IP
        let rt2 = DdnsRuntime {
            last_ip: Some("2400:cb00::1".to_string()),
            ..Default::default()
        };
        let ip2 = Ipv6Addr::from_str("2400:cb00::2").ok();
        assert_eq!(
            should_sync(
                true,
                Some("zone-1"),
                Some("home.com"),
                true,
                ip2,
                &rt2,
                false
            ),
            SyncDecision::Proceed
        );
    }

    #[test]
    fn test_decision_halted_skips_background_but_manual_clears() {
        let mut rt = DdnsRuntime {
            halted: true,
            consecutive_failures: 3,
            ..Default::default()
        };
        let ip = Ipv6Addr::from_str("2400:cb00::1").ok();

        // Background sync skips when halted
        assert_eq!(
            should_sync(true, Some("zone-1"), Some("home.com"), true, ip, &rt, false),
            SyncDecision::SkipHalted
        );

        // Trigger manual sync
        apply_manual_sync_trigger(&mut rt);
        assert!(!rt.halted);
        assert_eq!(rt.consecutive_failures, 0);

        // After clearing halt, should_sync proceeds
        assert_eq!(
            should_sync(true, Some("zone-1"), Some("home.com"), true, ip, &rt, true),
            SyncDecision::Proceed
        );
    }

    // 5. State transitions and failure handling

    #[test]
    fn test_fatal_error_halts_immediately() {
        let mut rt = DdnsRuntime::default();

        // 401
        apply_sync_failure(&mut rt, &DdnsError::AuthFailed("bad token".to_string()));
        assert!(rt.halted);
        assert!(rt.last_error.is_some());

        // Reset and test 429
        rt.halted = false;
        apply_sync_failure(&mut rt, &DdnsError::RateLimited("too many".to_string()));
        assert!(rt.halted);
    }

    #[test]
    fn test_three_consecutive_failures_halts() {
        let mut rt = DdnsRuntime::default();
        let net_err = DdnsError::Network("timeout".to_string());

        // Failure 1
        apply_sync_failure(&mut rt, &net_err);
        assert_eq!(rt.consecutive_failures, 1);
        assert!(!rt.halted);
        assert_eq!(
            backoff_duration(rt.consecutive_failures),
            Duration::from_secs(30)
        );

        // Failure 2
        apply_sync_failure(&mut rt, &net_err);
        assert_eq!(rt.consecutive_failures, 2);
        assert!(!rt.halted);
        assert_eq!(
            backoff_duration(rt.consecutive_failures),
            Duration::from_secs(60)
        );

        // Failure 3 -> halts!
        apply_sync_failure(&mut rt, &net_err);
        assert_eq!(rt.consecutive_failures, 3);
        assert!(rt.halted);
    }

    #[test]
    fn test_success_resets_failures() {
        let mut rt = DdnsRuntime {
            consecutive_failures: 2,
            last_error: Some("previous error".to_string()),
            ..Default::default()
        };

        apply_sync_success(
            &mut rt,
            "2400:cb00::1",
            "2026-10-15T00:00:00Z",
            "home.com",
            "zone-1",
        );
        assert_eq!(rt.consecutive_failures, 0);
        assert!(!rt.halted);
        assert_eq!(rt.last_ip.as_deref(), Some("2400:cb00::1"));
        assert_eq!(rt.last_sync_at.as_deref(), Some("2026-10-15T00:00:00Z"));
        assert!(rt.last_error.is_none());
        assert_eq!(rt.last_synced_host.as_deref(), Some("home.com"));
        assert_eq!(rt.last_synced_zone.as_deref(), Some("zone-1"));
    }

    // 6. Last-synced settings tracking and manual-sync lock ordering (F8)

    #[test]
    fn test_hostname_change_triggers_resync() {
        // Last successful sync used the old hostname/zone with the current IP.
        let rt = DdnsRuntime {
            last_ip: Some("2400:cb00::1".to_string()),
            last_synced_host: Some("old.example.com".to_string()),
            last_synced_zone: Some("zone-1".to_string()),
            ..Default::default()
        };
        let ip = Ipv6Addr::from_str("2400:cb00::1").ok();

        // Hostname change: the AAAA record for the new name does not exist yet,
        // so the background loop must sync instead of skipping.
        assert_eq!(
            should_sync(
                true,
                Some("zone-1"),
                Some("new.example.com"),
                true,
                ip,
                &rt,
                false
            ),
            SyncDecision::Proceed
        );
        // Zone change counts the same way.
        assert_eq!(
            should_sync(
                true,
                Some("zone-2"),
                Some("old.example.com"),
                true,
                ip,
                &rt,
                false
            ),
            SyncDecision::Proceed
        );
        // Unchanged settings with the same IP still skip.
        assert_eq!(
            should_sync(
                true,
                Some("zone-1"),
                Some("old.example.com"),
                true,
                ip,
                &rt,
                false
            ),
            SyncDecision::SkipIpUnchanged
        );
    }

    #[test]
    fn test_hostname_change_reports_not_synced() {
        let rt = DdnsRuntime {
            last_ip: Some("2400:cb00::1".to_string()),
            last_synced_host: Some("old.example.com".to_string()),
            last_synced_zone: Some("zone-1".to_string()),
            ..Default::default()
        };

        // Current settings differ from the last synced ones: no synced IP is claimed.
        assert_eq!(effective_last_ip(&rt, "zone-1", "new.example.com"), None);
        assert_eq!(effective_last_ip(&rt, "zone-2", "old.example.com"), None);
        // Matching settings still report the synced IP.
        assert_eq!(
            effective_last_ip(&rt, "zone-1", "old.example.com"),
            Some("2400:cb00::1".to_string())
        );
        // Never-synced runtime reports nothing even with matching settings.
        assert_eq!(
            effective_last_ip(&DdnsRuntime::default(), "zone-1", "old.example.com"),
            None
        );
    }

    #[test]
    fn test_apply_sync_success_records_host_and_zone() {
        let mut rt = DdnsRuntime::default();
        apply_sync_success(
            &mut rt,
            "2400:cb00::1",
            "2026-10-15T00:00:00Z",
            "Home.Example.COM.",
            "zone-1",
        );
        assert_eq!(rt.last_synced_host.as_deref(), Some("Home.Example.COM."));
        assert_eq!(rt.last_synced_zone.as_deref(), Some("zone-1"));

        let ip = Ipv6Addr::from_str("2400:cb00::1").ok();
        // The same DNS name in any case/dot form counts as synced (DNS names are
        // case-insensitive and a trailing dot is semantically null).
        assert_eq!(
            should_sync(
                true,
                Some("zone-1"),
                Some("home.example.com"),
                true,
                ip,
                &rt,
                false
            ),
            SyncDecision::SkipIpUnchanged
        );
    }

    #[test]
    fn test_manual_sync_clears_halt_under_lock_ordering() {
        // Pure model of the corrected lock discipline: every state transition
        // happens while holding SYNC_LOCK, so an in-flight sync's failure is
        // always applied BEFORE the manual trigger clears the halt, never after.
        let mut rt = DdnsRuntime {
            halted: true,
            consecutive_failures: 3,
            last_error: Some("Cloudflare API 认证失败: old token".to_string()),
            ..Default::default()
        };
        let ip = Ipv6Addr::from_str("2400:cb00::1").ok();

        // 1. In-flight sync (old token) fails while holding the lock.
        apply_sync_failure(&mut rt, &DdnsError::AuthFailed("old token".to_string()));
        assert!(rt.halted);

        // 2. Manual trigger runs afterwards under the same lock and clears the halt.
        apply_manual_sync_trigger(&mut rt);
        assert!(!rt.halted);
        assert_eq!(rt.consecutive_failures, 0);

        // 3. The manual sync decision proceeds despite the earlier halt.
        assert_eq!(
            should_sync(true, Some("zone-1"), Some("home.com"), true, ip, &rt, true),
            SyncDecision::Proceed
        );

        // 4. A fatal failure of the manual sync itself re-halts.
        apply_sync_failure(&mut rt, &DdnsError::AuthFailed("still bad".to_string()));
        assert!(rt.halted);
    }
}
