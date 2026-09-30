//! Unit tests for pure next_run and schedules store CRUD.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use rusqlite::Connection;

use crate::contracts::{ScheduleCadence, ScheduleDraft, ScheduleRunMode, ScheduleRunStatus};
use crate::schedules::store::{
    create_run, delete, get, has_active_run, list, list_runs, next_run, set_enabled, update_run,
    upsert,
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
    assert_eq!(n1, after + Duration::minutes(15));

    // Below minimum of 5 minutes: clamped to 5 minutes
    let c2 = ScheduleCadence::Interval { minutes: 2 };
    let n2 = next_run(&c2, after);
    assert_eq!(n2, after + Duration::minutes(5));
}

#[test]
fn test_next_run_daily_same_day() {
    // 08:30 on Oct 1
    let after = make_local(2026, 10, 1, 8, 30);
    let c = ScheduleCadence::Daily {
        time: "09:00".to_string(),
        weekdays: vec![],
    };
    let n = next_run(&c, after);
    let expected = make_local(2026, 10, 1, 9, 0);
    assert_eq!(n, expected);
}

#[test]
fn test_next_run_daily_crossing_midnight() {
    // 10:15 on Oct 1, target 09:00 -> should run on Oct 2 at 09:00
    let after = make_local(2026, 10, 1, 10, 15);
    let c = ScheduleCadence::Daily {
        time: "09:00".to_string(),
        weekdays: vec![],
    };
    let n = next_run(&c, after);
    let expected = make_local(2026, 10, 2, 9, 0);
    assert_eq!(n, expected);
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
    };

    let n = next_run(&c, friday);
    // Should be next Monday (2026-10-05) at 09:00
    let expected_monday = make_local(2026, 10, 5, 9, 0);
    assert_eq!(expected_monday.weekday().num_days_from_sunday(), 1); // 1 = Monday
    assert_eq!(n, expected_monday);
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
    };

    let n = next_run(&c, sunday);
    // Target time 09:00 on Sunday has passed, so next weekend run is Saturday 2026-10-10 at 09:00
    let expected_saturday = make_local(2026, 10, 10, 9, 0);
    assert_eq!(expected_saturday.weekday().num_days_from_sunday(), 6);
    assert_eq!(n, expected_saturday);
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
         CREATE INDEX idx_schedule_runs_schedule_id ON schedule_runs(schedule_id, started_at DESC);",
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
        },
        model: Some("claude-3-5-sonnet".to_string()),
        thinking: None,
        approval_mode: Some("write".to_string()),
        enabled: true,
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
