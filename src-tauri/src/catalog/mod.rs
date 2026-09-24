//! [A] Session scan/parse/watch/status/workspaces/usage.
//! Cross-module API per docs/ARCHITECTURE.md §9 — stubbed at scaffold time.
#![allow(dead_code, unused_variables)]

pub mod commands;

use crate::contracts::{PendingKind, SessionMeta};
use crate::state::AppState;

/// Spawn scanner/watcher/status tasks.
pub fn init(state: AppState) {}

pub async fn list(state: &AppState) -> Vec<SessionMeta> {
    Vec::new()
}

pub async fn get(state: &AppState, session_id: &str) -> Option<SessionMeta> {
    None
}

/// Internal to A; listed in §9 only so nobody else writes `pending_kind`.
pub async fn set_pending(state: &AppState, session_id: &str, pending: Option<PendingKind>) {}
