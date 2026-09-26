//! SQLite access for `session_meta` and `workspaces` (schema in db.rs, §6).

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::contracts::{PendingKind, SessionMetaPatch, Workspace, WorkspaceKind};

/// One `session_meta` row.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MetaRow {
    pub custom_name: Option<String>,
    pub label: Option<String>,
    pub pinned: bool,
    pub archived: bool,
    pub parent_session_id: Option<String>,
    pub fork_depth: u8,
    pub workspace_id: Option<String>,
    pub unread: bool,
    pub pending: Option<PendingKind>,
    pub pending_since: Option<String>,
    pub accepted_at: Option<String>,
    pub suspended: bool,
    pub seq: Option<i64>,
}

pub fn pending_to_str(p: PendingKind) -> &'static str {
    match p {
        PendingKind::Approval => "approval",
        PendingKind::Question => "question",
        PendingKind::Review => "review",
        PendingKind::Error => "error",
        PendingKind::Interrupted => "interrupted",
    }
}

pub fn pending_from_str(s: &str) -> Option<PendingKind> {
    Some(match s {
        "approval" => PendingKind::Approval,
        "question" => PendingKind::Question,
        "review" => PendingKind::Review,
        "error" => PendingKind::Error,
        "interrupted" => PendingKind::Interrupted,
        _ => return None,
    })
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn load_meta_rows(conn: &Connection) -> rusqlite::Result<HashMap<String, MetaRow>> {
    query_rows(conn, None)
}

pub fn load_meta_row(conn: &Connection, id: &str) -> MetaRow {
    query_rows(conn, Some(id))
        .ok()
        .and_then(|mut m| m.remove(id))
        .unwrap_or_default()
}

fn query_rows(conn: &Connection, id: Option<&str>) -> rusqlite::Result<HashMap<String, MetaRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT session_id, custom_name, label, pinned, archived, parent_session_id, fork_depth,
                workspace_id, unread, pending_kind, pending_since, accepted_at, suspended, seq
         FROM session_meta WHERE ?1 IS NULL OR session_id = ?1",
    )?;
    let rows = stmt.query_map(params![id], |r| {
        let pending: Option<String> = r.get(9)?;
        Ok((
            r.get::<_, String>(0)?,
            MetaRow {
                custom_name: r.get(1)?,
                label: r.get(2)?,
                pinned: r.get::<_, i64>(3)? != 0,
                archived: r.get::<_, i64>(4)? != 0,
                parent_session_id: r.get(5)?,
                fork_depth: r.get::<_, i64>(6)?.clamp(0, 3) as u8,
                workspace_id: r.get(7)?,
                unread: r.get::<_, i64>(8)? != 0,
                pending: pending.as_deref().and_then(pending_from_str),
                pending_since: r.get(10)?,
                accepted_at: r.get(11)?,
                suspended: r.get::<_, i64>(12)? != 0,
                seq: r.get(13)?,
            },
        ))
    })?;
    rows.collect()
}

/// Ensure a row exists and record the current file path.
pub fn ensure_row(conn: &Connection, id: &str, file: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_meta(session_id, file_path) VALUES(?1, ?2)
         ON CONFLICT(session_id) DO UPDATE SET file_path = excluded.file_path
         WHERE session_meta.file_path IS NOT excluded.file_path",
        params![id, file],
    )?;
    Ok(())
}

/// Assign the next local sequence number (`#L<seq>`) if the row has none.
pub fn assign_seq(conn: &Connection, id: &str) -> rusqlite::Result<i64> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT seq FROM session_meta WHERE session_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    if let Some(seq) = existing {
        return Ok(seq);
    }
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_meta",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "UPDATE session_meta SET seq = ?2 WHERE session_id = ?1",
        params![id, next],
    )?;
    Ok(next)
}

pub fn set_pending(
    conn: &Connection,
    id: &str,
    pending: Option<PendingKind>,
) -> rusqlite::Result<()> {
    let since = pending.map(|_| now());
    conn.execute(
        "INSERT INTO session_meta(session_id, pending_kind, pending_since) VALUES(?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET pending_kind = excluded.pending_kind,
           pending_since = excluded.pending_since",
        params![id, pending.map(pending_to_str), since],
    )?;
    Ok(())
}

pub fn set_unread(conn: &Connection, id: &str, unread: bool) -> rusqlite::Result<()> {
    let seen = (!unread).then(now);
    conn.execute(
        "INSERT INTO session_meta(session_id, unread, last_seen_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET unread = excluded.unread,
           last_seen_at = COALESCE(excluded.last_seen_at, session_meta.last_seen_at)",
        params![id, unread as i64, seen],
    )?;
    Ok(())
}

/// Clear pending, stamp `accepted_at`, optionally archive.
pub fn accept(conn: &Connection, id: &str, archive: bool) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_meta(session_id, accepted_at, archived) VALUES(?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET pending_kind = NULL, pending_since = NULL,
           accepted_at = excluded.accepted_at, unread = 0,
           archived = MAX(session_meta.archived, excluded.archived)",
        params![id, now(), archive as i64],
    )?;
    Ok(())
}

/// Apply a user patch. `workspaceId: ""` clears the explicit override;
/// `customName: ""` clears the custom name.
pub fn apply_patch(conn: &Connection, id: &str, patch: &SessionMetaPatch) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_meta(session_id) VALUES(?1) ON CONFLICT(session_id) DO NOTHING",
        params![id],
    )?;
    if let Some(name) = &patch.custom_name {
        let name = name.trim();
        conn.execute(
            "UPDATE session_meta SET custom_name = ?2 WHERE session_id = ?1",
            params![id, (!name.is_empty()).then_some(name)],
        )?;
    }
    if let Some(p) = patch.pinned {
        conn.execute(
            "UPDATE session_meta SET pinned = ?2 WHERE session_id = ?1",
            params![id, p as i64],
        )?;
    }
    if let Some(a) = patch.archived {
        conn.execute(
            "UPDATE session_meta SET archived = ?2 WHERE session_id = ?1",
            params![id, a as i64],
        )?;
    }
    if let Some(ws) = &patch.workspace_id {
        conn.execute(
            "UPDATE session_meta SET workspace_id = ?2 WHERE session_id = ?1",
            params![id, (!ws.is_empty()).then_some(ws.as_str())],
        )?;
    }
    Ok(())
}

/// Permanently delete a `session_meta` row (file deletion handled by caller).
pub fn delete_row(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM session_meta WHERE session_id = ?1",
        params![id],
    )?;
    Ok(())
}

// ---- workspaces ----

fn kind_from_str(s: &str) -> WorkspaceKind {
    if s == "global" {
        WorkspaceKind::Global
    } else {
        WorkspaceKind::Project
    }
}

pub fn list_workspaces(conn: &Connection) -> rusqlite::Result<Vec<Workspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, name, kind, sort FROM workspaces
         ORDER BY (kind = 'global') DESC, sort, name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Workspace {
            id: r.get(0)?,
            path: r.get(1)?,
            name: r.get(2)?,
            kind: kind_from_str(&r.get::<_, String>(3)?),
            sort: r.get(4)?,
        })
    })?;
    rows.collect()
}

/// Normalize a workspace path: trim whitespace and trailing slashes.
pub fn normalize_path(path: &str) -> String {
    let p = path.trim();
    let trimmed = p.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn add_workspace(conn: &Connection, path: &str) -> rusqlite::Result<Workspace> {
    let path = normalize_path(path);
    if let Some(ws) = list_workspaces(conn)?.into_iter().find(|w| w.path == path) {
        return Ok(ws);
    }
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort), 0) + 1 FROM workspaces",
        [],
        |r| r.get(0),
    )?;
    let ws = Workspace {
        id: uuid::Uuid::new_v4().to_string(),
        path,
        name,
        kind: WorkspaceKind::Project,
        sort,
    };
    conn.execute(
        "INSERT INTO workspaces(id, path, name, kind, sort, created_at) VALUES(?1, ?2, ?3, 'project', ?4, ?5)",
        params![ws.id, ws.path, ws.name, ws.sort, now()],
    )?;
    Ok(ws)
}

/// Remove a project workspace (the Global row cannot be removed).
pub fn remove_workspace(conn: &Connection, id: &str) -> Result<(), String> {
    let kind: Option<String> = conn
        .query_row(
            "SELECT kind FROM workspaces WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match kind.as_deref() {
        None => return Err("工作区不存在".to_string()),
        Some("global") => return Err("全局工作区不可移除".to_string()),
        _ => {}
    }
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE session_meta SET workspace_id = NULL WHERE workspace_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn reorder_workspaces(conn: &Connection, ids: &[String]) -> rusqlite::Result<()> {
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE workspaces SET sort = ?2 WHERE id = ?1 AND kind != 'global'",
            params![id, i as i64],
        )?;
    }
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// The two §6 tables catalog uses (db.rs keeps its migration private).
    pub fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE workspaces(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
             CREATE TABLE session_meta(
               session_id TEXT PRIMARY KEY, file_path TEXT, custom_name TEXT, label TEXT,
               pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
               parent_session_id TEXT, fork_depth INTEGER NOT NULL DEFAULT 0,
               workspace_id TEXT, unread INTEGER NOT NULL DEFAULT 0, pending_kind TEXT, pending_since TEXT,
               accepted_at TEXT, last_seen_at TEXT, suspended INTEGER NOT NULL DEFAULT 0, created_by_app INTEGER NOT NULL DEFAULT 0,
               seq INTEGER);
             INSERT INTO workspaces VALUES('global', '/g', '🌐 全局', 'global', -1, 'now');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn meta_roundtrip_and_patch() {
        let c = test_conn();
        ensure_row(&c, "s1", "/f1").unwrap();
        assert_eq!(assign_seq(&c, "s1").unwrap(), 1);
        assert_eq!(assign_seq(&c, "s1").unwrap(), 1);
        ensure_row(&c, "s2", "/f2").unwrap();
        assert_eq!(assign_seq(&c, "s2").unwrap(), 2);
        apply_patch(
            &c,
            "s1",
            &SessionMetaPatch {
                custom_name: Some(" 名字 ".into()),
                pinned: Some(true),
                archived: None,
                workspace_id: Some("w1".into()),
            },
        )
        .unwrap();
        set_pending(&c, "s1", Some(PendingKind::Review)).unwrap();
        set_unread(&c, "s1", true).unwrap();
        let row = load_meta_row(&c, "s1");
        assert_eq!(row.custom_name.as_deref(), Some("名字"));
        assert!(row.pinned && row.unread);
        assert_eq!(row.workspace_id.as_deref(), Some("w1"));
        assert_eq!(row.pending, Some(PendingKind::Review));
        accept(&c, "s1", true).unwrap();
        let row = load_meta_row(&c, "s1");
        assert!(row.pending.is_none() && row.archived && !row.unread && row.accepted_at.is_some());
        apply_patch(
            &c,
            "s1",
            &SessionMetaPatch {
                workspace_id: Some(String::new()),
                custom_name: Some(String::new()),
                ..Default::default()
            },
        )
        .unwrap();
        let row = load_meta_row(&c, "s1");
        assert!(row.workspace_id.is_none() && row.custom_name.is_none());
    }

    #[test]
    fn workspaces_crud() {
        let c = test_conn();
        let a = add_workspace(&c, "/repo/a/").unwrap();
        assert_eq!((a.path.as_str(), a.name.as_str()), ("/repo/a", "a"));
        assert_eq!(add_workspace(&c, "/repo/a").unwrap().id, a.id);
        let b = add_workspace(&c, "/repo/b").unwrap();
        reorder_workspaces(&c, &[b.id.clone(), a.id.clone()]).unwrap();
        let list = list_workspaces(&c).unwrap();
        let ids: Vec<_> = list.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, vec!["global", b.id.as_str(), a.id.as_str()]);
        assert!(remove_workspace(&c, "global").is_err());
        apply_patch(
            &c,
            "s",
            &SessionMetaPatch {
                workspace_id: Some(a.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        remove_workspace(&c, &a.id).unwrap();
        assert!(load_meta_row(&c, "s").workspace_id.is_none());
        assert_eq!(list_workspaces(&c).unwrap().len(), 2);
    }
}
