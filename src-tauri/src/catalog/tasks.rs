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

pub fn spawn_all(state: AppState) {
    // Subscribe to the bus synchronously so no startup events are missed.
    let bus_rx = state.bus.subscribe();

    let s1 = state.clone();
    tauri::async_runtime::spawn(async move {
        // Ensure global workspace row exists.
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

    let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(16);

    let debouncer_res = new_debouncer(
        Duration::from_millis(300),
        None,
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let matches = events.iter().any(|ev| {
                    ev.paths
                        .iter()
                        .any(|p| p.extension().and_then(|x| x.to_str()) == Some("jsonl"))
                });
                if matches {
                    let _ = tx.try_send(());
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

    while rx.recv().await.is_some() {
        super::rebuild(&state).await;
    }
}

async fn run_external_loop(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let sessions_dir = paths::omp_sessions_dir();
    let status_dir = paths::status_dir();
    let own_pid = std::process::id();

    loop {
        interval.tick().await;
        let s_dir = sessions_dir.clone();
        let holders = tokio::task::spawn_blocking(move || external::lsof_holders(&s_dir))
            .await
            .unwrap_or_default();

        let status_files = external::read_status_files(&status_dir);
        let new_ext = external::external_map(holders, &status_files, external::pid_alive, own_pid);

        let changed = {
            let mut c = cat().lock();
            if c.external != new_ext {
                c.external = new_ext;
                true
            } else {
                false
            }
        };

        if changed {
            super::recompute_async(&state, None).await;
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
            let cur_pending = c.metas.get(&session_id).and_then(|m| m.pending);
            let rt = c.runtime.entry(session_id.clone()).or_default();
            status::apply(rt, cur_pending, &live_ev)
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
