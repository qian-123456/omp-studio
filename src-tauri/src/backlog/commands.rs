//! [D] Tauri commands: backlog (docs/ARCHITECTURE.md §7).
#![allow(dead_code, unused_variables)]

use crate::contracts::{BacklogItem, BacklogKind, BacklogPatch, BacklogRef};
use crate::state::AppState;

#[tauri::command]
pub async fn backlog_list(state: tauri::State<'_, AppState>) -> Result<Vec<BacklogItem>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn backlog_add(
    state: tauri::State<'_, AppState>,
    text: String,
    kind: BacklogKind,
    refs: Vec<BacklogRef>,
) -> Result<BacklogItem, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn backlog_update(
    state: tauri::State<'_, AppState>,
    id: String,
    patch: BacklogPatch,
) -> Result<BacklogItem, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn backlog_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn backlog_build_prompt(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    Err("not implemented".to_string())
}
