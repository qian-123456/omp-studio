//! AppState + event bus (docs/ARCHITECTURE.md §5).
// Variants/methods are consumed by module stubs filled in later.
#![allow(dead_code)]

use std::sync::Arc;

use crate::contracts::{SessionStatus, Settings};

#[derive(Debug, Clone)]
pub enum AppEvent {
    /// Every stdout frame except `ready`.
    RpcFrame {
        session_id: String,
        frame: serde_json::Value,
    },
    RpcProcess {
        session_id: String,
        running: bool,
        exit_code: Option<i32>,
    },
    /// After a UI response was written.
    UiResponded {
        session_id: String,
        request_id: String,
    },
    /// User sent prompt/steer/follow_up.
    PromptSent {
        session_id: String,
    },
    SessionAccepted {
        session_id: String,
    },
    SessionStatusChanged {
        session_id: String,
        old: SessionStatus,
        new: SessionStatus,
    },
    SessionsChanged {
        ids: Vec<String>,
    },
    TodosChanged,
    BacklogChanged,
    ServicesChanged,
}

#[derive(Clone)]
pub struct AppState {
    pub app: tauri::AppHandle,
    pub db: Arc<parking_lot::Mutex<rusqlite::Connection>>,
    /// Capacity 1024.
    pub bus: tokio::sync::broadcast::Sender<AppEvent>,
    pub settings: Arc<parking_lot::RwLock<Settings>>,
}

impl AppState {
    pub fn new(app: tauri::AppHandle, db: rusqlite::Connection, settings: Settings) -> Self {
        let (bus, _) = tokio::sync::broadcast::channel(1024);
        Self {
            app,
            db: Arc::new(parking_lot::Mutex::new(db)),
            bus,
            settings: Arc::new(parking_lot::RwLock::new(settings)),
        }
    }

    pub fn emit(&self, event: AppEvent) {
        // Receivers may all be gone; that is fine.
        let _ = self.bus.send(event);
    }
}
