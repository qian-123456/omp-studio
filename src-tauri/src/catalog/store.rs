//! SQLite access for `session_meta` and `workspaces` (schema in db.rs, §6).

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::contracts::{
    PendingKind, SessionGroup, SessionMetaPatch, SpaceMode, Workspace, WorkspaceKind,
};

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
    /// Resume-directory override (§3): set when the user chose to continue a
    /// session whose original worktree dir was deleted in the repo's main dir.
    pub cwd_override: Option<String>,
    /// Last time the user viewed the session (`mark_seen`).
    pub last_seen_at: Option<String>,
    /// Space the session belongs to; Code when the column is absent/'code'.
    pub mode: SpaceMode,
    /// SessionGroup inside the mode's 无项目 area (global sessions only).
    pub group_id: Option<String>,
    /// "side" | "fork" | None; legacy side chats (fork_depth > 0 created by
    /// the app, kind NULL) are projected as "side".
    pub kind: Option<String>,
    /// App created or took over the session (`session_meta.created_by_app`).
    pub created_by_app: bool,
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
    // A plain `session_id = ?1` lets SQLite seek the primary key; the
    // `?1 IS NULL OR …` form would scan.
    let filter = if id.is_some() {
        "WHERE session_id = ?1"
    } else {
        ""
    };
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT session_id, custom_name, label, pinned, archived, parent_session_id, fork_depth,
                workspace_id, unread, pending_kind, pending_since, accepted_at, suspended, seq,
                cwd_override, last_seen_at, mode, group_id,
                COALESCE(kind, CASE WHEN fork_depth > 0 AND created_by_app = 1 THEN 'side' END),
                created_by_app
         FROM session_meta {filter}"
    ))?;
    let rows = if let Some(id) = id {
        stmt.query_map(params![id], map_row)?
    } else {
        stmt.query_map([], map_row)?
    };
    rows.collect()
}

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<(String, MetaRow)> {
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
            cwd_override: r.get(14)?,
            last_seen_at: r.get(15)?,
            mode: SpaceMode::from_str_lossy(&r.get::<_, String>(16)?),
            group_id: r.get(17)?,
            kind: r.get(18)?,
            created_by_app: r.get::<_, i64>(19)? != 0,
        },
    ))
}

/// Persist (or clear with None) the resume-directory override; the catalog
/// uses it as the session's effective cwd on the next recompute.
pub fn set_cwd_override(conn: &Connection, id: &str, cwd: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_meta(session_id, cwd_override) VALUES(?1, ?2)
         ON CONFLICT(session_id) DO UPDATE SET cwd_override = excluded.cwd_override",
        params![id, cwd],
    )?;
    Ok(())
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

/// Viewing a session: clear unread + stamp `last_seen_at`; a pending Review
/// (or derived Review status, `review_status`) is accepted like
/// `accept(id, false)`. Returns whether the session was accepted.
pub fn mark_seen(conn: &Connection, id: &str, review_status: bool) -> rusqlite::Result<bool> {
    set_unread(conn, id, false)?;
    let review = review_status || load_meta_row(conn, id).pending == Some(PendingKind::Review);
    if review {
        accept(conn, id, false)?;
    }
    Ok(review)
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

/// Mark a session app-owned (created, opened or continued by this app).
/// Idempotent; never touches other columns of an existing row.
pub fn mark_created_by_app(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_meta(session_id, created_by_app) VALUES(?1, 1)
         ON CONFLICT(session_id) DO UPDATE SET created_by_app = 1",
        params![id],
    )?;
    Ok(())
}

/// Record a session's space and (pre-validated) group at creation
/// (`StartOpts`). `None` leaves the column untouched, so resume/restart
/// spawns never clobber the stored mode/group.
pub fn set_mode_group(
    conn: &Connection,
    id: &str,
    mode: Option<SpaceMode>,
    group_id: Option<&str>,
) -> rusqlite::Result<()> {
    if mode.is_none() && group_id.is_none() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO session_meta(session_id) VALUES(?1) ON CONFLICT(session_id) DO NOTHING",
        params![id],
    )?;
    if let Some(m) = mode {
        conn.execute(
            "UPDATE session_meta SET mode = ?2 WHERE session_id = ?1",
            params![id, m.as_str()],
        )?;
    }
    if let Some(g) = group_id {
        conn.execute(
            "UPDATE session_meta SET group_id = ?2 WHERE session_id = ?1",
            params![id, g],
        )?;
    }
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
        "SELECT id, path, name, kind, sort, mode FROM workspaces
         ORDER BY (kind = 'global') DESC, sort, name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Workspace {
            id: r.get(0)?,
            path: r.get(1)?,
            name: r.get(2)?,
            kind: kind_from_str(&r.get::<_, String>(3)?),
            sort: r.get(4)?,
            mode: SpaceMode::from_str_lossy(&r.get::<_, String>(5)?),
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

/// Add a project workspace to `mode`. The same disk directory may exist in
/// several modes (unique on (path, mode)); re-adding the same (path, mode)
/// returns the existing row.
pub fn add_workspace(
    conn: &Connection,
    path: &str,
    mode: SpaceMode,
) -> rusqlite::Result<Workspace> {
    let path = normalize_path(path);
    if let Some(ws) = list_workspaces(conn)?
        .into_iter()
        .find(|w| w.path == path && w.mode == mode)
    {
        return Ok(ws);
    }
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort), 0) + 1 FROM workspaces WHERE mode = ?1",
        params![mode.as_str()],
        |r| r.get(0),
    )?;
    let ws = Workspace {
        id: uuid::Uuid::new_v4().to_string(),
        path,
        name,
        kind: WorkspaceKind::Project,
        sort,
        mode,
    };
    conn.execute(
        "INSERT INTO workspaces(id, path, name, kind, sort, mode, created_at)
		 VALUES(?1, ?2, ?3, 'project', ?4, ?5, ?6)",
        params![ws.id, ws.path, ws.name, ws.sort, mode.as_str(), now()],
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

// ---- session groups (per-mode 无项目 categories) ----

pub fn list_session_groups(conn: &Connection) -> rusqlite::Result<Vec<SessionGroup>> {
    let mut stmt =
        conn.prepare("SELECT id, mode, name, sort FROM session_groups ORDER BY mode, sort, name")?;
    let rows = stmt.query_map([], |r| {
        Ok(SessionGroup {
            id: r.get(0)?,
            mode: SpaceMode::from_str_lossy(&r.get::<_, String>(1)?),
            name: r.get(2)?,
            sort: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn get_session_group(conn: &Connection, id: &str) -> rusqlite::Result<Option<SessionGroup>> {
    conn.query_row(
        "SELECT id, mode, name, sort FROM session_groups WHERE id = ?1",
        params![id],
        |r| {
            Ok(SessionGroup {
                id: r.get(0)?,
                mode: SpaceMode::from_str_lossy(&r.get::<_, String>(1)?),
                name: r.get(2)?,
                sort: r.get(3)?,
            })
        },
    )
    .optional()
}

pub fn create_session_group(
    conn: &Connection,
    mode: SpaceMode,
    name: &str,
) -> Result<SessionGroup, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分组名不能为空".to_string());
    }
    let sort: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort), 0) + 1 FROM session_groups WHERE mode = ?1",
            params![mode.as_str()],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let group = SessionGroup {
        id: uuid::Uuid::new_v4().to_string(),
        mode,
        name: name.to_string(),
        sort,
    };
    conn.execute(
        "INSERT INTO session_groups(id, mode, name, sort, created_at) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![group.id, mode.as_str(), group.name, group.sort, now()],
    )
    .map_err(|e| e.to_string())?;
    Ok(group)
}

pub fn rename_session_group(
    conn: &Connection,
    id: &str,
    name: &str,
) -> Result<SessionGroup, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分组名不能为空".to_string());
    }
    let changed = conn
        .execute(
            "UPDATE session_groups SET name = ?2 WHERE id = ?1",
            params![id, name],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("分组不存在".to_string());
    }
    get_session_group(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "分组不存在".to_string())
}

/// Delete a group; its sessions become ungrouped (never deleted).
pub fn delete_session_group(conn: &Connection, id: &str) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM session_groups WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("分组不存在".to_string());
    }
    conn.execute(
        "UPDATE session_meta SET group_id = NULL WHERE group_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn reorder_session_groups(conn: &Connection, ids: &[String]) -> rusqlite::Result<()> {
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE session_groups SET sort = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    Ok(())
}

/// Assign (`Some`) or unassign (`None`) a session's group. Group existence,
/// mode match and global-workspace membership are validated by the caller.
pub fn set_session_group(
    conn: &Connection,
    session_id: &str,
    group_id: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_meta(session_id, group_id) VALUES(?1, ?2)
		 ON CONFLICT(session_id) DO UPDATE SET group_id = excluded.group_id",
        params![session_id, group_id],
    )?;
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// The §6 tables catalog uses (db.rs keeps its migration private).
    /// Mirrors the post-v10 schema.
    pub fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE workspaces(id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'code', created_at TEXT NOT NULL, UNIQUE(path, mode));
             CREATE TABLE session_meta(
               session_id TEXT PRIMARY KEY, file_path TEXT, custom_name TEXT, label TEXT,
               pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
               parent_session_id TEXT, fork_depth INTEGER NOT NULL DEFAULT 0,
               workspace_id TEXT, unread INTEGER NOT NULL DEFAULT 0, pending_kind TEXT, pending_since TEXT,
               accepted_at TEXT, last_seen_at TEXT, suspended INTEGER NOT NULL DEFAULT 0, created_by_app INTEGER NOT NULL DEFAULT 0,
               seq INTEGER, cwd_override TEXT, mode TEXT NOT NULL DEFAULT 'code', group_id TEXT, kind TEXT);
             CREATE TABLE session_groups(
               id TEXT PRIMARY KEY, mode TEXT NOT NULL, name TEXT NOT NULL,
               sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
             INSERT INTO workspaces VALUES('global', '/g', '🌐 全局', 'global', -1, 'code', 'now');
             INSERT INTO workspaces VALUES('global:work', '/g-work', '🌐 全局', 'global', -1, 'work', 'now');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn mark_seen_accepts_review() {
        let c = test_conn();
        set_pending(&c, "s1", Some(PendingKind::Review)).unwrap();
        set_unread(&c, "s1", true).unwrap();
        assert!(mark_seen(&c, "s1", false).unwrap());
        let r = load_meta_row(&c, "s1");
        assert_eq!((r.pending, r.unread), (None, false));
        assert!(r.accepted_at.is_some() && r.last_seen_at.is_some());
        assert!(!r.archived);
        // Non-review: only unread cleared, pending kept.
        set_pending(&c, "s2", Some(PendingKind::Error)).unwrap();
        set_unread(&c, "s2", true).unwrap();
        assert!(!mark_seen(&c, "s2", false).unwrap());
        let r = load_meta_row(&c, "s2");
        assert_eq!((r.pending, r.unread), (Some(PendingKind::Error), false));
        assert!(r.accepted_at.is_none());
    }

    #[test]
    fn cwd_override_roundtrip() {
        let c = test_conn();
        ensure_row(&c, "s1", "/f1").unwrap();
        assert_eq!(load_meta_row(&c, "s1").cwd_override, None);
        set_cwd_override(&c, "s1", Some("/repo")).unwrap();
        assert_eq!(
            load_meta_row(&c, "s1").cwd_override.as_deref(),
            Some("/repo")
        );
        set_cwd_override(&c, "s1", None).unwrap();
        assert_eq!(load_meta_row(&c, "s1").cwd_override, None);
        // Upsert on a missing row creates it.
        set_cwd_override(&c, "s2", Some("/main")).unwrap();
        assert_eq!(
            load_meta_row(&c, "s2").cwd_override.as_deref(),
            Some("/main")
        );
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
        let a = add_workspace(&c, "/repo/a/", SpaceMode::Code).unwrap();
        assert_eq!((a.path.as_str(), a.name.as_str()), ("/repo/a", "a"));
        assert_eq!(
            add_workspace(&c, "/repo/a", SpaceMode::Code).unwrap().id,
            a.id
        );
        let b = add_workspace(&c, "/repo/b", SpaceMode::Code).unwrap();
        reorder_workspaces(&c, &[b.id.clone(), a.id.clone()]).unwrap();
        let list = list_workspaces(&c).unwrap();
        let ids: Vec<_> = list.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["global", "global:work", b.id.as_str(), a.id.as_str()]
        );
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
        assert_eq!(list_workspaces(&c).unwrap().len(), 3);
    }

    /// The same disk directory may be a project in several modes; each mode
    /// gets its own workspace row and its own global row.
    #[test]
    fn same_path_in_two_modes() {
        let c = test_conn();
        let a = add_workspace(&c, "/repo/a", SpaceMode::Code).unwrap();
        let w = add_workspace(&c, "/repo/a", SpaceMode::Work).unwrap();
        assert_ne!(a.id, w.id);
        assert_eq!(w.mode, SpaceMode::Work);
        // Re-adding in either mode returns that mode's existing row.
        assert_eq!(
            add_workspace(&c, "/repo/a", SpaceMode::Code).unwrap().id,
            a.id
        );
        assert_eq!(
            add_workspace(&c, "/repo/a", SpaceMode::Work).unwrap().id,
            w.id
        );
    }

    /// Group CRUD + ungroup-on-delete; cross-mode assignment is rejected at
    /// the command layer but `set_session_group` round-trips the column.
    #[test]
    fn session_groups_crud() {
        let c = test_conn();
        let g = create_session_group(&c, SpaceMode::Work, " 清理电脑 ").unwrap();
        assert_eq!((g.mode, g.name.as_str()), (SpaceMode::Work, "清理电脑"));
        assert!(create_session_group(&c, SpaceMode::Work, "  ").is_err());
        let g2 = create_session_group(&c, SpaceMode::Work, "通用").unwrap();
        let g_code = create_session_group(&c, SpaceMode::Code, "code-g").unwrap();
        let renamed = rename_session_group(&c, &g.id, "改名").unwrap();
        assert_eq!(renamed.name, "改名");
        // sort is per-mode: work groups got 1,2; code group starts at 1.
        assert_eq!(g_code.sort, 1);
        reorder_session_groups(&c, &[g2.id.clone(), g.id.clone()]).unwrap();
        let list = list_session_groups(&c).unwrap();
        let work_ids: Vec<_> = list
            .iter()
            .filter(|x| x.mode == SpaceMode::Work)
            .map(|x| x.id.as_str())
            .collect();
        assert_eq!(work_ids, vec![g2.id.as_str(), g.id.as_str()]);
        // Assign then ungroup-on-delete.
        set_session_group(&c, "s1", Some(&g.id)).unwrap();
        assert_eq!(
            load_meta_row(&c, "s1").group_id.as_deref(),
            Some(g.id.as_str())
        );
        set_mode_group(&c, "s1", Some(SpaceMode::Work), None).unwrap();
        assert_eq!(load_meta_row(&c, "s1").mode, SpaceMode::Work);
        delete_session_group(&c, &g.id).unwrap();
        assert!(load_meta_row(&c, "s1").group_id.is_none());
        // The row's stored mode survives the ungroup.
        assert_eq!(load_meta_row(&c, "s1").mode, SpaceMode::Work);
        assert!(delete_session_group(&c, &g.id).is_err());
        // Ungroup path: Some -> None.
        set_session_group(&c, "s1", Some(&g2.id)).unwrap();
        set_session_group(&c, "s1", None).unwrap();
        assert!(load_meta_row(&c, "s1").group_id.is_none());
    }

    /// set_mode_group: None leaves columns untouched (resume spawns), Some wins.
    #[test]
    fn set_mode_group_upsert_semantics() {
        let c = test_conn();
        set_mode_group(&c, "s1", Some(SpaceMode::Study), Some("g1")).unwrap();
        let row = load_meta_row(&c, "s1");
        assert_eq!(row.mode, SpaceMode::Study);
        assert_eq!(row.group_id.as_deref(), Some("g1"));
        // Resume-style call: no mode/group -> untouched.
        set_mode_group(&c, "s1", None, None).unwrap();
        let row = load_meta_row(&c, "s1");
        assert_eq!(row.mode, SpaceMode::Study);
        assert_eq!(row.group_id.as_deref(), Some("g1"));
        // Fresh row without args defaults to code.
        set_mode_group(&c, "s2", None, None).unwrap();
        assert_eq!(load_meta_row(&c, "s2").mode, SpaceMode::Code);
    }

    /// Legacy session without any session_meta row reads as code.
    #[test]
    fn missing_row_defaults_to_code() {
        let c = test_conn();
        let row = load_meta_row(&c, "ghost");
        assert_eq!(row.mode, SpaceMode::Code);
        assert_eq!(row.group_id, None);
    }
}
