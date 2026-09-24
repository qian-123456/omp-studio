//! [B] omp --mode rpc process manager, idle suspend, takeover.
//! Cross-module API per docs/ARCHITECTURE.md §9 — stubbed at scaffold time.
#![allow(dead_code, unused_variables)]

pub mod commands;

use crate::contracts::{LiveSessionInfo, PendingUiRequest};
use crate::state::AppState;

/// Idle-suspend loop.
pub fn init(state: AppState) {}

/// ensure_live + prompt (followUp when streaming).
pub async fn send_prompt(state: &AppState, session_id: &str, text: &str) -> Result<(), String> {
    Err("not implemented".to_string())
}

pub async fn ui_respond(
    state: &AppState,
    session_id: &str,
    response: serde_json::Value,
) -> Result<(), String> {
    Err("not implemented".to_string())
}

pub async fn ensure_live(state: &AppState, session_id: &str) -> Result<LiveSessionInfo, String> {
    Err("not implemented".to_string())
}

pub async fn pending_ui(state: &AppState, session_id: &str) -> Vec<PendingUiRequest> {
    Vec::new()
}

pub fn is_live(session_id: &str) -> bool {
    false
}
