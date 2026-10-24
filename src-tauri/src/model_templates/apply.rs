//! Template preview, guarded batch apply, live-session fan-out and undo.
//!
//! Every operation works on the scope of its template (or log row): `global` is the global
//! `modelRoles`, a project scope is that project's own `<project>/.omp/config.yml`, created on
//! apply when it does not exist yet. [`preview_template`] is read-only: it diffs one template
//! against its scope's own layer, lists project configs that override roles (global scope only),
//! and probes quota state. [`apply_template`] writes the diff through the single guarded batch
//! writer (`settings_model_roles::write_role_batch`), pushes the resulting model to the scope's
//! live sessions, and records exactly one log row. [`undo_switch`] replays a log row inverted,
//! skipping roles whose current value drifted since the switch, so a manual edit is never
//! overwritten.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::Emitter as _;

use crate::rpc::{self, SessionHandle};
use crate::settings_model_roles as roles;
use crate::state::AppState;

use super::provider_map::provider_matches;
use super::store;
use super::usage::{self, ProviderState, UsageSnapshot};
use super::{
    read_layer, scope_label, scope_project, ModelSwitchLogEntry, ModelSwitchRule, ModelTemplate,
    PreflightVerdict, ProjectOverride, SessionSwitchResult, SwitchResult, TemplatePreview,
    TemplateRoleEdit, GLOBAL_SCOPE,
};

/// Label of a project config in error messages, matching `settings_model_roles` / `model_replace`.
const PROJECT_LABEL: &str = "项目配置";
/// A template value that is an alias or absent cannot name a live model.
const ALIAS_REASON: &str = "别名/未配置，仅新会话生效";
const STREAMING_REASON: &str = "会话正在生成中，已跳过";

// ---------- preview ----------

/// Diffs one template against its own scope's config layer. Read-only.
pub(crate) async fn preview_template(
    state: &AppState,
    template_id: &str,
) -> Result<TemplatePreview, String> {
    let template = load_template(state, template_id)?;
    preview_for(state, &template).await
}

fn load_template(state: &AppState, template_id: &str) -> Result<ModelTemplate, String> {
    let conn = state.db.lock();
    store::get_template(&conn, template_id)?.ok_or_else(|| "模板不存在".to_string())
}

async fn preview_for(
    state: &AppState,
    template: &ModelTemplate,
) -> Result<TemplatePreview, String> {
    let scope = template.scope.as_str();
    // A project that no longer exists is an error here, not an empty layer to create.
    scope_project(scope)?;
    let layer = read_layer(scope)?;
    let (edits, unchanged, not_in_template) = diff_layer(template, &layer.model_roles);
    // `default` the template leaves alone resolves to the scope's effective value: the project
    // layer first, then the global layer it inherits from.
    let current_default = match layer.model_roles.get("default") {
        Some(value) => Some(value.clone()),
        None if scope != GLOBAL_SCOPE => read_layer(GLOBAL_SCOPE)?
            .model_roles
            .get("default")
            .cloned(),
        None => None,
    };
    let project_overrides = if scope == GLOBAL_SCOPE {
        project_overrides(state)?
    } else {
        Vec::new()
    };
    let preflight = preflight(state, template, current_default).await;
    // Removing keys never creates a file, so only an edit that sets a value counts.
    let will_create_file = !layer.exists && edits.iter().any(|edit| edit.after.is_some());

    Ok(TemplatePreview {
        scope: scope.to_string(),
        config_path: layer.path.to_string_lossy().into_owned(),
        will_create_file,
        edits,
        unchanged,
        not_in_template,
        project_overrides,
        preflight,
    })
}

/// `(edits, unchanged, not_in_template)` of one template against the layer's own `modelRoles`.
/// `None` in the template deletes the key (restoring inheritance); a role the layer has but the
/// template does not declare is left alone.
fn diff_layer(
    template: &ModelTemplate,
    current: &BTreeMap<String, String>,
) -> (Vec<TemplateRoleEdit>, Vec<String>, Vec<String>) {
    let mut edits = Vec::new();
    let mut unchanged = Vec::new();
    for (role, after) in &template.roles {
        let before = current.get(role).cloned();
        let same = match after {
            Some(value) => before.as_deref() == Some(value.as_str()),
            None => before.is_none(),
        };
        if same {
            unchanged.push(role.clone());
        } else {
            edits.push(TemplateRoleEdit {
                role: role.clone(),
                before,
                after: after.clone(),
            });
        }
    }
    let not_in_template = current
        .keys()
        .filter(|role| !template.roles.contains_key(*role))
        .cloned()
        .collect();
    (edits, unchanged, not_in_template)
}

/// Project configs that pin `modelRoles` and therefore shadow part of a template.
fn project_overrides(state: &AppState) -> Result<Vec<ProjectOverride>, String> {
    let mut overrides = Vec::new();
    for (path, name) in project_workspaces(state)? {
        let file = Path::new(&path).join(".omp").join("config.yml");
        if !file.is_file() {
            continue;
        }
        // An unreadable project config is reported by the model-role screen itself; a preview
        // must not fail because of one broken workspace.
        let Ok(refs) = roles::layer_refs(&file, PROJECT_LABEL) else {
            continue;
        };
        if refs.model_roles.is_empty() {
            continue;
        }
        overrides.push(ProjectOverride {
            path,
            name,
            roles: refs.model_roles.keys().cloned().collect(),
        });
    }
    Ok(overrides)
}

fn project_workspaces(state: &AppState) -> Result<Vec<(String, String)>, String> {
    let conn = state.db.lock();
    let mut statement = conn
        .prepare(
            "SELECT path, name FROM workspaces
             WHERE kind <> 'global' ORDER BY sort, created_at",
        )
        .map_err(|error| format!("读取项目列表失败：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("读取项目列表失败：{error}"))?;
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut workspaces = Vec::new();
    for row in rows {
        let (path, name) = row.map_err(|error| format!("读取项目列表失败：{error}"))?;
        if path.trim().is_empty() || !seen.insert(path.clone()) {
            continue;
        }
        workspaces.push((path, name));
    }
    Ok(workspaces)
}

// ---------- preflight ----------

/// Quota verdict for the template's `default` role, plus every other role that would land on an
/// exhausted provider. A failed usage probe never blocks: it degrades to `unknown`.
async fn preflight(
    state: &AppState,
    template: &ModelTemplate,
    current_default: Option<String>,
) -> PreflightVerdict {
    let selector = template
        .roles
        .get("default")
        .cloned()
        .flatten()
        .or(current_default);
    let Some(provider) = selector.as_deref().and_then(model_provider) else {
        return PreflightVerdict {
            level: "ok".to_string(),
            default_provider: None,
            provider_state: "unknown".to_string(),
            degraded_roles: Vec::new(),
            message: "无法判断供应商额度".to_string(),
        };
    };
    let snapshot = match usage::fetch_usage(state).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return PreflightVerdict {
                level: "ok".to_string(),
                default_provider: Some(provider),
                provider_state: "unknown".to_string(),
                degraded_roles: Vec::new(),
                message: format!("额度查询失败，按可用处理：{error}"),
            }
        }
    };
    let default_state = model_provider_state(&snapshot, &provider);
    let mut degraded_roles = Vec::new();
    for (role, value) in &template.roles {
        if role == "default" {
            continue;
        }
        let Some(other) = value.as_deref().and_then(model_provider) else {
            continue;
        };
        if model_provider_state(&snapshot, &other) == "exhausted" {
            degraded_roles.push(role.clone());
        }
    }
    let (mut level, mut message) = match default_state {
        "exhausted" if template.is_bottom_line => (
            "partial",
            format!("default 模型所属供应商额度已用尽，按保底模板应用：{provider}"),
        ),
        "exhausted" => (
            "blocked",
            format!("default 模型所属供应商额度已用尽：{provider}"),
        ),
        "unmapped" => (
            "ok",
            format!("该供应商没有额度报告，按可用处理：{provider}"),
        ),
        _ => ("ok", format!("供应商额度可用：{provider}")),
    };
    if !degraded_roles.is_empty() {
        if level == "ok" {
            level = "partial";
        }
        message = format!(
            "{message}；部分角色指向已用尽供应商：{}",
            degraded_roles.join("、")
        );
    }
    PreflightVerdict {
        level: level.to_string(),
        default_provider: Some(provider),
        provider_state: default_state.to_string(),
        degraded_roles,
        message,
    }
}

/// `available` / `exhausted` / `unmapped` for one model provider, read off the usage snapshot.
///
/// Several usage slugs can map to one model provider (`openai` / `openai-codex`): an exact slug
/// match wins, otherwise the provider counts as available when any of its slugs is available and
/// as exhausted only when all of them are. No matching report at all is `unmapped`, never guessed.
fn model_provider_state(snapshot: &UsageSnapshot, model_provider: &str) -> &'static str {
    if snapshot.providers.contains_key(model_provider) {
        return provider_state_text(usage::provider_state(snapshot, model_provider));
    }
    let mut matched = snapshot
        .providers
        .keys()
        .filter(|slug| provider_matches(slug.as_str(), model_provider));
    let Some(first) = matched.next() else {
        return "unmapped";
    };
    let mut state = usage::provider_state(snapshot, first);
    for slug in matched {
        state = match (state, usage::provider_state(snapshot, slug)) {
            (ProviderState::Available, _) | (_, ProviderState::Available) => {
                ProviderState::Available
            }
            (ProviderState::Unmapped, other) | (other, ProviderState::Unmapped) => other,
            _ => ProviderState::Exhausted,
        };
    }
    provider_state_text(state)
}

fn provider_state_text(state: ProviderState) -> &'static str {
    match state {
        ProviderState::Available => "available",
        ProviderState::Exhausted => "exhausted",
        ProviderState::Unmapped => "unmapped",
    }
}

// ---------- apply ----------

pub(crate) async fn apply_template(
    state: &AppState,
    template_id: &str,
    force: bool,
    rule: Option<ModelSwitchRule>,
) -> Result<SwitchResult, String> {
    let template = load_template(state, template_id)?;
    let preview = preview_for(state, &template).await?;
    if preview.edits.is_empty() {
        return Ok(SwitchResult {
            log_id: String::new(),
            status: "skipped".to_string(),
            reason: "当前配置已与模板一致".to_string(),
            edits: Vec::new(),
            session_results: Vec::new(),
        });
    }
    let project = scope_project(&template.scope)?;
    let label = scope_label(&template.scope);
    let previous_template_id = current_template_id(state, &template.scope)?;
    let mut reason = match &rule {
        Some(rule) => format!("规则「{}」触发", rule.name),
        None => "手动应用".to_string(),
    };
    if preview.preflight.level != "ok" {
        reason = format!("{reason}；{}", preview.preflight.message);
    }

    if preview.preflight.level == "blocked" && !force {
        let entry = log_entry(
            &template,
            rule.as_ref(),
            "refused",
            preview.preflight.message.clone(),
            &preview.edits,
            previous_template_id,
            Vec::new(),
        );
        record(state, &entry)?;
        let _ = state.app.emit("model_switch:changed", ());
        let _ = crate::notify::send(
            state,
            &format!("模型模板未切换（{label}）"),
            &format!("{}：{}", template.name, preview.preflight.message),
            true,
        );
        return Ok(SwitchResult {
            log_id: entry.id,
            status: "refused".to_string(),
            reason: preview.preflight.message,
            edits: preview.edits,
            session_results: Vec::new(),
        });
    }

    let ops: Vec<(String, Option<String>)> = preview
        .edits
        .iter()
        .map(|edit| (edit.role.clone(), edit.after.clone()))
        .collect();
    if let Err(error) = write_batch(project.clone(), ops).await {
        let entry = log_entry(
            &template,
            rule.as_ref(),
            "failed",
            error.clone(),
            &preview.edits,
            previous_template_id,
            Vec::new(),
        );
        let logged = record(state, &entry);
        let _ = state.app.emit("model_switch:changed", ());
        return Err(match logged {
            Ok(()) => error,
            Err(db) => format!("{error}；写入切换记录失败：{db}"),
        });
    }

    let session_results = switch_sessions(state, project.as_deref(), &preview.edits).await;
    let status = if preview.preflight.level == "partial"
        || session_results.iter().any(|result| !result.ok)
    {
        "partial"
    } else {
        "applied"
    };
    let entry = log_entry(
        &template,
        rule.as_ref(),
        status,
        reason.clone(),
        &preview.edits,
        previous_template_id,
        session_results.clone(),
    );
    record(state, &entry)?;
    let _ = state.app.emit("model_switch:changed", ());
    let _ = crate::notify::send(
        state,
        &format!("模型模板已切换（{label}）"),
        &format!("{}：{reason}", template.name),
        true,
    );
    Ok(SwitchResult {
        log_id: entry.id,
        status: status.to_string(),
        reason,
        edits: preview.edits,
        session_results,
    })
}

/// The template that produced the scope's current configuration, used as
/// `previous_template_id`.
fn current_template_id(state: &AppState, scope: &str) -> Result<Option<String>, String> {
    let conn = state.db.lock();
    Ok(super::rules::current_state(&conn, scope)?.template_id)
}

/// A log row for one switch attempt; it carries the template's scope.
pub(super) fn log_entry(
    template: &ModelTemplate,
    rule: Option<&ModelSwitchRule>,
    status: &str,
    reason: String,
    edits: &[TemplateRoleEdit],
    previous_template_id: Option<String>,
    session_results: Vec<SessionSwitchResult>,
) -> ModelSwitchLogEntry {
    ModelSwitchLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: crate::schedules::store::now_rfc3339(),
        rule_id: rule.map(|rule| rule.id.clone()),
        rule_name: rule.map(|rule| rule.name.clone()),
        template_id: template.id.clone(),
        template_name: template.name.clone(),
        scope: template.scope.clone(),
        status: status.to_string(),
        reason,
        edits: edits.to_vec(),
        previous_template_id,
        session_results,
        undone_at: None,
    }
}

pub(super) fn record(state: &AppState, entry: &ModelSwitchLogEntry) -> Result<(), String> {
    let conn = state.db.lock();
    store::insert_log(&conn, entry)
}

/// Runs the blocking guarded write off the async runtime. `project` = `None` writes the global
/// layer.
async fn write_batch(
    project: Option<PathBuf>,
    ops: Vec<(String, Option<String>)>,
) -> Result<(), String> {
    match tokio::task::spawn_blocking(move || roles::write_role_batch(project.as_deref(), &ops))
        .await
    {
        Ok(result) => result,
        Err(error) => Err(format!("写入配置失败：{error}")),
    }
}

// ---------- live sessions ----------

/// One session's handling outcome. A session whose model is not in the `before` set is not part
/// of the switch at all, so it produces no result row.
enum SessionOutcome {
    Switched,
    /// Not moved, with the user-facing reason recorded as a failed result row.
    Skipped(&'static str),
    Failed(String),
    /// The session runs a model this template does not replace.
    Unaffected,
}

/// Whether a session's `cwd` is the project directory or lies inside it. Both sides are
/// canonicalized so symlinks and `..` cannot fake membership; an unresolvable path is outside.
fn cwd_in_project(cwd: &str, project: &Path) -> bool {
    let (Ok(cwd), Ok(project)) = (std::fs::canonicalize(cwd), std::fs::canonicalize(project))
    else {
        return false;
    };
    cwd.starts_with(project)
}

/// Pushes the new model to every live session whose current model is one the template replaces.
/// A project scope only touches sessions running inside that project; the global scope touches
/// every session. Each session is handled independently: a failure is recorded, never fatal.
async fn switch_sessions(
    state: &AppState,
    project: Option<&Path>,
    edits: &[TemplateRoleEdit],
) -> Vec<SessionSwitchResult> {
    let targets = session_targets(edits);
    // Clone the `Arc`s and drop the registry read lock before awaiting anything.
    let handles: Vec<Arc<SessionHandle>> = rpc::registry().read().values().cloned().collect();
    let mut results = Vec::new();
    for handle in handles {
        if !handle.alive.load(Ordering::SeqCst) {
            continue;
        }
        if project.is_some_and(|dir| !cwd_in_project(&handle.cwd, dir)) {
            continue;
        }
        let session_id = handle.session_id.read().clone();
        if handle.streaming.load(Ordering::SeqCst) {
            results.push(session_result(state, session_id, Err(STREAMING_REASON)).await);
            continue;
        }
        let outcome = switch_session(&handle, &targets).await;
        match outcome {
            SessionOutcome::Unaffected => continue,
            SessionOutcome::Switched => {
                results.push(session_result(state, session_id, Ok(())).await);
            }
            SessionOutcome::Skipped(reason) => {
                results.push(session_result(state, session_id, Err(reason)).await);
            }
            SessionOutcome::Failed(error) => {
                results.push(session_result(state, session_id, Err(&error)).await);
            }
        }
    }
    results
}

async fn session_result(
    state: &AppState,
    session_id: String,
    outcome: Result<(), &str>,
) -> SessionSwitchResult {
    let title = match crate::catalog::get(state, &session_id).await {
        Some(meta) => meta.title,
        None => session_id.clone(),
    };
    SessionSwitchResult {
        session_id,
        title,
        ok: outcome.is_ok(),
        reason: outcome.err().unwrap_or_default().to_string(),
    }
}

/// `before` model key (`provider/model`) -> the value the session should switch to. `None` means
/// the role is deleted or aliased, so only new sessions pick it up. `default` is visited first so
/// it wins when two roles share a `before` model, as it is the model sessions normally run.
fn session_targets(edits: &[TemplateRoleEdit]) -> BTreeMap<String, Option<ModelTarget>> {
    let ordered = edits
        .iter()
        .filter(|edit| edit.role == "default")
        .chain(edits.iter().filter(|edit| edit.role != "default"));
    let mut targets: BTreeMap<String, Option<ModelTarget>> = BTreeMap::new();
    for edit in ordered {
        let Some(before) = edit.before.as_deref().and_then(model_target) else {
            continue;
        };
        let after = edit.after.as_deref().and_then(model_target);
        targets.entry(before.key()).or_insert(after);
    }
    targets
}

async fn switch_session(
    handle: &Arc<SessionHandle>,
    targets: &BTreeMap<String, Option<ModelTarget>>,
) -> SessionOutcome {
    let state_resp = match rpc::send_command(handle, json!({"type": "get_state"})).await {
        Ok(resp) => resp,
        Err(error) => return SessionOutcome::Failed(format!("读取会话状态失败：{error}")),
    };
    let Some(current) = live_model(&state_resp) else {
        // No concrete provider/model in the reply: no template value can match it.
        return SessionOutcome::Unaffected;
    };
    let Some(target) = targets.get(&current.key()) else {
        return SessionOutcome::Unaffected;
    };
    let Some(target) = target else {
        // The role is now an alias or removed: the session keeps its model until a new session.
        return SessionOutcome::Skipped(ALIAS_REASON);
    };
    let set_model = json!({
        "type": "set_model",
        "provider": target.provider.as_str(),
        "modelId": target.model.as_str(),
    });
    if let Err(error) = rpc::send_command(handle, set_model).await {
        return SessionOutcome::Failed(format!("切换模型失败：{error}"));
    }
    if let Some(level) = target.level.as_deref().filter(|level| *level != "inherit") {
        let command = json!({"type": "set_thinking_level", "level": level});
        if let Err(error) = rpc::send_command(handle, command).await {
            return SessionOutcome::Failed(format!("设置思考等级失败：{error}"));
        }
    }
    // Refresh the cached live state; a failure here does not undo the switch.
    let _ = rpc::send_command(handle, json!({"type": "get_state"})).await;
    SessionOutcome::Switched
}

/// `get_state` reply -> the live session model. The string form is `provider/model`, possibly
/// with a `:level` suffix that is not part of the model id.
fn live_model(resp: &Value) -> Option<ModelTarget> {
    let data = resp.get("data").unwrap_or(resp);
    match data.get("model")? {
        Value::String(text) => model_target(text),
        Value::Object(map) => {
            let provider = map.get("provider").and_then(Value::as_str)?.trim();
            let model = map
                .get("modelId")
                .or_else(|| map.get("id"))
                .and_then(Value::as_str)?
                .trim();
            if provider.is_empty() || model.is_empty() {
                return None;
            }
            Some(ModelTarget {
                provider: provider.to_string(),
                model: model.to_string(),
                level: None,
            })
        }
        _ => None,
    }
}

// ---------- selector parsing ----------

/// One concrete `provider/model[:level]` value. Aliases cannot name a live model.
struct ModelTarget {
    provider: String,
    model: String,
    level: Option<String>,
}

impl ModelTarget {
    fn key(&self) -> String {
        format!("{}/{}", self.provider, self.model)
    }
}

/// The first candidate of a stored selector. omp joins fallback lists with `,`; the first entry
/// is the one a session actually runs.
fn primary(selector: &str) -> &str {
    selector.split(',').next().unwrap_or(selector).trim()
}

/// `provider/model` -> `provider`. Aliases (`@role`) and unparsable values yield `None`.
fn model_provider(selector: &str) -> Option<String> {
    let selector = primary(selector);
    if selector.starts_with('@') {
        return None;
    }
    let (provider, model) = selector.split_once('/')?;
    let provider = provider.trim();
    if provider.is_empty() || model.trim().is_empty() {
        return None;
    }
    Some(provider.to_string())
}

/// Splits a concrete selector into its provider, model and optional thinking level.
fn model_target(selector: &str) -> Option<ModelTarget> {
    let selector = primary(selector);
    if selector.starts_with('@') {
        return None;
    }
    let (provider, rest) = selector.split_once('/')?;
    let (model, level) = match rest.rsplit_once(':') {
        Some((model, level)) if is_thinking_level(level) => (model, Some(level.to_string())),
        _ => (rest, None),
    };
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || model.is_empty() {
        return None;
    }
    Some(ModelTarget {
        provider: provider.to_string(),
        model: model.to_string(),
        level,
    })
}

/// Thinking-level suffixes omp recognises (`THINKING_SUFFIXES` in the UI). Anything else after a
/// colon stays part of the model id, so `provider/id:8080` keeps its port.
const THINKING_LEVELS: [&str; 9] = [
    "off", "minimal", "low", "medium", "high", "xhigh", "max", "auto", "inherit",
];

fn is_thinking_level(raw: &str) -> bool {
    THINKING_LEVELS.contains(&raw)
}

// ---------- undo ----------

/// Reverts one log row inside the scope it was written to.
pub(crate) async fn undo_switch(state: &AppState, log_id: &str) -> Result<SwitchResult, String> {
    let entry = {
        let conn = state.db.lock();
        store::get_log(&conn, log_id)?.ok_or_else(|| "未找到该切换记录".to_string())?
    };
    if entry.undone_at.is_some() {
        return Err("该记录已撤销".to_string());
    }
    let project = scope_project(&entry.scope)?;
    let current = read_layer(&entry.scope)?.model_roles;

    let mut ops = Vec::new();
    let mut reverted = Vec::new();
    let mut drifted = Vec::new();
    for edit in &entry.edits {
        if current.get(&edit.role).cloned() != edit.after {
            drifted.push(edit.role.clone());
            continue;
        }
        ops.push((edit.role.clone(), edit.before.clone()));
        reverted.push(TemplateRoleEdit {
            role: edit.role.clone(),
            before: edit.after.clone(),
            after: edit.before.clone(),
        });
    }
    // One guarded write for the whole undo; an empty batch is a no-op.
    write_batch(project, ops).await?;
    {
        let conn = state.db.lock();
        store::mark_log_undone(&conn, log_id, &crate::schedules::store::now_rfc3339())?;
    }
    let _ = state.app.emit("model_switch:changed", ());
    let reason = if drifted.is_empty() {
        "已撤销".to_string()
    } else {
        format!(
            "已撤销；以下角色当前值已变化，已跳过：{}",
            drifted.join("、")
        )
    };
    let scope = super::scope_label(&entry.scope);
    let (title, body) = if reverted.is_empty() {
        (
            format!("模型模板未恢复（{scope}）"),
            if drifted.is_empty() {
                format!("{}：该记录没有可恢复的角色", entry.template_name)
            } else {
                format!(
                    "{}：没有角色被恢复；以下角色当前值已变化，已跳过：{}",
                    entry.template_name,
                    drifted.join("、")
                )
            },
        )
    } else {
        (
            format!("模型模板已恢复（{scope}）"),
            format!("{}：{reason}", entry.template_name),
        )
    };
    let _ = crate::notify::send(state, &title, &body, true);
    Ok(SwitchResult {
        log_id: log_id.to_string(),
        status: "undone".to_string(),
        reason,
        edits: reverted,
        session_results: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn template(scope: &str, roles: &[(&str, Option<&str>)]) -> ModelTemplate {
        ModelTemplate {
            id: "t".to_string(),
            name: "T".to_string(),
            scope: scope.to_string(),
            roles: roles
                .iter()
                .map(|(role, value)| (role.to_string(), value.map(str::to_string)))
                .collect(),
            is_bottom_line: false,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn layer(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
        entries
            .iter()
            .map(|(role, value)| (role.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn diff_sets_changed_roles_and_deletes_unset_ones() {
        let template = template(
            "/some/project",
            &[
                ("default", Some("a/b")),
                ("smol", None),
                ("slow", Some("c/d")),
                ("plan", None),
            ],
        );
        // Only the project file's own entries are compared; `plan` is absent so unsetting it is
        // already satisfied.
        let current = layer(&[
            ("default", "x/y"),
            ("smol", "p/q"),
            ("slow", "c/d"),
            ("extra", "m/n"),
        ]);
        let (edits, unchanged, not_in_template) = diff_layer(&template, &current);
        assert_eq!(
            edits,
            vec![
                TemplateRoleEdit {
                    role: "default".to_string(),
                    before: Some("x/y".to_string()),
                    after: Some("a/b".to_string()),
                },
                TemplateRoleEdit {
                    role: "smol".to_string(),
                    before: Some("p/q".to_string()),
                    after: None,
                },
            ]
        );
        assert_eq!(unchanged, vec!["plan".to_string(), "slow".to_string()]);
        assert_eq!(not_in_template, vec!["extra".to_string()]);
    }

    #[test]
    fn diff_against_an_empty_project_layer_creates_every_set_role() {
        let template = template("/some/project", &[("default", Some("a/b")), ("smol", None)]);
        let (edits, unchanged, not_in_template) = diff_layer(&template, &BTreeMap::new());
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].role, "default");
        assert_eq!(edits[0].before, None);
        assert_eq!(unchanged, vec!["smol".to_string()]);
        assert!(not_in_template.is_empty());
    }

    #[test]
    fn only_sessions_inside_the_project_are_in_scope() {
        let base = std::env::temp_dir().join(format!("ompws-apply-{}", uuid::Uuid::new_v4()));
        let project = base.join("proj");
        let nested = project.join("src/deep");
        let sibling = base.join("proj-other");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();

        let text = |path: &Path| path.to_string_lossy().into_owned();
        assert!(cwd_in_project(&text(&project), &project));
        assert!(cwd_in_project(&text(&nested), &project));
        // A shared name prefix is not containment.
        assert!(!cwd_in_project(&text(&sibling), &project));
        // `..` is resolved before comparing.
        assert!(!cwd_in_project(&text(&project.join("..")), &project));
        assert!(!cwd_in_project(&text(&base.join("gone")), &project));
        let _ = std::fs::remove_dir_all(&base);
    }
}
