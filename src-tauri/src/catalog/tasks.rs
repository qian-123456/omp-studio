//! [A] Background loops: watcher, external process detection (lsof + status files),
//! and AppState event bus subscription.

use std::time::Duration;

use notify_debouncer_full::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use tracing::warn;

use super::cat;
use super::external;
use super::status::{self, LiveEvent};
use super::store;
use crate::paths;
use crate::state::{AppEvent, AppState};

static EXTERNAL_NOTIFY: std::sync::OnceLock<tokio::sync::Notify> = std::sync::OnceLock::new();

pub fn notify_external_check() {
    if let Some(notify) = EXTERNAL_NOTIFY.get() {
        notify.notify_one();
    }
}
pub fn spawn_all(state: AppState) {
    // Subscribe to the bus synchronously so no startup events are missed.
    let bus_rx = state.bus.subscribe();

    let s1 = state.clone();
    tauri::async_runtime::spawn(async move {
        // Ensure per-mode global workspace rows exist (lazily, for modes
        // already referenced by sessions/workspaces/groups).
        {
            let db = s1.db.lock();
            if let Err(e) = crate::db::ensure_global_workspace(&db) {
                warn!("ensure_global_workspace: {e}");
            }
        }
        // Initial catalog build.
        super::rebuild(&s1).await;
    });

    let s2 = state.clone();
    tauri::async_runtime::spawn(async move {
        run_watcher(s2).await;
    });

    let s3 = state.clone();
    tauri::async_runtime::spawn(async move {
        run_external_loop(s3).await;
    });

    let s4 = state.clone();
    tauri::async_runtime::spawn(async move {
        run_bus_loop(s4, bus_rx).await;
    });
}

async fn run_watcher(state: AppState) {
    let sessions_dir = paths::omp_sessions_dir();
    let status_dir = paths::status_dir();
    let _ = std::fs::create_dir_all(&sessions_dir);
    let _ = std::fs::create_dir_all(&status_dir);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<WatchBatch>();

    let watch_root = sessions_dir.clone();
    let debouncer_res = new_debouncer(
        Duration::from_millis(300),
        None,
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let batch =
                    classify_events(&watch_root, events.iter().flat_map(|ev| ev.paths.iter()));
                if !batch.is_empty() {
                    let _ = tx.send(batch);
                }
            }
        },
    );

    let mut debouncer = match debouncer_res {
        Ok(d) => d,
        Err(e) => {
            warn!("failed to create session file debouncer: {e}");
            return;
        }
    };

    if let Err(e) = debouncer.watch(&sessions_dir, RecursiveMode::Recursive) {
        warn!("failed to watch sessions dir {sessions_dir:?}: {e}");
    }
    if let Err(e) = debouncer.watch(&status_dir, RecursiveMode::NonRecursive) {
        warn!("failed to watch status dir {status_dir:?}: {e}");
    }

    while let Some(mut batch) = rx.recv().await {
        // Coalesce rapid bursts of file modifications
        tokio::time::sleep(Duration::from_millis(50)).await;
        while let Ok(more) = rx.try_recv() {
            batch.merge(more);
        }
        if batch.full {
            super::search::request_rescan();
            super::rebuild(&state).await;
        } else {
            super::search::request_paths(batch.sessions.iter().cloned().collect());
            super::refresh_paths(&state, batch.sessions.into_iter().collect()).await;
        }
        notify_external_check();
    }
}

/// Watcher events reduced to what the catalog must do.
#[derive(Default)]
struct WatchBatch {
    /// Something other than a plain change to a known-shaped session file
    /// (status files, unexpected locations): rescan everything.
    full: bool,
    /// Changed `<sessions>/<bucket>/<name>.jsonl` files.
    sessions: std::collections::HashSet<std::path::PathBuf>,
}

impl WatchBatch {
    fn is_empty(&self) -> bool {
        !self.full && self.sessions.is_empty()
    }
    fn merge(&mut self, other: WatchBatch) {
        self.full |= other.full;
        self.sessions.extend(other.sessions);
    }
}

fn classify_events<'a>(
    sessions_dir: &std::path::Path,
    paths: impl Iterator<Item = &'a std::path::PathBuf>,
) -> WatchBatch {
    let mut batch = WatchBatch::default();
    for p in paths {
        let ext = p.extension().and_then(|x| x.to_str());
        if !matches!(ext, Some("jsonl" | "json")) {
            continue;
        }
        if ext == Some("jsonl") && super::scan::is_session_file(sessions_dir, p) {
            batch.sessions.insert(p.clone());
        } else if ext == Some("jsonl") && p.starts_with(sessions_dir) {
            // Subagent / artifact logs below a session dir: not catalog input.
        } else {
            batch.full = true;
        }
    }
    batch
}

async fn run_external_loop(state: AppState) {
    let notify = EXTERNAL_NOTIFY.get_or_init(tokio::sync::Notify::new);
    let sessions_dir = paths::omp_sessions_dir();
    let status_dir = paths::status_dir();
    let own_pid = std::process::id();

    // Idle backoff reaches 60s: the file watcher calls `notify_external_check`
    // on every session-file change, so a terminal omp opening a session still
    // wakes this loop immediately.
    const MIN_DELAY: Duration = Duration::from_secs(5);
    const MAX_DELAY: Duration = Duration::from_secs(60);
    const STEP: Duration = Duration::from_secs(10);

    let mut current_delay = MIN_DELAY;

    loop {
        let s_dir = sessions_dir.clone();
        let holders = tokio::task::spawn_blocking(move || external::lsof_holders(&s_dir))
            .await
            .unwrap_or_default();

        let status_files = external::read_status_files(&status_dir);
        let new_ext = external::external_map(holders, &status_files, external::pid_alive, own_pid);

        // Terminal squeezes GUI offline: an external holder on a file we also
        // hold via an app-owned RPC child means a single-writer conflict; step
        // down to read-only observation.
        let conflicting: Vec<_> = crate::rpc::registry()
            .read()
            .values()
            .filter(|h| {
                let file = h.session_file.read();
                !file.is_empty()
                    && new_ext
                        .get(file.as_str())
                        .is_some_and(|&pid| pid != h.pid && pid != own_pid)
            })
            .cloned()
            .collect();
        for handle in conflicting {
            let session_id = handle.session_id.read().clone();
            warn!("external holder detected for {session_id}; stopping app-owned RPC");
            let _ = crate::rpc::stop(&handle).await;
            crate::rpc::set_suspended(&state, &session_id, true);
        }

        // A terminal omp that opened our session file while the app's RPC held
        // it forks into a NEW file (parentSession = our id); the app's child
        // would keep appending to the old file and the two histories diverge.
        // Release the app side and tell the user.
        let live: Vec<(String, String)> = crate::rpc::registry()
            .read()
            .values()
            .map(|h| (h.session_id.read().clone(), h.session_file.read().clone()))
            .collect();
        let mut own_pids: Vec<u32> = crate::rpc::registry()
            .read()
            .values()
            .map(|h| h.pid)
            .collect();
        own_pids.push(own_pid);
        let forks =
            external::detect_forks(&live, &status_files, external::pid_alive, &own_pids, |f| {
                super::parse::read_head(std::path::Path::new(f))
                    .ok()
                    .flatten()
                    .and_then(|h| h.parent_session)
            });
        for fork in forks {
            let handle = crate::rpc::get_handle(&fork.live_session_id);
            if let Some(handle) = handle {
                warn!(
                    "terminal omp forked live session {} into {}; stopping app-owned RPC",
                    fork.live_session_id, fork.fork_session_id
                );
                let _ = crate::rpc::stop(&handle).await;
                crate::rpc::set_suspended(&state, &fork.live_session_id, true);
                let _ = tauri::Emitter::emit(
                    &state.app,
                    "sessions:forked",
                    serde_json::json!({
                        "sessionId": fork.live_session_id,
                        "forkSessionId": fork.fork_session_id,
                    }),
                );
            }
        }

        let changed = {
            let mut c = cat().lock();
            if c.external != new_ext {
                c.external = new_ext.clone();
                true
            } else {
                false
            }
        };

        if changed {
            super::recompute_async(&state, None).await;
        }

        // Adaptive backoff:
        // If external sessions exist or state changed, stay at 5s to promptly detect exit/takeover.
        // If idle (no external sessions and no change), progressively back off to 30s.
        if !new_ext.is_empty() || changed {
            current_delay = MIN_DELAY;
        } else {
            current_delay = (current_delay + STEP).min(MAX_DELAY);
        }

        tokio::select! {
            _ = tokio::time::sleep(current_delay) => {},
            _ = notify.notified() => {
                current_delay = MIN_DELAY;
            }
        }
    }
}

async fn run_bus_loop(state: AppState, mut bus: tokio::sync::broadcast::Receiver<AppEvent>) {
    loop {
        let ev = match bus.recv().await {
            Ok(e) => e,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!("catalog bus lagged by {n} events");
                continue;
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        };

        let (session_id, live_ev) = match ev {
            AppEvent::RpcFrame { session_id, frame } => (session_id, LiveEvent::Frame(frame)),
            AppEvent::RpcProcess {
                session_id,
                running,
                exit_code,
            } => (session_id, LiveEvent::Process { running, exit_code }),
            AppEvent::UiResponded {
                session_id,
                request_id,
            } => (session_id, LiveEvent::UiResponded { request_id }),
            AppEvent::PromptSent { session_id } => (session_id, LiveEvent::PromptSent),
            AppEvent::SessionAccepted { session_id } => (session_id, LiveEvent::Accepted),
            _ => continue,
        };

        let change = {
            let mut c = cat().lock();
            // Deleted session: a process-exit event may land after purge; never
            // resurrect its runtime or persist a new session_meta row.
            if c.deleted.contains(&session_id) {
                continue;
            }
            let cur_pending = c.metas.get(&session_id).and_then(|m| m.pending);
            let rt = c.runtime.entry(session_id.clone()).or_default();
            let mut change = status::apply(rt, cur_pending, &live_ev);
            // A settle (the only event that marks unread) consumes the quiet flag.
            if change.unread.is_some() && c.quiet.remove(&session_id) {
                status::silence_settle(&mut change);
            }
            change
        };

        if let Some(new_p) = change.pending {
            let db = state.db.lock();
            if let Err(e) = store::set_pending(&db, &session_id, new_p) {
                warn!("bus set_pending {session_id}: {e}");
            }
        }
        if let Some(u) = change.unread {
            let db = state.db.lock();
            if let Err(e) = store::set_unread(&db, &session_id, u) {
                warn!("bus set_unread {session_id}: {e}");
            }
        }

        if change.pending.is_some() || change.unread.is_some() || change.runtime {
            super::recompute_async(&state, Some(vec![session_id])).await;
        }
    }
}

#[cfg(test)]
mod watch_tests {
    use super::classify_events;
    use std::path::PathBuf;

    #[test]
    fn classify_routes_session_subagent_and_status_events() {
        let dir = PathBuf::from("/s");
        let session = PathBuf::from("/s/b/one.jsonl");
        let subagent = PathBuf::from("/s/b/one/sub.jsonl");
        let status = PathBuf::from("/status/x.json");
        let other = PathBuf::from("/s/b/readme.txt");

        let b = classify_events(&dir, [&session, &subagent, &other].into_iter());
        assert!(!b.full);
        assert_eq!(b.sessions.len(), 1);
        assert!(b.sessions.contains(&session));

        assert!(classify_events(&dir, [&status].into_iter()).full);
        assert!(classify_events(&dir, [&other, &subagent].into_iter()).is_empty());
        // Outside the sessions dir (e.g. a symlinked root): rescan everything.
        let elsewhere = PathBuf::from("/private/s/b/one.jsonl");
        assert!(classify_events(&dir, [&elsewhere].into_iter()).full);
    }
}
