//! `session_usage`: Token Tracker (localhost:7680) with transcript fallback.
//!
//! Token Tracker's local API (discovered from its dashboard bundle) lives under
//! `/functions/tokentracker-*`; `tokentracker-session-insights` returns a
//! `sessions` array when it has per-session data. When the tracker is down or
//! has no row for the session we sum `usage` from the transcript. Never errors.

use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::contracts::UsageSummary;

const TRACKER_ADDR: &str = "127.0.0.1:7680";
const INSIGHTS_PATH: &str = "/functions/tokentracker-session-insights";
const CACHE_TTL: Duration = Duration::from_secs(60);

type InsightsCache = Mutex<Option<(Instant, Option<Value>)>>;
static INSIGHTS: OnceLock<InsightsCache> = OnceLock::new();

pub async fn summary(session_id: &str, file: Option<&Path>) -> UsageSummary {
    if let Some((tokens, cost)) = tracker_lookup(session_id).await {
        return UsageSummary {
            available: true,
            tokens,
            cost,
            source: "token-tracker".to_string(),
        };
    }
    let sum = match file {
        Some(f) => {
            let f = f.to_path_buf();
            tokio::task::spawn_blocking(move || super::transcript::sum_usage(&f).ok())
                .await
                .ok()
                .flatten()
        }
        None => None,
    };
    UsageSummary {
        available: sum.is_some(),
        tokens: sum.map_or(0, |s| s.0),
        cost: sum.map_or(0.0, |s| s.1),
        source: "transcript".to_string(),
    }
}

async fn tracker_lookup(session_id: &str) -> Option<(u64, f64)> {
    let insights = cached_insights().await?;
    find_session(&insights, session_id)
}

async fn cached_insights() -> Option<Value> {
    let cell = INSIGHTS.get_or_init(|| Mutex::new(None));
    if let Some((at, v)) = cell.lock().as_ref() {
        if at.elapsed() < CACHE_TTL {
            return v.clone();
        }
    }
    let fetched = http_get_json(TRACKER_ADDR, INSIGHTS_PATH).await;
    *cell.lock() = Some((Instant::now(), fetched.clone()));
    fetched
}

/// Find a per-session row in a session-insights payload.
pub fn find_session(insights: &Value, session_id: &str) -> Option<(u64, f64)> {
    let rows = insights.get("sessions")?.as_array()?;
    let row = rows.iter().find(|r| {
        ["session_id", "sessionId", "id"]
            .iter()
            .filter_map(|k| r.get(*k).and_then(Value::as_str))
            .any(|v| v == session_id || v.ends_with(session_id))
    })?;
    let tokens = ["total_tokens", "totalTokens", "tokens"]
        .iter()
        .find_map(|k| row.get(*k).and_then(Value::as_u64))?;
    let cost = ["cost_usd", "cost", "total_cost_usd"]
        .iter()
        .find_map(|k| {
            let v = row.get(*k)?;
            v.as_f64().or_else(|| v.as_str()?.parse().ok())
        })
        .unwrap_or(0.0);
    (tokens > 0).then_some((tokens, cost))
}

/// Minimal HTTP/1.1 GET returning a JSON body (1.5 s budget, no redirects).
async fn http_get_json(addr: &str, path: &str) -> Option<Value> {
    let fut = async {
        let mut stream = tokio::net::TcpStream::connect(addr).await.ok()?;
        let req = format!(
            "GET {path} HTTP/1.1\r\nHost: {addr}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(req.as_bytes()).await.ok()?;
        let mut buf = Vec::new();
        stream
            .take(32 * 1024 * 1024)
            .read_to_end(&mut buf)
            .await
            .ok()?;
        parse_http_json(&buf)
    };
    tokio::time::timeout(Duration::from_millis(1500), fut)
        .await
        .ok()
        .flatten()
}

fn parse_http_json(raw: &[u8]) -> Option<Value> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..split]).to_ascii_lowercase();
    if !head.starts_with("http/1.1 200") && !head.starts_with("http/1.0 200") {
        return None;
    }
    let body = &raw[split + 4..];
    if head.contains("transfer-encoding: chunked") {
        serde_json::from_slice(&dechunk(body)?).ok()
    } else {
        serde_json::from_slice(body).ok()
    }
}

fn dechunk(mut body: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line_end = body.windows(2).position(|w| w == b"\r\n")?;
        let size_str = std::str::from_utf8(&body[..line_end]).ok()?;
        let size = usize::from_str_radix(size_str.split(';').next()?.trim(), 16).ok()?;
        body = &body[line_end + 2..];
        if size == 0 {
            return Some(out);
        }
        out.extend_from_slice(body.get(..size)?);
        body = body.get(size + 2..)?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_session_rows() {
        let v = json!({"sessions":[{"session_id":"abc","total_tokens":10,"cost_usd":"0.5"},{"id":"zero","total_tokens":0}]});
        assert_eq!(find_session(&v, "abc"), Some((10, 0.5)));
        assert_eq!(find_session(&v, "zero"), None);
        assert_eq!(find_session(&v, "missing"), None);
        assert_eq!(find_session(&json!({"sessions":[]}), "abc"), None);
    }

    #[test]
    fn parses_http_bodies() {
        let plain = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"a\":1}";
        assert_eq!(parse_http_json(plain), Some(json!({"a":1})));
        let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"a\"\r\n3\r\n:2}\r\n0\r\n\r\n";
        assert_eq!(parse_http_json(chunked), Some(json!({"a":2})));
        assert_eq!(parse_http_json(b"HTTP/1.1 404 Not Found\r\n\r\n{}"), None);
    }

    #[tokio::test]
    async fn falls_back_to_transcript() {
        let dir = std::env::temp_dir().join(format!("ompws-usage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("s.jsonl");
        std::fs::write(
            &f,
            r#"{"type":"message","message":{"role":"assistant","usage":{"input":1,"output":2,"totalTokens":3,"cost":{"total":0.25}}}}
"#,
        )
        .unwrap();
        let s = summary("definitely-not-tracked-session", Some(&f)).await;
        assert!(s.available);
        assert_eq!((s.tokens, s.source.as_str()), (3, "transcript"));
        let none = summary("x", None).await;
        assert!(!none.available);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
