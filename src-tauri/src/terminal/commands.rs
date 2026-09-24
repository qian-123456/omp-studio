//! [E] Tauri commands: terminal + status extension (docs/ARCHITECTURE.md §7).
#![allow(dead_code, unused_variables)]

use crate::state::AppState;

/// Returns the new termId.
#[tauri::command]
pub async fn term_open(
    state: tauri::State<'_, AppState>,
    cwd: String,
    command: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    Err("not implemented".to_string())
}

/// `data`: utf8 text.
#[tauri::command]
pub async fn term_write(
    state: tauri::State<'_, AppState>,
    term_id: String,
    data: String,
) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn term_resize(
    state: tauri::State<'_, AppState>,
    term_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn term_close(state: tauri::State<'_, AppState>, term_id: String) -> Result<(), String> {
    Err("not implemented".to_string())
}

/// Stops the RPC process for the session if live, then runs
/// `omp --resume <file> -e <extension_path>` in a PTY. Returns termId.
#[tauri::command]
pub async fn term_open_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    Err("not implemented".to_string())
}

/// Copies the status extension into `~/.omp/agent/extensions/` (opt-in button).
/// Returns the installed path.
#[tauri::command]
pub async fn install_status_extension_globally(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    Err("not implemented".to_string())
}
