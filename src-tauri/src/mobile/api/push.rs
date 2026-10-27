//! Web push endpoints (all behind device-pairing auth).
//!
//! - `GET  /push/public-key` → `{publicKey}` (base64url VAPID `applicationServerKey`).
//! - `POST /push/subscribe` `{endpoint, keys:{p256dh, auth}}` (= `PushSubscription.toJSON()`)
//!   → `{ok: true}`; 400 for an unsupported push-service host or malformed keys.
//! - `POST /push/unsubscribe` `{endpoint}` → `{ok: true, removed: n}` (own subscriptions only).
//! - `POST /push/test` `{}` → `{ok: true, sent, removed, failed}`; 409 when the device has
//!   no subscription.
//!
//! Server-initiated pushes carry `{title, body, url: "#/s/<id>", tag, sessionId}`.

use std::sync::Arc;

use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::mobile::auth;
use crate::mobile::backend::Backend;
use crate::mobile::push;
use crate::mobile::server::{ApiError, Ctx};

type ApiResult<T> = Result<Json<T>, ApiError>;

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new()
        .route("/push/public-key", get(public_key::<B>))
        .route("/push/subscribe", post(subscribe::<B>))
        .route("/push/unsubscribe", post(unsubscribe::<B>))
        .route("/push/test", post(test::<B>))
        .route("/presence", post(presence::<B>))
}

async fn public_key<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> ApiResult<Value> {
    let vapid = push::load_vapid(&ctx.db.lock())
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({ "publicKey": vapid.public_b64() })))
}

#[derive(Deserialize)]
struct Keys {
    p256dh: String,
    auth: String,
}

#[derive(Deserialize)]
struct SubscribeBody {
    endpoint: String,
    keys: Keys,
}

async fn subscribe<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Extension(auth::Token(token)): Extension<auth::Token>,
    Json(body): Json<SubscribeBody>,
) -> ApiResult<Value> {
    let sub = push::validate_subscription(
        &body.endpoint,
        &body.keys.p256dh,
        &body.keys.auth,
        &auth::hash_token(&token),
    )
    .map_err(|e| ApiError(StatusCode::BAD_REQUEST, e))?;
    push::save_subscription(&ctx.db.lock(), &sub, &chrono::Utc::now().to_rfc3339())
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct UnsubscribeBody {
    endpoint: String,
}

async fn unsubscribe<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Extension(auth::Token(token)): Extension<auth::Token>,
    Json(body): Json<UnsubscribeBody>,
) -> ApiResult<Value> {
    let removed =
        push::remove_subscription(&ctx.db.lock(), &body.endpoint, &auth::hash_token(&token));
    Ok(Json(json!({ "ok": true, "removed": removed })))
}

async fn test<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Extension(auth::Token(token)): Extension<auth::Token>,
) -> ApiResult<Value> {
    let device = auth::hash_token(&token);
    if push::list_subscriptions(&ctx.db.lock(), Some(&device)).is_empty() {
        return Err(ApiError(StatusCode::CONFLICT, "此设备尚未开启通知".into()));
    }
    let s = push::notify(
        &ctx.db,
        Some(&device),
        false,
        &push::test_payload(),
        |req| ctx.backend.push_http(req),
    )
    .await;
    Ok(Json(json!({
        "ok": true, "sent": s.sent, "removed": s.removed, "failed": s.failed,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceInput {
    #[serde(alias = "session_id")]
    session_id: Option<String>,
    #[serde(alias = "foreground", default)]
    visible: Option<bool>,
}

async fn presence<B: Backend>(
    Extension(auth::Token(token)): Extension<auth::Token>,
    Json(input): Json<PresenceInput>,
) -> ApiResult<Value> {
    let token_hash = auth::hash_token(&token);
    let visible = input.visible.unwrap_or(true);
    let session = input.session_id.filter(|s| !s.trim().is_empty());
    push::update_presence(&token_hash, session, visible);
    Ok(Json(json!({ "ok": true })))
}
