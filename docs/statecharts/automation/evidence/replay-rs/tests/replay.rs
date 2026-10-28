use automation_replay::backlog::store as backlog;
use automation_replay::contracts::*;
use automation_replay::prompts;
use automation_replay::schedules::store as sched;
use chrono::{Duration, Local, Utc};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

// Fixture DDL copied from src-tauri/src/schedules/tests.rs:227-266 (setup_test_db); backlog DDL is
// automation_replay::todos::store::test_conn (real, cfg(test) only in lib => re-declared below).
fn sched_db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c.execute_batch(
        "CREATE TABLE schedules(id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, cwd TEXT NOT NULL,
          run_mode TEXT NOT NULL DEFAULT 'local', cadence TEXT NOT NULL, model TEXT, thinking TEXT, approval_mode TEXT,
          enabled INTEGER NOT NULL DEFAULT 1, next_run_at TEXT, last_run_at TEXT, end_at TEXT,
          notify TEXT NOT NULL DEFAULT 'all', new_chat_each_run INTEGER NOT NULL DEFAULT 1, max_runs INTEGER,
          runs_done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
         CREATE TABLE schedule_runs(id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL,
          started_at TEXT NOT NULL, finished_at TEXT, summary TEXT,
          FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE);
         CREATE TABLE session_meta(session_id TEXT PRIMARY KEY, file_path TEXT);",
    )
    .unwrap();
    c
}

fn draft(id: Option<String>, cadence: ScheduleCadence, max_runs: Option<u32>) -> ScheduleDraft {
    ScheduleDraft {
        id,
        name: "nightly".into(),
        prompt: "p".into(),
        cwd: "/tmp".into(),
        run_mode: ScheduleRunMode::Local,
        cadence,
        model: None,
        thinking: None,
        approval_mode: None,
        notify: ScheduleNotify::All,
        new_chat_each_run: true,
        end_at: None,
        max_runs,
        enabled: true,
    }
}

/// S1 (CompletedNeverScheduled): replays runner::run_now's store calls (runner.rs:63-85) on a one-shot,
/// then the user's schedules_save with a new future instant (store::upsert), then schedules_list.
#[test]
fn repro_rescheduled_once_listed_completed_but_will_fire() {
    let c = sched_db();
    let at1 = (Local::now() + Duration::hours(1)).to_rfc3339();
    let s = sched::upsert(&c, &draft(None, ScheduleCadence::Once { at: at1 }, None)).unwrap();
    assert_eq!(s.lifecycle, ScheduleLifecycle::Active);
    // manual "立即运行" of the one-shot: create_run + record_run_start + advance_after_run
    sched::create_run(&c, "r1", &s.id, None, ScheduleRunStatus::Running, None).unwrap();
    sched::record_run_start(&c, &s.id, &sched::now_rfc3339()).unwrap();
    sched::advance_after_run(&c, &s, Local::now()).unwrap();
    sched::update_run(&c, "r1", None, ScheduleRunStatus::Ok, Some(&sched::now_rfc3339()), Some("ok")).unwrap();
    let done = sched::get(&c, &s.id).unwrap().unwrap();
    assert_eq!((done.enabled, done.lifecycle), (false, ScheduleLifecycle::Completed));
    // user edits the time to a new future instant (store.rs:464-499 allows it: "a reschedule, not a re-enable")
    let at2 = (Local::now() + Duration::hours(2)).to_rfc3339();
    sched::upsert(&c, &draft(Some(s.id.clone()), ScheduleCadence::Once { at: at2 }, None)).unwrap();
    let listed = sched::list(&c).unwrap().into_iter().find(|x| x.id == s.id).unwrap();
    let due = sched::find_due(&c, &(Local::now() + Duration::hours(3)).to_rfc3339()).unwrap();
    eprintln!(
        "S1 listed: enabled={} next_run_at={:?} lifecycle={:?}; scheduler find_due(+3h) picks it: {}",
        listed.enabled, listed.next_run_at, listed.lifecycle, due.iter().any(|x| x.id == s.id)
    );
    // Observed defect: backend will fire it, yet the list says Completed (UI disables its switch: ScheduleRow.tsx:254)
    assert!(listed.enabled && listed.next_run_at.is_some());
    assert!(due.iter().any(|x| x.id == s.id));
    assert_eq!(listed.lifecycle, ScheduleLifecycle::Completed);
}

/// S2 (RunsWithinCap) design question: runner::run_now calls record_run_start without checking the cap (runner.rs:74-79).
#[test]
fn observe_manual_runs_exceed_max_runs() {
    let c = sched_db();
    let s = sched::upsert(&c, &draft(None, ScheduleCadence::Interval { minutes: 60 }, Some(2))).unwrap();
    for i in 0..3 {
        sched::create_run(&c, &format!("m{i}"), &s.id, None, ScheduleRunStatus::Ok, None).unwrap();
        sched::record_run_start(&c, &s.id, &sched::now_rfc3339()).unwrap();
    }
    let after = sched::get(&c, &s.id).unwrap().unwrap();
    eprintln!("S2 runs_done={} max_runs={:?} enabled={} lifecycle={:?}", after.runs_done, after.max_runs, after.enabled, after.lifecycle);
    assert_eq!(after.runs_done, 3);
    assert_eq!(after.max_runs, Some(2));
}

fn backlog_db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    // Same columns as todos::store::test_conn (store.rs:347-354); that helper is cfg(test) inside the repo crate.
    c.execute_batch(
        "CREATE TABLE backlog(id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
          target_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, project_dir TEXT, deleted_at TEXT);",
    )
    .unwrap();
    c
}

/// B1 (RestoredStaysRestored): store::delete → store::restore → startup store::archive_finished (backlog/mod.rs:24).
#[test]
fn repro_restored_finished_idea_is_trashed_again_on_next_start() {
    let c = backlog_db();
    let it = backlog::add(&c, "old idea", BacklogKind::Idea, &[], None).unwrap();
    backlog::update(&c, &it.id, &BacklogPatch { status: Some(BacklogStatus::Done), ..Default::default() }).unwrap();
    // age the row's last edit to 40 days ago (fixture clock)
    let old = (Utc::now() - Duration::days(40)).to_rfc3339();
    c.execute("UPDATE backlog SET updated_at = ?2 WHERE id = ?1", params![it.id, old]).unwrap();
    backlog::delete(&c, &[it.id.clone()]).unwrap();
    backlog::restore(&c, &[it.id.clone()]).unwrap();
    let restored = backlog::get(&c, &it.id).unwrap().unwrap();
    assert!(restored.deleted_at.is_none());
    let moved = backlog::archive_finished(&c, Utc::now()).unwrap();
    let after = backlog::get(&c, &it.id).unwrap().unwrap();
    eprintln!("B1 archive_finished moved {moved}; deleted_at after restore+restart = {:?}", after.deleted_at);
    assert_eq!(moved, 1);
    assert!(after.deleted_at.is_some());
}

/// P1: prompts::render with the real backlog_dispatch.md template; item text that contains a template token.
#[test]
fn repro_render_reexpands_tokens_inside_user_text_nondeterministically() {
    let mut seen = HashSet::new();
    for _ in 0..300 {
        let mut vars: HashMap<&str, String> = HashMap::new();
        vars.insert("kind", "idea".into());
        vars.insert("text", "explain the literal token {{refs}} in docs".into());
        vars.insert("refs", "SECRET-REFS-BLOCK".into());
        seen.insert(prompts::render(prompts::BACKLOG_DISPATCH, &vars).contains("literal token SECRET-REFS-BLOCK"));
    }
    eprintln!("P1 distinct outcomes (token expanded?) = {:?}", seen);
    assert_eq!(seen.len(), 2, "same input yields both expanded and unexpanded prompts");
}
