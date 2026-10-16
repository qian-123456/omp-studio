//! [D] Bulk model replace (全局批量替换模型): scan / apply / history / undo / probe.
//!
//! `model_usage_scan` lists every stored model reference — `modelRoles` and
//! `task.agentModelOverrides` in the global omp config and in every registered project
//! workspace's `.omp/config.yml`, the global `retry.fallbackChains` record, the app settings
//! `newSessionModel` / `sideChatModel` / `doctorModel`, and every schedule's `model` (+
//! `thinking`) — together with a per-location scan status, so a missing workspace directory or
//! an unparsable config is reported instead of failing the scan. Agent frontmatter,
//! `providers.json`, `models.yml` and session history are never touched.
//!
//! Guarding. Every write re-reads the current value and refuses to write unless it still
//! equals the value the caller scanned (`当前值已变化，请重新扫描`). Role/override edits reuse
//! the single lossless YAML writer in [`roles::replace_value`]; the fallback-chain record is
//! read from the global config file and every chain edit of a call is spliced into it in one
//! comment-preserving guarded write (`roles::edit_chains`; never `omp config set`, which
//! rewrites the whole file);
//! schedules use an `UPDATE` guarded by the previous `model`/`thinking` columns.
//!
//! Undo. Every successful apply is stored (newest [`RECORD_LIMIT`] records) and `model_replace_undo`
//! replays it inverted, skipping any edit whose written value was changed afterwards
//! (`当前值已被修改，已跳过`). Results of an undo describe the *stored* edits, so the caller can
//! render the same rows it showed when applying.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Emitter as _;

use crate::contracts::{Schedule, Settings};
use crate::settings;
use crate::settings_model_roles::{self as roles, ReplaceOutcome};
use crate::state::AppState;

/// Config labels, matching `settings_model_roles`.
const GLOBAL_LABEL: &str = "全局配置";
const PROJECT_LABEL: &str = "项目配置";
/// Undo records kept; older ones are pruned.
const RECORD_LIMIT: i64 = 10;
/// Longest accepted app-setting / schedule / chain value.
const MAX_PLAIN_CHARS: usize = 256;
/// Longest accepted comma-list value for a role / agent override.
const MAX_LIST_CHARS: usize = 1024;
/// Overlay for `model_probe`. `retry.modelFallback` is omp's documented switch for
/// "stop `retry.fallbackChains` model switches", so a dead model cannot look healthy because
/// omp silently fell back to a chain member. Applied as a `--config` overlay: the user's own
/// config is never modified.
const PROBE_OVERLAY: &str = "retry:\n  modelFallback: false\n";
const PROBE_PROMPT: &str = "Reply with the single word: ok";
const PROBE_TIMEOUT: Duration = Duration::from_secs(60);
const PROBE_NOTE: &str = "已关闭回退链切换（retry.modelFallback=false）；配额等待与重试仍生效";

// ---------- IPC types (mirrored in src/lib/contracts.ts) ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelRefScope {
    Global,
    Project,
}

/// App settings that can hold a model selector. Variant names mirror the IPC field values
/// (`newSessionModel` / `sideChatModel` / `doctorModel`), so they all end in `Model`.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SettingField {
    NewSessionModel,
    SideChatModel,
    DoctorModel,
}

/// Where one stored model value lives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModelRefLocation {
    Role {
        scope: ModelRefScope,
        project_path: Option<String>,
        name: String,
    },
    AgentOverride {
        scope: ModelRefScope,
        project_path: Option<String>,
        name: String,
    },
    AppSetting {
        field: SettingField,
    },
    Schedule {
        id: String,
        name: String,
    },
}

/// One stored value, not pre-filtered by any source model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageRef {
    pub location: ModelRefLocation,
    /// Raw stored value; comma lists are kept as-is (YAML sequences joined with ",").
    pub value: String,
    /// Schedule thinking level; `None` elsewhere.
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FallbackChainsSnapshot {
    pub chains: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Ok,
    Missing,
    Error,
}

/// One scanned location. The global layer is reported only when it failed to read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedProject {
    pub path: String,
    pub name: String,
    pub status: ProjectStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageScan {
    pub refs: Vec<ModelUsageRef>,
    pub fallback_chains: FallbackChainsSnapshot,
    /// omp unavailable / unparsable chain record; `fallback_chains` is then empty.
    pub fallback_chains_error: Option<String>,
    pub projects: Vec<ScannedProject>,
}

/// One chain key's before/after state; `None` = key absent / deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainChange {
    pub key: String,
    pub before: Option<Vec<String>>,
    pub after: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModelReplaceEdit {
    Value {
        location: ModelRefLocation,
        before: String,
        after: String,
        /// Schedule only; `None` for every other location.
        #[serde(default)]
        thinking_before: Option<String>,
        #[serde(default)]
        thinking_after: Option<String>,
    },
    /// `label` is the original chain key, for display.
    FallbackChain {
        label: String,
        changes: Vec<ChainChange>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelReplaceItemResult {
    pub edit: ModelReplaceEdit,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelReplaceResult {
    pub record_id: Option<String>,
    pub results: Vec<ModelReplaceItemResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelReplaceRecord {
    pub id: String,
    pub created_at: String,
    pub from_model: String,
    pub to_model: String,
    /// Successful edits only.
    pub edits: Vec<ModelReplaceEdit>,
    pub undone_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProbeResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub detail: String,
}

// ---------- scan (sync core) ----------

/// One registered project workspace (deduplicated by path).
#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkspacePath {
    path: String,
    name: String,
}

/// Everything the scan reads; paths and rows are passed in so the core runs without the app.
struct ScanInput {
    global_config: PathBuf,
    workspaces: Vec<WorkspacePath>,
    settings: Settings,
    schedules: Vec<Schedule>,
    chains: FallbackChainsSnapshot,
    chains_error: Option<String>,
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn push_layer_refs(
    refs: &mut Vec<ModelUsageRef>,
    layer: roles::LayerRefs,
    scope: ModelRefScope,
    project_path: Option<&str>,
) {
    for (name, value) in layer.model_roles {
        refs.push(ModelUsageRef {
            location: ModelRefLocation::Role {
                scope,
                project_path: project_path.map(str::to_string),
                name,
            },
            value,
            thinking: None,
        });
    }
    for (name, value) in layer.overrides {
        refs.push(ModelUsageRef {
            location: ModelRefLocation::AgentOverride {
                scope,
                project_path: project_path.map(str::to_string),
                name,
            },
            value,
            thinking: None,
        });
    }
}

fn setting_refs(settings: &Settings, refs: &mut Vec<ModelUsageRef>) {
    let values = [
        (
            SettingField::NewSessionModel,
            settings.new_session_model.as_deref(),
        ),
        (
            SettingField::SideChatModel,
            settings.side_chat_model.as_deref(),
        ),
        (
            SettingField::DoctorModel,
            Some(settings.doctor_model.as_str()),
        ),
    ];
    for (field, value) in values {
        if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
            refs.push(ModelUsageRef {
                location: ModelRefLocation::AppSetting { field },
                value: value.to_string(),
                thinking: None,
            });
        }
    }
}

fn schedule_refs(schedules: &[Schedule], refs: &mut Vec<ModelUsageRef>) {
    for schedule in schedules {
        let Some(model) = trimmed(schedule.model.as_deref()) else {
            continue;
        };
        refs.push(ModelUsageRef {
            location: ModelRefLocation::Schedule {
                id: schedule.id.clone(),
                name: schedule.name.clone(),
            },
            value: model.to_string(),
            thinking: trimmed(schedule.thinking.as_deref()).map(str::to_string),
        });
    }
}

fn trimmed(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|value| !value.is_empty())
}

/// Sync core of `model_usage_scan`.
fn scan_model_usage(input: ScanInput) -> ModelUsageScan {
    let mut refs = Vec::new();
    let mut projects = Vec::new();
    match roles::layer_refs(&input.global_config, GLOBAL_LABEL) {
        Ok(layer) => push_layer_refs(&mut refs, layer, ModelRefScope::Global, None),
        Err(error) => projects.push(ScannedProject {
            path: path_text(&input.global_config),
            name: GLOBAL_LABEL.to_string(),
            status: ProjectStatus::Error,
            error: Some(error),
        }),
    }
    for workspace in &input.workspaces {
        let dir = Path::new(&workspace.path);
        if !dir.is_dir() {
            projects.push(ScannedProject {
                path: workspace.path.clone(),
                name: workspace.name.clone(),
                status: ProjectStatus::Missing,
                error: Some("项目目录不存在".to_string()),
            });
            continue;
        }
        let config = dir.join(".omp").join("config.yml");
        match roles::layer_refs(&config, PROJECT_LABEL) {
            Ok(layer) => {
                push_layer_refs(
                    &mut refs,
                    layer,
                    ModelRefScope::Project,
                    Some(&workspace.path),
                );
                projects.push(ScannedProject {
                    path: workspace.path.clone(),
                    name: workspace.name.clone(),
                    status: ProjectStatus::Ok,
                    error: None,
                });
            }
            Err(error) => projects.push(ScannedProject {
                path: workspace.path.clone(),
                name: workspace.name.clone(),
                status: ProjectStatus::Error,
                error: Some(error),
            }),
        }
    }
    setting_refs(&input.settings, &mut refs);
    schedule_refs(&input.schedules, &mut refs);
    ModelUsageScan {
        refs,
        fallback_chains: input.chains,
        fallback_chains_error: input.chains_error,
        projects,
    }
}

// ---------- apply / undo (async cores over a backend) ----------

/// `model` + `thinking` of one schedule row.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ScheduleValue {
    model: String,
    thinking: Option<String>,
}

/// Why one edit did not apply. `Mismatch` is the guarded-write rejection; the core words it
/// per direction, so apply and undo can report different actions.
#[derive(Debug, Clone, PartialEq, Eq)]
enum EditError {
    Mismatch,
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    Forward,
    Undo,
}

impl Direction {
    fn mismatch(self) -> &'static str {
        match self {
            Self::Forward => "当前值已变化，请重新扫描",
            Self::Undo => "当前值已被修改，已跳过",
        }
    }
}

/// Side effects a replace needs beyond plain config files. The production implementation talks
/// to the app (SQLite, app settings, `omp config`); tests plug temp state.
trait ReplaceBackend {
    async fn set_app_setting(
        &self,
        field: SettingField,
        before: &str,
        after: &str,
    ) -> Result<(), EditError>;

    async fn set_schedule(
        &self,
        id: &str,
        before: &ScheduleValue,
        after: &ScheduleValue,
    ) -> Result<(), EditError>;

    /// One guarded read-modify-write of the global `retry.fallbackChains` record: `decide` sees
    /// the freshly read record and returns the accepted chain edits (each a group of changes),
    /// which are then written together once. Err = nothing was written.
    async fn edit_chains<F>(&self, decide: F) -> Result<(), String>
    where
        F: FnOnce(&BTreeMap<String, Vec<String>>) -> Vec<Vec<ChainChange>>;
}

fn validate_model_list(raw: &str) -> Result<(), EditError> {
    if raw.chars().count() > MAX_LIST_CHARS {
        return Err(EditError::Failed(format!(
            "模型值不能超过 {MAX_LIST_CHARS} 字符"
        )));
    }
    roles::validate_value_list(raw)
        .map(|_| ())
        .map_err(EditError::Failed)
}

fn validate_plain(raw: &str, what: &str) -> Result<(), EditError> {
    let invalid = |reason: &str| EditError::Failed(format!("{what}{reason}"));
    if raw.is_empty() || raw != raw.trim() || raw.chars().count() > MAX_PLAIN_CHARS {
        return Err(invalid(&format!(
            "不能为空、不能有首尾空白，且不超过 {MAX_PLAIN_CHARS} 字符"
        )));
    }
    if raw
        .chars()
        .any(|c| c.is_whitespace() || matches!(c, '"' | '\'' | ',' | '\\'))
    {
        return Err(invalid("不能包含空白、引号或逗号"));
    }
    Ok(())
}

/// Validates the value about to be written. Undo skips validation: it restores a value that
/// was already stored in the file when the edit was applied.
fn validate_after(location: &ModelRefLocation, after: &str) -> Result<(), EditError> {
    match location {
        ModelRefLocation::Role { .. } | ModelRefLocation::AgentOverride { .. } => {
            validate_model_list(after)
        }
        ModelRefLocation::AppSetting { .. } | ModelRefLocation::Schedule { .. } => {
            validate_plain(after, "模型值")
        }
    }
}

async fn apply_value_edit<B: ReplaceBackend>(
    backend: &B,
    location: &ModelRefLocation,
    before: &str,
    after: &str,
    thinking_before: Option<&str>,
    thinking_after: Option<&str>,
    direction: Direction,
) -> Result<(), EditError> {
    if direction == Direction::Forward {
        validate_after(location, after)?;
    }
    match location {
        ModelRefLocation::Role {
            scope,
            project_path,
            name,
        } => replace_role(scope, project_path, "modelRoles", name, before, after),
        ModelRefLocation::AgentOverride {
            scope,
            project_path,
            name,
        } => replace_role(
            scope,
            project_path,
            "agentModelOverrides",
            name,
            before,
            after,
        ),
        ModelRefLocation::AppSetting { field } => {
            backend.set_app_setting(*field, before, after).await
        }
        ModelRefLocation::Schedule { id, .. } => {
            backend
                .set_schedule(
                    id,
                    &ScheduleValue {
                        model: before.to_string(),
                        thinking: thinking_before.map(str::to_string),
                    },
                    &ScheduleValue {
                        model: after.to_string(),
                        thinking: thinking_after.map(str::to_string),
                    },
                )
                .await
        }
    }
}

fn replace_role(
    scope: &ModelRefScope,
    project_path: &Option<String>,
    table: &str,
    name: &str,
    before: &str,
    after: &str,
) -> Result<(), EditError> {
    let scope = match scope {
        ModelRefScope::Global => "global",
        ModelRefScope::Project => "project",
    };
    match roles::replace_value(project_path.as_deref(), scope, table, name, before, after) {
        Ok(ReplaceOutcome::Stale) => Err(EditError::Mismatch),
        Ok(_) => Ok(()),
        Err(error) => Err(EditError::Failed(error)),
    }
}

/// Orients one chain edit for the direction being applied (undo swaps before/after).
fn oriented_changes(changes: &[ChainChange], direction: Direction) -> Vec<ChainChange> {
    changes
        .iter()
        .map(|change| match direction {
            Direction::Forward => change.clone(),
            Direction::Undo => ChainChange {
                key: change.key.clone(),
                before: change.after.clone(),
                after: change.before.clone(),
            },
        })
        .collect()
}

/// Verifies every change against `record`. All changes of one edit are checked before any of
/// them is applied, so a partially matching edit is refused as a whole.
fn verify_chain_changes(
    record: &BTreeMap<String, Vec<String>>,
    changes: &[ChainChange],
    direction: Direction,
) -> Result<(), EditError> {
    for change in changes {
        if direction == Direction::Forward {
            validate_plain(&change.key, "回退链键")?;
            for item in change.after.iter().flatten() {
                validate_plain(item, "回退链模型")?;
            }
        }
        let stored = record.get(&change.key);
        let matches = match (&change.before, stored) {
            (None, None) => true,
            (Some(before), Some(stored)) => before == stored,
            _ => false,
        };
        if !matches {
            return Err(EditError::Mismatch);
        }
    }
    Ok(())
}

fn apply_chain_changes(record: &mut BTreeMap<String, Vec<String>>, changes: &[ChainChange]) {
    for change in changes {
        match &change.after {
            Some(after) => {
                record.insert(change.key.clone(), after.clone());
            }
            None => {
                record.remove(&change.key);
            }
        }
    }
}

/// Sync core of `model_replace_apply` / `model_replace_undo`: one result per input edit, in
/// input order. Chain edits share a single read and a single write; if that write fails every
/// chain edit of the call is reported as failed.
async fn run_edits<B: ReplaceBackend>(
    backend: &B,
    edits: &[ModelReplaceEdit],
    direction: Direction,
) -> Vec<ModelReplaceItemResult> {
    let mut results: Vec<ModelReplaceItemResult> = edits
        .iter()
        .map(|edit| ModelReplaceItemResult {
            edit: edit.clone(),
            ok: false,
            error: None,
        })
        .collect();
    for (index, edit) in edits.iter().enumerate() {
        let ModelReplaceEdit::Value {
            location,
            before,
            after,
            thinking_before,
            thinking_after,
        } = edit
        else {
            continue;
        };
        let (before, after, thinking_before, thinking_after) = match direction {
            Direction::Forward => (
                before.as_str(),
                after.as_str(),
                thinking_before.as_deref(),
                thinking_after.as_deref(),
            ),
            Direction::Undo => (
                after.as_str(),
                before.as_str(),
                thinking_after.as_deref(),
                thinking_before.as_deref(),
            ),
        };
        match apply_value_edit(
            backend,
            location,
            before,
            after,
            thinking_before,
            thinking_after,
            direction,
        )
        .await
        {
            Ok(()) => results[index].ok = true,
            Err(EditError::Mismatch) => {
                results[index].error = Some(direction.mismatch().to_string());
            }
            Err(EditError::Failed(message)) => results[index].error = Some(message),
        }
    }
    let chain_indices: Vec<usize> = edits
        .iter()
        .enumerate()
        .filter(|(_, edit)| matches!(edit, ModelReplaceEdit::FallbackChain { .. }))
        .map(|(index, _)| index)
        .collect();
    if !chain_indices.is_empty() {
        let mut applied: Vec<usize> = Vec::new();
        let outcome = backend
            .edit_chains(|current| {
                let mut record = current.clone();
                let mut accepted: Vec<Vec<ChainChange>> = Vec::new();
                for &index in &chain_indices {
                    let ModelReplaceEdit::FallbackChain { changes, .. } = &edits[index] else {
                        continue;
                    };
                    let changes = oriented_changes(changes, direction);
                    if changes.is_empty() {
                        results[index].ok = true;
                        continue;
                    }
                    match verify_chain_changes(&record, &changes, direction) {
                        Ok(()) => {
                            apply_chain_changes(&mut record, &changes);
                            results[index].ok = true;
                            applied.push(index);
                            accepted.push(changes);
                        }
                        Err(EditError::Mismatch) => {
                            results[index].error = Some(direction.mismatch().to_string());
                        }
                        Err(EditError::Failed(message)) => results[index].error = Some(message),
                    }
                }
                accepted
            })
            .await;
        if let Err(error) = outcome {
            // The write never happened: every chain edit that was accepted, or never got
            // looked at (the file could not be read), fails with the writer's error.
            for index in chain_indices {
                let unseen = !results[index].ok && results[index].error.is_none();
                if applied.contains(&index) || unseen {
                    results[index].ok = false;
                    results[index].error = Some(error.clone());
                }
            }
        }
    }
    results
}

// ---------- production backend ----------

struct AppBackend<'a> {
    state: &'a AppState,
}

fn setting_value(settings: &Settings, field: SettingField) -> Option<&str> {
    match field {
        SettingField::NewSessionModel => settings.new_session_model.as_deref(),
        SettingField::SideChatModel => settings.side_chat_model.as_deref(),
        SettingField::DoctorModel => Some(settings.doctor_model.as_str()),
    }
}

fn set_setting_value(settings: &mut Settings, field: SettingField, value: &str) {
    match field {
        SettingField::NewSessionModel => settings.new_session_model = Some(value.to_string()),
        SettingField::SideChatModel => settings.side_chat_model = Some(value.to_string()),
        SettingField::DoctorModel => settings.doctor_model = value.to_string(),
    }
}

/// Guarded schedule write: one `UPDATE` that only matches the previously read `model` /
/// `thinking`, so a concurrent change wins. The `thinking` column is written only when the
/// caller picked a level; otherwise the stored value is kept byte for byte.
fn guarded_schedule_update(
    conn: &Connection,
    id: &str,
    before: &ScheduleValue,
    after: &ScheduleValue,
) -> Result<(), EditError> {
    let stored: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT model, thinking FROM schedules WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| EditError::Failed(format!("读取定时任务失败：{error}")))?;
    let Some((stored_model, stored_thinking)) = stored else {
        return Err(EditError::Mismatch);
    };
    if trimmed(stored_model.as_deref()) != Some(before.model.as_str())
        || trimmed(stored_thinking.as_deref()) != before.thinking.as_deref()
    {
        return Err(EditError::Mismatch);
    }
    // `thinking` is written only when a level was chosen; otherwise the stored value is kept
    // byte for byte (so an unchanged level is never rewritten, whatever its exact form).
    let next_thinking = if after.thinking == before.thinking {
        stored_thinking.clone()
    } else {
        after.thinking.clone()
    };
    let changed = conn
        .execute(
            "UPDATE schedules SET model = ?1, thinking = ?2, updated_at = ?3
             WHERE id = ?4 AND model IS ?5 AND thinking IS ?6",
            rusqlite::params![
                after.model,
                next_thinking,
                crate::schedules::store::now_rfc3339(),
                id,
                stored_model,
                stored_thinking
            ],
        )
        .map_err(|error| EditError::Failed(format!("写入定时任务失败：{error}")))?;
    if changed == 0 {
        return Err(EditError::Mismatch);
    }
    Ok(())
}

impl ReplaceBackend for AppBackend<'_> {
    async fn set_app_setting(
        &self,
        field: SettingField,
        before: &str,
        after: &str,
    ) -> Result<(), EditError> {
        let mut next = self.state.settings.read().clone();
        match setting_value(&next, field) {
            Some(stored) if stored.trim() == before => {}
            _ => return Err(EditError::Mismatch),
        }
        set_setting_value(&mut next, field, after);
        settings::save(self.state, next)
            .await
            .map_err(EditError::Failed)?;
        Ok(())
    }

    async fn set_schedule(
        &self,
        id: &str,
        before: &ScheduleValue,
        after: &ScheduleValue,
    ) -> Result<(), EditError> {
        {
            let conn = self.state.db.lock();
            guarded_schedule_update(&conn, id, before, after)?;
        }
        // The scheduler and the 定时任务 list both read the row fresh; wake them so the new
        // model is picked up by the next run and shown immediately.
        crate::schedules::scheduler::notify_scheduler();
        let _ = self.state.app.emit("schedules:changed", ());
        Ok(())
    }

    async fn edit_chains<F>(&self, decide: F) -> Result<(), String>
    where
        F: FnOnce(&BTreeMap<String, Vec<String>>) -> Vec<Vec<ChainChange>>,
    {
        roles::edit_chains(|current| {
            decide(current)
                .into_iter()
                .map(|changes| {
                    changes
                        .into_iter()
                        .map(|change| roles::ChainStep {
                            key: change.key,
                            before: change.before,
                            after: change.after,
                        })
                        .collect()
                })
                .collect()
        })
    }
}

// ---------- record store ----------

fn db_error(error: rusqlite::Error) -> String {
    format!("读写替换记录失败：{error}")
}

fn parse_edits(raw: &str) -> Result<Vec<ModelReplaceEdit>, String> {
    serde_json::from_str(raw).map_err(|error| format!("替换记录无法解析：{error}"))
}

fn insert_record(conn: &Connection, record: &ModelReplaceRecord) -> Result<(), String> {
    let edits = serde_json::to_string(&record.edits)
        .map_err(|error| format!("替换记录序列化失败：{error}"))?;
    conn.execute(
        "INSERT INTO model_replace_log(id, created_at, from_model, to_model, edits, undone_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            record.id,
            record.created_at,
            record.from_model,
            record.to_model,
            edits,
            record.undone_at
        ],
    )
    .map_err(db_error)?;
    Ok(())
}

/// Appends edits to an existing record. `Ok(false)` = no such record (the caller creates it).
fn append_record_edits(
    conn: &Connection,
    id: &str,
    edits: &[ModelReplaceEdit],
) -> Result<bool, String> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT edits FROM model_replace_log WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    let Some(stored) = stored else {
        return Ok(false);
    };
    let mut current = parse_edits(&stored)?;
    current.extend_from_slice(edits);
    let json =
        serde_json::to_string(&current).map_err(|error| format!("替换记录序列化失败：{error}"))?;
    conn.execute(
        "UPDATE model_replace_log SET edits = ?1 WHERE id = ?2",
        rusqlite::params![json, id],
    )
    .map_err(db_error)?;
    Ok(true)
}

/// Keeps the newest [`RECORD_LIMIT`] records; `keep` survives even when it is older.
fn prune_records(conn: &Connection, keep: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM model_replace_log
         WHERE id <> ?1 AND id NOT IN (
           SELECT id FROM model_replace_log ORDER BY created_at DESC, rowid DESC LIMIT ?2
         )",
        rusqlite::params![keep, RECORD_LIMIT],
    )
    .map_err(db_error)?;
    Ok(())
}

fn list_records(conn: &Connection) -> Result<Vec<ModelReplaceRecord>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, created_at, from_model, to_model, edits, undone_at
             FROM model_replace_log ORDER BY created_at DESC, rowid DESC",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(db_error)?;
    let mut records = Vec::new();
    for row in rows {
        let (id, created_at, from_model, to_model, edits, undone_at) = row.map_err(db_error)?;
        records.push(ModelReplaceRecord {
            id,
            created_at,
            from_model,
            to_model,
            edits: parse_edits(&edits)?,
            undone_at,
        });
    }
    Ok(records)
}

fn get_record(conn: &Connection, id: &str) -> Result<Option<ModelReplaceRecord>, String> {
    Ok(list_records(conn)?
        .into_iter()
        .find(|record| record.id == id))
}

fn mark_undone(conn: &Connection, id: &str, at: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE model_replace_log SET undone_at = ?1 WHERE id = ?2",
        rusqlite::params![at, id],
    )
    .map_err(db_error)?;
    Ok(())
}

/// Stores the successful edits (new record, or an append that creates the row when it is gone)
/// and prunes old records.
fn persist_results(
    state: &AppState,
    from_model: &str,
    to_model: &str,
    results: &[ModelReplaceItemResult],
    record_id: Option<&str>,
) -> Result<ModelReplaceResult, String> {
    let succeeded: Vec<ModelReplaceEdit> = results
        .iter()
        .filter(|result| result.ok)
        .map(|result| result.edit.clone())
        .collect();
    if succeeded.is_empty() {
        return Ok(ModelReplaceResult {
            record_id: record_id.map(str::to_string),
            results: results.to_vec(),
        });
    }
    let id = match record_id {
        Some(id) => id.to_string(),
        None => uuid::Uuid::new_v4().to_string(),
    };
    let conn = state.db.lock();
    if !append_record_edits(&conn, &id, &succeeded)? {
        insert_record(
            &conn,
            &ModelReplaceRecord {
                id: id.clone(),
                created_at: chrono::Utc::now().to_rfc3339(),
                from_model: from_model.to_string(),
                to_model: to_model.to_string(),
                edits: succeeded,
                undone_at: None,
            },
        )?;
    }
    prune_records(&conn, &id)?;
    Ok(ModelReplaceResult {
        record_id: Some(id),
        results: results.to_vec(),
    })
}

// ---------- workspace + schedule reads ----------

fn list_project_workspaces(conn: &Connection) -> Result<Vec<WorkspacePath>, String> {
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
        workspaces.push(WorkspacePath { path, name });
    }
    Ok(workspaces)
}

// ---------- commands ----------

/// Every stored model reference plus the scan status of each location.
#[tauri::command]
pub async fn model_usage_scan(state: tauri::State<'_, AppState>) -> Result<ModelUsageScan, String> {
    let (workspaces, schedules) = {
        let conn = state.db.lock();
        (
            list_project_workspaces(&conn)?,
            crate::schedules::store::list(&conn)
                .map_err(|error| format!("读取定时任务失败：{error}"))?,
        )
    };
    let settings = state.settings.read().clone();
    let global_config = roles::global_config_file()?;
    let (chains, chains_error) = match roles::read_chains() {
        Ok(chains) => (FallbackChainsSnapshot { chains }, None),
        Err(error) => (FallbackChainsSnapshot::default(), Some(error)),
    };
    Ok(scan_model_usage(ScanInput {
        global_config,
        workspaces,
        settings,
        schedules,
        chains,
        chains_error,
    }))
}

/// Applies one X→Y replacement. `record_id` appends to an existing record (retry).
#[tauri::command]
pub async fn model_replace_apply(
    state: tauri::State<'_, AppState>,
    from_model: String,
    to_model: String,
    edits: Vec<ModelReplaceEdit>,
    record_id: Option<String>,
) -> Result<ModelReplaceResult, String> {
    let backend = AppBackend {
        state: state.inner(),
    };
    let results = run_edits(&backend, &edits, Direction::Forward).await;
    persist_results(
        state.inner(),
        &from_model,
        &to_model,
        &results,
        record_id.as_deref(),
    )
}

/// Newest-first replace history.
#[tauri::command]
pub async fn model_replace_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ModelReplaceRecord>, String> {
    let conn = state.db.lock();
    list_records(&conn)
}

/// Replays a stored record inverted; edits whose value changed since are skipped.
/// The returned results describe the stored edits, not their inverse.
#[tauri::command]
pub async fn model_replace_undo(
    state: tauri::State<'_, AppState>,
    record_id: String,
) -> Result<ModelReplaceResult, String> {
    let record = {
        let conn = state.db.lock();
        get_record(&conn, &record_id)?.ok_or_else(|| "未找到该替换记录".to_string())?
    };
    let backend = AppBackend {
        state: state.inner(),
    };
    let results = run_edits(&backend, &record.edits, Direction::Undo).await;
    if results.iter().any(|result| result.ok) {
        let conn = state.db.lock();
        mark_undone(&conn, &record_id, &crate::schedules::store::now_rfc3339())?;
    }
    Ok(ModelReplaceResult {
        record_id: Some(record_id),
        results,
    })
}

/// One-shot probe of one model through `omp -p`, so 「测试」 reflects a real call.
#[tauri::command]
pub async fn model_probe(
    state: tauri::State<'_, AppState>,
    model: String,
) -> Result<ModelProbeResult, String> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("请先选择要测试的模型".to_string());
    }
    let started = Instant::now();
    let outcome = run_probe(state.inner(), &model).await;
    let latency_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    Ok(match outcome {
        Ok(output) => ModelProbeResult {
            ok: true,
            latency_ms,
            detail: format!("{}（{PROBE_NOTE}）", probe_summary(&output)),
        },
        Err(error) => ModelProbeResult {
            ok: false,
            latency_ms,
            detail: format!("{error}（{PROBE_NOTE}）"),
        },
    })
}

fn probe_summary(output: &str) -> String {
    let line = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    line.chars().take(160).collect()
}

/// Writes the probe overlay and returns its path.
fn probe_overlay() -> Result<PathBuf, String> {
    let dir = crate::paths::data_dir();
    let path = dir.join("omp-probe.yml");
    if std::fs::read_to_string(&path).ok().as_deref() == Some(PROBE_OVERLAY) {
        return Ok(path);
    }
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建数据目录：{error}"))?;
    std::fs::write(&path, PROBE_OVERLAY).map_err(|error| format!("无法写入探针配置：{error}"))?;
    Ok(path)
}

/// Real one-shot call. Mirrors `todos::omp::run_print` (`--no-tools --no-session`) and adds the
/// [`PROBE_OVERLAY`] `--config` overlay, which `run_print` has no way to pass; without it a
/// `retry.fallbackChains` member could answer for a dead model.
async fn run_probe(state: &AppState, model: &str) -> Result<String, String> {
    crate::todos::omp::init_login_path().await;
    let bin = state.settings.read().omp_binary.clone();
    let path = crate::todos::omp::augmented_path();
    let exe = crate::todos::omp::resolve_binary(&bin, &path);
    let overlay = probe_overlay()?;
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(["-p", "--no-tools", "--no-session", "--no-title"]);
    cmd.args(crate::todos::omp::lightweight_args());
    cmd.arg("--config").arg(&overlay);
    if let Some(extension) = crate::providers::try_extension_path() {
        cmd.arg("-e").arg(extension);
    }
    cmd.arg("--model")
        .arg(crate::todos::omp::normalize_model_selector(model));
    cmd.current_dir(crate::paths::oneshot_dir())
        .env("PATH", path)
        .envs(crate::providers::omp_spawn_env())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("无法启动 {}：{error}", exe.display()))?;
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt as _;
        stdin
            .write_all(PROBE_PROMPT.as_bytes())
            .await
            .map_err(|error| format!("写入提示词失败：{error}"))?;
        drop(stdin);
    }
    let output = tokio::time::timeout(PROBE_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "omp 测试超时".to_string())?
        .map_err(|error| format!("omp 执行失败：{error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .chars()
            .rev()
            .take(400)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return Err(format!("omp 退出（{}）：{}", output.status, tail.trim()));
    }
    if stdout.is_empty() {
        return Err("omp 没有返回内容".to_string());
    }
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use std::cell::Cell;

    // ---- fixtures ----

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ompws-model-replace-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    fn project_config(dir: &Path) -> PathBuf {
        dir.join(".omp").join("config.yml")
    }

    fn role_location(dir: &Path, name: &str) -> ModelRefLocation {
        ModelRefLocation::Role {
            scope: ModelRefScope::Project,
            project_path: Some(path_text(dir)),
            name: name.to_string(),
        }
    }

    fn override_location(dir: &Path, name: &str) -> ModelRefLocation {
        ModelRefLocation::AgentOverride {
            scope: ModelRefScope::Project,
            project_path: Some(path_text(dir)),
            name: name.to_string(),
        }
    }

    fn value_edit(location: ModelRefLocation, before: &str, after: &str) -> ModelReplaceEdit {
        ModelReplaceEdit::Value {
            location,
            before: before.to_string(),
            after: after.to_string(),
            thinking_before: None,
            thinking_after: None,
        }
    }

    fn schedule_edit(
        id: &str,
        before: &str,
        after: &str,
        thinking_before: Option<&str>,
        thinking_after: Option<&str>,
    ) -> ModelReplaceEdit {
        ModelReplaceEdit::Value {
            location: ModelRefLocation::Schedule {
                id: id.to_string(),
                name: "任务".to_string(),
            },
            before: before.to_string(),
            after: after.to_string(),
            thinking_before: thinking_before.map(str::to_string),
            thinking_after: thinking_after.map(str::to_string),
        }
    }

    /// Records every backend call so tests can assert what a batch did.
    #[derive(Default)]
    struct TempBackend {
        new_session_model: Mutex<Option<String>>,
        side_chat_model: Mutex<Option<String>>,
        doctor_model: Mutex<String>,
        schedules: Mutex<BTreeMap<String, ScheduleValue>>,
        chains: Mutex<BTreeMap<String, Vec<String>>>,
        chain_writes: Cell<usize>,
        chain_write_error: Option<String>,
    }

    impl TempBackend {
        fn with_chains(chains: &[(&str, &[&str])]) -> Self {
            let backend = Self::default();
            {
                let mut store = backend.chains.lock();
                for (key, items) in chains {
                    store.insert(
                        (*key).to_string(),
                        items.iter().map(|item| (*item).to_string()).collect(),
                    );
                }
            }
            backend
        }

        fn chains(&self) -> BTreeMap<String, Vec<String>> {
            self.chains.lock().clone()
        }
    }

    impl ReplaceBackend for TempBackend {
        async fn set_app_setting(
            &self,
            field: SettingField,
            before: &str,
            after: &str,
        ) -> Result<(), EditError> {
            match field {
                SettingField::DoctorModel => {
                    let mut stored = self.doctor_model.lock();
                    if stored.trim() != before {
                        return Err(EditError::Mismatch);
                    }
                    *stored = after.to_string();
                }
                SettingField::NewSessionModel | SettingField::SideChatModel => {
                    let slot = if field == SettingField::NewSessionModel {
                        &self.new_session_model
                    } else {
                        &self.side_chat_model
                    };
                    let mut stored = slot.lock();
                    if stored.as_deref().map(str::trim) != Some(before) {
                        return Err(EditError::Mismatch);
                    }
                    *stored = Some(after.to_string());
                }
            }
            Ok(())
        }

        async fn set_schedule(
            &self,
            id: &str,
            before: &ScheduleValue,
            after: &ScheduleValue,
        ) -> Result<(), EditError> {
            let mut schedules = self.schedules.lock();
            let Some(stored) = schedules.get_mut(id) else {
                return Err(EditError::Mismatch);
            };
            if *stored != *before {
                return Err(EditError::Mismatch);
            }
            *stored = after.clone();
            Ok(())
        }

        async fn edit_chains<F>(&self, decide: F) -> Result<(), String>
        where
            F: FnOnce(&BTreeMap<String, Vec<String>>) -> Vec<Vec<ChainChange>>,
        {
            let mut record = self.chains();
            let edits = decide(&record);
            if edits.is_empty() {
                return Ok(());
            }
            self.chain_writes.set(self.chain_writes.get() + 1);
            if let Some(error) = &self.chain_write_error {
                return Err(error.clone());
            }
            for changes in &edits {
                apply_chain_changes(&mut record, changes);
            }
            *self.chains.lock() = record;
            Ok(())
        }
    }

    fn schedule_value(model: &str, thinking: Option<&str>) -> ScheduleValue {
        ScheduleValue {
            model: model.to_string(),
            thinking: thinking.map(str::to_string),
        }
    }

    // ---- value edits ----

    #[tokio::test]
    async fn model_replace_value_edit_rejected_when_current_differs() {
        let dir = temp_dir("stale-value");
        let config = project_config(&dir);
        let original = "modelRoles:\n  web: \"web/tavily\"\n";
        write(&config, original);
        let backend = TempBackend::default();
        let stale = value_edit(role_location(&dir, "web"), "web/exa", "web/brave");
        let results = run_edits(&backend, std::slice::from_ref(&stale), Direction::Forward).await;
        assert!(!results[0].ok);
        assert_eq!(
            results[0].error.as_deref(),
            Some("当前值已变化，请重新扫描")
        );
        assert_eq!(read(&config), original, "file must stay untouched");
        // The same edit with the stored value applies.
        let fresh = value_edit(role_location(&dir, "web"), "web/tavily", "web/brave");
        let results = run_edits(&backend, std::slice::from_ref(&fresh), Direction::Forward).await;
        assert!(results[0].ok, "{:?}", results[0].error);
        assert!(read(&config).contains("web/brave"));
    }

    #[tokio::test]
    async fn model_replace_role_edit_round_trip_restores_bytes() {
        let dir = temp_dir("round-trip");
        let config = project_config(&dir);
        let original = concat!(
            "# 我的模型角色\n",
            "modelRoles:\n",
            "  default: \"openai/gpt-5\"\n",
            "  web: \"web/exa:high\"  # 搜索\n",
            "\n",
            "task:\n",
            "  agentModelOverrides:\n",
            "    Explore: \"web/tavily,web/exa\"\n",
        );
        write(&config, original);
        let backend = TempBackend::default();
        let edits = vec![
            value_edit(role_location(&dir, "web"), "web/exa:high", "web/brave:high"),
            value_edit(
                override_location(&dir, "Explore"),
                "web/tavily,web/exa",
                "web/tavily,web/jina",
            ),
        ];
        let results = run_edits(&backend, &edits, Direction::Forward).await;
        assert!(results.iter().all(|result| result.ok), "{results:?}");
        let applied = read(&config);
        assert!(applied.contains("web/brave:high"));
        assert!(applied.contains("\"web/tavily,web/jina\""));
        assert!(applied.contains("# 我的模型角色"));
        let results = run_edits(&backend, &edits, Direction::Undo).await;
        assert!(results.iter().all(|result| result.ok), "{results:?}");
        assert_eq!(read(&config), original);
    }

    #[tokio::test]
    async fn model_replace_undo_skips_value_changed_after_apply() {
        let dir = temp_dir("undo-stale");
        let config = project_config(&dir);
        write(&config, "modelRoles:\n  web: \"web/exa\"\n");
        let backend = TempBackend::default();
        let edit = value_edit(role_location(&dir, "web"), "web/exa", "web/brave");
        let results = run_edits(&backend, std::slice::from_ref(&edit), Direction::Forward).await;
        assert!(results[0].ok, "{:?}", results[0].error);
        // The user edits the same entry before undoing.
        write(&config, "modelRoles:\n  web: \"web/jina\"\n");
        let results = run_edits(&backend, std::slice::from_ref(&edit), Direction::Undo).await;
        assert!(!results[0].ok);
        assert_eq!(results[0].error.as_deref(), Some("当前值已被修改，已跳过"));
        assert_eq!(read(&config), "modelRoles:\n  web: \"web/jina\"\n");
    }

    #[tokio::test]
    async fn model_replace_app_setting_edit_guards_current_value() {
        let backend = TempBackend::default();
        *backend.doctor_model.lock() = "smol".to_string();
        let edit = value_edit(
            ModelRefLocation::AppSetting {
                field: SettingField::DoctorModel,
            },
            "smol",
            "openai/gpt-5",
        );
        let stale = value_edit(
            ModelRefLocation::AppSetting {
                field: SettingField::NewSessionModel,
            },
            "smol",
            "openai/gpt-5",
        );
        let results = run_edits(&backend, &[edit.clone(), stale], Direction::Forward).await;
        assert!(results[0].ok, "{:?}", results[0].error);
        assert!(!results[1].ok, "an unset setting must not match a value");
        assert_eq!(backend.doctor_model.lock().as_str(), "openai/gpt-5");
        let results = run_edits(&backend, std::slice::from_ref(&edit), Direction::Undo).await;
        assert!(results[0].ok, "{:?}", results[0].error);
        assert_eq!(backend.doctor_model.lock().as_str(), "smol");
        assert!(backend.new_session_model.lock().is_none());
    }

    #[tokio::test]
    async fn model_replace_rejects_invalid_values() {
        let dir = temp_dir("invalid");
        let config = project_config(&dir);
        write(&config, "modelRoles:\n  web: \"web/exa\"\n");
        let backend = TempBackend::default();
        for after in ["has space", "web/exa,", "", "@smol;x"] {
            let edit = value_edit(role_location(&dir, "web"), "web/exa", after);
            let results =
                run_edits(&backend, std::slice::from_ref(&edit), Direction::Forward).await;
            assert!(!results[0].ok, "{after} should be refused");
            assert!(results[0].error.is_some());
        }
        assert_eq!(read(&config), "modelRoles:\n  web: \"web/exa\"\n");
    }

    // ---- schedules ----

    fn schedule_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO schedules(id, name, prompt, cwd, cadence, model, thinking, created_at, updated_at)
             VALUES('s1', '任务', 'p', '/tmp', '{}', 'web/exa', 'high', 't', 't')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO schedules(id, name, prompt, cwd, cadence, model, thinking, created_at, updated_at)
             VALUES('s2', '无层级', 'p', '/tmp', '{}', 'web/exa', NULL, 't', 't')",
            [],
        )
        .unwrap();
        conn
    }

    fn schedule_row(conn: &Connection, id: &str) -> (Option<String>, Option<String>) {
        conn.query_row(
            "SELECT model, thinking FROM schedules WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn model_replace_schedule_thinking_untouched_when_unchanged() {
        let conn = schedule_conn();
        let before = schedule_value("web/exa", Some("high"));
        let after = schedule_value("web/brave", Some("high"));
        guarded_schedule_update(&conn, "s1", &before, &after).unwrap();
        assert_eq!(
            schedule_row(&conn, "s1"),
            (Some("web/brave".to_string()), Some("high".to_string()))
        );
        // The same `before` is refused now, and nothing moves.
        assert_eq!(
            guarded_schedule_update(&conn, "s1", &before, &after).unwrap_err(),
            EditError::Mismatch
        );
        assert_eq!(
            schedule_row(&conn, "s1"),
            (Some("web/brave".to_string()), Some("high".to_string()))
        );
        // A chosen level is written; picking one when there was none sets the column.
        guarded_schedule_update(
            &conn,
            "s2",
            &schedule_value("web/exa", None),
            &schedule_value("web/brave", Some("low")),
        )
        .unwrap();
        assert_eq!(
            schedule_row(&conn, "s2"),
            (Some("web/brave".to_string()), Some("low".to_string()))
        );
        guarded_schedule_update(
            &conn,
            "s2",
            &schedule_value("web/brave", Some("low")),
            &schedule_value("web/exa", None),
        )
        .unwrap();
        assert_eq!(
            schedule_row(&conn, "s2"),
            (Some("web/exa".to_string()), None)
        );
        assert_eq!(
            guarded_schedule_update(&conn, "missing", &before, &after).unwrap_err(),
            EditError::Mismatch
        );
    }

    #[tokio::test]
    async fn model_replace_schedule_edit_swaps_thinking_on_undo() {
        let backend = TempBackend::default();
        backend
            .schedules
            .lock()
            .insert("s1".to_string(), schedule_value("web/exa", None));
        let edit = schedule_edit("s1", "web/exa", "web/brave", None, Some("high"));
        let results = run_edits(&backend, std::slice::from_ref(&edit), Direction::Forward).await;
        assert!(results[0].ok, "{:?}", results[0].error);
        assert_eq!(
            backend.schedules.lock().get("s1").unwrap(),
            &schedule_value("web/brave", Some("high"))
        );
        let results = run_edits(&backend, std::slice::from_ref(&edit), Direction::Undo).await;
        assert!(results[0].ok, "{:?}", results[0].error);
        assert_eq!(
            backend.schedules.lock().get("s1").unwrap(),
            &schedule_value("web/exa", None)
        );
    }

    // ---- fallback chains ----

    fn chain_edit(label: &str, changes: Vec<ChainChange>) -> ModelReplaceEdit {
        ModelReplaceEdit::FallbackChain {
            label: label.to_string(),
            changes,
        }
    }

    #[tokio::test]
    async fn model_replace_chain_rename_merge_and_items_share_one_write() {
        let backend =
            TempBackend::with_chains(&[("default", &["web/exa"]), ("smol", &["@default"])]);
        let rename = chain_edit(
            "smol",
            vec![
                ChainChange {
                    key: "default".to_string(),
                    before: Some(vec!["web/exa".to_string()]),
                    after: Some(vec!["web/exa".to_string(), "@smol".to_string()]),
                },
                ChainChange {
                    key: "smol".to_string(),
                    before: Some(vec!["@default".to_string()]),
                    after: None,
                },
            ],
        );
        // The second edit sees the record as the first edit left it.
        let items = chain_edit(
            "default",
            vec![ChainChange {
                key: "default".to_string(),
                before: Some(vec!["web/exa".to_string(), "@smol".to_string()]),
                after: Some(vec!["web/brave".to_string(), "@smol".to_string()]),
            }],
        );
        let results = run_edits(&backend, &[rename, items], Direction::Forward).await;
        assert!(results.iter().all(|result| result.ok), "{results:?}");
        assert_eq!(backend.chain_writes.get(), 1);
        assert_eq!(
            backend.chains().get("default").unwrap(),
            &vec!["web/brave".to_string(), "@smol".to_string()]
        );
        assert!(!backend.chains().contains_key("smol"));
    }

    #[tokio::test]
    async fn model_replace_chain_before_mismatch_fails_only_that_edit() {
        let backend = TempBackend::with_chains(&[("default", &["web/exa"])]);
        let good = chain_edit(
            "default",
            vec![ChainChange {
                key: "default".to_string(),
                before: Some(vec!["web/exa".to_string()]),
                after: Some(vec!["web/brave".to_string()]),
            }],
        );
        let wrong_items = chain_edit(
            "default",
            vec![ChainChange {
                key: "default".to_string(),
                before: Some(vec!["web/does-not-exist".to_string()]),
                after: Some(vec!["web/other".to_string()]),
            }],
        );
        let absent_key = chain_edit(
            "smol",
            vec![ChainChange {
                key: "smol".to_string(),
                before: Some(vec!["@default".to_string()]),
                after: None,
            }],
        );
        let results = run_edits(
            &backend,
            &[good, wrong_items, absent_key],
            Direction::Forward,
        )
        .await;
        assert!(results[0].ok, "{:?}", results[0].error);
        assert!(!results[1].ok);
        assert_eq!(
            results[1].error.as_deref(),
            Some("当前值已变化，请重新扫描")
        );
        assert!(!results[2].ok, "before=Some on an absent key must fail");
        // Only the verified edit was applied.
        assert_eq!(
            backend.chains().get("default").unwrap(),
            &vec!["web/brave".to_string()]
        );
    }

    #[tokio::test]
    async fn model_replace_chain_write_failure_fails_every_chain_edit() {
        let backend = TempBackend {
            chain_write_error: Some("未找到 OMP 命令行程序".to_string()),
            ..TempBackend::with_chains(&[("default", &["web/exa"])])
        };
        let edit = chain_edit(
            "default",
            vec![ChainChange {
                key: "default".to_string(),
                before: Some(vec!["web/exa".to_string()]),
                after: Some(vec!["web/brave".to_string()]),
            }],
        );
        let results = run_edits(&backend, std::slice::from_ref(&edit), Direction::Forward).await;
        assert!(!results[0].ok);
        assert_eq!(results[0].error.as_deref(), Some("未找到 OMP 命令行程序"));
        assert_eq!(backend.chain_writes.get(), 1);
        assert_eq!(
            backend.chains().get("default").unwrap(),
            &vec!["web/exa".to_string()]
        );
    }

    // ---- records ----

    fn record(id: &str, created_at: &str) -> ModelReplaceRecord {
        ModelReplaceRecord {
            id: id.to_string(),
            created_at: created_at.to_string(),
            from_model: "web/exa".to_string(),
            to_model: "web/brave".to_string(),
            edits: vec![schedule_edit("s1", "web/exa", "web/brave", None, None)],
            undone_at: None,
        }
    }

    #[test]
    fn model_replace_history_is_pruned_to_ten() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        for index in 0..11 {
            let record = record(
                &format!("r{index}"),
                &format!("2026-01-{:02}T00:00:00+00:00", index + 1),
            );
            insert_record(&conn, &record).unwrap();
            prune_records(&conn, &record.id).unwrap();
        }
        let records = list_records(&conn).unwrap();
        assert_eq!(records.len(), RECORD_LIMIT as usize);
        assert_eq!(records[0].id, "r10");
        assert_eq!(records[9].id, "r1");
        // Retry appends to the stored record, and undo stamps it.
        let extra = value_edit(
            ModelRefLocation::AppSetting {
                field: SettingField::DoctorModel,
            },
            "smol",
            "web/brave",
        );
        assert!(append_record_edits(&conn, "r10", std::slice::from_ref(&extra)).unwrap());
        let stored = get_record(&conn, "r10").unwrap().unwrap();
        assert_eq!(stored.edits.len(), 2);
        assert_eq!(stored.edits[1], extra);
        assert!(stored.undone_at.is_none());
        mark_undone(&conn, "r10", "2026-02-01T00:00:00+00:00").unwrap();
        assert_eq!(
            get_record(&conn, "r10")
                .unwrap()
                .unwrap()
                .undone_at
                .as_deref(),
            Some("2026-02-01T00:00:00+00:00")
        );
        assert!(!append_record_edits(&conn, "missing", std::slice::from_ref(&extra)).unwrap());
    }

    // ---- scan ----

    fn schedule_rows() -> Vec<Schedule> {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO schedules(id, name, prompt, cwd, cadence, model, thinking, created_at, updated_at)
             VALUES('s1', '任务', 'p', '/tmp', '{}', 'web/exa', 'high', 't', 't')",
            [],
        )
        .unwrap();
        vec![crate::schedules::store::get(&conn, "s1").unwrap().unwrap()]
    }

    #[test]
    fn model_replace_scan_reports_broken_projects_without_failing() {
        let root = temp_dir("scan");
        let global = root.join("agent").join("config.yml");
        write(
            &global,
            "modelRoles:\n  web: \"web/exa\"\ntask:\n  agentModelOverrides:\n    Explore: \"web/tavily\"\n",
        );
        let ok_dir = root.join("ok");
        write(
            &project_config(&ok_dir),
            "modelRoles:\n  web: \"web/brave,web/exa:high\"\n",
        );
        let broken_dir = root.join("broken");
        write(&project_config(&broken_dir), "modelRoles: [oops\n");
        let missing_dir = root.join("missing");
        let settings = Settings {
            new_session_model: Some("openai/gpt-5".to_string()),
            side_chat_model: None,
            doctor_model: "smol".to_string(),
            ..Settings::default()
        };
        let scan = scan_model_usage(ScanInput {
            global_config: global,
            workspaces: vec![
                WorkspacePath {
                    path: path_text(&ok_dir),
                    name: "ok".to_string(),
                },
                WorkspacePath {
                    path: path_text(&broken_dir),
                    name: "broken".to_string(),
                },
                WorkspacePath {
                    path: path_text(&missing_dir),
                    name: "missing".to_string(),
                },
            ],
            settings,
            schedules: schedule_rows(),
            chains: FallbackChainsSnapshot {
                chains: BTreeMap::from([("default".to_string(), vec!["web/exa".to_string()])]),
            },
            chains_error: None,
        });

        let has = |predicate: &dyn Fn(&ModelUsageRef) -> bool| scan.refs.iter().any(predicate);
        assert!(has(&|reference| matches!(
            &reference.location,
            ModelRefLocation::Role { scope: ModelRefScope::Global, project_path: None, name } if name == "web"
        ) && reference.value == "web/exa"));
        assert!(has(&|reference| matches!(
            &reference.location,
            ModelRefLocation::AgentOverride { name, .. } if name == "Explore"
        )));
        assert!(has(&|reference| matches!(
            &reference.location,
            ModelRefLocation::Role { project_path: Some(path), name, .. }
                if name == "web" && path == &path_text(&ok_dir)
        ) && reference.value
            == "web/brave,web/exa:high"));
        assert!(has(&|reference| matches!(
            &reference.location,
            ModelRefLocation::AppSetting {
                field: SettingField::NewSessionModel
            }
        )));
        assert!(has(&|reference| matches!(
            &reference.location,
            ModelRefLocation::AppSetting {
                field: SettingField::DoctorModel
            }
        )));
        assert!(has(&|reference| matches!(
            &reference.location,
            ModelRefLocation::Schedule { id, .. } if id == "s1"
        ) && reference.thinking.as_deref()
            == Some("high")));
        // The unreadable project contributes no refs but is reported.
        assert!(!has(&|reference| matches!(
            &reference.location,
            ModelRefLocation::Role { project_path: Some(path), .. } if path == &path_text(&broken_dir)
        )));
        let project = |path: &Path| {
            scan.projects
                .iter()
                .find(|project| project.path == path_text(path))
                .cloned()
                .unwrap()
        };
        assert_eq!(project(&ok_dir).status, ProjectStatus::Ok);
        let broken = project(&broken_dir);
        assert_eq!(broken.status, ProjectStatus::Error);
        assert!(broken.error.is_some());
        let missing = project(&missing_dir);
        assert_eq!(missing.status, ProjectStatus::Missing);
        assert!(missing.error.is_some());
        assert_eq!(
            scan.fallback_chains.chains.get("default").unwrap(),
            &vec!["web/exa".to_string()]
        );
        assert!(scan.fallback_chains_error.is_none());
    }

    #[test]
    fn model_replace_scan_reports_global_layer_that_fails_to_parse() {
        let root = temp_dir("scan-global");
        let global = root.join("agent").join("config.yml");
        write(&global, "modelRoles: [oops\n");
        let scan = scan_model_usage(ScanInput {
            global_config: global.clone(),
            workspaces: Vec::new(),
            settings: Settings {
                doctor_model: String::new(),
                ..Settings::default()
            },
            schedules: Vec::new(),
            chains: FallbackChainsSnapshot::default(),
            chains_error: Some("未找到 OMP 命令行程序".to_string()),
        });
        assert!(scan.refs.is_empty());
        assert_eq!(scan.projects.len(), 1);
        assert_eq!(scan.projects[0].name, GLOBAL_LABEL);
        assert_eq!(scan.projects[0].status, ProjectStatus::Error);
        assert_eq!(
            scan.fallback_chains_error.as_deref(),
            Some("未找到 OMP 命令行程序")
        );
    }

    // ---- probe ----

    /// Locks the serialized shape to the IPC contract (`src/lib/contracts.ts`).
    #[test]
    fn model_replace_wire_shape_matches_contract() {
        let role = ModelRefLocation::Role {
            scope: ModelRefScope::Global,
            project_path: None,
            name: "web".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&role).unwrap(),
            serde_json::json!({
                "kind": "role", "scope": "global", "projectPath": null, "name": "web",
            })
        );
        assert_eq!(
            serde_json::to_value(ModelRefLocation::AppSetting {
                field: SettingField::NewSessionModel
            })
            .unwrap(),
            serde_json::json!({ "kind": "appSetting", "field": "newSessionModel" })
        );
        assert_eq!(
            serde_json::to_value(ModelRefLocation::Schedule {
                id: "s1".to_string(),
                name: "任务".to_string(),
            })
            .unwrap(),
            serde_json::json!({ "kind": "schedule", "id": "s1", "name": "任务" })
        );

        let value_edit = ModelReplaceEdit::Value {
            location: ModelRefLocation::AgentOverride {
                scope: ModelRefScope::Project,
                project_path: Some("/repo".to_string()),
                name: "Explore".to_string(),
            },
            before: "web/exa".to_string(),
            after: "web/brave".to_string(),
            thinking_before: None,
            thinking_after: None,
        };
        let value_json = serde_json::json!({
            "kind": "value",
            "location": {
                "kind": "agentOverride", "scope": "project",
                "projectPath": "/repo", "name": "Explore",
            },
            "before": "web/exa",
            "after": "web/brave",
            "thinkingBefore": null,
            "thinkingAfter": null,
        });
        assert_eq!(serde_json::to_value(&value_edit).unwrap(), value_json);
        assert_eq!(
            serde_json::from_value::<ModelReplaceEdit>(value_json).unwrap(),
            value_edit
        );
        // Undo and retry send back what the backend returned.
        let chain_edit = ModelReplaceEdit::FallbackChain {
            label: "smol".to_string(),
            changes: vec![ChainChange {
                key: "smol".to_string(),
                before: Some(vec!["@default".to_string()]),
                after: None,
            }],
        };
        assert_eq!(
            serde_json::to_value(&chain_edit).unwrap(),
            serde_json::json!({
                "kind": "fallbackChain",
                "label": "smol",
                "changes": [{ "key": "smol", "before": ["@default"], "after": null }],
            })
        );

        let scan = ModelUsageScan {
            refs: vec![ModelUsageRef {
                location: role,
                value: "web/exa".to_string(),
                thinking: None,
            }],
            fallback_chains: FallbackChainsSnapshot::default(),
            fallback_chains_error: None,
            projects: vec![ScannedProject {
                path: "/repo".to_string(),
                name: "repo".to_string(),
                status: ProjectStatus::Missing,
                error: Some("项目目录不存在".to_string()),
            }],
        };
        assert_eq!(
            serde_json::to_value(&scan).unwrap(),
            serde_json::json!({
                "refs": [{
                    "location": {
                        "kind": "role", "scope": "global", "projectPath": null, "name": "web",
                    },
                    "value": "web/exa",
                    "thinking": null,
                }],
                "fallbackChains": { "chains": {} },
                "fallbackChainsError": null,
                "projects": [{
                    "path": "/repo", "name": "repo", "status": "missing",
                    "error": "项目目录不存在",
                }],
            })
        );
        assert_eq!(
            serde_json::to_value(ModelReplaceRecord {
                id: "r1".to_string(),
                created_at: "2026-01-01T00:00:00+00:00".to_string(),
                from_model: "web/exa".to_string(),
                to_model: "web/brave".to_string(),
                edits: vec![chain_edit.clone()],
                undone_at: None,
            })
            .unwrap(),
            serde_json::json!({
                "id": "r1",
                "createdAt": "2026-01-01T00:00:00+00:00",
                "fromModel": "web/exa",
                "toModel": "web/brave",
                "edits": [serde_json::to_value(&chain_edit).unwrap()],
                "undoneAt": null,
            })
        );
        let chain_json = serde_json::to_value(&chain_edit).unwrap();
        assert_eq!(
            serde_json::to_value(ModelReplaceResult {
                record_id: None,
                results: vec![ModelReplaceItemResult {
                    edit: chain_edit,
                    ok: false,
                    error: Some("当前值已变化，请重新扫描".to_string()),
                }],
            })
            .unwrap(),
            serde_json::json!({
                "recordId": null,
                "results": [{
                    "edit": chain_json,
                    "ok": false,
                    "error": "当前值已变化，请重新扫描",
                }],
            })
        );
        assert_eq!(
            serde_json::to_value(ModelProbeResult {
                ok: true,
                latency_ms: 12,
                detail: "ok".to_string(),
            })
            .unwrap(),
            serde_json::json!({ "ok": true, "latencyMs": 12, "detail": "ok" })
        );
    }
}
