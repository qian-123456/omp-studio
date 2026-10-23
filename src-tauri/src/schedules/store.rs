//! Schedules and schedule runs store (rusqlite).
//! Pure next_run calculation (DST-safe with chrono Local).

use chrono::{DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, TimeZone, Weekday};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashSet;

use crate::contracts::{
    Schedule, ScheduleCadence, ScheduleDraft, ScheduleLifecycle, ScheduleNotify, ScheduleRun,
    ScheduleRunMode, ScheduleRunStatus,
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

/// Map a `LocalResult` to a concrete instant: ambiguous (DST fall-back) picks
/// the earlier occurrence; a gap (DST spring-forward) retries at +1h.
pub(crate) fn from_local_result(
    res: LocalResult<DateTime<Local>>,
    naive: chrono::NaiveDateTime,
) -> Option<DateTime<Local>> {
    match res {
        LocalResult::Single(dt) => Some(dt),
        LocalResult::Ambiguous(dt1, _) => Some(dt1),
        LocalResult::None => {
            naive
                .checked_add_signed(Duration::hours(1))
                .and_then(|alt| match Local.from_local_datetime(&alt) {
                    LocalResult::Single(dt) => Some(dt),
                    LocalResult::Ambiguous(dt1, _) => Some(dt1),
                    LocalResult::None => None,
                })
        }
    }
}

fn resolve_local(naive: chrono::NaiveDateTime) -> Option<DateTime<Local>> {
    let res = Local.from_local_datetime(&naive);
    from_local_result(res, naive)
}

/// Days in a proleptic-Gregorian month (leap-aware).
fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        _ => 28,
    }
}

/// Pure calculation of the earliest next run time strictly after `after`.
/// Respects local timezone and DST transitions. `None` = this cadence can
/// never fire again (a `once` whose instant already passed).
pub fn next_run(cadence: &ScheduleCadence, after: DateTime<Local>) -> Option<DateTime<Local>> {
    match cadence {
        ScheduleCadence::Interval { minutes } => {
            let mins = (*minutes).max(5) as i64;
            Some(after + Duration::minutes(mins))
        }
        ScheduleCadence::Once { at } => DateTime::parse_from_rfc3339(at)
            .ok()
            .map(|dt| dt.with_timezone(&Local))
            .filter(|dt| *dt > after),
        ScheduleCadence::Daily {
            time,
            weekdays,
            every,
            anchor,
        } => {
            let (h, m) = parse_time(time).unwrap_or((9, 0));
            let allowed_weekdays: Option<HashSet<u32>> = if weekdays.is_empty() {
                None
            } else {
                Some(weekdays.iter().map(|&w| w % 7).collect())
            };
            // `every` > 1 repeats on the phase fixed by `anchor` (a local date;
            // defaults to `after`'s date): without weekdays, occurrences are
            // `anchor + k*every` days; with weekdays, whole weeks — weeks start
            // on Monday — are picked every `every` weeks counting from the
            // anchor's week, and the listed weekdays inside them fire. `every`
            // <= 1 keeps the legacy behavior regardless of `anchor`.
            let every = (*every).max(1) as i64;
            let anchor_date = anchor
                .as_deref()
                .and_then(|a| NaiveDate::parse_from_str(a, "%Y-%m-%d").ok())
                .unwrap_or_else(|| after.date_naive());
            let anchor_week = anchor_date.week(Weekday::Mon).first_day();
            // Wide enough to always contain the next occurrence even when the
            // matching instant on the first in-phase day/week already passed.
            let horizon = if allowed_weekdays.is_some() {
                7 * every + 7
            } else {
                (2 * every + 1).max(14)
            };

            let start_date = after.date_naive();
            for day_offset in 0..horizon {
                let candidate_date = start_date + Duration::days(day_offset);
                if let Some(set) = &allowed_weekdays {
                    if !set.contains(&candidate_date.weekday().num_days_from_sunday()) {
                        continue;
                    }
                    if every > 1 {
                        let week = candidate_date.week(Weekday::Mon).first_day();
                        let weeks_since_anchor = (week - anchor_week).num_days() / 7;
                        if weeks_since_anchor < 0 || weeks_since_anchor % every != 0 {
                            continue;
                        }
                    }
                } else if every > 1
                    && (candidate_date < anchor_date
                        || (candidate_date - anchor_date).num_days() % every != 0)
                {
                    continue;
                }

                let Some(naive_dt) = candidate_date.and_hms_opt(h, m, 0) else {
                    continue;
                };

                if let Some(dt) = resolve_local(naive_dt) {
                    if dt > after {
                        return Some(dt);
                    }
                }
            }
            Some(after + Duration::hours(24))
        }
        ScheduleCadence::Monthly {
            day,
            time,
            every,
            anchor,
        } => {
            let (h, m) = parse_time(time).unwrap_or((9, 0));
            let day = (*day).clamp(1, 31);
            let start = after.date_naive();
            // `every` > 1 repeats every `every` months counted from `anchor`'s
            // month (defaults to `after`'s month), keeping the day-clamp.
            let every = (*every).max(1) as i64;
            let anchor_date = anchor
                .as_deref()
                .and_then(|a| NaiveDate::parse_from_str(a, "%Y-%m-%d").ok())
                .unwrap_or(start);
            let anchor_idx = anchor_date.year() * 12 + (anchor_date.month() as i32 - 1);
            // Scan months: legacy scanned 13; `every` > 1 needs up to 2*every+1
            // (an in-phase month whose instant passed pushes to the next).
            let horizon = (2 * every + 1).max(13) as i32;
            let start_idx = start.year() * 12 + (start.month() as i32 - 1);
            for i in 0..horizon {
                let idx = start_idx + i;
                let months_since_anchor = (idx - anchor_idx) as i64;
                if every > 1 && (months_since_anchor < 0 || months_since_anchor % every != 0) {
                    continue;
                }
                let (y, mo) = (idx.div_euclid(12), idx.rem_euclid(12) as u32 + 1);
                let Some(candidate_date) =
                    NaiveDate::from_ymd_opt(y, mo, day.min(days_in_month(y, mo)))
                else {
                    continue;
                };
                if candidate_date < start {
                    continue;
                }
                let Some(naive_dt) = candidate_date.and_hms_opt(h, m, 0) else {
                    continue;
                };
                if let Some(dt) = resolve_local(naive_dt) {
                    if dt > after {
                        return Some(dt);
                    }
                }
            }
            Some(after + Duration::days(31))
        }
    }
}

/// Fire time for a schedule that becomes (or stays) enabled. Unlike `next_run`
/// a `once` whose instant already passed returns the instant itself so the
/// scheduler catches it up immediately; a recurring cadence bounded by
/// `end_at` (inclusive) yields `None` when the next occurrence lands past it.
pub fn next_run_bounded(
    cadence: &ScheduleCadence,
    end_at: Option<&str>,
    now: DateTime<Local>,
) -> Option<DateTime<Local>> {
    let end = end_at.and_then(|s| DateTime::parse_from_rfc3339(s).ok());
    let next = match cadence {
        ScheduleCadence::Once { at } => DateTime::parse_from_rfc3339(at)
            .ok()
            .map(|dt| dt.with_timezone(&Local)),
        _ => next_run(cadence, now),
    };
    match (next, end) {
        (Some(n), Some(e)) if n > e => None,
        (next, _) => next,
    }
}

/// Derive the display lifecycle (not stored): `completed` = a `once` schedule
/// that already ran (a run row exists or `last_run_at` is set), or a recurring
/// one past `end_at` (end reached or the next occurrence lands after it) or at
/// its `max_runs` cap; `paused` = disabled but not completed; otherwise `active`.
pub fn derive_lifecycle(s: &Schedule, has_run: bool, now: DateTime<Local>) -> ScheduleLifecycle {
    let completed = match &s.cadence {
        ScheduleCadence::Once { .. } => has_run || s.last_run_at.is_some(),
        _ => {
            let capped = s.max_runs.is_some_and(|max| s.runs_done >= max);
            capped
                || s.end_at
                    .as_deref()
                    .and_then(|e| DateTime::parse_from_rfc3339(e).ok())
                    .map(|end| next_run(&s.cadence, now).map(|n| n > end).unwrap_or(true))
                    .unwrap_or(false)
        }
    };
    if completed {
        ScheduleLifecycle::Completed
    } else if !s.enabled {
        ScheduleLifecycle::Paused
    } else {
        ScheduleLifecycle::Active
    }
}

/// Draft validation shared by create and edit; errors are Chinese UI strings.
fn validate_draft(draft: &ScheduleDraft, prev: Option<&Schedule>) -> Result<(), String> {
    let now = Local::now();
    match &draft.cadence {
        ScheduleCadence::Interval { minutes } => {
            if *minutes < 5 {
                return Err("间隔至少 5 分钟".to_string());
            }
        }
        ScheduleCadence::Daily {
            time,
            every,
            anchor,
            ..
        }
        | ScheduleCadence::Monthly {
            time,
            every,
            anchor,
            ..
        } => {
            if parse_time(time).is_none() {
                return Err("时间格式需为 HH:MM".to_string());
            }
            if !(1..=999).contains(every) {
                return Err("重复间隔需在 1-999 之间".to_string());
            }
            if let Some(anchor) = anchor.as_deref() {
                if NaiveDate::parse_from_str(anchor, "%Y-%m-%d").is_err() {
                    return Err("重复起始日期格式需为 YYYY-MM-DD".to_string());
                }
            }
            if let ScheduleCadence::Monthly { day, .. } = &draft.cadence {
                if !(1..=31).contains(day) {
                    return Err("每月日期需在 1-31 之间".to_string());
                }
            }
        }
        ScheduleCadence::Once { at } => {
            let target =
                DateTime::parse_from_rfc3339(at).map_err(|_| "时间格式需为 RFC3339".to_string())?;
            // An unchanged instant stays valid (e.g. editing a completed once);
            // only a new time must lie in the future.
            let unchanged = matches!(prev, Some(p) if matches!(&p.cadence,
                ScheduleCadence::Once { at: prev_at }
                    if DateTime::parse_from_rfc3339(prev_at).ok() == Some(target)));
            if !unchanged && target <= now {
                return Err("请选择未来的时间".to_string());
            }
        }
    }
    if let Some(end) = draft.end_at.as_deref() {
        let end_dt = DateTime::parse_from_rfc3339(end)
            .map_err(|_| "结束时间格式需为 RFC3339".to_string())?;
        if end_dt <= now {
            return Err("结束时间需晚于现在".to_string());
        }
    }
    if let Some(max_runs) = draft.max_runs {
        if max_runs == 0 {
            return Err("运行次数需至少为 1".to_string());
        }
    }
    Ok(())
}
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn row_to_schedule(r: &Row) -> rusqlite::Result<Schedule> {
    let run_mode_str: String = r.get(4)?;
    let cadence_str: String = r.get(5)?;
    let enabled_int: i32 = r.get(9)?;
    let notify_str: String = r.get(17)?;
    let new_chat_int: i32 = r.get(18)?;

    let run_mode = match run_mode_str.as_str() {
        "worktree" => ScheduleRunMode::Worktree,
        _ => ScheduleRunMode::Local,
    };
    let notify = match notify_str.as_str() {
        "important" => ScheduleNotify::Important,
        "none" => ScheduleNotify::None,
        _ => ScheduleNotify::All,
    };
    let cadence: ScheduleCadence =
        serde_json::from_str(&cadence_str).unwrap_or(ScheduleCadence::Interval { minutes: 60 });
    let has_run = r.get::<_, i64>(16)? > 0;

    let schedule = Schedule {
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
        last_run_status: r
            .get::<_, Option<String>>(15)?
            .as_deref()
            .map(parse_run_status),
        end_at: r.get(14)?,
        notify,
        new_chat_each_run: new_chat_int != 0,
        max_runs: r
            .get::<_, Option<i64>>(19)?
            .and_then(|v| u32::try_from(v).ok()),
        runs_done: r.get::<_, i64>(20)?.max(0) as u32,
        lifecycle: ScheduleLifecycle::Active,
    };
    let lifecycle = derive_lifecycle(&schedule, has_run, Local::now());
    Ok(Schedule {
        lifecycle,
        ..schedule
    })
}

fn parse_run_status(s: &str) -> ScheduleRunStatus {
    match s {
        "running" => ScheduleRunStatus::Running,
        "ok" => ScheduleRunStatus::Ok,
        "skipped" => ScheduleRunStatus::Skipped,
        _ => ScheduleRunStatus::Error,
    }
}

fn row_to_run(r: &Row) -> rusqlite::Result<ScheduleRun> {
    let status_str: String = r.get(3)?;
    let status = parse_run_status(&status_str);

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

const SCHEDULE_COLS: &str = "id, name, prompt, cwd, run_mode, cadence, model, thinking, approval_mode, enabled, next_run_at, last_run_at, created_at, updated_at, end_at, \
    (SELECT status FROM schedule_runs WHERE schedule_runs.schedule_id = schedules.id ORDER BY started_at DESC LIMIT 1), \
    (SELECT count(*) FROM schedule_runs WHERE schedule_runs.schedule_id = schedules.id), \
    notify, new_chat_each_run, max_runs, runs_done";

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

/// Normalize a draft cadence for storage: `every` > 1 needs an `anchor` (a
/// local date fixing the repeat phase) — a missing anchor defaults to
/// `today`; `every` <= 1 never stores one (it has no effect).
fn normalize_cadence(cadence: &ScheduleCadence, today: NaiveDate) -> ScheduleCadence {
    let mut cadence = cadence.clone();
    if let ScheduleCadence::Daily { every, anchor, .. }
    | ScheduleCadence::Monthly { every, anchor, .. } = &mut cadence
    {
        *anchor = if *every > 1 {
            anchor
                .take()
                .or_else(|| Some(today.format("%Y-%m-%d").to_string()))
        } else {
            None
        };
    }
    cadence
}

pub fn upsert(conn: &Connection, draft: &ScheduleDraft) -> Result<Schedule, String> {
    let ts = now_rfc3339();
    let run_mode_str = match draft.run_mode {
        ScheduleRunMode::Worktree => "worktree",
        ScheduleRunMode::Local => "local",
    };
    let notify_str = match draft.notify {
        ScheduleNotify::Important => "important",
        ScheduleNotify::None => "none",
        ScheduleNotify::All => "all",
    };
    let prev = draft
        .id
        .as_ref()
        .map(|id| get(conn, id))
        .transpose()
        .map_err(|e| e.to_string())?
        .flatten();

    validate_draft(draft, prev.as_ref())?;

    let now = Local::now();
    // Fill/normalize `anchor` before persisting so `next_run` always sees a
    // stable phase (and stored cadences round-trip through `keep` checks).
    let cadence = normalize_cadence(&draft.cadence, now.date_naive());
    let cadence_json = serde_json::to_string(&cadence).unwrap_or_default();
    // `end_at` and `max_runs` are recurring-only; `once` ignores both (contract).
    let end_at = match &cadence {
        ScheduleCadence::Once { .. } => None,
        _ => draft.end_at.clone(),
    };
    let max_runs = match &cadence {
        ScheduleCadence::Once { .. } => None,
        _ => draft.max_runs,
    };

    if let (Some(id), Some(prev)) = (draft.id.as_ref(), prev) {
        if draft.enabled && !prev.enabled {
            // Re-enabling a completed once is refused unless `at` moved to a
            // new (future) instant — that is a reschedule, not a re-enable.
            if let ScheduleCadence::Once { at } = &draft.cadence {
                let same_instant = matches!(&prev.cadence,
                    ScheduleCadence::Once { at: prev_at }
                        if DateTime::parse_from_rfc3339(prev_at).ok()
                            == DateTime::parse_from_rfc3339(at).ok());
                let ran = prev.last_run_at.is_some() || prev.last_run_status.is_some();
                if ran && same_instant {
                    return Err("一次性任务已执行，请复制或重新创建".to_string());
                }
            }
        }

        // Editing while capped at `max_runs` stays completed; raising/removing
        // the cap re-derives a fresh fire time (`runs_done` is kept).
        let cap_reached = max_runs.is_some_and(|max| prev.runs_done >= max);
        let next_run_at = if !draft.enabled || cap_reached {
            None
        } else {
            // Keep the stored instant when nothing timing-related changed.
            let keep = prev.enabled
                && prev.cadence == cadence
                && prev.end_at == end_at
                && prev.next_run_at.is_some();
            if keep {
                prev.next_run_at.clone()
            } else {
                next_run_bounded(&cadence, end_at.as_deref(), now).map(|dt| dt.to_rfc3339())
            }
        };
        // A schedule that can never fire again (once ran / once time passed /
        // recurring past end_at or its run cap) is stored disabled → `completed`.
        let enabled = (draft.enabled && next_run_at.is_some()) as i32;

        conn.execute(
            "UPDATE schedules
             SET name = ?2, prompt = ?3, cwd = ?4, run_mode = ?5, cadence = ?6,
                 model = ?7, thinking = ?8, approval_mode = ?9, enabled = ?10,
                 next_run_at = ?11, end_at = ?12, updated_at = ?13,
                 notify = ?14, new_chat_each_run = ?15, max_runs = ?16
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
                enabled,
                next_run_at,
                end_at,
                ts,
                notify_str,
                draft.new_chat_each_run as i32,
                max_runs,
            ],
        )
        .map_err(|e| e.to_string())?;

        return get(conn, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "定时任务不存在".to_string());
    }

    let id = draft
        .id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let next_run_at = if draft.enabled {
        next_run_bounded(&cadence, end_at.as_deref(), now).map(|dt| dt.to_rfc3339())
    } else {
        None
    };
    let enabled = (draft.enabled && next_run_at.is_some()) as i32;

    conn.execute(
        "INSERT INTO schedules(id, name, prompt, cwd, run_mode, cadence, model, thinking, approval_mode, enabled, next_run_at, last_run_at, end_at, notify, new_chat_each_run, max_runs, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?13, ?14, ?15, ?16, ?16)",
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
            enabled,
            next_run_at,
            end_at,
            notify_str,
            draft.new_chat_each_run as i32,
            max_runs,
            ts,
        ],
    )
    .map_err(|e| e.to_string())?;

    get(conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "定时任务不存在".to_string())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM schedules WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> Result<Schedule, String> {
    let prev = get(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "定时任务不存在".to_string())?;
    let next_run_at = if enabled {
        if matches!(prev.cadence, ScheduleCadence::Once { .. })
            && (prev.last_run_at.is_some() || prev.last_run_status.is_some())
        {
            return Err("一次性任务已执行，请复制或重新创建".to_string());
        }
        // A schedule that already reached its run cap stays completed; raising
        // or clearing `max_runs` goes through `schedules_save` instead.
        if prev.max_runs.is_some_and(|max| prev.runs_done >= max) {
            return Err("已达到运行次数上限，请先编辑任务".to_string());
        }
        let next = next_run_bounded(&prev.cadence, prev.end_at.as_deref(), Local::now())
            .ok_or_else(|| {
                if matches!(prev.cadence, ScheduleCadence::Once { .. }) {
                    "一次性任务已执行，请复制或重新创建".to_string()
                } else {
                    "结束时间已过，请先修改结束时间".to_string()
                }
            })?;
        Some(next.to_rfc3339())
    } else {
        None
    };
    let ts = now_rfc3339();

    conn.execute(
        "UPDATE schedules SET enabled = ?2, next_run_at = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, enabled as i32, next_run_at, ts],
    )
    .map_err(|e| e.to_string())?;

    get(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "定时任务不存在".to_string())
}

/// Advance a schedule after a run was dispatched: stamps `last_run_at` and
/// computes the next fire time. A `once` that ran or a recurring schedule
/// whose `end_at` is passed becomes `enabled=0, next_run_at=NULL`.
pub fn advance_after_run(
    conn: &Connection,
    schedule: &Schedule,
    fired_at: DateTime<Local>,
) -> Result<(), rusqlite::Error> {
    // A `once` always completes after dispatching (even a manual run before
    // `at`); recurring cadences stop when the next occurrence lands past `end_at`.
    let next = match &schedule.cadence {
        ScheduleCadence::Once { .. } => None,
        _ => next_run(&schedule.cadence, fired_at).and_then(|n| {
            match schedule
                .end_at
                .as_deref()
                .and_then(|e| DateTime::parse_from_rfc3339(e).ok())
            {
                Some(end) if n > end => None,
                _ => Some(n),
            }
        }),
    };
    let ts = now_rfc3339();
    match next {
        Some(next) => conn.execute(
            "UPDATE schedules SET last_run_at = ?2, next_run_at = ?3, updated_at = ?4 WHERE id = ?1",
            params![schedule.id, fired_at.to_rfc3339(), next.to_rfc3339(), ts],
        )?,
        None => conn.execute(
            "UPDATE schedules SET last_run_at = ?2, enabled = 0, next_run_at = NULL, updated_at = ?3 WHERE id = ?1",
            params![schedule.id, fired_at.to_rfc3339(), ts],
        )?,
    };
    Ok(())
}

/// Record that a run actually started: stamps `last_run_at` and increments
/// `runs_done`. When the increment reaches `max_runs` the schedule completes
/// (`enabled=0, next_run_at=NULL`); a `once` never stores a cap so its
/// existing completion path is unchanged. Skipped runs never reach this
/// (they were not started).
pub fn record_run_start(conn: &Connection, id: &str, at: &str) -> Result<(), rusqlite::Error> {
    let ts = now_rfc3339();
    conn.execute(
        "UPDATE schedules SET last_run_at = ?2, runs_done = runs_done + 1, updated_at = ?3 WHERE id = ?1",
        params![id, at, ts],
    )?;
    conn.execute(
        "UPDATE schedules SET enabled = 0, next_run_at = NULL, updated_at = ?2
         WHERE id = ?1 AND max_runs IS NOT NULL AND runs_done >= max_runs",
        params![id, ts],
    )?;
    Ok(())
}
/// Due = parsed instant of `next_run_at` <= `before`. Compared as instants in Rust:
/// stored strings carry local UTC offsets that differ across DST / timezone changes,
/// so SQL string comparison is wrong.
pub fn find_due(conn: &Connection, before: &str) -> Result<Vec<Schedule>, rusqlite::Error> {
    let Ok(cutoff) = DateTime::parse_from_rfc3339(before) else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT {SCHEDULE_COLS} FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL"
    ))?;
    let rows = stmt.query_map([], row_to_schedule)?;
    let mut due = Vec::new();
    for row in rows {
        let s = row?;
        let is_due = s
            .next_run_at
            .as_deref()
            .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
            .is_some_and(|dt| dt <= cutoff);
        if is_due {
            due.push(s);
        }
    }
    Ok(due)
}

pub fn earliest_next_run(conn: &Connection) -> Result<Option<DateTime<Local>>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT next_run_at FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL",
    )?;
    let vals = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut min: Option<DateTime<chrono::FixedOffset>> = None;
    for v in vals {
        if let Ok(dt) = DateTime::parse_from_rfc3339(&v?) {
            if min.map_or(true, |m| dt < m) {
                min = Some(dt);
            }
        }
    }
    Ok(min.map(|dt| dt.with_timezone(&Local)))
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

/// Settle runs left `running` by a previous app process (crash, force quit,
/// power loss) so they cannot block the schedule forever: `has_active_run`
/// would keep reporting a run in progress and every later trigger would be
/// skipped. Called once at scheduler startup, before the catch-up pass.
/// Returns how many runs were closed.
pub fn recover_stale_runs(conn: &Connection, at: &str) -> Result<usize, rusqlite::Error> {
    conn.execute(
        "UPDATE schedule_runs
         SET status = 'error', finished_at = ?1,
             summary = COALESCE(NULLIF(TRIM(summary), ''), '应用异常退出，本次运行未完成')
         WHERE status = 'running'",
        params![at],
    )
}

/// File path of the session used by this schedule's most recent run that has
/// one — the resume target when `new_chat_each_run` is false (local mode).
pub fn last_run_session_file(
    conn: &Connection,
    schedule_id: &str,
) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT m.file_path FROM schedule_runs r
         JOIN session_meta m ON m.session_id = r.session_id
         WHERE r.schedule_id = ?1 AND r.session_id IS NOT NULL AND m.file_path IS NOT NULL
         ORDER BY r.started_at DESC LIMIT 1",
        params![schedule_id],
        |r| r.get(0),
    )
    .optional()
}
