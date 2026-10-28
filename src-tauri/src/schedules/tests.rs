//! Unit tests for pure next_run and schedules store CRUD.

use chrono::{
    DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone,
};
use rusqlite::{params, Connection};

use crate::contracts::{
    Schedule, ScheduleCadence, ScheduleDraft, ScheduleLifecycle, ScheduleNotify, ScheduleRunMode,
    ScheduleRunStatus,
};
use crate::schedules::runner::should_create_inbox_todo;
use crate::schedules::store::{
    advance_after_run, claim_run, create_run, delete, derive_lifecycle, from_local_result, get,
    has_active_run, last_run_session_file, list, list_runs, next_run, next_run_bounded,
    now_rfc3339, record_run_start, recover_stale_runs, set_enabled, update_run, upsert,
};

fn make_local(year: i32, month: u32, day: u32, hour: u32, min: u32) -> DateTime<Local> {
    let d = NaiveDate::from_ymd_opt(year, month, day).unwrap();
    let t = NaiveTime::from_hms_opt(hour, min, 0).unwrap();
    let dt = NaiveDateTime::new(d, t);
    Local.from_local_datetime(&dt).single().unwrap()
}

#[test]
fn test_next_run_interval() {
    let after = make_local(2026, 10, 1, 10, 0);

    // 15 minutes interval
    let c1 = ScheduleCadence::Interval { minutes: 15 };
    let n1 = next_run(&c1, after);
    assert_eq!(n1.unwrap(), after + Duration::minutes(15));

    // Below minimum of 5 minutes: clamped to 5 minutes
    let c2 = ScheduleCadence::Interval { minutes: 2 };
    let n2 = next_run(&c2, after);
    assert_eq!(n2.unwrap(), after + Duration::minutes(5));
}

#[test]
fn test_next_run_daily_same_day() {
    // 08:30 on Oct 1
    let after = make_local(2026, 10, 1, 8, 30);
    let c = ScheduleCadence::Daily {
        time: "09:00".to_string(),
        weekdays: vec![],
        every: 1,
        anchor: None,
    };
    let n = next_run(&c, after);
    let expected = make_local(2026, 10, 1, 9, 0);
    assert_eq!(n.unwrap(), expected);
}

#[test]
fn test_next_run_daily_crossing_midnight() {
    // 10:15 on Oct 1, target 09:00 -> should run on Oct 2 at 09:00
    let after = make_local(2026, 10, 1, 10, 15);
    let c = ScheduleCadence::Daily {
        time: "09:00".to_string(),
        weekdays: vec![],
        every: 1,
        anchor: None,
    };
    let n = next_run(&c, after);
    let expected = make_local(2026, 10, 2, 9, 0);
    assert_eq!(n.unwrap(), expected);
}

#[test]
fn test_next_run_daily_weekdays_crossing_weekend() {
    // 2026-10-02 is a Friday
    let friday = make_local(2026, 10, 2, 18, 0);
    assert_eq!(friday.weekday().num_days_from_sunday(), 5); // 5 = Friday

    // Workdays only: 1,2,3,4,5 (Mon..Fri), 09:00
    let c = ScheduleCadence::Daily {
        time: "09:00".to_string(),
        weekdays: vec![1, 2, 3, 4, 5],
        every: 1,
        anchor: None,
    };

    let n = next_run(&c, friday);
    // Should be next Monday (2026-10-05) at 09:00
    let expected_monday = make_local(2026, 10, 5, 9, 0);
    assert_eq!(expected_monday.weekday().num_days_from_sunday(), 1); // 1 = Monday
    assert_eq!(n.unwrap(), expected_monday);
}

#[test]
fn test_next_run_daily_weekends_crossing_week() {
    // 2026-10-04 is Sunday (weekday 0) at 10:00
    let sunday = make_local(2026, 10, 4, 10, 0);
    assert_eq!(sunday.weekday().num_days_from_sunday(), 0);

    // Weekends only: 0 (Sun), 6 (Sat) at 09:00
    let c = ScheduleCadence::Daily {
        time: "09:00".to_string(),
        weekdays: vec![0, 6],
        every: 1,
        anchor: None,
    };

    let n = next_run(&c, sunday);
    // Target time 09:00 on Sunday has passed, so next weekend run is Saturday 2026-10-10 at 09:00
    let expected_saturday = make_local(2026, 10, 10, 9, 0);
    assert_eq!(expected_saturday.weekday().num_days_from_sunday(), 6);
    assert_eq!(n.unwrap(), expected_saturday);
}

#[test]
fn test_next_run_once_future_and_past() {
    let after = make_local(2026, 10, 1, 10, 0);

    let future = (chrono::Utc::now() + Duration::days(1)).to_rfc3339();
    let c = ScheduleCadence::Once { at: future.clone() };
    let n = next_run(&c, after).unwrap();
    assert_eq!(
        n,
        DateTime::parse_from_rfc3339(&future)
            .unwrap()
            .with_timezone(&Local)
    );

    // A past instant can never fire again.
    let past = "2020-01-01T00:00:00Z".to_string();
    let c_past = ScheduleCadence::Once { at: past };
    assert!(next_run(&c_past, after).is_none());
}

#[test]
fn test_next_run_bounded_once_past_returns_instant() {
    // Enabling a missed one-shot returns its (past) instant → immediate catch-up.
    let now = Local::now();
    let past = (chrono::Utc::now() - Duration::hours(1)).to_rfc3339();
    let c = ScheduleCadence::Once { at: past };
    let n = next_run_bounded(&c, None, now).unwrap();
    assert!(n <= now);
}

#[test]
fn test_next_run_bounded_recurring_end_at() {
    let now = Local::now();
    let c = ScheduleCadence::Interval { minutes: 15 };
    // Next occurrence lands after end_at → None.
    let end = (chrono::Utc::now() + Duration::minutes(5)).to_rfc3339();
    assert!(next_run_bounded(&c, Some(&end), now).is_none());
    // Next occurrence before end_at survives.
    let end_later = (chrono::Utc::now() + Duration::days(1)).to_rfc3339();
    assert!(next_run_bounded(&c, Some(&end_later), now).is_some());
}

#[test]
fn test_next_run_monthly_clamps_short_months() {
    // 31st of a month followed by a 30-day month: Oct 31 → Nov 30.
    let after = make_local(2026, 10, 31, 10, 0);
    let c = ScheduleCadence::Monthly {
        day: 31,
        time: "09:00".to_string(),
        every: 1,
        anchor: None,
    };
    let n = next_run(&c, after).unwrap();
    let expected = make_local(2026, 11, 30, 9, 0);
    assert_eq!(n, expected);

    // Same-day later that month does not clamp.
    let after_early = make_local(2026, 10, 30, 10, 0);
    let n2 = next_run(&c, after_early).unwrap();
    assert_eq!(n2, make_local(2026, 10, 31, 9, 0));
}

#[test]
fn test_next_run_monthly_feb_leap() {
    // Non-leap year: day 31 in Feb clamps to Feb 28.
    let after = make_local(2026, 1, 31, 10, 0);
    let c = ScheduleCadence::Monthly {
        day: 31,
        time: "09:00".to_string(),
        every: 1,
        anchor: None,
    };
    assert_eq!(next_run(&c, after).unwrap(), make_local(2026, 2, 28, 9, 0));

    // Leap year (2028): Feb has 29 days → day 31 clamps to Feb 29.
    let after_leap = make_local(2028, 1, 31, 10, 0);
    assert_eq!(
        next_run(&c, after_leap).unwrap(),
        make_local(2028, 2, 29, 9, 0)
    );

    // Exactly at the target instant → strictly-after pushes to next month.
    let at_0930 = make_local(2026, 2, 28, 9, 0);
    let c28 = ScheduleCadence::Monthly {
        day: 28,
        time: "09:00".to_string(),
        every: 1,
        anchor: None,
    };
    assert_eq!(
        next_run(&c28, at_0930).unwrap(),
        make_local(2026, 3, 28, 9, 0)
    );
}

#[test]
fn test_from_local_result_dst_gap_fallback() {
    // Fabricated DST gap: LocalResult::None retries at +1h, which resolves
    // normally on this machine regardless of its real timezone.
    let naive = NaiveDate::from_ymd_opt(2026, 3, 8)
        .unwrap()
        .and_hms_opt(2, 30, 0)
        .unwrap();
    let alt = naive.checked_add_signed(Duration::hours(1)).unwrap();
    let expected = Local.from_local_datetime(&alt).earliest();
    assert_eq!(from_local_result(LocalResult::None, naive), expected);

    // Ambiguous (fall-back): picks the earlier occurrence.
    let t = Local.from_local_datetime(&naive);
    if let LocalResult::Ambiguous(first, _second) = t {
        assert_eq!(from_local_result(t, naive), Some(first));
    }
}

fn setup_test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE schedules(
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           prompt TEXT NOT NULL,
           cwd TEXT NOT NULL,
           run_mode TEXT NOT NULL DEFAULT 'local',
           cadence TEXT NOT NULL,
           model TEXT,
           thinking TEXT,
           approval_mode TEXT,
           enabled INTEGER NOT NULL DEFAULT 1,
           next_run_at TEXT,
           last_run_at TEXT,
           end_at TEXT,
           notify TEXT NOT NULL DEFAULT 'all',
           new_chat_each_run INTEGER NOT NULL DEFAULT 1,
           max_runs INTEGER,
           runs_done INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE schedule_runs(
           id TEXT PRIMARY KEY,
           schedule_id TEXT NOT NULL,
           session_id TEXT,
           status TEXT NOT NULL,
           started_at TEXT NOT NULL,
           finished_at TEXT,
           summary TEXT,
           FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
         );
         CREATE INDEX idx_schedule_runs_schedule_id ON schedule_runs(schedule_id, started_at DESC);
         CREATE TABLE session_meta(
           session_id TEXT PRIMARY KEY,
           file_path TEXT
         );",
    )
    .unwrap();
    conn
}

#[test]
fn test_store_crud() {
    let conn = setup_test_db();

    // 1. Insert draft
    let draft = ScheduleDraft {
        id: None,
        name: "每日代码总结".to_string(),
        prompt: "总结今日代码提交".to_string(),
        cwd: "/tmp/project".to_string(),
        run_mode: ScheduleRunMode::Local,
        cadence: ScheduleCadence::Daily {
            time: "09:00".to_string(),
            weekdays: vec![1, 2, 3, 4, 5],
            every: 1,
            anchor: None,
        },
        model: Some("claude-3-5-sonnet".to_string()),
        thinking: None,
        approval_mode: Some("write".to_string()),
        enabled: true,
        end_at: None,
        max_runs: None,
        notify: ScheduleNotify::All,
        new_chat_each_run: true,
    };

    let created = upsert(&conn, &draft).unwrap();
    assert!(!created.id.is_empty());
    assert_eq!(created.name, "每日代码总结");
    assert!(created.next_run_at.is_some());
    assert!(created.last_run_at.is_none());

    // 2. List & Get
    let all = list(&conn).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, created.id);

    let fetched = get(&conn, &created.id).unwrap().unwrap();
    assert_eq!(fetched.name, "每日代码总结");

    // 3. Update
    let update_draft = ScheduleDraft {
        id: Some(created.id.clone()),
        name: "工作日代码总结 (已更新)".to_string(),
        prompt: "更新后的提示词".to_string(),
        cwd: "/tmp/project".to_string(),
        run_mode: ScheduleRunMode::Worktree,
        cadence: ScheduleCadence::Interval { minutes: 30 },
        model: None,
        thinking: None,
        approval_mode: Some("yolo".to_string()),
        enabled: true,
        end_at: None,
        max_runs: None,
        notify: ScheduleNotify::All,
        new_chat_each_run: true,
    };

    let updated = upsert(&conn, &update_draft).unwrap();
    assert_eq!(updated.name, "工作日代码总结 (已更新)");
    assert_eq!(updated.run_mode, ScheduleRunMode::Worktree);
    assert_eq!(updated.approval_mode.as_deref(), Some("yolo"));

    // 4. Disable / Enable toggle
    let disabled = set_enabled(&conn, &created.id, false).unwrap();
    assert!(!disabled.enabled);
    assert!(disabled.next_run_at.is_none());

    let re_enabled = set_enabled(&conn, &created.id, true).unwrap();
    assert!(re_enabled.enabled);
    assert!(re_enabled.next_run_at.is_some());

    // 5. Run tracking
    assert!(!has_active_run(&conn, &created.id).unwrap());

    let run_id = "run-123";
    create_run(
        &conn,
        run_id,
        &created.id,
        None,
        ScheduleRunStatus::Running,
        None,
    )
    .unwrap();

    assert!(has_active_run(&conn, &created.id).unwrap());
    let runs = list_runs(&conn, &created.id, 10).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, ScheduleRunStatus::Running);

    // Update run to OK
    update_run(
        &conn,
        run_id,
        Some("session-456"),
        ScheduleRunStatus::Ok,
        Some("2026-10-01T12:00:00Z"),
        Some("任务已完成"),
    )
    .unwrap();

    assert!(!has_active_run(&conn, &created.id).unwrap());
    let runs_after = list_runs(&conn, &created.id, 10).unwrap();
    assert_eq!(runs_after[0].status, ScheduleRunStatus::Ok);
    assert_eq!(runs_after[0].session_id.as_deref(), Some("session-456"));
    assert_eq!(runs_after[0].summary.as_deref(), Some("任务已完成"));

    // 6. Delete
    delete(&conn, &created.id).unwrap();
    assert!(get(&conn, &created.id).unwrap().is_none());
    assert!(list(&conn).unwrap().is_empty());
}

/// A run left `running` by a previous app process must be settled at startup,
/// otherwise it blocks every later trigger of that schedule forever.
#[test]
fn recover_stale_runs_settles_leftover_running_rows() {
    let conn = setup_test_db();
    let draft = ScheduleDraft {
        id: None,
        name: "清理遗留运行".to_string(),
        prompt: "p".to_string(),
        cwd: "/tmp/project".to_string(),
        run_mode: ScheduleRunMode::Local,
        cadence: ScheduleCadence::Interval { minutes: 30 },
        model: None,
        thinking: None,
        approval_mode: None,
        enabled: true,
        end_at: None,
        max_runs: None,
        notify: ScheduleNotify::All,
        new_chat_each_run: true,
    };
    let schedule = upsert(&conn, &draft).unwrap();
    create_run(
        &conn,
        "orphan",
        &schedule.id,
        Some("session-x"),
        ScheduleRunStatus::Running,
        None,
    )
    .unwrap();
    assert!(has_active_run(&conn, &schedule.id).unwrap());

    assert_eq!(
        recover_stale_runs(&conn, "2026-10-24T00:00:00Z").unwrap(),
        1
    );
    assert!(!has_active_run(&conn, &schedule.id).unwrap());
    let runs = list_runs(&conn, &schedule.id, 10).unwrap();
    assert_eq!(runs[0].status, ScheduleRunStatus::Error);
    assert_eq!(runs[0].finished_at.as_deref(), Some("2026-10-24T00:00:00Z"));
    assert_eq!(
        runs[0].summary.as_deref(),
        Some("应用异常退出，本次运行未完成")
    );
    // Idempotent: nothing left to settle.
    assert_eq!(
        recover_stale_runs(&conn, "2026-10-24T00:01:00Z").unwrap(),
        0
    );
}

fn once_draft(at: &str, enabled: bool) -> ScheduleDraft {
    ScheduleDraft {
        id: None,
        name: "一次性".to_string(),
        prompt: "run".to_string(),
        cwd: "/tmp".to_string(),
        run_mode: ScheduleRunMode::Local,
        cadence: ScheduleCadence::Once { at: at.to_string() },
        model: None,
        thinking: None,
        approval_mode: None,
        end_at: None,
        max_runs: None,
        enabled,
        notify: ScheduleNotify::All,
        new_chat_each_run: true,
    }
}

fn daily_draft(end_at: Option<String>, enabled: bool) -> ScheduleDraft {
    ScheduleDraft {
        id: None,
        name: "每日".to_string(),
        prompt: "run".to_string(),
        cwd: "/tmp".to_string(),
        run_mode: ScheduleRunMode::Local,
        cadence: ScheduleCadence::Daily {
            time: "09:00".to_string(),
            weekdays: vec![],
            every: 1,
            anchor: None,
        },
        model: None,
        thinking: None,
        approval_mode: None,
        end_at,
        max_runs: None,
        enabled,
        notify: ScheduleNotify::All,
        new_chat_each_run: true,
    }
}

#[test]
fn test_validation_errors() {
    let conn = setup_test_db();
    let future = (chrono::Utc::now() + Duration::days(1)).to_rfc3339();
    let past = (chrono::Utc::now() - Duration::days(1)).to_rfc3339();

    // once.at in the past → Err.
    let e = upsert(&conn, &once_draft(&past, true)).unwrap_err();
    assert_eq!(e, "请选择未来的时间");
    // once.at unparseable.
    assert!(upsert(&conn, &once_draft("not-a-date", true)).is_err());
    // interval < 5 → Err.
    let mut d = daily_draft(None, true);
    d.cadence = ScheduleCadence::Interval { minutes: 3 };
    assert_eq!(upsert(&conn, &d).unwrap_err(), "间隔至少 5 分钟");
    // bad HH:MM → Err.
    let mut d2 = daily_draft(None, true);
    d2.cadence = ScheduleCadence::Daily {
        time: "25:00".to_string(),
        weekdays: vec![],
        every: 1,
        anchor: None,
    };
    assert_eq!(upsert(&conn, &d2).unwrap_err(), "时间格式需为 HH:MM");
    // monthly day out of range.
    let mut d3 = daily_draft(None, true);
    d3.cadence = ScheduleCadence::Monthly {
        day: 0,
        time: "09:00".to_string(),
        every: 1,
        anchor: None,
    };
    assert_eq!(upsert(&conn, &d3).unwrap_err(), "每月日期需在 1-31 之间");
    // past end_at → Err.
    let e4 = upsert(&conn, &daily_draft(Some(past.clone()), true)).unwrap_err();
    assert_eq!(e4, "结束时间需晚于现在");
    // valid drafts still work.
    upsert(&conn, &once_draft(&future, true)).unwrap();
    upsert(&conn, &daily_draft(Some(future.clone()), true)).unwrap();
}

#[test]
fn test_once_completes_after_run() {
    let conn = setup_test_db();
    let future = (chrono::Utc::now() + Duration::minutes(30)).to_rfc3339();
    let s = upsert(&conn, &once_draft(&future, true)).unwrap();
    assert_eq!(s.lifecycle, ScheduleLifecycle::Active);
    assert!(s.next_run_at.is_some());

    // Simulate the scheduler dispatch: advance completes a once.
    create_run(&conn, "r1", &s.id, None, ScheduleRunStatus::Running, None).unwrap();
    advance_after_run(&conn, &s, Local::now()).unwrap();
    let done = get(&conn, &s.id).unwrap().unwrap();
    assert!(!done.enabled);
    assert!(done.next_run_at.is_none());
    assert_eq!(done.lifecycle, ScheduleLifecycle::Completed);

    // Re-enabling a completed once is refused.
    let e = set_enabled(&conn, &s.id, true).unwrap_err();
    assert_eq!(e, "一次性任务已执行，请复制或重新创建");
}

#[test]
fn test_recurring_past_end_at_completes() {
    let conn = setup_test_db();
    let future_end = (chrono::Utc::now() + Duration::days(1)).to_rfc3339();
    let s = upsert(&conn, &daily_draft(Some(future_end), true)).unwrap();
    assert_eq!(s.lifecycle, ScheduleLifecycle::Active);

    // end_at already passed → re-enabling is refused.
    let paused = set_enabled(&conn, &s.id, false).unwrap();
    assert_eq!(paused.lifecycle, ScheduleLifecycle::Paused);
    conn.execute(
        "UPDATE schedules SET end_at = '2020-01-01T00:00:00Z' WHERE id = ?1",
        params![s.id],
    )
    .unwrap();
    let e = set_enabled(&conn, &s.id, true).unwrap_err();
    assert_eq!(e, "结束时间已过，请先修改结束时间");
    // Lifecycle reflects the passed end.
    let s2 = get(&conn, &s.id).unwrap().unwrap();
    assert_eq!(s2.lifecycle, ScheduleLifecycle::Completed);
}

#[test]
fn test_derive_lifecycle_states() {
    let now = Local::now();
    let base = Schedule {
        id: "s".to_string(),
        name: "n".to_string(),
        prompt: "p".to_string(),
        cwd: "/tmp".to_string(),
        run_mode: ScheduleRunMode::Local,
        cadence: ScheduleCadence::Interval { minutes: 15 },
        model: None,
        thinking: None,
        approval_mode: None,
        enabled: true,
        next_run_at: None,
        last_run_at: None,
        last_run_status: None,
        created_at: String::new(),
        updated_at: String::new(),
        end_at: None,
        lifecycle: ScheduleLifecycle::Active,
        notify: ScheduleNotify::All,
        new_chat_each_run: true,
        max_runs: None,
        runs_done: 0,
    };
    assert_eq!(
        derive_lifecycle(&base, false, now),
        ScheduleLifecycle::Active
    );
    let paused = Schedule {
        enabled: false,
        ..base.clone()
    };
    assert_eq!(
        derive_lifecycle(&paused, false, now),
        ScheduleLifecycle::Paused
    );
    // The current one-shot occurrence completed, regardless of old history.
    let once = Schedule {
        cadence: ScheduleCadence::Once {
            at: "2999-01-01T00:00:00Z".to_string(),
        },
        last_run_at: Some(now.to_rfc3339()),
        ..base.clone()
    };
    assert_eq!(
        derive_lifecycle(&once, true, now),
        ScheduleLifecycle::Completed
    );
    // Recurring at its run cap → completed even while enabled.
    let capped = Schedule {
        max_runs: Some(3),
        runs_done: 3,
        ..base.clone()
    };
    assert_eq!(
        derive_lifecycle(&capped, false, now),
        ScheduleLifecycle::Completed
    );
}

#[test]
fn test_record_run_start() {
    let conn = setup_test_db();
    let future = (chrono::Utc::now() + Duration::days(1)).to_rfc3339();
    let s = upsert(&conn, &once_draft(&future, true)).unwrap();
    record_run_start(&conn, &s.id, "2026-10-12T00:00:00Z").unwrap();
    let s2 = get(&conn, &s.id).unwrap().unwrap();
    assert_eq!(s2.last_run_at.as_deref(), Some("2026-10-12T00:00:00Z"));
    // next_run untouched by the stamp.
    assert!(s2.next_run_at.is_some());
}

/// A draft JSON without the new fields deserializes to the backend defaults
/// (notify=all, newChatEachRun=true); explicit values round-trip.
#[test]
fn test_draft_deserialize_defaults() {
    let json = serde_json::json!({
        "name": "n",
        "prompt": "p",
        "cwd": "/tmp",
        "cadence": { "kind": "interval", "minutes": 60 },
    });
    let draft: ScheduleDraft = serde_json::from_value(json).unwrap();
    assert_eq!(draft.notify, ScheduleNotify::All);
    assert!(draft.new_chat_each_run);

    let json2 = serde_json::json!({
        "name": "n",
        "prompt": "p",
        "cwd": "/tmp",
        "cadence": { "kind": "interval", "minutes": 60 },
        "notify": "important",
        "newChatEachRun": false,
    });
    let draft2: ScheduleDraft = serde_json::from_value(json2).unwrap();
    assert_eq!(draft2.notify, ScheduleNotify::Important);
    assert!(!draft2.new_chat_each_run);
}

/// The pure inbox gating decision: `all` always, `important` on failure or
/// attention-needed, `none` never.
#[test]
fn test_should_create_inbox_todo() {
    for notify in [
        ScheduleNotify::All,
        ScheduleNotify::Important,
        ScheduleNotify::None,
    ] {
        for ok in [true, false] {
            for attention in [true, false] {
                let want = match notify {
                    ScheduleNotify::All => true,
                    ScheduleNotify::Important => !ok || attention,
                    ScheduleNotify::None => false,
                };
                assert_eq!(should_create_inbox_todo(notify, ok, attention), want);
            }
        }
    }
    // Spot-check the documented semantics.
    assert!(should_create_inbox_todo(
        ScheduleNotify::Important,
        false,
        false
    ));
    assert!(should_create_inbox_todo(
        ScheduleNotify::Important,
        true,
        true
    ));
    assert!(!should_create_inbox_todo(
        ScheduleNotify::Important,
        true,
        false
    ));
}

/// notify / new_chat_each_run persist through upsert (insert + update).
#[test]
fn test_notify_fields_persisted() {
    let conn = setup_test_db();
    let mut d = daily_draft(None, true);
    d.notify = ScheduleNotify::Important;
    d.new_chat_each_run = false;
    let s = upsert(&conn, &d).unwrap();
    assert_eq!(s.notify, ScheduleNotify::Important);
    assert!(!s.new_chat_each_run);
    let fetched = get(&conn, &s.id).unwrap().unwrap();
    assert_eq!(fetched.notify, ScheduleNotify::Important);
    assert!(!fetched.new_chat_each_run);

    let d2 = ScheduleDraft {
        id: Some(s.id.clone()),
        notify: ScheduleNotify::None,
        new_chat_each_run: true,
        ..d
    };
    let updated = upsert(&conn, &d2).unwrap();
    assert_eq!(updated.notify, ScheduleNotify::None);
    assert!(updated.new_chat_each_run);
}

/// Resume lookup returns the newest run's session file, skipping runs
/// without a session and sessions without a file path.
#[test]
fn test_last_run_session_file() {
    let conn = setup_test_db();
    let s = upsert(&conn, &daily_draft(None, true)).unwrap();
    assert_eq!(last_run_session_file(&conn, &s.id).unwrap(), None);

    // Oldest first (started_at order decides, not insertion order).
    conn.execute(
        "INSERT INTO schedule_runs(id, schedule_id, session_id, status, started_at)
         VALUES('r1', ?1, 's-old', 'ok', '2026-10-01T00:00:00Z')",
        params![s.id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO schedule_runs(id, schedule_id, session_id, status, started_at)
         VALUES('r2', ?1, NULL, 'error', '2026-10-03T00:00:00Z')",
        params![s.id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO schedule_runs(id, schedule_id, session_id, status, started_at)
         VALUES('r3', ?1, 's-new', 'ok', '2026-10-02T00:00:00Z')",
        params![s.id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO session_meta(session_id, file_path) VALUES('s-old', '/tmp/old.jsonl')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO session_meta(session_id, file_path) VALUES('s-new', '/tmp/new.jsonl')",
        [],
    )
    .unwrap();

    // r2 is newest but has no session → falls back to r3's file.
    assert_eq!(
        last_run_session_file(&conn, &s.id).unwrap().as_deref(),
        Some("/tmp/new.jsonl")
    );
}

/// `every` > 1 without weekdays: occurrences are `anchor + k*every` local days.
#[test]
fn test_next_run_every_n_days() {
    // Anchor Oct 1, every 2 days → Oct 1, 3, 5, …
    let c = ScheduleCadence::Daily {
        time: "09:00".to_string(),
        weekdays: vec![],
        every: 2,
        anchor: Some("2026-10-01".to_string()),
    };
    // 08:00 on Oct 3 (an on-phase day) → same day.
    assert_eq!(
        next_run(&c, make_local(2026, 10, 3, 8, 0)).unwrap(),
        make_local(2026, 10, 3, 9, 0)
    );
    // 10:00 on Oct 3 (instant passed) → next on-phase day Oct 5.
    assert_eq!(
        next_run(&c, make_local(2026, 10, 3, 10, 0)).unwrap(),
        make_local(2026, 10, 5, 9, 0)
    );
    // An off-phase day (Oct 4) is skipped entirely.
    assert_eq!(
        next_run(&c, make_local(2026, 10, 4, 8, 0)).unwrap(),
        make_local(2026, 10, 5, 9, 0)
    );
}

/// `every` > 1 with weekdays: whole weeks (Monday-start) every `every` weeks
/// counting from the anchor's week; the listed weekdays inside them fire.
#[test]
fn test_next_run_every_n_weeks_weekdays() {
    // Anchor Wed 2026-10-14 (Mon-start week Oct 12-18); every 2 weeks on Wed/Fri.
    let c = ScheduleCadence::Daily {
        time: "09:00".to_string(),
        weekdays: vec![3, 5],
        every: 2,
        anchor: Some("2026-10-14".to_string()),
    };
    // Wed Sep 30 08:00 → Wed Oct 14 (weeks Oct 12 and Oct 26 fire; Oct 5 skipped).
    assert_eq!(
        next_run(&c, make_local(2026, 9, 30, 8, 0)).unwrap(),
        make_local(2026, 10, 14, 9, 0)
    );
    // After Wed Oct 14's instant → Fri Oct 16 (same firing week), not Oct 28.
    assert_eq!(
        next_run(&c, make_local(2026, 10, 14, 10, 0)).unwrap(),
        make_local(2026, 10, 16, 9, 0)
    );
    // A weekday inside an off week (Fri Oct 23) is skipped → Wed Oct 28.
    assert_eq!(
        next_run(&c, make_local(2026, 10, 23, 8, 0)).unwrap(),
        make_local(2026, 10, 28, 9, 0)
    );
}

/// `every` > 1 monthly: every `every` months counted from the anchor month,
/// keeping the day-of-month clamp.
#[test]
fn test_next_run_every_n_months() {
    // Anchor 2026-01-31, every 3 months, day 31 → Jan 31, Apr 30, Jul 31,
    // Oct 31 (off-phase months are skipped; 31 clamps in 30-day months).
    let c = ScheduleCadence::Monthly {
        day: 31,
        time: "09:00".to_string(),
        every: 3,
        anchor: Some("2026-01-31".to_string()),
    };
    // After Jan 31 09:00 → Apr 30 (Feb/Mar off-phase; April has 30 days).
    assert_eq!(
        next_run(&c, make_local(2026, 1, 31, 10, 0)).unwrap(),
        make_local(2026, 4, 30, 9, 0)
    );
    // Mid-cycle: Mar 15 → still Apr 30.
    assert_eq!(
        next_run(&c, make_local(2026, 3, 15, 10, 0)).unwrap(),
        make_local(2026, 4, 30, 9, 0)
    );
    // Apr 30 09:30 (instant passed) → Jul 31 (July has 31 days, no clamp).
    assert_eq!(
        next_run(&c, make_local(2026, 4, 30, 9, 30)).unwrap(),
        make_local(2026, 7, 31, 9, 0)
    );
}

/// Legacy stored cadence JSON (no `every`/`anchor`) deserializes to
/// `every = 1, anchor = None` — identical semantics to before.
#[test]
fn test_cadence_deserialize_legacy() {
    let daily: ScheduleCadence =
        serde_json::from_str(r#"{"kind":"daily","time":"09:00","weekdays":[1]}"#).unwrap();
    assert_eq!(
        daily,
        ScheduleCadence::Daily {
            time: "09:00".to_string(),
            weekdays: vec![1],
            every: 1,
            anchor: None,
        }
    );
    let monthly: ScheduleCadence =
        serde_json::from_str(r#"{"kind":"monthly","day":15,"time":"08:30"}"#).unwrap();
    assert_eq!(
        monthly,
        ScheduleCadence::Monthly {
            day: 15,
            time: "08:30".to_string(),
            every: 1,
            anchor: None,
        }
    );
    // every=1 does not add fields to serialized JSON (legacy round-trip).
    assert!(!serde_json::to_string(&daily).unwrap().contains("every"));
}

/// `every`/`anchor`/`max_runs` validation + anchor normalization on save.
#[test]
fn test_every_anchor_and_cap_validation() {
    let conn = setup_test_db();

    // every = 0 → Err.
    let mut d = daily_draft(None, true);
    if let ScheduleCadence::Daily { every, .. } = &mut d.cadence {
        *every = 0;
    }
    assert_eq!(upsert(&conn, &d).unwrap_err(), "重复间隔需在 1-999 之间");
    // every = 1000 → Err.
    let mut d = daily_draft(None, true);
    if let ScheduleCadence::Daily { every, .. } = &mut d.cadence {
        *every = 1000;
    }
    assert_eq!(upsert(&conn, &d).unwrap_err(), "重复间隔需在 1-999 之间");
    // anchor that is not YYYY-MM-DD → Err.
    let mut d = daily_draft(None, true);
    if let ScheduleCadence::Daily { every, anchor, .. } = &mut d.cadence {
        *every = 2;
        *anchor = Some("2026/10/01".to_string());
    }
    assert_eq!(
        upsert(&conn, &d).unwrap_err(),
        "重复起始日期格式需为 YYYY-MM-DD"
    );
    // max_runs = 0 → Err.
    let mut d = daily_draft(None, true);
    d.max_runs = Some(0);
    assert_eq!(upsert(&conn, &d).unwrap_err(), "运行次数需至少为 1");

    // every > 1 without anchor → backend fills today's local date.
    let mut d = daily_draft(None, true);
    if let ScheduleCadence::Daily { every, .. } = &mut d.cadence {
        *every = 2;
    }
    let s = upsert(&conn, &d).unwrap();
    let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
    match s.cadence {
        ScheduleCadence::Daily { every, anchor, .. } => {
            assert_eq!(every, 2);
            assert_eq!(anchor.as_deref(), Some(today.as_str()));
        }
        _ => panic!("expected daily cadence"),
    }

    // every == 1 keeps no anchor even if the draft carried one.
    let mut d = daily_draft(None, true);
    if let ScheduleCadence::Daily { anchor, .. } = &mut d.cadence {
        *anchor = Some("2020-01-01".to_string());
    }
    let s = upsert(&conn, &d).unwrap();
    match s.cadence {
        ScheduleCadence::Daily { anchor, .. } => assert!(anchor.is_none()),
        _ => panic!("expected daily cadence"),
    }
}

/// `max_runs` end condition: `runs_done` increments on each started run, the
/// schedule completes at the cap, and raising/clearing the cap via save
/// re-activates it while keeping `runs_done`.
#[test]
fn test_max_runs_completes() {
    let conn = setup_test_db();
    let mut d = daily_draft(None, true);
    d.max_runs = Some(2);
    let s = upsert(&conn, &d).unwrap();
    assert_eq!(s.max_runs, Some(2));
    assert_eq!(s.runs_done, 0);
    assert_eq!(s.lifecycle, ScheduleLifecycle::Active);

    // First run starts: counter increments, schedule stays enabled.
    record_run_start(&conn, &s.id, &crate::schedules::store::now_rfc3339()).unwrap();
    let s = get(&conn, &s.id).unwrap().unwrap();
    assert_eq!(s.runs_done, 1);
    assert!(s.enabled);
    assert!(s.next_run_at.is_some());

    // Second run reaches the cap → enabled=0, next_run_at=NULL, completed.
    record_run_start(&conn, &s.id, &crate::schedules::store::now_rfc3339()).unwrap();
    let s = get(&conn, &s.id).unwrap().unwrap();
    assert_eq!(s.runs_done, 2);
    assert!(!s.enabled);
    assert!(s.next_run_at.is_none());
    assert_eq!(s.lifecycle, ScheduleLifecycle::Completed);

    // Toggling it back on is refused while capped.
    let e = set_enabled(&conn, &s.id, true).unwrap_err();
    assert_eq!(e, "已达到运行次数上限，请先编辑任务");

    // Raising the cap re-derives: enabled with a fresh next_run_at; runs_done kept.
    let mut d2 = daily_draft(None, true);
    d2.id = Some(s.id.clone());
    d2.max_runs = Some(5);
    let s = upsert(&conn, &d2).unwrap();
    assert!(s.enabled);
    assert!(s.next_run_at.is_some());
    assert_eq!(s.runs_done, 2);
    assert_eq!(s.lifecycle, ScheduleLifecycle::Active);

    // Lowering the cap back to runs_done completes it again.
    let mut d3 = daily_draft(None, true);
    d3.id = Some(s.id.clone());
    d3.max_runs = Some(2);
    let s = upsert(&conn, &d3).unwrap();
    assert!(!s.enabled);
    assert!(s.next_run_at.is_none());
    assert_eq!(s.lifecycle, ScheduleLifecycle::Completed);

    // Clearing the cap (None = unlimited) re-activates.
    let mut d4 = daily_draft(None, true);
    d4.id = Some(s.id.clone());
    let s = upsert(&conn, &d4).unwrap();
    assert!(s.enabled);
    assert_eq!(s.max_runs, None);
    assert_eq!(s.lifecycle, ScheduleLifecycle::Active);
}

/// `next_run_at` strings carry differing UTC offsets (DST / timezone change):
/// due-ness and the earliest wake-up must compare instants, not strings.
#[test]
fn test_due_compares_instants_across_offsets() {
    use crate::schedules::store::{earliest_next_run, find_due};
    let conn = setup_test_db();
    let a = upsert(&conn, &daily_draft(None, true)).unwrap();
    let b = upsert(&conn, &daily_draft(None, true)).unwrap();
    // A = 13:00Z, B = 13:30Z; lexicographically B ("08:30") sorts before A ("09:00").
    for (id, at) in [
        (&a.id, "2026-11-02T09:00:00-04:00"),
        (&b.id, "2026-11-02T08:30:00-05:00"),
    ] {
        conn.execute(
            "UPDATE schedules SET next_run_at = ?2 WHERE id = ?1",
            params![id, at],
        )
        .unwrap();
    }
    let due = find_due(&conn, "2026-11-02T13:10:00+00:00").unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, a.id);
    let earliest = earliest_next_run(&conn).unwrap().unwrap();
    assert_eq!(
        earliest.with_timezone(&chrono::Utc).to_rfc3339(),
        "2026-11-02T13:00:00+00:00"
    );
}

#[test]
fn rescheduled_once_has_a_new_occurrence_and_preserves_history() {
    let conn = setup_test_db();
    let future = (chrono::Utc::now() + Duration::days(1)).to_rfc3339();
    let mut draft = once_draft(&future, true);
    let first = upsert(&conn, &draft).unwrap();
    claim_run(&conn, &first.id, "first", None).unwrap();
    update_run(
        &conn,
        "first",
        None,
        ScheduleRunStatus::Ok,
        Some(&now_rfc3339()),
        None,
    )
    .unwrap();
    assert_eq!(
        get(&conn, &first.id).unwrap().unwrap().lifecycle,
        ScheduleLifecycle::Completed
    );

    draft.id = Some(first.id.clone());
    draft.cadence = ScheduleCadence::Once {
        at: (chrono::Utc::now() + Duration::days(2)).to_rfc3339(),
    };
    // Saving a paused reschedule must not still derive Completed from old runs.
    draft.enabled = false;
    let paused = upsert(&conn, &draft).unwrap();
    assert_eq!(paused.lifecycle, ScheduleLifecycle::Paused);
    assert_eq!(paused.runs_done, 1);
    assert!(paused.last_run_at.is_none());
    let active = set_enabled(&conn, &first.id, true).unwrap();
    assert_eq!(active.lifecycle, ScheduleLifecycle::Active);
    assert!(active.next_run_at.is_some());
    assert_eq!(list_runs(&conn, &first.id, 10).unwrap().len(), 1);
    claim_run(&conn, &first.id, "second", None).unwrap();
    assert_eq!(
        get(&conn, &first.id).unwrap().unwrap().lifecycle,
        ScheduleLifecycle::Completed
    );
}

#[test]
fn manual_claim_enforces_cap_and_rolls_back_failed_claims() {
    let conn = setup_test_db();
    let mut draft = daily_draft(None, true);
    draft.max_runs = Some(1);
    let schedule = upsert(&conn, &draft).unwrap();
    claim_run(&conn, &schedule.id, "only", None).unwrap();
    update_run(
        &conn,
        "only",
        None,
        ScheduleRunStatus::Ok,
        Some(&now_rfc3339()),
        None,
    )
    .unwrap();
    assert!(claim_run(&conn, &schedule.id, "over-cap", None)
        .unwrap_err()
        .contains("上限"));
    let capped = get(&conn, &schedule.id).unwrap().unwrap();
    assert_eq!(capped.runs_done, 1);
    assert!(!capped.enabled);
    assert!(capped.next_run_at.is_none());
    assert_eq!(list_runs(&conn, &schedule.id, 10).unwrap().len(), 1);

    let other = upsert(&conn, &daily_draft(None, true)).unwrap();
    // An insertion failure must not increment the counter or consume its time.
    assert!(claim_run(&conn, &other.id, "only", None).is_err());
    assert_eq!(get(&conn, &other.id).unwrap().unwrap().runs_done, 0);
}

#[test]
fn automatic_claim_rechecks_occurrence_and_cannot_exceed_cap() {
    let conn = setup_test_db();
    let mut draft = daily_draft(None, true);
    draft.max_runs = Some(1);
    let schedule = upsert(&conn, &draft).unwrap();
    let due = (chrono::Utc::now() - Duration::minutes(1)).to_rfc3339();
    conn.execute(
        "UPDATE schedules SET next_run_at = ?2 WHERE id = ?1",
        params![schedule.id, due],
    )
    .unwrap();
    claim_run(&conn, &schedule.id, "auto", Some(&due)).unwrap();
    assert!(claim_run(&conn, &schedule.id, "stale", Some(&due)).is_err());
    assert!(claim_run(&conn, &schedule.id, "manual", None).is_err());
    let capped = get(&conn, &schedule.id).unwrap().unwrap();
    assert_eq!(capped.runs_done, 1);
    assert!(!capped.enabled);
    assert!(capped.next_run_at.is_none());
    assert_eq!(list_runs(&conn, &schedule.id, 10).unwrap().len(), 1);
}

#[test]
fn manual_and_timer_claims_share_active_guard_without_counting_skips() {
    let conn = setup_test_db();
    let schedule = upsert(&conn, &daily_draft(None, true)).unwrap();
    let due = (chrono::Utc::now() - Duration::minutes(1)).to_rfc3339();
    conn.execute(
        "UPDATE schedules SET next_run_at = ?2 WHERE id = ?1",
        params![schedule.id, due],
    )
    .unwrap();
    claim_run(&conn, &schedule.id, "manual", None).unwrap();
    assert!(claim_run(&conn, &schedule.id, "timer", Some(&due)).is_err());
    assert!(claim_run(&conn, &schedule.id, "manual-again", None).is_err());
    let runs = list_runs(&conn, &schedule.id, 10).unwrap();
    assert_eq!(
        runs.iter()
            .filter(|r| r.status == ScheduleRunStatus::Running)
            .count(),
        1
    );
    assert_eq!(
        runs.iter()
            .filter(|r| r.status == ScheduleRunStatus::Skipped)
            .count(),
        1
    );
    let current = get(&conn, &schedule.id).unwrap().unwrap();
    assert_eq!(current.runs_done, 1);
    assert_ne!(current.next_run_at.as_deref(), Some(due.as_str()));
}

#[test]
fn deletion_cannot_outlive_an_active_claim_or_create_an_orphan() {
    let conn = setup_test_db();
    conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    let schedule = upsert(&conn, &daily_draft(None, true)).unwrap();
    claim_run(&conn, &schedule.id, "active", None).unwrap();
    assert!(delete(&conn, &schedule.id)
        .unwrap_err()
        .contains("仍在运行"));
    assert!(get(&conn, &schedule.id).unwrap().is_some());
    update_run(
        &conn,
        "active",
        None,
        ScheduleRunStatus::Ok,
        Some(&now_rfc3339()),
        None,
    )
    .unwrap();
    delete(&conn, &schedule.id).unwrap();
    assert!(claim_run(&conn, &schedule.id, "after-delete", None).is_err());
    assert!(list_runs(&conn, &schedule.id, 10).unwrap().is_empty());
}

#[test]
fn concurrent_manual_and_timer_dispatch_have_one_active_run() {
    use std::sync::{Arc, Barrier, Mutex};
    let conn = setup_test_db();
    let schedule = upsert(&conn, &daily_draft(None, true)).unwrap();
    let due = (chrono::Utc::now() - Duration::minutes(1)).to_rfc3339();
    conn.execute(
        "UPDATE schedules SET next_run_at = ?2 WHERE id = ?1",
        params![schedule.id, due],
    )
    .unwrap();
    // Same shared-connection lock as AppState, with both triggers released together.
    let db = Arc::new(Mutex::new(conn));
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = [false, true]
        .into_iter()
        .map(|automatic| {
            let db = Arc::clone(&db);
            let barrier = Arc::clone(&barrier);
            let id = schedule.id.clone();
            let due = due.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let db = db.lock().unwrap();
                claim_run(
                    &db,
                    &id,
                    if automatic { "timer" } else { "manual" },
                    if automatic { Some(due.as_str()) } else { None },
                )
                .is_ok()
            })
        })
        .collect();
    let claimed = handles
        .into_iter()
        .map(|h| h.join().unwrap())
        .filter(|ok| *ok)
        .count();
    assert_eq!(claimed, 1);
    let db = db.lock().unwrap();
    assert_eq!(get(&db, &schedule.id).unwrap().unwrap().runs_done, 1);
    assert_eq!(
        list_runs(&db, &schedule.id, 10)
            .unwrap()
            .iter()
            .filter(|r| r.status == ScheduleRunStatus::Running)
            .count(),
        1
    );
}

#[test]
fn active_one_shot_cannot_be_rescheduled_and_equivalent_instant_stays_completed() {
    let conn = setup_test_db();
    let future = chrono::Utc::now() + Duration::days(1);
    let mut draft = once_draft(&future.to_rfc3339(), true);
    let schedule = upsert(&conn, &draft).unwrap();
    claim_run(&conn, &schedule.id, "active", None).unwrap();
    draft.id = Some(schedule.id.clone());
    draft.cadence = ScheduleCadence::Once {
        at: (future + Duration::days(1)).to_rfc3339(),
    };
    assert!(upsert(&conn, &draft).unwrap_err().contains("仍在运行"));
    update_run(
        &conn,
        "active",
        None,
        ScheduleRunStatus::Ok,
        Some(&now_rfc3339()),
        None,
    )
    .unwrap();
    draft.cadence = ScheduleCadence::Once {
        at: future
            .with_timezone(&chrono::FixedOffset::east_opt(3600).unwrap())
            .to_rfc3339(),
    };
    draft.enabled = false;
    let unchanged = upsert(&conn, &draft).unwrap();
    assert_eq!(unchanged.lifecycle, ScheduleLifecycle::Completed);
    assert!(set_enabled(&conn, &schedule.id, true).is_err());
}

#[test]
fn stale_timer_snapshot_cannot_claim_after_pause_or_delete() {
    for deleted in [false, true] {
        let conn = setup_test_db();
        let schedule = upsert(&conn, &daily_draft(None, true)).unwrap();
        let due = (chrono::Utc::now() - Duration::minutes(1)).to_rfc3339();
        conn.execute(
            "UPDATE schedules SET next_run_at = ?2 WHERE id = ?1",
            params![schedule.id, due],
        )
        .unwrap();
        if deleted {
            delete(&conn, &schedule.id).unwrap();
        } else {
            set_enabled(&conn, &schedule.id, false).unwrap();
        }
        assert!(claim_run(&conn, &schedule.id, "stale-timer", Some(&due)).is_err());
        assert!(list_runs(&conn, &schedule.id, 10).unwrap().is_empty());
    }
}
