//! Role templates (role -> model table) and quota-triggered model switching.
//!
//! A *template* is a role -> selector table that only ever overrides `modelRoles` of one config
//! layer. Every template, rule and log row carries a *scope*: [`GLOBAL_SCOPE`] (the global omp
//! config) or the absolute path of a project directory (`<project>/.omp/config.yml`, created on
//! demand). Scopes never see each other's templates. A *rule* turns "provider X's window W is at
//! least N % used" into "apply template T" for its own scope, and can optionally revert when the
//! window drains again. [`apply`] performs the guarded write and the live-session fan-out,
//! [`rules`] owns validation, polling and the current/drifted state, [`store`] is the SQLite
//! layer, [`usage`] reads the CLI quota report and [`provider_map`] translates usage slugs into
//! model providers.
//!
//! This module also holds every IPC type and every `#[tauri::command]` wrapper: commands only
//! translate arguments, take the app connection, and delegate.

pub mod apply;
pub mod provider_map;
pub mod rules;
pub mod store;
pub mod usage;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::settings_model_roles as roles;
use crate::state::AppState;

/// Scope of the global omp config.
pub(crate) const GLOBAL_SCOPE: &str = "global";

/// Resolves a scope to its config layer: `None` = global, `Some(dir)` = a project directory.
/// A project scope must be an existing absolute directory.
pub(crate) fn scope_project(scope: &str) -> Result<Option<PathBuf>, String> {
    if scope == GLOBAL_SCOPE {
        return Ok(None);
    }
    let dir = Path::new(scope);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("项目目录不存在或不是绝对路径：{scope}"));
    }
    Ok(Some(dir.to_path_buf()))
}

/// Short scope name for notifications: 「全局」 or the project directory's name.
pub(crate) fn scope_label(scope: &str) -> String {
    if scope == GLOBAL_SCOPE {
        return "全局".to_string();
    }
    Path::new(scope).file_name().map_or_else(
        || scope.to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

// ---------- IPC types (mirrored in src/lib/contracts.ts) ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelTemplate {
    pub id: String,
    pub name: String,
    /// `global` or an absolute project directory.
    pub scope: String,
    /// role -> selector; `None` = delete that key on apply (restore inheritance).
    pub roles: BTreeMap<String, Option<String>>,
    pub is_bottom_line: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelTemplateInput {
    /// `None` = create.
    pub id: Option<String>,
    pub name: String,
    /// Required on create; ignored on update (a template never changes scope).
    pub scope: String,
    pub roles: BTreeMap<String, Option<String>>,
    pub is_bottom_line: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSwitchRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// `global` or an absolute project directory; the target template has the same scope.
    pub scope: String,
    /// Usage-side slug, e.g. `anthropic`.
    pub provider: String,
    /// Window key as reported, e.g. `5h`.
    pub window_key: String,
    /// 0..=100.
    pub threshold_pct: f64,
    pub template_id: String,
    pub auto_revert: bool,
    pub revert_threshold_pct: Option<f64>,
    pub sort: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSwitchRuleInput {
    pub id: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub scope: String,
    pub provider: String,
    pub window_key: String,
    pub threshold_pct: f64,
    pub template_id: String,
    pub auto_revert: bool,
    pub revert_threshold_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRoleEdit {
    pub role: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSwitchResult {
    pub session_id: String,
    pub title: String,
    pub ok: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSwitchLogEntry {
    pub id: String,
    pub created_at: String,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    pub template_id: String,
    pub template_name: String,
    /// Scope the switch wrote to.
    pub scope: String,
    /// applied | partial | refused | skipped | reverted | undone | failed
    pub status: String,
    pub reason: String,
    pub edits: Vec<TemplateRoleEdit>,
    pub previous_template_id: Option<String>,
    pub session_results: Vec<SessionSwitchResult>,
    pub undone_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOverride {
    pub path: String,
    pub name: String,
    pub roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreflightVerdict {
    /// ok | partial | blocked
    pub level: String,
    pub default_provider: Option<String>,
    /// available | exhausted | unmapped | unknown
    pub provider_state: String,
    pub degraded_roles: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePreview {
    pub scope: String,
    /// Absolute path of the config file that would be written.
    pub config_path: String,
    /// The file (and its `.omp/` directory) does not exist yet and apply creates it.
    pub will_create_file: bool,
    pub edits: Vec<TemplateRoleEdit>,
    pub unchanged: Vec<String>,
    /// Roles present in the layer but not declared by the template (kept as-is on apply).
    pub not_in_template: Vec<String>,
    /// Project configs that shadow the template; only filled for the global scope.
    pub project_overrides: Vec<ProjectOverride>,
    pub preflight: PreflightVerdict,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResult {
    pub log_id: String,
    pub status: String,
    pub reason: String,
    pub edits: Vec<TemplateRoleEdit>,
    pub session_results: Vec<SessionSwitchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleValidation {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Poll interval in seconds; 600 by default, clamped to 60..=86400.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchSettings {
    pub poll_interval_secs: u64,
}

impl Default for SwitchSettings {
    fn default() -> Self {
        Self {
            poll_interval_secs: store::DEFAULT_POLL_SECS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentTemplateState {
    pub scope: String,
    pub template_id: Option<String>,
    pub template_name: Option<String>,
    /// Roles whose current config value differs from what the template wrote.
    pub drifted_roles: Vec<String>,
    pub log_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowStatus {
    pub key: String,
    pub label: String,
    pub used_pct: f64,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub usage_slug: String,
    pub model_provider: Option<String>,
    /// available | exhausted | unmapped
    pub state: String,
    pub windows: Vec<WindowStatus>,
    pub accounts: u32,
    pub exhausted_accounts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlockedNotice {
    pub scope: String,
    pub at: i64,
    pub message: String,
    pub providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchStatus {
    pub last_check_at: Option<i64>,
    pub last_error: Option<String>,
    pub checking: bool,
    pub poll_interval_secs: u64,
    pub next_check_at: Option<i64>,
    pub providers: Vec<ProviderStatus>,
    pub blocked: Option<BlockedNotice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateStoreSnapshot {
    pub templates: Vec<ModelTemplate>,
    pub rules: Vec<ModelSwitchRule>,
    pub log: Vec<ModelSwitchLogEntry>,
    pub settings: SwitchSettings,
    /// One entry per scope that has a template, rule or log row, plus `global`.
    pub currents: Vec<CurrentTemplateState>,
    pub conflicts: Vec<RuleConflict>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleConflict {
    pub scope: String,
    /// self-eating | mutual-escape | no-bottom-line
    pub kind: String,
    pub message: String,
    pub rule_ids: Vec<String>,
}

// ---------- config layers ----------

/// One scope's own config layer: the file and the `modelRoles` written in that file itself.
/// A project layer never includes values inherited from the global config.
pub(crate) struct Layer {
    pub path: PathBuf,
    /// The file exists on disk (a project file that does not exist yet is created on write).
    pub exists: bool,
    pub model_roles: BTreeMap<String, String>,
}

/// Reads the layer of `scope`. Does not check that a project directory exists: callers that
/// write or preview call [`scope_project`] first, and a vanished project simply reads as empty.
pub(crate) fn read_layer(scope: &str) -> Result<Layer, String> {
    let (path, label) = if scope == GLOBAL_SCOPE {
        (roles::global_config_file()?, "全局配置")
    } else {
        (roles::project_config_file(Path::new(scope)), "项目配置")
    };
    let model_roles = roles::layer_refs(&path, label)?.model_roles;
    let exists = path.is_file();
    Ok(Layer {
        path,
        exists,
        model_roles,
    })
}

// ---------- snapshot ----------

/// Every stored template/rule/log row plus the derived per-scope current state, settings and
/// conflicts.
fn build_snapshot(conn: &Connection) -> Result<TemplateStoreSnapshot, String> {
    Ok(TemplateStoreSnapshot {
        templates: store::list_templates(conn)?,
        rules: store::list_rules(conn)?,
        log: store::list_log(conn)?,
        settings: store::settings(conn),
        currents: rules::current_states(conn)?,
        conflicts: rules::conflicts(conn)?,
    })
}

async fn snapshot(state: &AppState) -> Result<TemplateStoreSnapshot, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || build_snapshot(&db.lock()))
        .await
        .map_err(|error| format!("后台任务失败：{error}"))?
}

// ---------- commands ----------

/// Full store snapshot: templates, rules, log, settings, per-scope current templates and
/// conflicts.
#[tauri::command]
pub async fn model_templates_snapshot(
    state: tauri::State<'_, AppState>,
) -> Result<TemplateStoreSnapshot, String> {
    snapshot(state.inner()).await
}

/// Seeds a new-template draft from the `modelRoles` written in one scope's own config layer
/// (nothing is stored). A project scope reads only the project file, never inherited globals.
#[tauri::command]
pub async fn model_template_capture(
    _state: tauri::State<'_, AppState>,
    name: String,
    scope: String,
) -> Result<ModelTemplateInput, String> {
    tokio::task::spawn_blocking(move || {
        scope_project(&scope)?;
        let current = read_layer(&scope)?.model_roles;
        Ok(ModelTemplateInput {
            id: None,
            name,
            scope,
            roles: current
                .into_iter()
                .map(|(role, selector)| (role, Some(selector)))
                .collect(),
            is_bottom_line: false,
        })
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))?
}

/// Creates or updates one template, then returns the fresh snapshot.
#[tauri::command]
pub async fn model_template_save(
    state: tauri::State<'_, AppState>,
    input: ModelTemplateInput,
) -> Result<TemplateStoreSnapshot, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock();
        store::upsert_template(&conn, &input)?;
        build_snapshot(&conn)
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))?
}

/// Deletes one template (and its rules), then returns the fresh snapshot.
#[tauri::command]
pub async fn model_template_delete(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<TemplateStoreSnapshot, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock();
        store::delete_template(&conn, &id)?;
        build_snapshot(&conn)
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))?
}

/// Read-only diff of one template against its own scope's config layer, with the preflight
/// verdict.
#[tauri::command]
pub async fn model_template_preview(
    state: tauri::State<'_, AppState>,
    template_id: String,
) -> Result<TemplatePreview, String> {
    apply::preview_template(state.inner(), &template_id).await
}

/// Applies one template to its scope's config layer and pushes it to that scope's live sessions.
#[tauri::command]
pub async fn model_template_apply(
    state: tauri::State<'_, AppState>,
    template_id: String,
    force: Option<bool>,
) -> Result<SwitchResult, String> {
    apply::apply_template(state.inner(), &template_id, force.unwrap_or(false), None).await
}

/// Creates or updates one rule after validation, then returns the fresh snapshot.
#[tauri::command]
pub async fn model_switch_rule_save(
    state: tauri::State<'_, AppState>,
    input: ModelSwitchRuleInput,
) -> Result<TemplateStoreSnapshot, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock();
        let validation = rules::validate_rule(&conn, &input)?;
        if !validation.errors.is_empty() {
            return Err(validation.errors.join("；"));
        }
        store::upsert_rule(&conn, &input)?;
        build_snapshot(&conn)
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))?
}

/// Deletes one rule, then returns the fresh snapshot.
#[tauri::command]
pub async fn model_switch_rule_delete(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<TemplateStoreSnapshot, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock();
        store::delete_rule(&conn, &id)?;
        build_snapshot(&conn)
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))?
}

/// Rewrites the order of one scope's rules, then returns the fresh snapshot. Other scopes keep
/// their order.
#[tauri::command]
pub async fn model_switch_rules_reorder(
    state: tauri::State<'_, AppState>,
    scope: String,
    ids: Vec<String>,
) -> Result<TemplateStoreSnapshot, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock();
        store::reorder_rules(&conn, &scope, &ids)?;
        build_snapshot(&conn)
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))?
}

/// Stores the poll interval (clamped to 60..=86400), then returns the fresh snapshot.
#[tauri::command]
pub async fn model_switch_settings_set(
    state: tauri::State<'_, AppState>,
    poll_interval_secs: u64,
) -> Result<TemplateStoreSnapshot, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.lock();
        store::set_settings(&conn, &SwitchSettings { poll_interval_secs })?;
        build_snapshot(&conn)
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))?
}

/// Live poller status: last check, last error, providers and the blocked notice.
///
/// When the caller asks for `refresh` (or the poller has never published a provider list),
/// one usage report is fetched first so the rule editor can offer real provider/window
/// choices before any rule exists.
#[tauri::command]
pub async fn model_switch_status(
    state: tauri::State<'_, AppState>,
    refresh: Option<bool>,
) -> Result<SwitchStatus, String> {
    let app = state.inner();
    let wanted = refresh.unwrap_or(false) || rules::status(app).providers.is_empty();
    if wanted {
        rules::refresh_providers(app).await;
    }
    Ok(rules::status(app))
}

/// Runs one evaluation now over every scope; `None` = no rule hit and nothing was applied.
/// When several scopes switch in the same pass, the first scope's result is returned (all of
/// them are in the switch log).
#[tauri::command]
pub async fn model_switch_run_now(
    state: tauri::State<'_, AppState>,
) -> Result<Option<SwitchResult>, String> {
    Ok(rules::evaluate_once(state.inner())
        .await?
        .into_iter()
        .next())
}

/// Reverts one switch log row.
#[tauri::command]
pub async fn model_switch_undo(
    state: tauri::State<'_, AppState>,
    log_id: String,
) -> Result<SwitchResult, String> {
    apply::undo_switch(state.inner(), &log_id).await
}
