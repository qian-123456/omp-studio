//! SQLite open + migrations (docs/ARCHITECTURE.md §6).

use rusqlite::Connection;

use crate::contracts::Settings;
use crate::paths;

const SCHEMA_V1: &str = "
CREATE TABLE workspaces(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE session_meta(
  session_id TEXT PRIMARY KEY, file_path TEXT, custom_name TEXT, label TEXT,
  pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  parent_session_id TEXT, fork_depth INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT, unread INTEGER NOT NULL DEFAULT 0, pending_kind TEXT, pending_since TEXT,
  accepted_at TEXT, last_seen_at TEXT, suspended INTEGER NOT NULL DEFAULT 0, created_by_app INTEGER NOT NULL DEFAULT 0,
  seq INTEGER);
CREATE TABLE todos(id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT,
  title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', priority INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE backlog(id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
  target_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE summaries(session_id TEXT PRIMARY KEY, summary TEXT NOT NULL, upto_offset INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE mobile_devices(token_hash TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL, last_seen_at TEXT);
CREATE TABLE pairing_codes(code TEXT PRIMARY KEY, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
";

/// Open (creating if needed) the app database and run pending migrations.
pub fn open() -> rusqlite::Result<Connection> {
    let conn = Connection::open(paths::db_path())?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    Ok(())
}

/// Load Settings, merging stored keys over `Settings::default()` so missing
/// keys get their documented defaults.
pub fn load_settings(conn: &Connection) -> Settings {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'settings'",
            [],
            |row| row.get(0),
        )
        .ok();
    let Some(json) = stored else {
        return Settings::default();
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&json) else {
        return Settings::default();
    };
    let defaults = serde_json::to_value(Settings::default()).unwrap_or(serde_json::Value::Null);
    if let (serde_json::Value::Object(stored_map), serde_json::Value::Object(default_map)) =
        (&mut value, defaults)
    {
        for (key, default_value) in default_map {
            stored_map.entry(key).or_insert(default_value);
        }
    }
    serde_json::from_value(value).unwrap_or_default()
}

/// Persist Settings into the single-row `settings` table.
pub fn save_settings(conn: &Connection, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| format!("serialize settings: {e}"))?;
    conn.execute(
        "INSERT INTO settings(key, value) VALUES('settings', ?1)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![json],
    )
    .map_err(|e| format!("save settings: {e}"))?;
    Ok(())
}

/// Ensure the 🌐 Global workspace row exists (§3, §A).
pub fn ensure_global_workspace(conn: &Connection) -> rusqlite::Result<()> {
    let path = paths::global_dir().to_string_lossy().to_string();
    conn.execute(
        "INSERT INTO workspaces(id, path, name, kind, sort, created_at)
		 VALUES('global', ?1, '🌐 全局', 'global', -1, ?2)
		 ON CONFLICT(path) DO NOTHING",
        rusqlite::params![path, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}
