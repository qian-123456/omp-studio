//! [D] Tauri commands: notifications (docs/ARCHITECTURE.md §7).
#![allow(dead_code, unused_variables)]

use crate::state::AppState;

#[tauri::command]
pub async fn notify_test(state: tauri::State<'_, AppState>) -> Result<(), String> {
    Err("not implemented".to_string())
}
