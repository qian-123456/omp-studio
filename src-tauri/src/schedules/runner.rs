//! Scheduled task execution runner.

use std::path::Path;
use std::time::Duration;
use tauri::Emitter;

use crate::contracts::{
    Schedule, ScheduleRun, ScheduleRunMode, ScheduleRunStatus, SessionStatus, StartOpts, TodoKind,
    TodoSource,
};
use crate::schedules::store;
use crate::state::{AppEvent, AppState};
use crate::todos::store::NewTodo;

/// Execute a schedule run asynchronously in the background.
pub fn spawn_run(state: AppState, schedule: Schedule) {
    let run_id = uuid::Uuid::new_v4().to_string();
    tauri::async_runtime::spawn(async move {
        execute_run(state, schedule, run_id).await;
    });
}

/// Run a schedule immediately (user clicked "立即运行").
pub async fn run_now(state: AppState, id: String) -> Result<ScheduleRun, String> {
    let schedule = {
        let db = state.db.lock();
        store::get(&db, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "定时任务不存在".to_string())?
    };

    let is_running = {
        let db = state.db.lock();
        store::has_active_run(&db, &schedule.id).map_err(|e| e.to_string())?
    };

    if is_running {
        return Err("该任务上一次运行仍在进行中".to_string());
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let run = {
        let db = state.db.lock();
        store::create_run(
            &db,
            &run_id,
            &schedule.id,
            None,
            ScheduleRunStatus::Running,
            None,
        )
        .map_err(|e| e.to_string())?
    };

    let _ = state.app.emit("schedules:changed", ());

    let run_clone = run.clone();
    tauri::async_runtime::spawn(async move {
        execute_run_with_existing_run(state, schedule, run_id).await;
    });

    Ok(run_clone)
}

async fn execute_run(state: AppState, schedule: Schedule, run_id: String) {
    let is_running = {
        let db = state.db.lock();
        store::has_active_run(&db, &schedule.id).unwrap_or(false)
    };

    if is_running {
        let now = store::now_rfc3339();
        {
            let db = state.db.lock();
            let _ = store::create_run(
                &db,
                &run_id,
                &schedule.id,
                None,
                ScheduleRunStatus::Skipped,
                Some("上一次运行仍在进行中，已跳过"),
            );
            let _ = store::update_last_and_next(
                &db,
                &schedule.id,
                &now,
                schedule.next_run_at.as_deref(),
            );
        }
        let _ = state.app.emit("schedules:changed", ());
        return;
    }

    {
        let db = state.db.lock();
        let _ = store::create_run(
            &db,
            &run_id,
            &schedule.id,
            None,
            ScheduleRunStatus::Running,
            None,
        );
        let now = store::now_rfc3339();
        let _ =
            store::update_last_and_next(&db, &schedule.id, &now, schedule.next_run_at.as_deref());
    }
    let _ = state.app.emit("schedules:changed", ());

    execute_run_with_existing_run(state, schedule, run_id).await;
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
    let opts = StartOpts {
        cwd: effective_cwd,
        model: schedule.model.clone(),
        approval_mode: schedule.approval_mode.clone(),
        label: Some(label),
        ..Default::default()
    };

    let mut bus_rx = state.bus.subscribe();

    let info = match crate::rpc::start(&state, &opts).await {
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
    let _ = state.app.emit("schedules:changed", ());

    if let Err(e) = crate::rpc::send_prompt(&state, &session_id, &schedule.prompt).await {
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
    let target_sid = session_id.clone();
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
                            SessionStatus::Working
                            | SessionStatus::AwaitingApproval
                            | SessionStatus::AwaitingAnswer => started = true,
                            _ => {}
                        }
                    }
                    Ok(AppEvent::RpcProcess { session_id: sid, running, exit_code }) if sid == target_sid => {
                        if !running {
                            let is_err = exit_code.map(|c| c != 0).unwrap_or(false);
                            ok = !is_err;
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
            _ = tokio::time::sleep(Duration::from_secs(3600)) => {
                ok = false;
                break;
            }
        }
    }

    tokio::time::sleep(Duration::from_millis(150)).await;

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

    crate::todos::notify_changed(&state);
    let _ = state.app.emit("schedules:changed", ());
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

    crate::todos::notify_changed(state);
    let _ = state.app.emit("schedules:changed", ());
}
