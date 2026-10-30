//! [B] omp --mode rpc process manager, idle suspend, takeover.
//! Cross-module API per docs/ARCHITECTURE.md §9.
#![allow(dead_code)]

mod autotitle;
pub mod commands;
pub(crate) mod fork;
mod forkcut;
mod frame;
#[cfg(test)]
mod live_test;
mod plan_ext;
mod privacy_ext;
mod process;
pub(crate) mod sidechat;
pub(crate) mod subagents;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Emitter;

use crate::contracts::{LiveSessionInfo, PendingUiRequest, SessionMeta, StartOpts};
use crate::state::{AppEvent, AppState};
use crate::{catalog, paths};

pub use process::{prompt_shape_args, send_command, SessionHandle};

type ResumeLocks = parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>;
static REGISTRY: OnceLock<parking_lot::RwLock<HashMap<String, Arc<SessionHandle>>>> =
    OnceLock::new();
static RESUME_LOCKS: OnceLock<ResumeLocks> = OnceLock::new();
static IDLE_TIMERS: std::sync::LazyLock<parking_lot::Mutex<HashMap<String, u64>>> =
    std::sync::LazyLock::new(Default::default);
static ACTIVITY_GUARDS: std::sync::LazyLock<parking_lot::Mutex<HashMap<String, HashSet<String>>>> =
    std::sync::LazyLock::new(Default::default);

pub(crate) fn registry() -> &'static parking_lot::RwLock<HashMap<String, Arc<SessionHandle>>> {
    REGISTRY.get_or_init(Default::default)
}

pub fn session_resume_lock(session_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    RESUME_LOCKS
        .get_or_init(Default::default)
        .lock()
        .entry(session_id.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

pub fn remove_resume_lock(session_id: &str) {
    if let Some(m) = RESUME_LOCKS.get() {
        let mut locks = m.lock();
        if locks
            .get(session_id)
            .is_some_and(|lock| Arc::strong_count(lock) == 1)
        {
            locks.remove(session_id);
        }
    }
    autotitle::forget(session_id);
}

pub fn get_handle(session_id: &str) -> Option<Arc<SessionHandle>> {
    registry()
        .read()
        .get(session_id)
        .filter(|h| h.alive.load(std::sync::atomic::Ordering::SeqCst))
        .cloned()
}

/// Settlement starts an event-driven countdown; a low-frequency sweep remains
/// as a fallback for missed events and system sleep. Every actual suspension
/// repeats the complete check under the session's dispatch lock.
pub fn init(state: AppState) {
    privacy_ext::install();
    plan_ext::install();
    crate::visualize::install();
    autotitle::spawn(state.clone());
    let mut events = state.bus.subscribe();
    let event_state = state.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(AppEvent::RpcFrame { session_id, frame }) => {
                    // End-of-work events are candidates only; ordinary stream
                    // frames need not allocate a sleeping task per token.
                    if matches!(
                        frame.get("type").and_then(Value::as_str),
                        Some("session_settled" | "agent_end" | "subagent_lifecycle")
                    ) {
                        schedule_idle_suspend(event_state.clone(), session_id, None).await;
                    }
                }
                Ok(AppEvent::RpcProcess { running: false, .. }) => {}
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    sweep_idle(&event_state).await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            sweep_idle(&state).await;
        }
    });
}

async fn sweep_idle(state: &AppState) {
    let ids: Vec<String> = registry().read().keys().cloned().collect();
    for id in ids {
        schedule_idle_suspend(state.clone(), id, Some(Duration::ZERO)).await;
    }
}

fn session_retained(id: &str) -> bool {
    ACTIVITY_GUARDS.lock().contains_key(id)
}

/// An RAII editing guard for non-IPC owners (notably the mobile HTTP client).
/// Owner keys are idempotent, so reconnecting a view cannot leak a second hold.
pub struct SessionActivityGuard {
    session_id: String,
    owner: String,
}

impl Drop for SessionActivityGuard {
    fn drop(&mut self) {
        let mut guards = ACTIVITY_GUARDS.lock();
        if let Some(owners) = guards.get_mut(&self.session_id) {
            owners.remove(&self.owner);
            if owners.is_empty() {
                guards.remove(&self.session_id);
            }
        }
    }
}

pub fn retain_session_activity(session_id: &str, owner: &str) -> SessionActivityGuard {
    ACTIVITY_GUARDS
        .lock()
        .entry(session_id.to_string())
        .or_default()
        .insert(owner.to_string());
    SessionActivityGuard {
        session_id: session_id.to_string(),
        owner: owner.to_string(),
    }
}

pub fn retain_session(session_id: &str) {
    ACTIVITY_GUARDS
        .lock()
        .entry(session_id.to_string())
        .or_default()
        .insert("desktop".to_string());
}

pub fn release_session(session_id: &str) {
    let mut guards = ACTIVITY_GUARDS.lock();
    if let Some(owners) = guards.get_mut(session_id) {
        owners.remove("desktop");
        if owners.is_empty() {
            guards.remove(session_id);
        }
    }
}

pub fn touch_session(session_id: &str) {
    if let Some(handle) = get_handle(session_id) {
        handle.touch();
    }
}

/// Cheap local eligibility. Unknown runtime state is not proof of idleness.
fn idle_suspendable(handle: &SessionHandle, threshold: Duration) -> bool {
    let id = handle.session_id.read();
    !session_retained(&id)
        && handle.alive.load(Ordering::SeqCst)
        && !handle.streaming.load(Ordering::SeqCst)
        && handle.settled.load(Ordering::SeqCst)
        && !handle.awaiting_async_work.load(Ordering::SeqCst)
        && handle.active_subagents.lock().is_empty()
        && handle.pending_ui.lock().is_empty()
        && handle.pending.is_empty()
        && handle.last_activity.lock().elapsed() >= threshold
}

async fn schedule_idle_suspend(state: AppState, session_id: String, delay: Option<Duration>) {
    let Some(handle) = get_handle(&session_id) else {
        return;
    };
    if session_retained(&session_id) || !handle.alive.load(Ordering::SeqCst) {
        return;
    }
    let minutes = state.settings.read().idle_suspend_minutes;
    if minutes == 0 {
        return;
    }
    let delay = delay.unwrap_or_else(|| Duration::from_secs(u64::from(minutes) * 60));
    let version = handle.activity_version.load(Ordering::SeqCst);
    if IDLE_TIMERS.lock().insert(session_id.clone(), version) == Some(version) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        {
            let resume = session_resume_lock(&session_id);
            let _resume_guard = resume.lock().await;
            if get_handle(&session_id).is_some_and(|current| Arc::ptr_eq(&current, &handle)) {
                let threshold =
                    Duration::from_secs(u64::from(state.settings.read().idle_suspend_minutes) * 60);
                let suspended =
                    idle_suspendable(&handle, threshold) && suspend_if_idle(&handle, version).await;
                if suspended {
                    set_suspended(&state, &session_id, true);
                }
            }
        }
        let mut timers = IDLE_TIMERS.lock();
        if timers.get(&session_id) == Some(&version) {
            timers.remove(&session_id);
        }
        drop(timers);
    });
}

/// Atomically with respect to host dispatch: query authoritative state and
/// active subagents, verify that no frame arrived meanwhile, then close stdin.
/// Missing fields, query errors and new activity all conservatively keep it.
async fn suspend_if_idle(handle: &Arc<SessionHandle>, version: u64) -> bool {
    if !idle_suspendable(handle, Duration::ZERO) {
        return false;
    }
    let _dispatch = handle.dispatch_lock.lock().await;
    if handle.activity_version.load(Ordering::SeqCst) != version
        || !idle_suspendable(handle, Duration::ZERO)
    {
        return false;
    }
    let Ok(state) = process::send_command_locked(handle, json!({"type": "get_state"})).await else {
        return false;
    };
    process::apply_state(handle, &state);
    let data = state.get("data").unwrap_or(&state);
    let fully_settled = data.get("isSettled").and_then(Value::as_bool) == Some(true)
        && data.get("isStreaming").and_then(Value::as_bool) == Some(false)
        && data.get("hasPendingAsyncWork").and_then(Value::as_bool) == Some(false)
        && data.get("queuedMessageCount").and_then(Value::as_u64) == Some(0);
    if !fully_settled {
        return false;
    }
    let Ok(subagents) =
        process::send_command_locked(handle, json!({"type": "get_subagents"})).await
    else {
        return false;
    };
    let subagent_data = subagents.get("data").unwrap_or(&subagents);
    let no_active_subagents = subagent_data
        .get("subagents")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().all(|item| {
                !matches!(
                    item.get("status").and_then(Value::as_str),
                    Some("pending" | "running")
                )
            })
        });
    if !no_active_subagents
        || handle.activity_version.load(Ordering::SeqCst) != version
        || !idle_suspendable(handle, Duration::ZERO)
    {
        return false;
    }
    let _ = handle.shutdown.send(true);
    true
}

/// Stop all app-owned rpc session processes concurrently.
pub async fn shutdown() {
    let handles: Vec<Arc<SessionHandle>> = {
        let mut reg = registry().write();
        let list: Vec<Arc<SessionHandle>> = reg.values().cloned().collect();
        reg.clear();
        list
    };
    RESUME_LOCKS.get_or_init(Default::default).lock().clear();
    let mut set = tokio::task::JoinSet::new();
    for handle in handles {
        set.spawn(async move {
            let _ = process::stop_handle(&handle).await;
        });
    }
    while set.join_next().await.is_some() {}
}

/// Spawn + handshake + register. Emits `rpc:process` running=true.
/// With `resume_file`, fails with `SESSION_HELD:<pid>` when another process holds it.
/// `opts.mode`/`opts.group_id` (new sessions) are persisted to `session_meta`
/// after the child reports its sessionId; a group requires the 通用对话 (`chat`) mode.
pub async fn start(state: &AppState, opts: &StartOpts) -> Result<LiveSessionInfo, String> {
    let _mutation = catalog::session_mutation_lock().lock().await;
    if let Some(file) = &opts.resume_file {
        if !std::path::Path::new(file).is_file() {
            return Err(format!("session file no longer exists: {file}"));
        }
        ensure_not_held(file).await?;
    }
    let mode = opts.mode.unwrap_or_default();
    if let Some(gid) = opts.group_id.as_deref() {
        let ok = {
            let db = state.db.lock();
            catalog::store::get_session_group(&db, gid)
                .ok()
                .flatten()
                .is_some_and(|g| g.mode == mode && mode == crate::contracts::SpaceMode::Chat)
        };
        if !ok {
            return Err("会话分组不存在，或仅通用对话可使用分组".to_string());
        }
    }
    {
        let db = state.db.lock();
        let _ = crate::db::ensure_global_workspace(&db);
    }
    let handle = process::spawn(state, opts).await?;
    let session_id = handle.session_id.read().clone();
    if session_id.is_empty() {
        let _ = process::stop_handle(&handle).await;
        return Err("omp did not report a sessionId".into());
    }
    // Spawning an RPC process for the session (new or resumed) makes it
    // app-owned: CLI sessions the user continues here join the inbox.
    {
        let db = state.db.lock();
        if let Err(e) = catalog::store::mark_created_by_app(&db, &session_id) {
            tracing::warn!("mark session app-owned {session_id}: {e}");
        }
    }
    {
        let db = state.db.lock();
        if let Err(e) =
            catalog::store::set_mode_group(&db, &session_id, opts.mode, opts.group_id.as_deref())
        {
            tracing::warn!("persist session mode/group {session_id}: {e}");
        }
    }
    let old_handle = registry().read().get(&session_id).cloned();
    if let Some(old) = old_handle {
        if !Arc::ptr_eq(&old, &handle) {
            let _ = process::stop_handle(&old).await;
        }
    }
    let info = handle.info();
    register_started(&handle, || {
        let _ = state.app.emit(
            "rpc:process",
            json!({ "sessionId": session_id, "running": true, "exitCode": null }),
        );
        state.emit(AppEvent::RpcProcess {
            session_id,
            running: true,
            exit_code: None,
        });
    })?;
    Ok(info)
}

fn register_started(handle: &Arc<SessionHandle>, publish: impl FnOnce()) -> Result<(), String> {
    let id = handle.session_id.read().clone();
    let mut reg = registry().write();
    if !handle.alive.load(Ordering::SeqCst) {
        return Err("omp exited before session registration".into());
    }
    reg.insert(id, handle.clone());
    // Same registry boundary as publish_exit: a start cannot overtake its exit.
    publish();
    Ok(())
}

/// Error prefix the frontend recognizes to pop the "missing cwd" resume dialog.
pub const CWD_MISSING_PREFIX: &str = "CWD_MISSING:";

/// Some(err) when `cwd` cannot host a process (missing directory).
fn cwd_missing_err(cwd: &str) -> Option<String> {
    if cwd.is_empty() || !std::path::Path::new(cwd).is_dir() {
        Some(format!("{CWD_MISSING_PREFIX}{cwd}"))
    } else {
        None
    }
}

/// Error prefix the frontend recognizes when another (non app-owned) omp
/// process already holds the session file: `SESSION_HELD:<pid>`.
pub const SESSION_HELD_PREFIX: &str = "SESSION_HELD:";

/// Some(`SESSION_HELD:<pid>`) when a live process not owned by this app
/// instance (`own_pid` = our pid) holds `file`, per lsof holders + status files.
fn session_held_err(
    holders: HashMap<String, catalog::external::Holder>,
    status: &[catalog::external::StatusFile],
    alive: impl Fn(&catalog::external::StatusFile) -> bool,
    own_pid: u32,
    file: &str,
) -> Option<String> {
    catalog::external::external_map(holders, status, alive, own_pid)
        .get(file)
        .map(|pid| format!("{SESSION_HELD_PREFIX}{pid}"))
}

/// Refuses to spawn `--resume <file>` while another app instance / terminal
/// omp writes the same JSONL (two writers corrupt it). lsof runs off the runtime.
async fn ensure_not_held(file: &str) -> Result<(), String> {
    let file = file.to_string();
    let err = tokio::task::spawn_blocking(move || {
        let holders = catalog::external::lsof_holders(&paths::omp_sessions_dir());
        let status = catalog::external::read_status_files(&paths::status_dir());
        session_held_err(
            holders,
            &status,
            catalog::external::status_validator(catalog::external::process_birth),
            std::process::id(),
            &file,
        )
    })
    .await
    .unwrap_or(None);
    err.map_or(Ok(()), Err)
}

/// Own-instance twin of `SESSION_HELD`: this app's `omp --resume` terminal
/// already writes the session file (it is an own child, so lsof can't tell).
fn omp_terminal_guard(session_id: &str) -> Result<(), String> {
    if crate::terminal::commands::omp_terminal_open(session_id) {
        Err("该会话的 omp 终端仍在运行，请先关闭终端后再继续".to_string())
    } else {
        Ok(())
    }
}

/// Start with `--resume <file>` if not live (suspended/interrupted/idle).
/// Clears the `suspended` flag in session_meta.
///
/// `cwd = Some(dir)`: user-chosen resume directory (e.g. the repo's main dir
/// after its worktree was deleted). Must be an existing directory; it is
/// persisted as `session_meta.cwd_override` and the catalog meta is recomputed.
/// `cwd = None`: resume in the transcript/override cwd; when that directory no
/// longer exists this fails with `CWD_MISSING:<cwd>` instead of spawning.
/// Fails with `SESSION_HELD:<pid>` when another process holds the file.
pub async fn ensure_live(
    state: &AppState,
    session_id: &str,
    cwd: Option<String>,
) -> Result<LiveSessionInfo, String> {
    if let Some(handle) = get_handle(session_id) {
        handle.touch();
        return Ok(handle.info());
    }
    let lock = session_resume_lock(session_id);
    let _guard = lock.lock().await;
    if let Some(handle) = get_handle(session_id) {
        handle.touch();
        return Ok(handle.info());
    }
    omp_terminal_guard(session_id)?;
    let (file, found_cwd) = find_session_file(state, session_id)
        .await
        .ok_or_else(|| format!("cannot locate session file for {session_id}"))?;
    let cwd = match cwd {
        Some(dir) => {
            let _mutation = catalog::session_mutation_lock().lock().await;
            if !std::path::Path::new(&dir).is_dir() {
                return Err(format!("目录不存在: {dir}"));
            }
            // Persist first so the recomputed meta reports the new cwd.
            catalog::set_cwd_override(state, session_id, &dir).await;
            dir
        }
        None => {
            if let Some(err) = cwd_missing_err(&found_cwd) {
                return Err(err);
            }
            found_cwd
        }
    };
    // Single-writer takeover: an external omp holding the file must exit (and
    // flush its session_exit record) before our RPC child loads it.
    if let Some(meta) = catalog::get(state, session_id).await {
        terminate_session_holder(&meta).await;
    }
    let info = start(
        state,
        &StartOpts {
            cwd,
            resume_file: Some(file),
            ..Default::default()
        },
    )
    .await?;
    set_suspended(state, session_id, false);
    Ok(info)
}

/// The omp `prompt` command: `images` are native `ImageContent` blocks
/// (`{type:"image", data(base64), mimeType}`); `followUp` while a turn runs.
pub(crate) fn prompt_command(text: &str, streaming: bool, images: &[Value]) -> Value {
    let mut command = json!({"type": "prompt", "message": text});
    if !images.is_empty() {
        command["images"] = Value::Array(images.to_vec());
    }
    if streaming {
        command["streamingBehavior"] = json!("followUp");
    }
    command
}

/// Read local image files into omp `ImageContent` blocks, reusing the mobile
/// prompt pipeline's validation (`build_images`: png/jpeg/gif/webp, base64).
/// Any unreadable or unsupported file is an error: images are never dropped.
pub fn image_blocks_from_paths(paths: &[String]) -> Result<Vec<Value>, String> {
    use base64::Engine as _;
    let mut images = Vec::with_capacity(paths.len());
    for path in paths {
        let bytes = std::fs::read(path).map_err(|e| format!("无法读取图片 {path}：{e}"))?;
        let mime = crate::mobile::api::media::sniff(&bytes)
            .ok_or_else(|| format!("不支持的图片格式（仅 png/jpeg/gif/webp）：{path}"))?;
        images.push(crate::mobile::api::chat::ImageIn {
            mime: mime.to_string(),
            data: base64::engine::general_purpose::STANDARD.encode(&bytes),
        });
    }
    crate::mobile::api::chat::build_images(&images).map_err(|e| e.1)
}

/// ensure_live + prompt (followUp when streaming).
pub async fn send_prompt(state: &AppState, session_id: &str, text: &str) -> Result<(), String> {
    send_prompt_with_images(state, session_id, text, &[]).await
}

/// [`send_prompt`] carrying `ImageContent` blocks (see [`image_blocks_from_paths`]).
pub async fn send_prompt_with_images(
    state: &AppState,
    session_id: &str,
    text: &str,
    images: &[Value],
) -> Result<(), String> {
    let info = ensure_live(state, session_id, None).await?;
    let handle = refresh_privacy(state, &info.session_id).await?;
    let streaming = handle.streaming.load(std::sync::atomic::Ordering::SeqCst);
    let command = prompt_command(text, streaming, images);
    handle.touch();
    process::send_command(&handle, command).await?;
    state.emit(AppEvent::PromptSent {
        session_id: info.session_id,
    });
    Ok(())
}

/// Live handle for a prompt write. When the native secrets snapshot changed since
/// spawn and no turn is in flight, restarts the process (resume same file) first so
/// compaction summaries stay masked; while streaming the extension guard cancels compaction.
pub async fn refresh_privacy(
    state: &AppState,
    session_id: &str,
) -> Result<Arc<SessionHandle>, String> {
    let handle = get_handle(session_id).ok_or("session is not live")?;
    let streaming = handle.streaming.load(std::sync::atomic::Ordering::SeqCst);
    if !privacy_ext::needs_restart(
        &handle.native_hash,
        &crate::privacy::native_hash(),
        streaming,
    ) {
        return Ok(handle);
    }
    drop(handle);
    let info = restart(state, session_id).await?;
    get_handle(&info.session_id).ok_or_else(|| "session not live after restart".to_string())
}

/// Write an `extension_ui_response`, emit `UiResponded`.
pub async fn ui_respond(state: &AppState, session_id: &str, response: Value) -> Result<(), String> {
    let handle = get_handle(session_id).ok_or("session is not live")?;
    let mut frame = json!({});
    if let Value::Object(map) = response {
        for (k, v) in map {
            frame[k] = v;
        }
    }
    frame["type"] = json!("extension_ui_response");
    let request_id = frame
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    process::send_raw(&handle, frame).await?;
    handle.touch();
    if !request_id.is_empty() {
        state.emit(AppEvent::UiResponded {
            session_id: session_id.to_string(),
            request_id,
        });
    }
    Ok(())
}

/// Outstanding dialog requests (select/confirm/input/editor).
pub async fn pending_ui(_state: &AppState, session_id: &str) -> Vec<PendingUiRequest> {
    get_handle(session_id)
        .map(|h| h.pending_ui.lock().clone())
        .unwrap_or_default()
}

pub fn is_live(session_id: &str) -> bool {
    get_handle(session_id).is_some()
}

/// Close stdin, wait ≤5s, then kill. Used by terminal view (E) and idle suspend.
pub async fn stop(handle: &Arc<SessionHandle>) -> Result<(), String> {
    process::stop_handle(handle).await
}

/// Restart the session RPC process (the `/fresh` equivalent): terminates any
/// active child process and resumes with `--resume <file>`, resetting all
/// provider streams and active connection state without altering transcript history.
pub async fn restart(state: &AppState, session_id: &str) -> Result<LiveSessionInfo, String> {
    let lock = session_resume_lock(session_id);
    let _guard = lock.lock().await;
    omp_terminal_guard(session_id)?;
    if let Some(handle) = get_handle(session_id) {
        let _ = process::stop_handle(&handle).await;
        for _ in 0..20 {
            if get_handle(session_id).is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if get_handle(session_id).is_some() {
            return Err("旧进程尚未退出，请稍后重试".to_string());
        }
    }
    let (file, cwd) = find_session_file(state, session_id)
        .await
        .ok_or_else(|| format!("cannot locate session file for {session_id}"))?;
    if let Some(err) = cwd_missing_err(&cwd) {
        return Err(err);
    }
    let info = start(
        state,
        &StartOpts {
            cwd,
            resume_file: Some(file),
            ..Default::default()
        },
    )
    .await?;
    set_suspended(state, session_id, false);
    Ok(info)
}

/// SIGTERM the external holder, wait ≤5s (SIGKILL after), then resume.
pub async fn takeover_external(
    state: &AppState,
    session_id: &str,
) -> Result<LiveSessionInfo, String> {
    let meta: Option<SessionMeta> = catalog::get(state, session_id).await;
    if let Some(meta) = meta.as_ref() {
        terminate_session_holder(meta).await;
    }
    ensure_live(state, session_id, None).await
}

async fn terminate_session_holder(meta: &SessionMeta) {
    if let Some(pid) = meta.external_pid {
        let file = meta.file.clone();
        let still_owned = tokio::task::spawn_blocking(move || {
            let holders = catalog::external::lsof_holders(&paths::omp_sessions_dir());
            let statuses = catalog::external::read_status_files(&paths::status_dir());
            catalog::external::external_map(
                holders,
                &statuses,
                catalog::external::status_validator(catalog::external::process_birth),
                std::process::id(),
            )
            .get(&file)
            .copied()
                == Some(pid)
        })
        .await
        .unwrap_or(false);
        if still_owned {
            terminate_pid(pid).await;
        }
    }
}

/// SIGTERM then SIGKILL after the grace window.
async fn terminate_pid(pid: u32) {
    if pid <= 1 || !pid_looks_like_omp(pid) {
        return;
    }
    let Some(birth) = catalog::external::process_birth(pid) else {
        return;
    };
    // SAFETY: send SIGTERM to external process.
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGTERM);
    }
    for _ in 0..50 {
        if !pid_alive(pid) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if catalog::external::process_birth(pid).as_ref() != Some(&birth) || !pid_looks_like_omp(pid) {
        return;
    }
    // SAFETY: send SIGKILL after grace period.
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGKILL);
    }
}

/// Only exact executable/script tokens identify omp, never substring matches.
fn pid_looks_like_omp(pid: u32) -> bool {
    std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()
        .map(|o| o.status.success() && ps_line_looks_like_omp(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or(false)
}

fn ps_line_looks_like_omp(line: &str) -> bool {
    let mut tokens = line.split_whitespace();
    let executable = tokens
        .next()
        .and_then(|token| std::path::Path::new(token).file_name())
        .and_then(|name| name.to_str());
    match executable {
        Some("omp" | "omp.exe") => true,
        Some("bun" | "node" | "nodejs") => tokens
            .next()
            .and_then(|token| std::path::Path::new(token).file_name())
            .and_then(|name| name.to_str())
            .is_some_and(|name| matches!(name, "omp" | "omp.exe")),
        _ => false,
    }
}

#[cfg(test)]
mod pid_guard_tests {
    use super::*;

    #[test]
    fn process_exited_before_registration_never_publishes_started() {
        let handle = Arc::new(SessionHandle::for_test());
        let id = format!("dead-before-register-{}", uuid::Uuid::new_v4());
        *handle.session_id.write() = id.clone();
        handle.alive.store(false, Ordering::SeqCst);
        assert!(register_started(&handle, || panic!("dead process published running")).is_err());
        assert!(!registry().read().contains_key(&id));
    }

    #[test]
    fn suspension_publishes_after_exit_even_without_watcher() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE session_meta(session_id TEXT PRIMARY KEY, suspended INTEGER); INSERT INTO session_meta VALUES('s', 0);").unwrap();
        let statuses = std::cell::RefCell::new(Vec::new());
        for suspended in [true, false] {
            persist_suspension(&db, "s", suspended, || {
                let stored: bool = db
                    .query_row(
                        "SELECT suspended FROM session_meta WHERE session_id='s'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap();
                statuses.borrow_mut().push(
                    catalog::status::derive(&catalog::status::DeriveInput {
                        suspended: stored,
                        ..Default::default()
                    })
                    .0,
                );
            })
            .unwrap();
        }
        assert_eq!(
            *statuses.borrow(),
            vec![
                crate::contracts::SessionStatus::Suspended,
                crate::contracts::SessionStatus::Idle
            ]
        );
        persist_suspension(&db, "missing", true, || {
            panic!("deleted session must not republish")
        })
        .unwrap();
    }

    #[tokio::test]
    async fn deleting_session_retains_resume_lock_with_waiters() {
        let id = format!("resume-lock-{}", uuid::Uuid::new_v4());
        let first = session_resume_lock(&id);
        let held = first.lock().await;
        let waiting = session_resume_lock(&id);
        remove_resume_lock(&id);
        let next = session_resume_lock(&id);
        assert!(Arc::ptr_eq(&first, &next));
        assert!(waiting.try_lock().is_err());
        drop(held);
        drop(first);
        drop(waiting);
        drop(next);
        remove_resume_lock(&id);
    }

    #[test]
    fn ps_line_matching() {
        assert!(ps_line_looks_like_omp(
            "bun /home/u/.bun/bin/omp --mode rpc"
        ));
        assert!(!ps_line_looks_like_omp("firefox /Applications/Firefox.app"));
        assert!(!ps_line_looks_like_omp("/usr/bin/compile"));
        assert!(!ps_line_looks_like_omp("/bin/echo omp"));
        assert!(!ps_line_looks_like_omp("node /tmp/omp-imposter.js"));
        assert!(!ps_line_looks_like_omp(""));
    }
}

fn pid_alive(pid: u32) -> bool {
    if pid <= 1 {
        return false;
    }
    // SAFETY: kill(pid, 0) checks process existence without delivering a signal.
    unsafe {
        libc::kill(pid as libc::pid_t, 0) == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

pub(crate) fn set_suspended(state: &AppState, session_id: &str, suspended: bool) {
    let publish_state = state.clone();
    let id = session_id.to_string();
    let db = state.db.lock();
    let _ = persist_suspension(&db, session_id, suspended, move || {
        tauri::async_runtime::spawn(async move {
            catalog::recompute_async(&publish_state, Some(vec![id])).await;
        });
    });
}

/// Publish every changed suspension fact after persistence, including when the
/// exit event has already recomputed the session as Idle.
fn persist_suspension(
    db: &rusqlite::Connection,
    session_id: &str,
    suspended: bool,
    publish: impl FnOnce(),
) -> rusqlite::Result<()> {
    let changed = db.execute(
        "UPDATE session_meta SET suspended = ?1 WHERE session_id = ?2",
        rusqlite::params![suspended as i32, session_id],
    )?;
    if changed > 0 {
        publish();
    }
    Ok(())
}

/// Locate the session jsonl + cwd for resume: catalog first, then a filename
/// scan of `~/.omp/agent/sessions/*/​*_<id>.jsonl` with a header fallback.
pub(crate) async fn find_session_file(
    state: &AppState,
    session_id: &str,
) -> Option<(String, String)> {
    if let Some(meta) = catalog::get(state, session_id).await {
        return Some((meta.file, meta.cwd));
    }
    let root = paths::omp_sessions_dir();
    let suffix = format!("_{session_id}.jsonl");
    let buckets = std::fs::read_dir(&root).ok()?;
    for bucket in buckets.flatten() {
        let Ok(entries) = std::fs::read_dir(bucket.path()) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(&suffix) {
                continue;
            }
            let file = entry.path().to_string_lossy().to_string();
            let cwd = session_header_cwd(&file)
                .unwrap_or_else(|| paths::global_dir().to_string_lossy().to_string());
            return Some((file, cwd));
        }
    }
    None
}

/// Read the `type:"session"` header line for its cwd.
fn session_header_cwd(file: &str) -> Option<String> {
    use std::io::BufRead;
    let f = std::fs::File::open(file).ok()?;
    let reader = std::io::BufReader::new(f);
    for line in reader.lines().take(8) {
        let Ok(line) = line else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) == Some("session") {
            return v.get("cwd").and_then(Value::as_str).map(str::to_string);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempFile(std::path::PathBuf);
    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn create_temp(content: &str) -> TempFile {
        let path = std::env::temp_dir().join(format!("rpc_test_{}.jsonl", uuid::Uuid::new_v4()));
        std::fs::write(&path, content).unwrap();
        TempFile(path)
    }

    #[test]
    fn session_header_cwd_extracts_cwd_within_8_lines() {
        let content = "{\"type\":\"header\",\"version\":1}\n{\"type\":\"session\",\"cwd\":\"/test/dir\"}\n{\"type\":\"message\",\"content\":\"hi\"}\n";
        let tmp = create_temp(content);
        let cwd = session_header_cwd(tmp.0.to_str().unwrap());
        assert_eq!(cwd, Some("/test/dir".to_string()));
    }

    #[test]
    fn session_header_cwd_ignores_beyond_8_lines() {
        let mut content = String::new();
        for i in 0..10 {
            content.push_str(&format!("{{\"type\":\"line_{i}\"}}\n"));
        }
        content.push_str("{\"type\":\"session\",\"cwd\":\"/too/late\"}\n");
        let tmp = create_temp(&content);
        let cwd = session_header_cwd(tmp.0.to_str().unwrap());
        assert_eq!(cwd, None);
    }

    #[test]
    fn session_held_err_only_for_external_holders() {
        use catalog::external::{Holder, StatusFile};
        let file = "/h/.omp/agent/sessions/x/a.jsonl";
        let own = 999;
        let holder = |pid, ppid| HashMap::from([(file.to_string(), Holder { pid, ppid })]);
        // Another app instance's child holds the file → refuse with its pid.
        assert_eq!(
            session_held_err(holder(100, Some(555)), &[], |_| true, own, file),
            Some(format!("{SESSION_HELD_PREFIX}100"))
        );
        // Our own child holds it → allowed.
        assert_eq!(
            session_held_err(holder(101, Some(own)), &[], |_| true, own, file),
            None
        );
        // Nobody holds it → allowed.
        assert_eq!(
            session_held_err(HashMap::new(), &[], |_| true, own, file),
            None
        );
        // Live status file only (lsof missed it) → refuse; dead pid → allowed.
        let status = [StatusFile {
            session_id: "s".into(),
            session_file: file.into(),
            pid: 42,
            state: "idle".into(),
            process_started_at: None,
        }];
        assert_eq!(
            session_held_err(HashMap::new(), &status, |_| true, own, file),
            Some(format!("{SESSION_HELD_PREFIX}42"))
        );
        assert_eq!(
            session_held_err(HashMap::new(), &status, |_| false, own, file),
            None
        );
    }

    #[test]
    fn idle_suspend_skips_sessions_with_pending_commands() {
        let h = SessionHandle::for_test();
        let long_ago = Duration::from_secs(60);
        // Pretend the session has been quiet for a while.
        *h.last_activity.lock() = std::time::Instant::now() - Duration::from_secs(3600);
        // Quiet session with nothing outstanding is suspendable.
        assert!(idle_suspendable(&h, long_ago));
        // A command awaiting its response (e.g. a 15-minute `compact`) blocks it.
        let _rx = h.pending.insert("req_long".into());
        assert!(!idle_suspendable(&h, long_ago));
        h.pending.resolve(
            "req_long",
            json!({"id":"req_long","type":"response","success":true}),
        );
        assert!(idle_suspendable(&h, long_ago));
        // Open dialog blocks it.
        h.pending_ui
            .lock()
            .push(crate::contracts::PendingUiRequest {
                session_id: "s1".into(),
                request: json!({"id":"ui","method":"confirm"}),
                received_at: String::new(),
            });
        assert!(!idle_suspendable(&h, long_ago));
        h.pending_ui.lock().clear();
        // Recent activity blocks it.
        h.touch();
        assert!(!idle_suspendable(&h, long_ago));
        // Streaming blocks it.
        *h.last_activity.lock() = std::time::Instant::now() - Duration::from_secs(3600);
        h.streaming.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(!idle_suspendable(&h, long_ago));
    }

    #[test]
    fn idle_suspend_rejects_async_work_subagents_and_editing() {
        let h = SessionHandle::for_test();
        *h.last_activity.lock() = std::time::Instant::now() - Duration::from_secs(3600);
        h.awaiting_async_work.store(true, Ordering::SeqCst);
        h.settled.store(false, Ordering::SeqCst);
        assert!(!idle_suspendable(&h, Duration::from_secs(60)));
        h.awaiting_async_work.store(false, Ordering::SeqCst);
        h.settled.store(true, Ordering::SeqCst);
        h.active_subagents.lock().insert("agent-1".into());
        assert!(!idle_suspendable(&h, Duration::from_secs(60)));
        h.active_subagents.lock().clear();
        let _guard = retain_session_activity("s1", "mobile:test");
        assert!(!idle_suspendable(&h, Duration::from_secs(60)));
        // A second source remains protected after the first source leaves.
        retain_session("s1");
        drop(_guard);
        assert!(!idle_suspendable(&h, Duration::from_secs(60)));
        release_session("s1");
        assert!(idle_suspendable(&h, Duration::from_secs(60)));
    }

    #[test]
    fn cwd_missing_err_only_for_missing_dirs() {
        // A real directory passes.
        assert_eq!(cwd_missing_err("/tmp"), None);
        // Missing directories produce the sentinel the frontend parses.
        let err = cwd_missing_err("/definitely/not/here/ompws").unwrap();
        assert!(err.starts_with(CWD_MISSING_PREFIX));
        assert_eq!(
            err.strip_prefix(CWD_MISSING_PREFIX).unwrap(),
            "/definitely/not/here/ompws"
        );
    }
    #[test]
    fn registry_stale_monitor_does_not_remove_replacement_handle() {
        let session_id = format!("sess_{}", uuid::Uuid::new_v4());
        let handle1 = Arc::new(SessionHandle::for_test());
        let handle2 = Arc::new(SessionHandle::for_test());

        // Register handle1
        registry()
            .write()
            .insert(session_id.clone(), handle1.clone());

        // Now replacement handle2 arrives
        registry()
            .write()
            .insert(session_id.clone(), handle2.clone());

        // Stale monitor for handle1 runs cleanup
        {
            let mut reg = registry().write();
            if let Some(existing) = reg.get(&session_id) {
                if Arc::ptr_eq(existing, &handle1) {
                    reg.remove(&session_id);
                }
            }
        }

        // handle2 is still in the registry!
        assert!(registry().read().get(&session_id).is_some());
        assert!(Arc::ptr_eq(
            registry().read().get(&session_id).unwrap(),
            &handle2
        ));

        // When monitor for handle2 runs cleanup
        {
            let mut reg = registry().write();
            if let Some(existing) = reg.get(&session_id) {
                if Arc::ptr_eq(existing, &handle2) {
                    reg.remove(&session_id);
                }
            }
        }
        assert!(registry().read().get(&session_id).is_none());
    }
}
