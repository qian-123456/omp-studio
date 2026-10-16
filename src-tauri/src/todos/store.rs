//! `todos` table access (docs/ARCHITECTURE.md §6). Pure rusqlite, no async.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

use crate::contracts::{Todo, TodoCounts, TodoKind, TodoSource, TodoStatus};

pub fn enum_str<T: Serialize>(v: T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

pub fn parse_enum<T: DeserializeOwned>(s: &str) -> Option<T> {
    serde_json::from_value(Value::String(s.to_string())).ok()
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn priority_of(kind: TodoKind) -> i32 {
    match kind {
        TodoKind::Approval => 50,
        TodoKind::Question => 40,
        TodoKind::Error => 30,
        TodoKind::Interrupted => 25,
        TodoKind::Review => 20,
        TodoKind::ServiceLeft => 15,
        TodoKind::ScheduleRun => 12,
    }
}

#[derive(Debug, Clone)]
pub struct NewTodo {
    pub kind: TodoKind,
    pub source: TodoSource,
    pub session_id: Option<String>,
    pub title: String,
    pub detail: String,
    pub payload: Value,
}

impl NewTodo {
    pub fn system(kind: TodoKind, session_id: &str, title: String, detail: String) -> Self {
        Self {
            kind,
            source: TodoSource::System,
            session_id: Some(session_id.to_string()),
            title,
            detail,
            payload: Value::Object(Default::default()),
        }
    }
}

const COLS: &str =
    "id, kind, source, status, session_id, title, detail, payload, priority, created_at, updated_at";

fn row_to_todo(r: &Row) -> rusqlite::Result<Todo> {
    let kind: String = r.get(1)?;
    let source: String = r.get(2)?;
    let status: String = r.get(3)?;
    let payload: String = r.get(7)?;
    Ok(Todo {
        id: r.get(0)?,
        kind: parse_enum(&kind).unwrap_or(TodoKind::Review),
        source: parse_enum(&source).unwrap_or(TodoSource::System),
        status: parse_enum(&status).unwrap_or(TodoStatus::Open),
        session_id: r.get(4)?,
        title: r.get(5)?,
        detail: r.get(6)?,
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
        priority: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

/// Insert or refresh the todo identified by `key`. Open rows are refreshed; closed rows
/// are reopened only when `reopen`. Returns true when anything changed.
pub fn upsert(conn: &Connection, key: &str, t: &NewTodo, reopen: bool) -> rusqlite::Result<bool> {
    let existing: Option<(String, String)> = conn
        .query_row(
            "SELECT id, status FROM todos WHERE dedupe_key = ?1",
            params![key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let ts = now();
    let payload = t.payload.to_string();
    match existing {
        None => {
            conn.execute(
                "INSERT INTO todos(id, kind, source, status, session_id, title, detail, payload, priority, dedupe_key, created_at, updated_at)
                 VALUES(?1, ?2, ?3, 'open', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    enum_str(t.kind),
                    enum_str(t.source),
                    t.session_id,
                    t.title,
                    t.detail,
                    payload,
                    priority_of(t.kind),
                    key,
                    ts
                ],
            )?;
            Ok(true)
        }
        Some((id, status)) if status == "open" => {
            conn.execute(
                "UPDATE todos SET title = ?2, detail = ?3, payload = ?4, updated_at = ?5 WHERE id = ?1",
                params![id, t.title, t.detail, payload, ts],
            )?;
            Ok(true)
        }
        Some((id, _)) if reopen => {
            conn.execute(
                "UPDATE todos SET status = 'open', title = ?2, detail = ?3, payload = ?4, created_at = ?5, updated_at = ?5 WHERE id = ?1",
                params![id, t.title, t.detail, payload, ts],
            )?;
            Ok(true)
        }
        Some(_) => Ok(false),
    }
}

/// Insert only when no row with `key` exists at all.
pub fn insert_absent(conn: &Connection, key: &str, t: &NewTodo) -> rusqlite::Result<bool> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM todos WHERE dedupe_key = ?1",
            params![key],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if exists {
        return Ok(false);
    }
    upsert(conn, key, t, false)
}

/// Mark the open todo with `key` Done.
pub fn resolve_key(conn: &Connection, key: &str) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "UPDATE todos SET status = 'done', updated_at = ?2 WHERE dedupe_key = ?1 AND status = 'open'",
        params![key, now()],
    )?;
    Ok(n > 0)
}

/// Mark open todos whose key starts with `prefix` Done.
pub fn resolve_prefix(conn: &Connection, prefix: &str) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "UPDATE todos SET status = 'done', updated_at = ?3
         WHERE status = 'open' AND substr(dedupe_key, 1, ?2) = ?1",
        params![prefix, prefix.chars().count() as i64, now()],
    )?;
    Ok(n > 0)
}

/// Mark open todos of `kinds` for a session Done.
pub fn resolve_session_kinds(
    conn: &Connection,
    session_id: &str,
    kinds: &[TodoKind],
) -> rusqlite::Result<bool> {
    let mut changed = false;
    for k in kinds {
        let n = conn.execute(
            "UPDATE todos SET status = 'done', updated_at = ?3
             WHERE status = 'open' AND session_id = ?1 AND kind = ?2",
            params![session_id, enum_str(*k), now()],
        )?;
        changed |= n > 0;
    }
    Ok(changed)
}

fn source_filter(show_system: bool) -> &'static str {
    if show_system {
        "1=1"
    } else {
        "source = 'schedule'"
    }
}

/// Open todos by priority desc then age (FIFO); plus up to 50 recently closed ones.
pub fn list(
    conn: &Connection,
    include_closed: bool,
    show_system: bool,
) -> rusqlite::Result<Vec<Todo>> {
    let f = source_filter(show_system);
    let mut out = Vec::new();
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM todos WHERE status = 'open' AND {f} ORDER BY priority DESC, created_at ASC"
    ))?;
    out.extend(stmt.query_map([], row_to_todo)?.flatten());
    if include_closed {
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLS} FROM todos WHERE status != 'open' AND {f} ORDER BY updated_at DESC LIMIT 50"
        ))?;
        out.extend(stmt.query_map([], row_to_todo)?.flatten());
    }
    Ok(out)
}

/// `open` = open todos; `total` = open + closed within the last 24 h.
pub fn counts(conn: &Connection, show_system: bool) -> TodoCounts {
    let f = source_filter(show_system);
    let since = (chrono::Utc::now() - chrono::Duration::hours(24)).to_rfc3339();
    let q = |sql: String, p: &[&dyn rusqlite::ToSql]| -> u32 {
        conn.query_row(&sql, p, |r| r.get::<_, i64>(0)).unwrap_or(0) as u32
    };
    let open = q(
        format!("SELECT COUNT(*) FROM todos WHERE status = 'open' AND {f}"),
        &[],
    );
    let closed = q(
        format!("SELECT COUNT(*) FROM todos WHERE status != 'open' AND updated_at >= ?1 AND {f}"),
        &[&since],
    );
    TodoCounts {
        open,
        total: open + closed,
    }
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<Todo>> {
    conn.query_row(
        &format!("SELECT {COLS} FROM todos WHERE id = ?1"),
        params![id],
        row_to_todo,
    )
    .optional()
}

pub fn set_status(conn: &Connection, id: &str, status: TodoStatus) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "UPDATE todos SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, enum_str(status), now()],
    )?;
    Ok(n > 0)
}

/// Open todos of the given kinds with their dedupe keys.
pub fn open_with_keys(
    conn: &Connection,
    kinds: &[TodoKind],
) -> rusqlite::Result<Vec<(Todo, String)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS}, COALESCE(dedupe_key, '') FROM todos WHERE status = 'open'"
    ))?;
    let rows = stmt.query_map([], |r| Ok((row_to_todo(r)?, r.get::<_, String>(11)?)))?;
    Ok(rows
        .flatten()
        .filter(|(t, _)| kinds.contains(&t.kind))
        .collect())
}

#[cfg(test)]
pub fn test_conn() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE todos(id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT,
          title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', priority INTEGER NOT NULL DEFAULT 0,
          dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
         CREATE TABLE backlog(id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
          target_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, project_dir TEXT);
         CREATE TABLE summaries(session_id TEXT PRIMARY KEY, summary TEXT NOT NULL, upto_offset INTEGER NOT NULL, updated_at TEXT NOT NULL);",
    )
    .unwrap();
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(kind: TodoKind, sid: &str) -> NewTodo {
        NewTodo::system(kind, sid, format!("{kind:?}"), String::new())
    }

    #[test]
    fn upsert_resolve_reopen() {
        let c = test_conn();
        assert!(upsert(&c, "review:s1", &t(TodoKind::Review, "s1"), true).unwrap());
        assert!(upsert(&c, "review:s1", &t(TodoKind::Review, "s1"), true).unwrap());
        assert_eq!(list(&c, false, true).unwrap().len(), 1);
        assert!(resolve_key(&c, "review:s1").unwrap());
        assert!(!resolve_key(&c, "review:s1").unwrap());
        assert_eq!(list(&c, false, true).unwrap().len(), 0);
        // Closed rows stay closed without reopen, reopen otherwise.
        assert!(!upsert(&c, "review:s1", &t(TodoKind::Review, "s1"), false).unwrap());
        assert!(!insert_absent(&c, "review:s1", &t(TodoKind::Review, "s1")).unwrap());
        assert!(upsert(&c, "review:s1", &t(TodoKind::Review, "s1"), true).unwrap());
        assert_eq!(list(&c, true, true).unwrap().len(), 1);
    }

    #[test]
    fn ordering_filters_and_counts() {
        let c = test_conn();
        upsert(&c, "review:s1", &t(TodoKind::Review, "s1"), true).unwrap();
        upsert(&c, "ui:s1:1", &t(TodoKind::Approval, "s1"), false).unwrap();
        let mut sched = t(TodoKind::ScheduleRun, "s2");
        sched.source = TodoSource::Schedule;
        upsert(&c, "sched:x", &sched, false).unwrap();
        let l = list(&c, false, true).unwrap();
        assert_eq!(l[0].kind, TodoKind::Approval);
        assert_eq!(l[0].priority, 50);
        assert_eq!(l.last().unwrap().kind, TodoKind::ScheduleRun);
        // System detection off: only schedule rows remain visible.
        assert_eq!(list(&c, false, false).unwrap().len(), 1);
        resolve_prefix(&c, "ui:s1:").unwrap();
        let n = counts(&c, true);
        assert_eq!((n.open, n.total), (2, 3));
    }

    #[test]
    fn resolves_by_session_kind_and_status_set() {
        let c = test_conn();
        upsert(&c, "error:s1", &t(TodoKind::Error, "s1"), true).unwrap();
        upsert(&c, "error:s2", &t(TodoKind::Error, "s2"), true).unwrap();
        assert!(resolve_session_kinds(&c, "s1", &[TodoKind::Error]).unwrap());
        let open = open_with_keys(&c, &[TodoKind::Error]).unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].1, "error:s2");
        let id = open[0].0.id.clone();
        set_status(&c, &id, TodoStatus::Ignored).unwrap();
        assert_eq!(get(&c, &id).unwrap().unwrap().status, TodoStatus::Ignored);
    }
}
