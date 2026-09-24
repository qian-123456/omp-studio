//! [E] Tauri commands: mobile + tunnel (docs/ARCHITECTURE.md §7).
#![allow(dead_code, unused_variables)]

use crate::contracts::{MobileStatus, PairingInfo};
use crate::state::AppState;

#[tauri::command]
pub async fn mobile_start(state: tauri::State<'_, AppState>) -> Result<MobileStatus, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn mobile_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn mobile_status(state: tauri::State<'_, AppState>) -> Result<MobileStatus, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn mobile_create_pairing(
    state: tauri::State<'_, AppState>,
) -> Result<PairingInfo, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn mobile_revoke_all(state: tauri::State<'_, AppState>) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn tunnel_start(state: tauri::State<'_, AppState>) -> Result<MobileStatus, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn tunnel_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    Err("not implemented".to_string())
}
