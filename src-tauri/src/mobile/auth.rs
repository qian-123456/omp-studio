//! Pairing codes (one-time, 5 min) and device tokens (stored as sha256 hashes).

use base64::Engine as _;
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub const COOKIE: &str = "ompws_token";
pub const PAIRING_TTL_MINUTES: i64 = 5;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token(pub String);

/// 32 random bytes, base64url without padding.
pub fn random_secret() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("os rng");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Create a pairing code; returns (code, expires_at RFC3339). Purges stale codes.
pub fn create_pairing(conn: &Connection, now: DateTime<Utc>) -> rusqlite::Result<(String, String)> {
    conn.execute(
        "DELETE FROM pairing_codes WHERE used = 1 OR expires_at < ?1",
        params![now.to_rfc3339()],
    )?;
    let code = random_secret();
    let expires = (now + Duration::minutes(PAIRING_TTL_MINUTES)).to_rfc3339();
    conn.execute(
        "INSERT INTO pairing_codes(code, expires_at, used) VALUES(?1, ?2, 0)",
        params![code, expires],
    )?;
    Ok((code, expires))
}

/// Consume a pairing code and mint a device token. `None` when the code is
/// unknown, used, or expired.
pub fn redeem(
    conn: &Connection,
    code: &str,
    device_name: &str,
    now: DateTime<Utc>,
) -> rusqlite::Result<Option<String>> {
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT expires_at, used FROM pairing_codes WHERE code = ?1",
            params![code],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((expires_at, used)) = row else {
        return Ok(None);
    };
    let expired = DateTime::parse_from_rfc3339(&expires_at)
        .map(|t| t.with_timezone(&Utc) < now)
        .unwrap_or(true);
    if used != 0 || expired {
        return Ok(None);
    }
    // Conditional update makes redemption single-use even under races.
    let changed = conn.execute(
        "UPDATE pairing_codes SET used = 1 WHERE code = ?1 AND used = 0",
        params![code],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    let token = random_secret();
    conn.execute(
        "INSERT INTO mobile_devices(token_hash, name, created_at, last_seen_at) VALUES(?1, ?2, ?3, ?3)",
        params![hash_token(&token), device_name, now.to_rfc3339()],
    )?;
    Ok(Some(token))
}

/// True when the token belongs to a paired device; touches `last_seen_at`.
pub fn verify(conn: &Connection, token: &str, now: DateTime<Utc>) -> bool {
    if token.is_empty() {
        return false;
    }
    conn.execute(
        "UPDATE mobile_devices SET last_seen_at = ?2 WHERE token_hash = ?1",
        params![hash_token(token), now.to_rfc3339()],
    )
    .map(|n| n > 0)
    .unwrap_or(false)
}

/// True when the token belongs to a paired device, without updating `last_seen_at`.
pub fn is_valid(conn: &Connection, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    conn.query_row(
        "SELECT 1 FROM mobile_devices WHERE token_hash = ?1",
        params![hash_token(token)],
        |_| Ok(()),
    )
    .optional()
    .map(|r| r.is_some())
    .unwrap_or(false)
}

pub fn revoke_all(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DELETE FROM mobile_devices; DELETE FROM pairing_codes; DELETE FROM push_subscriptions;",
    )
}

/// Extract the device token from `Cookie` or `Authorization: Bearer` headers.
pub fn token_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(auth) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(t) = auth.strip_prefix("Bearer ") {
            return Some(t.trim().to_string());
        }
    }
    headers
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == COOKIE)
        .map(|(_, v)| v.to_string())
}

#[cfg(test)]
pub fn test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE mobile_devices(token_hash TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL, last_seen_at TEXT);
         CREATE TABLE pairing_codes(code TEXT PRIMARY KEY, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE push_subscriptions(endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
           token_hash TEXT NOT NULL, created_at TEXT NOT NULL);
         CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_is_one_time_and_expires() {
        let db = test_db();
        let now = Utc::now();
        let (code, _) = create_pairing(&db, now).unwrap();
        assert_eq!(code.len(), 43); // 32 bytes base64url
        let token = redeem(&db, &code, "phone", now).unwrap().expect("token");
        assert!(verify(&db, &token, now));
        assert!(
            redeem(&db, &code, "phone", now).unwrap().is_none(),
            "reused"
        );
        assert!(!verify(&db, "bogus", now));

        let (late, _) = create_pairing(&db, now).unwrap();
        let later = now + Duration::minutes(PAIRING_TTL_MINUTES + 1);
        assert!(
            redeem(&db, &late, "phone", later).unwrap().is_none(),
            "expired"
        );
        assert!(redeem(&db, "nope", "phone", now).unwrap().is_none());

        // Only the hash is stored.
        let stored: String = db
            .query_row("SELECT token_hash FROM mobile_devices", [], |r| r.get(0))
            .unwrap();
        assert_ne!(stored, token);
        assert_eq!(stored, hash_token(&token));
        assert!(is_valid(&db, &token));

        revoke_all(&db).unwrap();
        assert!(!verify(&db, &token, now));
        assert!(!is_valid(&db, &token));
    }

    #[test]
    fn token_extraction() {
        use axum::http::{header, HeaderMap, HeaderValue};
        let mut h = HeaderMap::new();
        h.insert(
            header::COOKIE,
            HeaderValue::from_static("a=1; ompws_token=abc; b=2"),
        );
        assert_eq!(token_from_headers(&h).as_deref(), Some("abc"));
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer xyz"),
        );
        assert_eq!(token_from_headers(&h).as_deref(), Some("xyz"));
        assert!(token_from_headers(&HeaderMap::new()).is_none());
    }
}
