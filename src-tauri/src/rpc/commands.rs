//! [B] Tauri commands (docs/ARCHITECTURE.md §7).

use serde_json::Value;

use crate::contracts::{
    LiveSessionInfo, PendingUiRequest, StartOpts, SubagentSummary, SubagentTranscript,
};
use crate::state::{AppEvent, AppState};

#[tauri::command]
pub async fn rpc_start(
    state: tauri::State<'_, AppState>,
    opts: StartOpts,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::start(&state, &opts).await
}

/// `cwd`: optional override resume directory (repo main dir after the
/// worktree was deleted); persisted as `session_meta.cwd_override`.
#[tauri::command]
pub async fn rpc_ensure_live(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cwd: Option<String>,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::ensure_live(&state, &session_id, cwd).await
}

#[tauri::command]
pub async fn rpc_send(
    state: tauri::State<'_, AppState>,
    session_id: String,
    command: Value,
) -> Result<Value, String> {
    if !command.is_object() {
        return Err("command must be a JSON object".into());
    }
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
pub async fn rpc_stop(
    _state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let handle = crate::rpc::get_handle(&session_id).ok_or("session is not live")?;
    crate::rpc::stop(&handle).await
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
    model: Option<String>,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::sidechat::create(&state, &parent_session_id, selection, question, model).await
}

/// Contract C5: subagent sessions of a parent session file
/// (`<parentFile without .jsonl>/<AgentId>.jsonl`).
#[tauri::command]
pub async fn subagent_list(
    _state: tauri::State<'_, AppState>,
    parent_file: String,
) -> Result<Vec<SubagentSummary>, String> {
    crate::rpc::subagents::list(&parent_file)
}

/// Contract C5: normalized subagent transcript + meta + final output.
/// `from_byte` is an incremental cursor (returns only complete lines
/// appended since that offset; `reset` marks a truncation restart).
#[tauri::command]
pub async fn subagent_transcript(
    _state: tauri::State<'_, AppState>,
    parent_file: String,
    agent_id: String,
    from_byte: Option<u64>,
) -> Result<SubagentTranscript, String> {
    crate::rpc::subagents::transcript(&parent_file, &agent_id, from_byte)
}
