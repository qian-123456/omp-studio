//! [D] Native notifications, dock badge, sound.
//! Cross-module API per docs/ARCHITECTURE.md §9 — stubbed at scaffold time.
#![allow(dead_code, unused_variables)]

pub mod commands;

use crate::state::AppState;

/// Status-change → notification subscriber.
pub fn init(state: AppState) {}
