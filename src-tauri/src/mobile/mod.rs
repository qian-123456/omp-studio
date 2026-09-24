//! [E] LAN HTTP server, pairing, QR, SSE, cloudflared tunnel.
//! Cross-module API per docs/ARCHITECTURE.md §9 — stubbed at scaffold time.
#![allow(dead_code, unused_variables)]

pub mod commands;

use crate::state::AppState;

/// Autostart when settings.mobile_enabled.
pub fn init(state: AppState) {}
