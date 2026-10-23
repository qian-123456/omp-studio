//! Global quick-capture shortcut: shows + focuses the window and emits `quick-capture`.
//! Re-registers when `settings.quick_capture_shortcut` changes (polled every 2 s).

use std::time::Duration;

use tauri::{Emitter as _, Manager as _};
use tauri_plugin_global_shortcut::{GlobalShortcutExt as _, ShortcutState};

use crate::state::AppState;

pub fn spawn(state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mut current: Option<String> = None;
        let mut last_failed: Option<String> = None;
        loop {
            let want = state
                .settings
                .read()
                .quick_capture_shortcut
                .trim()
                .to_string();
            if current.as_deref() != Some(want.as_str()) {
                let gs = state.app.global_shortcut();
                if want.is_empty() {
                    if let Some(old) = current.take() {
                        let _ = gs.unregister(old.as_str());
                    }
                    last_failed = None;
                } else if last_failed.as_deref() != Some(want.as_str()) {
                    let res = gs.on_shortcut(want.as_str(), |app, _shortcut, event| {
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("quick-capture", ());
                    });
                    match res {
                        Ok(_) => {
                            if let Some(old) = current.take() {
                                if old != want {
                                    let _ = gs.unregister(old.as_str());
                                }
                            }
                            current = Some(want);
                            last_failed = None;
                        }
                        Err(e) => {
                            tracing::warn!("register quick-capture shortcut {want:?}: {e}; keeping existing registration");
                            last_failed = Some(want);
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}
