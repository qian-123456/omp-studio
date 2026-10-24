//! Session status derivation (§11 A, §9 "Status/pending ownership").
//!
//! Two pure pieces:
//! - [`apply`] folds a live bus event into per-session runtime state and returns
//!   the persisted changes (pending / unread) it implies;
//! - [`derive`] maps runtime + persisted + transcript facts to (status, pending).

use serde_json::Value;

use super::parse::TailState;
use crate::contracts::{Attention, PendingKind, SessionStatus};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Phase {
    #[default]
    Settled,
    Working,
}

/// In-memory state of an app-owned RPC session (not persisted).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Runtime {
    pub live: bool,
    pub phase: Phase,
    /// Outstanding dialog requests: (request id, is tool approval).
    pub dialogs: Vec<(String, bool)>,
    /// `stopReason` of the latest assistant `message_end`.
    pub last_stop_reason: Option<String>,
}

impl Runtime {
    /// `Some(true)` if an approval dialog is open, `Some(false)` for other dialogs.
    pub fn dialog_kind(&self) -> Option<bool> {
        if self.dialogs.is_empty() {
            None
        } else {
            Some(self.dialogs.iter().any(|(_, approval)| *approval))
        }
    }

    fn dialog_pending(&self) -> Option<PendingKind> {
        self.dialog_kind().map(|approval| {
            if approval {
                PendingKind::Approval
            } else {
                PendingKind::Question
            }
        })
    }
}

/// Bus events relevant to status, decoupled from `AppEvent` for testing.
#[derive(Debug, Clone)]
pub enum LiveEvent {
    Frame(Value),
    Process {
        running: bool,
        exit_code: Option<i32>,
    },
    UiResponded {
        request_id: String,
    },
    PromptSent,
    Accepted,
}

/// Persisted changes implied by an event.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Change {
    /// `Some(new)` when `pending_kind` must be rewritten.
    pub pending: Option<Option<PendingKind>>,
    /// `Some(true)` marks unread.
    pub unread: Option<bool>,
    /// Runtime state changed (status may need recomputation).
    pub runtime: bool,
}

const DIALOG_METHODS: [&str; 4] = ["select", "confirm", "input", "editor"];

/// Fold one event into `rt`; `pending` is the currently persisted pending kind.
pub fn apply(rt: &mut Runtime, pending: Option<PendingKind>, ev: &LiveEvent) -> Change {
    let before = rt.clone();
    let mut new_pending = pending;
    let mut unread = None;
    match ev {
        LiveEvent::Frame(frame) => match frame.get("type").and_then(Value::as_str) {
            Some("agent_start") => {
                rt.live = true;
                rt.phase = Phase::Working;
                rt.last_stop_reason = None;
            }
            Some("message_end") => {
                if let Some(msg) = frame.get("message") {
                    if msg.get("role").and_then(Value::as_str) == Some("assistant") {
                        rt.last_stop_reason = msg
                            .get("stopReason")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                    }
                }
            }
            Some("extension_ui_request") => {
                let method = frame
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if DIALOG_METHODS.contains(&method) {
                    let id = str_field(frame, "id");
                    let title = frame
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    rt.live = true;
                    rt.dialogs.retain(|(d, _)| *d != id);
                    rt.dialogs.push((id, title.starts_with("Allow tool")));
                    new_pending = rt.dialog_pending();
                } else if method == "cancel" {
                    let target = ["targetId", "target", "requestId"]
                        .iter()
                        .find_map(|k| frame.get(*k).and_then(Value::as_str))
                        .unwrap_or_default()
                        .to_string();
                    rt.dialogs.retain(|(d, _)| *d != target);
                    new_pending = after_dialog_closed(rt, pending);
                }
            }
            Some("agent_end") if agent_end_settles(frame) => {
                let stop = last_assistant_stop(frame).or_else(|| rt.last_stop_reason.clone());
                rt.phase = Phase::Settled;
                rt.dialogs.clear();
                new_pending = Some(if stop.as_deref() == Some("error") {
                    PendingKind::Error
                } else {
                    PendingKind::Review
                });
                unread = Some(true);
            }
            _ => {}
        },
        LiveEvent::UiResponded { request_id } => {
            rt.dialogs.retain(|(d, _)| d != request_id);
            if rt.phase == Phase::Settled && rt.live {
                rt.phase = Phase::Working;
            }
            new_pending = after_dialog_closed(rt, pending);
        }
        LiveEvent::PromptSent => {
            if matches!(pending, Some(PendingKind::Review | PendingKind::Question)) {
                new_pending = rt.dialog_pending();
            }
        }
        LiveEvent::Process { running: true, .. } => {
            rt.live = true;
            // Resuming is the action that clears Interrupted / Error.
            if matches!(pending, Some(PendingKind::Interrupted | PendingKind::Error)) {
                new_pending = None;
            }
        }
        LiveEvent::Process {
            running: false,
            exit_code,
        } => {
            rt.live = false;
            rt.phase = Phase::Settled;
            rt.dialogs.clear();
            if matches!(exit_code, Some(c) if *c != 0) {
                new_pending = Some(PendingKind::Error);
            } else if matches!(pending, Some(PendingKind::Approval | PendingKind::Question)) {
                // The dialog died with the process.
                new_pending = None;
            }
        }
        LiveEvent::Accepted => {
            new_pending = None;
        }
    }
    Change {
        pending: (new_pending != pending).then_some(new_pending),
        unread,
        runtime: *rt != before,
    }
}

fn after_dialog_closed(rt: &Runtime, pending: Option<PendingKind>) -> Option<PendingKind> {
    match pending {
        Some(PendingKind::Approval | PendingKind::Question) => rt.dialog_pending(),
        other => other.or(rt.dialog_pending()),
    }
}

/// An `agent_end` that leaves the agent idle: a terminal end, or a non-terminal
/// one whose only possible resume is a background-job result
/// (`awaitingAsyncWork`; omp itself goes idle there). Any other
/// `isTerminal:false` end is a scheduled continuation and stays working.
/// `turn_end` frames carry no terminal flag and never settle a session.
pub fn agent_end_settles(frame: &Value) -> bool {
    frame.get("isTerminal").and_then(Value::as_bool) != Some(false)
        || frame.get("awaitingAsyncWork").and_then(Value::as_bool) == Some(true)
}

fn last_assistant_stop(frame: &Value) -> Option<String> {
    frame
        .get("messages")?
        .as_array()?
        .iter()
        .rev()
        .find(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))?
        .get("stopReason")?
        .as_str()
        .map(str::to_string)
}

fn str_field(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// Facts needed to derive a session's status.
#[derive(Debug, Clone, Default)]
pub struct DeriveInput {
    pub live: bool,
    pub runtime: Runtime,
    pub pending: Option<PendingKind>,
    pub suspended: bool,
    pub external: bool,
    pub tail: Option<TailState>,
    /// An accept happened after the tail's last message.
    pub tail_accepted: bool,
    /// Newer transcript activity happened after `pending_since`.
    pub pending_superseded: bool,
}

pub fn derive(i: &DeriveInput) -> (SessionStatus, Option<PendingKind>) {
    use PendingKind as P;
    use SessionStatus as S;
    if i.live {
        match i.runtime.dialog_kind() {
            Some(true) => return (S::AwaitingApproval, Some(P::Approval)),
            Some(false) => return (S::AwaitingAnswer, Some(P::Question)),
            None => {}
        }
        let settled = i.pending.filter(|p| matches!(p, P::Review | P::Error));
        if i.runtime.phase == Phase::Working {
            return (S::Working, settled);
        }
        return match settled {
            Some(P::Review) => (S::Review, settled),
            Some(P::Error) => (S::Error, settled),
            _ => (S::Idle, None),
        };
    }
    if i.external {
        return (
            S::External,
            i.pending.filter(|p| matches!(p, P::Review | P::Error)),
        );
    }
    match i.pending {
        Some(P::Review) => return (S::Review, Some(P::Review)),
        Some(P::Error) if !i.pending_superseded => return (S::Error, Some(P::Error)),
        _ => {}
    }
    if i.suspended {
        return (S::Suspended, None);
    }
    if !i.tail_accepted {
        match i.tail {
            Some(TailState::Interrupted) => return (S::Interrupted, Some(P::Interrupted)),
            Some(TailState::Error) => return (S::Error, Some(P::Error)),
            _ => {}
        }
    }
    (S::Idle, None)
}

/// Inbox attention kind (precedence awaiting > error > unread > running).
/// `error_since` is when the error/interrupted state began (pending_since,
/// falling back to the session's updated_at); an error stays attention-worthy
/// until the user viewed the session at or after that moment.
pub fn attention(
    status: SessionStatus,
    pending: Option<PendingKind>,
    unread: bool,
    last_seen_at: Option<&str>,
    error_since: &str,
) -> Option<Attention> {
    use SessionStatus as S;
    let ts = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok();
    match status {
        S::AwaitingApproval | S::AwaitingAnswer => return Some(Attention::Awaiting),
        S::Error | S::Interrupted => {
            let seen = match (last_seen_at.and_then(ts), ts(error_since)) {
                (Some(seen), Some(since)) => seen >= since,
                _ => false,
            };
            if !seen {
                return Some(Attention::Error);
            }
        }
        _ => {}
    }
    if unread || status == S::Review || pending == Some(PendingKind::Review) {
        return Some(Attention::Unread);
    }
    (status == S::Working).then_some(Attention::Running)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use PendingKind as P;
    use SessionStatus as S;

    #[test]
    fn attention_precedence_and_seen() {
        let t0 = "2026-01-01T00:00:00.000Z";
        let t1 = "2026-01-01T00:00:01.000Z";
        // Awaiting beats unread.
        assert_eq!(
            attention(S::AwaitingAnswer, Some(P::Question), true, None, t0),
            Some(Attention::Awaiting)
        );
        // Error until viewed at/after it started; unread still surfaces afterwards.
        assert_eq!(
            attention(S::Error, Some(P::Error), true, None, t0),
            Some(Attention::Error)
        );
        assert_eq!(
            attention(S::Interrupted, None, false, Some(t0), t1),
            Some(Attention::Error)
        );
        assert_eq!(
            attention(S::Error, Some(P::Error), false, Some(t1), t0),
            None
        );
        assert_eq!(attention(S::Error, None, false, Some(t0), t0), None);
        assert_eq!(
            attention(S::Error, None, true, Some(t1), t0),
            Some(Attention::Unread)
        );
        // Review or unread → Unread; unread beats running.
        assert_eq!(
            attention(S::Review, Some(P::Review), false, Some(t1), t0),
            Some(Attention::Unread)
        );
        assert_eq!(
            attention(S::Working, None, true, None, t0),
            Some(Attention::Unread)
        );
        assert_eq!(
            attention(S::Working, None, false, None, t0),
            Some(Attention::Running)
        );
        assert_eq!(attention(S::Idle, None, false, None, t0), None);
    }

    fn frame(v: Value) -> LiveEvent {
        LiveEvent::Frame(v)
    }

    fn live(rt: &Runtime, pending: Option<PendingKind>) -> (SessionStatus, Option<PendingKind>) {
        derive(&DeriveInput {
            live: rt.live,
            runtime: rt.clone(),
            pending,
            ..Default::default()
        })
    }

    /// Drive a sequence of events, tracking persisted pending/unread.
    fn run(events: &[LiveEvent]) -> (Runtime, Option<PendingKind>, bool) {
        let mut rt = Runtime::default();
        let mut pending = None;
        let mut unread = false;
        for ev in events {
            let c = apply(&mut rt, pending, ev);
            if let Some(p) = c.pending {
                pending = p;
            }
            if let Some(u) = c.unread {
                unread = u;
            }
        }
        (rt, pending, unread)
    }

    #[test]
    fn approval_flow() {
        let start = LiveEvent::Process {
            running: true,
            exit_code: None,
        };
        let req = frame(
            json!({"type":"extension_ui_request","id":"r1","method":"select","title":"Allow tool: bash\nCommand: ls","options":["Approve","Deny"]}),
        );
        let (rt, pending, _) = run(&[
            start.clone(),
            frame(json!({"type":"agent_start"})),
            req.clone(),
        ]);
        assert_eq!(live(&rt, pending), (S::AwaitingApproval, Some(P::Approval)));

        let responded = LiveEvent::UiResponded {
            request_id: "r1".into(),
        };
        let (rt, pending, _) = run(&[
            start.clone(),
            frame(json!({"type":"agent_start"})),
            req,
            responded,
        ]);
        assert_eq!(live(&rt, pending), (S::Working, None));

        let q =
            frame(json!({"type":"extension_ui_request","id":7,"method":"input","title":"Name?"}));
        let (rt, pending, _) = run(&[start.clone(), q.clone()]);
        assert_eq!(live(&rt, pending), (S::AwaitingAnswer, Some(P::Question)));
        let cancel =
            frame(json!({"type":"extension_ui_request","id":"c","method":"cancel","targetId":"7"}));
        let (rt, pending, _) = run(&[start, q, cancel]);
        assert_eq!(pending, None);
        assert!(rt.dialogs.is_empty());
    }

    #[test]
    fn awaiting_async_work_end_settles_and_wake_resumes() {
        let start = LiveEvent::Process {
            running: true,
            exit_code: None,
        };
        let begin = [start, frame(json!({"type":"agent_start"}))];
        // turn_end is never a session-level settle, whatever flags it carries.
        let (rt, pending, _) = run(&[
            begin.clone().to_vec(),
            vec![frame(json!({"type":"turn_end","isTerminal":true}))],
        ]
        .concat());
        assert_eq!(live(&rt, pending), (S::Working, None));
        // A scheduled continuation stays working.
        let (rt, pending, _) = run(&[
            begin.clone().to_vec(),
            vec![frame(
                json!({"type":"agent_end","isTerminal":false,"yielded":false}),
            )],
        ]
        .concat());
        assert_eq!(live(&rt, pending), (S::Working, None));
        // Idle until a background job wakes it: settled, then the wake resumes.
        let waiting = frame(
            json!({"type":"agent_end","isTerminal":false,"yielded":true,"awaitingAsyncWork":true}),
        );
        let (rt, pending, unread) = run(&[begin.clone().to_vec(), vec![waiting.clone()]].concat());
        assert_eq!(live(&rt, pending), (S::Review, Some(P::Review)));
        assert!(unread);
        let (rt, pending, _) = run(&[
            begin.to_vec(),
            vec![waiting, frame(json!({"type":"agent_start"}))],
        ]
        .concat());
        assert_eq!(live(&rt, pending), (S::Working, Some(P::Review)));
    }

    #[test]
    fn turn_end_review_and_error() {
        let start = LiveEvent::Process {
            running: true,
            exit_code: None,
        };
        let (rt, pending, unread) = run(&[
            start.clone(),
            frame(json!({"type":"agent_start"})),
            frame(json!({"type":"agent_end","isTerminal":false})),
        ]);
        assert_eq!(live(&rt, pending), (S::Working, None));
        assert!(!unread);

        let (rt, pending, unread) = run(&[
            start.clone(),
            frame(json!({"type":"agent_start"})),
            frame(json!({"type":"agent_end","messages":[]})),
        ]);
        assert_eq!(live(&rt, pending), (S::Review, Some(P::Review)));
        assert!(unread);

        let (rt, pending, _) = run(&[
            start.clone(),
            frame(json!({"type":"agent_start"})),
            frame(
                json!({"type":"message_end","message":{"role":"assistant","stopReason":"error"}}),
            ),
            frame(json!({"type":"agent_end","isTerminal":true})),
        ]);
        assert_eq!(live(&rt, pending), (S::Error, Some(P::Error)));

        // PromptSent clears Review; accept clears everything.
        let (rt, pending, _) = run(&[
            start.clone(),
            frame(json!({"type":"agent_end"})),
            LiveEvent::PromptSent,
        ]);
        assert_eq!(live(&rt, pending), (S::Idle, None));
        let (_, pending, _) = run(&[
            start,
            frame(json!({"type":"agent_end"})),
            LiveEvent::Accepted,
        ]);
        assert_eq!(pending, None);
    }

    #[test]
    fn process_exit_rules() {
        let start = LiveEvent::Process {
            running: true,
            exit_code: None,
        };
        let (_, pending, _) = run(&[
            start.clone(),
            frame(json!({"type":"agent_end"})),
            LiveEvent::Process {
                running: false,
                exit_code: Some(0),
            },
        ]);
        assert_eq!(pending, Some(P::Review));
        let (rt, pending, _) = run(&[
            start.clone(),
            frame(json!({"type":"agent_start"})),
            LiveEvent::Process {
                running: false,
                exit_code: Some(1),
            },
        ]);
        assert!(!rt.live);
        assert_eq!(pending, Some(P::Error));
        // Resuming clears Error.
        let (_, pending, _) = run(&[
            LiveEvent::Process {
                running: false,
                exit_code: Some(1),
            },
            start,
        ]);
        assert_eq!(pending, None);
    }

    #[test]
    fn non_live_derivation() {
        let base = DeriveInput::default();
        let d = |f: &dyn Fn(&mut DeriveInput)| {
            let mut i = base.clone();
            f(&mut i);
            derive(&i)
        };
        assert_eq!(d(&|_| {}), (S::Idle, None));
        assert_eq!(
            d(&|i| i.tail = Some(TailState::Interrupted)),
            (S::Interrupted, Some(P::Interrupted))
        );
        assert_eq!(
            d(&|i| {
                i.tail = Some(TailState::Interrupted);
                i.tail_accepted = true;
            }),
            (S::Idle, None)
        );
        assert_eq!(
            d(&|i| i.tail = Some(TailState::Error)),
            (S::Error, Some(P::Error))
        );
        assert_eq!(
            d(&|i| i.pending = Some(P::Review)),
            (S::Review, Some(P::Review))
        );
        assert_eq!(
            d(&|i| {
                i.pending = Some(P::Error);
                i.pending_superseded = true;
                i.tail = Some(TailState::Clean);
            }),
            (S::Idle, None)
        );
        assert_eq!(d(&|i| i.suspended = true), (S::Suspended, None));
        assert_eq!(
            d(&|i| {
                i.external = true;
                i.tail = Some(TailState::Interrupted);
            }),
            (S::External, None)
        );
        // Stale dialog pending from a dead process is ignored.
        assert_eq!(d(&|i| i.pending = Some(P::Approval)), (S::Idle, None));
    }
}
