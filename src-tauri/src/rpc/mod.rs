//! [B] omp --mode rpc process manager, idle suspend, takeover.
//! Cross-module API per docs/ARCHITECTURE.md §9.
#![allow(dead_code)]

pub mod commands;
mod frame;
#[cfg(test)]
mod live_test;
mod process;
mod sidechat;
mod subagents;

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Emitter;

use crate::contracts::{LiveSessionInfo, PendingUiRequest, SessionMeta, StartOpts};
use crate::state::{AppEvent, AppState};
use crate::{catalog, paths};

pub use process::SessionHandle;

type ResumeLocks = parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>;
static REGISTRY: OnceLock<parking_lot::RwLock<HashMap<String, Arc<SessionHandle>>>> =
    OnceLock::new();
static RESUME_LOCKS: OnceLock<ResumeLocks> = OnceLock::new();

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

pub fn get_handle(session_id: &str) -> Option<Arc<SessionHandle>> {
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
                if stop(&handle).await.is_ok() {
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
    let old_handle = registry().read().get(&session_id).cloned();
    if let Some(old) = old_handle {
        if !Arc::ptr_eq(&old, &handle) {
            let _ = process::stop_handle(&old).await;
        }
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

/// Start with `--resume <file>` if not live (suspended/interrupted/idle).
/// Clears the `suspended` flag in session_meta.
///
/// `cwd = Some(dir)`: user-chosen resume directory (e.g. the repo's main dir
/// after its worktree was deleted). Must be an existing directory; it is
/// persisted as `session_meta.cwd_override` and the catalog meta is recomputed.
/// `cwd = None`: resume in the transcript/override cwd; when that directory no
/// longer exists this fails with `CWD_MISSING:<cwd>` instead of spawning.
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
    let (file, found_cwd) = find_session_file(state, session_id)
        .await
        .ok_or_else(|| format!("cannot locate session file for {session_id}"))?;
    let cwd = match cwd {
        Some(dir) => {
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
    let info = ensure_live(state, session_id, None).await?;
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
pub async fn stop(handle: &Arc<SessionHandle>) -> Result<(), String> {
    process::stop_handle(handle).await
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
    if let Some(pid) = meta.as_ref().and_then(|m| m.external_pid) {
        terminate_pid(pid).await;
    }
    ensure_live(state, session_id, None).await
}

/// SIGTERM then SIGKILL after the grace window.
async fn terminate_pid(pid: u32) {
    if pid <= 1 {
        return;
    }
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
    // SAFETY: send SIGKILL after grace period.
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGKILL);
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

fn set_suspended(state: &AppState, session_id: &str, suspended: bool) {
    let db = state.db.lock();
    let _ = db.execute(
        "UPDATE session_meta SET suspended = ?1 WHERE session_id = ?2",
        rusqlite::params![suspended as i32, session_id],
    );
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
