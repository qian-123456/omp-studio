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
    // v2: sessions whose worktree dir was deleted can be resumed in the repo's
    // main directory; the chosen cwd is persisted here (§6).
    if version < 2 {
        conn.execute_batch("ALTER TABLE session_meta ADD COLUMN cwd_override TEXT;")?;
        conn.pragma_update(None, "user_version", 2)?;
    }
    // v3: scheduled tasks (schedules and schedule_runs tables).
    if version < 3 {
        conn.execute_batch(
            "CREATE TABLE schedules(
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               prompt TEXT NOT NULL,
               cwd TEXT NOT NULL,
               run_mode TEXT NOT NULL DEFAULT 'local',
               cadence TEXT NOT NULL,
               model TEXT,
               thinking TEXT,
               approval_mode TEXT,
               enabled INTEGER NOT NULL DEFAULT 1,
               next_run_at TEXT,
               last_run_at TEXT,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE schedule_runs(
               id TEXT PRIMARY KEY,
               schedule_id TEXT NOT NULL,
               session_id TEXT,
               status TEXT NOT NULL,
               started_at TEXT NOT NULL,
               finished_at TEXT,
               summary TEXT,
               FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
             );
             CREATE INDEX idx_schedule_runs_schedule_id ON schedule_runs(schedule_id, started_at DESC);",
        )?;
        conn.pragma_update(None, "user_version", 3)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// v1 schema -> migrate() -> latest; v2 adds `cwd_override`, keeps rows.
    #[test]
    fn migrate_v2_adds_cwd_override() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute(
            "INSERT INTO session_meta(session_id, file_path) VALUES('s1', '/f')",
            [],
        )
        .unwrap();
        migrate(&conn).unwrap();
        let version: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 3);
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(session_meta)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(cols.iter().any(|c| c == "cwd_override"));
        let v: Option<String> = conn
            .query_row(
                "SELECT cwd_override FROM session_meta WHERE session_id='s1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, None);
        // Fresh DB reaches v2 in one pass.
        let fresh = Connection::open_in_memory().unwrap();
        migrate(&fresh).unwrap();
        let v3: u32 = fresh
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v3, 3);
    }

    #[test]
    fn migrate_v3_adds_schedules_tables() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let v: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 3);
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('schedules', 'schedule_runs')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }
}
