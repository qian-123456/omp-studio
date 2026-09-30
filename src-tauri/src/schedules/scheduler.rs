//! Background scheduler: sleeps until the earliest next_run_at, wakes on schedule updates.

use chrono::Local;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::Emitter;

use crate::schedules::{runner, store};
use crate::state::AppState;

static SCHEDULER_NOTIFY: OnceLock<Arc<tokio::sync::Notify>> = OnceLock::new();

pub fn get_notify() -> Arc<tokio::sync::Notify> {
    SCHEDULER_NOTIFY
        .get_or_init(|| Arc::new(tokio::sync::Notify::new()))
        .clone()
}
pub fn notify_scheduler() {
    get_notify().notify_waiters();
}

/// Start the scheduler background loop.
pub fn start(state: AppState) {
    let notify = get_notify();

    tauri::async_runtime::spawn(async move {
        // 1. Startup catch-up: any enabled schedule that missed its run while the app was closed.
        let now = Local::now();
        let missed_schedules = {
            let db = state.db.lock();
            store::find_due(&db, &now.to_rfc3339()).unwrap_or_default()
        };

        if !missed_schedules.is_empty() {
            tracing::info!(
                "Running {} missed scheduled tasks on startup",
                missed_schedules.len()
            );
            for s in missed_schedules {
                let next = store::next_run(&s.cadence, now);
                {
                    let db = state.db.lock();
                    let _ = store::update_last_and_next(
                        &db,
                        &s.id,
                        &now.to_rfc3339(),
                        Some(&next.to_rfc3339()),
                    );
                }
                runner::spawn_run(state.clone(), s);
            }
            let _ = state.app.emit("schedules:changed", ());
        }

        // 2. Main sleep-and-wake loop.
        loop {
            let earliest = {
                let db = state.db.lock();
                store::earliest_next_run(&db).unwrap_or(None)
            };

            match earliest {
                Some(target_time) => {
                    let now = Local::now();
                    if target_time <= now {
                        let due_schedules = {
                            let db = state.db.lock();
                            store::find_due(&db, &now.to_rfc3339()).unwrap_or_default()
                        };

                        for s in due_schedules {
                            let next = store::next_run(&s.cadence, now);
                            {
                                let db = state.db.lock();
                                let _ = store::update_last_and_next(
                                    &db,
                                    &s.id,
                                    &now.to_rfc3339(),
                                    Some(&next.to_rfc3339()),
                                );
                            }
                            runner::spawn_run(state.clone(), s);
                        }

                        let _ = state.app.emit("schedules:changed", ());
                        continue;
                    }

                    let diff_ms = (target_time - now).num_milliseconds();
                    let sleep_duration = if diff_ms <= 0 {
                        Duration::from_millis(200)
                    } else {
                        Duration::from_millis(diff_ms as u64).min(Duration::from_secs(3600))
                    };

                    tokio::select! {
                        _ = tokio::time::sleep(sleep_duration) => {}
                        _ = notify.notified() => {}
                    }
                }
                None => {
                    notify.notified().await;
                }
            }
        }
    });
}
