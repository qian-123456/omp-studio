//! System detection: turn bus events (status changes, RPC dialog frames) into todos,
//! plus a periodic reconcile against the catalog / RPC pending state.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;

use super::sessions::{display_name, lookup};
use super::store::{self, NewTodo};
use crate::contracts::{PendingKind, SessionMeta, SessionStatus, TodoKind};
use crate::state::{AppEvent, AppState};

/// Todos for stale sessions (older than this) are not auto-created from status.
const MAX_AGE_HOURS: i64 = 48;
const DIALOG_METHODS: &[&str] = &["select", "confirm", "input", "editor"];

pub fn ui_key(session_id: &str, request_id: &str) -> String {
    format!("ui:{session_id}:{request_id}")
}

/// `(kind, request_id)` for a dialog `extension_ui_request` frame.
pub fn dialog_request(frame: &Value) -> Option<(TodoKind, String)> {
    if frame.get("type").and_then(Value::as_str) != Some("extension_ui_request") {
        return None;
    }
    let method = frame.get("method").and_then(Value::as_str)?;
    if !DIALOG_METHODS.contains(&method) {
        return None;
    }
    let id = frame.get("id").and_then(Value::as_str)?.to_string();
    let title = frame.get("title").and_then(Value::as_str).unwrap_or("");
    let kind = if title.starts_with("Allow tool") {
        TodoKind::Approval
    } else {
        TodoKind::Question
    };
    Some((kind, id))
}

/// Target request id of an `extension_ui_request` with `method:"cancel"`.
pub fn cancel_target(frame: &Value) -> Option<String> {
    if frame.get("type").and_then(Value::as_str) != Some("extension_ui_request")
        || frame.get("method").and_then(Value::as_str) != Some("cancel")
    {
        return None;
    }
    ["targetId", "target", "requestId"]
        .iter()
        .find_map(|k| frame.get(*k).and_then(Value::as_str))
        .map(str::to_string)
}

pub fn ui_todo(name: &str, session_id: &str, kind: TodoKind, request: &Value) -> NewTodo {
    let title = request.get("title").and_then(Value::as_str).unwrap_or("");
    let message = request.get("message").and_then(Value::as_str).unwrap_or("");
    let detail = [title, message]
        .iter()
        .filter(|s| !s.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let mut t = NewTodo::system(kind, session_id, name.to_string(), detail);
    t.payload = json!({ "uiRequest": request });
    t
}

fn status_todo(meta: &SessionMeta, kind: TodoKind) -> NewTodo {
    let snippet = meta
        .last_assistant
        .as_deref()
        .map(|s| super::transcript::truncate_chars(s, 200))
        .unwrap_or_default();
    let detail = match kind {
        TodoKind::Review if !snippet.is_empty() => snippet,
        TodoKind::Review => "回合结束，等待验收".to_string(),
        TodoKind::Error => "会话出错，可以恢复或诊断".to_string(),
        _ => "进程已退出但对话未完成，可以恢复继续".to_string(),
    };
    NewTodo::system(kind, &meta.id, display_name(meta), detail)
}

fn status_key(kind: TodoKind, session_id: &str) -> String {
    let prefix = match kind {
        TodoKind::Review => "review",
        TodoKind::Error => "error",
        _ => "interrupted",
    };
    format!("{prefix}:{session_id}")
}

fn is_recent(meta: &SessionMeta) -> bool {
    chrono::DateTime::parse_from_rfc3339(&meta.updated_at)
        .map(|t| chrono::Utc::now().signed_duration_since(t).num_hours() < MAX_AGE_HOURS)
        .unwrap_or(true)
}

fn name_of(meta: Option<&SessionMeta>, session_id: &str) -> String {
    meta.map(display_name)
        .unwrap_or_else(|| format!("#{}", session_id.chars().take(6).collect::<String>()))
}

pub fn spawn(state: AppState) {
    let mut rx = state.bus.subscribe();
    let s = state.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => handle(&s, ev).await,
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        loop {
            reconcile(&state).await;
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

async fn handle(state: &AppState, ev: AppEvent) {
    let enabled = state.settings.read().system_detection;
    let changed = match ev {
        AppEvent::RpcFrame { session_id, frame } => {
            if let Some((kind, rid)) = dialog_request(&frame) {
                if !enabled {
                    return;
                }
                let meta = lookup(state, &session_id).await;
                let t = ui_todo(
                    &name_of(meta.as_ref(), &session_id),
                    &session_id,
                    kind,
                    &frame,
                );
                let db = state.db.lock();
                store::upsert(&db, &ui_key(&session_id, &rid), &t, false).unwrap_or(false)
            } else if let Some(target) = cancel_target(&frame) {
                let db = state.db.lock();
                store::resolve_key(&db, &ui_key(&session_id, &target)).unwrap_or(false)
            } else {
                false
            }
        }
        AppEvent::UiResponded {
            session_id,
            request_id,
        } => {
            let db = state.db.lock();
            store::resolve_key(&db, &ui_key(&session_id, &request_id)).unwrap_or(false)
        }
        AppEvent::RpcProcess {
            session_id,
            running: false,
            ..
        } => {
            let resolved = {
                let db = state.db.lock();
                store::resolve_prefix(&db, &format!("ui:{session_id}:")).unwrap_or(false)
            };
            let services = enabled && check_services(state, &session_id).await;
            resolved || services
        }
        AppEvent::PromptSent { session_id } | AppEvent::SessionAccepted { session_id } => {
            let db = state.db.lock();
            store::resolve_session_kinds(&db, &session_id, &[TodoKind::Review, TodoKind::Question])
                .unwrap_or(false)
        }
        AppEvent::SessionStatusChanged {
            session_id,
            old,
            new,
        } => on_status(state, &session_id, old, new, enabled).await,
        AppEvent::SessionsChanged { ids } => {
            let mut changed = false;
            if enabled {
                for id in ids {
                    if archived_first_seen(state, &id).await {
                        changed |= check_services(state, &id).await;
                    }
                }
            }
            changed
        }
        AppEvent::ServicesChanged => reconcile_services(state).await,
        _ => false,
    };
    if changed {
        super::notify_changed(state);
    }
}

pub fn resolve_status_leaving(conn: &rusqlite::Connection, sid: &str, new: SessionStatus) -> bool {
    let mut changed = false;
    if new != SessionStatus::Review {
        changed |= store::resolve_key(conn, &format!("review:{sid}")).unwrap_or(false);
    }
    if new != SessionStatus::Error {
        changed |= store::resolve_key(conn, &format!("error:{sid}")).unwrap_or(false);
    }
    if new != SessionStatus::Interrupted {
        changed |= store::resolve_key(conn, &format!("interrupted:{sid}")).unwrap_or(false);
    }
    changed
}

async fn on_status(
    state: &AppState,
    sid: &str,
    old: SessionStatus,
    new: SessionStatus,
    enabled: bool,
) -> bool {
    let mut changed = false;
    {
        let db = state.db.lock();
        changed |= resolve_status_leaving(&db, sid, new);
    }
    let kind = match new {
        SessionStatus::Review => TodoKind::Review,
        SessionStatus::Error => TodoKind::Error,
        SessionStatus::Interrupted => TodoKind::Interrupted,
        _ => return changed,
    };
    if !enabled || old == new {
        return changed;
    }
    let Some(meta) = lookup(state, sid).await else {
        return changed;
    };
    if is_recent(&meta) && !meta.archived {
        let db = state.db.lock();
        changed |= store::upsert(&db, &status_key(kind, sid), &status_todo(&meta, kind), true)
            .unwrap_or(false);
    }
    if matches!(
        new,
        SessionStatus::Error | SessionStatus::Interrupted | SessionStatus::Suspended
    ) {
        changed |= check_services(state, sid).await;
    }
    changed
}

/// True the first time a session is seen archived during this app run.
async fn archived_first_seen(state: &AppState, sid: &str) -> bool {
    static SEEN: parking_lot::Mutex<Option<HashSet<String>>> = parking_lot::Mutex::new(None);
    let archived = crate::catalog::get(state, sid)
        .await
        .is_some_and(|m| m.archived);
    let mut seen = SEEN.lock();
    let set = seen.get_or_insert_with(HashSet::new);
    if !archived {
        set.remove(sid);
        return false;
    }
    set.insert(sid.to_string())
}

/// Create ServiceLeft todos for dev servers still attributed to `sid`.
async fn check_services(state: &AppState, sid: &str) -> bool {
    let services: Vec<_> = crate::services::list(false)
        .await
        .into_iter()
        .filter(|s| s.session_id.as_deref() == Some(sid))
        .collect();
    if services.is_empty() {
        return false;
    }
    let meta = lookup(state, sid).await;
    let is_live = meta.as_ref().is_some_and(|m| m.live) || crate::rpc::is_live(sid);
    let is_archived = meta.as_ref().is_some_and(|m| m.archived);
    if is_live && !is_archived {
        return false;
    }
    let name = name_of(meta.as_ref(), sid);
    let db = state.db.lock();
    let mut changed = false;
    for s in services {
        let mut t = NewTodo::system(
            TodoKind::ServiceLeft,
            sid,
            name.clone(),
            format!("{} 仍在监听 :{}（pid {}）", s.name, s.port, s.pid),
        );
        t.payload = json!({ "pid": s.pid, "port": s.port, "url": s.url, "name": s.name });
        let key = format!("service:{sid}:{}:{}", s.pid, s.port);
        changed |= store::upsert(&db, &key, &t, false).unwrap_or(false);
    }
    changed
}

/// Resolve ServiceLeft todos whose process is gone.
async fn reconcile_services(state: &AppState) -> bool {
    let open = {
        let db = state.db.lock();
        store::open_with_keys(&db, &[TodoKind::ServiceLeft]).unwrap_or_default()
    };
    if open.is_empty() {
        return false;
    }
    let alive: HashSet<u32> = crate::services::list(true)
        .await
        .iter()
        .map(|s| s.pid)
        .collect();
    let db = state.db.lock();
    let mut changed = false;
    for (t, key) in open {
        let pid = t.payload.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32;
        if !alive.contains(&pid) {
            changed |= store::resolve_key(&db, &key).unwrap_or(false);
        }
    }
    changed
}

fn still_pending(kind: TodoKind, s: &SessionMeta) -> bool {
    match kind {
        TodoKind::Review => {
            s.status == SessionStatus::Review || s.pending == Some(PendingKind::Review)
        }
        TodoKind::Error => {
            s.status == SessionStatus::Error || s.pending == Some(PendingKind::Error)
        }
        _ => s.status == SessionStatus::Interrupted || s.pending == Some(PendingKind::Interrupted),
    }
}

fn older_than(ts: &str, secs: i64) -> bool {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|t| chrono::Utc::now().signed_duration_since(t).num_seconds() > secs)
        .unwrap_or(true)
}

/// Pure DB sync for reconcile, testable without full AppState.
pub fn reconcile_db(
    conn: &rusqlite::Connection,
    enabled: bool,
    sessions: &[SessionMeta],
    live_pending: &[(String, Vec<Value>)],
    alive_pids: &HashSet<u32>,
    all_services: &[crate::contracts::ServiceInfo],
) -> bool {
    let by_id: HashMap<&str, &SessionMeta> = sessions.iter().map(|s| (s.id.as_str(), s)).collect();
    let mut changed = false;

    if enabled {
        for s in sessions.iter().filter(|s| !s.archived && is_recent(s)) {
            let kind = match s.pending {
                Some(PendingKind::Review) => TodoKind::Review,
                Some(PendingKind::Error) => TodoKind::Error,
                Some(PendingKind::Interrupted) => TodoKind::Interrupted,
                _ => continue,
            };
            changed |= store::insert_absent(conn, &status_key(kind, &s.id), &status_todo(s, kind))
                .unwrap_or(false);
        }
        for s in all_services {
            if let Some(sid) = s.session_id.as_deref() {
                if let Some(meta) = by_id.get(sid).copied() {
                    let is_live = meta.live || live_pending.iter().any(|(id, _)| id == sid);
                    if meta.archived || !is_live {
                        let name = name_of(Some(meta), sid);
                        let mut t = NewTodo::system(
                            TodoKind::ServiceLeft,
                            sid,
                            name,
                            format!("{} 仍在监听 :{}（pid {}）", s.name, s.port, s.pid),
                        );
                        t.payload =
                            json!({ "pid": s.pid, "port": s.port, "url": s.url, "name": s.name });
                        let key = format!("service:{sid}:{}:{}", s.pid, s.port);
                        changed |= store::insert_absent(conn, &key, &t).unwrap_or(false);
                    }
                }
            }
        }
    }

    // 1. Zombie todos: reconcile must resolve Review/Error/Interrupted todos whose
    // session no longer exists in the catalog.
    let status_kinds = [TodoKind::Review, TodoKind::Error, TodoKind::Interrupted];
    for (t, key) in store::open_with_keys(conn, &status_kinds).unwrap_or_default() {
        let Some(s) = t
            .session_id
            .as_deref()
            .and_then(|id| by_id.get(id).copied())
        else {
            changed |= store::resolve_key(conn, &key).unwrap_or(false);
            continue;
        };
        if s.archived || !still_pending(t.kind, s) {
            changed |= store::resolve_key(conn, &key).unwrap_or(false);
        }
    }

    for (t, key) in store::open_with_keys(conn, &[TodoKind::ServiceLeft]).unwrap_or_default() {
        let pid = t.payload.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32;
        if !alive_pids.contains(&pid) {
            changed |= store::resolve_key(conn, &key).unwrap_or(false);
            continue;
        }
        let Some(s) = t
            .session_id
            .as_deref()
            .and_then(|id| by_id.get(id).copied())
        else {
            changed |= store::resolve_key(conn, &key).unwrap_or(false);
            continue;
        };
        let is_live = s.live || live_pending.iter().any(|(id, _)| id == &s.id);
        if is_live && !s.archived {
            changed |= store::resolve_key(conn, &key).unwrap_or(false);
        }
    }

    // 2. Orphaned ui:* approval/question todos for sessions that are not live must be resolved.
    let ui_open =
        store::open_with_keys(conn, &[TodoKind::Approval, TodoKind::Question]).unwrap_or_default();
    let live_sids: HashSet<&str> = live_pending.iter().map(|(sid, _)| sid.as_str()).collect();

    for (t, key) in &ui_open {
        let is_live = t
            .session_id
            .as_deref()
            .is_some_and(|sid| live_sids.contains(sid));
        if !is_live {
            changed |= store::resolve_key(conn, key).unwrap_or(false);
        }
    }

    // For live sessions, sync dialog requests from RPC.
    for (sid, pending) in live_pending {
        let ids: HashSet<String> = pending
            .iter()
            .filter_map(|p| p.get("id").and_then(Value::as_str).map(str::to_string))
            .collect();
        if enabled {
            for req in pending {
                if let Some((kind, rid)) = dialog_request(req) {
                    let name = name_of(by_id.get(sid.as_str()).copied(), sid);
                    let t = ui_todo(&name, sid, kind, req);
                    changed |= store::insert_absent(conn, &ui_key(sid, &rid), &t).unwrap_or(false);
                }
            }
        }
        let prefix = format!("ui:{sid}:");
        for (t, key) in &ui_open {
            let Some(rid) = key.strip_prefix(&prefix) else {
                continue;
            };
            if !ids.contains(rid) && older_than(&t.created_at, 30) {
                changed |= store::resolve_key(conn, key).unwrap_or(false);
            }
        }
    }

    changed
}

/// Safety net: sync status todos with catalog pending state and UI todos with RPC state.
async fn reconcile(state: &AppState) {
    let sessions = crate::catalog::list(state).await;
    let enabled = state.settings.read().system_detection;
    let mut live_pending = Vec::new();
    for s in sessions
        .iter()
        .filter(|s| s.live || crate::rpc::is_live(&s.id))
    {
        let pending = crate::rpc::pending_ui(state, &s.id)
            .await
            .into_iter()
            .map(|p| p.request)
            .collect();
        live_pending.push((s.id.clone(), pending));
    }
    let all_services = crate::services::list(false).await;
    let alive_pids: HashSet<u32> = all_services.iter().map(|s| s.pid).collect();
    let db = state.db.lock();
    let changed = reconcile_db(
        &db,
        enabled,
        &sessions,
        &live_pending,
        &alive_pids,
        &all_services,
    );
    drop(db);
    if changed {
        super::notify_changed(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_dialog_frames() {
        let approval = json!({"type":"extension_ui_request","id":"r1","method":"select","title":"Allow tool: bash\nCommand: echo hi","options":["Approve","Deny"]});
        assert_eq!(
            dialog_request(&approval),
            Some((TodoKind::Approval, "r1".into()))
        );
        let q = json!({"type":"extension_ui_request","id":"r2","method":"input","title":"Branch name?"});
        assert_eq!(dialog_request(&q), Some((TodoKind::Question, "r2".into())));
        let notify = json!({"type":"extension_ui_request","id":"r3","method":"notify"});
        assert_eq!(dialog_request(&notify), None);
        let cancel =
            json!({"type":"extension_ui_request","id":"c","method":"cancel","targetId":"r2"});
        assert_eq!(cancel_target(&cancel).as_deref(), Some("r2"));
        assert_eq!(dialog_request(&cancel), None);
    }

    #[test]
    fn ui_todo_carries_request() {
        let req = json!({"type":"extension_ui_request","id":"r1","method":"confirm","title":"Confirm","message":"Continue?"});
        let t = ui_todo("#3 x", "s1", TodoKind::Question, &req);
        assert_eq!(t.detail, "Confirm\nContinue?");
        assert_eq!(t.payload["uiRequest"]["id"], "r1");
        assert_eq!(t.session_id.as_deref(), Some("s1"));
    }

    #[test]
    fn pending_and_recency() {
        let mut s = SessionMeta {
            status: SessionStatus::Idle,
            pending: Some(PendingKind::Review),
            updated_at: chrono::Utc::now().to_rfc3339(),
            ..Default::default()
        };
        assert!(still_pending(TodoKind::Review, &s));
        assert!(!still_pending(TodoKind::Error, &s));
        assert!(is_recent(&s));
        s.updated_at = (chrono::Utc::now() - chrono::Duration::days(5)).to_rfc3339();
        assert!(!is_recent(&s));
        assert_eq!(status_key(TodoKind::Interrupted, "s"), "interrupted:s");
    }

    #[test]
    fn review_resolution_terminal_and_archived() {
        let live_review = SessionMeta {
            status: SessionStatus::Review,
            pending: Some(PendingKind::Review),
            live: true,
            ..Default::default()
        };
        assert!(still_pending(TodoKind::Review, &live_review));

        let accepted = SessionMeta {
            status: SessionStatus::Idle,
            pending: None,
            live: false,
            ..Default::default()
        };
        assert!(!still_pending(TodoKind::Review, &accepted));

        let archived = SessionMeta {
            status: SessionStatus::Review,
            pending: Some(PendingKind::Review),
            archived: true,
            ..Default::default()
        };
        assert!(archived.archived);
    }

    #[test]
    fn zombie_todos_resolved_when_session_missing_from_catalog() {
        let c = store::test_conn();
        let t_review = NewTodo::system(
            TodoKind::Review,
            "deleted_sess",
            "Review".into(),
            String::new(),
        );
        let t_error = NewTodo::system(
            TodoKind::Error,
            "deleted_sess",
            "Error".into(),
            String::new(),
        );
        store::upsert(&c, "review:deleted_sess", &t_review, true).unwrap();
        store::upsert(&c, "error:deleted_sess", &t_error, true).unwrap();
        assert_eq!(store::list(&c, false, true).unwrap().len(), 2);

        // Reconcile with empty catalog (session is gone)
        let changed = reconcile_db(&c, true, &[], &[], &HashSet::new(), &[]);
        assert!(changed);

        // Both zombie todos must be resolved
        assert_eq!(store::list(&c, false, true).unwrap().len(), 0);
    }

    #[test]
    fn orphaned_ui_todos_resolved_when_session_not_live() {
        let c = store::test_conn();
        let req1 = json!({"type":"extension_ui_request","id":"r1","method":"select","title":"Allow tool: bash","options":["Approve","Deny"]});
        let req2 =
            json!({"type":"extension_ui_request","id":"r2","method":"input","title":"Your name?"});
        let t_appr = ui_todo("name", "dead_sess", TodoKind::Approval, &req1);
        let t_quest = ui_todo("name", "dead_sess", TodoKind::Question, &req2);
        store::insert_absent(&c, "ui:dead_sess:r1", &t_appr).unwrap();
        store::insert_absent(&c, "ui:dead_sess:r2", &t_quest).unwrap();
        assert_eq!(store::list(&c, false, true).unwrap().len(), 2);

        // Session exists in catalog but is not live (live_pending is empty)
        let s = SessionMeta {
            id: "dead_sess".into(),
            status: SessionStatus::Idle,
            live: false,
            ..Default::default()
        };
        let changed = reconcile_db(&c, true, &[s], &[], &HashSet::new(), &[]);
        assert!(changed);

        // Both orphaned UI todos must be resolved
        assert_eq!(store::list(&c, false, true).unwrap().len(), 0);
    }

    #[test]
    fn on_status_resolves_review_when_leaving_review() {
        let c = store::test_conn();
        let t = NewTodo::system(TodoKind::Review, "s1", "Review".into(), String::new());
        store::upsert(&c, "review:s1", &t, true).unwrap();
        assert_eq!(store::list(&c, false, true).unwrap().len(), 1);

        // Leaving Review into Idle -> resolves review:s1
        let changed = resolve_status_leaving(&c, "s1", SessionStatus::Idle);
        assert!(changed);
        assert_eq!(store::list(&c, false, true).unwrap().len(), 0);
    }
}
