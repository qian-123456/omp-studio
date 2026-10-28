use runtime_replay::catalog::external::{external_map, StatusFile};
use runtime_replay::catalog::status::*;
use runtime_replay::contracts::{PendingKind, SessionStatus};
use serde_json::json;
use std::collections::HashMap;

/// 与 catalog/tasks.rs:308-331 + catalog/mod.rs:497-512 相同的折叠: 事件 -> apply -> 持久化 pending -> derive。
fn step(rt: &mut Runtime, pending: &mut Option<PendingKind>, ev: LiveEvent, registry: bool) -> (SessionStatus, Option<PendingKind>) {
    let ch = apply(rt, *pending, &ev);
    if let Some(p) = ch.pending { *pending = p; }
    let (st, pd) = derive(&DeriveInput {
        live: rt.live || registry, runtime: rt.clone(), pending: *pending, ..Default::default()
    });
    *pending = pd;
    (st, pd)
}

#[test]
fn bug_late_frame_after_exit_resurrects_session() {
    let (mut rt, mut p) = (Runtime::default(), None);
    step(&mut rt, &mut p, LiveEvent::Process { running: true, exit_code: None }, true);
    step(&mut rt, &mut p, LiveEvent::Frame(json!({"type":"agent_start"})), true);
    let (st, _) = step(&mut rt, &mut p, LiveEvent::Process { running: false, exit_code: Some(0) }, false);
    assert_eq!(st, SessionStatus::Idle);
    // 遗留帧在退出事件之后才到达: 注册表已空
    let (st, _) = step(&mut rt, &mut p, LiveEvent::Frame(json!({"type":"agent_start"})), false);
    assert_eq!(st, SessionStatus::Working); // 没有进程, 却显示处理中
    assert!(rt.live);
}

#[test]
fn bug_respond_after_settle_flips_idle_session_to_working() {
    let (mut rt, mut p) = (Runtime::default(), None);
    step(&mut rt, &mut p, LiveEvent::Process { running: true, exit_code: None }, true);
    step(&mut rt, &mut p, LiveEvent::Frame(json!({"type":"agent_start"})), true);
    let (st, _) = step(&mut rt, &mut p, LiveEvent::Frame(json!({"type":"extension_ui_request","id":"r1","method":"confirm","title":"Allow tool bash?"})), true);
    assert_eq!(st, SessionStatus::AwaitingApproval);
    let (st, _) = step(&mut rt, &mut p, LiveEvent::Frame(json!({"type":"agent_end","isTerminal":true})), true);
    assert_eq!(st, SessionStatus::Review);
    // 用户回答仍保留的卡片 (ui_respond 发出 UiResponded)
    let (st, _) = step(&mut rt, &mut p, LiveEvent::UiResponded { request_id: "r1".into() }, true);
    assert_eq!(st, SessionStatus::Working); // 没有新的 agent_start, 进程空闲
}

#[test]
fn bug_status_file_with_reused_pid_pins_external() {
    let own_pid = 1u32;
    let reused_pid = std::process::id(); // 任何仍存活、与 omp 无关的进程
    let status = vec![StatusFile {
        session_id: "s".into(), session_file: "/sessions/s.jsonl".into(), pid: reused_pid, state: "working".into(),
    }];
    // omp 被 SIGKILL, 状态文件仍写着 working, 其 pid 已被别的进程复用
    let map = external_map(HashMap::new(), &status, runtime_replay::catalog::external::pid_alive, own_pid);
    assert_eq!(map.get("/sessions/s.jsonl"), Some(&reused_pid)); // 会话被判为外部占用
}
