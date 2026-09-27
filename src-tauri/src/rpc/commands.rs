//! [B] Tauri commands (docs/ARCHITECTURE.md §7).

use serde_json::Value;

use crate::contracts::{LiveSessionInfo, PendingUiRequest, StartOpts};
use crate::state::{AppEvent, AppState};

#[tauri::command]
pub async fn rpc_start(
    state: tauri::State<'_, AppState>,
    opts: StartOpts,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::start(&state, &opts).await
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
    command: Value,
) -> Result<Value, String> {
    let handle = crate::rpc::get_handle(&session_id).ok_or("session is not live")?;
    let is_prompt = matches!(
        command.get("type").and_then(Value::as_str),
        Some("prompt" | "steer" | "follow_up" | "abort_and_prompt")
    );
    let resp = crate::rpc::process::send_command(&handle, command).await?;
    if is_prompt {
        state.emit(AppEvent::PromptSent { session_id });
    }
    Ok(resp)
}

#[tauri::command]
pub async fn rpc_ui_respond(
    state: tauri::State<'_, AppState>,
    session_id: String,
    response: Value,
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
    crate::rpc::stop(&state, &session_id).await
}

#[tauri::command]
pub async fn rpc_restart(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::restart(&state, &session_id).await
}

#[tauri::command]
pub async fn rpc_list_live(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<LiveSessionInfo>, String> {
    let _ = state;
    Ok(crate::rpc::registry()
        .read()
        .values()
        .filter(|h| h.alive.load(std::sync::atomic::Ordering::SeqCst))
        .map(|h| h.info())
        .collect())
}

#[tauri::command]
pub async fn takeover_external(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::takeover_external(&state, &session_id).await
}

#[tauri::command]
pub async fn create_side_chat(
    state: tauri::State<'_, AppState>,
    parent_session_id: String,
    selection: Option<String>,
    question: String,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::sidechat::create(&state, &parent_session_id, selection, question).await
}
