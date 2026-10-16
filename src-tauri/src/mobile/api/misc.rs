//! Mobile API: right-panel pages other than explorer/git — side chat, todos,
//! plan, heatmap, services, terminal. Reuses the desktop module logic
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
//! Heatmap:
//! - `GET  /sessions/{id}/subagents` → `SubagentSummary[]` (empty if no file).
//! - `GET  /sessions/{id}/subagents/{agentId}?fromByte=` → `SubagentTranscript`.
//! - `POST /heatmap/diagnose` `{prompt, model?}` → `{text}` (AI doctor).
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
use axum::{Json, Router};
use base64::Engine as _;
use futures_util::stream::{self, Stream};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{broadcast, watch};

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
        .route("/heatmap/diagnose", post(heatmap_diagnose::<B>))
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
        .filter(|m| m.parent_id.as_deref() == Some(id.as_str()))
        .collect();
    to_json(rows)
}

#[derive(Deserialize)]
struct SideChatBody {
    question: String,
    selection: Option<String>,
    model: Option<String>,
}

async fn sidechat_create<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<SideChatBody>,
) -> ApiResult<Value> {
    valid_id(&id)?;
    let state = app(&ctx)?;
    if body.question.trim().is_empty() {
        return Err(bad("问题不能为空"));
    }
    if ctx.backend.session(&id).await.is_none() {
        return Err(ApiError(StatusCode::NOT_FOUND, "会话不存在".into()));
    }
    let info = crate::rpc::sidechat::create(state, &id, body.selection, body.question, body.model)
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

/// Latest non-blank assistant text (the plan while plan mode is on).
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

async fn plan<B: Backend>(
    State(_ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    valid_id(&id)?;
    let Some(file) = crate::catalog::file_of(&id) else {
        return Err(ApiError(StatusCode::NOT_FOUND, "会话不存在".into()));
    };
    let streaming = crate::rpc::get_handle(&id)
        .is_some_and(|h| h.streaming.load(std::sync::atomic::Ordering::SeqCst));
    let text = if file.exists() {
        let id2 = id.clone();
        tokio::task::spawn_blocking(move || {
            crate::catalog::transcript::read_page(&file, &id2, 0)
                .map(|p| latest_assistant_text(&p.items))
        })
        .await
        .map_err(gateway)?
        .map_err(gateway)?
    } else {
        None
    };
    Ok(Json(json!({ "text": text, "streaming": streaming })))
}

// ---- heatmap ----

async fn session_file<B: Backend>(ctx: &Ctx<B>, id: &str) -> Result<String, ApiError> {
    valid_id(id)?;
    ctx.backend
        .session(id)
        .await
        .map(|m| m.file)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))
}

async fn subagents<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let file = session_file(&ctx, &id).await?;
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
    to_json(crate::rpc::subagents::transcript(&file, &agent, q.from_byte).map_err(gateway)?)
}

#[derive(Deserialize)]
struct DiagnoseBody {
    prompt: String,
    model: Option<String>,
}

async fn heatmap_diagnose<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Json(body): Json<DiagnoseBody>,
) -> ApiResult<Value> {
    let state = app(&ctx)?;
    let prompt = body.prompt.trim();
    if prompt.is_empty() {
        return Err(bad("诊断内容不能为空"));
    }
    let model = {
        let s = state.settings.read();
        let picked = [body.model.as_deref().unwrap_or(""), s.doctor_model.as_str()]
            .into_iter()
            .map(str::trim)
            .find(|m| !m.is_empty())
            .unwrap_or("smol")
            .to_string();
        picked
    };
    let text = crate::todos::omp::run_print(state, &model, prompt, Duration::from_secs(120))
        .await
        .map_err(gateway)?;
    Ok(Json(json!({ "text": text })))
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
        if entry.subs.load(Ordering::SeqCst) == 0 {
            remove_term(&id);
        }
    });
}

/// Open a PTY at `cwd` (argv empty → agent-aware login shell) and register it.
fn open_term(
    cwd: &str,
    argv: Vec<String>,
    cols: u16,
    rows: u16,
    grace: Duration,
) -> Result<String, ApiError> {
    if terms().lock().len() >= MAX_TERMINALS {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            format!("最多同时打开 {MAX_TERMINALS} 个终端"),
        ));
    }
    let (argv, extra_env) =
        crate::terminal::shell_init::drawer_spawn(&argv).unwrap_or((argv, vec![]));
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
    Json(body): Json<TermOpenBody>,
) -> ApiResult<Value> {
    valid_id(&body.session_id)?;
    let meta = ctx
        .backend
        .session(&body.session_id)
        .await
        .ok_or(ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
    let cwd = meta.cwd;
    let (cols, rows) = (body.cols.unwrap_or(80), body.rows.unwrap_or(24));
    let cwd2 = cwd.clone();
    let id =
        tokio::task::spawn_blocking(move || open_term(&cwd2, vec![], cols, rows, DETACH_GRACE))
            .await
            .map_err(gateway)??;
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
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let entry = get_term(&id)?;
    let s = attach_stream(id, entry, ctx.shutdown.clone());
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

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt as _;

    #[tokio::test(flavor = "multi_thread")]
    async fn terminal_open_write_read_close() {
        let id =
            open_term("/tmp", vec!["sh".into()], 80, 24, Duration::from_secs(60)).expect("open");
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
