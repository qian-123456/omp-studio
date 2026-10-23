//! [providers] Read-only access to OMP's own state under `~/.omp/agent/`:
//! the agent dir path, `agent.db` credential metadata and `models.db` cache.
//!
//! Zero-exposure invariant: secrets are NEVER logged or returned to the frontend.
//! `read_agent_api_key` hands a key to in-process callers (provider probes) only.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// OMP agent dir, resolved exactly like the sessions' own processes do:
/// `PI_CODING_AGENT_DIR`, then a profile (`OMP_PROFILE` / `PI_PROFILE`) →
/// `~/.omp/profiles/<name>/agent`, else `~/.omp/agent`. Every provider/config
/// path below hangs off this, so a profile switch never edits another profile.
pub fn home_agent_dir() -> PathBuf {
    crate::paths::agent_dir()
}

/// Query `agent.db` for authenticated credentials without selecting secrets.
/// Returns mapping of `provider -> (sorted_credential_types, accounts)`.
pub fn scan_agent_db(db_path: &Path) -> HashMap<String, (Vec<String>, Vec<String>)> {
    let mut map: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return map;
    };

    let Ok(mut stmt) = conn.prepare(
        "SELECT provider, credential_type, identity_key FROM auth_credentials WHERE disabled_cause IS NULL",
    ) else {
        return map;
    };

    let Ok(rows) = stmt.query_map([], |row| {
        let provider: String = row.get(0)?;
        let credential_type: Option<String> = row.get(1)?;
        let identity_key: Option<String> = row.get(2)?;
        Ok((provider, credential_type, identity_key))
    }) else {
        return map;
    };

    for (prov, cred_type, ident) in rows.flatten() {
        let entry = map.entry(prov).or_default();
        if let Some(ct) = cred_type {
            let ct = ct.trim().to_string();
            if !ct.is_empty() && !entry.0.contains(&ct) {
                entry.0.push(ct);
            }
        }
        if let Some(ik) = ident {
            let ik = ik.trim().to_string();
            if !ik.is_empty() && !entry.1.contains(&ik) {
                entry.1.push(ik);
            }
        }
    }

    for (cts, _accs) in map.values_mut() {
        cts.sort();
    }

    map
}

/// Query `agent.db` for authenticated API key for the specified provider.
///
/// Zero-exposure invariant: Secret data from `auth_credentials` is parsed in memory
/// and only the specific API key string value is extracted. The raw record data is
/// NEVER returned or exposed.
pub fn read_agent_api_key(db_path: &Path, provider: &str) -> Option<String> {
    let conn =
        rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;

    let mut stmt = conn
        .prepare(
            "SELECT data FROM auth_credentials WHERE provider=?1 AND credential_type='api_key' AND disabled_cause IS NULL ORDER BY updated_at DESC LIMIT 1",
        )
        .ok()?;

    let data: String = stmt.query_row([provider], |row| row.get(0)).ok()?;
    let val: serde_json::Value = serde_json::from_str(&data).ok()?;
    let obj = val.as_object()?;

    for candidate in &["apiKey", "api_key", "key", "accessToken", "access"] {
        if let Some(v) = obj.get(*candidate).and_then(|v| v.as_str()) {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    None
}

/// Endpoint and model ids OMP cached for a provider (`models.db`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CachedEndpoint {
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub model_ids: Vec<String>,
}

/// Pure parse of a `model_cache.models` JSON array: first non-empty `baseUrl`
/// and first non-empty `api` among the models, plus every model id.
pub fn parse_cached_endpoint(models_json: &str) -> Option<CachedEndpoint> {
    let val: serde_json::Value = serde_json::from_str(models_json).ok()?;
    let arr = val.as_array()?;
    let pick = |key: &str| {
        arr.iter()
            .filter_map(|m| m.get(key).and_then(|v| v.as_str()))
            .map(str::trim)
            .find(|s| !s.is_empty())
            .map(ToString::to_string)
    };
    let mut model_ids: Vec<String> = Vec::new();
    for id in arr
        .iter()
        .filter_map(|m| m.get("id").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if !model_ids.iter().any(|m| m == id) {
            model_ids.push(id.to_string());
        }
    }
    let ep = CachedEndpoint {
        base_url: pick("baseUrl"),
        api: pick("api"),
        model_ids,
    };
    (ep.base_url.is_some() || ep.api.is_some() || !ep.model_ids.is_empty()).then_some(ep)
}

/// Read-only lookup of OMP's model cache (`~/.omp/agent/models.db`).
pub fn read_model_cache_endpoint(db_path: &Path, provider_id: &str) -> Option<CachedEndpoint> {
    let conn =
        rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    let models: String = conn
        .query_row(
            "SELECT models FROM model_cache WHERE provider_id=?1",
            [provider_id],
            |row| row.get(0),
        )
        .ok()?;
    parse_cached_endpoint(&models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cached_endpoint_parses_first_model_values_and_ids() {
        let ep = parse_cached_endpoint(
            r#"[{"id":"a"},{"id":"b","baseUrl":" https://x.dev/v4 ","api":"openai-completions"},{"id":"a"}]"#,
        )
        .unwrap();
        assert_eq!(ep.base_url.as_deref(), Some("https://x.dev/v4"));
        assert_eq!(ep.api.as_deref(), Some("openai-completions"));
        assert_eq!(ep.model_ids, ["a", "b"]);
        assert!(parse_cached_endpoint("[]").is_none());
        assert!(parse_cached_endpoint("nope").is_none());
    }

    #[test]
    fn test_read_agent_api_key() {
        let temp_dir = std::env::temp_dir();
        let db_name = format!("test_agent_{}.db", uuid::Uuid::new_v4());
        let db_path = temp_dir.join(db_name);

        // 1. Create table with real schema
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute(
                "CREATE TABLE auth_credentials (
                    provider TEXT NOT NULL,
                    credential_type TEXT NOT NULL,
                    data TEXT NOT NULL,
                    disabled_cause TEXT,
                    identity_key TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )",
                [],
            )
            .unwrap();

            // Insert valid api_key row
            conn.execute(
                "INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, identity_key, created_at, updated_at)
                 VALUES ('test-provider', 'api_key', '{\"apiKey\":\"sk-test\"}', NULL, 'ident-1', '2026-01-01', '2026-01-02')",
                [],
            )
            .unwrap();

            // Insert oauth row for another provider
            conn.execute(
                "INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, identity_key, created_at, updated_at)
                 VALUES ('oauth-provider', 'oauth', '{\"accessToken\":\"oauth-token-123\"}', NULL, 'ident-2', '2026-01-01', '2026-01-02')",
                [],
            )
            .unwrap();

            // Insert disabled api_key row
            conn.execute(
                "INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, identity_key, created_at, updated_at)
                 VALUES ('disabled-provider', 'api_key', '{\"apiKey\":\"sk-disabled\"}', 'revoked', 'ident-3', '2026-01-01', '2026-01-02')",
                [],
            )
            .unwrap();
        }

        // Test valid api_key returns "sk-test"
        let key = read_agent_api_key(&db_path, "test-provider");
        assert_eq!(key.as_deref(), Some("sk-test"));

        // Test oauth row returns None
        let oauth_key = read_agent_api_key(&db_path, "oauth-provider");
        assert_eq!(oauth_key, None);

        // Test disabled row returns None
        let disabled_key = read_agent_api_key(&db_path, "disabled-provider");
        assert_eq!(disabled_key, None);

        // Test non-existent provider returns None
        let none_key = read_agent_api_key(&db_path, "non-existent");
        assert_eq!(none_key, None);

        // Test missing db file returns None
        let missing_path = temp_dir.join(format!("missing_{}.db", uuid::Uuid::new_v4()));
        assert_eq!(read_agent_api_key(&missing_path, "test-provider"), None);

        // Clean up temp db file
        let _ = std::fs::remove_file(&db_path);
    }
}
