//! axum router for the mobile web app: pairing, cookie/Bearer auth, JSON API, SSE.

use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::{self, Stream, StreamExt as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, watch};

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

pub struct ApiError(StatusCode, String);

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
        .route("/events", get(events::<B>))
        .route_layer(middleware::from_fn_with_state(
            ctx.clone(),
            require_auth::<B>,
        ));
    Router::new()
        .route("/", get(index))
        .route("/pair", get(pair::<B>))
        .nest("/api", api)
        .with_state(ctx)
}

async fn index() -> impl IntoResponse {
    ([(header::CACHE_CONTROL, "no-store")], Html(INDEX_HTML))
}

fn extract_host_authority(val: &str) -> &str {
    let stripped = val
        .trim()
        .strip_prefix("https://")
        .or_else(|| val.trim().strip_prefix("http://"))
        .unwrap_or(val.trim());
    stripped.split('/').next().unwrap_or(stripped).trim()
}

fn verify_csrf(headers: &HeaderMap) -> Result<(), ApiError> {
    if let Some(site) = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
        if site.eq_ignore_ascii_case("cross-site") {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "禁止跨站请求 (CSRF)".into(),
            ));
        }
    }

    let expected_host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .map(|h| h.trim());

    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let origin_auth = extract_host_authority(origin);
        if let Some(exp) = expected_host {
            let exp_auth = extract_host_authority(exp);
            let origin_host_only = origin_auth.split(':').next().unwrap_or(origin_auth);
            let exp_host_only = exp_auth.split(':').next().unwrap_or(exp_auth);
            if !origin_auth.eq_ignore_ascii_case(exp_auth)
                && !origin_host_only.eq_ignore_ascii_case(exp_host_only)
            {
                return Err(ApiError(
                    StatusCode::FORBIDDEN,
                    "Origin 来源不受信任".into(),
                ));
            }
        }
    } else if let Some(referer) = headers.get(header::REFERER).and_then(|v| v.to_str().ok()) {
        let referer_auth = extract_host_authority(referer);
        if let Some(exp) = expected_host {
            let exp_auth = extract_host_authority(exp);
            let ref_host_only = referer_auth.split(':').next().unwrap_or(referer_auth);
            let exp_host_only = exp_auth.split(':').next().unwrap_or(exp_auth);
            if !referer_auth.eq_ignore_ascii_case(exp_auth)
                && !ref_host_only.eq_ignore_ascii_case(exp_host_only)
            {
                return Err(ApiError(
                    StatusCode::FORBIDDEN,
                    "Referer 来源不受信任".into(),
                ));
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
    if req.method() == axum::http::Method::POST {
        if let Err(err) = verify_csrf(req.headers()) {
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

async fn pair<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    headers: HeaderMap,
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
    let https = headers
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

/// Serve until `shutdown` flips to true.
pub async fn serve<B: Backend>(listener: tokio::net::TcpListener, ctx: Arc<Ctx<B>>) {
    let mut sd = ctx.shutdown.clone();
    let app = router(ctx);
    let _ = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            while !*sd.borrow() {
                if sd.changed().await.is_err() {
                    break;
                }
            }
        })
        .await;
}
