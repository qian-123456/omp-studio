//! [D] Native notifications, dock badge, sound.

pub mod commands;

use std::time::{Duration, Instant};

use tauri::Manager as _;
use tauri_plugin_notification::NotificationExt as _;
use tokio::sync::broadcast::error::RecvError;

use crate::contracts::{SessionStatus, Settings};
use crate::state::{AppEvent, AppState};

/// Ignore status churn from the catalog's initial scan.
const STARTUP_GRACE: Duration = Duration::from_secs(20);
/// Only notify for sessions touched this recently (when known).
const RECENT_MINUTES: i64 = 30;

/// Notification body for a status transition, honoring the per-kind toggles.
pub fn message_for(new: SessionStatus, s: &Settings) -> Option<&'static str> {
    match new {
        SessionStatus::Review if s.notify_turn_end => Some("已完成，待验收"),
        SessionStatus::AwaitingApproval if s.notify_approval => Some("等待审批"),
        SessionStatus::AwaitingAnswer if s.notify_approval => Some("有问题等你回答"),
        SessionStatus::Error if s.notify_exit => Some("出错了"),
        SessionStatus::Interrupted if s.notify_exit => Some("已中断"),
        _ => None,
    }
}

/// Status-change → notification subscriber; TodosChanged → dock badge.
pub fn init(state: AppState) {
    let started = Instant::now();
    let mut rx = state.bus.subscribe();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        update_badge(&state);
        loop {
            match rx.recv().await {
                Ok(AppEvent::TodosChanged) => update_badge(&state),
                Ok(AppEvent::SessionStatusChanged {
                    session_id,
                    old,
                    new,
                }) if old != new => {
                    if started.elapsed() >= STARTUP_GRACE {
                        on_status(&state, &session_id, new).await;
                    }
                }
                Ok(_) | Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    });
}

fn window_focused(state: &AppState) -> bool {
    state
        .app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}

async fn on_status(state: &AppState, session_id: &str, new: SessionStatus) {
    let settings = state.settings.read().clone();
    let Some(body) = message_for(new, &settings) else {
        return;
    };
    if window_focused(state) {
        return;
    }
    let meta = crate::todos::sessions::lookup(state, session_id).await;
    if let Some(m) = &meta {
        let stale = chrono::DateTime::parse_from_rfc3339(&m.updated_at).is_ok_and(|t| {
            chrono::Utc::now().signed_duration_since(t).num_minutes() > RECENT_MINUTES
        });
        if stale || m.archived {
            return;
        }
    }
    let title = meta
        .as_ref()
        .map(crate::todos::sessions::display_name)
        .unwrap_or_else(|| "omp-workspace".to_string());
    let snippet = meta
        .as_ref()
        .filter(|_| new == SessionStatus::Review)
        .and_then(|m| m.last_assistant.as_deref())
        .map(|s| crate::todos::transcript::truncate_chars(s, 120));
    let body = match snippet {
        Some(s) if !s.is_empty() => format!("{body} · {s}"),
        _ => body.to_string(),
    };
    if let Err(e) = send(state, &title, &body, settings.notify_sound) {
        tracing::warn!("notification failed: {e}");
    }
}

pub fn send(state: &AppState, title: &str, body: &str, sound: bool) -> Result<(), String> {
    let mut b = state.app.notification().builder().title(title).body(body);
    if sound {
        b = b.sound("default");
    }
    b.show().map_err(|e| e.to_string())
}

fn update_badge(state: &AppState) {
    let open = crate::todos::counts_sync(state).open;
    if let Some(w) = state.app.get_webview_window("main") {
        let _ = w.set_badge_count((open > 0).then_some(open as i64));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respects_toggles() {
        let mut s = Settings::default();
        assert_eq!(
            message_for(SessionStatus::Review, &s),
            Some("已完成，待验收")
        );
        assert_eq!(message_for(SessionStatus::Working, &s), None);
        s.notify_turn_end = false;
        s.notify_exit = false;
        assert_eq!(message_for(SessionStatus::Review, &s), None);
        assert_eq!(message_for(SessionStatus::Interrupted, &s), None);
        assert_eq!(
            message_for(SessionStatus::AwaitingAnswer, &s),
            Some("有问题等你回答")
        );
    }
}
