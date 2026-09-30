//! Tauri commands for schedules management.

use tauri::{Emitter, State};

use crate::contracts::{Schedule, ScheduleDraft, ScheduleRun};
use crate::schedules::{runner, scheduler, store};
use crate::state::AppState;

#[tauri::command]
pub async fn schedules_list(state: State<'_, AppState>) -> Result<Vec<Schedule>, String> {
    store::list(&state.db.lock()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn schedules_save(
    state: State<'_, AppState>,
    schedule: ScheduleDraft,
) -> Result<Schedule, String> {
    let saved = store::upsert(&state.db.lock(), &schedule).map_err(|e| e.to_string())?;
    scheduler::notify_scheduler();
    let _ = state.app.emit("schedules:changed", ());
    Ok(saved)
}

#[tauri::command]
pub async fn schedules_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    store::delete(&state.db.lock(), &id).map_err(|e| e.to_string())?;
    scheduler::notify_scheduler();
    let _ = state.app.emit("schedules:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn schedules_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Schedule, String> {
    let updated = store::set_enabled(&state.db.lock(), &id, enabled).map_err(|e| e.to_string())?;
    scheduler::notify_scheduler();
    let _ = state.app.emit("schedules:changed", ());
    Ok(updated)
}

#[tauri::command]
pub async fn schedules_run_now(
    state: State<'_, AppState>,
    id: String,
) -> Result<ScheduleRun, String> {
    runner::run_now((*state).clone(), id).await
}

#[tauri::command]
pub async fn schedule_runs(
    state: State<'_, AppState>,
    schedule_id: String,
    limit: Option<u32>,
) -> Result<Vec<ScheduleRun>, String> {
    store::list_runs(&state.db.lock(), &schedule_id, limit.unwrap_or(20)).map_err(|e| e.to_string())
}
