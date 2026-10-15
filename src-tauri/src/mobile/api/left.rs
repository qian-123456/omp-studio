//! Mobile API: left-drawer pages (sessions tree, inbox, search, schedules,
//! skills, settings summary). JSON is camelCase; errors are `{ "error": ".." }`.
//! Mirrors the desktop sidebar (`features/sessions/grouping.ts`), inbox
//! (`features/inbox/attention.ts`), schedules and skills pages, reusing the
//! existing backend modules (`catalog`, `schedules`, `skills`, `settings`).
//!
//! ## Routes
//! Sessions
//! - `GET /left/sessions?mode=code|work|study|research|chat` (default `code`) →
//!   `SessionTree`: `{mode, pinned: SessionMeta[], globalGroup: WorkspaceGroup|null,
//!   workspaceGroups: WorkspaceGroup[], unassignedGroups: {key,cwd,label,sessions}[],
//!   deletedSessions: SessionMeta[], archived: SessionMeta[], sessionGroups:
//!   SessionGroup[], totalVisible}`. `WorkspaceGroup` = `{workspace, isGlobal,
//!   subgroups, deletedSubgroups, totalCount, pinnedCount}`; a subgroup is
//!   `{key, kind: "worktree"|"branch"|"default", label, deleted, isMain, path?,
//!   createCwd?, sessions, totalCount}` — same bucketing as desktop (live git
//!   worktrees incl. empty ones, then badge/branch buckets; sessions of deleted
//!   worktrees land in `deletedSubgroups`). Pinned sessions are listed only in
//!   `pinned`, not repeated inside groups. Zero-message side chats are hidden;
//!   archive cascades to child side chats (unless live/pinned/pending/working).
//! - `GET /left/dirs` → `{dirs: [{path, label, kind: "workspace"|"worktree"|"global",
//!   workspaceId, mode}]}` — the only directories new sessions / schedules may use.
//! - `POST /left/sessions` `{cwd}` → `LiveSessionInfo` `{sessionId, sessionFile, pid, cwd}`.
//!   `cwd` must be inside a registered workspace/worktree (or the global dir);
//!   mode is derived (`chat` for the global dir, else the workspace's mode).
//! - `PATCH /left/sessions/{id}` `{customName?, pinned?, archived?}` → `SessionMeta`
//!   (`customName: ""` clears the name; 404 unknown id).
//!
//! Inbox
//! - `GET /left/inbox` → `{windowHours, badge, order: ["awaiting","error","unread","running"],
//!   awaiting, error, unread, running: SessionMeta[]}` (window rules of `groupInbox`).
//! - `POST /left/inbox/{id}/seen` → `{ok: true}` (mark seen; 404 unknown id).
//! - `POST /left/inbox/read-all` → `{ok: true, count}` (marks every listed unread/error session seen).
//!
//! Search
//! - `GET /left/search?q=&mode=&archived=0|1` → `{sessions: SessionMeta[] (≤100),
//!   branches: [{branch, workspaceId, count, sessionIds (≤5 newest)}]}`. AND-token match over
//!   title/label/branch/worktree/model/last answer/cwd (relative to its workspace);
//!   `mode` omitted = all spaces; archived hidden unless `archived=1`. Blank `q` → empty.
//!
//! Schedules (cwd confined to `GET /left/dirs`; 404 on unknown schedule id)
//! - `GET /left/schedules` → `Schedule[]`.
//! - `POST /left/schedules` `ScheduleDraft` (id ignored) → `Schedule`.
//! - `PUT /left/schedules/{id}` `ScheduleDraft` → `Schedule`.
//! - `DELETE /left/schedules/{id}` → `{ok: true}`.
//! - `POST /left/schedules/{id}/enabled` `{enabled}` → `Schedule`.
//! - `POST /left/schedules/{id}/run` → `ScheduleRun` (run now; the UI must confirm first).
//! - `GET /left/schedules/{id}/runs?limit=20` → `ScheduleRun[]`.
//!
//! Skills
//! - `GET /left/skills?cwd=` → `{skills: (SkillItem + {enabled, disabledReason: null|{kind,..}})[],
//!   extensions: ExtensionItem[], skillsEnabled, configError: string|null}`; `cwd` (optional,
//!   must be in `/left/dirs`) adds that project's skills.
//! - `POST /left/skills/toggle` `{name, enabled, cwd?}` → `{ok: true}` (404 unknown skill;
//!   writes `disabledExtensions` `skill:<name>` like desktop; effective for new sessions).
//! - `POST /left/extensions/toggle` `{path, enabled, cwd?}` → `{ok: true}` (404 unknown extension).
//!
//! Settings (read-only)
//! - `GET /left/settings` → `{appVersion, mobile: {running, port, lanUrl, tunnelUrl,
//!   ipv6Running, ipv6Url}, defaultModel: string|null, defaultModelSource:
//!   "modelRoles.default"|"newSessionModel"|null}`.
//!
//! ## Intentionally not mirrored from desktop
//! Session delete/fork/takeover, workspace add/remove/reorder, chat session-group CRUD (groups
//! are returned read-only), drag ordering/frozen order, archive "clean worktree" flow and the busy-
//! archive confirmation (UI must confirm), skill trash/read/usage stats and per-source
//! toggles, schedule run-detail/transcripts, settings editing.

use std::collections::HashMap;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager as _;

use crate::catalog::store;
use crate::contracts::{
    Attention, ScheduleDraft, SessionGroup, SessionMeta, SessionMetaPatch, SessionStatus,
    SpaceMode, StartOpts, Workspace, WorkspaceKind,
};
use crate::mobile::backend::Backend;
use crate::mobile::server::{ApiError, Ctx};
use crate::schedules::{runner, store as sched_store};
use crate::state::AppState;

type ApiResult<T> = Result<Json<T>, ApiError>;

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new()
        .route(
            "/left/sessions",
            get(session_tree::<B>).post(new_session::<B>),
        )
        .route("/left/dirs", get(list_dirs::<B>))
        .route("/left/sessions/{id}", patch(patch_session::<B>))
        .route("/left/inbox", get(inbox::<B>))
        .route("/left/inbox/read-all", post(inbox_read_all::<B>))
        .route("/left/inbox/{id}/seen", post(inbox_seen::<B>))
        .route("/left/search", get(search::<B>))
        .route(
            "/left/schedules",
            get(schedules_list::<B>).post(schedules_create::<B>),
        )
        .route(
            "/left/schedules/{id}",
            axum::routing::put(schedules_update::<B>).delete(schedules_delete::<B>),
        )
        .route("/left/schedules/{id}/enabled", post(schedules_enabled::<B>))
        .route("/left/schedules/{id}/run", post(schedules_run::<B>))
        .route("/left/schedules/{id}/runs", get(schedules_runs::<B>))
        .route("/left/skills", get(skills_list::<B>))
        .route("/left/skills/toggle", post(skill_toggle::<B>))
        .route("/left/extensions/toggle", post(extension_toggle::<B>))
        .route("/left/settings", get(settings_summary::<B>))
}

// ---------- errors / helpers ----------

fn bad_request(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}
fn not_found(msg: &str) -> ApiError {
    ApiError(StatusCode::NOT_FOUND, msg.to_string())
}
fn internal(e: impl std::fmt::Display) -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
fn bad_gateway(e: String) -> ApiError {
    ApiError(StatusCode::BAD_GATEWAY, e)
}

fn app<B: Backend>(ctx: &Ctx<B>) -> Result<&AppState, ApiError> {
    ctx.backend.app_state().ok_or_else(|| {
        ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "app state unavailable".into(),
        )
    })
}

fn ok_json() -> Json<Value> {
    Json(json!({ "ok": true }))
}

// ---------- path / time helpers (pure) ----------

/// Strip trailing slashes and the macOS `/private` prefix so `/private/var/x`
/// and `/var/x` compare equal.
fn norm_path(p: &str) -> String {
    let clean = p.trim_end_matches('/');
    match clean.strip_prefix("/private/") {
        Some(rest) => format!("/{rest}"),
        None => clean.to_string(),
    }
}

/// `child` equals `parent` or lies below it (component-wise, `/` separated).
fn is_inside(child: &str, parent: &str) -> bool {
    let (c, p) = (child.trim_end_matches('/'), parent.trim_end_matches('/'));
    if p.is_empty() {
        return false;
    }
    c == p || c.strip_prefix(p).is_some_and(|rest| rest.starts_with('/'))
}

fn is_inside_canon(child: &str, parent: &str) -> bool {
    is_inside(child, parent) || is_inside(&norm_path(child), &norm_path(parent))
}

fn basename(p: &str) -> String {
    p.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}

/// Worktree name from a cwd laid out as `<repo>/.worktrees/<n>` or
/// `<repo>/.cache/wt-<n>` (used when git metadata is gone).
fn infer_worktree_name(cwd: &str) -> Option<String> {
    let parts: Vec<&str> = cwd.split(['/', '\\']).collect();
    for (i, seg) in parts.iter().enumerate() {
        let Some(next) = parts.get(i + 1).filter(|n| !n.is_empty()) else {
            continue;
        };
        if *seg == ".worktrees" || (*seg == ".cache" && next.starts_with("wt-")) {
            return Some((*next).to_string());
        }
    }
    None
}

fn parse_ts(s: &str) -> i64 {
    DateTime::parse_from_rfc3339(s)
        .map(|t| t.timestamp_millis())
        .unwrap_or(0)
}

fn session_ts(s: &SessionMeta) -> i64 {
    parse_ts(if s.updated_at.is_empty() {
        &s.created_at
    } else {
        &s.updated_at
    })
}

fn sort_recent(list: &mut [SessionMeta]) {
    list.sort_by(|a, b| {
        session_ts(b)
            .cmp(&session_ts(a))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn is_busy_status(s: SessionStatus) -> bool {
    matches!(
        s,
        SessionStatus::Working | SessionStatus::AwaitingApproval | SessionStatus::AwaitingAnswer
    )
}

/// Unsent side-chat stub: a fork row blank in every content signal.
fn is_empty_side_chat(s: &SessionMeta) -> bool {
    s.parent_id.is_some()
        && s.status == SessionStatus::Idle
        && s.pending.is_none()
        && !s.unread
        && s.title.trim().is_empty()
        && s.label.trim().is_empty()
        && s.last_assistant.is_none()
}

/// Archived directly, or via an archived ancestor (never for live / pinned /
/// pending / busy children).
fn is_archived_cascaded(s: &SessionMeta, by_id: &HashMap<&str, &SessionMeta>) -> bool {
    if s.archived {
        return true;
    }
    if s.live || s.pinned || s.pending.is_some() || is_busy_status(s.status) {
        return false;
    }
    let mut seen = vec![s.id.as_str()];
    let mut cur = s;
    while let Some(pid) = cur.parent_id.as_deref() {
        if seen.contains(&pid) {
            break;
        }
        seen.push(pid);
        let Some(parent) = by_id.get(pid) else { break };
        if parent.archived {
            return true;
        }
        cur = parent;
    }
    false
}

/// AND-matching of whitespace separated tokens, as `matchesSearch` on desktop.
fn matches_search(s: &SessionMeta, query: &str, workspace_path: Option<&str>) -> bool {
    let q = query.trim().to_lowercase();
    let tokens: Vec<&str> = q.split_whitespace().collect();
    if tokens.is_empty() {
        return true;
    }
    let cwd_term = if s.cwd.is_empty() {
        String::new()
    } else {
        match workspace_path.filter(|w| is_inside_canon(&s.cwd, w)) {
            Some(w) => {
                let rel = norm_path(&s.cwd)
                    .strip_prefix(&norm_path(w))
                    .map(|r| r.trim_start_matches('/').to_string())
                    .unwrap_or_default();
                if rel.is_empty() {
                    basename(&s.cwd)
                } else {
                    format!("{rel} {}", basename(&s.cwd))
                }
            }
            None => basename(&s.cwd),
        }
    }
    .to_lowercase();
    let git = s.git.as_ref();
    let fields = [
        s.title.to_lowercase(),
        s.label.to_lowercase(),
        git.and_then(|g| g.branch.clone())
            .unwrap_or_default()
            .to_lowercase(),
        git.and_then(|g| g.worktree.clone())
            .unwrap_or_default()
            .to_lowercase(),
        s.model.clone().unwrap_or_default().to_lowercase(),
        s.last_assistant.clone().unwrap_or_default().to_lowercase(),
        cwd_term,
    ];
    tokens.iter().all(|t| fields.iter().any(|f| f.contains(t)))
}

// ---------- session tree ----------

/// Live git worktree of a repo (first entry of the list = main checkout).
#[derive(Debug, Clone)]
struct Wt {
    path: String,
    branch: Option<String>,
    session_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Subgroup {
    key: String,
    kind: &'static str,
    label: String,
    deleted: bool,
    is_main: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    create_cwd: Option<String>,
    sessions: Vec<SessionMeta>,
    total_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGroup {
    workspace: Workspace,
    is_global: bool,
    subgroups: Vec<Subgroup>,
    deleted_subgroups: Vec<Subgroup>,
    total_count: usize,
    pinned_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnassignedGroup {
    key: String,
    cwd: String,
    label: String,
    sessions: Vec<SessionMeta>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionTree {
    mode: SpaceMode,
    pinned: Vec<SessionMeta>,
    global_group: Option<WorkspaceGroup>,
    workspace_groups: Vec<WorkspaceGroup>,
    unassigned_groups: Vec<UnassignedGroup>,
    deleted_sessions: Vec<SessionMeta>,
    archived: Vec<SessionMeta>,
    session_groups: Vec<SessionGroup>,
    total_visible: usize,
}

struct Bucket {
    key: String,
    kind: &'static str,
    label: String,
    deleted: bool,
    is_main: bool,
    items: Vec<SessionMeta>,
}

/// Port of desktop `createSubgroups` (sessions already filtered, non-pinned).
fn build_subgroups(sessions: &[&SessionMeta], wts: Option<&[Wt]>) -> Vec<Subgroup> {
    let wts_slice = wts.unwrap_or(&[]);
    let has_live_list = !wts_slice.is_empty();
    // Deepest worktree first so nested worktree dirs win over the main checkout.
    let mut live: Vec<(&Wt, String, bool)> = wts_slice
        .iter()
        .map(|w| {
            (
                w,
                norm_path(&w.path),
                infer_worktree_name(&w.path).is_some(),
            )
        })
        .collect();
    live.sort_by_key(|(w, _, _)| std::cmp::Reverse(w.path.len()));

    let mut wt_items: HashMap<&str, Vec<SessionMeta>> = HashMap::new();
    let mut buckets: Vec<Bucket> = Vec::new();

    'sessions: for s in sessions {
        // 1. explicit session id attachment
        if let Some(w) = wts_slice
            .iter()
            .find(|w| w.session_ids.iter().any(|id| id == &s.id))
        {
            wt_items.entry(&w.path).or_default().push((*s).clone());
            continue;
        }
        // 2. deepest cwd containment
        if has_live_list {
            let in_wt_dir = infer_worktree_name(&s.cwd).is_some();
            let norm_cwd = norm_path(&s.cwd);
            if let Some((w, _, _)) = live.iter().find(|(w, np, is_wt_dir)| {
                (is_inside(&s.cwd, &w.path) || is_inside(&norm_cwd, np))
                    && (!in_wt_dir || *is_wt_dir)
            }) {
                wt_items.entry(&w.path).or_default().push((*s).clone());
                continue 'sessions;
            }
        }
        // 3. badge / inferred buckets
        let inferred = infer_worktree_name(&s.cwd);
        let git = s.git.as_ref();
        let (key, kind, label, deleted, is_main) =
            if let (true, Some(name)) = (has_live_list, inferred.as_ref()) {
                (format!("wt:{name}"), "worktree", name.clone(), true, false)
            } else if let Some(wt) = git.and_then(|g| g.worktree.as_ref()) {
                let label = wt
                    .rsplit(['/', '\\'])
                    .next()
                    .filter(|l| !l.is_empty())
                    .unwrap_or(wt)
                    .to_string();
                (format!("wt:{wt}"), "worktree", label, false, false)
            } else if let Some(br) = git.and_then(|g| g.branch.as_ref()) {
                // Before the worktree list is known (non-git / failed lookup), branch
                // buckets are treated as main so the layout stays stable.
                (
                    format!("br:{br}"),
                    "branch",
                    br.clone(),
                    false,
                    wts.is_none(),
                )
            } else if let Some(name) = inferred {
                (format!("wt:{name}"), "worktree", name, true, false)
            } else {
                (
                    "default".to_string(),
                    "default",
                    "其他".to_string(),
                    false,
                    false,
                )
            };
        match buckets.iter_mut().find(|b| b.key == key) {
            Some(b) => b.items.push((*s).clone()),
            None => buckets.push(Bucket {
                key,
                kind,
                label,
                deleted,
                is_main,
                items: vec![(*s).clone()],
            }),
        }
    }

    let mut out: Vec<Subgroup> = Vec::new();
    let mut live_subs: Vec<Subgroup> = wts_slice
        .iter()
        .enumerate()
        .map(|(i, w)| {
            let mut items = wt_items.remove(w.path.as_str()).unwrap_or_default();
            sort_recent(&mut items);
            Subgroup {
                key: format!("wtp:{}", w.path),
                kind: "worktree",
                label: w.branch.clone().unwrap_or_else(|| basename(&w.path)),
                deleted: false,
                is_main: i == 0,
                path: Some(w.path.clone()),
                create_cwd: Some(w.path.clone()),
                total_count: items.len(),
                sessions: items,
            }
        })
        .collect();
    live_subs.sort_by(|a, b| {
        b.is_main
            .cmp(&a.is_main)
            .then_with(|| a.label.cmp(&b.label))
    });
    out.extend(live_subs);
    out.extend(buckets.into_iter().map(|mut b| {
        sort_recent(&mut b.items);
        Subgroup {
            key: b.key,
            kind: b.kind,
            label: b.label,
            deleted: b.deleted,
            is_main: b.is_main,
            path: None,
            create_cwd: b.items.first().map(|s| s.cwd.clone()),
            total_count: b.items.len(),
            sessions: b.items,
        }
    }));
    out.sort_by(|a, b| {
        a.deleted
            .cmp(&b.deleted)
            .then_with(|| b.is_main.cmp(&a.is_main))
            .then_with(|| (b.kind == "default").cmp(&(a.kind == "default")))
            .then_with(|| a.label.cmp(&b.label))
    });
    out
}

fn build_tree(
    metas: &[SessionMeta],
    workspaces: &[Workspace],
    session_groups: Vec<SessionGroup>,
    mode: SpaceMode,
    wts: &HashMap<String, Vec<Wt>>,
) -> SessionTree {
    let by_id: HashMap<&str, &SessionMeta> = metas.iter().map(|s| (s.id.as_str(), s)).collect();
    let mut archived: Vec<SessionMeta> = Vec::new();
    let mut visible: Vec<&SessionMeta> = Vec::new();
    for s in metas
        .iter()
        .filter(|s| s.mode == mode && !is_empty_side_chat(s))
    {
        if is_archived_cascaded(s, &by_id) {
            archived.push(s.clone());
        } else {
            visible.push(s);
        }
    }
    sort_recent(&mut archived);

    let mut pinned: Vec<SessionMeta> = visible
        .iter()
        .filter(|s| s.pinned)
        .map(|s| (*s).clone())
        .collect();
    sort_recent(&mut pinned);

    let mode_ws: Vec<&Workspace> = workspaces.iter().filter(|w| w.mode == mode).collect();
    let global_ws = mode_ws
        .iter()
        .find(|w| w.kind == WorkspaceKind::Global)
        .copied();
    let mut project_ws: Vec<&Workspace> = mode_ws
        .iter()
        .filter(|w| w.kind != WorkspaceKind::Global)
        .copied()
        .collect();
    project_ws.sort_by(|a, b| a.sort.cmp(&b.sort).then_with(|| a.name.cmp(&b.name)));

    let make_group = |ws: &Workspace, is_global: bool| -> WorkspaceGroup {
        let in_ws = |s: &&&SessionMeta| s.workspace_id.as_deref() == Some(ws.id.as_str());
        let items: Vec<&SessionMeta> = visible
            .iter()
            .filter(in_ws)
            .filter(|s| !s.pinned)
            .copied()
            .collect();
        let pinned_count = visible.iter().filter(in_ws).filter(|s| s.pinned).count();
        let subs = build_subgroups(&items, wts.get(&ws.id).map(Vec::as_slice));
        let (deleted_subgroups, subgroups): (Vec<_>, Vec<_>) =
            subs.into_iter().partition(|s| s.deleted);
        WorkspaceGroup {
            workspace: ws.clone(),
            is_global,
            subgroups,
            deleted_subgroups,
            total_count: items.len() + pinned_count,
            pinned_count,
        }
    };

    let global_group = global_ws.map(|w| make_group(w, true));
    let workspace_groups: Vec<WorkspaceGroup> =
        project_ws.iter().map(|w| make_group(w, false)).collect();

    let known: Vec<&str> = mode_ws.iter().map(|w| w.id.as_str()).collect();
    let is_deleted_wt = |s: &SessionMeta| {
        s.git
            .as_ref()
            .map_or(true, |g| g.worktree.is_none() && g.branch.is_none())
            && infer_worktree_name(&s.cwd).is_some()
    };
    let mut deleted_sessions: Vec<SessionMeta> = Vec::new();
    let mut unassigned_map: Vec<(String, i64, Vec<SessionMeta>)> = Vec::new();
    for s in visible.iter().filter(|s| {
        !s.pinned
            && !s
                .workspace_id
                .as_deref()
                .is_some_and(|id| known.contains(&id))
    }) {
        if is_deleted_wt(s) {
            deleted_sessions.push((*s).clone());
            continue;
        }
        let root = s.repo_root.clone().unwrap_or_else(|| s.cwd.clone());
        let ts = session_ts(s);
        match unassigned_map.iter_mut().find(|(k, _, _)| *k == root) {
            Some((_, newest, items)) => {
                *newest = (*newest).max(ts);
                items.push((*s).clone());
            }
            None => unassigned_map.push((root, ts, vec![(*s).clone()])),
        }
    }
    sort_recent(&mut deleted_sessions);
    unassigned_map.sort_by_key(|(_, newest, _)| std::cmp::Reverse(*newest));
    let unassigned_groups: Vec<UnassignedGroup> = unassigned_map
        .into_iter()
        .map(|(cwd, _, mut sessions)| {
            sort_recent(&mut sessions);
            UnassignedGroup {
                label: {
                    let b = basename(&cwd);
                    if b.is_empty() {
                        cwd.clone()
                    } else {
                        b
                    }
                },
                key: cwd.clone(),
                cwd,
                sessions,
            }
        })
        .collect();

    SessionTree {
        mode,
        pinned,
        global_group,
        workspace_groups,
        unassigned_groups,
        deleted_sessions,
        archived,
        session_groups,
        total_visible: visible.len(),
    }
}

/// Live worktrees of the repo at `path`, or `None` when it is not a git repo.
fn list_worktrees_blocking(path: &str, pairs: &[(String, String)]) -> Option<Vec<Wt>> {
    let root = crate::git::worktree::repo_info(FsPath::new(path))?.main_root();
    let list = crate::git::worktree::list(&root, pairs).ok()?;
    Some(
        list.into_iter()
            .map(|w| Wt {
                path: w.path,
                branch: w.branch,
                session_ids: w.session_ids,
            })
            .collect(),
    )
}

#[derive(Deserialize)]
struct TreeQuery {
    mode: Option<SpaceMode>,
}

async fn session_tree<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Query(q): Query<TreeQuery>,
) -> ApiResult<SessionTree> {
    let st = app(&ctx)?;
    let mode = q.mode.unwrap_or_default();
    let metas = ctx.backend.sessions().await;
    let (workspaces, groups) = {
        let db = st.db.lock();
        (
            store::list_workspaces(&db).map_err(internal)?,
            store::list_session_groups(&db).map_err(internal)?,
        )
    };
    let pairs: Arc<Vec<(String, String)>> = Arc::new(
        metas
            .iter()
            .map(|s| (s.id.clone(), s.cwd.clone()))
            .collect(),
    );
    let handles: Vec<_> = workspaces
        .iter()
        .filter(|w| w.mode == mode && w.kind != WorkspaceKind::Global)
        .map(|w| {
            let (id, path, pairs) = (w.id.clone(), w.path.clone(), pairs.clone());
            let h = tokio::task::spawn_blocking(move || list_worktrees_blocking(&path, &pairs));
            (id, h)
        })
        .collect();
    let mut wts: HashMap<String, Vec<Wt>> = HashMap::new();
    for (id, h) in handles {
        if let Ok(Some(list)) = h.await {
            wts.insert(id, list);
        }
    }
    Ok(Json(build_tree(&metas, &workspaces, groups, mode, &wts)))
}

// ---------- allowed directories ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    path: String,
    label: String,
    kind: &'static str,
    workspace_id: String,
    mode: SpaceMode,
    #[serde(skip)]
    canon: PathBuf,
}

/// Registered workspaces plus their live worktrees (deduplicated by path).
async fn allowed_dirs(st: &AppState, metas: &[SessionMeta]) -> Result<Vec<DirEntry>, ApiError> {
    let workspaces = {
        let db = st.db.lock();
        store::list_workspaces(&db).map_err(internal)?
    };
    let pairs: Arc<Vec<(String, String)>> = Arc::new(
        metas
            .iter()
            .map(|s| (s.id.clone(), s.cwd.clone()))
            .collect(),
    );
    let mut handles = Vec::new();
    for w in &workspaces {
        if w.kind == WorkspaceKind::Global {
            continue;
        }
        let (path, pairs) = (w.path.clone(), pairs.clone());
        handles.push(tokio::task::spawn_blocking(move || {
            list_worktrees_blocking(&path, &pairs)
        }));
    }
    let mut handles = handles.into_iter();
    let mut out: Vec<DirEntry> = Vec::new();
    let push = |out: &mut Vec<DirEntry>, e: DirEntry| {
        if !out.iter().any(|x| x.path == e.path) {
            out.push(e);
        }
    };
    for w in &workspaces {
        let global = w.kind == WorkspaceKind::Global;
        push(
            &mut out,
            DirEntry {
                path: w.path.clone(),
                label: w.name.clone(),
                kind: if global { "global" } else { "workspace" },
                workspace_id: w.id.clone(),
                mode: w.mode,
                canon: std::fs::canonicalize(&w.path).unwrap_or_else(|_| PathBuf::from(&w.path)),
            },
        );
        if global {
            continue;
        }
        let Some(handle) = handles.next() else {
            continue;
        };
        if let Ok(Some(list)) = handle.await {
            for wt in list.into_iter().skip(1) {
                let label = format!(
                    "{} · {}",
                    w.name,
                    wt.branch.clone().unwrap_or_else(|| basename(&wt.path))
                );
                push(
                    &mut out,
                    DirEntry {
                        canon: std::fs::canonicalize(&wt.path)
                            .unwrap_or_else(|_| PathBuf::from(&wt.path)),
                        path: wt.path,
                        label,
                        kind: "worktree",
                        workspace_id: w.id.clone(),
                        mode: w.mode,
                    },
                );
            }
        }
    }
    Ok(out)
}

/// Deepest allowed directory containing `cwd` (both canonical).
fn resolve_dir<'a>(cwd: &FsPath, dirs: &'a [DirEntry]) -> Option<&'a DirEntry> {
    dirs.iter()
        .filter(|d| cwd.starts_with(&d.canon))
        .max_by_key(|d| d.canon.components().count())
}

/// Validates `cwd` is an existing directory inside an allowed root.
async fn confine_cwd<'a>(
    cwd: &str,
    dirs: &'a [DirEntry],
) -> Result<(&'a DirEntry, String), ApiError> {
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Err(bad_request("目录不能为空"));
    }
    let canon = std::fs::canonicalize(cwd).map_err(|_| bad_request("目录不存在"))?;
    if !canon.is_dir() {
        return Err(bad_request("目录不存在"));
    }
    let entry = resolve_dir(&canon, dirs).ok_or_else(|| bad_request("目录不在已登记的工作区内"))?;
    Ok((entry, cwd.to_string()))
}

async fn list_dirs<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let metas = ctx.backend.sessions().await;
    let dirs = allowed_dirs(st, &metas).await?;
    Ok(Json(json!({ "dirs": dirs })))
}

// ---------- session actions ----------

#[derive(Deserialize)]
struct NewSessionBody {
    cwd: String,
}

async fn new_session<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Json(body): Json<NewSessionBody>,
) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let metas = ctx.backend.sessions().await;
    let dirs = allowed_dirs(st, &metas).await?;
    let (entry, cwd) = confine_cwd(&body.cwd, &dirs).await?;
    let mode = if entry.kind == "global" {
        SpaceMode::Chat
    } else {
        entry.mode
    };
    let info = crate::rpc::start(
        st,
        &StartOpts {
            cwd,
            mode: Some(mode),
            ..Default::default()
        },
    )
    .await
    .map_err(bad_gateway)?;
    Ok(Json(serde_json::to_value(info).map_err(internal)?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatchSessionBody {
    custom_name: Option<String>,
    pinned: Option<bool>,
    archived: Option<bool>,
}

async fn patch_session<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<PatchSessionBody>,
) -> ApiResult<SessionMeta> {
    let st = app(&ctx)?;
    if ctx.backend.session(&id).await.is_none() {
        return Err(not_found("会话不存在"));
    }
    if body
        .custom_name
        .as_ref()
        .is_some_and(|n| n.chars().count() > 200)
    {
        return Err(bad_request("名称过长"));
    }
    let patch = SessionMetaPatch {
        custom_name: body.custom_name,
        pinned: body.pinned,
        archived: body.archived,
        workspace_id: None,
    };
    let state = st.app.state::<AppState>();
    let meta = crate::catalog::commands::update_session_meta(state, id, patch)
        .await
        .map_err(bad_gateway)?;
    Ok(Json(meta))
}

// ---------- inbox ----------

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct InboxGroups {
    awaiting: Vec<SessionMeta>,
    error: Vec<SessionMeta>,
    unread: Vec<SessionMeta>,
    running: Vec<SessionMeta>,
    /// awaiting + error + unread (running excluded).
    badge: usize,
}

/// Port of `groupInbox`: archived never show; awaiting/running never expire;
/// error/unread drop out once older than the window.
fn group_inbox(metas: &[SessionMeta], now: DateTime<Utc>, window_hours: u32) -> InboxGroups {
    let cutoff = now.timestamp_millis() - i64::from(window_hours.clamp(1, 720)) * 3_600_000;
    let mut g = InboxGroups::default();
    for s in metas.iter().filter(|s| !s.archived) {
        let Some(kind) = s.attention else { continue };
        let expired = !matches!(kind, Attention::Awaiting | Attention::Running)
            && DateTime::parse_from_rfc3339(&s.updated_at)
                .is_ok_and(|t| t.timestamp_millis() < cutoff);
        if expired {
            continue;
        }
        match kind {
            Attention::Awaiting => g.awaiting.push(s.clone()),
            Attention::Error => g.error.push(s.clone()),
            Attention::Unread => g.unread.push(s.clone()),
            Attention::Running => g.running.push(s.clone()),
        }
    }
    for list in [&mut g.awaiting, &mut g.error, &mut g.unread, &mut g.running] {
        sort_recent(list);
    }
    g.badge = g.awaiting.len() + g.error.len() + g.unread.len();
    g
}

async fn inbox<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let hours = st.settings.read().inbox_window_hours;
    let metas = ctx.backend.sessions().await;
    let g = group_inbox(&metas, Utc::now(), hours);
    let mut v = serde_json::to_value(&g).map_err(internal)?;
    v["windowHours"] = json!(hours.clamp(1, 720));
    v["order"] = json!(["awaiting", "error", "unread", "running"]);
    Ok(Json(v))
}

async fn mark_seen(st: &AppState, id: &str) -> Result<(), ApiError> {
    crate::catalog::commands::mark_seen(st.app.state::<AppState>(), id.to_string())
        .await
        .map_err(bad_gateway)
}

async fn inbox_seen<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let st = app(&ctx)?;
    if ctx.backend.session(&id).await.is_none() {
        return Err(not_found("会话不存在"));
    }
    mark_seen(st, &id).await?;
    Ok(ok_json())
}

async fn inbox_read_all<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let hours = st.settings.read().inbox_window_hours;
    let metas = ctx.backend.sessions().await;
    let g = group_inbox(&metas, Utc::now(), hours);
    let mut count = 0;
    for s in g.unread.iter().chain(g.error.iter()) {
        mark_seen(st, &s.id).await?;
        count += 1;
    }
    Ok(Json(json!({ "ok": true, "count": count })))
}

// ---------- search ----------

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    mode: Option<SpaceMode>,
    archived: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BranchHit {
    branch: String,
    workspace_id: Option<String>,
    count: usize,
    session_ids: Vec<String>,
}

const MAX_SEARCH_SESSIONS: usize = 100;

fn search_sessions(
    metas: &[SessionMeta],
    workspaces: &[Workspace],
    q: &str,
    mode: Option<SpaceMode>,
    include_archived: bool,
) -> (Vec<SessionMeta>, Vec<BranchHit>) {
    if q.trim().is_empty() {
        return (Vec::new(), Vec::new());
    }
    let by_id: HashMap<&str, &SessionMeta> = metas.iter().map(|s| (s.id.as_str(), s)).collect();
    let ws_path: HashMap<&str, &str> = workspaces
        .iter()
        .map(|w| (w.id.as_str(), w.path.as_str()))
        .collect();
    let candidates: Vec<&SessionMeta> = metas
        .iter()
        .filter(|s| mode.map_or(true, |m| s.mode == m))
        .filter(|s| !is_empty_side_chat(s))
        .filter(|s| include_archived || !is_archived_cascaded(s, &by_id))
        .collect();
    let mut hits: Vec<SessionMeta> = candidates
        .iter()
        .filter(|s| {
            let wp = s
                .workspace_id
                .as_deref()
                .and_then(|id| ws_path.get(id).copied());
            matches_search(s, q, wp)
        })
        .map(|s| (*s).clone())
        .collect();
    sort_recent(&mut hits);
    hits.truncate(MAX_SEARCH_SESSIONS);

    // Branch hits: every query token must appear in the branch name.
    let tokens: Vec<String> = q.split_whitespace().map(str::to_lowercase).collect();
    let mut branches: Vec<(BranchHit, i64)> = Vec::new();
    for s in &candidates {
        let Some(branch) = s.git.as_ref().and_then(|g| g.branch.as_ref()) else {
            continue;
        };
        let lower = branch.to_lowercase();
        if !tokens.iter().all(|t| lower.contains(t)) {
            continue;
        }
        let ts = session_ts(s);
        match branches
            .iter_mut()
            .find(|(b, _)| b.branch == *branch && b.workspace_id == s.workspace_id)
        {
            Some((b, newest)) => {
                b.count += 1;
                *newest = (*newest).max(ts);
            }
            None => branches.push((
                BranchHit {
                    branch: branch.clone(),
                    workspace_id: s.workspace_id.clone(),
                    count: 1,
                    session_ids: Vec::new(),
                },
                ts,
            )),
        }
    }
    // Fill newest session ids per branch (candidates are unsorted).
    let mut ordered: Vec<&&SessionMeta> = candidates.iter().collect();
    ordered.sort_by_key(|s| std::cmp::Reverse(session_ts(s)));
    for s in ordered {
        let Some(branch) = s.git.as_ref().and_then(|g| g.branch.as_ref()) else {
            continue;
        };
        if let Some((b, _)) = branches
            .iter_mut()
            .find(|(b, _)| b.branch == *branch && b.workspace_id == s.workspace_id)
        {
            if b.session_ids.len() < 5 {
                b.session_ids.push(s.id.clone());
            }
        }
    }
    branches.sort_by_key(|(_, newest)| std::cmp::Reverse(*newest));
    (hits, branches.into_iter().map(|(b, _)| b).collect())
}

async fn search<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Query(q): Query<SearchQuery>,
) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let metas = ctx.backend.sessions().await;
    let workspaces = {
        let db = st.db.lock();
        store::list_workspaces(&db).map_err(internal)?
    };
    let include_archived = matches!(q.archived.as_deref(), Some("1" | "true"));
    let (sessions, branches) = search_sessions(
        &metas,
        &workspaces,
        q.q.as_deref().unwrap_or(""),
        q.mode,
        include_archived,
    );
    Ok(Json(json!({ "sessions": sessions, "branches": branches })))
}

// ---------- schedules ----------

fn schedule_exists(st: &AppState, id: &str) -> Result<(), ApiError> {
    let found = {
        let db = st.db.lock();
        sched_store::get(&db, id).map_err(internal)?
    };
    found.map(|_| ()).ok_or_else(|| not_found("定时任务不存在"))
}

async fn validate_draft<B: Backend>(
    ctx: &Ctx<B>,
    st: &AppState,
    draft: &ScheduleDraft,
) -> Result<(), ApiError> {
    if draft.name.trim().is_empty() {
        return Err(bad_request("请填写任务名称"));
    }
    if draft.prompt.trim().is_empty() {
        return Err(bad_request("请填写提示词"));
    }
    let metas = ctx.backend.sessions().await;
    let dirs = allowed_dirs(st, &metas).await?;
    confine_cwd(&draft.cwd, &dirs).await.map(|_| ())
}

async fn schedules_list<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
) -> ApiResult<Vec<crate::contracts::Schedule>> {
    let st = app(&ctx)?;
    let list = {
        let db = st.db.lock();
        sched_store::list(&db).map_err(internal)?
    };
    Ok(Json(list))
}

async fn schedules_create<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Json(mut draft): Json<ScheduleDraft>,
) -> ApiResult<crate::contracts::Schedule> {
    let st = app(&ctx)?;
    draft.id = None;
    validate_draft(&ctx, st, &draft).await?;
    let saved = crate::schedules::commands::schedules_save(st.app.state::<AppState>(), draft)
        .await
        .map_err(bad_request)?;
    Ok(Json(saved))
}

async fn schedules_update<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(mut draft): Json<ScheduleDraft>,
) -> ApiResult<crate::contracts::Schedule> {
    let st = app(&ctx)?;
    schedule_exists(st, &id)?;
    draft.id = Some(id);
    validate_draft(&ctx, st, &draft).await?;
    let saved = crate::schedules::commands::schedules_save(st.app.state::<AppState>(), draft)
        .await
        .map_err(bad_request)?;
    Ok(Json(saved))
}

async fn schedules_delete<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let st = app(&ctx)?;
    schedule_exists(st, &id)?;
    crate::schedules::commands::schedules_delete(st.app.state::<AppState>(), id)
        .await
        .map_err(bad_request)?;
    Ok(ok_json())
}

#[derive(Deserialize)]
struct EnabledBody {
    enabled: bool,
}

async fn schedules_enabled<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<EnabledBody>,
) -> ApiResult<crate::contracts::Schedule> {
    let st = app(&ctx)?;
    schedule_exists(st, &id)?;
    let updated = crate::schedules::commands::schedules_set_enabled(
        st.app.state::<AppState>(),
        id,
        body.enabled,
    )
    .await
    .map_err(bad_request)?;
    Ok(Json(updated))
}

async fn schedules_run<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<crate::contracts::ScheduleRun> {
    let st = app(&ctx)?;
    schedule_exists(st, &id)?;
    let run = runner::run_now(st.clone(), id).await.map_err(bad_request)?;
    Ok(Json(run))
}

#[derive(Deserialize)]
struct RunsQuery {
    limit: Option<u32>,
}

async fn schedules_runs<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Query(q): Query<RunsQuery>,
) -> ApiResult<Vec<crate::contracts::ScheduleRun>> {
    let st = app(&ctx)?;
    schedule_exists(st, &id)?;
    let runs = {
        let db = st.db.lock();
        sched_store::list_runs(&db, &id, q.limit.unwrap_or(20).clamp(1, 100)).map_err(internal)?
    };
    Ok(Json(runs))
}

// ---------- skills ----------

/// Slice of OMP config deciding which skills reach a new session.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SkillConfig {
    skills_enabled: bool,
    disabled_extensions: Vec<String>,
    ignored: Vec<String>,
    include: Vec<String>,
    source_toggles: HashMap<String, bool>,
}

impl Default for SkillConfig {
    fn default() -> Self {
        Self {
            skills_enabled: true,
            disabled_extensions: Vec::new(),
            ignored: Vec::new(),
            include: Vec::new(),
            source_toggles: HashMap::new(),
        }
    }
}

fn str_list(v: &Option<Value>) -> Vec<String> {
    v.as_ref()
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_skill_config(entries: &[crate::settings::OmpConfigEntry]) -> SkillConfig {
    let mut cfg = SkillConfig::default();
    for e in entries {
        match e.key.as_str() {
            "skills.enabled" => {
                if let Some(b) = e.value.as_ref().and_then(Value::as_bool) {
                    cfg.skills_enabled = b;
                }
            }
            "skills.ignoredSkills" => cfg.ignored = str_list(&e.value),
            "skills.includeSkills" => cfg.include = str_list(&e.value),
            "disabledExtensions" => cfg.disabled_extensions = str_list(&e.value),
            k if k.starts_with("skills.enable") => {
                if let Some(b) = e.value.as_ref().and_then(Value::as_bool) {
                    cfg.source_toggles.insert(k.to_string(), b);
                }
            }
            _ => {}
        }
    }
    cfg
}

/// Anchored glob (`*`, `?`; `**` ≡ `*`), case-sensitive.
fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    let (mut pi, mut ni) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == '?' || (p[pi] != '*' && p[pi] == n[ni])) {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ni;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ni = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

fn source_toggle_key(provider: &str, source: &str) -> Option<&'static str> {
    Some(match (provider, source) {
        ("native", "user") => "skills.enablePiUser",
        ("native", "project") => "skills.enablePiProject",
        ("claude", "user") => "skills.enableClaudeUser",
        ("claude", "project") => "skills.enableClaudeProject",
        ("agents", "user") => "skills.enableAgentsUser",
        ("agents", "project") => "skills.enableAgentsProject",
        ("codex", "user") => "skills.enableCodexUser",
        _ => return None,
    })
}

/// OMP's session-start filter pipeline for one skill; `Err(reason)` = disabled.
fn skill_enablement(
    name: &str,
    provider: &str,
    source: &str,
    cfg: &SkillConfig,
) -> Result<(), Value> {
    if !cfg.skills_enabled {
        return Err(json!({ "kind": "all_off" }));
    }
    if cfg
        .disabled_extensions
        .iter()
        .any(|e| e == &format!("skill:{name}"))
    {
        return Err(json!({ "kind": "disabled" }));
    }
    if let Some(key) = source_toggle_key(provider, source) {
        if cfg.source_toggles.get(key) == Some(&false) {
            return Err(json!({ "kind": "source", "key": key }));
        }
    }
    if cfg.ignored.iter().any(|p| p == name) {
        return Err(json!({ "kind": "ignored", "pattern": name, "exact": true }));
    }
    if let Some(p) = cfg.ignored.iter().find(|p| glob_match(p, name)) {
        return Err(json!({ "kind": "ignored", "pattern": p, "exact": false }));
    }
    if !cfg.include.is_empty() && !cfg.include.iter().any(|p| glob_match(p, name)) {
        return Err(json!({ "kind": "not_included" }));
    }
    Ok(())
}

/// New `(disabledExtensions, ignoredSkills)` for a skill toggle; the ignored
/// list is `Some` only when an exact-name entry must be cleared.
fn apply_skill_toggle(
    disabled: &[String],
    ignored: &[String],
    name: &str,
    enabled: bool,
) -> (Vec<String>, Option<Vec<String>>) {
    let marker = format!("skill:{name}");
    let mut next: Vec<String> = disabled.iter().filter(|e| **e != marker).cloned().collect();
    if !enabled {
        next.push(marker);
    }
    let clear_ignored = enabled && ignored.iter().any(|p| p == name);
    let ign = clear_ignored.then(|| ignored.iter().filter(|p| *p != name).cloned().collect());
    (next, ign)
}

fn apply_extension_toggle(
    disabled: &[String],
    name: &str,
    path: &str,
    enabled: bool,
) -> Vec<String> {
    let module = format!("extension-module:{name}");
    let mut next: Vec<String> = disabled
        .iter()
        .filter(|e| !enabled || (**e != name && **e != module && **e != path))
        .cloned()
        .collect();
    if !enabled && !next.iter().any(|e| e == name) {
        next.push(name.to_string());
    }
    next
}

async fn read_skill_config(st: &AppState) -> Result<SkillConfig, String> {
    let list = crate::settings::omp_config_list(st.app.state::<AppState>()).await?;
    if !list.found {
        return Err(list.error.unwrap_or_else(|| "无法读取 OMP 配置".into()));
    }
    Ok(parse_skill_config(&list.entries))
}

async fn set_list_setting(st: &AppState, key: &str, list: &[String]) -> Result<(), ApiError> {
    let value = serde_json::to_string(list).map_err(internal)?;
    crate::settings::omp_config_set(st.app.state::<AppState>(), key.to_string(), value)
        .await
        .map_err(bad_gateway)
}

/// Serializes read-modify-write cycles of OMP list settings.
static SKILL_CFG_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Deserialize)]
struct CwdQuery {
    cwd: Option<String>,
}

async fn catalog_for<B: Backend>(
    ctx: &Ctx<B>,
    st: &AppState,
    cwd: Option<&str>,
) -> Result<crate::contracts::SkillsCatalog, ApiError> {
    let cwd = match cwd.map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) => {
            let metas = ctx.backend.sessions().await;
            let dirs = allowed_dirs(st, &metas).await?;
            Some(confine_cwd(c, &dirs).await?.1)
        }
        None => None,
    };
    crate::skills::commands::skills_list(cwd)
        .await
        .map_err(bad_gateway)
}

async fn skills_list<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Query(q): Query<CwdQuery>,
) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let catalog = catalog_for(&ctx, st, q.cwd.as_deref()).await?;
    let (cfg, config_error) = match read_skill_config(st).await {
        Ok(c) => (c, None),
        Err(e) => (SkillConfig::default(), Some(e)),
    };
    let skills: Vec<Value> = catalog
        .skills
        .iter()
        .map(|s| {
            let mut v = serde_json::to_value(s).unwrap_or(Value::Null);
            let provider = v["provider"].as_str().unwrap_or("").to_string();
            let verdict = skill_enablement(&s.name, &provider, &s.source, &cfg);
            v["enabled"] = json!(verdict.is_ok());
            v["disabledReason"] = verdict.err().unwrap_or(Value::Null);
            v
        })
        .collect();
    Ok(Json(json!({
        "skills": skills,
        "extensions": catalog.extensions,
        "skillsEnabled": cfg.skills_enabled,
        "configError": config_error,
    })))
}

#[derive(Deserialize)]
struct SkillToggleBody {
    name: String,
    enabled: bool,
    cwd: Option<String>,
}

async fn skill_toggle<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Json(body): Json<SkillToggleBody>,
) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let catalog = catalog_for(&ctx, st, body.cwd.as_deref()).await?;
    if !catalog.skills.iter().any(|s| s.name == body.name) {
        return Err(not_found("技能不存在"));
    }
    let _guard = SKILL_CFG_LOCK.lock().await;
    let cfg = read_skill_config(st).await.map_err(bad_gateway)?;
    let (disabled, ignored) = apply_skill_toggle(
        &cfg.disabled_extensions,
        &cfg.ignored,
        &body.name,
        body.enabled,
    );
    set_list_setting(st, "disabledExtensions", &disabled).await?;
    if let Some(ignored) = ignored {
        set_list_setting(st, "skills.ignoredSkills", &ignored).await?;
    }
    Ok(ok_json())
}

#[derive(Deserialize)]
struct ExtensionToggleBody {
    path: String,
    enabled: bool,
    cwd: Option<String>,
}

async fn extension_toggle<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Json(body): Json<ExtensionToggleBody>,
) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let catalog = catalog_for(&ctx, st, body.cwd.as_deref()).await?;
    let ext = catalog
        .extensions
        .iter()
        .find(|e| e.path == body.path)
        .ok_or_else(|| not_found("扩展不存在"))?;
    let _guard = SKILL_CFG_LOCK.lock().await;
    let cfg = read_skill_config(st).await.map_err(bad_gateway)?;
    let disabled =
        apply_extension_toggle(&cfg.disabled_extensions, &ext.name, &ext.path, body.enabled);
    set_list_setting(st, "disabledExtensions", &disabled).await?;
    Ok(ok_json())
}

// ---------- settings ----------

async fn settings_summary<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> ApiResult<Value> {
    let st = app(&ctx)?;
    let status = crate::mobile::status(st);
    let roles = crate::settings_model_roles::omp_model_roles_read(None, None)
        .await
        .ok()
        .and_then(|s| s.global.model_roles.get("default").cloned())
        .filter(|m| !m.trim().is_empty());
    let (model, source) = match roles {
        Some(m) => (Some(m), Some("modelRoles.default")),
        None => match st
            .settings
            .read()
            .new_session_model
            .clone()
            .filter(|m| !m.trim().is_empty())
        {
            Some(m) => (Some(m), Some("newSessionModel")),
            None => (None, None),
        },
    };
    Ok(Json(json!({
        "appVersion": st.app.package_info().version.to_string(),
        "mobile": {
            "running": status.running,
            "port": status.port,
            "lanUrl": status.lan_url,
            "tunnelUrl": status.tunnel_url,
            "ipv6Running": status.ipv6_running,
            "ipv6Url": status.ipv6_url,
        },
        "defaultModel": model,
        "defaultModelSource": source,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::GitBadge;

    fn meta(id: &str, cwd: &str, ts: &str) -> SessionMeta {
        SessionMeta {
            id: id.into(),
            cwd: cwd.into(),
            title: id.into(),
            updated_at: ts.into(),
            created_at: ts.into(),
            ..Default::default()
        }
    }

    fn git(m: &mut SessionMeta, branch: Option<&str>, wt: Option<&str>) {
        m.git = Some(GitBadge {
            branch: branch.map(Into::into),
            dirty: 0,
            worktree: wt.map(Into::into),
        });
    }

    #[test]
    fn inside_is_component_wise() {
        assert!(is_inside("/a/b", "/a/b"));
        assert!(is_inside("/a/b/c", "/a/b/"));
        assert!(!is_inside("/a/bc", "/a/b"));
        assert!(!is_inside("/a", ""));
        assert!(is_inside_canon("/private/tmp/x/y", "/tmp/x"));
    }

    #[test]
    fn infers_worktree_names() {
        assert_eq!(
            infer_worktree_name("/r/.worktrees/feat/sub"),
            Some("feat".into())
        );
        assert_eq!(
            infer_worktree_name("/r/.cache/wt-abc"),
            Some("wt-abc".into())
        );
        assert_eq!(infer_worktree_name("/r/.cache/other"), None);
        assert_eq!(infer_worktree_name("/r/.worktrees"), None);
    }

    #[test]
    fn search_is_and_over_tokens_and_cwd_is_relative() {
        let mut s = meta("a", "/ws/app/pkg", "2026-01-01T00:00:00Z");
        s.title = "Fix login".into();
        git(&mut s, Some("feat/auth"), None);
        assert!(matches_search(&s, "login auth", Some("/ws/app")));
        assert!(matches_search(&s, "pkg", Some("/ws/app")));
        assert!(!matches_search(&s, "login nothere", Some("/ws/app")));
        // The shared absolute prefix must not match.
        assert!(!matches_search(&s, "ws", Some("/ws/app")));
        assert!(matches_search(&s, "  ", None));
    }

    #[test]
    fn archive_cascades_to_idle_children_only() {
        let mut parent = meta("p", "/x", "2026-01-01T00:00:00Z");
        parent.archived = true;
        let mut idle = meta("c", "/x", "2026-01-01T00:00:00Z");
        idle.parent_id = Some("p".into());
        let mut busy = meta("d", "/x", "2026-01-01T00:00:00Z");
        busy.parent_id = Some("p".into());
        busy.status = SessionStatus::Working;
        let all = [parent.clone(), idle.clone(), busy.clone()];
        let by_id: HashMap<&str, &SessionMeta> = all.iter().map(|s| (s.id.as_str(), s)).collect();
        assert!(is_archived_cascaded(&parent, &by_id));
        assert!(is_archived_cascaded(&idle, &by_id));
        assert!(!is_archived_cascaded(&busy, &by_id));
    }

    #[test]
    fn empty_side_chat_detection() {
        let mut s = meta("f", "/x", "2026-01-01T00:00:00Z");
        s.title = String::new();
        s.parent_id = Some("p".into());
        assert!(is_empty_side_chat(&s));
        s.unread = true;
        assert!(!is_empty_side_chat(&s));
    }

    #[test]
    fn subgroups_attach_by_deepest_cwd_and_flag_deleted() {
        let wts = vec![
            Wt {
                path: "/r".into(),
                branch: Some("main".into()),
                session_ids: vec![],
            },
            Wt {
                path: "/r/.worktrees/feat".into(),
                branch: Some("feat".into()),
                session_ids: vec![],
            },
        ];
        let a = meta("a", "/r/src", "2026-01-02T00:00:00Z");
        let b = meta("b", "/r/.worktrees/feat/x", "2026-01-03T00:00:00Z");
        let c = meta("c", "/r/.worktrees/gone", "2026-01-04T00:00:00Z");
        let subs = build_subgroups(&[&a, &b, &c], Some(&wts));
        let find = |k: &str| subs.iter().find(|s| s.key == k).unwrap();
        assert_eq!(find("wtp:/r").sessions[0].id, "a");
        assert_eq!(find("wtp:/r/.worktrees/feat").sessions[0].id, "b");
        assert!(find("wt:gone").deleted);
        assert!(subs.last().unwrap().deleted);
        assert!(subs[0].is_main);
    }

    #[test]
    fn subgroups_fall_back_to_branch_buckets_without_worktree_list() {
        let mut a = meta("a", "/r", "2026-01-02T00:00:00Z");
        git(&mut a, Some("dev"), None);
        let b = meta("b", "/r", "2026-01-01T00:00:00Z");
        let subs = build_subgroups(&[&a, &b], None);
        assert_eq!(subs.len(), 2);
        assert_eq!(subs[0].key, "br:dev");
        assert!(subs[0].is_main);
        assert_eq!(subs[1].kind, "default");
    }

    #[test]
    fn inbox_window_rules() {
        let now = DateTime::parse_from_rfc3339("2026-01-10T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mk = |id: &str, k: Attention, ts: &str| {
            let mut s = meta(id, "/x", ts);
            s.attention = Some(k);
            s
        };
        let metas = [
            mk("old-aw", Attention::Awaiting, "2025-01-01T00:00:00Z"),
            mk("old-un", Attention::Unread, "2025-01-01T00:00:00Z"),
            mk("new-un", Attention::Unread, "2026-01-09T23:00:00Z"),
            mk("run", Attention::Running, "2025-01-01T00:00:00Z"),
            {
                let mut s = mk("arch", Attention::Error, "2026-01-09T23:00:00Z");
                s.archived = true;
                s
            },
        ];
        let g = group_inbox(&metas, now, 24);
        assert_eq!(g.awaiting.len(), 1);
        assert_eq!(g.unread.len(), 1);
        assert_eq!(g.unread[0].id, "new-un");
        assert_eq!(g.running.len(), 1);
        assert!(g.error.is_empty());
        assert_eq!(g.badge, 2);
    }

    #[test]
    fn glob_matching() {
        assert!(glob_match("foo*", "foobar"));
        assert!(glob_match("f?o", "foo"));
        assert!(glob_match("*", ""));
        assert!(glob_match("a**c", "abbbc"));
        assert!(!glob_match("foo", "foobar"));
        assert!(!glob_match("a?", "a"));
    }

    #[test]
    fn skill_enablement_pipeline() {
        let mut cfg = SkillConfig::default();
        assert!(skill_enablement("x", "native", "user", &cfg).is_ok());
        cfg.disabled_extensions = vec!["skill:x".into()];
        assert_eq!(
            skill_enablement("x", "native", "user", &cfg).unwrap_err()["kind"],
            "disabled"
        );
        cfg.disabled_extensions.clear();
        cfg.source_toggles
            .insert("skills.enablePiUser".into(), false);
        assert_eq!(
            skill_enablement("x", "native", "user", &cfg).unwrap_err()["kind"],
            "source"
        );
        assert!(skill_enablement("x", "github", "project", &cfg).is_ok());
        cfg.source_toggles.clear();
        cfg.ignored = vec!["t*".into()];
        let e = skill_enablement("tool", "native", "user", &cfg).unwrap_err();
        assert_eq!(
            (e["kind"].as_str(), e["exact"].as_bool()),
            (Some("ignored"), Some(false))
        );
        cfg.ignored.clear();
        cfg.include = vec!["only".into()];
        assert_eq!(
            skill_enablement("x", "native", "user", &cfg).unwrap_err()["kind"],
            "not_included"
        );
        cfg.skills_enabled = false;
        assert_eq!(
            skill_enablement("only", "native", "user", &cfg).unwrap_err()["kind"],
            "all_off"
        );
    }

    #[test]
    fn toggle_helpers() {
        let (d, i) = apply_skill_toggle(&["skill:a".into()], &["a".into(), "b".into()], "a", true);
        assert!(d.is_empty());
        assert_eq!(i, Some(vec!["b".to_string()]));
        let (d, i) = apply_skill_toggle(&["skill:a".into()], &[], "a", false);
        assert_eq!(d, vec!["skill:a".to_string()]);
        assert!(i.is_none());
        let off = apply_extension_toggle(&[], "ext", "/p/ext", false);
        assert_eq!(off, vec!["ext".to_string()]);
        let on = apply_extension_toggle(
            &[
                "ext".into(),
                "extension-module:ext".into(),
                "/p/ext".into(),
                "keep".into(),
            ],
            "ext",
            "/p/ext",
            true,
        );
        assert_eq!(on, vec!["keep".to_string()]);
    }

    #[test]
    fn resolve_dir_prefers_deepest_root() {
        let mk = |p: &str, kind: &'static str| DirEntry {
            path: p.into(),
            label: p.into(),
            kind,
            workspace_id: "w".into(),
            mode: SpaceMode::Code,
            canon: PathBuf::from(p),
        };
        let dirs = [mk("/r", "workspace"), mk("/r/.worktrees/f", "worktree")];
        assert_eq!(
            resolve_dir(FsPath::new("/r/.worktrees/f/x"), &dirs)
                .unwrap()
                .kind,
            "worktree"
        );
        assert_eq!(
            resolve_dir(FsPath::new("/r/y"), &dirs).unwrap().kind,
            "workspace"
        );
        assert!(resolve_dir(FsPath::new("/rr"), &dirs).is_none());
        assert!(resolve_dir(FsPath::new("/"), &dirs).is_none());
    }
}
