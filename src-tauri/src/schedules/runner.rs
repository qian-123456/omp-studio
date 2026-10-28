//! Scheduled task execution runner.

use std::path::Path;
use std::time::Duration;
use tauri::Emitter;

use crate::contracts::{
    Schedule, ScheduleNotify, ScheduleRun, ScheduleRunMode, ScheduleRunStatus, SessionStatus,
    StartOpts, TodoKind, TodoSource,
};
use crate::schedules::store;
use crate::state::{AppEvent, AppState};
use crate::todos::store::NewTodo;

/// Upper bound for one scheduled run's wait for the turn to finish.
const RUN_TIMEOUT: Duration = Duration::from_secs(3600);

/// Whether a finished run should produce an inbox todo under the schedule's
/// notify policy. `needed_attention` = the run entered AwaitingApproval or
/// AwaitingAnswer at any point (callers pass `false` when the run never
/// reached a session); a failed run always counts as important.
pub(crate) fn should_create_inbox_todo(
    notify: ScheduleNotify,
    ok: bool,
    needed_attention: bool,
) -> bool {
    match notify {
        ScheduleNotify::All => true,
        ScheduleNotify::Important => !ok || needed_attention,
        ScheduleNotify::None => false,
    }
}

/// Claim before spawning so stale scheduler snapshots cannot outlive deletion.
pub fn spawn_run(state: AppState, schedule: Schedule) {
    let run_id = uuid::Uuid::new_v4().to_string();
    let claimed = {
        let db = state.db.lock();
        match schedule.next_run_at.as_deref() {
            Some(next) => store::claim_run(&db, &schedule.id, &run_id, Some(next)),
            None => return,
        }
    };
    let _ = state.app.emit("schedules:changed", ());
    match claimed {
        Ok((schedule, _)) => {
            tauri::async_runtime::spawn(async move {
                execute_run_with_existing_run(state, schedule, run_id).await;
            });
        }
        Err(e) => tracing::debug!("Schedule {} not dispatched: {e}", schedule.id),
    }
}

/// Manual and automatic runs share existence, cap and active-run guards.
pub async fn run_now(state: AppState, id: String) -> Result<ScheduleRun, String> {
    let run_id = uuid::Uuid::new_v4().to_string();
    let (schedule, run) = {
        let db = state.db.lock();
        store::claim_run(&db, &id, &run_id, None)?
    };
    let _ = state.app.emit("schedules:changed", ());
    tauri::async_runtime::spawn(async move {
        execute_run_with_existing_run(state, schedule, run_id).await;
    });
    Ok(run)
}

async fn execute_run_with_existing_run(state: AppState, schedule: Schedule, run_id: String) {
    let base_path = Path::new(&schedule.cwd);
    if !base_path.exists() || !base_path.is_dir() {
        finish_with_error(
            &state,
            &schedule,
            &run_id,
            None,
            &format!("工作目录不存在：{}", schedule.cwd),
        );
        return;
    }

    let effective_cwd = match schedule.run_mode {
        ScheduleRunMode::Worktree => {
            // Non-ASCII names (e.g. Chinese) slug to "", so always prefix.
            let slug = crate::git::worktree::slugify(&schedule.name);
            let run_id_short = &run_id[..run_id.len().min(8)];
            let wt_name = if slug.is_empty() {
                format!("sched-{run_id_short}")
            } else {
                format!("sched-{slug}-{run_id_short}")
            };
            match crate::git::worktree::create(base_path, &wt_name, None, None) {
                Ok(info) => info.path,
                Err(e) => {
                    finish_with_error(
                        &state,
                        &schedule,
                        &run_id,
                        None,
                        &format!("创建独立 worktree 失败：{e}"),
                    );
                    return;
                }
            }
        }
        ScheduleRunMode::Local => schedule.cwd.clone(),
    };

    let label = format!("⏰ {}", schedule.name);

    // `new_chat_each_run == false` continues the previous run's session —
    // local mode only; worktree runs always start fresh.
    let resume_file =
        if !schedule.new_chat_each_run && matches!(schedule.run_mode, ScheduleRunMode::Local) {
            let db = state.db.lock();
            store::last_run_session_file(&db, &schedule.id).unwrap_or(None)
        } else {
            None
        };
    let resume_file = resume_file.filter(|f| {
        let exists = Path::new(f).is_file();
        if !exists {
            tracing::warn!(
                "schedule {}: resume file {f} missing; starting a fresh session",
                schedule.id
            );
        }
        exists
    });

    let mut opts = StartOpts {
        cwd: effective_cwd,
        model: schedule.model.clone(),
        approval_mode: schedule.approval_mode.clone(),
        label: Some(label),
        resume_file,
        ..Default::default()
    };

    let mut bus_rx = state.bus.subscribe();

    let info = match crate::rpc::start(&state, &opts).await {
        Ok(info) => info,
        Err(e) if opts.resume_file.is_some() => {
            // Resume refused (e.g. SESSION_HELD: another process owns the file)
            // or the file is unreadable — fall back to a fresh session.
            tracing::warn!(
                "schedule {}: resume failed ({e}); starting a fresh session",
                schedule.id
            );
            opts.resume_file = None;
            match crate::rpc::start(&state, &opts).await {
                Ok(info) => info,
                Err(e) => {
                    finish_with_error(
                        &state,
                        &schedule,
                        &run_id,
                        None,
                        &format!("启动会话失败：{e}"),
                    );
                    return;
                }
            }
        }
        Err(e) => {
            finish_with_error(
                &state,
                &schedule,
                &run_id,
                None,
                &format!("启动会话失败：{e}"),
            );
            return;
        }
    };

    let session_id = info.session_id.clone();
    {
        let db = state.db.lock();
        let _ = store::update_run(
            &db,
            &run_id,
            Some(&session_id),
            ScheduleRunStatus::Running,
            None,
            None,
        );
    }
    // Apply the schedule's thinking level (same RPC the interactive composer sends).
    if let Some(level) = schedule
        .thinking
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Some(handle) = crate::rpc::get_handle(&session_id) {
            let cmd = serde_json::json!({ "type": "set_thinking_level", "level": level });
            if let Err(e) = crate::rpc::send_command(&handle, cmd).await {
                tracing::warn!("schedule run {run_id}: set_thinking_level failed: {e}");
            }
        }
    }
    let _ = state.app.emit("schedules:changed", ());

    if let Err(e) = crate::rpc::send_prompt(&state, &session_id, &schedule.prompt).await {
        stop_session_process(&session_id).await;
        finish_with_error(
            &state,
            &schedule,
            &run_id,
            Some(&session_id),
            &format!("发送提示词失败：{e}"),
        );
        return;
    }

    let mut ok = false;
    // Status events emitted while the session was starting (e.g. → Idle) are
    // already queued on `bus_rx`; only Idle/Review observed after the turn
    // actually started working count as completion.
    let mut started = false;
    // Tracks whether the run ever stopped for approval/an answer — makes a
    // finished run "important" under `ScheduleNotify::Important`.
    let mut needed_attention = false;
    let target_sid = session_id.clone();
    // One absolute deadline for the whole wait. Re-creating the sleep inside the
    // loop would restart it on every unrelated bus event, so a busy app could
    // keep a stuck run alive past the documented one-hour cap.
    let deadline = tokio::time::Instant::now() + RUN_TIMEOUT;
    loop {
        tokio::select! {
            ev = bus_rx.recv() => {
                match ev {
                    Ok(AppEvent::SessionStatusChanged { session_id: sid, new, .. }) if sid == target_sid => {
                        match new {
                            SessionStatus::Review => {
                                ok = true;
                                break;
                            }
                            SessionStatus::Idle if started => {
                                ok = true;
                                break;
                            }
                            SessionStatus::Error | SessionStatus::Interrupted => {
                                ok = false;
                                break;
                            }
                            SessionStatus::AwaitingApproval | SessionStatus::AwaitingAnswer => {
                                needed_attention = true;
                                started = true;
                            }
                            SessionStatus::Working => started = true,
                            _ => {}
                        }
                    }
                    Ok(AppEvent::RpcProcess { session_id: sid, running, exit_code }) if sid == target_sid => {
                        if !running {
                            // Only a clean `exit 0` counts as success; a signal
                            // kill reports `None` and must not read as success.
                            ok = exit_code == Some(0);
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        break;
                    }
                    _ => {}
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                ok = false;
                break;
            }
        }
    }

    tokio::time::sleep(Duration::from_millis(150)).await;
    // The run is over (ok, error or timeout): don't leave its omp process behind.
    stop_session_process(&session_id).await;

    let file_path: Option<String> = {
        let db = state.db.lock();
        db.query_row(
            "SELECT file_path FROM session_meta WHERE session_id = ?1",
            rusqlite::params![&session_id],
            |r| r.get(0),
        )
        .ok()
    };

    let last_text = file_path.and_then(|p| crate::mobile::last::last_assistant_text(Path::new(&p)));

    let detail = if let Some(t) = last_text {
        if t.chars().count() > 500 {
            format!("{}…", t.chars().take(500).collect::<String>())
        } else {
            t
        }
    } else if ok {
        "定时任务执行完成".to_string()
    } else {
        "定时任务执行失败".to_string()
    };

    let now = store::now_rfc3339();
    let status = if ok {
        ScheduleRunStatus::Ok
    } else {
        ScheduleRunStatus::Error
    };

    {
        let db = state.db.lock();
        let _ = store::update_run(
            &db,
            &run_id,
            Some(&session_id),
            status,
            Some(&now),
            Some(&detail),
        );

        let create_todo = should_create_inbox_todo(schedule.notify, ok, needed_attention);
        if create_todo {
            let title = if ok {
                format!("定时任务「{}」已完成", schedule.name)
            } else {
                format!("定时任务「{}」运行失败", schedule.name)
            };

            let new_todo = NewTodo {
                kind: TodoKind::ScheduleRun,
                source: TodoSource::Schedule,
                session_id: Some(session_id),
                title,
                detail,
                payload: serde_json::json!({
                    "scheduleId": schedule.id,
                    "runId": run_id,
                    "ok": ok,
                }),
            };

            let _ = crate::todos::store::upsert(&db, &format!("sched:{run_id}"), &new_todo, true);
        }
    }

    if should_create_inbox_todo(schedule.notify, ok, needed_attention) {
        crate::todos::notify_changed(&state);
    }
    let _ = state.app.emit("schedules:changed", ());
}

async fn stop_session_process(session_id: &str) {
    if let Some(handle) = crate::rpc::get_handle(session_id) {
        if let Err(e) = crate::rpc::stop(&handle).await {
            tracing::warn!("schedule: stop {session_id} failed: {e}");
        }
    }
}

fn finish_with_error(
    state: &AppState,
    schedule: &Schedule,
    run_id: &str,
    session_id: Option<&str>,
    err_msg: &str,
) {
    let now = store::now_rfc3339();
    {
        let db = state.db.lock();
        let _ = store::update_run(
            &db,
            run_id,
            session_id,
            ScheduleRunStatus::Error,
            Some(&now),
            Some(err_msg),
        );

        // Errors count as important under every policy except `none`.
        if should_create_inbox_todo(schedule.notify, false, false) {
            let new_todo = NewTodo {
                kind: TodoKind::ScheduleRun,
                source: TodoSource::Schedule,
                session_id: session_id.map(str::to_string),
                title: format!("定时任务「{}」运行失败", schedule.name),
                detail: err_msg.to_string(),
                payload: serde_json::json!({
                    "scheduleId": schedule.id,
                    "runId": run_id,
                    "ok": false,
                }),
            };

            let _ = crate::todos::store::upsert(&db, &format!("sched:{run_id}"), &new_todo, true);
        }
    }

    if should_create_inbox_todo(schedule.notify, false, false) {
        crate::todos::notify_changed(state);
    }
    let _ = state.app.emit("schedules:changed", ());
}
