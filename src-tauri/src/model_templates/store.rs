//! SQLite CRUD for role templates, quota switch rules, the switch log and the switch settings.
//!
//! Every function is synchronous and takes the caller's connection: the commands hold the
//! single app connection (`AppState::db`) for the duration of one call, so no store function
//! opens its own connection or awaits.
//!
//! Invariants enforced here (single writer):
//! - every template, rule and log row belongs to one scope (`global` or a project directory);
//! - at most one bottom-line template per scope (`is_bottom_line` is cleared on the scope's
//!   other rows);
//! - a template never changes scope after creation;
//! - deleting a template deletes the rules that point at it;
//! - the log keeps the newest [`LOG_LIMIT`] rows, never dropping a scope's newest un-undone row;
//! - the poll interval stays within [`MIN_POLL_SECS`]..=[`MAX_POLL_SECS`].

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;

use super::{
    scope_project, ModelSwitchLogEntry, ModelSwitchRule, ModelSwitchRuleInput, ModelTemplate,
    ModelTemplateInput, SwitchSettings, GLOBAL_SCOPE,
};
use crate::schedules::store::now_rfc3339;

/// Switch log rows kept; older ones are pruned on insert.
const LOG_LIMIT: i64 = 200;
/// Settings-table key of [`SwitchSettings`].
const SETTINGS_KEY: &str = "model_switch";
/// Default / allowed poll interval, in seconds.
pub(crate) const DEFAULT_POLL_SECS: u64 = 600;
const MIN_POLL_SECS: u64 = 60;
const MAX_POLL_SECS: u64 = 86_400;

fn db_error(error: rusqlite::Error) -> String {
    format!("读写模板数据库失败：{error}")
}

/// New id for a row created by this module.
fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// `Some(trimmed)` unless the id is absent or blank, which both mean "create".
fn normalized_id(raw: Option<&String>) -> Option<&str> {
    raw.map(|id| id.trim()).filter(|id| !id.is_empty())
}

/// JSON column -> value, with the column index kept for the rusqlite error.
fn json_column<T: DeserializeOwned>(raw: String, index: usize) -> rusqlite::Result<T> {
    serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

// ---------- templates ----------

fn template_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelTemplate> {
    Ok(ModelTemplate {
        id: row.get(0)?,
        name: row.get(1)?,
        roles: json_column::<BTreeMap<String, Option<String>>>(row.get(2)?, 2)?,
        is_bottom_line: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        scope: row.get(6)?,
    })
}

/// Every template, oldest first.
pub(crate) fn list_templates(conn: &Connection) -> Result<Vec<ModelTemplate>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, name, roles, is_bottom_line, created_at, updated_at, scope
             FROM model_templates ORDER BY created_at, rowid",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([], template_from_row)
        .map_err(db_error)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
}

/// One template by id; `None` when it does not exist.
pub(crate) fn get_template(conn: &Connection, id: &str) -> Result<Option<ModelTemplate>, String> {
    conn.query_row(
        "SELECT id, name, roles, is_bottom_line, created_at, updated_at, scope
         FROM model_templates WHERE id = ?1",
        params![id],
        template_from_row,
    )
    .optional()
    .map_err(db_error)
}

/// Creates (`input.id` absent or unknown) or updates one template, keeping `created_at` and
/// `scope` on update. A new template's scope must be `global` or an existing project directory.
/// Setting `is_bottom_line` clears the flag on every other template of the same scope.
pub(crate) fn upsert_template(
    conn: &Connection,
    input: &ModelTemplateInput,
) -> Result<ModelTemplate, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("模板名称不能为空".to_string());
    }
    let roles = serde_json::to_string(&input.roles)
        .map_err(|error| format!("模板角色无法序列化：{error}"))?;
    let now = now_rfc3339();
    let id = normalized_id(input.id.as_ref()).map(str::to_string);
    let existing = match &id {
        Some(id) => get_template(conn, id)?,
        None => None,
    };
    let scope = match &existing {
        Some(template) => template.scope.clone(),
        None => {
            scope_project(&input.scope)?;
            input.scope.clone()
        }
    };
    let id = id.unwrap_or_else(new_id);
    let created_at = existing
        .as_ref()
        .map(|template| template.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let tx = conn.unchecked_transaction().map_err(db_error)?;
    if input.is_bottom_line {
        tx.execute(
            "UPDATE model_templates SET is_bottom_line = 0 WHERE id <> ?1 AND scope = ?2",
            params![id, scope],
        )
        .map_err(db_error)?;
    }
    tx.execute(
        "INSERT INTO model_templates(id, name, roles, is_bottom_line, created_at, updated_at, scope)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           roles = excluded.roles,
           is_bottom_line = excluded.is_bottom_line,
           updated_at = excluded.updated_at",
        params![
            id,
            name,
            roles,
            input.is_bottom_line as i64,
            created_at,
            now,
            scope
        ],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    get_template(conn, &id)?.ok_or_else(|| "保存模板后未能读回".to_string())
}

/// Deletes one template together with every rule that references it.
pub(crate) fn delete_template(conn: &Connection, id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(db_error)?;
    tx.execute(
        "DELETE FROM model_switch_rules WHERE template_id = ?1",
        params![id],
    )
    .map_err(db_error)?;
    tx.execute("DELETE FROM model_templates WHERE id = ?1", params![id])
        .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(())
}

// ---------- rules ----------

const RULE_COLUMNS: &str = "id, name, enabled, provider, window_key, threshold_pct, template_id, \
                            auto_revert, revert_threshold_pct, sort, created_at, updated_at, scope";

fn rule_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelSwitchRule> {
    Ok(ModelSwitchRule {
        id: row.get(0)?,
        name: row.get(1)?,
        enabled: row.get::<_, i64>(2)? != 0,
        provider: row.get(3)?,
        window_key: row.get(4)?,
        threshold_pct: row.get(5)?,
        template_id: row.get(6)?,
        auto_revert: row.get::<_, i64>(7)? != 0,
        revert_threshold_pct: row.get(8)?,
        sort: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        scope: row.get(12)?,
    })
}

/// Every rule in evaluation order (`sort`, then creation order).
pub(crate) fn list_rules(conn: &Connection) -> Result<Vec<ModelSwitchRule>, String> {
    let sql =
        format!("SELECT {RULE_COLUMNS} FROM model_switch_rules ORDER BY sort, created_at, rowid");
    let mut statement = conn.prepare(&sql).map_err(db_error)?;
    let rows = statement.query_map([], rule_from_row).map_err(db_error)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
}

/// One rule by id; `None` when it does not exist.
pub(crate) fn get_rule(conn: &Connection, id: &str) -> Result<Option<ModelSwitchRule>, String> {
    let sql = format!("SELECT {RULE_COLUMNS} FROM model_switch_rules WHERE id = ?1");
    conn.query_row(&sql, params![id], rule_from_row)
        .optional()
        .map_err(db_error)
}

/// Creates (`input.id` absent) or updates one rule. A new rule, or a rule that moves to another
/// scope, is appended to that scope's order.
pub(crate) fn upsert_rule(
    conn: &Connection,
    input: &ModelSwitchRuleInput,
) -> Result<ModelSwitchRule, String> {
    let id = normalized_id(input.id.as_ref()).map(str::to_string);
    let existing = match &id {
        Some(id) => get_rule(conn, id)?,
        None => None,
    };
    let id = id.unwrap_or_else(new_id);
    let now = now_rfc3339();
    let created_at = existing
        .as_ref()
        .map(|rule| rule.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let sort = match &existing {
        Some(rule) if rule.scope == input.scope => rule.sort,
        _ => next_sort(conn, &input.scope)?,
    };
    conn.execute(
        "INSERT INTO model_switch_rules(
           id, name, enabled, provider, window_key, threshold_pct, template_id,
           auto_revert, revert_threshold_pct, sort, created_at, updated_at, scope)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           enabled = excluded.enabled,
           provider = excluded.provider,
           window_key = excluded.window_key,
           threshold_pct = excluded.threshold_pct,
           template_id = excluded.template_id,
           auto_revert = excluded.auto_revert,
           revert_threshold_pct = excluded.revert_threshold_pct,
           sort = excluded.sort,
           scope = excluded.scope,
           updated_at = excluded.updated_at",
        params![
            id,
            input.name.trim(),
            input.enabled as i64,
            input.provider.trim(),
            input.window_key.trim(),
            input.threshold_pct,
            input.template_id.trim(),
            input.auto_revert as i64,
            input.revert_threshold_pct,
            sort,
            created_at,
            now,
            input.scope
        ],
    )
    .map_err(db_error)?;
    get_rule(conn, &id)?.ok_or_else(|| "保存规则后未能读回".to_string())
}

fn next_sort(conn: &Connection, scope: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort), -1) + 1 FROM model_switch_rules WHERE scope = ?1",
        params![scope],
        |row| row.get(0),
    )
    .map_err(db_error)
}

/// Deletes one rule. The switch log keeps its rows (they carry their own rule name).
pub(crate) fn delete_rule(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM model_switch_rules WHERE id = ?1", params![id])
        .map_err(db_error)?;
    Ok(())
}

/// Rewrites `sort` of one scope's rules to the position in `ids`; rules of the scope that are
/// not listed keep their relative order after them. Ids of other scopes are ignored and other
/// scopes' `sort` values never change.
pub(crate) fn reorder_rules(conn: &Connection, scope: &str, ids: &[String]) -> Result<(), String> {
    let mut ordered: Vec<String> = Vec::new();
    let in_scope: Vec<String> = list_rules(conn)?
        .into_iter()
        .filter(|rule| rule.scope == scope)
        .map(|rule| rule.id)
        .collect();
    for id in ids {
        let id = id.trim();
        if in_scope.iter().any(|known| known == id) && !ordered.iter().any(|seen| seen == id) {
            ordered.push(id.to_string());
        }
    }
    for id in &in_scope {
        if !ordered.contains(id) {
            ordered.push(id.clone());
        }
    }
    let tx = conn.unchecked_transaction().map_err(db_error)?;
    for (index, id) in ordered.iter().enumerate() {
        tx.execute(
            "UPDATE model_switch_rules SET sort = ?1 WHERE id = ?2",
            params![index as i64, id],
        )
        .map_err(db_error)?;
    }
    tx.commit().map_err(db_error)?;
    Ok(())
}

// ---------- switch log ----------

const LOG_COLUMNS: &str = "id, created_at, rule_id, rule_name, template_id, template_name, \
                           status, reason, edits, previous_template_id, session_results, undone_at, \
                           scope";

fn log_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelSwitchLogEntry> {
    Ok(ModelSwitchLogEntry {
        id: row.get(0)?,
        created_at: row.get(1)?,
        rule_id: row.get(2)?,
        rule_name: row.get(3)?,
        template_id: row.get(4)?,
        template_name: row.get(5)?,
        status: row.get(6)?,
        reason: row.get(7)?,
        edits: json_column(row.get(8)?, 8)?,
        previous_template_id: row.get(9)?,
        session_results: json_column(row.get(10)?, 10)?,
        undone_at: row.get(11)?,
        scope: row.get(12)?,
    })
}

/// Appends one log row, then prunes the log to [`LOG_LIMIT`] rows. Each scope's newest
/// un-undone row always survives: it is what `current_state` and the auto-revert path read.
pub(crate) fn insert_log(conn: &Connection, entry: &ModelSwitchLogEntry) -> Result<(), String> {
    let edits = serde_json::to_string(&entry.edits)
        .map_err(|error| format!("切换记录编辑项无法序列化：{error}"))?;
    let session_results = serde_json::to_string(&entry.session_results)
        .map_err(|error| format!("切换记录会话结果无法序列化：{error}"))?;
    let tx = conn.unchecked_transaction().map_err(db_error)?;
    tx.execute(
        "INSERT INTO model_switch_log(
           id, created_at, rule_id, rule_name, template_id, template_name,
           status, reason, edits, previous_template_id, session_results, undone_at, scope)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            entry.id,
            entry.created_at,
            entry.rule_id,
            entry.rule_name,
            entry.template_id,
            entry.template_name,
            entry.status,
            entry.reason,
            edits,
            entry.previous_template_id,
            session_results,
            entry.undone_at,
            entry.scope
        ],
    )
    .map_err(db_error)?;
    tx.execute(
        "DELETE FROM model_switch_log
         WHERE id NOT IN (
             SELECT id FROM model_switch_log ORDER BY created_at DESC, rowid DESC LIMIT ?1
           )
           AND id NOT IN (
             SELECT live.id FROM model_switch_log AS live
             WHERE live.undone_at IS NULL
               AND live.rowid = (
                 SELECT newest.rowid FROM model_switch_log AS newest
                 WHERE newest.scope = live.scope AND newest.undone_at IS NULL
                 ORDER BY newest.created_at DESC, newest.rowid DESC LIMIT 1)
           )",
        params![LOG_LIMIT],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(())
}

/// Switch log, newest first, at most [`LOG_LIMIT`] rows.
pub(crate) fn list_log(conn: &Connection) -> Result<Vec<ModelSwitchLogEntry>, String> {
    let sql = format!(
        "SELECT {LOG_COLUMNS} FROM model_switch_log
         ORDER BY created_at DESC, rowid DESC LIMIT ?1"
    );
    let mut statement = conn.prepare(&sql).map_err(db_error)?;
    let rows = statement
        .query_map(params![LOG_LIMIT], log_from_row)
        .map_err(db_error)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)
}

/// Newest `applied` / `partial` row of one scope that is not undone: the switch that describes
/// the configuration in effect. `rule_only` restricts it to rows written for a rule.
pub(crate) fn latest_live_switch(
    conn: &Connection,
    scope: &str,
    rule_only: bool,
) -> Result<Option<ModelSwitchLogEntry>, String> {
    let rule_filter = if rule_only {
        "AND rule_id IS NOT NULL AND TRIM(rule_id) <> ''"
    } else {
        ""
    };
    let sql = format!(
        "SELECT {LOG_COLUMNS} FROM model_switch_log
         WHERE scope = ?1 AND status IN ('applied', 'partial') AND undone_at IS NULL {rule_filter}
         ORDER BY created_at DESC, rowid DESC LIMIT 1"
    );
    conn.query_row(&sql, params![scope], log_from_row)
        .optional()
        .map_err(db_error)
}

/// Every scope that owns a template, rule or log row, `global` first.
pub(crate) fn scopes(conn: &Connection) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT scope FROM model_templates
             UNION SELECT scope FROM model_switch_rules
             UNION SELECT scope FROM model_switch_log
             ORDER BY scope",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db_error)?;
    let stored = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    let mut scopes = vec![GLOBAL_SCOPE.to_string()];
    scopes.extend(stored.into_iter().filter(|scope| scope != GLOBAL_SCOPE));
    Ok(scopes)
}

/// One log row by id; `None` when it does not exist.
pub(crate) fn get_log(conn: &Connection, id: &str) -> Result<Option<ModelSwitchLogEntry>, String> {
    let sql = format!("SELECT {LOG_COLUMNS} FROM model_switch_log WHERE id = ?1");
    conn.query_row(&sql, params![id], log_from_row)
        .optional()
        .map_err(db_error)
}

/// Marks one log row undone at `at`.
pub(crate) fn mark_log_undone(conn: &Connection, id: &str, at: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE model_switch_log SET undone_at = ?1 WHERE id = ?2",
        params![at, id],
    )
    .map_err(db_error)?;
    Ok(())
}

// ---------- settings ----------

/// Poll settings; a missing or unreadable record falls back to the defaults.
pub(crate) fn settings(conn: &Connection) -> SwitchSettings {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![SETTINGS_KEY],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let mut parsed = stored
        .and_then(|raw| serde_json::from_str::<SwitchSettings>(&raw).ok())
        .unwrap_or_default();
    parsed.poll_interval_secs = clamp_poll_interval(parsed.poll_interval_secs);
    parsed
}

/// Stores the poll settings, clamping the interval to the documented range.
pub(crate) fn set_settings(conn: &Connection, settings: &SwitchSettings) -> Result<(), String> {
    let normalized = SwitchSettings {
        poll_interval_secs: clamp_poll_interval(settings.poll_interval_secs),
    };
    let value = serde_json::to_string(&normalized)
        .map_err(|error| format!("切换设置无法序列化：{error}"))?;
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SETTINGS_KEY, value],
    )
    .map_err(db_error)?;
    Ok(())
}

fn clamp_poll_interval(secs: u64) -> u64 {
    secs.clamp(MIN_POLL_SECS, MAX_POLL_SECS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_templates::{SessionSwitchResult, TemplateRoleEdit};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn
    }

    /// An existing project directory usable as a scope.
    fn project_scope(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("ompws-store-{tag}-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    fn template(name: &str) -> ModelTemplateInput {
        scoped_template(name, "global")
    }

    fn scoped_template(name: &str, scope: &str) -> ModelTemplateInput {
        ModelTemplateInput {
            id: None,
            name: name.to_string(),
            scope: scope.to_string(),
            roles: BTreeMap::from([("default".to_string(), Some("anthropic/claude".to_string()))]),
            is_bottom_line: false,
        }
    }

    fn rule(template_id: &str) -> ModelSwitchRuleInput {
        scoped_rule(template_id, "global")
    }

    fn scoped_rule(template_id: &str, scope: &str) -> ModelSwitchRuleInput {
        ModelSwitchRuleInput {
            id: None,
            name: "rule".to_string(),
            enabled: true,
            scope: scope.to_string(),
            provider: "anthropic".to_string(),
            window_key: "5h".to_string(),
            threshold_pct: 95.0,
            template_id: template_id.to_string(),
            auto_revert: true,
            revert_threshold_pct: None,
        }
    }

    #[test]
    fn template_round_trip_keeps_created_at() {
        let conn = db();
        let saved = upsert_template(&conn, &template("A")).unwrap();
        assert_eq!(saved.name, "A");
        assert_eq!(saved.roles["default"].as_deref(), Some("anthropic/claude"));
        let mut edit = ModelTemplateInput {
            id: Some(saved.id.clone()),
            name: "B".to_string(),
            scope: "global".to_string(),
            roles: BTreeMap::from([("default".to_string(), None)]),
            is_bottom_line: false,
        };
        let updated = upsert_template(&conn, &edit).unwrap();
        assert_eq!(updated.id, saved.id);
        assert_eq!(updated.name, "B");
        assert_eq!(updated.created_at, saved.created_at);
        assert_eq!(updated.roles["default"], None);
        // A blank id means "create".
        edit.id = Some("  ".to_string());
        let created = upsert_template(&conn, &edit).unwrap();
        assert_ne!(created.id, saved.id);
        assert_eq!(list_templates(&conn).unwrap().len(), 2);
        assert!(get_template(&conn, "missing").unwrap().is_none());
    }

    #[test]
    fn only_one_bottom_line_template_survives() {
        let conn = db();
        let first = upsert_template(&conn, &template("A")).unwrap();
        let mut second_input = template("B");
        second_input.is_bottom_line = true;
        let second = upsert_template(&conn, &second_input).unwrap();
        assert!(second.is_bottom_line);
        assert!(
            !get_template(&conn, &first.id)
                .unwrap()
                .unwrap()
                .is_bottom_line
        );
        let mut promote_first = template("A");
        promote_first.id = Some(first.id.clone());
        promote_first.is_bottom_line = true;
        upsert_template(&conn, &promote_first).unwrap();
        assert!(
            !get_template(&conn, &second.id)
                .unwrap()
                .unwrap()
                .is_bottom_line
        );
        assert!(
            get_template(&conn, &first.id)
                .unwrap()
                .unwrap()
                .is_bottom_line
        );
    }

    #[test]
    fn empty_template_name_is_rejected() {
        let conn = db();
        let error = upsert_template(&conn, &template("  ")).unwrap_err();
        assert!(error.contains("模板名称"));
    }

    #[test]
    fn deleting_a_template_deletes_its_rules() {
        let conn = db();
        let first = upsert_template(&conn, &template("A")).unwrap();
        let other = upsert_template(&conn, &template("B")).unwrap();
        upsert_rule(&conn, &rule(&first.id)).unwrap();
        upsert_rule(&conn, &rule(&other.id)).unwrap();
        delete_template(&conn, &first.id).unwrap();
        let rules = list_rules(&conn).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].template_id, other.id);
    }

    #[test]
    fn rules_keep_their_sort_across_edits_and_reorder() {
        let conn = db();
        let template = upsert_template(&conn, &template("A")).unwrap();
        let first = upsert_rule(&conn, &rule(&template.id)).unwrap();
        let second = upsert_rule(&conn, &rule(&template.id)).unwrap();
        assert_eq!((first.sort, second.sort), (0, 1));
        let mut edit = rule(&template.id);
        edit.id = Some(first.id.clone());
        edit.name = "renamed".to_string();
        let edited = upsert_rule(&conn, &edit).unwrap();
        assert_eq!(edited.sort, 0);
        assert_eq!(edited.created_at, first.created_at);
        reorder_rules(&conn, "global", &[second.id.clone(), first.id.clone()]).unwrap();
        let ordered: Vec<String> = list_rules(&conn)
            .unwrap()
            .into_iter()
            .map(|rule| rule.id)
            .collect();
        assert_eq!(ordered, vec![second.id.clone(), first.id.clone()]);
        delete_rule(&conn, &second.id).unwrap();
        assert_eq!(list_rules(&conn).unwrap().len(), 1);
        assert_eq!(get_rule(&conn, &first.id).unwrap().unwrap().name, "renamed");
    }

    #[test]
    fn each_scope_keeps_its_own_bottom_line_template() {
        let conn = db();
        let project = project_scope("bottom");
        let mut global_input = template("全局保底");
        global_input.is_bottom_line = true;
        let global = upsert_template(&conn, &global_input).unwrap();
        let mut project_input = scoped_template("项目保底", &project);
        project_input.is_bottom_line = true;
        let in_project = upsert_template(&conn, &project_input).unwrap();
        // Both stay bottom-line: the exclusion only applies inside one scope.
        assert!(
            get_template(&conn, &global.id)
                .unwrap()
                .unwrap()
                .is_bottom_line
        );
        assert!(
            get_template(&conn, &in_project.id)
                .unwrap()
                .unwrap()
                .is_bottom_line
        );
        // A second project template taking over clears only that project's flag.
        let mut other_input = scoped_template("另一个", &project);
        other_input.is_bottom_line = true;
        let other = upsert_template(&conn, &other_input).unwrap();
        assert!(
            get_template(&conn, &other.id)
                .unwrap()
                .unwrap()
                .is_bottom_line
        );
        assert!(
            !get_template(&conn, &in_project.id)
                .unwrap()
                .unwrap()
                .is_bottom_line
        );
        assert!(
            get_template(&conn, &global.id)
                .unwrap()
                .unwrap()
                .is_bottom_line
        );
    }

    #[test]
    fn template_scope_is_validated_on_create_and_immutable_on_update() {
        let conn = db();
        let missing = std::env::temp_dir().join(format!("ompws-store-gone-{}", new_id()));
        let error =
            upsert_template(&conn, &scoped_template("A", &missing.to_string_lossy())).unwrap_err();
        assert!(error.contains("项目目录"), "{error}");
        assert!(upsert_template(&conn, &scoped_template("A", "relative/dir")).is_err());

        let project = project_scope("immutable");
        let saved = upsert_template(&conn, &scoped_template("A", &project)).unwrap();
        assert_eq!(saved.scope, project);
        // An edit that names another scope keeps the stored one.
        let mut edit = scoped_template("B", "global");
        edit.id = Some(saved.id.clone());
        let updated = upsert_template(&conn, &edit).unwrap();
        assert_eq!(updated.scope, project);
        assert_eq!(updated.name, "B");
    }

    #[test]
    fn reorder_only_touches_the_given_scope() {
        let conn = db();
        let project = project_scope("reorder");
        let global_template = upsert_template(&conn, &template("G")).unwrap();
        let project_template = upsert_template(&conn, &scoped_template("P", &project)).unwrap();
        let g1 = upsert_rule(&conn, &rule(&global_template.id)).unwrap();
        let g2 = upsert_rule(&conn, &rule(&global_template.id)).unwrap();
        let p1 = upsert_rule(&conn, &scoped_rule(&project_template.id, &project)).unwrap();
        let p2 = upsert_rule(&conn, &scoped_rule(&project_template.id, &project)).unwrap();
        // Sorts are per scope: both scopes start at 0.
        assert_eq!((g1.sort, g2.sort, p1.sort, p2.sort), (0, 1, 0, 1));

        // Other scopes' ids in the list are ignored.
        reorder_rules(
            &conn,
            &project,
            &[p2.id.clone(), g1.id.clone(), p1.id.clone()],
        )
        .unwrap();
        let sort_of = |id: &str| get_rule(&conn, id).unwrap().unwrap().sort;
        assert_eq!((sort_of(&p2.id), sort_of(&p1.id)), (0, 1));
        assert_eq!((sort_of(&g1.id), sort_of(&g2.id)), (0, 1));

        // Unlisted rules of the scope follow the listed ones.
        reorder_rules(&conn, "global", std::slice::from_ref(&g2.id)).unwrap();
        assert_eq!((sort_of(&g2.id), sort_of(&g1.id)), (0, 1));
        assert_eq!((sort_of(&p2.id), sort_of(&p1.id)), (0, 1));
    }

    #[test]
    fn moving_a_rule_to_another_scope_appends_it_there() {
        let conn = db();
        let project = project_scope("move");
        let global_template = upsert_template(&conn, &template("G")).unwrap();
        let project_template = upsert_template(&conn, &scoped_template("P", &project)).unwrap();
        upsert_rule(&conn, &scoped_rule(&project_template.id, &project)).unwrap();
        let moving = upsert_rule(&conn, &rule(&global_template.id)).unwrap();
        assert_eq!(moving.sort, 0);
        let mut edit = scoped_rule(&project_template.id, &project);
        edit.id = Some(moving.id.clone());
        let moved = upsert_rule(&conn, &edit).unwrap();
        assert_eq!(moved.scope, project);
        assert_eq!(moved.sort, 1);
    }

    fn entry(name: &str, status: &str) -> ModelSwitchLogEntry {
        ModelSwitchLogEntry {
            id: new_id(),
            created_at: now_rfc3339(),
            rule_id: Some("r".to_string()),
            rule_name: Some(name.to_string()),
            template_id: "t".to_string(),
            template_name: "T".to_string(),
            status: status.to_string(),
            reason: "why".to_string(),
            edits: vec![TemplateRoleEdit {
                role: "default".to_string(),
                before: Some("a/b".to_string()),
                after: Some("c/d".to_string()),
            }],
            previous_template_id: None,
            session_results: vec![SessionSwitchResult {
                session_id: "s".to_string(),
                title: "S".to_string(),
                ok: true,
                reason: String::new(),
            }],
            undone_at: None,
            scope: "global".to_string(),
        }
    }

    #[test]
    fn log_round_trips_and_marks_undone() {
        let conn = db();
        let first = entry("first", "applied");
        insert_log(&conn, &first).unwrap();
        let read = get_log(&conn, &first.id).unwrap().unwrap();
        assert_eq!(read.edits, first.edits);
        assert_eq!(read.session_results, first.session_results);
        mark_log_undone(&conn, &first.id, "2026-01-01T00:00:00Z").unwrap();
        assert_eq!(
            get_log(&conn, &first.id)
                .unwrap()
                .unwrap()
                .undone_at
                .as_deref(),
            Some("2026-01-01T00:00:00Z")
        );
        assert_eq!(list_log(&conn).unwrap().len(), 1);
        assert!(get_log(&conn, "missing").unwrap().is_none());
    }

    #[test]
    fn log_pruning_keeps_the_newest_rows() {
        let conn = db();
        for index in 0..(LOG_LIMIT + 5) {
            insert_log(&conn, &entry(&format!("r{index}"), "applied")).unwrap();
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM model_switch_log", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, LOG_LIMIT);
        assert_eq!(list_log(&conn).unwrap().len() as i64, LOG_LIMIT);
        // The oldest rows went first.
        let oldest: Option<String> = conn
            .query_row(
                "SELECT id FROM model_switch_log WHERE rule_name = 'r0'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(oldest.is_none());
    }

    /// The newest un-undone row survives a prune even when it is older than the newest 200:
    /// `current_state` and auto-revert read it.
    #[test]
    fn log_pruning_never_drops_the_newest_live_row() {
        let conn = db();
        let live = entry("live", "applied");
        insert_log(&conn, &live).unwrap();
        conn.execute(
            "UPDATE model_switch_log SET created_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            params![live.id],
        )
        .unwrap();
        for index in 0..(LOG_LIMIT + 5) {
            let mut undone = entry(&format!("r{index}"), "undone");
            undone.undone_at = Some(now_rfc3339());
            insert_log(&conn, &undone).unwrap();
        }
        let still_there: Option<String> = conn
            .query_row(
                "SELECT id FROM model_switch_log WHERE id = ?1",
                params![live.id],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(still_there.as_deref(), Some(live.id.as_str()));
        let live_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM model_switch_log WHERE undone_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(live_rows, 1);
    }

    /// Every scope keeps its own newest un-undone row, even when another scope floods the log
    /// and has no live row of its own.
    #[test]
    fn log_pruning_keeps_each_scopes_newest_live_row() {
        let conn = db();
        let mut project_live = entry("project", "applied");
        project_live.scope = "/some/project".to_string();
        insert_log(&conn, &project_live).unwrap();
        conn.execute(
            "UPDATE model_switch_log SET created_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
            params![project_live.id],
        )
        .unwrap();
        for index in 0..(LOG_LIMIT + 5) {
            let mut undone = entry(&format!("r{index}"), "undone");
            undone.undone_at = Some(now_rfc3339());
            insert_log(&conn, &undone).unwrap();
        }
        let kept = get_log(&conn, &project_live.id).unwrap().unwrap();
        assert_eq!(kept.scope, "/some/project");
    }

    #[test]
    fn settings_default_clamp_and_persist() {
        let conn = db();
        assert_eq!(settings(&conn).poll_interval_secs, 600);
        set_settings(
            &conn,
            &SwitchSettings {
                poll_interval_secs: 5,
            },
        )
        .unwrap();
        assert_eq!(settings(&conn).poll_interval_secs, MIN_POLL_SECS);
        let stored: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'model_switch'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, format!("{{\"pollIntervalSecs\":{MIN_POLL_SECS}}}"));
        set_settings(
            &conn,
            &SwitchSettings {
                poll_interval_secs: 900,
            },
        )
        .unwrap();
        assert_eq!(settings(&conn).poll_interval_secs, 900);
        set_settings(
            &conn,
            &SwitchSettings {
                poll_interval_secs: u64::MAX,
            },
        )
        .unwrap();
        assert_eq!(settings(&conn).poll_interval_secs, MAX_POLL_SECS);
        // A corrupt record falls back to the default instead of failing the snapshot.
        conn.execute(
            "UPDATE settings SET value = 'nope' WHERE key = 'model_switch'",
            [],
        )
        .unwrap();
        assert_eq!(settings(&conn).poll_interval_secs, 600);
    }
}
