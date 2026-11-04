//! Runtime-only attribution for work initiated by an authenticated mobile device.
//! An ambiguous session is deliberately forgotten rather than attributed by guesswork.
use crate::{
    contracts::{MobileDeviceWork, MobileDeviceWorkKind},
    rpc::SessionHandle,
    state::AppState,
};
use parking_lot::Mutex;
use serde_json::Value;
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, LazyLock},
};

tokio::task_local! { static ORIGIN: String; }

pub async fn with_origin<F: Future>(device_id: String, future: F) -> F::Output {
    ORIGIN.scope(device_id, future).await
}

pub(crate) fn origin() -> Option<String> {
    ORIGIN.try_with(Clone::clone).ok()
}

struct SessionWork {
    id: String,
    device: Option<String>,
    request_id: Option<String>,
    awaiting_settlement: bool,
    handle: Arc<SessionHandle>,
}
static SESSIONS: LazyLock<Mutex<HashMap<String, SessionWork>>> = LazyLock::new(Default::default);
fn sessions() -> &'static Mutex<HashMap<String, SessionWork>> {
    &SESSIONS
}

/// Called under the session dispatch lock after successfully enqueueing a command to stdin.
pub(crate) fn dispatched(handle: &Arc<SessionHandle>, command: &Value) {
    let ty = command.get("type").and_then(Value::as_str).unwrap_or("");
    if !matches!(
        ty,
        "prompt" | "steer" | "follow_up" | "abort_and_prompt" | "abort" | "abort_and_restore_queue"
    ) {
        return;
    }
    let session = handle.session_id.read().clone();
    let mut work = sessions().lock();
    // An additional prompt may be queued, or may replace the running turn. We
    // cannot abort it without also affecting the other turn, so forget both.
    let prior = work
        .remove(&session)
        .filter(|w| Arc::ptr_eq(&w.handle, handle));
    if matches!(ty, "prompt" | "steer" | "follow_up" | "abort_and_prompt") {
        let ambiguous = prior.is_some()
            || handle.streaming.load(std::sync::atomic::Ordering::SeqCst)
            || !handle.settled.load(std::sync::atomic::Ordering::SeqCst)
            || !handle.active_subagents.lock().is_empty();
        let device = if ambiguous { None } else { origin() };
        work.insert(
            session,
            SessionWork {
                id: uuid::Uuid::new_v4().to_string(),
                device,
                handle: handle.clone(),
                request_id: command.get("id").and_then(Value::as_str).map(str::to_owned),
                awaiting_settlement: false,
            },
        );
    }
}

pub(crate) fn frame(handle: &SessionHandle, frame: &Value) {
    let session = handle.session_id.read().clone();
    let mut work = sessions().lock();
    let Some(entry) = work.get_mut(&session) else {
        return;
    };
    if !std::ptr::eq(Arc::as_ptr(&entry.handle), handle) {
        return;
    }
    match frame.get("type").and_then(Value::as_str) {
        Some("response")
            if entry.request_id.as_deref() == frame.get("id").and_then(Value::as_str)
                && (frame.get("success").and_then(Value::as_bool) == Some(false)
                    || frame.pointer("/data/agentInvoked").and_then(Value::as_bool)
                        == Some(false)) =>
        {
            work.remove(&session);
        }
        Some("prompt_result")
            if entry.request_id.as_deref() == frame.get("id").and_then(Value::as_str) =>
        {
            if frame.get("sessionSettled").and_then(Value::as_bool) == Some(true) {
                work.remove(&session);
            } else {
                entry.awaiting_settlement = true;
            }
        }
        Some("session_settled") if entry.awaiting_settlement => {
            work.remove(&session);
        }
        _ => {}
    }
}

pub(crate) fn process_exited(handle: &SessionHandle) {
    let session = handle.session_id.read().clone();
    let mut work = sessions().lock();
    if work
        .get(&session)
        .is_some_and(|w| std::ptr::eq(Arc::as_ptr(&w.handle), handle))
    {
        work.remove(&session);
    }
}

pub async fn list(state: &AppState, device: &str) -> Vec<MobileDeviceWork> {
    let entries: Vec<_> = sessions()
        .lock()
        .iter()
        .filter(|(_, w)| {
            w.device.as_deref() == Some(device)
                && w.handle.alive.load(std::sync::atomic::Ordering::SeqCst)
        })
        .map(|(session, w)| (session.clone(), w.id.clone()))
        .collect();
    let mut result = Vec::new();
    for (session, id) in entries {
        let title = crate::catalog::get(state, &session)
            .await
            .map(|s| s.title)
            .filter(|s| !s.is_empty())
            .unwrap_or(session);
        result.push(MobileDeviceWork {
            id,
            kind: MobileDeviceWorkKind::Session,
            title,
        });
    }
    result.extend(super::api::misc::device_work(device));
    result
}

pub async fn cancel(_state: &AppState, device: &str, ids: &[String]) -> Result<(), String> {
    // The upstream abort command has no active-turn identity guard. Refuse
    // the entire selection before stopping any PTY rather than risk aborting
    // a newer turn or partially applying a mixed selection.
    let has_session = sessions()
        .lock()
        .values()
        .any(|w| w.device.as_deref() == Some(device) && ids.contains(&w.id));
    if has_session {
        return Err(
            "当前会话不支持安全地按任务停止，请先在电脑上停止该任务或选择让任务继续运行".into(),
        );
    }
    for id in ids {
        super::api::misc::cancel_device_work(device, id);
    }
    Ok(())
}

pub fn device_revoked(device: &str) {
    super::api::misc::preserve_device_work(device);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn handle() -> Arc<SessionHandle> {
        let h = Arc::new(SessionHandle::for_test());
        *h.session_id.write() = uuid::Uuid::new_v4().to_string();
        h
    }

    fn entry(h: &SessionHandle) -> Option<(String, Option<String>)> {
        sessions()
            .lock()
            .get(&*h.session_id.read())
            .map(|w| (w.id.clone(), w.device.clone()))
    }

    #[tokio::test]
    async fn only_initiated_work_is_attributed_and_old_ids_are_invalidated() {
        let h = handle();
        assert!(entry(&h).is_none());
        with_origin("phone-a".into(), async {
            dispatched(&h, &json!({"type":"prompt","id":"first"}));
        })
        .await;
        let (old, owner) = entry(&h).unwrap();
        assert_eq!(owner.as_deref(), Some("phone-a"));
        dispatched(&h, &json!({"type":"prompt","id":"desktop"}));
        let (replacement, owner) = entry(&h).unwrap();
        assert_ne!(replacement, old);
        assert_eq!(owner, None);
        frame(
            &h,
            &json!({"type":"prompt_result","id":"first","sessionSettled":true}),
        );
        assert_eq!(entry(&h).unwrap().0, replacement);
        frame(
            &h,
            &json!({"type":"prompt_result","id":"desktop","sessionSettled":true}),
        );
        assert!(entry(&h).is_none());
    }

    #[tokio::test]
    async fn completion_and_process_replacement_do_not_clear_new_work() {
        let h = handle();
        with_origin("phone-a".into(), async {
            dispatched(&h, &json!({"type":"prompt","id":"one"}));
        })
        .await;
        frame(
            &h,
            &json!({"type":"prompt_result","id":"one","sessionSettled":false}),
        );
        assert!(entry(&h).is_some());
        frame(&h, &json!({"type":"session_settled"}));
        assert!(entry(&h).is_none());
        with_origin("phone-b".into(), async {
            dispatched(&h, &json!({"type":"prompt","id":"two"}));
        })
        .await;
        let newer = entry(&h).unwrap();
        let old_handle = handle();
        *old_handle.session_id.write() = h.session_id.read().clone();
        process_exited(&old_handle);
        assert_eq!(entry(&h).unwrap(), newer);
        process_exited(&h);
        assert!(entry(&h).is_none());
    }
}
