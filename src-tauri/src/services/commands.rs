//! [C] Tauri commands: services + text file IO (docs/ARCHITECTURE.md §7).

use super::files;
use crate::contracts::ServiceInfo;
use crate::state::AppState;

#[tauri::command]
pub async fn services_list(
    _state: tauri::State<'_, AppState>,
    all: bool,
) -> Result<Vec<ServiceInfo>, String> {
    Ok(crate::services::list(all).await)
}

#[tauri::command]
pub async fn services_stop(_state: tauri::State<'_, AppState>, pid: u32) -> Result<(), String> {
    crate::services::stop(pid).await
}

/// For the md editor; must reject paths > 5 MB.
#[tauri::command]
pub async fn read_text_file(
    _state: tauri::State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let p = files::resolve(&path)?;
    tokio::task::spawn_blocking(move || files::read_text(&p))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_text_file(
    _state: tauri::State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let p = files::resolve(&path)?;
    tokio::task::spawn_blocking(move || files::write_text(&p, &content))
        .await
        .map_err(|e| e.to_string())?
}
