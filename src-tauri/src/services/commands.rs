//! [C] Tauri commands: services + text file IO (docs/ARCHITECTURE.md §7).
#![allow(dead_code, unused_variables)]

use crate::contracts::ServiceInfo;
use crate::state::AppState;

#[tauri::command]
pub async fn services_list(
    state: tauri::State<'_, AppState>,
    all: bool,
) -> Result<Vec<ServiceInfo>, String> {
    Ok(crate::services::list(all).await)
}

#[tauri::command]
pub async fn services_stop(state: tauri::State<'_, AppState>, pid: u32) -> Result<(), String> {
    Err("not implemented".to_string())
}

/// For the md editor; must reject paths > 5 MB.
#[tauri::command]
pub async fn read_text_file(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn write_text_file(
    state: tauri::State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    Err("not implemented".to_string())
}
