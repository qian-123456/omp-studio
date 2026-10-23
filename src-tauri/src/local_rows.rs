//! Persisted app-local thread rows (slash-command echoes / result cards, retry
//! and compaction notices): one JSON array per session (docs/ARCHITECTURE.md §6
//! `local_rows`, §7 `local_rows_get` / `local_rows_set`). The array is opaque to
//! Rust; the frontend owns its shape and time/anchor placement.

use rusqlite::{params, Connection, OptionalExtension};

use crate::state::AppState;

/// Upper bound of one session's serialized rows; larger payloads are rejected.
const MAX_ROWS_BYTES: usize = 2 * 1024 * 1024;

fn get(conn: &Connection, session_id: &str) -> Result<serde_json::Value, String> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT rows FROM local_rows WHERE session_id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("read local rows: {e}"))?;
    Ok(stored
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new())))
}

fn set(conn: &Connection, session_id: &str, rows: &serde_json::Value) -> Result<(), String> {
    let Some(list) = rows.as_array() else {
        return Err("local rows must be an array".to_string());
    };
    if list.is_empty() {
        conn.execute(
            "DELETE FROM local_rows WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|e| format!("clear local rows: {e}"))?;
        return Ok(());
    }
    let json = serde_json::to_string(rows).map_err(|e| format!("serialize local rows: {e}"))?;
    if json.len() > MAX_ROWS_BYTES {
        return Err("local rows too large".to_string());
    }
    conn.execute(
        "INSERT INTO local_rows(session_id, rows, updated_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET rows = excluded.rows, updated_at = excluded.updated_at",
        params![session_id, json, crate::schedules::store::now_rfc3339()],
    )
    .map_err(|e| format!("save local rows: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn local_rows_get(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    get(&state.db.lock(), &session_id)
}

#[tauri::command]
pub async fn local_rows_set(
    state: tauri::State<'_, AppState>,
    session_id: String,
    rows: serde_json::Value,
) -> Result<(), String> {
    set(&state.db.lock(), &session_id, &rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        c
    }

    #[test]
    fn roundtrip_and_clear() {
        let c = conn();
        assert_eq!(get(&c, "s1").unwrap(), json!([]));
        let rows = json!([{"id": "a", "ts": 1}]);
        set(&c, "s1", &rows).unwrap();
        assert_eq!(get(&c, "s1").unwrap(), rows);
        set(&c, "s1", &json!([])).unwrap();
        assert_eq!(get(&c, "s1").unwrap(), json!([]));
    }

    #[test]
    fn rejects_non_array() {
        let c = conn();
        assert!(set(&c, "s1", &json!({"a": 1})).is_err());
    }
}
