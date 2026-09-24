//! `backlog` table access (docs/ARCHITECTURE.md §6).

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::contracts::{BacklogItem, BacklogKind, BacklogPatch, BacklogRef, BacklogStatus};
use crate::todos::store::{enum_str, now, parse_enum};

const COLS: &str = "id, text, kind, refs, status, target_session_id, created_at, updated_at";

fn row_to_item(r: &Row) -> rusqlite::Result<BacklogItem> {
    let kind: String = r.get(2)?;
    let refs: String = r.get(3)?;
    let status: String = r.get(4)?;
    Ok(BacklogItem {
        id: r.get(0)?,
        text: r.get(1)?,
        kind: parse_enum(&kind).unwrap_or(BacklogKind::Todo),
        refs: serde_json::from_str(&refs).unwrap_or_default(),
        status: parse_enum(&status).unwrap_or(BacklogStatus::Inbox),
        target_session_id: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
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
) -> Result<BacklogItem, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("内容不能为空".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    conn.execute(
        "INSERT INTO backlog(id, text, kind, refs, status, target_session_id, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, 'inbox', NULL, ?5, ?5)",
        params![
            id,
            text,
            enum_str(kind),
            serde_json::to_string(refs).unwrap_or_else(|_| "[]".into()),
            ts
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
    item.updated_at = now();
    conn.execute(
        "UPDATE backlog SET text = ?2, kind = ?3, status = ?4, target_session_id = ?5, updated_at = ?6 WHERE id = ?1",
        params![
            id,
            item.text,
            enum_str(item.kind),
            enum_str(item.status),
            item.target_session_id,
            item.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(item)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM backlog WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Dispatched items targeting `session_id` become Done (session accepted).
pub fn complete_for_session(conn: &Connection, session_id: &str) -> bool {
    conn.execute(
        "UPDATE backlog SET status = 'done', updated_at = ?2
         WHERE status = 'dispatched' AND target_session_id = ?1",
        params![session_id, now()],
    )
    .map(|n| n > 0)
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::todos::store::test_conn;

    #[test]
    fn crud_and_auto_complete() {
        let c = test_conn();
        assert!(add(&c, "  ", BacklogKind::Idea, &[]).is_err());
        let r = BacklogRef {
            kind: "file".into(),
            path: Some("/tmp/a.md".into()),
            ..Default::default()
        };
        let a = add(&c, " fix login ", BacklogKind::Bug, &[r]).unwrap();
        assert_eq!(a.text, "fix login");
        assert_eq!(a.refs[0].path.as_deref(), Some("/tmp/a.md"));
        assert_eq!(a.status, BacklogStatus::Inbox);
        let patch = BacklogPatch {
            status: Some(BacklogStatus::Dispatched),
            target_session_id: Some("s1".into()),
            ..Default::default()
        };
        let u = update(&c, &a.id, &patch).unwrap();
        assert_eq!(u.target_session_id.as_deref(), Some("s1"));
        assert!(!complete_for_session(&c, "s2"));
        assert!(complete_for_session(&c, "s1"));
        assert_eq!(get(&c, &a.id).unwrap().unwrap().status, BacklogStatus::Done);
        assert_eq!(list(&c).unwrap().len(), 1);
        delete(&c, &a.id).unwrap();
        assert!(list(&c).unwrap().is_empty());
        assert!(update(&c, &a.id, &BacklogPatch::default()).is_err());
    }
}
