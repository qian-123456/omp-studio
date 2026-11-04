//! Mobile API: right-panel pages other than explorer/git — side chat, todos,
//! plan, subagents, services, terminal. Reuses the desktop module logic
//! (`rpc::sidechat`, `todos`, `services`, `terminal::pty`, `rpc::subagents`).
//!
//! ## Routes
//! Side chat (continue a side chat with the existing
//! `POST /sessions/{childId}/prompt`; stream replies via the global
//! `GET /events` SSE and `GET /sessions/{childId}/transcript`):
//! - `GET  /sessions/{id}/sidechats` → `SessionMeta[]` whose `parentId == id`.
//! - `POST /sessions/{id}/sidechats` `{question, selection?, model?}`
//!   → `LiveSessionInfo` (`sessionId` of the new child; 400 empty question).
//!
//! Todos (list/act already exist as `GET /todos`, `POST /todos/{id}/act`):
//! - `GET /todos/all` → `Todo[]` including closed ones.
//! - `GET /todos/counts` → `TodoCounts`.
//!
//! Plan (data source of the desktop `PlanPanel`: latest assistant text):
//! - `GET /sessions/{id}/plan` → `{text: string|null, streaming: boolean}`.
//!   Plan-mode on/off is client state (not exposed by the backend).
//!
//! Subagents (draft ids answer `[]` / 404 agent):
//! - `GET  /sessions/{id}/subagents` → `SubagentSummary[]` (empty if no file).
//! - `GET  /sessions/{id}/subagents/{agentId}?fromByte=` → `SubagentTranscript`.
//!
//! Services (the desktop panel only lists/stops; there is no start or log
//! capture backend, so none is exposed):
//! - `GET  /services?all=false` → `ServiceInfo[]`.
//! - `POST /services/{pid}/stop` → `{ok: true}`.
//!
//! Terminal (PTY in the session's cwd; at most 4 open at once, 429 beyond):
//! - `POST /terminal` `{sessionId, cols?, rows?}` → `{termId, cwd}`.
//! - `GET  /terminal/{termId}/stream` — SSE. Replays the last ≤256 KiB of
//!   output, then live: `event: data` (base64 bytes), `event: exit`
//!   (`{"code": n|null}`, stream then ends). Closing the stream starts a 60 s
//!   grace; if nobody re-attaches, the PTY is killed.
//! - `POST /terminal/{termId}/input` `{data}` (utf-8 text) → `{ok: true}`.
//! - `POST /terminal/{termId}/resize` `{cols, rows}` → `{ok: true}`.
//! - `DELETE /terminal/{termId}` → `{ok: true}` (kills the PTY; idempotent).

use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use base64::Engine as _;
use futures_util::stream::{self, Stream};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{broadcast, watch};

use crate::mobile::auth;
use crate::mobile::backend::Backend;
use crate::mobile::server::{ApiError, Ctx};
use crate::state::AppState;
use crate::terminal::pty::{self, TermEvent};

type ApiResult<T> = Result<Json<T>, ApiError>;

const MAX_TERMINALS: usize = 4;
const BACKLOG_CAP: usize = 256 * 1024;
const DETACH_GRACE: Duration = Duration::from_secs(60);

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new()
        .route(
            "/sessions/{id}/sidechats",
            get(sidechats::<B>).post(sidechat_create::<B>),
        )
        .route("/todos/all", get(todos_all::<B>))
        .route("/todos/counts", get(todos_counts::<B>))
        .route("/sessions/{id}/plan", get(plan::<B>))
        .route("/sessions/{id}/subagents", get(subagents::<B>))
        .route(
            "/sessions/{id}/subagents/{agent}",
            get(subagent_transcript::<B>),
        )
        .route("/services", get(services_list))
        .route("/services/{pid}/stop", post(services_stop))
        .route("/terminal", post(term_open::<B>))
        .route("/terminal/{id}/stream", get(term_stream::<B>))
        .route("/terminal/{id}/input", post(term_input))
        .route("/terminal/{id}/resize", post(term_resize))
        .route("/terminal/{id}", delete(term_close))
}

fn app<B: Backend>(ctx: &Ctx<B>) -> Result<&AppState, ApiError> {
    ctx.backend.app_state().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "应用状态不可用".into(),
    ))
}

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

fn gateway(e: impl ToString) -> ApiError {
    ApiError(StatusCode::BAD_GATEWAY, e.to_string())
}

fn to_json<T: serde::Serialize>(v: T) -> ApiResult<Value> {
    serde_json::to_value(v).map(Json).map_err(gateway)
}

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

fn valid_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || id.contains("..")
    {
        return Err(bad("非法标识符"));
    }
    Ok(())
}

// ---- side chat ----

async fn sidechats<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    valid_id(&id)?;
    let rows: Vec<_> = ctx
        .backend
        .sessions()
        .await
        .into_iter()
        .filter(|m| {
            m.parent_id.as_deref() == Some(id.as_str()) && m.kind.as_deref() == Some("side")
        })
        .collect();
    to_json(rows)
}

#[derive(Deserialize)]
struct SideChatBody {
    #[serde(default)]
    question: String,
    selection: Option<String>,
    model: Option<String>,
    #[serde(default, rename = "imagePaths")]
    image_paths: Vec<String>,
}

async fn sidechat_create<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<SideChatBody>,
) -> ApiResult<Value> {
    valid_id(&id)?;
    let state = app(&ctx)?;
    if body.question.trim().is_empty() && body.image_paths.is_empty() {
        return Err(bad("问题不能为空"));
    }
    if super::draft::is_draft(&id) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "新会话还没有内容，请先发送第一条消息".into(),
        ));
    }
    if ctx.backend.session(&id).await.is_none() {
        return Err(ApiError(StatusCode::NOT_FOUND, "会话不存在".into()));
    }
    let image_paths = super::chat::uploaded_image_paths(state, &id, body.image_paths).await?;
    let question = if body.question.trim().is_empty() {
        "（图片）".to_string()
    } else {
        body.question
    };
    let info = crate::rpc::sidechat::create(state, &id, body.model)
        .await
        .map_err(gateway)?;
    crate::rpc::sidechat::ask(
        state,
        &info.session_id,
        question,
        body.selection,
        None,
        Some(image_paths),
    )
    .await
    .map_err(gateway)?;
    to_json(info)
}

// ---- todos ----

async fn todos_all<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> ApiResult<Value> {
    let state = app(&ctx)?;
    to_json(crate::todos::list(state, true).await)
}

async fn todos_counts<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> ApiResult<Value> {
    let state = app(&ctx)?;
    to_json(crate::todos::counts(state).await)
}

// ---- plan ----

/// Legacy fallback only when the session has never published a plan state.
fn latest_assistant_text(items: &[crate::contracts::TranscriptItem]) -> Option<String> {
    items
        .iter()
        .rev()
        .find(|it| {
            it.kind == crate::contracts::TranscriptKind::Assistant
                && it.text.as_deref().is_some_and(|t| !t.trim().is_empty())
        })
        .and_then(|it| it.text.clone())
}

fn plan_text(status: Option<&Value>, fallback: Option<String>) -> Option<String> {
    match status {
        Some(status) => status
            .pointer("/approved/content")
            .and_then(Value::as_str)
            .or_else(|| status.get("content").and_then(Value::as_str))
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        None => fallback,
    }
}

async fn plan<B: Backend>(
    State(_ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    valid_id(&id)?;
    if super::draft::is_draft(&id) {
        return Ok(Json(
            json!({ "text": null, "streaming": false, "planStatus": null }),
        ));
    }
    let Some(file) = crate::catalog::file_of(&id) else {
        return Err(ApiError(StatusCode::NOT_FOUND, "会话不存在".into()));
    };
    let streaming = crate::rpc::get_handle(&id)
        .is_some_and(|h| h.streaming.load(std::sync::atomic::Ordering::SeqCst));
    let status = super::chat::plan_status(&id, &file.to_string_lossy()).await?;
    let fallback = if status.is_none() {
        let id2 = id.clone();
        tokio::task::spawn_blocking(move || {
            if !file.exists() {
                return Ok(None);
            }
            crate::catalog::transcript::read_page(&file, &id2, 0, None)
                .map(|p| latest_assistant_text(&p.items))
        })
        .await
        .map_err(gateway)?
        .map_err(gateway)?
    } else {
        None
    };
    let text = plan_text(status.as_ref(), fallback);
    Ok(Json(
        json!({ "text": text, "streaming": streaming, "planStatus": status }),
    ))
}

// ---- subagents ----

async fn session_file<B: Backend>(ctx: &Ctx<B>, id: &str) -> Result<String, ApiError> {
    valid_id(id)?;
    super::draft::find_session(&ctx.backend, id)
        .await
        .map(|m| m.file)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))
}

async fn subagents<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let file = session_file(&ctx, &id).await?;
    if super::draft::is_draft(&id) {
        return Ok(Json(json!([])));
    }
    to_json(crate::rpc::subagents::list(&file).map_err(gateway)?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FromByte {
    from_byte: Option<u64>,
}

async fn subagent_transcript<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path((id, agent)): Path<(String, String)>,
    Query(q): Query<FromByte>,
) -> ApiResult<Value> {
    let file = session_file(&ctx, &id).await?;
    if super::draft::is_draft(&id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "子代理不存在".into()));
    }
    to_json(crate::rpc::subagents::transcript(&file, &agent, q.from_byte).map_err(gateway)?)
}

// ---- services ----

#[derive(Deserialize)]
struct AllQuery {
    #[serde(default)]
    all: bool,
}

async fn services_list(Query(q): Query<AllQuery>) -> ApiResult<Value> {
    to_json(crate::services::list(q.all).await)
}

async fn services_stop(Path(pid): Path<u32>) -> ApiResult<Value> {
    crate::services::stop(pid).await.map_err(gateway)?;
    Ok(ok())
}

// ---- terminal ----

enum Out {
    Data(Vec<u8>),
    Exit(Option<i32>),
}

struct Backlog {
    buf: VecDeque<u8>,
    exit: Option<Option<i32>>,
}

/// One PTY exposed over HTTP. Output goes through `backlog` (replay for late
/// subscribers) and `tx` (live); both updated under the backlog lock so a
/// subscriber never misses or duplicates a chunk.
struct TermEntry {
    backlog: Mutex<Backlog>,
    tx: broadcast::Sender<Arc<Out>>,
    subs: AtomicUsize,
    closed: AtomicBool,
    pty_id: Mutex<Option<String>>,
    owner: Option<String>,
    title: String,
    preserve_on_detach: AtomicBool,
}

impl TermEntry {
    fn push(&self, ev: TermEvent) {
        let mut b = self.backlog.lock();
        let out = match ev {
            TermEvent::Data(d) => {
                b.buf.extend(d.iter().copied());
                let over = b.buf.len().saturating_sub(BACKLOG_CAP);
                b.buf.drain(..over);
                Out::Data(d)
            }
            TermEvent::Exit(code) => {
                b.exit = Some(code);
                Out::Exit(code)
            }
        };
        let _ = self.tx.send(Arc::new(out));
    }

    fn shutdown(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(id) = self.pty_id.lock().take() {
            pty::close(&id);
        }
    }
}

fn terms() -> &'static Mutex<HashMap<String, Arc<TermEntry>>> {
    // OnceLock, not LazyLock: crate MSRV is 1.77 (LazyLock needs 1.80).
    static REG: OnceLock<Mutex<HashMap<String, Arc<TermEntry>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_term(id: &str) -> Result<Arc<TermEntry>, ApiError> {
    terms()
        .lock()
        .get(id)
        .cloned()
        .ok_or(ApiError(StatusCode::NOT_FOUND, "终端不存在或已关闭".into()))
}

fn remove_term(id: &str) {
    if let Some(e) = terms().lock().remove(id) {
        e.shutdown();
    }
}

/// Kill + forget `id` after `grace` unless someone is attached by then.
fn reap_if_unattached(id: String, entry: Arc<TermEntry>, grace: Duration) {
    tokio::spawn(async move {
        tokio::time::sleep(grace).await;
        reap_unattached_now(&id, &entry);
    });
}

fn reap_unattached_now(id: &str, entry: &TermEntry) {
    let removed = {
        let mut registry = terms().lock();
        if entry.subs.load(Ordering::SeqCst) == 0
            && !entry.preserve_on_detach.load(Ordering::SeqCst)
            && registry
                .get(id)
                .is_some_and(|current| std::ptr::eq(Arc::as_ptr(current), entry))
        {
            registry.remove(id)
        } else {
            None
        }
    };
    if let Some(entry) = removed {
        entry.shutdown();
    }
}

/// Open a PTY at `cwd` (argv empty → agent-aware login shell) and register it.
fn open_term(
    cwd: &str,
    argv: Vec<String>,
    cols: u16,
    rows: u16,
    grace: Duration,
    session_file: Option<&str>,
    owner: Option<String>,
) -> Result<String, ApiError> {
    if terms().lock().len() >= MAX_TERMINALS {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            format!("最多同时打开 {MAX_TERMINALS} 个终端"),
        ));
    }
    let (argv, extra_env) =
        crate::terminal::shell_init::drawer_spawn(&argv, session_file).unwrap_or((argv, vec![]));
    let (tx, _) = broadcast::channel(512);
    let entry = Arc::new(TermEntry {
        backlog: Mutex::new(Backlog {
            buf: VecDeque::new(),
            exit: None,
        }),
        tx,
        subs: AtomicUsize::new(0),
        closed: AtomicBool::new(false),
        pty_id: Mutex::new(None),
        owner,
        title: cwd.to_string(),
        preserve_on_detach: AtomicBool::new(false),
    });
    let sink_entry = entry.clone();
    let sink: pty::Sink = Arc::new(move |_id: &str, ev| sink_entry.push(ev));
    let pty_id = pty::open(cwd, &argv, cols, rows, sink, &extra_env)
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?;
    *entry.pty_id.lock() = Some(pty_id);
    let id = uuid::Uuid::new_v4().to_string();
    terms().lock().insert(id.clone(), entry.clone());
    reap_if_unattached(id.clone(), entry, grace);
    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TermOpenBody {
    session_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

async fn term_open<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Extension(auth::Token(token)): Extension<auth::Token>,
    Json(body): Json<TermOpenBody>,
) -> ApiResult<Value> {
    valid_id(&body.session_id)?;
    let meta = super::draft::find_session(&ctx.backend, &body.session_id)
        .await
        .ok_or(ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
    let cwd = meta.cwd;
    let session_file = meta.file;
    let (cols, rows) = (body.cols.unwrap_or(80), body.rows.unwrap_or(24));
    let owner = auth::device_id_for_token(&ctx.db.lock(), &token)
        .ok_or(ApiError(StatusCode::UNAUTHORIZED, "设备已移除".into()))?;
    let cwd2 = cwd.clone();
    let id = tokio::task::spawn_blocking(move || {
        open_term(
            &cwd2,
            vec![],
            cols,
            rows,
            DETACH_GRACE,
            Some(&session_file),
            Some(owner),
        )
    })
    .await
    .map_err(gateway)??;
    if !auth::is_valid(&ctx.db.lock(), &token) {
        if let Ok(entry) = get_term(&id) {
            entry.preserve_on_detach.store(true, Ordering::SeqCst);
        }
        return Err(ApiError(StatusCode::UNAUTHORIZED, "设备已移除".into()));
    }
    Ok(Json(json!({ "termId": id, "cwd": cwd })))
}

/// Detaching (stream dropped) starts the grace timer.
struct Attach {
    id: String,
    entry: Arc<TermEntry>,
}

impl Drop for Attach {
    fn drop(&mut self) {
        if self.entry.subs.fetch_sub(1, Ordering::SeqCst) == 1 {
            reap_if_unattached(self.id.clone(), self.entry.clone(), DETACH_GRACE);
        }
    }
}

fn sse_out(out: &Out) -> Event {
    match out {
        Out::Data(d) => Event::default()
            .event("data")
            .data(base64::engine::general_purpose::STANDARD.encode(d)),
        Out::Exit(code) => Event::default()
            .event("exit")
            .data(json!({ "code": code }).to_string()),
    }
}

type TermStream = stream::BoxStream<'static, Result<Event, Infallible>>;

fn attach_stream(id: String, entry: Arc<TermEntry>, shutdown: watch::Receiver<bool>) -> TermStream {
    use futures_util::StreamExt as _;
    // Subscribe and snapshot under the backlog lock (see `TermEntry`).
    entry.subs.fetch_add(1, Ordering::SeqCst);
    let (rx, replay, exit) = {
        let b = entry.backlog.lock();
        let replay: Vec<u8> = b.buf.iter().copied().collect();
        (entry.tx.subscribe(), replay, b.exit)
    };
    let guard = Attach { id, entry };
    let mut head: Vec<Event> = Vec::new();
    if !replay.is_empty() {
        head.push(sse_out(&Out::Data(replay)));
    }
    if let Some(code) = exit {
        head.push(sse_out(&Out::Exit(code)));
        // Drop `rx` and the guard: nothing more will arrive.
        return stream::iter(head.into_iter().map(Ok)).boxed();
    }
    let live = stream::unfold(
        (rx, shutdown, guard, false),
        |(mut rx, mut sd, guard, done)| async move {
            if done || *sd.borrow() {
                return None;
            }
            loop {
                tokio::select! {
                    _ = sd.changed() => {
                        if *sd.borrow() { return None; }
                    }
                    r = rx.recv() => match r {
                        Ok(out) => {
                            let last = matches!(*out, Out::Exit(_));
                            return Some((Ok(sse_out(&out)), (rx, sd, guard, last)));
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => return None,
                    }
                }
            }
        },
    );
    stream::iter(head.into_iter().map(Ok)).chain(live).boxed()
}

async fn term_stream<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Extension(auth::Token(token)): Extension<auth::Token>,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    use futures_util::StreamExt as _;
    let mut revoked = auth::subscribe_revocations();
    let hash = auth::hash_token(&token);
    if !auth::is_valid(&ctx.db.lock(), &token) {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "设备已移除".into()));
    }
    let entry = get_term(&id)?;
    let db = ctx.db.clone();
    let invalidated = async move {
        loop {
            match revoked.recv().await {
                Ok(id) if id == hash => break,
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    if !auth::is_valid(&db.lock(), &token) {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    let s = attach_stream(id, entry, ctx.shutdown.clone()).take_until(invalidated);
    Ok(Sse::new(s).keep_alive(KeepAlive::default()))
}

#[derive(Deserialize)]
struct InputBody {
    data: String,
}

async fn term_input(Path(id): Path<String>, Json(body): Json<InputBody>) -> ApiResult<Value> {
    let entry = get_term(&id)?;
    let pty_id = entry.pty_id.lock().clone();
    let Some(pty_id) = pty_id else {
        return Err(ApiError(StatusCode::GONE, "终端已关闭".into()));
    };
    pty::write(&pty_id, body.data.as_bytes()).map_err(|e| ApiError(StatusCode::GONE, e))?;
    Ok(ok())
}

#[derive(Deserialize)]
struct ResizeBody {
    cols: u16,
    rows: u16,
}

async fn term_resize(Path(id): Path<String>, Json(body): Json<ResizeBody>) -> ApiResult<Value> {
    let entry = get_term(&id)?;
    let pty_id = entry.pty_id.lock().clone();
    let Some(pty_id) = pty_id else {
        return Err(ApiError(StatusCode::GONE, "终端已关闭".into()));
    };
    pty::resize(&pty_id, body.cols, body.rows).map_err(|e| ApiError(StatusCode::GONE, e))?;
    Ok(ok())
}

async fn term_close(Path(id): Path<String>) -> ApiResult<Value> {
    remove_term(&id);
    Ok(ok())
}

pub(crate) fn device_work(device: &str) -> Vec<crate::contracts::MobileDeviceWork> {
    terms()
        .lock()
        .iter()
        .filter(|(_, entry)| {
            entry.owner.as_deref() == Some(device)
                && !entry.closed.load(Ordering::SeqCst)
                && entry.backlog.lock().exit.is_none()
        })
        .map(|(id, entry)| crate::contracts::MobileDeviceWork {
            id: id.clone(),
            kind: crate::contracts::MobileDeviceWorkKind::Terminal,
            title: entry.title.clone(),
        })
        .collect()
}

pub(crate) fn cancel_device_work(device: &str, id: &str) -> bool {
    let entry = {
        let mut terms = terms().lock();
        if terms
            .get(id)
            .is_some_and(|entry| entry.owner.as_deref() == Some(device))
        {
            terms.remove(id)
        } else {
            None
        }
    };
    if let Some(entry) = entry {
        entry.shutdown();
        true
    } else {
        false
    }
}

pub(crate) fn preserve_device_work(device: &str) {
    for entry in terms().lock().values() {
        if entry.owner.as_deref() == Some(device) {
            entry.preserve_on_detach.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt as _;

    #[test]
    fn device_terminal_cancellation_is_exact_and_continue_survives_detach() {
        fn insert(owner: &str) -> (String, Arc<TermEntry>) {
            let (tx, _) = broadcast::channel(4);
            let entry = Arc::new(TermEntry {
                backlog: Mutex::new(Backlog {
                    buf: VecDeque::new(),
                    exit: None,
                }),
                tx,
                subs: AtomicUsize::new(0),
                closed: AtomicBool::new(false),
                pty_id: Mutex::new(None),
                owner: Some(owner.to_owned()),
                title: "terminal".into(),
                preserve_on_detach: AtomicBool::new(false),
            });
            let id = uuid::Uuid::new_v4().to_string();
            terms().lock().insert(id.clone(), entry.clone());
            (id, entry)
        }
        let owner = uuid::Uuid::new_v4().to_string();
        let other = uuid::Uuid::new_v4().to_string();
        let (first, first_entry) = insert(&owner);
        let (second, second_entry) = insert(&owner);
        let (foreign, foreign_entry) = insert(&other);
        assert!(!cancel_device_work(&owner, &foreign));
        assert!(cancel_device_work(&owner, &first));
        assert!(first_entry.closed.load(Ordering::SeqCst));
        assert!(!second_entry.closed.load(Ordering::SeqCst));
        assert!(!foreign_entry.closed.load(Ordering::SeqCst));
        preserve_device_work(&owner);
        reap_unattached_now(&second, &second_entry);
        assert!(get_term(&second).is_ok());
        assert!(!second_entry.closed.load(Ordering::SeqCst));
        remove_term(&second);
        remove_term(&foreign);
    }

    #[test]
    fn plan_text_prefers_snapshot_and_only_uses_legacy_without_state() {
        let approved = json!({"enabled": false, "content": "Draft", "approved": {"content": "Approved", "status": "executing"}});
        assert_eq!(
            plan_text(Some(&approved), Some("Latest reply".into())).as_deref(),
            Some("Approved")
        );
        let planning = json!({"enabled": true, "content": "Actual plan", "approved": null});
        assert_eq!(
            plan_text(Some(&planning), None).as_deref(),
            Some("Actual plan")
        );
        assert_eq!(
            plan_text(
                Some(&json!({"enabled": false, "content": null})),
                Some("Stale".into())
            ),
            None
        );
        assert_eq!(
            plan_text(None, Some("Legacy".into())).as_deref(),
            Some("Legacy")
        );
    }

    #[test]
    fn sidechat_image_paths_are_additive_and_question_can_be_image_only() {
        let legacy: SideChatBody = serde_json::from_value(json!({"question": "Hello"})).unwrap();
        assert_eq!(legacy.question, "Hello");
        assert!(legacy.image_paths.is_empty());
        let images: SideChatBody =
            serde_json::from_value(json!({"imagePaths": ["/uploaded/image.png"]})).unwrap();
        assert!(images.question.is_empty());
        assert_eq!(images.image_paths, vec!["/uploaded/image.png"]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn terminal_open_write_read_close() {
        let id = open_term(
            "/tmp",
            vec!["sh".into()],
            80,
            24,
            Duration::from_secs(60),
            None,
            None,
        )
        .expect("open");
        let (_sd_tx, sd_rx) = watch::channel(false);
        let entry = get_term(&id).expect("entry");
        let mut s = attach_stream(id.clone(), entry.clone(), sd_rx);
        let pty_id = entry.pty_id.lock().clone().unwrap();
        pty::write(&pty_id, b"echo o''k\n").unwrap();
        let mut seen = String::new();
        let found = tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(Ok(ev)) = s.next().await {
                let dbg = format!("{ev:?}");
                seen.push_str(&dbg);
                // `echo o''k` echoes the typed text, so look for the output line.
                let b = entry.backlog.lock();
                let text: Vec<u8> = b.buf.iter().copied().collect();
                if String::from_utf8_lossy(&text).contains("\nok") {
                    return true;
                }
            }
            false
        })
        .await
        .unwrap_or(false);
        assert!(found, "no `ok` output; events: {seen}");
        drop(s);
        remove_term(&id);
        assert!(get_term(&id).is_err());
        assert!(pty::write(&pty_id, b"x").is_err());
    }

    #[test]
    fn latest_assistant_skips_blank() {
        use crate::contracts::{TranscriptItem, TranscriptKind};
        let mk = |k, t: Option<&str>| TranscriptItem {
            kind: k,
            text: t.map(String::from),
            ..Default::default()
        };
        let items = vec![
            mk(TranscriptKind::Assistant, Some("plan")),
            mk(TranscriptKind::Assistant, Some("  ")),
            mk(TranscriptKind::User, Some("hi")),
        ];
        assert_eq!(latest_assistant_text(&items).as_deref(), Some("plan"));
        assert_eq!(latest_assistant_text(&[]), None);
    }
}
