//! [D] Native notifications, dock badge, sound.

pub mod commands;

use std::time::{Duration, Instant};

use tauri::Manager as _;
use tauri_plugin_notification::NotificationExt as _;
use tokio::sync::broadcast::error::RecvError;

use crate::contracts::{Attention, SessionMeta, SessionStatus, Settings};
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

/// Status-change → notification subscriber; SessionsChanged + 60 s tick → dock badge.
pub fn init(state: AppState) {
    let started = Instant::now();
    let mut rx = state.bus.subscribe();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        refresh_badge(&state).await;
        // Window expiry changes the count without any session event.
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        loop {
            let ev = tokio::select! {
                _ = tick.tick() => {
                    refresh_badge(&state).await;
                    continue;
                }
                ev = rx.recv() => ev,
            };
            match ev {
                Ok(AppEvent::SessionsChanged { .. }) => refresh_badge(&state).await,
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

/// Inbox badge: non-archived sessions whose attention is awaiting/error/unread;
/// non-awaiting ones count only if `updated_at` is within `window_hours` of `now`.
pub fn inbox_badge_count(
    metas: &[SessionMeta],
    now: chrono::DateTime<chrono::Utc>,
    window_hours: u32,
) -> u32 {
    let cutoff = now - chrono::Duration::hours(window_hours.clamp(1, 720) as i64);
    let in_window = |m: &SessionMeta| {
        chrono::DateTime::parse_from_rfc3339(&m.updated_at).is_ok_and(|t| t >= cutoff)
    };
    metas
        .iter()
        .filter(|m| !m.archived)
        .filter(|m| match m.attention {
            Some(Attention::Awaiting) => true,
            Some(Attention::Error | Attention::Unread) => in_window(m),
            Some(Attention::Running) | None => false,
        })
        .count() as u32
}

/// True when `hm` ("HH:MM") falls inside the [from, to) quiet window.
/// Wraps past midnight (e.g. 23:00–07:30); a zero-length window disables nothing.
pub fn in_quiet_hours(hm: &str, from: &str, to: &str) -> bool {
    let parse = |s: &str| -> Option<i64> {
        let (h, m) = s.split_once(':')?;
        let (h, m) = (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?);
        (0..=23).contains(&h).then_some(())?;
        (0..=59).contains(&m).then_some(())?;
        Some(h * 60 + m)
    };
    let (Some(now), Some(from), Some(to)) = (parse(hm), parse(from), parse(to)) else {
        return false;
    };
    if from == to {
        return false;
    }
    if from < to {
        now >= from && now < to
    } else {
        now >= from || now < to
    }
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
    // Quiet hours: suppress native notifications, keep the dock badge current.
    if let (Some(from), Some(to)) = (&settings.notify_quiet_from, &settings.notify_quiet_to) {
        let now = chrono::Local::now().format("%H:%M").to_string();
        if in_quiet_hours(&now, from.trim(), to.trim()) {
            return;
        }
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

/// Recompute and set the macOS Dock badge (cleared when disabled).
pub async fn refresh_badge(state: &AppState) {
    let (enabled, window) = {
        let s = state.settings.read();
        (s.dock_badge_enabled, s.inbox_window_hours)
    };
    let count = if enabled {
        let metas = crate::catalog::list(state).await;
        inbox_badge_count(&metas, chrono::Utc::now(), window)
    } else {
        0
    };
    if let Some(w) = state.app.get_webview_window("main") {
        let _ = w.set_badge_count((count > 0).then_some(count as i64));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_count_window_and_kinds() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-01-02T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let mk = |a: Option<Attention>, updated: &str, archived: bool| SessionMeta {
            attention: a,
            updated_at: updated.into(),
            archived,
            ..Default::default()
        };
        let recent = "2026-01-01T12:00:00Z";
        let edge = "2026-01-01T00:00:00Z"; // exactly 24 h old: still in window
        let old = "2025-12-31T23:59:59Z";
        let metas = vec![
            mk(Some(Attention::Awaiting), old, false), // never expires
            mk(Some(Attention::Error), recent, false),
            mk(Some(Attention::Unread), edge, false),
            mk(Some(Attention::Unread), old, false), // expired
            mk(Some(Attention::Running), recent, false), // not counted
            mk(None, recent, false),
            mk(Some(Attention::Awaiting), recent, true), // archived
        ];
        assert_eq!(inbox_badge_count(&metas, now, 24), 3);
        assert_eq!(inbox_badge_count(&metas, now, 48), 4);
    }

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

    #[test]
    fn quiet_hours_window() {
        // Normal window inside one day.
        assert!(in_quiet_hours("23:10", "23:00", "07:30"));
        assert!(in_quiet_hours("00:00", "23:00", "07:30"));
        assert!(in_quiet_hours("07:29", "23:00", "07:30"));
        assert!(!in_quiet_hours("12:00", "23:00", "07:30"));
        assert!(!in_quiet_hours("07:30", "23:00", "07:30")); // end is exclusive

        // Same-day window.
        assert!(in_quiet_hours("12:30", "12:00", "13:00"));
        assert!(!in_quiet_hours("13:00", "12:00", "13:00"));

        // Zero-length window disables nothing.
        assert!(!in_quiet_hours("12:00", "07:00", "07:00"));

        // Unparseable inputs never suppress.
        assert!(!in_quiet_hours("12:00", "", ""));
        assert!(!in_quiet_hours("12:00", "24:00", "07:00"));
        assert!(!in_quiet_hours("bad", "23:00", "07:30"));
    }
}
