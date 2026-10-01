//! [A] Session scan/parse/watch/status/workspaces/usage.
//! Cross-module API per docs/ARCHITECTURE.md §9.
//!
//! Layout: `parse` (head/tail readers), `scan` (listing cache + meta builder),
//! `status` (status machine), `store` (SQLite), `external` (lsof/status files),
//! `transcript` (get_transcript), `usage` (session_usage), `tasks` (background loops).

pub mod commands;
mod external;
pub(crate) mod parse;
mod scan;
mod status;
mod store;
mod tasks;
pub(crate) mod transcript;
mod usage;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tauri::Emitter as _;

use crate::contracts::{PendingKind, SessionMeta, SessionStatus};
use crate::paths;
use crate::state::{AppEvent, AppState};
use scan::{FileMap, GitInfo, Scanned};
use status::{DeriveInput, Runtime};
use store::MetaRow;

/// Git facts are refreshed at most this often per cwd.
const GIT_TTL: Duration = Duration::from_secs(5);

#[derive(Default)]
struct Catalog {
    files: FileMap,
    runtime: HashMap<String, Runtime>,
    /// Session file path -> external omp pid.
    external: HashMap<String, u32>,
    git: HashMap<String, (Instant, GitInfo)>,
    metas: HashMap<String, SessionMeta>,
    ready: bool,
}

fn cat() -> &'static Mutex<Catalog> {
    static CAT: OnceLock<Mutex<Catalog>> = OnceLock::new();
    CAT.get_or_init(Default::default)
}

fn scan_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

/// Spawn scanner/watcher/status tasks.
pub fn init(state: AppState) {
    tasks::spawn_all(state);
}

pub async fn list(state: &AppState) -> Vec<SessionMeta> {
    if !cat().lock().ready {
        rebuild(state).await;
    }
    let mut list: Vec<SessionMeta> = cat().lock().metas.values().cloned().collect();
    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    list
}

pub async fn get(state: &AppState, session_id: &str) -> Option<SessionMeta> {
    if !cat().lock().ready {
        rebuild(state).await;
    }
    cat().lock().metas.get(session_id).cloned()
}

/// Internal to A; listed in §9 only so nobody else writes `pending_kind`.
#[allow(dead_code)] // Reserved cross-module API documented in architecture §9.
pub async fn set_pending(state: &AppState, session_id: &str, pending: Option<PendingKind>) {
    {
        let db = state.db.lock();
        if let Err(e) = store::set_pending(&db, session_id, pending) {
            tracing::warn!("set_pending {session_id}: {e}");
        }
    }
    recompute_async(state, Some(vec![session_id.to_string()])).await;
}

/// Persist a resume-directory override (`session_meta.cwd_override`) — chosen
/// when the original worktree dir is gone — then recompute the session so
/// `meta.cwd`, git facts and workspace membership follow the new cwd.
pub async fn set_cwd_override(state: &AppState, session_id: &str, cwd: &str) {
    {
        let db = state.db.lock();
        if let Err(e) = store::set_cwd_override(&db, session_id, Some(cwd)) {
            tracing::warn!("set_cwd_override {session_id}: {e}");
        }
    }
    recompute_async(state, Some(vec![session_id.to_string()])).await;
}

/// Full rescan (only changed files are re-parsed), then recompute every meta.
pub(crate) async fn rebuild(state: &AppState) {
    let _guard = scan_lock().lock().await;
    let st = state.clone();
    if let Err(e) = tokio::task::spawn_blocking(move || rebuild_blocking(&st)).await {
        tracing::error!("catalog rebuild panicked: {e}");
    }
}

fn rebuild_blocking(state: &AppState) {
    let t0 = Instant::now();
    let dir = paths::omp_sessions_dir();
    let (prev, ready) = {
        let c = cat().lock();
        (c.files.clone(), c.ready)
    };
    let files = scan::list_files(&dir);
    let listed = files.len();
    let (map, changed) = scan::scan_files(files, &prev);
    let t_scan = t0.elapsed();
    // Git facts key on the *effective* cwd (a persisted cwd_override wins over
    // the transcript header's cwd), so meta rows load before refreshing.
    let overrides: HashMap<String, MetaRow> = {
        let db = state.db.lock();
        store::load_meta_rows(&db).unwrap_or_default()
    };
    let empty_row = MetaRow::default();
    refresh_git(
        map.values()
            .map(|s| {
                scan::effective_cwd(&s.head, overrides.get(&s.head.id).unwrap_or(&empty_row))
                    .to_string()
            })
            .collect(),
        false,
    );
    {
        let db = state.db.lock();
        for path in &changed {
            let s = &map[path];
            if let Err(e) = store::ensure_row(&db, &s.head.id, &s.path.to_string_lossy()) {
                tracing::warn!("ensure_row {}: {e}", s.head.id);
            }
            // New completed turn written by a non-app process -> unread.
            if ready && !crate::rpc::is_live(&s.head.id) {
                let old = prev
                    .get(path)
                    .and_then(|p| p.last_turn_ts().map(str::to_string));
                if let Some(ts) = s.last_turn_ts() {
                    if old.as_deref() != Some(ts) {
                        let _ = store::set_unread(&db, &s.head.id, true);
                    }
                }
            }
        }
    }
    cat().lock().files = map;
    recompute_blocking(state, None);
    cat().lock().ready = true;
    let total = t0.elapsed();
    let msg = format!(
        "catalog scan: {listed} files, {} parsed in {t_scan:?}, total {total:?}",
        changed.len()
    );
    if ready {
        tracing::debug!("{msg}");
    } else {
        tracing::info!("{msg}");
    }
}

/// Newest file per session id.
fn index_by_id(files: &FileMap) -> HashMap<String, Arc<Scanned>> {
    let mut idx: HashMap<String, Arc<Scanned>> = HashMap::with_capacity(files.len());
    for s in files.values() {
        match idx.get(&s.head.id) {
            Some(cur) if cur.mtime >= s.mtime => {}
            _ => {
                idx.insert(s.head.id.clone(), s.clone());
            }
        }
    }
    idx
}

fn git_needs_refresh(cached_at: Option<Instant>, force: bool) -> bool {
    force
        || match cached_at {
            Some(at) => at.elapsed() >= GIT_TTL,
            None => true,
        }
}

/// Refresh cached git facts for `cwds`; returns the cwds whose facts changed.
fn refresh_git(cwds: Vec<String>, force: bool) -> Vec<String> {
    let todo: Vec<String> = {
        let c = cat().lock();
        let uniq: HashSet<String> = cwds.into_iter().collect();
        uniq.into_iter()
            .filter(|cwd| git_needs_refresh(c.git.get(cwd).map(|(at, _)| *at), force))
            .collect()
    };
    if todo.is_empty() {
        return Vec::new();
    }
    let chunk = todo.len().div_ceil(8).max(1);
    let results: Vec<(String, GitInfo)> = std::thread::scope(|scope| {
        let handles: Vec<_> = todo
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || {
                    part.iter()
                        .map(|cwd| {
                            let p = std::path::Path::new(cwd);
                            let info = if !cwd.is_empty() && p.is_dir() {
                                GitInfo {
                                    badge: crate::git::badge(p),
                                    repo_root: crate::git::repo_root(p),
                                }
                            } else {
                                GitInfo::default()
                            };
                            (cwd.clone(), info)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap_or_default())
            .collect()
    });
    let mut c = cat().lock();
    let now = Instant::now();
    let mut changed = Vec::new();
    for (cwd, info) in results {
        let differs = c.git.get(&cwd).map_or(true, |(_, old)| *old != info);
        if differs {
            changed.push(cwd.clone());
        }
        c.git.insert(cwd, (now, info));
    }
    changed
}

fn parse_ts(s: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(s).ok()
}

/// `a` is at or after `b` (both ISO timestamps).
fn ts_at_or_after(a: Option<&str>, b: Option<&str>) -> bool {
    match (a.and_then(parse_ts), b.and_then(parse_ts)) {
        (Some(a), Some(b)) => a >= b,
        _ => false,
    }
}

pub(crate) async fn recompute_async(state: &AppState, ids: Option<Vec<String>>) {
    // If any requested id is not yet indexed, fall back to a full rebuild so
    // newly created session files are picked up.
    let needs_rebuild = match &ids {
        Some(ids) => {
            let index = index_by_id(&cat().lock().files);
            ids.iter().any(|id| !index.contains_key(id))
        }
        None => false,
    };
    if needs_rebuild {
        rebuild(state).await;
        return;
    }
    let st = state.clone();
    let _ = tokio::task::spawn_blocking(move || recompute_blocking(&st, ids)).await;
}

/// Recompute metas for `ids` (None = all), persist derived pending, emit diffs.
fn recompute_blocking(state: &AppState, ids: Option<Vec<String>>) {
    let full = ids.is_none();
    let index = index_by_id(&cat().lock().files);
    let targets: Vec<Arc<Scanned>> = match &ids {
        None => index.values().cloned().collect(),
        Some(ids) => ids.iter().filter_map(|id| index.get(id).cloned()).collect(),
    };
    let live: HashSet<String> = targets
        .iter()
        .filter(|s| crate::rpc::is_live(&s.head.id))
        .map(|s| s.head.id.clone())
        .collect();

    // DB phase: rows (+ seq assignment for labels without "#<n>") and workspaces.
    let (mut rows, workspaces) = {
        let db = state.db.lock();
        let mut rows = match &ids {
            None => store::load_meta_rows(&db).unwrap_or_default(),
            Some(ids) => ids
                .iter()
                .map(|id| (id.clone(), store::load_meta_row(&db, id)))
                .collect(),
        };
        for s in &targets {
            let id = &s.head.id;
            let row = rows.entry(id.clone()).or_default();
            let needs_seq = row.seq.is_none()
                && row.label.as_deref().map_or(true, str::is_empty)
                && scan::title_number(s, row).is_none();
            if needs_seq {
                let _ = store::ensure_row(&db, id, &s.path.to_string_lossy());
                row.seq = store::assign_seq(&db, id).ok();
            }
        }
        (rows, store::list_workspaces(&db).unwrap_or_default())
    };

    // Refresh git facts for the effective cwd of each target (override-aware).
    {
        let empty_row = MetaRow::default();
        let cwds = targets
            .iter()
            .map(|s| {
                scan::effective_cwd(&s.head, rows.get(&s.head.id).unwrap_or(&empty_row)).to_string()
            })
            .collect();
        refresh_git(cwds, false);
    }
    let global_dir = paths::global_dir().to_string_lossy().to_string();

    // Compute phase.
    let mut pending_writes = Vec::new();
    let mut changed = Vec::new();
    let mut status_changes = Vec::new();
    let mut removed = Vec::new();
    {
        let mut c = cat().lock();
        for s in &targets {
            let id = &s.head.id;
            let row = rows.remove(id).unwrap_or_default();
            let parent_id = row.parent_session_id.clone().or_else(|| {
                let p = s.head.parent_session.as_deref()?;
                if index.contains_key(p) {
                    return Some(p.to_string());
                }
                c.files.get(&PathBuf::from(p)).map(|ps| ps.head.id.clone())
            });
            let eff_cwd = scan::effective_cwd(&s.head, &row).to_string();
            let git = c.git.get(&eff_cwd).map(|g| g.1.clone()).unwrap_or_default();
            let mut meta = scan::build_meta(s, &row, &git, &workspaces, &global_dir, parent_id);
            let rt = c.runtime.get(id).cloned().unwrap_or_default();
            let is_live = rt.live || live.contains(id);
            let path = s.path.to_string_lossy();
            let external_pid = if is_live {
                None
            } else {
                c.external.get(path.as_ref()).copied()
            };
            let tail_ts = s.tail.last_msg.as_ref().map(|m| m.ts.as_str());
            let (status, pending) = status::derive(&DeriveInput {
                live: is_live,
                runtime: rt,
                pending: row.pending,
                suspended: row.suspended,
                external: external_pid.is_some(),
                tail: Some(s.tail.state()),
                tail_accepted: ts_at_or_after(row.accepted_at.as_deref(), tail_ts),
                pending_superseded: row.pending_since.is_some()
                    && !ts_at_or_after(row.pending_since.as_deref(), tail_ts),
            });
            meta.status = status;
            meta.pending = pending;
            meta.live = is_live;
            meta.external_pid = external_pid;
            if pending != row.pending {
                pending_writes.push((id.clone(), pending));
            }
            let old = c.metas.get(id);
            let differs = old.map_or(true, |o| !same_meta(o, &meta));
            if let Some(o) = old {
                if o.status != meta.status {
                    status_changes.push((id.clone(), o.status, meta.status));
                }
            }
            if differs {
                changed.push(meta.clone());
                c.metas.insert(id.clone(), meta);
            }
        }
        if full {
            removed = c
                .metas
                .keys()
                .filter(|id| !index.contains_key(*id))
                .cloned()
                .collect();
            for id in &removed {
                c.metas.remove(id);
            }
        }
    }

    if !pending_writes.is_empty() {
        let db = state.db.lock();
        for (id, p) in &pending_writes {
            if let Err(e) = store::set_pending(&db, id, *p) {
                tracing::warn!("persist pending {id}: {e}");
            }
        }
    }
    emit_changes(state, changed, removed, status_changes);
}

fn same_meta(a: &SessionMeta, b: &SessionMeta) -> bool {
    a == b
}

fn emit_changes(
    state: &AppState,
    changed: Vec<SessionMeta>,
    removed: Vec<String>,
    status_changes: Vec<(String, SessionStatus, SessionStatus)>,
) {
    if changed.is_empty() && removed.is_empty() {
        return;
    }
    let mut ids: Vec<String> = changed.iter().map(|m| m.id.clone()).collect();
    ids.extend(removed.iter().cloned());
    if !changed.is_empty() {
        let _ = state.app.emit("sessions:updated", &changed);
    }
    if !removed.is_empty() {
        let _ = state.app.emit("sessions:removed", &removed);
    }
    for (session_id, old, new) in status_changes {
        state.emit(AppEvent::SessionStatusChanged {
            session_id,
            old,
            new,
        });
    }
    state.emit(AppEvent::SessionsChanged { ids });
}

/// Session file path for an id (from the scan cache). Falls back to the live
/// RPC handle: omp writes the transcript lazily on the first message, so a
/// just-spawned session may have no file on disk yet — the handle already
/// knows its destined path.
pub(crate) fn file_of(session_id: &str) -> Option<PathBuf> {
    let c = cat().lock();
    if let Some(m) = c.metas.get(session_id) {
        return Some(PathBuf::from(&m.file));
    }
    if let Some(s) = c
        .files
        .values()
        .filter(|s| s.head.id == session_id)
        .max_by_key(|s| s.mtime)
    {
        return Some(s.path.clone());
    }
    drop(c);
    crate::rpc::get_handle(session_id)
        .map(|h| PathBuf::from(h.session_file.read().clone()))
        .filter(|p| !p.as_os_str().is_empty())
}

/// Permanently delete a session: refuse while live, remove its transcript
/// files and `session_meta` row, then emit `sessions:removed`.
pub(crate) async fn delete(state: &AppState, session_id: &str) -> Result<(), String> {
    if !cat().lock().ready {
        rebuild(state).await;
    }
    if crate::rpc::is_live(session_id) {
        return Err("会话仍在运行，请先挂起或停止".to_string());
    }

    // Collect every transcript file for this session id.
    let (paths, meta_file) = {
        let c = cat().lock();
        let files: Vec<PathBuf> = c
            .files
            .values()
            .filter(|s| s.head.id == session_id)
            .map(|s| s.path.clone())
            .collect();
        let meta_file = c.metas.get(session_id).map(|m| PathBuf::from(&m.file));
        (files, meta_file)
    };
    if paths.is_empty() && meta_file.is_none() {
        return Err(format!("session not found: {session_id}"));
    }
    let mut gone = std::collections::HashSet::new();
    for path in paths.iter().chain(meta_file.iter()) {
        match std::fs::remove_file(path) {
            Ok(()) => {
                gone.insert(path.to_string_lossy().to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                gone.insert(path.to_string_lossy().to_string());
            }
            Err(e) => {
                return Err(format!("删除会话文件失败 {}: {e}", path.display()));
            }
        }
    }
    {
        let db = state.db.lock();
        store::delete_row(&db, session_id)
            .map_err(|e| format!("delete session_meta {session_id}: {e}"))?;
    }
    {
        let mut c = cat().lock();
        c.files
            .retain(|p, _| !gone.contains(&p.to_string_lossy().to_string()));
        c.metas.remove(session_id);
        c.runtime.remove(session_id);
        c.external.retain(|p, _| !gone.contains(p));
    }
    emit_changes(state, Vec::new(), vec![session_id.to_string()], Vec::new());
    Ok(())
}

#[cfg(test)]
mod refresh_tests {
    use super::*;

    #[test]
    fn git_refresh_respects_expiry_and_force() {
        let now = Instant::now();
        assert!(git_needs_refresh(None, false));
        assert!(!git_needs_refresh(Some(now), false));
        assert!(git_needs_refresh(Some(now), true));
        assert!(git_needs_refresh(Some(now - GIT_TTL), false));
    }
}
