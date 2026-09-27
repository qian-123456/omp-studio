//! [B] omp --mode rpc process manager, idle suspend, takeover.
//! Cross-module API per docs/ARCHITECTURE.md §9.
#![allow(dead_code)]

pub mod commands;
mod frame;
#[cfg(test)]
mod live_test;
mod process;
mod sidechat;

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Emitter;

use crate::contracts::{LiveSessionInfo, PendingUiRequest, SessionMeta, StartOpts};
use crate::state::{AppEvent, AppState};
use crate::{catalog, paths};

use process::SessionHandle;

type ResumeLocks = parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>;
static REGISTRY: OnceLock<parking_lot::RwLock<HashMap<String, Arc<SessionHandle>>>> =
    OnceLock::new();
static RESUME_LOCKS: OnceLock<ResumeLocks> = OnceLock::new();

pub(crate) fn registry() -> &'static parking_lot::RwLock<HashMap<String, Arc<SessionHandle>>> {
    REGISTRY.get_or_init(Default::default)
}

fn session_resume_lock(session_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    RESUME_LOCKS
        .get_or_init(Default::default)
        .lock()
        .entry(session_id.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn get_handle(session_id: &str) -> Option<Arc<SessionHandle>> {
    registry()
        .read()
        .get(session_id)
        .filter(|h| h.alive.load(std::sync::atomic::Ordering::SeqCst))
        .cloned()
}

/// Idle-suspend loop (§11 B): every 60 s suspend live sessions that are not
/// streaming, have no pending UI, and were inactive for `idle_suspend_minutes`.
pub fn init(state: AppState) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let minutes = state.settings.read().idle_suspend_minutes;
            if minutes == 0 {
                continue;
            }
            let threshold = Duration::from_secs(u64::from(minutes) * 60);
            let handles: Vec<Arc<SessionHandle>> = registry().read().values().cloned().collect();
            for handle in handles {
                if handle.streaming.load(std::sync::atomic::Ordering::SeqCst)
                    || !handle.pending_ui.lock().is_empty()
                    || handle.last_activity.lock().elapsed() < threshold
                {
                    continue;
                }
                let session_id = handle.session_id.read().clone();
                if stop(&state, &session_id).await.is_ok() {
                    set_suspended(&state, &session_id, true);
                }
            }
        }
    });
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
pub async fn start(state: &AppState, opts: &StartOpts) -> Result<LiveSessionInfo, String> {
    let handle = process::spawn(state, opts).await?;
    let session_id = handle.session_id.read().clone();
    if session_id.is_empty() {
        let _ = process::stop_handle(&handle).await;
        return Err("omp did not report a sessionId".into());
    }
    registry()
        .write()
        .insert(session_id.clone(), handle.clone());
    let info = handle.info();
    let _ = state.app.emit(
        "rpc:process",
        json!({ "sessionId": session_id, "running": true, "exitCode": null }),
    );
    state.emit(AppEvent::RpcProcess {
        session_id,
        running: true,
        exit_code: None,
    });
    Ok(info)
}

/// Start with `--resume <file>` if not live (suspended/interrupted/idle).
/// Clears the `suspended` flag in session_meta.
pub async fn ensure_live(state: &AppState, session_id: &str) -> Result<LiveSessionInfo, String> {
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
    let (file, cwd) = find_session_file(state, session_id)
        .await
        .ok_or_else(|| format!("cannot locate session file for {session_id}"))?;
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

/// ensure_live + prompt (followUp when streaming).
pub async fn send_prompt(state: &AppState, session_id: &str, text: &str) -> Result<(), String> {
    let info = ensure_live(state, session_id).await?;
    let handle = get_handle(&info.session_id)
        .ok_or_else(|| "session not live after ensure_live".to_string())?;
    let streaming = handle.streaming.load(std::sync::atomic::Ordering::SeqCst);
    let command = if streaming {
        json!({"type": "prompt", "message": text, "streamingBehavior": "followUp"})
    } else {
        json!({"type": "prompt", "message": text})
    };
    process::send_command(&handle, command).await?;
    state.emit(AppEvent::PromptSent {
        session_id: info.session_id,
    });
    Ok(())
}

/// Write an `extension_ui_response`, emit `UiResponded`.
pub async fn ui_respond(state: &AppState, session_id: &str, response: Value) -> Result<(), String> {
    let handle = get_handle(session_id).ok_or("session is not live")?;
    let mut frame = json!({"type": "extension_ui_response"});
    if let Value::Object(map) = response {
        for (k, v) in map {
            frame[k] = v;
        }
    }
    let request_id = frame
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    process::send_raw(&handle, frame)?;
    if !request_id.is_empty() {
        handle
            .pending_ui
            .lock()
            .retain(|r| r.request.get("id").and_then(Value::as_str) != Some(request_id.as_str()));
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
pub async fn stop(_state: &AppState, session_id: &str) -> Result<(), String> {
    let handle = get_handle(session_id).ok_or("session is not live")?;
    process::stop_handle(&handle).await
}

/// Restart the session RPC process (the `/fresh` equivalent): terminates any
/// active child process and resumes with `--resume <file>`, resetting all
/// provider streams and active connection state without altering transcript history.
pub async fn restart(state: &AppState, session_id: &str) -> Result<LiveSessionInfo, String> {
    let lock = session_resume_lock(session_id);
    let _guard = lock.lock().await;
    if let Some(handle) = get_handle(session_id) {
        let _ = process::stop_handle(&handle).await;
        for _ in 0..20 {
            if get_handle(session_id).is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    let (file, cwd) = find_session_file(state, session_id)
        .await
        .ok_or_else(|| format!("cannot locate session file for {session_id}"))?;
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
    if let Some(pid) = meta.as_ref().and_then(|m| m.external_pid) {
        terminate_pid(pid).await;
    }
    ensure_live(state, session_id).await
}

/// SIGTERM then SIGKILL after the grace window.
async fn terminate_pid(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();
    for _ in 0..50 {
        if !pid_alive(pid) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status();
}

fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn set_suspended(state: &AppState, session_id: &str, suspended: bool) {
    let db = state.db.lock();
    let _ = db.execute(
        "UPDATE session_meta SET suspended = ?1 WHERE session_id = ?2",
        rusqlite::params![suspended as i32, session_id],
    );
}

/// Locate the session jsonl + cwd for resume: catalog first, then a filename
/// scan of `~/.omp/agent/sessions/*/​*_<id>.jsonl` with a header fallback.
async fn find_session_file(state: &AppState, session_id: &str) -> Option<(String, String)> {
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
    let text = std::fs::read_to_string(file).ok()?;
    for line in text.lines().take(8) {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) == Some("session") {
            return v.get("cwd").and_then(Value::as_str).map(str::to_string);
        }
    }
    None
}
