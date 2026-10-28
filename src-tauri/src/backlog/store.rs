//! `backlog` table access (docs/ARCHITECTURE.md §6).

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::contracts::{BacklogItem, BacklogKind, BacklogPatch, BacklogRef, BacklogStatus};
use crate::todos::store::{enum_str, now, parse_enum};

const COLS: &str =
    "id, text, kind, refs, status, target_session_id, created_at, updated_at, project_dir, deleted_at";

fn row_to_item(r: &Row) -> rusqlite::Result<BacklogItem> {
    let kind: String = r.get(2)?;
    let refs: String = r.get(3)?;
    let status: String = r.get(4)?;
    Ok(BacklogItem {
        id: r.get(0)?,
        text: r.get(1)?,
        kind: parse_enum(&kind).unwrap_or(BacklogKind::Idea),
        refs: serde_json::from_str(&refs).unwrap_or_default(),
        status: parse_enum(&status).unwrap_or(BacklogStatus::Inbox),
        target_session_id: r.get(5)?,
        project_dir: r.get(8)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        deleted_at: r.get(9)?,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<BacklogItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM backlog ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map([], row_to_item)?;
    Ok(rows.flatten().collect())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<BacklogItem>> {
    conn.query_row(
        &format!("SELECT {COLS} FROM backlog WHERE id = ?1"),
        params![id],
        row_to_item,
    )
    .optional()
}

pub fn add(
    conn: &Connection,
    text: &str,
    kind: BacklogKind,
    refs: &[BacklogRef],
    project_dir: Option<&str>,
) -> Result<BacklogItem, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("内容不能为空".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    let project_dir = project_dir.map(str::trim).filter(|p| !p.is_empty());
    conn.execute(
        "INSERT INTO backlog(id, text, kind, refs, status, target_session_id, created_at, updated_at, project_dir)
         VALUES(?1, ?2, ?3, ?4, 'inbox', NULL, ?5, ?5, ?6)",
        params![
            id,
            text,
            enum_str(kind),
            serde_json::to_string(refs).unwrap_or_else(|_| "[]".into()),
            ts,
            project_dir
        ],
    )
    .map_err(|e| e.to_string())?;
    get(conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "insert failed".into())
}

pub fn update(conn: &Connection, id: &str, patch: &BacklogPatch) -> Result<BacklogItem, String> {
    let mut item = get(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "条目不存在".to_string())?;
    if let Some(t) = &patch.text {
        if t.trim().is_empty() {
            return Err("内容不能为空".to_string());
        }
        item.text = t.trim().to_string();
    }
    if let Some(k) = patch.kind {
        item.kind = k;
    }
    if let Some(s) = patch.status {
        item.status = s;
    }
    if let Some(t) = &patch.target_session_id {
        item.target_session_id = (!t.is_empty()).then(|| t.clone());
    }
    if let Some(r) = &patch.refs {
        item.refs = r.clone();
    }
    if let Some(p) = &patch.project_dir {
        let p = p.trim();
        item.project_dir = (!p.is_empty()).then(|| p.to_string());
    }
    item.updated_at = now();
    conn.execute(
        "UPDATE backlog SET text = ?2, kind = ?3, status = ?4, target_session_id = ?5, updated_at = ?6, refs = ?7, project_dir = ?8, restored_at = CASE WHEN ?9 THEN NULL ELSE restored_at END WHERE id = ?1",
        params![
            id,
            item.text,
            enum_str(item.kind),
            enum_str(item.status),
            item.target_session_id,
            item.updated_at,
            serde_json::to_string(&item.refs).unwrap_or_else(|_| "[]".into()),
            item.project_dir,
            patch.status.is_some()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(item)
}

/// Soft delete: move the rows to the trash (`deleted_at = now`). Unknown ids are ignored.
pub fn delete(conn: &Connection, ids: &[String]) -> Result<(), String> {
    let ts = now();
    for id in ids {
        conn.execute(
            "UPDATE backlog SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, ts],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Take rows out of the trash.
pub fn restore(conn: &Connection, ids: &[String]) -> Result<(), String> {
    let ts = now();
    for id in ids {
        conn.execute(
            "UPDATE backlog SET deleted_at = NULL, updated_at = ?2, restored_at = ?2 WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id, ts],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Permanently remove rows.
pub fn purge(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for id in ids {
        conn.execute("DELETE FROM backlog WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Days a trashed row is kept before the startup purge removes it.
pub const TRASH_RETENTION_DAYS: i64 = 7;

/// Hard-delete rows trashed more than [`TRASH_RETENTION_DAYS`] before `now`.
/// Returns how many rows were removed.
pub fn purge_expired(
    conn: &Connection,
    now: chrono::DateTime<chrono::Utc>,
) -> rusqlite::Result<usize> {
    let cutoff = (now - chrono::Duration::days(TRASH_RETENTION_DAYS)).to_rfc3339();
    conn.execute(
        "DELETE FROM backlog WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )
}

/// Days a finished (done/closed) row stays in 已结束 before it is moved to the trash.
pub const FINISHED_RETENTION_DAYS: i64 = 30;

/// Move finished rows last updated more than [`FINISHED_RETENTION_DAYS`] before `now`
/// into the trash (sets `deleted_at`; the trash purge removes them 7 days later).
/// Returns how many rows were moved.
pub fn archive_finished(
    conn: &Connection,
    now: chrono::DateTime<chrono::Utc>,
) -> rusqlite::Result<usize> {
    let cutoff = (now - chrono::Duration::days(FINISHED_RETENTION_DAYS)).to_rfc3339();
    conn.execute(
        "UPDATE backlog SET deleted_at = ?1
         WHERE status IN ('done', 'closed') AND deleted_at IS NULL AND restored_at IS NULL AND updated_at < ?2",
        params![now.to_rfc3339(), cutoff],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::todos::store::test_conn;

    #[test]
    fn crud_and_project_dir() {
        let c = test_conn();
        assert!(add(&c, "  ", BacklogKind::Idea, &[], None).is_err());
        let r = BacklogRef {
            kind: "file".into(),
            path: Some("/tmp/a.md".into()),
            ..Default::default()
        };
        let a = add(&c, " fix login ", BacklogKind::Bug, &[r], Some("/repo")).unwrap();
        assert_eq!(a.text, "fix login");
        assert_eq!(a.refs[0].path.as_deref(), Some("/tmp/a.md"));
        assert_eq!(a.status, BacklogStatus::Inbox);
        assert_eq!(a.project_dir.as_deref(), Some("/repo"));
        let g = add(&c, "global", BacklogKind::Idea, &[], Some("  ")).unwrap();
        assert_eq!(g.project_dir, None);
        assert_eq!(g.deleted_at, None);
        purge(&c, &[g.id]).unwrap();
        let patch = BacklogPatch {
            status: Some(BacklogStatus::Dispatched),
            target_session_id: Some("s1".into()),
            ..Default::default()
        };
        let u = update(&c, &a.id, &patch).unwrap();
        assert_eq!(u.target_session_id.as_deref(), Some("s1"));
        assert_eq!(u.status, BacklogStatus::Dispatched);
        assert_eq!(list(&c).unwrap().len(), 1);
        purge(&c, std::slice::from_ref(&a.id)).unwrap();
        assert!(list(&c).unwrap().is_empty());
        assert!(update(&c, &a.id, &BacklogPatch::default()).is_err());
    }

    #[test]
    fn delete_restore_purge_semantics() {
        let c = test_conn();
        let a = add(&c, "a", BacklogKind::Idea, &[], None).unwrap();
        let b = add(&c, "b", BacklogKind::Bug, &[], None).unwrap();
        delete(&c, &[a.id.clone(), b.id.clone()]).unwrap();
        // list returns trashed rows too.
        let all = list(&c).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|i| i.deleted_at.is_some()));
        restore(&c, std::slice::from_ref(&a.id)).unwrap();
        assert_eq!(get(&c, &a.id).unwrap().unwrap().deleted_at, None);
        assert!(get(&c, &b.id).unwrap().unwrap().deleted_at.is_some());
        purge(&c, std::slice::from_ref(&b.id)).unwrap();
        assert!(get(&c, &b.id).unwrap().is_none());
        assert!(get(&c, &a.id).unwrap().is_some());
    }

    #[test]
    fn startup_purge_boundary() {
        let c = test_conn();
        let now = chrono::Utc::now();
        let fresh = add(&c, "fresh", BacklogKind::Idea, &[], None).unwrap();
        let six = add(&c, "six", BacklogKind::Idea, &[], None).unwrap();
        let eight = add(&c, "eight", BacklogKind::Idea, &[], None).unwrap();
        for (id, days) in [(&six.id, 6), (&eight.id, 8)] {
            let ts = (now - chrono::Duration::days(days)).to_rfc3339();
            c.execute(
                "UPDATE backlog SET deleted_at = ?2 WHERE id = ?1",
                params![id, ts],
            )
            .unwrap();
        }
        assert_eq!(purge_expired(&c, now).unwrap(), 1);
        assert!(get(&c, &fresh.id).unwrap().is_some());
        assert!(get(&c, &six.id).unwrap().is_some());
        assert!(get(&c, &eight.id).unwrap().is_none());
    }

    #[test]
    fn archive_finished_moves_only_old_finished_rows() {
        let c = test_conn();
        let now = chrono::Utc::now();
        let mk = |text: &str, status: &str, days: i64| {
            let it = add(&c, text, BacklogKind::Idea, &[], None).unwrap();
            let ts = (now - chrono::Duration::days(days)).to_rfc3339();
            c.execute(
                "UPDATE backlog SET status = ?2, updated_at = ?3 WHERE id = ?1",
                params![it.id, status, ts],
            )
            .unwrap();
            it.id
        };
        let old_done = mk("old done", "done", 31);
        let old_closed = mk("old closed", "closed", 45);
        let new_done = mk("new done", "done", 29);
        let old_inbox = mk("old inbox", "inbox", 90);
        let old_dispatched = mk("old dispatched", "dispatched", 90);
        assert_eq!(archive_finished(&c, now).unwrap(), 2);
        let trashed = |id: &String| get(&c, id).unwrap().unwrap().deleted_at.is_some();
        assert!(trashed(&old_done) && trashed(&old_closed));
        assert!(!trashed(&new_done) && !trashed(&old_inbox) && !trashed(&old_dispatched));
        // Already trashed rows keep their original trash time.
        assert_eq!(archive_finished(&c, now).unwrap(), 0);
        // The trash purge only removes them after their own 7 days.
        assert_eq!(purge_expired(&c, now).unwrap(), 0);
    }

    #[test]
    fn restored_finished_items_survive_restarts_until_explicit_status_change() {
        let c = test_conn();
        let now = chrono::Utc::now();
        for status in [BacklogStatus::Done, BacklogStatus::Closed] {
            let item = add(&c, "restored", BacklogKind::Idea, &[], None).unwrap();
            update(
                &c,
                &item.id,
                &BacklogPatch {
                    status: Some(status),
                    ..Default::default()
                },
            )
            .unwrap();
            let old = (now - chrono::Duration::days(60)).to_rfc3339();
            c.execute(
                "UPDATE backlog SET updated_at = ?2 WHERE id = ?1",
                params![item.id, old],
            )
            .unwrap();
            assert_eq!(archive_finished(&c, now).unwrap(), 1);
            restore(&c, std::slice::from_ref(&item.id)).unwrap();
            assert_eq!(get(&c, &item.id).unwrap().unwrap().status, status);
            for days in [0, 31, 90] {
                let later = now + chrono::Duration::days(days);
                assert_eq!(archive_finished(&c, later).unwrap(), 0);
                assert_eq!(purge_expired(&c, later).unwrap(), 0);
                assert!(get(&c, &item.id).unwrap().unwrap().deleted_at.is_none());
            }
            update(
                &c,
                &item.id,
                &BacklogPatch {
                    text: Some("edited".into()),
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(
                archive_finished(&c, now + chrono::Duration::days(90)).unwrap(),
                0
            );
            update(
                &c,
                &item.id,
                &BacklogPatch {
                    status: Some(status),
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(
                archive_finished(&c, now + chrono::Duration::days(90)).unwrap(),
                1
            );
            purge(&c, &[item.id]).unwrap();
        }
    }
}
