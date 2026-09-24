//! [C] Local port/process listing, stop, reminders.
//! Cross-module API per docs/ARCHITECTURE.md §9 — stubbed at scaffold time.
#![allow(dead_code, unused_variables)]

pub mod commands;

use crate::contracts::ServiceInfo;
use crate::state::AppState;

pub fn init(state: AppState) {}

pub async fn list(all: bool) -> Vec<ServiceInfo> {
    Vec::new()
}
