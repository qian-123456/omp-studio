//! [A] Tauri commands (docs/ARCHITECTURE.md §7).
#![allow(dead_code, unused_variables)]

use crate::contracts::{SessionMeta, SessionMetaPatch, TranscriptPage, UsageSummary, Workspace};
use crate::state::AppState;

#[tauri::command]
pub async fn list_sessions(state: tauri::State<'_, AppState>) -> Result<Vec<SessionMeta>, String> {
    Ok(crate::catalog::list(&state).await)
}

#[tauri::command]
pub async fn get_transcript(
    state: tauri::State<'_, AppState>,
    session_id: String,
    from_offset: Option<u64>,
) -> Result<TranscriptPage, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn update_session_meta(
    state: tauri::State<'_, AppState>,
    session_id: String,
    patch: SessionMetaPatch,
) -> Result<SessionMeta, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn mark_seen(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn accept_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    archive: bool,
) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn list_workspaces(state: tauri::State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn add_workspace(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Workspace, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn remove_workspace(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn reorder_workspaces(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn session_usage(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<UsageSummary, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn rescan_sessions(state: tauri::State<'_, AppState>) -> Result<(), String> {
    Err("not implemented".to_string())
}
