//! [D] Backlog store + prompt assembly + quick-capture shortcut.

pub mod commands;
pub mod prompt;
pub mod shortcut;
pub mod store;

use tauri::Emitter as _;

use crate::state::{AppEvent, AppState};

/// Register the global quick-capture shortcut. Dispatched items are completed
/// only manually by the user (no auto-complete on session acceptance).
pub fn init(state: AppState) {
    shortcut::spawn(state);
}

/// Emit `backlog:changed` (frontend) + `AppEvent::BacklogChanged` (bus).
pub fn notify_changed(state: &AppState) {
    let _ = state.app.emit("backlog:changed", ());
    state.emit(AppEvent::BacklogChanged);
}
