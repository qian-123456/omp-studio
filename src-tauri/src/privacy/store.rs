//! SQLite persistence for secret entries, legacy alias placeholders and session
//! links with optional cutoffs (§6 v5/v6).

use std::collections::{BTreeMap, HashMap};

use rusqlite::{params, Connection, OptionalExtension};

use super::classify;
use crate::contracts::{PrivacyMarkScope, SecretEntry, SecretEntryPatch, SecretRisk};

fn db_err(e: rusqlite::Error) -> String {
    format!("数据库错误: {e}")
}

fn risk_str(risk: SecretRisk) -> &'static str {
    match risk {
        SecretRisk::Safe => "safe",
        SecretRisk::Risky => "risky",
    }
}

const SELECT: &str = "SELECT id, value, label, placeholder, risk, track, in_library, library_prompted, created_at FROM secret_entries";

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<SecretEntry> {
    let risk: String = row.get(4)?;
    Ok(SecretEntry {
        id: row.get(0)?,
        value: row.get(1)?,
        label: row.get(2)?,
        placeholder: row.get(3)?,
        aliases: Vec::new(),
        risk: if risk == "risky" {
            SecretRisk::Risky
        } else {
            SecretRisk::Safe
        },
        track: row.get(5)?,
        in_library: row.get(6)?,
        library_prompted: row.get(7)?,
        created_at: row.get(8)?,
        session_count: 0,
        cutoffs: BTreeMap::new(),
    })
}

fn aliases_of(conn: &Connection, id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT placeholder FROM secret_aliases WHERE entry_id = ?1 ORDER BY rowid")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([id], |r| r.get::<_, String>(0))
        .map_err(db_err)?;
    rows.collect::<Result<_, _>>().map_err(db_err)
}

/// Fill `session_count` and `cutoffs` from `session_secrets`.
fn fill_links(conn: &Connection, entries: &mut [SecretEntry]) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT entry_id, session_id, since_ms FROM session_secrets")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(db_err)?;
    let mut by_id: HashMap<String, usize> = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        by_id.insert(e.id.clone(), i);
    }
    for row in rows {
        let (entry_id, session_id, since) = row.map_err(db_err)?;
        if let Some(&i) = by_id.get(&entry_id) {
            entries[i].session_count += 1;
            if let Some(ms) = since {
                entries[i].cutoffs.insert(session_id, ms);
            }
        }
    }
    Ok(())
}

/// All entries (oldest first) with alias placeholders and session links.
pub fn list(conn: &Connection) -> Result<Vec<SecretEntry>, String> {
    let mut stmt = conn
        .prepare(&format!("{SELECT} ORDER BY created_at, rowid"))
        .map_err(db_err)?;
    let mut entries: Vec<SecretEntry> = stmt
        .query_map([], row_to_entry)
        .map_err(db_err)?
        .collect::<Result<_, _>>()
        .map_err(db_err)?;
    for e in &mut entries {
        e.aliases = aliases_of(conn, &e.id)?;
    }
    fill_links(conn, &mut entries)?;
    Ok(entries)
}

pub fn get(conn: &Connection, id: &str) -> Result<SecretEntry, String> {
    let entry = conn
        .query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_entry)
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| "隐私条目不存在".to_string())?;
    let mut one = [entry];
    one[0].aliases = aliases_of(conn, id)?;
    fill_links(conn, &mut one)?;
    let [entry] = one;
    Ok(entry)
}

fn find_by_value(conn: &Connection, value: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM secret_entries WHERE value = ?1",
        [value],
        |r| r.get(0),
    )
    .optional()
    .map_err(db_err)
}

fn random_hex4() -> String {
    let mut buf = [0u8; 2];
    if getrandom::fill(&mut buf).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        buf = [(nanos >> 8) as u8, nanos as u8];
    }
    format!("{:02x}{:02x}", buf[0], buf[1])
}

fn placeholder_taken(conn: &Connection, p: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM secret_entries WHERE placeholder = ?1)
            OR EXISTS(SELECT 1 FROM secret_aliases WHERE placeholder = ?1)",
        [p],
        |r| r.get(0),
    )
    .map_err(db_err)
}

/// `⟦{LABEL|SECRET}_{4 hex}⟧`, never colliding with current or alias placeholders.
fn new_placeholder(conn: &Connection, label: Option<&str>) -> Result<String, String> {
    let l = label.unwrap_or("SECRET");
    for _ in 0..4096 {
        let p = format!("⟦{l}_{}⟧", random_hex4());
        if !placeholder_taken(conn, &p)? {
            return Ok(p);
        }
    }
    Err("无法生成唯一占位符".into())
}

/// Link `id` to the session. An existing link always wins (it must never change
/// the already-sent prefix); a new `future` link records the cutoff (epoch ms).
fn link_session(
    conn: &Connection,
    session_id: Option<&str>,
    id: &str,
    scope: PrivacyMarkScope,
) -> Result<(), String> {
    if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
        let since_ms =
            (scope == PrivacyMarkScope::Future).then(|| chrono::Utc::now().timestamp_millis());
        conn.execute(
            "INSERT OR IGNORE INTO session_secrets(session_id, entry_id, since_ms) VALUES(?1, ?2, ?3)",
            params![sid, id, since_ms],
        )
        .map_err(db_err)?;
    }
    Ok(())
}

fn set_label(conn: &Connection, id: &str, label: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE secret_entries SET label = ?1 WHERE id = ?2",
        params![label, id],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Mark `value`. Existing values are linked to the session and returned
/// (label replaced only by a new non-empty label; the placeholder never changes).
/// Rejected levels error out.
pub fn mark(
    conn: &Connection,
    session_id: Option<&str>,
    value: &str,
    label: Option<&str>,
    track: bool,
    scope: PrivacyMarkScope,
) -> Result<SecretEntry, String> {
    let (risk, _) = classify::classify(value).map_err(str::to_string)?;
    let label = match label {
        Some(raw) => classify::sanitize_label(raw, value).map_err(str::to_string)?,
        None => None,
    };
    if let Some(id) = find_by_value(conn, value)? {
        let existing = get(conn, &id)?;
        if label.is_some() && label != existing.label {
            set_label(conn, &id, label.as_deref())?;
        }
        link_session(conn, session_id, &id, scope)?;
        return get(conn, &id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let placeholder = new_placeholder(conn, label.as_deref())?;
    conn.execute(
        "INSERT INTO secret_entries(id, value, label, placeholder, risk, track, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            value,
            label,
            placeholder,
            risk_str(risk),
            track,
            chrono::Utc::now().to_rfc3339()
        ],
    )
    .map_err(db_err)?;
    link_session(conn, session_id, &id, scope)?;
    get(conn, &id)
}

pub fn update(
    conn: &Connection,
    id: &str,
    patch: &SecretEntryPatch,
) -> Result<SecretEntry, String> {
    let entry = get(conn, id)?;
    if let Some(raw) = &patch.label {
        // Display label only: the placeholder is immutable once generated.
        let label = classify::sanitize_label(raw, &entry.value).map_err(str::to_string)?;
        if label != entry.label {
            set_label(conn, id, label.as_deref())?;
        }
    }
    for (col, val) in [
        ("track", patch.track),
        ("in_library", patch.in_library),
        ("library_prompted", patch.library_prompted),
    ] {
        if let Some(v) = val {
            conn.execute(
                &format!("UPDATE secret_entries SET {col} = ?1 WHERE id = ?2"),
                params![v, id],
            )
            .map_err(db_err)?;
        }
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM secret_aliases WHERE entry_id = ?1", [id])
        .map_err(db_err)?;
    conn.execute("DELETE FROM session_secrets WHERE entry_id = ?1", [id])
        .map_err(db_err)?;
    conn.execute("DELETE FROM secret_entries WHERE id = ?1", [id])
        .map_err(db_err)?;
    Ok(())
}

pub fn session_entry_ids(conn: &Connection, session_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT entry_id FROM session_secrets WHERE session_id = ?1 ORDER BY rowid")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([session_id], |r| r.get::<_, String>(0))
        .map_err(db_err)?;
    rows.collect::<Result<_, _>>().map_err(db_err)
}

pub fn inherit(conn: &Connection, parent: &str, child: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO session_secrets(session_id, entry_id, since_ms)
         SELECT ?2, entry_id, since_ms FROM session_secrets WHERE session_id = ?1",
        params![parent, child],
    )
    .map_err(db_err)?;
    Ok(())
}

/// True when `session_id` has at least one linked entry with a cutoff.
pub fn session_has_cutoff(conn: &Connection, session_id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM session_secrets WHERE session_id = ?1 AND since_ms IS NOT NULL)",
        [session_id],
        |r| r.get(0),
    )
    .map_err(db_err)
}

/// Session transcript path recorded by the catalog, if any.
pub fn session_file(conn: &Connection, session_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT file_path FROM session_meta WHERE session_id = ?1",
        [session_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        c
    }

    #[test]
    fn mark_creates_and_remark_links_same_entry() {
        let c = conn();
        let a = mark(
            &c,
            Some("s1"),
            "hunter2-long",
            Some("db pass"),
            true,
            PrivacyMarkScope::All,
        )
        .unwrap();
        assert!(a.placeholder.starts_with("⟦db_pass_") && a.placeholder.ends_with('⟧'));
        assert_eq!(a.risk, SecretRisk::Safe);
        let b = mark(
            &c,
            Some("s2"),
            "hunter2-long",
            None,
            true,
            PrivacyMarkScope::All,
        )
        .unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.placeholder, b.placeholder);
        assert_eq!(session_entry_ids(&c, "s2").unwrap(), vec![a.id.clone()]);
        assert_eq!(list(&c).unwrap().len(), 1);
        let none = mark(&c, None, "plainvalue1", None, false, PrivacyMarkScope::All).unwrap();
        assert!(none.placeholder.starts_with("⟦SECRET_"));
        assert!(!none.track);
    }

    #[test]
    fn mark_rejects() {
        let c = conn();
        let all = PrivacyMarkScope::All;
        assert_eq!(
            mark(&c, None, "ab", None, true, all).unwrap_err(),
            "TOO_SHORT"
        );
        assert_eq!(
            mark(&c, None, "secretvalue", Some("is secretvalue"), true, all).unwrap_err(),
            "LABEL_CONTAINS_VALUE"
        );
        assert_eq!(
            mark(&c, None, "a\nb c", None, true, all).unwrap_err(),
            "INVALID_VALUE"
        );
    }

    #[test]
    fn label_edit_keeps_placeholder() {
        let c = conn();
        let a = mark(
            &c,
            Some("s1"),
            "10.20.30.40",
            Some("ip"),
            true,
            PrivacyMarkScope::All,
        )
        .unwrap();
        let b = update(
            &c,
            &a.id,
            &SecretEntryPatch {
                label: Some("服务器".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(b.placeholder, a.placeholder);
        assert_eq!(b.label.as_deref(), Some("服务器"));
        assert!(b.aliases.is_empty());
        let c2 = update(
            &c,
            &a.id,
            &SecretEntryPatch {
                label: Some(String::new()),
                in_library: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(c2.label, None);
        assert!(c2.in_library);
        assert_eq!(c2.placeholder, a.placeholder);
        // Re-marking with a new label also only changes the label.
        let d = mark(
            &c,
            Some("s1"),
            "10.20.30.40",
            Some("host"),
            true,
            PrivacyMarkScope::All,
        )
        .unwrap();
        assert_eq!(d.placeholder, a.placeholder);
        assert_eq!(d.label.as_deref(), Some("host"));
        let no_alias: i64 = c
            .query_row("SELECT count(*) FROM secret_aliases", [], |r| r.get(0))
            .unwrap();
        assert_eq!(no_alias, 0);
    }

    #[test]
    fn legacy_aliases_are_still_listed() {
        let c = conn();
        let a = mark(
            &c,
            None,
            "10.20.30.40",
            Some("ip"),
            true,
            PrivacyMarkScope::All,
        )
        .unwrap();
        c.execute(
            "INSERT INTO secret_aliases(placeholder, entry_id) VALUES('⟦OLD_0000⟧', ?1)",
            [&a.id],
        )
        .unwrap();
        assert_eq!(list(&c).unwrap()[0].aliases, vec!["⟦OLD_0000⟧".to_string()]);
    }

    fn since(c: &Connection, sid: &str, id: &str) -> Option<i64> {
        c.query_row(
            "SELECT since_ms FROM session_secrets WHERE session_id = ?1 AND entry_id = ?2",
            params![sid, id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn future_scope_records_cutoff_once_and_all_never_clears() {
        let c = conn();
        let v = "longsecretvalue";
        let a = mark(&c, Some("s1"), v, None, true, PrivacyMarkScope::Future).unwrap();
        let first = since(&c, "s1", &a.id).expect("cutoff recorded");
        assert!(first > 1_600_000_000_000);
        // `all` never clears the cutoff.
        mark(&c, Some("s1"), v, None, true, PrivacyMarkScope::All).unwrap();
        assert_eq!(since(&c, "s1", &a.id), Some(first));
        // `future` never overwrites an existing earlier link.
        c.execute(
            "UPDATE session_secrets SET since_ms = 5 WHERE session_id = 's1'",
            [],
        )
        .unwrap();
        mark(&c, Some("s1"), v, None, true, PrivacyMarkScope::Future).unwrap();
        assert_eq!(since(&c, "s1", &a.id), Some(5));
        // `all` link stays whole-history when `future` is re-marked.
        mark(&c, Some("s2"), v, None, true, PrivacyMarkScope::All).unwrap();
        mark(&c, Some("s2"), v, None, true, PrivacyMarkScope::Future).unwrap();
        assert_eq!(since(&c, "s2", &a.id), None);
        let e = get(&c, &a.id).unwrap();
        assert_eq!(e.session_count, 2);
        assert_eq!(e.cutoffs.len(), 1);
        assert_eq!(e.cutoffs["s1"], 5);
    }

    #[test]
    fn delete_and_inherit_copy_cutoffs() {
        let c = conn();
        let a = mark(
            &c,
            Some("p"),
            "longsecretvalue",
            None,
            true,
            PrivacyMarkScope::Future,
        )
        .unwrap();
        let cutoff = since(&c, "p", &a.id);
        assert!(cutoff.is_some());
        inherit(&c, "p", "child").unwrap();
        assert_eq!(session_entry_ids(&c, "child").unwrap(), vec![a.id.clone()]);
        assert_eq!(since(&c, "child", &a.id), cutoff);
        // An existing child link wins over the inherited one.
        c.execute(
            "INSERT INTO session_secrets(session_id, entry_id, since_ms) VALUES('c2', ?1, NULL)",
            [&a.id],
        )
        .unwrap();
        inherit(&c, "p", "c2").unwrap();
        assert_eq!(since(&c, "c2", &a.id), None);
        delete(&c, &a.id).unwrap();
        assert!(list(&c).unwrap().is_empty());
        assert!(session_entry_ids(&c, "child").unwrap().is_empty());
    }
}
