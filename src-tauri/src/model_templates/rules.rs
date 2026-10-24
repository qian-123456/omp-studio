//! Quota switch rules: validation, conflicts, the polling loop, one evaluation pass, the
//! derived current-template state and the live poller status.
//!
//! A rule fires when the most-idle account of one provider's window is at or above its
//! threshold, and only ever writes its own scope (`global` or one project's config). One pass
//! fetches the quota report once and then evaluates every scope independently: inside a scope
//! rules run in `sort` order and the first hit wins, so a single pass can switch several scopes.
//! Evaluation is deliberately cheap while idle — no enabled rule means no quota report is
//! fetched at all.
//!
//! The loop keeps its mutable state in one process-wide `LiveStatus` cell and reads the poll
//! interval from the database on every iteration, because the interval can change at runtime.
//! Failures back off exponentially (capped at an hour) and notify once per streak; a `refused`
//! switch raises a [`BlockedNotice`] that is cleared by the next evaluation of that scope that
//! does not end in a refusal. A scope whose project directory vanished is logged as `failed` and
//! skipped. Blocked and vanished-directory notifications are deduplicated per scope for 30
//! minutes.

use std::collections::BTreeMap;
use std::sync::OnceLock;
use std::time::Duration;

use rusqlite::Connection;
use tauri::Emitter as _;

use super::provider_map::provider_matches;
use super::store;
use super::usage::{self, UsageSnapshot};
use super::{
    apply, read_layer, scope_label, scope_project, BlockedNotice, CurrentTemplateState,
    ModelSwitchLogEntry, ModelSwitchRule, ModelSwitchRuleInput, ModelTemplate, ProviderStatus,
    RuleConflict, RuleValidation, SwitchResult, SwitchStatus, GLOBAL_SCOPE,
};
use crate::settings_model_roles as roles;
use crate::state::AppState;

/// Poll interval bounds (mirrors `store::SwitchSettings`).
const MIN_POLL_SECS: u64 = 60;
const MAX_POLL_SECS: u64 = 86_400;
/// Idle re-check period while no rule is enabled; the quota report is not fetched.
const IDLE_POLL_SECS: u64 = 60;
/// Failure backoff ceiling: `interval * 2^n`, never longer than one hour.
const MAX_BACKOFF_SECS: u64 = 3_600;
/// Consecutive failures that produce one notification.
const FAILURE_NOTIFY_AT: u32 = 3;
/// A blocked condition notifies at most once in this window.
const BLOCKED_NOTIFY_WINDOW_MS: i64 = 30 * 60 * 1_000;

/// Mutable poller state, read by [`status`].
#[derive(Debug, Default)]
struct LiveStatus {
    last_check_at: Option<i64>,
    last_error: Option<String>,
    checking: bool,
    next_check_at: Option<i64>,
    blocked: Option<BlockedNotice>,
    providers: Vec<ProviderStatus>,
    /// A settings-page fetch for [`LiveStatus::providers`] is in flight.
    providers_requested: bool,
    /// Notification key (scope included) -> epoch-millis of its last notification.
    notified: BTreeMap<String, i64>,
}

// OnceLock, not LazyLock: crate MSRV is 1.77 (LazyLock needs 1.80).
static LIVE: OnceLock<parking_lot::Mutex<LiveStatus>> = OnceLock::new();

fn live() -> &'static parking_lot::Mutex<LiveStatus> {
    LIVE.get_or_init(Default::default)
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---------- validation ----------

/// Checks one rule before it is stored. `errors` block the save; `warnings` are shown but stored.
pub(crate) fn validate_rule(
    conn: &Connection,
    input: &ModelSwitchRuleInput,
) -> Result<RuleValidation, String> {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let name = input.name.trim();
    if name.is_empty() {
        errors.push("规则名称不能为空".to_string());
    }
    if !(0.0..=100.0).contains(&input.threshold_pct) {
        errors.push("阈值必须在 0 到 100 之间".to_string());
    }
    if input.window_key.trim().is_empty() {
        errors.push("额度窗口不能为空".to_string());
    }
    if let Err(error) = scope_project(&input.scope) {
        errors.push(error);
    }
    let template = store::get_template(conn, input.template_id.trim())?;
    let Some(template) = template else {
        errors.push("目标模板不存在".to_string());
        return Ok(RuleValidation { errors, warnings });
    };
    if template.scope != input.scope {
        errors.push("规则的作用范围与目标模板不一致".to_string());
        return Ok(RuleValidation { errors, warnings });
    }

    if let Some(provider) = default_provider(&template) {
        if provider_matches(input.provider.trim(), &provider) {
            warnings.push(format!(
                "目标模板的 default 仍属于同一供应商 {provider}：切过去仍是同一供应商，等于没切"
            ));
        }
        if let Some(other) = mutual_escape_partner(conn, input, &provider)? {
            warnings.push(format!(
                "与规则「{}」互为逃生出口：两个供应商同时用尽时无模板可用",
                other.name
            ));
        }
    }
    Ok(RuleValidation { errors, warnings })
}

/// Another rule of the same scope that this rule can escape to while the other escapes straight
/// back: its provider is this template's default provider, and its own template's default lands
/// on this rule's provider.
fn mutual_escape_partner(
    conn: &Connection,
    input: &ModelSwitchRuleInput,
    template_default: &str,
) -> Result<Option<ModelSwitchRule>, String> {
    let this_provider = input.provider.trim();
    if this_provider.is_empty() {
        return Ok(None);
    }
    let own_id = input.id.as_deref().map(str::trim).unwrap_or_default();
    for other in store::list_rules(conn)? {
        if other.scope != input.scope || (!own_id.is_empty() && other.id == own_id) {
            continue;
        }
        if !provider_matches(other.provider.trim(), template_default) {
            continue;
        }
        let Some(other_template) = store::get_template(conn, other.template_id.trim())? else {
            continue;
        };
        let Some(other_default) = default_provider(&other_template) else {
            continue;
        };
        if provider_matches(this_provider, &other_default) {
            return Ok(Some(other));
        }
    }
    Ok(None)
}

/// Every configuration-level conflict, computed per scope: per-rule self-eating, pairwise mutual
/// escape, and a missing bottom line in a scope that has at least one enabled rule.
pub(crate) fn conflicts(conn: &Connection) -> Result<Vec<RuleConflict>, String> {
    let rules = store::list_rules(conn)?;
    let templates: BTreeMap<String, ModelTemplate> = store::list_templates(conn)?
        .into_iter()
        .map(|template| (template.id.clone(), template))
        .collect();
    let default_of = |template_id: &str| -> Option<String> {
        templates.get(template_id.trim()).and_then(default_provider)
    };

    let mut scopes: Vec<&str> = Vec::new();
    for rule in &rules {
        if !scopes.contains(&rule.scope.as_str()) {
            scopes.push(&rule.scope);
        }
    }

    let mut found = Vec::new();
    for scope in scopes {
        let scoped: Vec<&ModelSwitchRule> =
            rules.iter().filter(|rule| rule.scope == scope).collect();
        for rule in &scoped {
            let Some(provider) = default_of(&rule.template_id) else {
                continue;
            };
            if provider_matches(rule.provider.trim(), &provider) {
                found.push(RuleConflict {
                    scope: scope.to_string(),
                    kind: "self-eating".to_string(),
                    message: format!(
                        "规则「{}」的目标模板 default 仍属于同一供应商 {provider}：切过去仍是同一供应商，等于没切",
                        rule.name
                    ),
                    rule_ids: vec![rule.id.clone()],
                });
            }
        }

        for (index, first) in scoped.iter().enumerate() {
            let Some(first_default) = default_of(&first.template_id) else {
                continue;
            };
            for second in scoped.iter().skip(index + 1) {
                let Some(second_default) = default_of(&second.template_id) else {
                    continue;
                };
                if provider_matches(second.provider.trim(), &first_default)
                    && provider_matches(first.provider.trim(), &second_default)
                {
                    found.push(RuleConflict {
                        scope: scope.to_string(),
                        kind: "mutual-escape".to_string(),
                        message: format!(
                            "规则「{}」与「{}」互为逃生出口：两个供应商同时用尽时无模板可用",
                            first.name, second.name
                        ),
                        rule_ids: vec![first.id.clone(), second.id.clone()],
                    });
                }
            }
        }

        let has_bottom_line = templates
            .values()
            .any(|template| template.scope == scope && template.is_bottom_line);
        if scoped.iter().any(|rule| rule.enabled) && !has_bottom_line {
            found.push(RuleConflict {
                scope: scope.to_string(),
                kind: "no-bottom-line".to_string(),
                message: "尚未设置保底模板，额度耗尽时可能无模板可用".to_string(),
                rule_ids: Vec::new(),
            });
        }
    }
    Ok(found)
}

/// `provider/model` -> `provider`. Aliases (`@role`) and unparsable values yield `None`.
fn selector_provider(selector: &str) -> Option<String> {
    let primary = selector.split(',').next().unwrap_or(selector).trim();
    if primary.starts_with('@') {
        return None;
    }
    let (provider, model) = primary.split_once('/')?;
    let provider = provider.trim();
    if provider.is_empty() || model.trim().is_empty() {
        return None;
    }
    Some(provider.to_string())
}

/// Provider of a template's `default` role, when it names a concrete model.
fn default_provider(template: &ModelTemplate) -> Option<String> {
    template
        .roles
        .get("default")
        .and_then(|value| value.as_deref())
        .and_then(selector_provider)
}

// ---------- current state ----------

/// Template that produced one scope's current configuration, plus the roles a manual edit has
/// moved away from the values the template wrote. Only the scope's own layer is compared, so a
/// project's state never depends on the global config.
pub(crate) fn current_state(
    conn: &Connection,
    scope: &str,
) -> Result<CurrentTemplateState, String> {
    let Some(entry) = store::latest_live_switch(conn, scope, false)? else {
        return Ok(CurrentTemplateState {
            scope: scope.to_string(),
            template_id: None,
            template_name: None,
            drifted_roles: Vec::new(),
            log_id: None,
        });
    };
    let current = match read_layer(scope) {
        Ok(layer) => layer.model_roles,
        // One unreadable project file must not take the whole snapshot down: with nothing
        // readable, every written role counts as drifted.
        Err(_) if scope != GLOBAL_SCOPE => BTreeMap::new(),
        Err(error) => return Err(error),
    };
    let mut drifted_roles: Vec<String> = Vec::new();
    for edit in &entry.edits {
        if current.get(&edit.role).cloned() != edit.after && !drifted_roles.contains(&edit.role) {
            drifted_roles.push(edit.role.clone());
        }
    }
    Ok(CurrentTemplateState {
        scope: scope.to_string(),
        template_id: Some(entry.template_id),
        template_name: Some(entry.template_name),
        drifted_roles,
        log_id: Some(entry.id),
    })
}

/// [`current_state`] of every known scope (`global` first, also when it was never applied).
pub(crate) fn current_states(conn: &Connection) -> Result<Vec<CurrentTemplateState>, String> {
    store::scopes(conn)?
        .iter()
        .map(|scope| current_state(conn, scope))
        .collect()
}

// ---------- status ----------

/// Live poller status; the interval is read fresh so the UI never shows a stale setting.
pub(crate) fn status(state: &AppState) -> SwitchStatus {
    let poll_interval_secs = poll_interval(state);
    let live = live().lock();
    SwitchStatus {
        last_check_at: live.last_check_at,
        last_error: live.last_error.clone(),
        checking: live.checking,
        poll_interval_secs,
        next_check_at: live.next_check_at,
        providers: live.providers.clone(),
        blocked: live.blocked.clone(),
    }
}

fn mark_checked() {
    live().lock().last_check_at = Some(now_millis());
}

/// Records when the loop intends to wake up next; callers pass an already clamped delay.
fn plan_next(secs: u64) {
    let delay_ms = i64::try_from(secs)
        .unwrap_or(i64::MAX)
        .saturating_mul(1_000);
    live().lock().next_check_at = Some(now_millis().saturating_add(delay_ms));
}

fn set_checking(checking: bool) {
    live().lock().checking = checking;
}

fn set_last_error(error: Option<String>) {
    live().lock().last_error = error;
}

fn set_providers(providers: Vec<ProviderStatus>) {
    live().lock().providers = providers;
}

/// Fetches the usage report on demand so the rule editor can offer real provider/window
/// choices before any rule exists (the poller never calls the CLI without an enabled rule).
/// One fetch at a time; a failure is recorded but never surfaced as a hard error.
pub(crate) async fn refresh_providers(state: &AppState) {
    {
        let mut live = live().lock();
        if live.providers_requested {
            return;
        }
        live.providers_requested = true;
    }
    let outcome = usage::fetch_usage(state).await;
    let mut live = live().lock();
    live.providers_requested = false;
    match outcome {
        Ok(snapshot) => {
            live.providers = usage::provider_statuses(&snapshot);
            live.last_check_at = Some(now_millis());
            live.last_error = None;
        }
        Err(error) => live.last_error = Some(error),
    }
}

/// Drops the notice when it belongs to `scope`. The notification marker survives, so a block
/// that returns within the dedupe window stays quiet.
fn clear_blocked(scope: &str) {
    let mut live = live().lock();
    if live
        .blocked
        .as_ref()
        .is_some_and(|notice| notice.scope == scope)
    {
        live.blocked = None;
    }
}

/// Drops the notice unless its scope is one of `active` (scopes that still have an enabled rule).
fn drop_stale_blocked(active: &[&str]) {
    let mut live = live().lock();
    if live
        .blocked
        .as_ref()
        .is_some_and(|notice| !active.contains(&notice.scope.as_str()))
    {
        live.blocked = None;
    }
}

/// `true` (and the key is stamped) unless `key` already notified within
/// [`BLOCKED_NOTIFY_WINDOW_MS`].
fn notify_due(key: String, now: i64) -> bool {
    let mut live = live().lock();
    let due = live.notified.get(&key).map_or(true, |at| {
        now.saturating_sub(*at) >= BLOCKED_NOTIFY_WINDOW_MS
    });
    if due {
        live.notified.insert(key, now);
    }
    due
}

/// Raises the blocked notice and notifies, unless the same scope and provider set already
/// notified within [`BLOCKED_NOTIFY_WINDOW_MS`].
fn set_blocked(state: &AppState, notice: BlockedNotice) {
    let key = format!("blocked|{}|{}", notice.scope, notice.providers.join("|"));
    let due = notify_due(key, now_millis());
    let message = due.then(|| notice.message.clone());
    live().lock().blocked = Some(notice);
    if let Some(message) = message {
        let _ = crate::notify::send(state, "模型额度已用尽", &message, true);
    }
}

/// Provider slugs implicated by a refused switch: the rule's own provider plus the provider the
/// target template's `default` role points at.
fn blocked_notice(
    template: Option<&ModelTemplate>,
    rule: &ModelSwitchRule,
    reason: &str,
) -> BlockedNotice {
    let mut providers = vec![rule.provider.trim().to_string()];
    if let Some(provider) = template.and_then(default_provider) {
        if !providers
            .iter()
            .any(|known| provider_matches(known, &provider))
        {
            providers.push(provider);
        }
    }
    providers.retain(|provider| !provider.is_empty());
    BlockedNotice {
        scope: rule.scope.clone(),
        at: now_millis(),
        message: format!(
            "{}：规则「{}」已命中，但目标模板的供应商额度已用尽（{}），已跳过切换：{reason}",
            scope_label(&rule.scope),
            rule.name,
            providers.join("、")
        ),
        providers,
    }
}

// ---------- evaluation ----------

/// Serialises evaluation passes: the poller and a manual run must never apply two templates at
/// once.
static EVAL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Result of one pass over every scope. A scope that failed does not stop the others: its error
/// is collected here.
struct Evaluation {
    results: Vec<SwitchResult>,
    error: Option<String>,
}

/// Runs one evaluation over every scope with an enabled rule. An empty list covers every no-op:
/// no enabled rule, no rule fired, the target template is already in effect, or applying it
/// changed nothing. `Err` only when nothing was switched and a scope (or the quota fetch) failed.
pub(crate) async fn evaluate_once(state: &AppState) -> Result<Vec<SwitchResult>, String> {
    let _guard = EVAL_LOCK.lock().await;
    set_checking(true);
    let outcome = evaluate_inner(state).await;
    set_checking(false);
    match outcome {
        Err(error) => {
            set_last_error(Some(error.clone()));
            Err(error)
        }
        Ok(Evaluation { results, error }) => {
            set_last_error(error.clone());
            match error {
                Some(error) if results.is_empty() => Err(error),
                _ => Ok(results),
            }
        }
    }
}

async fn evaluate_inner(state: &AppState) -> Result<Evaluation, String> {
    mark_checked();
    let db = state.db.clone();
    let (rules, templates) = tokio::task::spawn_blocking(move || {
        let conn = db.lock();
        Ok::<_, String>((store::list_rules(&conn)?, store::list_templates(&conn)?))
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))??;

    // Enabled rules grouped per scope, in first-seen order. A stable sort keeps the stored
    // creation order on equal `sort`; the first hit of a scope wins.
    let mut by_scope: Vec<(String, Vec<ModelSwitchRule>)> = Vec::new();
    for rule in rules.into_iter().filter(|rule| rule.enabled) {
        match by_scope.iter_mut().find(|(scope, _)| *scope == rule.scope) {
            Some((_, group)) => group.push(rule),
            None => by_scope.push((rule.scope.clone(), vec![rule])),
        }
    }
    for (_, group) in &mut by_scope {
        group.sort_by_key(|rule| rule.sort);
    }
    let active: Vec<&str> = by_scope.iter().map(|(scope, _)| scope.as_str()).collect();
    drop_stale_blocked(&active);
    if by_scope.is_empty() {
        return Ok(Evaluation {
            results: Vec::new(),
            error: None,
        });
    }

    // One quota report shared by every scope.
    let snapshot = usage::fetch_usage(state).await?;
    set_providers(usage::provider_statuses(&snapshot));

    let mut results = Vec::new();
    let mut errors = Vec::new();
    for (scope, group) in &by_scope {
        match evaluate_scope(state, scope, group, &templates, &snapshot).await {
            Ok(Some(result)) => results.push(result),
            Ok(None) => {}
            Err(error) => errors.push(format!("{}：{error}", scope_label(scope))),
        }
    }
    Ok(Evaluation {
        results,
        error: (!errors.is_empty()).then(|| errors.join("；")),
    })
}

/// One scope's evaluation: the first enabled rule (in `sort` order) whose window is at or above
/// its threshold switches that scope; with no hit, a finished auto-revert is checked instead.
async fn evaluate_scope(
    state: &AppState,
    scope: &str,
    rules: &[ModelSwitchRule],
    templates: &[ModelTemplate],
    snapshot: &UsageSnapshot,
) -> Result<Option<SwitchResult>, String> {
    if let Err(reason) = scope_project(scope) {
        // The project was deleted or moved away: skip this scope, never touch the others.
        record_unavailable_scope(state, scope, rules, templates, &reason)?;
        return Ok(None);
    }
    let current = current_state_blocking(state, scope).await?;

    let hit = rules.iter().find(|rule| {
        usage::window_pct(snapshot, &rule.provider, &rule.window_key)
            .is_some_and(|pct| pct >= rule.threshold_pct)
    });
    let Some(rule) = hit.cloned() else {
        clear_blocked(scope);
        auto_revert(state, scope, &current, snapshot).await?;
        return Ok(None);
    };
    if current.template_id.as_deref() == Some(rule.template_id.as_str()) {
        clear_blocked(scope);
        return Ok(None);
    }

    let target = templates
        .iter()
        .find(|template| template.id == rule.template_id);
    let result = apply::apply_template(state, &rule.template_id, false, Some(rule.clone())).await?;
    // The refusal names the reason the target template could not be used; the log row the
    // fallback writes carries the rule name again, so keep the first refusal's copy.
    let refused = result.status == "refused";
    let refusal_reason = result.reason.clone();
    let mut outcome = result;
    if refused {
        // A bottom-line template is exempt from the preflight refusal, so it is applied forced
        // even when it is the template the rule already targets. Only this scope's bottom line
        // counts.
        if let Some(template) = templates
            .iter()
            .find(|template| template.is_bottom_line && template.scope == scope)
        {
            let forced =
                apply::apply_template(state, &template.id, true, Some(rule.clone())).await?;
            if forced.status != "skipped" {
                outcome = forced;
            }
        }
        set_blocked(state, blocked_notice(target, &rule, &refusal_reason));
    } else {
        clear_blocked(scope);
    }
    if outcome.status == "skipped" {
        return Ok(None);
    }
    Ok(Some(outcome))
}

async fn current_state_blocking(
    state: &AppState,
    scope: &str,
) -> Result<CurrentTemplateState, String> {
    let db = state.db.clone();
    let scope = scope.to_string();
    tokio::task::spawn_blocking(move || current_state(&db.lock(), &scope))
        .await
        .map_err(|error| format!("后台任务失败：{error}"))?
}

/// Logs a `failed` row and notifies once per [`BLOCKED_NOTIFY_WINDOW_MS`] when a scope's project
/// directory no longer exists; repeats inside the window stay silent.
fn record_unavailable_scope(
    state: &AppState,
    scope: &str,
    rules: &[ModelSwitchRule],
    templates: &[ModelTemplate],
    reason: &str,
) -> Result<(), String> {
    if !notify_due(format!("missing|{scope}"), now_millis()) {
        return Ok(());
    }
    let message = format!("{reason}，已跳过该范围的自动切换规则");
    let target = rules.first().and_then(|rule| {
        templates
            .iter()
            .find(|template| template.id == rule.template_id)
            .map(|template| (rule, template))
    });
    if let Some((rule, template)) = target {
        let entry = apply::log_entry(
            template,
            Some(rule),
            "failed",
            message.clone(),
            &[],
            None,
            Vec::new(),
        );
        apply::record(state, &entry)?;
        let _ = state.app.emit("model_switch:changed", ());
    }
    let _ = crate::notify::send(
        state,
        "模型规则已跳过",
        &format!("{}：{message}", scope_label(scope)),
        true,
    );
    Ok(())
}

/// Newest switch this module made for a rule of `scope` and that is still in effect.
fn latest_rule_switch(
    state: &AppState,
    scope: &str,
) -> Result<Option<ModelSwitchLogEntry>, String> {
    let conn = state.db.lock();
    store::latest_live_switch(&conn, scope, true)
}

fn load_rule(
    state: &AppState,
    entry: &ModelSwitchLogEntry,
) -> Result<Option<ModelSwitchRule>, String> {
    let Some(rule_id) = entry
        .rule_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return Ok(None);
    };
    let conn = state.db.lock();
    store::get_rule(&conn, rule_id)
}

/// Revert threshold: the configured value, or ten points below the trigger clamped at 0.
fn revert_threshold_pct(rule: &ModelSwitchRule) -> f64 {
    match rule.revert_threshold_pct {
        Some(value) => value,
        None => (rule.threshold_pct - 10.0).max(0.0),
    }
}

/// Reverts the switch described by `entry` when its rule opted in, its window drained and the
/// scope's configuration still matches what that switch wrote.
async fn auto_revert(
    state: &AppState,
    scope: &str,
    current: &CurrentTemplateState,
    snapshot: &UsageSnapshot,
) -> Result<(), String> {
    let Some(entry) = latest_rule_switch(state, scope)? else {
        return Ok(());
    };
    // The switch must still be the one in effect (§0: only revert what this rule switched and
    // that nobody has replaced since).
    if current.log_id.as_deref() != Some(entry.id.as_str()) {
        return Ok(());
    }
    let Some(rule) = load_rule(state, &entry)? else {
        return Ok(());
    };
    if !rule.enabled || !rule.auto_revert {
        return Ok(());
    }
    let threshold = revert_threshold_pct(&rule);
    let due = match usage::window_pct(snapshot, &rule.provider, &rule.window_key) {
        // Window gone or reset.
        None => true,
        Some(pct) => pct <= threshold,
    };
    if !due {
        return Ok(());
    }
    if !current.drifted_roles.is_empty() {
        // Due, but a manual edit blocks the restore: say so once per switch, not per poll.
        if notify_due(format!("revert-drift|{}", entry.id), now_millis()) {
            let _ = crate::notify::send(
                state,
                &format!("模型模板未自动恢复（{}）", scope_label(scope)),
                &format!(
                    "{}：以下角色已被手动修改，保持不动：{}",
                    entry.template_name,
                    current.drifted_roles.join("、")
                ),
                true,
            );
        }
        return Ok(());
    }
    revert(state, &entry).await
}

/// Restores the values the switch replaced, then retires its log row. The recorded
/// `before` values are authoritative: a template applied earlier may itself have been edited
/// (or may only cover some of the roles this switch changed), so reapplying it would leave
/// roles holding the switched value while the log claims to be undone.
async fn revert(state: &AppState, entry: &ModelSwitchLogEntry) -> Result<(), String> {
    write_before_values(entry).await?;
    {
        let conn = state.db.lock();
        store::mark_log_undone(&conn, &entry.id, &crate::schedules::store::now_rfc3339())?;
    }
    let _ = state.app.emit("model_switch:changed", ());
    let _ = crate::notify::send(
        state,
        &format!("模型模板已自动恢复（{}）", scope_label(&entry.scope)),
        &format!("{}：额度回落，已恢复为切换前的模型", entry.template_name),
        true,
    );
    Ok(())
}

/// Writes the log's `before` values back into the log's scope, skipping roles that already hold
/// them.
async fn write_before_values(entry: &ModelSwitchLogEntry) -> Result<(), String> {
    let edits = entry.edits.clone();
    let scope = entry.scope.clone();
    tokio::task::spawn_blocking(move || {
        let project = scope_project(&scope)?;
        let current = read_layer(&scope)?.model_roles;
        let ops: Vec<(String, Option<String>)> = edits
            .iter()
            .filter(|edit| current.get(&edit.role).cloned() != edit.before)
            .map(|edit| (edit.role.clone(), edit.before.clone()))
            .collect();
        if ops.is_empty() {
            return Ok(());
        }
        roles::write_role_batch(project.as_deref(), &ops)
    })
    .await
    .map_err(|error| format!("后台任务失败：{error}"))?
}

// ---------- polling loop ----------

/// Starts the poller. The interval is re-read every iteration, so a settings change takes effect
/// on the next wake-up without restarting the loop.
pub(crate) fn init(state: AppState) {
    tauri::async_runtime::spawn(run_loop(state));
}

async fn run_loop(state: AppState) {
    let mut failures: u32 = 0;
    loop {
        let interval = poll_interval(&state);
        if !has_enabled_rule(&state) {
            // Nothing to evaluate: never touch the CLI quota report.
            drop_stale_blocked(&[]);
            plan_next(IDLE_POLL_SECS);
            tokio::time::sleep(Duration::from_secs(IDLE_POLL_SECS)).await;
            continue;
        }
        match evaluate_once(&state).await {
            Ok(_) => {
                failures = 0;
                plan_next(interval);
                tokio::time::sleep(Duration::from_secs(interval)).await;
            }
            Err(error) => {
                failures = failures.saturating_add(1);
                if failures == FAILURE_NOTIFY_AT {
                    let _ = crate::notify::send(
                        &state,
                        "模型额度检查失败",
                        &format!("连续 {failures} 次检查额度失败：{error}"),
                        false,
                    );
                }
                let delay = backoff_secs(interval, failures);
                plan_next(delay);
                tokio::time::sleep(Duration::from_secs(delay)).await;
            }
        }
    }
}

/// Configured poll interval, clamped to the documented range.
fn poll_interval(state: &AppState) -> u64 {
    let conn = state.db.lock();
    store::settings(&conn)
        .poll_interval_secs
        .clamp(MIN_POLL_SECS, MAX_POLL_SECS)
}

/// Whether any rule is enabled; a failed read means "nothing to do", retried on the idle tick.
fn has_enabled_rule(state: &AppState) -> bool {
    let conn = state.db.lock();
    store::list_rules(&conn).is_ok_and(|rules| rules.iter().any(|rule| rule.enabled))
}

/// `interval * 2^failures`, capped at [`MAX_BACKOFF_SECS`].
fn backoff_secs(interval: u64, failures: u32) -> u64 {
    // Twelve doublings of the minimum interval already exceed the cap, so a wider shift only
    // wastes the saturating multiply.
    let factor = 1u64 << failures.min(12);
    interval
        .max(MIN_POLL_SECS)
        .saturating_mul(factor)
        .min(MAX_BACKOFF_SECS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_templates::{ModelTemplateInput, TemplateRoleEdit};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn
    }

    /// An existing project directory usable as a scope.
    fn project_dir(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("ompws-rules-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    fn template(name: &str, default: &str) -> ModelTemplateInput {
        scoped_template(name, GLOBAL_SCOPE, default)
    }

    fn scoped_template(name: &str, scope: &str, default: &str) -> ModelTemplateInput {
        ModelTemplateInput {
            id: None,
            name: name.to_string(),
            scope: scope.to_string(),
            roles: BTreeMap::from([("default".to_string(), Some(default.to_string()))]),
            is_bottom_line: false,
        }
    }

    fn rule_input(template_id: &str, provider: &str) -> ModelSwitchRuleInput {
        scoped_rule_input(template_id, GLOBAL_SCOPE, provider)
    }

    fn scoped_rule_input(template_id: &str, scope: &str, provider: &str) -> ModelSwitchRuleInput {
        ModelSwitchRuleInput {
            id: None,
            name: "规则".to_string(),
            enabled: true,
            scope: scope.to_string(),
            provider: provider.to_string(),
            window_key: "5h".to_string(),
            threshold_pct: 95.0,
            template_id: template_id.to_string(),
            auto_revert: true,
            revert_threshold_pct: None,
        }
    }

    #[test]
    fn selector_provider_reads_the_first_selector_only() {
        assert_eq!(
            selector_provider("anthropic/claude").as_deref(),
            Some("anthropic")
        );
        assert_eq!(selector_provider("a/b, c/d").as_deref(), Some("a"));
        assert_eq!(selector_provider("claude"), None);
        assert_eq!(selector_provider("@fast"), None);
        assert_eq!(selector_provider("anthropic/"), None);
    }

    #[test]
    fn backoff_doubles_and_caps() {
        assert_eq!(backoff_secs(600, 0), 600);
        assert_eq!(backoff_secs(600, 1), 1_200);
        assert_eq!(backoff_secs(600, 2), 2_400);
        assert_eq!(backoff_secs(600, 3), 3_600);
        assert_eq!(backoff_secs(60, 12), 3_600);
    }

    #[test]
    fn revert_threshold_defaults_to_ten_points_below_and_never_goes_negative() {
        let base = ModelSwitchRule {
            id: "r".to_string(),
            name: "r".to_string(),
            enabled: true,
            scope: GLOBAL_SCOPE.to_string(),
            provider: "anthropic".to_string(),
            window_key: "5h".to_string(),
            threshold_pct: 95.0,
            template_id: "t".to_string(),
            auto_revert: true,
            revert_threshold_pct: None,
            sort: 0,
            created_at: String::new(),
            updated_at: String::new(),
        };
        assert_eq!(revert_threshold_pct(&base), 85.0);
        assert_eq!(
            revert_threshold_pct(&ModelSwitchRule {
                revert_threshold_pct: Some(40.0),
                ..base.clone()
            }),
            40.0
        );
        assert_eq!(
            revert_threshold_pct(&ModelSwitchRule {
                threshold_pct: 5.0,
                ..base.clone()
            }),
            0.0
        );
    }

    #[test]
    fn validation_reports_the_four_errors() {
        let conn = db();
        let saved = store::upsert_template(&conn, &template("省钱", "openai/gpt-5")).unwrap();

        let mut input = rule_input(&saved.id, "anthropic");
        input.name = "  ".to_string();
        assert!(validate_rule(&conn, &input)
            .unwrap()
            .errors
            .iter()
            .any(|error| error.contains("名称")));

        let mut input = rule_input(&saved.id, "anthropic");
        input.threshold_pct = 120.0;
        assert!(validate_rule(&conn, &input)
            .unwrap()
            .errors
            .iter()
            .any(|error| error.contains("阈值")));

        let mut input = rule_input(&saved.id, "anthropic");
        input.window_key = " ".to_string();
        assert!(validate_rule(&conn, &input)
            .unwrap()
            .errors
            .iter()
            .any(|error| error.contains("窗口")));

        let input = rule_input("missing", "anthropic");
        assert!(validate_rule(&conn, &input)
            .unwrap()
            .errors
            .iter()
            .any(|error| error.contains("模板")));
    }

    #[test]
    fn validation_warns_about_self_eating_and_mutual_escape() {
        let conn = db();
        let openai =
            store::upsert_template(&conn, &template("换到 openai", "openai/gpt-5")).unwrap();
        let anthropic =
            store::upsert_template(&conn, &template("换到 anthropic", "anthropic/claude")).unwrap();

        // Anthropic threshold -> template whose default is still anthropic.
        let self_eating = rule_input(&anthropic.id, "anthropic");
        let validation = validate_rule(&conn, &self_eating).unwrap();
        assert!(validation.errors.is_empty(), "{:?}", validation.errors);
        assert!(validation
            .warnings
            .iter()
            .any(|warning| warning.contains("等于没切")));

        // Anthropic -> openai template, while an openai rule escapes back to anthropic.
        store::upsert_rule(&conn, &rule_input(&anthropic.id, "openai")).unwrap();
        let escape = rule_input(&openai.id, "anthropic");
        let validation = validate_rule(&conn, &escape).unwrap();
        assert!(validation
            .warnings
            .iter()
            .any(|warning| warning.contains("无模板可用")));
    }

    #[test]
    fn conflicts_report_all_three_kinds() {
        let conn = db();
        let openai =
            store::upsert_template(&conn, &template("换到 openai", "openai/gpt-5")).unwrap();
        let anthropic =
            store::upsert_template(&conn, &template("换到 anthropic", "anthropic/claude")).unwrap();
        let same = store::upsert_template(&conn, &template("原地踏步", "anthropic/opus")).unwrap();

        store::upsert_rule(&conn, &rule_input(&openai.id, "anthropic")).unwrap();
        store::upsert_rule(&conn, &rule_input(&anthropic.id, "openai")).unwrap();
        store::upsert_rule(&conn, &rule_input(&same.id, "anthropic")).unwrap();

        let found = conflicts(&conn).unwrap();
        let kinds: Vec<&str> = found.iter().map(|c| c.kind.as_str()).collect();
        assert!(kinds.contains(&"self-eating"), "{kinds:?}");
        assert!(kinds.contains(&"mutual-escape"), "{kinds:?}");
        assert!(kinds.contains(&"no-bottom-line"), "{kinds:?}");
        let mutual = found.iter().find(|c| c.kind == "mutual-escape").unwrap();
        assert_eq!(mutual.rule_ids.len(), 2);

        let mut bottom = template("保底", "deepseek/chat");
        bottom.is_bottom_line = true;
        store::upsert_template(&conn, &bottom).unwrap();
        let found = conflicts(&conn).unwrap();
        assert!(!found.iter().any(|c| c.kind == "no-bottom-line"));
    }

    #[test]
    fn current_state_without_a_log_is_empty() {
        let conn = db();
        let state = current_state(&conn, GLOBAL_SCOPE).unwrap();
        assert_eq!(state.scope, GLOBAL_SCOPE);
        assert_eq!(state.template_id, None);
        assert_eq!(state.log_id, None);
        assert!(state.drifted_roles.is_empty());
    }

    #[test]
    fn validation_rejects_a_scope_that_differs_from_the_template() {
        let conn = db();
        let project = project_dir("mismatch");
        let global_template =
            store::upsert_template(&conn, &template("全局", "openai/gpt-5")).unwrap();
        let project_template =
            store::upsert_template(&conn, &scoped_template("项目", &project, "openai/gpt-5"))
                .unwrap();

        let wrong_project = scoped_rule_input(&global_template.id, &project, "anthropic");
        assert!(validate_rule(&conn, &wrong_project)
            .unwrap()
            .errors
            .iter()
            .any(|error| error.contains("作用范围与目标模板不一致")));
        let wrong_global = rule_input(&project_template.id, "anthropic");
        assert!(validate_rule(&conn, &wrong_global)
            .unwrap()
            .errors
            .iter()
            .any(|error| error.contains("作用范围与目标模板不一致")));
        let matching = scoped_rule_input(&project_template.id, &project, "anthropic");
        assert!(validate_rule(&conn, &matching).unwrap().errors.is_empty());

        // A scope that is not an existing directory is an error of its own.
        let missing = scoped_rule_input(&global_template.id, "/no/such/ompws/project", "anthropic");
        assert!(validate_rule(&conn, &missing)
            .unwrap()
            .errors
            .iter()
            .any(|error| error.contains("项目目录")));
    }

    #[test]
    fn mutual_escape_warning_ignores_rules_of_other_scopes() {
        let conn = db();
        let project = project_dir("escape");
        let openai =
            store::upsert_template(&conn, &template("换到 openai", "openai/gpt-5")).unwrap();
        let project_anthropic = store::upsert_template(
            &conn,
            &scoped_template("项目换到 anthropic", &project, "anthropic/claude"),
        )
        .unwrap();
        // The only escape back lives in another scope, so there is no mutual escape.
        store::upsert_rule(
            &conn,
            &scoped_rule_input(&project_anthropic.id, &project, "openai"),
        )
        .unwrap();
        let validation = validate_rule(&conn, &rule_input(&openai.id, "anthropic")).unwrap();
        assert!(!validation
            .warnings
            .iter()
            .any(|warning| warning.contains("无模板可用")));
    }

    #[test]
    fn conflicts_are_computed_per_scope() {
        let conn = db();
        let project = project_dir("conflicts");

        // Global: an escape pair, no bottom line.
        let openai =
            store::upsert_template(&conn, &template("换到 openai", "openai/gpt-5")).unwrap();
        let anthropic =
            store::upsert_template(&conn, &template("换到 anthropic", "anthropic/claude")).unwrap();
        store::upsert_rule(&conn, &rule_input(&openai.id, "anthropic")).unwrap();
        store::upsert_rule(&conn, &rule_input(&anthropic.id, "openai")).unwrap();

        // Project: a single rule that escapes to openai, with a bottom line of its own.
        let project_openai = store::upsert_template(
            &conn,
            &scoped_template("项目 openai", &project, "openai/gpt-5"),
        )
        .unwrap();
        let mut bottom = scoped_template("项目保底", &project, "deepseek/chat");
        bottom.is_bottom_line = true;
        store::upsert_template(&conn, &bottom).unwrap();
        store::upsert_rule(
            &conn,
            &scoped_rule_input(&project_openai.id, &project, "anthropic"),
        )
        .unwrap();

        let found = conflicts(&conn).unwrap();
        let global: Vec<&str> = found
            .iter()
            .filter(|c| c.scope == GLOBAL_SCOPE)
            .map(|c| c.kind.as_str())
            .collect();
        assert!(global.contains(&"mutual-escape"), "{global:?}");
        assert!(global.contains(&"no-bottom-line"), "{global:?}");
        // The global pair is not mixed with the project's rule, and the project bottom line
        // does not satisfy the global scope.
        let project_kinds: Vec<&str> = found
            .iter()
            .filter(|c| c.scope == project)
            .map(|c| c.kind.as_str())
            .collect();
        assert!(project_kinds.is_empty(), "{project_kinds:?}");
    }

    #[test]
    fn no_bottom_line_is_only_reported_for_scopes_with_an_enabled_rule() {
        let conn = db();
        let project = project_dir("bottom");
        let openai =
            store::upsert_template(&conn, &template("换到 openai", "openai/gpt-5")).unwrap();
        let project_openai = store::upsert_template(
            &conn,
            &scoped_template("项目 openai", &project, "openai/gpt-5"),
        )
        .unwrap();
        // A scope with templates but no rule is never flagged.
        assert!(conflicts(&conn).unwrap().is_empty());

        let mut disabled = scoped_rule_input(&project_openai.id, &project, "anthropic");
        disabled.enabled = false;
        store::upsert_rule(&conn, &disabled).unwrap();
        assert!(conflicts(&conn).unwrap().is_empty());

        store::upsert_rule(&conn, &rule_input(&openai.id, "anthropic")).unwrap();
        let found = conflicts(&conn).unwrap();
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].kind, "no-bottom-line");
        assert_eq!(found[0].scope, GLOBAL_SCOPE);
    }

    fn applied_row(scope: &str, edits: Vec<TemplateRoleEdit>) -> ModelSwitchLogEntry {
        ModelSwitchLogEntry {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: crate::schedules::store::now_rfc3339(),
            rule_id: None,
            rule_name: None,
            template_id: "t".to_string(),
            template_name: "T".to_string(),
            scope: scope.to_string(),
            status: "applied".to_string(),
            reason: String::new(),
            edits,
            previous_template_id: None,
            session_results: Vec::new(),
            undone_at: None,
        }
    }

    #[test]
    fn project_current_state_reads_only_its_own_file_and_survives_a_vanished_directory() {
        let conn = db();
        let project = project_dir("current");
        let scope = project.clone();
        roles::write_role_batch(
            Some(std::path::Path::new(&project)),
            &[("default".to_string(), Some("a/b".to_string()))],
        )
        .unwrap();
        store::insert_log(
            &conn,
            &applied_row(
                &scope,
                vec![TemplateRoleEdit {
                    role: "default".to_string(),
                    before: None,
                    after: Some("a/b".to_string()),
                }],
            ),
        )
        .unwrap();

        let state = current_state(&conn, &scope).unwrap();
        assert_eq!(state.scope, scope);
        assert_eq!(state.template_id.as_deref(), Some("t"));
        assert!(state.drifted_roles.is_empty());
        // The project's switch is invisible to the global scope.
        assert_eq!(
            current_state(&conn, GLOBAL_SCOPE).unwrap().template_id,
            None
        );

        // A manual edit of the project file shows up as drift.
        roles::write_role_batch(
            Some(std::path::Path::new(&project)),
            &[("default".to_string(), Some("c/d".to_string()))],
        )
        .unwrap();
        assert_eq!(
            current_state(&conn, &scope).unwrap().drifted_roles,
            vec!["default".to_string()]
        );

        // The directory vanishes: no panic, no error, the scope still reports its template.
        std::fs::remove_dir_all(&project).unwrap();
        let states = current_states(&conn).unwrap();
        assert_eq!(states[0].scope, GLOBAL_SCOPE);
        let gone = states.iter().find(|state| state.scope == scope).unwrap();
        assert_eq!(gone.template_id.as_deref(), Some("t"));
        assert_eq!(gone.drifted_roles, vec!["default".to_string()]);
        assert!(scope_project(&scope).is_err());
    }

    #[test]
    fn notifications_are_deduplicated_per_key_inside_the_window() {
        let key = format!("test|{}", uuid::Uuid::new_v4());
        let other = format!("test|{}", uuid::Uuid::new_v4());
        let now = 1_000_000_000;
        assert!(notify_due(key.clone(), now));
        assert!(!notify_due(key.clone(), now + BLOCKED_NOTIFY_WINDOW_MS - 1));
        // Another scope's key is independent.
        assert!(notify_due(other, now + 1));
        assert!(notify_due(key, now + BLOCKED_NOTIFY_WINDOW_MS));
    }
}
