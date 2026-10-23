//! [D] Smart todo queue, system detection, summaries, diagnose.
//! Cross-module API per docs/ARCHITECTURE.md §9.

pub mod commands;
pub mod detect;
pub mod diagnose;
pub mod omp;
pub mod sessions;
pub mod store;
pub mod summary;
pub mod transcript;

use tauri::Emitter as _;

use crate::contracts::{Todo, TodoCounts, TodoKind, TodoStatus};
use crate::state::{AppEvent, AppState};

/// System-detection bus subscriber, reconcile loop and summary refresh loop.
pub fn init(state: AppState) {
    detect::spawn(state.clone());
    summary::spawn_refresh(state);
}

fn show_system(state: &AppState) -> bool {
    state.settings.read().system_detection
}

pub async fn list(state: &AppState, include_closed: bool) -> Vec<Todo> {
    let sys = show_system(state);
    store::list(&state.db.lock(), include_closed, sys).unwrap_or_default()
}

/// `action`: "done" | "ignore" | "reopen".
pub async fn act(state: &AppState, id: &str, action: &str) -> Result<(), String> {
    let status = match action {
        "done" => TodoStatus::Done,
        "ignore" => TodoStatus::Ignored,
        "reopen" => TodoStatus::Open,
        other => return Err(format!("unknown action: {other}")),
    };
    let todo = {
        let db = state.db.lock();
        let todo = store::get(&db, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "待办不存在".to_string())?;
        store::set_status(&db, id, status).map_err(|e| e.to_string())?;
        todo
    };
    // Completing a Review todo == accepting the session (A reacts to the event).
    if status == TodoStatus::Done && todo.kind == TodoKind::Review {
        if let Some(sid) = todo.session_id {
            state.emit(AppEvent::SessionAccepted { session_id: sid });
        }
    }
    notify_changed(state);
    Ok(())
}

pub async fn counts(state: &AppState) -> TodoCounts {
    counts_sync(state)
}

pub fn counts_sync(state: &AppState) -> TodoCounts {
    let sys = show_system(state);
    store::counts(&state.db.lock(), sys)
}

/// Latest compaction summary, cached row, or (if `ensure`) generate one.
pub async fn summary(state: &AppState, session_id: &str, ensure: bool) -> Option<String> {
    summary::get(state, session_id, ensure).await
}

/// Emit `todos:changed` (frontend) + `AppEvent::TodosChanged` (bus).
pub fn notify_changed(state: &AppState) {
    let _ = state.app.emit("todos:changed", counts_sync(state));
    state.emit(AppEvent::TodosChanged);
}
