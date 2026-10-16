//! [D] Tauri commands: todos + summaries + diagnose (§7).

use crate::contracts::{Todo, TodoCounts};
use crate::state::AppState;

#[tauri::command]
pub async fn todos_list(
    state: tauri::State<'_, AppState>,
    include_closed: bool,
) -> Result<Vec<Todo>, String> {
    Ok(crate::todos::list(&state, include_closed).await)
}

/// `action`: "done" | "ignore" | "reopen".
#[tauri::command]
pub async fn todos_act(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<(), String> {
    crate::todos::act(&state, &id, &action).await
}

#[tauri::command]
pub async fn todos_counts(state: tauri::State<'_, AppState>) -> Result<TodoCounts, String> {
    Ok(crate::todos::counts(&state).await)
}

#[tauri::command]
pub async fn summary_get(
    state: tauri::State<'_, AppState>,
    session_id: String,
    ensure: bool,
) -> Result<Option<String>, String> {
    Ok(crate::todos::summary(&state, &session_id, ensure).await)
}

#[tauri::command]
pub async fn diagnose_build_prompt(
    state: tauri::State<'_, AppState>,
    target_session_id: String,
) -> Result<String, String> {
    crate::todos::diagnose::build_prompt(&state, &target_session_id).await
}

/// [D, added] Send a prompt to a session via `rpc::send_prompt` (ensure_live + prompt /
/// followUp when streaming). Used by diagnose and backlog dispatch.
#[tauri::command]
pub async fn dispatch_prompt(
    state: tauri::State<'_, AppState>,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    crate::rpc::send_prompt(&state, &session_id, &prompt).await
}
