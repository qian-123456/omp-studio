//! axum router for the mobile web app: pairing, cookie/Bearer auth, JSON API, SSE.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::{self, Stream, StreamExt as _};
use hyper::body::Incoming;
use hyper_util::rt::{TokioExecutor, TokioIo, TokioTimer};
use hyper_util::server::conn::auto;
use hyper_util::service::TowerToHyperService;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, watch, Semaphore};
use tower::ServiceExt as _;

use super::auth;
use super::backend::Backend;
use crate::contracts::{PendingKind, SessionMeta, SessionStatus};
use crate::state::AppEvent;

pub const INDEX_HTML: &str = include_str!("../../mobile/index.html");

pub struct Ctx<B> {
    pub backend: B,
    pub db: Arc<parking_lot::Mutex<rusqlite::Connection>>,
    /// Flips to true on server stop; ends SSE streams.
    pub shutdown: watch::Receiver<bool>,
}

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

fn bad_gateway(e: String) -> ApiError {
    ApiError(StatusCode::BAD_GATEWAY, e)
}

type ApiResult<T> = Result<Json<T>, ApiError>;

pub fn router<B: Backend>(ctx: Arc<Ctx<B>>) -> Router {
    let api = Router::new()
        .route("/sessions", get(sessions::<B>))
        .route("/todos", get(todos::<B>))
        .route("/todos/{id}/act", post(todo_act::<B>))
        .route("/sessions/{id}/pending-ui", get(pending_ui::<B>))
        .route("/sessions/{id}/ui-respond", post(ui_respond::<B>))
        .route("/sessions/{id}/prompt", post(prompt::<B>))
        .route("/sessions/{id}/resume", post(resume::<B>))
        .route("/sessions/{id}/last", get(last::<B>))
        .route("/sessions/{id}/transcript", get(transcript::<B>))
        .route("/events", get(events::<B>))
        .merge(super::api::routes::<B>())
        .route_layer(middleware::from_fn_with_state(
            ctx.clone(),
            require_auth::<B>,
        ));
    Router::new()
        .route("/", get(index))
        .route("/pair", get(pair::<B>))
        .route("/static/{*path}", get(static_asset))
        .nest("/api", api)
        .with_state(ctx)
}

async fn static_asset(Path(path): Path<String>) -> Response {
    match super::assets::find(&path) {
        Some((ct, body)) => (
            [
                (header::CONTENT_TYPE, ct),
                (header::CACHE_CONTROL, "no-store"),
            ],
            body,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn index() -> impl IntoResponse {
    ([(header::CACHE_CONTROL, "no-store")], Html(INDEX_HTML))
}

/// (scheme, authority) of an absolute URL, cutting the authority at the first
/// path/query/fragment separator. `None` when the URL has no scheme.
fn split_scheme_authority(url: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = url.trim().split_once("://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    Some((scheme, rest[..end].trim()))
}

pub(crate) fn split_host_port(authority: &str) -> (&str, Option<&str>) {
    let auth = authority.trim();
    if auth.starts_with('[') {
        if let Some(end) = auth.find(']') {
            let host = &auth[..=end];
            let rest = &auth[end + 1..];
            let port = rest.strip_prefix(':').map(str::trim);
            return (host, port);
        }
    }
    match auth.split_once(':') {
        Some((host, port)) => (host.trim(), Some(port.trim())),
        None => (auth, None),
    }
}

/// Default port for a scheme (https → 443, http → 80).
fn scheme_default_port(scheme: &str) -> Option<u16> {
    match scheme.to_ascii_lowercase().as_str() {
        "https" => Some(443),
        "http" => Some(80),
        _ => None,
    }
}

/// Effective port: the explicit one, or the scheme's default when omitted.
/// An explicit but unparseable port yields `None` (never matches).
fn effective_port(port: Option<&str>, scheme: &str) -> Option<u16> {
    match port {
        Some(p) => p.parse::<u16>().ok(),
        None => scheme_default_port(scheme),
    }
}

/// Exact host+port origin match. A missing port means the scheme's default
/// (https → 443, http → 80), and the scheme itself must match too.
/// Bracket-aware for IPv6 literals.
fn origin_matches(expected_auth: &str, expected_scheme: &str, url: &str) -> bool {
    let Some((scheme, actual_auth)) = split_scheme_authority(url) else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case(expected_scheme) {
        return false;
    }
    let (actual_host, actual_port) = split_host_port(actual_auth);
    let (exp_host, exp_port) = split_host_port(expected_auth);
    actual_host.eq_ignore_ascii_case(exp_host)
        && effective_port(actual_port, scheme) == effective_port(exp_port, expected_scheme)
}

pub(crate) fn verify_csrf(headers: &HeaderMap, is_tls: bool) -> Result<(), ApiError> {
    if let Some(site) = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
        if site.eq_ignore_ascii_case("cross-site") {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "禁止跨站请求 (CSRF)".into(),
            ));
        }
    }

    // Only the real Host header: `X-Forwarded-Host` is attacker-controlled on a LAN.
    let expected_auth = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(str::trim);
    // The expected side's scheme comes from the connection itself, not from a
    // spoofable header: TLS here, or a trusted proxy's forwarded proto.
    let expected_scheme = if is_tls
        || headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|p| p.eq_ignore_ascii_case("https"))
    {
        "https"
    } else {
        "http"
    };
    let untrusted = |what: &str| ApiError(StatusCode::FORBIDDEN, format!("{what} 来源不受信任"));

    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if let Some(exp) = expected_auth {
            if !origin_matches(exp, expected_scheme, origin) {
                return Err(untrusted("Origin"));
            }
        }
    } else if let Some(referer) = headers.get(header::REFERER).and_then(|v| v.to_str().ok()) {
        if let Some(exp) = expected_auth {
            if !origin_matches(exp, expected_scheme, referer) {
                return Err(untrusted("Referer"));
            }
        }
    }
    Ok(())
}

fn validate_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty()
        || id.len() > 128
        || id.contains("..")
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(ApiError(StatusCode::BAD_REQUEST, "非法标识符".into()));
    }
    Ok(())
}

async fn require_auth<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    mut req: Request,
    next: Next,
) -> Response {
    let token = match auth::token_from_headers(req.headers()) {
        Some(t) if auth::verify(&ctx.db.lock(), &t, chrono::Utc::now()) => t,
        _ => return ApiError(StatusCode::UNAUTHORIZED, "未配对或已被撤销".into()).into_response(),
    };
    // Every state-changing verb (the web app also uses PUT/PATCH/DELETE), not just POST.
    if !matches!(
        *req.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) {
        let is_tls = req.extensions().get::<TlsConnection>().is_some();
        if let Err(err) = verify_csrf(req.headers(), is_tls) {
            return err.into_response();
        }
    }
    req.extensions_mut().insert(auth::Token(token));
    next.run(req).await
}

#[derive(Deserialize)]
struct PairQuery {
    code: Option<String>,
}

fn pair_failed_page() -> Response {
    let body = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>\
        <body style='background:#0a0a0a;color:#e5e5e5;font-family:system-ui;padding:2em'>\
        <h3>配对失败</h3><p>配对码无效、已使用或已过期（5 分钟有效）。请在电脑上重新生成二维码。</p></body>";
    (StatusCode::FORBIDDEN, Html(body)).into_response()
}
#[derive(Clone, Copy, Debug)]
pub struct TlsConnection;

async fn pair<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    headers: HeaderMap,
    tls_ext: Option<axum::Extension<TlsConnection>>,
    Query(q): Query<PairQuery>,
) -> Response {
    let Some(code) = q.code.filter(|c| !c.is_empty()) else {
        return pair_failed_page();
    };
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");
    let name: String = ua.chars().take(120).collect();
    let token = match auth::redeem(&ctx.db.lock(), &code, &name, chrono::Utc::now()) {
        Ok(Some(t)) => t,
        _ => return pair_failed_page(),
    };
    let https = tls_ext.is_some()
        || headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|p| p.eq_ignore_ascii_case("https"));
    let cookie = format!(
        "{}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000{}",
        auth::COOKIE,
        if https { "; Secure" } else { "" }
    );
    (
        StatusCode::SEE_OTHER,
        [
            (header::SET_COOKIE, cookie),
            (header::LOCATION, "/".to_string()),
        ],
    )
        .into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSession {
    pub id: String,
    pub label: String,
    pub title: String,
    pub status: SessionStatus,
    pub pending: Option<PendingKind>,
    pub updated_at: String,
    pub cwd: String,
    pub live: bool,
    pub last_assistant: Option<String>,
}

impl From<SessionMeta> for MobileSession {
    fn from(m: SessionMeta) -> Self {
        Self {
            id: m.id,
            label: m.label,
            title: m.title,
            status: m.status,
            pending: m.pending,
            updated_at: m.updated_at,
            cwd: m.cwd,
            live: m.live,
            last_assistant: m.last_assistant,
        }
    }
}

async fn sessions<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> Json<Vec<MobileSession>> {
    let mut list: Vec<SessionMeta> = ctx
        .backend
        .sessions()
        .await
        .into_iter()
        .filter(|s| !s.archived)
        .collect();
    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    list.truncate(200);
    Json(list.into_iter().map(MobileSession::from).collect())
}

async fn todos<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> Json<Value> {
    Json(json!(ctx.backend.todos().await))
}

#[derive(Deserialize)]
struct ActBody {
    action: String,
}

async fn todo_act<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<ActBody>,
) -> ApiResult<Value> {
    validate_id(&id)?;
    if body.action != "done" && body.action != "ignore" && body.action != "reopen" {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "action 必须是 done、ignore 或 reopen".into(),
        ));
    }
    ctx.backend
        .todo_act(&id, &body.action)
        .await
        .map_err(bad_gateway)?;
    Ok(Json(json!({ "ok": true })))
}

async fn pending_ui<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    validate_id(&id)?;
    let _ = ctx
        .backend
        .session(&id)
        .await
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
    Ok(Json(json!(ctx.backend.pending_ui(&id).await)))
}

#[derive(Deserialize)]
struct RespondBody {
    response: Value,
}

async fn ui_respond<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<RespondBody>,
) -> ApiResult<Value> {
    validate_id(&id)?;
    let meta = ctx
        .backend
        .session(&id)
        .await
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
    if meta.archived {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "已归档的会话不可操作".into(),
        ));
    }
    let mut response = body.response;
    let Some(obj) = response.as_object_mut() else {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "response 必须是对象".into(),
        ));
    };
    let resp_id = match obj.get("id").and_then(|v| v.as_str()) {
        Some(id_str) if !id_str.is_empty() => id_str.to_string(),
        _ => return Err(ApiError(StatusCode::BAD_REQUEST, "response.id 缺失".into())),
    };
    let pending = ctx.backend.pending_ui(&id).await;
    let exists = pending
        .iter()
        .any(|p| p.request.get("id").and_then(|v| v.as_str()) == Some(&resp_id));
    if !exists {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "未找到对应的待处理 UI 请求".into(),
        ));
    }
    obj.entry("type")
        .or_insert_with(|| json!("extension_ui_response"));
    ctx.backend
        .ui_respond(&id, response)
        .await
        .map_err(bad_gateway)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct PromptBody {
    text: String,
}

async fn prompt<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<PromptBody>,
) -> ApiResult<Value> {
    validate_id(&id)?;
    let meta = ctx
        .backend
        .session(&id)
        .await
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
    if meta.archived {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "已归档的会话不可操作".into(),
        ));
    }
    let text = body.text.trim();
    if text.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "内容为空".into()));
    }
    ctx.backend
        .send_prompt(&id, text)
        .await
        .map_err(bad_gateway)?;
    Ok(Json(json!({ "ok": true })))
}

async fn resume<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    validate_id(&id)?;
    let meta = ctx
        .backend
        .session(&id)
        .await
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
    if meta.archived {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "已归档的会话不可操作".into(),
        ));
    }
    Ok(Json(ctx.backend.resume(&id).await.map_err(bad_gateway)?))
}

async fn last<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    validate_id(&id)?;
    let meta = ctx
        .backend
        .session(&id)
        .await
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
    let file = std::path::PathBuf::from(&meta.file);
    let text = tokio::task::spawn_blocking(move || super::last::last_assistant_text(&file))
        .await
        .ok()
        .flatten()
        .or(meta.last_assistant);
    Ok(Json(json!({ "text": text })))
}

#[derive(Deserialize)]
struct TranscriptQuery {
    from: Option<u64>,
    /// `tailId` of the previous page (see `read_page`).
    tail: Option<String>,
}

/// Cap on tool output / tool arguments sent to the phone; the desktop keeps the full text.
const MOBILE_TOOL_TEXT_CAP: usize = 4000;

fn cap_chars(s: &mut String, max: usize) {
    if let Some((idx, _)) = s.char_indices().nth(max) {
        s.truncate(idx);
        s.push('…');
    }
}

/// Normalized transcript page (same shape as the desktop `get_transcript`),
/// with hidden items dropped and bulky tool payloads truncated.
async fn transcript<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Query(q): Query<TranscriptQuery>,
) -> ApiResult<Value> {
    validate_id(&id)?;
    let meta = ctx
        .backend
        .session(&id)
        .await
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
    let file = std::path::PathBuf::from(&meta.file);
    let from = q.from.unwrap_or(0);
    let tail = q.tail;
    let sid = id.clone();
    let page = tokio::task::spawn_blocking(move || {
        if !file.exists() {
            return Ok(crate::contracts::TranscriptPage {
                session_id: sid,
                ..Default::default()
            });
        }
        crate::catalog::transcript::read_page(&file, &sid, from, tail.as_deref())
    })
    .await
    .map_err(|e| bad_gateway(e.to_string()))?
    .map_err(|e| bad_gateway(format!("读取记录失败: {e}")))?;
    let mut page = page;
    page.items.retain(|i| !i.hidden);
    for item in &mut page.items {
        if let Some(r) = item.tool_result.as_mut() {
            cap_chars(&mut r.text, MOBILE_TOOL_TEXT_CAP);
            r.details = None;
        }
        for c in &mut item.tool_calls {
            if c.args.to_string().chars().count() > MOBILE_TOOL_TEXT_CAP {
                let mut s = c.args.to_string();
                cap_chars(&mut s, MOBILE_TOOL_TEXT_CAP);
                c.args = Value::String(s);
            }
        }
        // usage/duration/ttft/completedAt are kept: the phone renders the same
        // per-request stats line as the desktop.
    }
    Ok(Json(json!(page)))
}

/// Map bus events to SSE events the mobile page cares about.
pub fn sse_event(ev: &AppEvent) -> Option<Event> {
    match ev {
        AppEvent::TodosChanged => Some(Event::default().event("todos").data("{}")),
        AppEvent::SessionStatusChanged {
            session_id,
            old,
            new,
        } => Some(
            Event::default()
                .event("session")
                .data(json!({ "sessionId": session_id, "old": old, "new": new }).to_string()),
        ),
        AppEvent::RpcFrame { session_id, frame } => {
            let ty = frame.get("type").and_then(Value::as_str)?;
            if !matches!(
                ty,
                "agent_start"
                    | "agent_end"
                    | "turn_start"
                    | "turn_end"
                    | "message_update"
                    | "message_end"
                    | "tool_execution_start"
                    | "tool_execution_end"
            ) {
                return None;
            }
            Some(
                Event::default()
                    .event("rpc")
                    .data(json!({ "sessionId": session_id, "frame": frame }).to_string()),
            )
        }
        AppEvent::PromptSent { session_id } | AppEvent::UiResponded { session_id, .. } => Some(
            Event::default()
                .event("touch")
                .data(json!({ "sessionId": session_id }).to_string()),
        ),
        _ => None,
    }
}

async fn events<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    axum::extract::Extension(auth::Token(token)): axum::extract::Extension<auth::Token>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let hello = stream::once(async { Ok(Event::default().event("hello").data("{}")) });
    let rx = ctx.backend.subscribe();
    let sd = ctx.shutdown.clone();
    let db = ctx.db.clone();
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let updates = stream::unfold(
        (rx, sd, db, token, interval),
        |(mut rx, mut sd, db, token, mut interval)| async move {
            loop {
                if *sd.borrow() {
                    return None;
                }
                tokio::select! {
                    changed = sd.changed() => {
                        if changed.is_err() { return None; }
                    }
                    _ = interval.tick() => {
                        if !auth::is_valid(&db.lock(), &token) {
                            return None;
                        }
                    }
                    r = rx.recv() => match r {
                        Ok(ev) => {
                            if !auth::is_valid(&db.lock(), &token) {
                                return None;
                            }
                            if let Some(e) = sse_event(&ev) {
                                return Some((Ok(e), (rx, sd, db, token, interval)));
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            if !auth::is_valid(&db.lock(), &token) {
                                return None;
                            }
                            return Some((Ok(Event::default().event("resync").data("{}")), (rx, sd, db, token, interval)));
                        }
                        Err(broadcast::error::RecvError::Closed) => return None,
                    }
                }
            }
        },
    );
    Sse::new(hello.chain(updates)).keep_alive(KeepAlive::default())
}

/// TLS handshake timeout for one accepted connection.
const TLS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// Max wait for request headers; also bounds idle keep-alive connections
/// (hyper re-arms it each time the connection waits for the next request head).
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// Cap on concurrent connections per listener; excess peers wait in the kernel
/// backlog instead of holding process file descriptors.
const MAX_CONNECTIONS: usize = 64;
/// How long in-flight requests may finish after stop before force-close.
const STOP_GRACE: Duration = Duration::from_secs(3);

/// Resolves when the shutdown watch flips to true (or its sender disappears).
async fn shutdown_fired(sd: &mut watch::Receiver<bool>) {
    loop {
        if *sd.borrow() {
            return;
        }
        if sd.changed().await.is_err() {
            return;
        }
    }
}

/// The router with hyper's request body adapted to axum's `Body`.
type AppService = tower::util::MapRequest<Router, fn(Request<Incoming>) -> Request<Body>>;

fn into_body(req: Request<Incoming>) -> Request<Body> {
    req.map(Body::new)
}

fn app_service(router: Router) -> AppService {
    router.map_request(into_body as fn(Request<Incoming>) -> Request<Body>)
}

/// hyper builder shared by both listeners: request-header timeout and the
/// timer it needs, so a silent client cannot hold a connection forever.
fn conn_builder() -> auto::Builder<TokioExecutor> {
    let mut builder = auto::Builder::new(TokioExecutor::new());
    builder
        .http1()
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_READ_TIMEOUT);
    builder
}

/// Serve one accepted connection; the permit is held for its whole lifetime
/// and bounds how many connections run at once.
async fn serve_conn<S>(
    stream: S,
    app: AppService,
    addr: std::net::SocketAddr,
    builder: auto::Builder<TokioExecutor>,
    _permit: tokio::sync::OwnedSemaphorePermit,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let service = TowerToHyperService::new(app);
    let conn = builder.serve_connection_with_upgrades(TokioIo::new(stream), service);
    if let Err(e) = conn.await {
        tracing::debug!("connection error from {addr}: {e}");
    }
}

/// Wait for the next accepted connection, reaping finished ones meanwhile
/// (an unjoined task keeps its result and memory until it is joined).
/// `None` once the shutdown watch fires.
async fn next_conn(
    listener: &tokio::net::TcpListener,
    sd: &mut watch::Receiver<bool>,
    permits: &Arc<Semaphore>,
    tasks: &mut tokio::task::JoinSet<()>,
) -> Option<(
    tokio::net::TcpStream,
    std::net::SocketAddr,
    tokio::sync::OwnedSemaphorePermit,
)> {
    loop {
        while tasks.try_join_next().is_some() {}
        tokio::select! {
            _ = shutdown_fired(sd) => return None,
            // acquire_owned: the permit owns an Arc clone, so it is 'static
            // and can move into the spawned connection task.
            permit = permits.clone().acquire_owned() => {
                let permit = permit.ok()?;
                let accepted = tokio::select! {
                    _ = shutdown_fired(sd) => return None,
                    accepted = listener.accept() => accepted,
                };
                match accepted {
                    Ok((tcp, addr)) => return Some((tcp, addr, permit)),
                    Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
                }
            }
            _ = tasks.join_next(), if !tasks.is_empty() => {}
        }
    }
}

/// Grace period: let in-flight requests finish (SSE ends on the shutdown
/// watch), then force-close whatever is still open and join it.
async fn drain_connections(tasks: &mut tokio::task::JoinSet<()>) {
    let grace = tokio::time::sleep(STOP_GRACE);
    tokio::pin!(grace);
    while !tasks.is_empty() {
        tokio::select! {
            _ = &mut grace => {
                tasks.abort_all();
                break;
            }
            _ = tasks.join_next() => {}
        }
    }
    while tasks.join_next().await.is_some() {}
}

/// Serve until `shutdown` flips to true.
///
/// Same guards as the TLS listener (header-read timeout, connection cap, stop
/// grace) so a plain-HTTP client cannot stall the accept loop or pin sockets.
pub async fn serve<B: Backend>(listener: tokio::net::TcpListener, ctx: Arc<Ctx<B>>) {
    let mut sd = ctx.shutdown.clone();
    let app = app_service(router(ctx));
    let permits = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let builder = conn_builder();
    let mut tasks: tokio::task::JoinSet<()> = tokio::task::JoinSet::new();
    while let Some((tcp, addr, permit)) = next_conn(&listener, &mut sd, &permits, &mut tasks).await
    {
        let app = app.clone();
        let builder = builder.clone();
        tasks.spawn(serve_conn(tcp, app, addr, builder, permit));
    }
    drain_connections(&mut tasks).await;
}

/// Serve the same router over TLS until `shutdown` flips to true.
///
/// Unlike `axum::serve`, the TLS handshake runs inside the per-connection task
/// (a silent client cannot stall the accept loop), hyper timeouts are armed,
/// concurrent connections are capped, and stop force-closes stragglers after a
/// short grace period.
pub async fn serve_tls<B: Backend>(
    listener: tokio::net::TcpListener,
    acceptor: tokio_rustls::TlsAcceptor,
    ctx: Arc<Ctx<B>>,
) {
    let mut sd = ctx.shutdown.clone();
    let app = app_service(router(ctx).layer(axum::Extension(TlsConnection)));
    let permits = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let builder = conn_builder();
    let mut tasks: tokio::task::JoinSet<()> = tokio::task::JoinSet::new();
    while let Some((tcp, addr, permit)) = next_conn(&listener, &mut sd, &permits, &mut tasks).await
    {
        let app = app.clone();
        let acceptor = acceptor.clone();
        let builder = builder.clone();
        tasks.spawn(async move {
            // The permit is dropped on a failed handshake, freeing the slot.
            let stream =
                match tokio::time::timeout(TLS_HANDSHAKE_TIMEOUT, acceptor.accept(tcp)).await {
                    Ok(Ok(stream)) => stream,
                    Ok(Err(e)) => {
                        tracing::debug!("TLS handshake failed from {addr}: {e}");
                        return;
                    }
                    Err(_) => {
                        tracing::debug!("TLS handshake timed out from {addr}");
                        return;
                    }
                };
            serve_conn(stream, app, addr, builder, permit).await;
        });
    }
    drain_connections(&mut tasks).await;
}
