//! [D] Backlog store + prompt assembly + quick-capture shortcut.

pub mod commands;
pub mod prompt;
pub mod shortcut;
pub mod store;

use tauri::Emitter as _;
use tokio::sync::broadcast::error::RecvError;

use crate::state::{AppEvent, AppState};

/// Auto-complete dispatched items on `SessionAccepted`; register the global shortcut.
pub fn init(state: AppState) {
    let mut rx = state.bus.subscribe();
    shortcut::spawn(state.clone());
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(AppEvent::SessionAccepted { session_id }) => {
                    let changed = store::complete_for_session(&state.db.lock(), &session_id);
                    if changed {
                        notify_changed(&state);
                    }
                }
                Ok(_) | Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    });
}

/// Emit `backlog:changed` (frontend) + `AppEvent::BacklogChanged` (bus).
pub fn notify_changed(state: &AppState) {
    let _ = state.app.emit("backlog:changed", ());
    state.emit(AppEvent::BacklogChanged);
}
