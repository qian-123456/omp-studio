//! [D] Smart todo queue, system detection, supervisor, summaries, diagnose.
//! Cross-module API per docs/ARCHITECTURE.md §9 — stubbed at scaffold time.
#![allow(dead_code, unused_variables)]

pub mod commands;

use crate::contracts::{Todo, TodoCounts};
use crate::state::AppState;

/// System-detection bus subscriber + summary refresh loop.
pub fn init(state: AppState) {}

pub async fn list(state: &AppState, include_closed: bool) -> Vec<Todo> {
    Vec::new()
}

/// `action`: "done" | "ignore".
pub async fn act(state: &AppState, id: &str, action: &str) -> Result<(), String> {
    Err("not implemented".to_string())
}

pub async fn counts(state: &AppState) -> TodoCounts {
    TodoCounts::default()
}

/// Latest compaction summary, cached row, or (if `ensure`) generate one.
pub async fn summary(state: &AppState, session_id: &str, ensure: bool) -> Option<String> {
    None
}
