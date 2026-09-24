//! [B] Tauri commands (docs/ARCHITECTURE.md §7).
#![allow(dead_code, unused_variables)]

use crate::contracts::{LiveSessionInfo, PendingUiRequest, StartOpts};
use crate::state::AppState;

#[tauri::command]
pub async fn rpc_start(
    state: tauri::State<'_, AppState>,
    opts: StartOpts,
) -> Result<LiveSessionInfo, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn rpc_ensure_live(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::ensure_live(&state, &session_id).await
}

#[tauri::command]
pub async fn rpc_send(
    state: tauri::State<'_, AppState>,
    session_id: String,
    command: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn rpc_ui_respond(
    state: tauri::State<'_, AppState>,
    session_id: String,
    response: serde_json::Value,
) -> Result<(), String> {
    crate::rpc::ui_respond(&state, &session_id, response).await
}

#[tauri::command]
pub async fn rpc_pending_ui(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<PendingUiRequest>, String> {
    Ok(crate::rpc::pending_ui(&state, &session_id).await)
}

#[tauri::command]
pub async fn rpc_stop(state: tauri::State<'_, AppState>, session_id: String) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn rpc_list_live(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<LiveSessionInfo>, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn takeover_external(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<LiveSessionInfo, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn create_side_chat(
    state: tauri::State<'_, AppState>,
    parent_session_id: String,
    selection: Option<String>,
    question: String,
) -> Result<LiveSessionInfo, String> {
    Err("not implemented".to_string())
}
