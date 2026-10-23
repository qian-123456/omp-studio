//! [D] Backlog store + prompt assembly + quick-capture shortcut.

pub mod commands;
pub mod images;
pub mod prompt;
pub mod shortcut;
pub mod store;

use tauri::Emitter as _;

use crate::state::{AppEvent, AppState};

/// Register the global quick-capture shortcut. Dispatched items are completed
/// only manually by the user (no auto-complete on session acceptance).
pub fn init(state: AppState) {
    // Idempotent: move backlog images into the durable dir (originals kept).
    let moved = images::migrate(&state.db.lock(), &crate::paths::images_dir());
    match moved {
        Ok(n) if n > 0 => tracing::info!("backlog: moved images of {n} item(s) to the durable dir"),
        Ok(_) => {}
        Err(e) => tracing::warn!("backlog image migration failed: {e}"),
    }
    // Finished items older than 30 days move to the trash first (so they get a fresh 7-day grace).
    let archived = store::archive_finished(&state.db.lock(), chrono::Utc::now());
    match archived {
        Ok(n) if n > 0 => tracing::info!("backlog: moved {n} old finished item(s) to the trash"),
        Ok(_) => {}
        Err(e) => tracing::warn!("backlog finished archive failed: {e}"),
    }
    // Trash keeps 7 days; rows (and their images) older than that go for good.
    let purged = store::purge_expired(&state.db.lock(), chrono::Utc::now());
    match purged {
        Ok(n) if n > 0 => tracing::info!("backlog: purged {n} expired trashed item(s)"),
        Ok(_) => {}
        Err(e) => tracing::warn!("backlog trash purge failed: {e}"),
    }
    shortcut::spawn(state);
}

/// Emit `backlog:changed` (frontend) + `AppEvent::BacklogChanged` (bus).
pub fn notify_changed(state: &AppState) {
    let _ = state.app.emit("backlog:changed", ());
    state.emit(AppEvent::BacklogChanged);
}
