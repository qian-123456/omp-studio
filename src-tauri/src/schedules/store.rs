//! Schedules and schedule runs store (rusqlite).
//! Pure next_run calculation (DST-safe with chrono Local).

use chrono::{DateTime, Datelike, Duration, Local, LocalResult, TimeZone};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashSet;

use crate::contracts::{
    Schedule, ScheduleCadence, ScheduleDraft, ScheduleRun, ScheduleRunMode, ScheduleRunStatus,
};

pub fn parse_time(s: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let h: u32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some((h, m))
}

/// Pure calculation of the earliest next run time strictly after `after`.
/// Respects local timezone and DST transitions.
pub fn next_run(cadence: &ScheduleCadence, after: DateTime<Local>) -> DateTime<Local> {
    match cadence {
        ScheduleCadence::Interval { minutes } => {
            let mins = (*minutes).max(5) as i64;
            after + Duration::minutes(mins)
        }
        ScheduleCadence::Daily { time, weekdays } => {
            let (h, m) = parse_time(time).unwrap_or((9, 0));
            let allowed_weekdays: Option<HashSet<u32>> = if weekdays.is_empty() {
                None
            } else {
                Some(weekdays.iter().map(|&w| w % 7).collect())
            };

            let start_date = after.date_naive();
            for day_offset in 0..14 {
                let candidate_date = start_date + Duration::days(day_offset);
                let weekday_num = candidate_date.weekday().num_days_from_sunday();
                if let Some(set) = &allowed_weekdays {
                    if !set.contains(&weekday_num) {
                        continue;
                    }
                }

                let Some(naive_dt) = candidate_date.and_hms_opt(h, m, 0) else {
                    continue;
                };

                let local_dt = match Local.from_local_datetime(&naive_dt) {
                    LocalResult::Single(dt) => Some(dt),
                    LocalResult::Ambiguous(dt1, _dt2) => Some(dt1),
                    LocalResult::None => naive_dt
                        .checked_add_signed(Duration::hours(1))
                        .and_then(|alt| Local.from_local_datetime(&alt).single()),
                };

                if let Some(dt) = local_dt {
                    if dt > after {
                        return dt;
                    }
                }
            }
            after + Duration::hours(24)
        }
    }
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn row_to_schedule(r: &Row) -> rusqlite::Result<Schedule> {
    let run_mode_str: String = r.get(4)?;
    let cadence_str: String = r.get(5)?;
    let enabled_int: i32 = r.get(9)?;

    let run_mode = match run_mode_str.as_str() {
        "worktree" => ScheduleRunMode::Worktree,
        _ => ScheduleRunMode::Local,
    };
    let cadence: ScheduleCadence =
        serde_json::from_str(&cadence_str).unwrap_or(ScheduleCadence::Interval { minutes: 60 });

    Ok(Schedule {
        id: r.get(0)?,
        name: r.get(1)?,
        prompt: r.get(2)?,
        cwd: r.get(3)?,
        run_mode,
        cadence,
        model: r.get(6)?,
        thinking: r.get(7)?,
        approval_mode: r.get(8)?,
        enabled: enabled_int != 0,
        next_run_at: r.get(10)?,
        last_run_at: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
    })
}

fn row_to_run(r: &Row) -> rusqlite::Result<ScheduleRun> {
    let status_str: String = r.get(3)?;
    let status = match status_str.as_str() {
        "running" => ScheduleRunStatus::Running,
        "ok" => ScheduleRunStatus::Ok,
        "error" => ScheduleRunStatus::Error,
        "skipped" => ScheduleRunStatus::Skipped,
        _ => ScheduleRunStatus::Error,
    };

    Ok(ScheduleRun {
        id: r.get(0)?,
        schedule_id: r.get(1)?,
        session_id: r.get(2)?,
        status,
        started_at: r.get(4)?,
        finished_at: r.get(5)?,
        summary: r.get(6)?,
    })
}

const SCHEDULE_COLS: &str = "id, name, prompt, cwd, run_mode, cadence, model, thinking, approval_mode, enabled, next_run_at, last_run_at, created_at, updated_at";
const RUN_COLS: &str = "id, schedule_id, session_id, status, started_at, finished_at, summary";

pub fn list(conn: &Connection) -> Result<Vec<Schedule>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SCHEDULE_COLS} FROM schedules ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map([], row_to_schedule)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Schedule>, rusqlite::Error> {
    conn.query_row(
        &format!("SELECT {SCHEDULE_COLS} FROM schedules WHERE id = ?1"),
        params![id],
        row_to_schedule,
    )
    .optional()
}

pub fn upsert(conn: &Connection, draft: &ScheduleDraft) -> Result<Schedule, rusqlite::Error> {
    let ts = now_rfc3339();
    let run_mode_str = match draft.run_mode {
        ScheduleRunMode::Worktree => "worktree",
        ScheduleRunMode::Local => "local",
    };
    let cadence_json = serde_json::to_string(&draft.cadence).unwrap_or_default();

    if let Some(id) = &draft.id {
        let existing = get(conn, id)?;
        if let Some(prev) = existing {
            let next_run_at = if draft.enabled {
                if !prev.enabled || prev.cadence != draft.cadence || prev.next_run_at.is_none() {
                    Some(next_run(&draft.cadence, Local::now()).to_rfc3339())
                } else {
                    prev.next_run_at
                }
            } else {
                None
            };

            conn.execute(
                "UPDATE schedules
                 SET name = ?2, prompt = ?3, cwd = ?4, run_mode = ?5, cadence = ?6,
                     model = ?7, thinking = ?8, approval_mode = ?9, enabled = ?10,
                     next_run_at = ?11, updated_at = ?12
                 WHERE id = ?1",
                params![
                    id,
                    draft.name,
                    draft.prompt,
                    draft.cwd,
                    run_mode_str,
                    cadence_json,
                    draft.model,
                    draft.thinking,
                    draft.approval_mode,
                    draft.enabled as i32,
                    next_run_at,
                    ts,
                ],
            )?;

            return get(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows);
        }
    }

    let id = draft
        .id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let next_run_at = if draft.enabled {
        Some(next_run(&draft.cadence, Local::now()).to_rfc3339())
    } else {
        None
    };

    conn.execute(
        "INSERT INTO schedules(id, name, prompt, cwd, run_mode, cadence, model, thinking, approval_mode, enabled, next_run_at, last_run_at, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?12)",
        params![
            id,
            draft.name,
            draft.prompt,
            draft.cwd,
            run_mode_str,
            cadence_json,
            draft.model,
            draft.thinking,
            draft.approval_mode,
            draft.enabled as i32,
            next_run_at,
            ts,
        ],
    )?;

    get(conn, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM schedules WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_enabled(
    conn: &Connection,
    id: &str,
    enabled: bool,
) -> Result<Schedule, rusqlite::Error> {
    let prev = get(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    let next_run_at = if enabled {
        Some(next_run(&prev.cadence, Local::now()).to_rfc3339())
    } else {
        None
    };
    let ts = now_rfc3339();

    conn.execute(
        "UPDATE schedules SET enabled = ?2, next_run_at = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, enabled as i32, next_run_at, ts],
    )?;

    get(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn update_last_and_next(
    conn: &Connection,
    id: &str,
    last_run_at: &str,
    next_run_at: Option<&str>,
) -> Result<(), rusqlite::Error> {
    let ts = now_rfc3339();
    conn.execute(
        "UPDATE schedules SET last_run_at = ?2, next_run_at = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, last_run_at, next_run_at, ts],
    )?;
    Ok(())
}

pub fn find_due(conn: &Connection, before: &str) -> Result<Vec<Schedule>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SCHEDULE_COLS} FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1"
    ))?;
    let rows = stmt.query_map(params![before], row_to_schedule)?;
    rows.collect()
}

pub fn earliest_next_run(conn: &Connection) -> Result<Option<DateTime<Local>>, rusqlite::Error> {
    let val: Option<String> = conn
        .query_row(
            "SELECT MIN(next_run_at) FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .optional()?
        .flatten();

    let Some(s) = val else {
        return Ok(None);
    };

    match DateTime::parse_from_rfc3339(&s) {
        Ok(dt) => Ok(Some(dt.with_timezone(&Local))),
        Err(_) => Ok(None),
    }
}

pub fn create_run(
    conn: &Connection,
    id: &str,
    schedule_id: &str,
    session_id: Option<&str>,
    status: ScheduleRunStatus,
    summary: Option<&str>,
) -> Result<ScheduleRun, rusqlite::Error> {
    let ts = now_rfc3339();
    let status_str = match status {
        ScheduleRunStatus::Running => "running",
        ScheduleRunStatus::Ok => "ok",
        ScheduleRunStatus::Error => "error",
        ScheduleRunStatus::Skipped => "skipped",
    };

    conn.execute(
        "INSERT INTO schedule_runs(id, schedule_id, session_id, status, started_at, finished_at, summary)
         VALUES(?1, ?2, ?3, ?4, ?5, NULL, ?6)",
        params![id, schedule_id, session_id, status_str, ts, summary],
    )?;

    Ok(ScheduleRun {
        id: id.to_string(),
        schedule_id: schedule_id.to_string(),
        session_id: session_id.map(str::to_string),
        status,
        started_at: ts,
        finished_at: None,
        summary: summary.map(str::to_string),
    })
}

pub fn update_run(
    conn: &Connection,
    run_id: &str,
    session_id: Option<&str>,
    status: ScheduleRunStatus,
    finished_at: Option<&str>,
    summary: Option<&str>,
) -> Result<(), rusqlite::Error> {
    let status_str = match status {
        ScheduleRunStatus::Running => "running",
        ScheduleRunStatus::Ok => "ok",
        ScheduleRunStatus::Error => "error",
        ScheduleRunStatus::Skipped => "skipped",
    };

    conn.execute(
        "UPDATE schedule_runs
         SET session_id = COALESCE(?2, session_id), status = ?3, finished_at = ?4, summary = ?5
         WHERE id = ?1",
        params![run_id, session_id, status_str, finished_at, summary],
    )?;
    Ok(())
}

pub fn list_runs(
    conn: &Connection,
    schedule_id: &str,
    limit: u32,
) -> Result<Vec<ScheduleRun>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {RUN_COLS} FROM schedule_runs WHERE schedule_id = ?1 ORDER BY started_at DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map(params![schedule_id, limit], row_to_run)?;
    rows.collect()
}

pub fn has_active_run(conn: &Connection, schedule_id: &str) -> Result<bool, rusqlite::Error> {
    let count: i64 = conn.query_row(
        "SELECT count(*) FROM schedule_runs WHERE schedule_id = ?1 AND status = 'running'",
        params![schedule_id],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}
