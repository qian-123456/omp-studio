//! Mobile API: chat composer slice (upload, rich prompt, abort, slash commands,
//! goal, plan mode, composer state). Mirrors the desktop `send.ts` /
//! `Composer.tsx` / `slash/registry.ts` RPC calls.
//!
//! ## Routes
//! All paths are relative to `/api`; errors are `{ "error": "..." }`. Every route
//! needs a known, non-archived session (404 / 400) and a real `AppState` (503 in
//! test mocks).
//!
//! - `POST /sessions/{id}/upload?name=<file name>` — raw request body (no
//!   multipart, ≤ 20 MiB, 413 above) → `{path, name, size}`. `name` is sanitized
//!   (directory parts, `..`, control and reserved characters removed). Stored
//!   under `<app-data>/mobile-uploads/<sessionId>/`; `path` is the absolute path
//!   to append to the prompt text. An existing file is never overwritten (a
//!   short random prefix is added instead).
//! - `POST /sessions/{id}/prompt-ex`
//!   `{text, images?: [{mime, data /*base64, no data: prefix*/}], streamingBehavior?: "steer"|"followUp"}`
//!   → `{ok: true, streaming: bool}`. Same RPC path as desktop `sendPrompt`: the
//!   session is resumed if needed, then `{type:"prompt", message, images:[{type:"image",
//!   data, mimeType}], streamingBehavior}`; the policy is always attached so a turn
//!   starting during preparation respects the requested queue (default `followUp`).
//!   Text or ≥1 image required; body ≤ 30 MiB; images must
//!   be png/jpeg/gif/webp. When plan mode is on (see below) and `text` is not a
//!   `/command`, the desktop plan prefix is prepended.
//! - `POST /sessions/{id}/abort` →
//!   `{aborted: true, restoredTexts: string[]}` — texts of the queued
//!   steer/follow-up inputs withdrawn by `abort_and_restore_queue` (steering
//!   first); 409 when the session is not live.
//! - `GET /sessions/{id}/slash-commands` →
//!   `[{name, title, description, argHint?, group, kind: "native"|"forward"|"custom", needsArg: bool}]`.
//!   Curated list: session commands that run remotely, commands forwarded to omp as
//!   plain `/name args` text, plus custom commands/skills reported by the live omp
//!   process (`get_available_commands`) that the desktop registry does not shadow.
//!   Desktop-only commands (pickers, settings, browser/computer…) are not listed.
//! - `POST /sessions/{id}/slash` `{name, args?}` (name without `/`, aliases ok) →
//!   `{ok: true, output?: string, sessionId?: string, forwarded?: bool}`.
//!   `output` is a text block to show in the thread; `sessionId` means the client
//!   should open that (new / side-chat) session. Forwarded commands are sent as a
//!   `/name args` prompt (their reply arrives as `command_output` SSE frames).
//!   Native: new, fork, btw, rename, compact, handoff, resume, plan, goal, model,
//!   thinking, fast, slow, status. 400 for desktop-only or malformed names.
//! - `GET /sessions/{id}/composer-state` →
//!   `{live, streaming, model, thinkingLevel, planMode, goal: {objective, status}|null,
//!   fastMode, slowMode, queue: {steering, followUp, liveSteered}, state}`; `state` is the raw omp `get_state` data (null when
//!   the session process is not running — then `model` falls back to the catalog).
//! - `POST /sessions/{id}/goal` `{objective}` (set; replaces an existing goal) or
//!   `{op: "pause"|"resume"|"drop"}` → `{ok: true, goal}`. `DELETE /sessions/{id}/goal`
//!   clears (= `op: "drop"`).
//! - `GET /sessions/{id}/plan-mode` → `{on}`; `POST /sessions/{id}/plan-mode`
//!   `{on?: bool}` (omitted = the opposite of the current state) → `{on, sessionId?}`.
//!   Plan mode is real omp plan mode from the bundled extension: switching sends
//!   `/plan-action enable` or `/plan-action disable` (never a toggle), and the state
//!   is the session handle's cached `ompws-plan` status (`enabled`).
//! - `GET /sessions/{id}/models` →
//!   `{models: [{provider, id, name, thinking: [level], contextWindow?}], current: {provider, id}|null,
//!   thinkingLevel: string|null, liveThinking: [level], live: bool}`. Read-only, NEVER resumes the
//!   session: `models` is the global catalog (`omp models --json`, models.db fallback — same as
//!   desktop `list_models`); `current`/`thinkingLevel`/`liveThinking` come from the live process
//!   when running, else from session metadata and the transcript snapshot. Client derives the level
//!   list like desktop `resolveThinkingLevels` (live → catalog `thinking`; `auto` first, `off` last).
//! - `POST /sessions/{id}/model` `{provider, modelId}` → `{ok: true, …same facts as GET}`.
//!   Resumes the session if needed (like desktop), then `set_model`; a running turn is not aborted.
//! - `POST /sessions/{id}/thinking` `{level}` → `{ok: true, …same facts as GET}`; same resume rules,
//!   `set_thinking_level`.

use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager as _;

use crate::contracts::SessionMeta;
use crate::mobile::backend::{Backend, PromptDelivery};
use crate::mobile::server::{ApiError, Ctx};
use crate::state::{AppEvent, AppState};

type ApiResult<T> = Result<Json<T>, ApiError>;

/// Raw-body upload cap.
const MAX_UPLOAD: usize = 20 * 1024 * 1024;
/// Prompt body cap (base64 images inline).
const MAX_PROMPT_BODY: usize = 30 * 1024 * 1024;
/// Longest stored file name in bytes (before any collision prefix).
const MAX_NAME_BYTES: usize = 120;

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new()
        .route(
            "/sessions/{id}/upload",
            post(upload::<B>).route_layer(DefaultBodyLimit::max(MAX_UPLOAD)),
        )
        .route(
            "/sessions/{id}/prompt-ex",
            post(prompt_ex::<B>).route_layer(DefaultBodyLimit::max(MAX_PROMPT_BODY)),
        )
        .route("/sessions/{id}/abort", post(abort::<B>))
        .route("/sessions/{id}/navigate-tree", post(navigate_tree::<B>))
        .route("/sessions/{id}/tree", get(session_tree::<B>))
        .route("/sessions/{id}/ui-respond-all", post(ui_respond_all::<B>))
        .route("/sessions/{id}/slash-commands", get(slash_commands::<B>))
        .route("/sessions/{id}/slash", post(slash::<B>))
        .route("/sessions/{id}/composer-state", get(composer_state::<B>))
        .route("/sessions/{id}/draft-activity", post(draft_activity::<B>))
        .route("/sessions/{id}/models", get(models_get::<B>))
        .route("/sessions/{id}/model", post(model_set::<B>))
        .route("/sessions/{id}/thinking", post(thinking_set::<B>))
        .route(
            "/sessions/{id}/goal",
            post(goal_set::<B>).delete(goal_clear::<B>),
        )
        .route(
            "/sessions/{id}/plan-mode",
            get(plan_get::<B>).post(plan_set::<B>),
        )
}

// ---------------------------------------------------------------- helpers

fn err(code: StatusCode, msg: impl Into<String>) -> ApiError {
    ApiError(code, msg.into())
}

fn bad_request(msg: impl Into<String>) -> ApiError {
    err(StatusCode::BAD_REQUEST, msg)
}

fn bad_gateway(msg: String) -> ApiError {
    err(StatusCode::BAD_GATEWAY, msg)
}

fn check_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty()
        || id.len() > 128
        || id.contains("..")
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(bad_request("非法标识符"));
    }
    Ok(())
}

fn app<B: Backend>(ctx: &Ctx<B>) -> Result<&AppState, ApiError> {
    ctx.backend
        .app_state()
        .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "服务不可用"))
}

/// Validate the id and load a non-archived session.
async fn load_session<B: Backend>(ctx: &Ctx<B>, id: &str) -> Result<SessionMeta, ApiError> {
    check_id(id)?;
    let meta = super::draft::find_session(&ctx.backend, id)
        .await
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "会话不存在"))?;
    if meta.archived {
        return Err(bad_request("已归档的会话不可操作"));
    }
    Ok(meta)
}

/// Send one RPC command to a live session, like `rpc_send` (privacy refresh for
/// prompts, `PromptSent` event for prompt-like commands).
async fn rpc_cmd(state: &AppState, id: &str, command: Value) -> Result<Value, String> {
    let ty = command
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let handle = if ty == "prompt" {
        crate::rpc::refresh_privacy(state, id).await?
    } else {
        crate::rpc::get_handle(id).ok_or("session is not live")?
    };
    let resp = crate::rpc::send_command(&handle, command).await?;
    if matches!(
        ty.as_str(),
        "prompt" | "steer" | "follow_up" | "abort_and_prompt"
    ) {
        state.emit(AppEvent::PromptSent {
            session_id: id.to_string(),
        });
    }
    Ok(resp)
}

/// Resume the session process when needed.
async fn live(state: &AppState, id: &str) -> Result<(), ApiError> {
    crate::rpc::ensure_live(state, id, None, None)
        .await
        .map(|_| ())
        .map_err(bad_gateway)
}

fn data_of(resp: &Value) -> &Value {
    resp.get("data").unwrap_or(resp)
}

/// `get_state` data of a live session; `None` when not live or on failure.
async fn live_state(id: &str) -> Option<Value> {
    let handle = crate::rpc::get_handle(id)?;
    let resp = crate::rpc::send_command(&handle, json!({"type": "get_state"}))
        .await
        .ok()?;
    Some(data_of(&resp).clone())
}

/// Send a prompt (optionally with images) the way desktop `sendPrompt` does.
/// A draft id starts its process first and hands off to the real session; the
/// real id is returned in that case.
pub(crate) async fn send_prompt_ex<B: Backend>(
    ctx: &Ctx<B>,
    id: &str,
    message: &str,
    images: Vec<Value>,
    behavior: Option<&str>,
) -> Result<(Option<String>, bool), ApiError> {
    let delivery = |selection| PromptDelivery {
        message: message.to_string(),
        images: images.clone(),
        behavior: behavior.map(str::to_string),
        selection,
    };
    let handed = super::draft::handoff(ctx, id, |real, selection| {
        let d = delivery(selection);
        async move {
            ctx.backend
                .deliver_prompt(&real, d)
                .await
                .map_err(bad_gateway)
        }
    })
    .await?;
    if let Some((real, streaming)) = handed {
        return Ok((Some(real), streaming));
    }
    let streaming = ctx
        .backend
        .deliver_prompt(id, delivery(super::draft::Selection::default()))
        .await
        .map_err(bad_gateway)?;
    Ok((None, streaming))
}

/// Production delivery: apply the draft selection to the fresh process, then
/// prompt it.
pub(crate) async fn deliver_prompt(
    state: &AppState,
    id: &str,
    d: PromptDelivery,
) -> Result<bool, ApiError> {
    apply_selection(state, id, d.selection).await?;
    send_prompt_live(state, id, &d.message, d.images, d.behavior.as_deref()).await
}

async fn apply_selection(
    state: &AppState,
    id: &str,
    selection: super::draft::Selection,
) -> Result<(), ApiError> {
    if let Some((provider, model_id)) = selection.model {
        rpc_cmd(
            state,
            id,
            json!({"type":"set_model", "provider":provider, "modelId":model_id}),
        )
        .await
        .map_err(bad_gateway)?;
    }
    if let Some(level) = selection.thinking {
        rpc_cmd(
            state,
            id,
            json!({"type":"set_thinking_level", "level":level}),
        )
        .await
        .map_err(bad_gateway)?;
    }
    Ok(())
}

async fn send_prompt_live(
    state: &AppState,
    id: &str,
    message: &str,
    images: Vec<Value>,
    behavior: Option<&str>,
) -> Result<bool, ApiError> {
    live(state, id).await?;
    let streaming = crate::rpc::get_handle(id)
        .is_some_and(|h| h.streaming.load(std::sync::atomic::Ordering::SeqCst));
    let cmd = crate::rpc::prompt_command(message, images, behavior);
    rpc_cmd(state, id, cmd).await.map_err(bad_gateway)?;
    Ok(streaming)
}

// ------------------------------------------------------------ pure helpers

/// Reduce a client-supplied file name to a safe single path component.
/// Never returns an empty string, `.` or `..`.
fn sanitize_filename(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();
    if cleaned.is_empty() {
        return "upload".into();
    }
    if cleaned.len() <= MAX_NAME_BYTES {
        return cleaned.to_string();
    }
    // Truncate on a char boundary, keeping a short extension.
    let (stem, ext) = match cleaned.rfind('.') {
        Some(i) if cleaned.len() - i <= 16 => (&cleaned[..i], &cleaned[i..]),
        _ => (cleaned, ""),
    };
    let budget = MAX_NAME_BYTES - ext.len();
    let mut end = budget.min(stem.len());
    while !stem.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{}", &stem[..end], ext)
}

fn check_upload_size(len: usize) -> Result<(), ApiError> {
    if len == 0 {
        return Err(bad_request("文件为空"));
    }
    if len > MAX_UPLOAD {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "文件超过 20MB 上限"));
    }
    Ok(())
}

#[derive(Deserialize)]
pub(crate) struct ImageIn {
    pub(crate) mime: String,
    pub(crate) data: String,
}

/// Validate images and convert to omp `ImageContent` blocks.
pub(crate) fn build_images(images: &[ImageIn]) -> Result<Vec<Value>, ApiError> {
    let mut out = Vec::with_capacity(images.len());
    for img in images {
        let mime = img.mime.trim().to_ascii_lowercase();
        let mime = if mime == "image/jpg" {
            "image/jpeg".into()
        } else {
            mime
        };
        if !matches!(
            mime.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        ) {
            return Err(bad_request("不支持的图片格式（仅 png/jpeg/gif/webp）"));
        }
        let data = img.data.trim();
        if data.is_empty()
            || base64::engine::general_purpose::STANDARD
                .decode(data)
                .is_err()
        {
            return Err(bad_request("图片数据不是有效的 base64"));
        }
        out.push(json!({"type": "image", "data": data, "mimeType": mime}));
    }
    Ok(out)
}

/// Plan mode state from the extension's last `ompws-plan` status frame.
fn plan_enabled(id: &str) -> bool {
    crate::rpc::get_handle(id)
        .and_then(|h| {
            h.plan_status
                .lock()
                .as_ref()
                .and_then(|p| p.get("enabled"))
                .and_then(Value::as_bool)
        })
        .unwrap_or(false)
}

fn plan_string(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// Mobile-only projection of the desktop parser; shared contracts stay frozen.
fn normalize_plan_status(raw: &Value, persisted: bool) -> Option<Value> {
    if !raw.is_object() || (!persisted && raw.get("v").and_then(Value::as_u64) != Some(1)) {
        return None;
    }
    let mut out = json!({
        "enabled": false, "phase": "planning", "planFile": null, "planUrl": null,
        "title": null, "content": null, "prevContent": null, "version": 0,
        "planModel": null, "tiers": [], "defaultRole": "default",
        "contextPercent": null, "keepDisabled": false, "approved": null,
    });
    if raw.get("enabled").and_then(Value::as_bool) == Some(true) {
        out["enabled"] = json!(true);
        out["phase"] = json!(
            if raw.get("phase").and_then(Value::as_str) == Some("review") {
                "review"
            } else {
                "planning"
            }
        );
        for key in ["planFile", "planUrl", "title", "prevContent", "planModel"] {
            out[key] = json!(plan_string(raw.get(key)));
        }
        out["content"] = json!(plan_string(raw.get(if persisted {
            "lastContent"
        } else {
            "content"
        })));
        out["version"] = raw
            .get("version")
            .filter(|v| v.is_number())
            .cloned()
            .unwrap_or(json!(0));
        out["tiers"] = json!(raw
            .get("tiers")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|t| Some(
                json!({"role": t.get("role")?.as_str()?, "spec": t.get("spec")?.as_str()?})
            ))
            .collect::<Vec<_>>());
        out["defaultRole"] = json!(plan_string(raw.get("defaultRole")).unwrap_or("default"));
        out["contextPercent"] = raw
            .get("contextPercent")
            .filter(|v| v.is_number())
            .cloned()
            .unwrap_or(Value::Null);
        out["keepDisabled"] = json!(raw.get("keepDisabled").and_then(Value::as_bool) == Some(true));
    } else if let Some(a) = raw.get("approved").filter(|a| a.is_object()) {
        if plan_string(a.get("content")).is_some()
            && matches!(
                a.get("status").and_then(Value::as_str),
                Some("executing" | "completed" | "failed" | "handoff")
            )
        {
            out["approved"] = json!({
                "planFile": plan_string(a.get("planFile")), "planUrl": plan_string(a.get("planUrl")),
                "title": plan_string(a.get("title")), "content": plan_string(a.get("content")),
                "prevContent": plan_string(a.get("prevContent")),
                "version": a.get("version").filter(|v| v.is_number()).cloned().unwrap_or(json!(1)),
                "status": a.get("status"), "error": plan_string(a.get("error")),
            });
        }
    }
    Some(out)
}

/// Parse only complete matching custom records, never transcript message objects.
fn read_saved_plan(file: &FsPath) -> std::io::Result<Option<Value>> {
    use std::io::{BufRead, BufReader};
    let file = match std::fs::File::open(file) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let mut latest = None;
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 || line.last() != Some(&b'\n') {
            break;
        }
        if !line
            .windows(b"ompws-plan-state".len())
            .any(|w| w == b"ompws-plan-state")
        {
            continue;
        }
        let Ok(mut entry) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        if entry.get("type").and_then(Value::as_str) == Some("custom")
            && entry.get("customType").and_then(Value::as_str) == Some("ompws-plan-state")
            && entry.get("data").is_some_and(Value::is_object)
        {
            latest = Some(entry["data"].take());
        }
    }
    Ok(latest)
}

fn plan_local_roots(file: &FsPath, id: &str) -> [PathBuf; 2] {
    [
        file.with_extension("").join("local"),
        std::env::temp_dir().join("omp-local").join(id),
    ]
}

/// Restore missing bodies only from regular files inside this session's local roots.
fn read_local_plan(path: &str, file: &FsPath, id: &str) -> Option<String> {
    use std::io::Read;
    const MAX_PLAN_BYTES: u64 = 512 * 1024;
    let requested = FsPath::new(path);
    if !requested.is_absolute()
        || requested
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return None;
    }
    let canon = std::fs::canonicalize(requested).ok()?;
    if !plan_local_roots(file, id)
        .iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .any(|root| canon.starts_with(root))
    {
        return None;
    }
    let opened = std::fs::File::open(canon).ok()?;
    let metadata = opened.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_PLAN_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    opened
        .take(MAX_PLAN_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_PLAN_BYTES {
        return None;
    }
    String::from_utf8(bytes)
        .ok()
        .filter(|s| !s.trim().is_empty())
}

fn restore_plan_body(raw: &mut Value, persisted: bool, file: &FsPath, id: &str) {
    let target = if raw.get("enabled").and_then(Value::as_bool) == Some(true) {
        Some((raw, if persisted { "lastContent" } else { "content" }))
    } else {
        raw.get_mut("approved")
            .filter(|a| a.is_object())
            .map(|a| (a, "content"))
    };
    let Some((target, key)) = target else { return };
    if plan_string(target.get(key)).is_none() {
        if let Some(content) =
            plan_string(target.get("planFile")).and_then(|p| read_local_plan(p, file, id))
        {
            target[key] = json!(content);
        }
    }
    if !persisted {
        return;
    }
    let path = plan_string(target.get("planFile"));
    let title = plan_string(target.get(key))
        .and_then(|body| body.lines().find_map(|line| line.strip_prefix("# ")))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| path.and_then(|p| FsPath::new(p).file_stem()?.to_str()))
        .map(str::to_string);
    let url = path.and_then(|p| {
        let p = FsPath::new(p);
        let roots = plan_local_roots(file, id);
        roots
            .iter()
            .find_map(|root| p.strip_prefix(root).ok())
            .or_else(|| p.file_name().map(FsPath::new))
            .map(|p| format!("local://{}", p.to_string_lossy().replace('\\', "/")))
    });
    if plan_string(target.get("title")).is_none() {
        target["title"] = json!(title)
    }
    target["planUrl"] = json!(url);
}

pub(super) async fn plan_status(id: &str, file: &str) -> Result<Option<Value>, ApiError> {
    let live = crate::rpc::get_handle(id)
        .and_then(|h| h.plan_status.lock().clone())
        .filter(|v| v.get("v").and_then(Value::as_u64) == Some(1));
    let id = id.to_string();
    let file = PathBuf::from(file);
    tokio::task::spawn_blocking(move || {
        let persisted = live.is_none();
        let Some(mut raw) = (match live {
            Some(raw) => Some(raw),
            None => read_saved_plan(&file)?,
        }) else {
            return Ok(None);
        };
        restore_plan_body(&mut raw, persisted, &file, &id);
        Ok(normalize_plan_status(&raw, persisted))
    })
    .await
    .map_err(|e| bad_gateway(e.to_string()))?
    .map_err(|e: std::io::Error| bad_gateway(e.to_string()))
}

fn valid_behavior(b: &str) -> bool {
    matches!(b, "steer" | "followUp")
}

// ----------------------------------------------------------------- upload

#[derive(Deserialize)]
struct UploadQuery {
    name: Option<String>,
}

fn uploads_dir(state: &AppState, session_id: &str) -> PathBuf {
    let base = state
        .app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| crate::paths::data_dir());
    base.join("mobile-uploads").join(session_id)
}

/// Client image paths must remain inside this parent session's upload directory.
pub(super) async fn uploaded_image_paths(
    state: &AppState,
    id: &str,
    paths: Vec<String>,
) -> Result<Vec<String>, ApiError> {
    if paths.is_empty() {
        return Ok(paths);
    }
    let root = uploads_dir(state, id);
    tokio::task::spawn_blocking(move || validate_uploaded_image_paths(&root, paths))
        .await
        .map_err(|e| bad_gateway(e.to_string()))?
}

fn validate_uploaded_image_paths(
    root: &FsPath,
    mut paths: Vec<String>,
) -> Result<Vec<String>, ApiError> {
    use std::io::Read;
    let root = std::fs::canonicalize(root).map_err(|_| bad_request("图片上传目录不存在"))?;
    let mut total = 0u64;
    for path in &mut paths {
        let canon = std::fs::canonicalize(&*path).map_err(|_| bad_request("上传图片不存在"))?;
        if !canon.starts_with(&root) {
            return Err(err(StatusCode::FORBIDDEN, "图片不在当前会话上传目录内"));
        }
        let mut file = std::fs::File::open(&canon).map_err(|_| bad_request("上传图片无法读取"))?;
        let metadata = file.metadata().map_err(|_| bad_request("上传图片不存在"))?;
        total = total.saturating_add(metadata.len());
        if !metadata.is_file()
            || metadata.len() == 0
            || metadata.len() > MAX_UPLOAD as u64
            || total > MAX_PROMPT_BODY as u64
        {
            return Err(bad_request("图片为空、不是文件或超过上传上限"));
        }
        // Match the native pipeline's format guard without rereading/encoding its payload.
        let mut header = [0u8; 13];
        let size = metadata.len().min(header.len() as u64) as usize;
        file.read_exact(&mut header[..size])
            .map_err(|_| bad_request("上传图片无法读取"))?;
        if super::media::sniff(&header[..size]).is_none() {
            return Err(bad_request("不支持的图片格式（仅 png/jpeg/gif/webp）"));
        }
        *path = canon
            .into_os_string()
            .into_string()
            .map_err(|_| bad_request("图片路径不是有效的 UTF-8"))?;
    }
    Ok(paths)
}

/// First free path for `name` in `dir`; adds a random prefix on collision.
fn unique_path(dir: &FsPath, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let rand = &uuid::Uuid::new_v4().simple().to_string()[..8];
    dir.join(format!("{rand}-{name}"))
}

async fn upload<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    let state = app(&ctx)?;
    check_upload_size(body.len())?;
    let name = sanitize_filename(q.name.as_deref().unwrap_or(""));
    let dir = uploads_dir(state, &id);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("创建目录失败：{e}"),
        )
    })?;
    let path = unique_path(&dir, &name);
    tokio::fs::write(&path, &body).await.map_err(|e| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("保存文件失败：{e}"),
        )
    })?;
    Ok(Json(json!({
        "path": path.to_string_lossy(),
        "name": path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(name),
        "size": body.len(),
    })))
}

// ------------------------------------------------------- prompt / abort

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptExBody {
    #[serde(default)]
    text: String,
    #[serde(default)]
    images: Vec<ImageIn>,
    streaming_behavior: Option<String>,
}

async fn prompt_ex<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<PromptExBody>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    let text = body.text.trim();
    if text.is_empty() && body.images.is_empty() {
        return Err(bad_request("内容为空"));
    }
    if let Some(b) = body.streaming_behavior.as_deref() {
        if !valid_behavior(b) {
            return Err(bad_request("streamingBehavior 必须是 steer 或 followUp"));
        }
    }
    let images = build_images(&body.images)?;
    // omp rejects an empty message; images without text get a neutral one.
    let text = if text.is_empty() {
        "（图片）"
    } else {
        text
    };
    let message = text.to_string();
    let (real, streaming) = send_prompt_ex(
        &ctx,
        &id,
        &message,
        images,
        body.streaming_behavior.as_deref(),
    )
    .await?;
    let mut out = json!({"ok": true, "streaming": streaming});
    if let Some(real) = real {
        out["sessionId"] = json!(real);
    }
    Ok(Json(out))
}

/// Stop like Esc in omp's TUI: the queued steer/follow-up inputs are withdrawn
/// and returned instead of running after the abort (desktop uses the same
/// command in `src/features/chat/send.ts`).
fn abort_command() -> Value {
    json!({"type": "abort_and_restore_queue"})
}

/// Texts of omp's `abort_and_restore_queue` result `{steering, followUp}`
/// (entries `{text}`), steering first; mirrors desktop `restoredQueueTexts`.
fn restored_queue_texts(resp: &Value) -> Vec<String> {
    let data = data_of(resp);
    let pick = |list: Option<&Value>| -> Vec<String> {
        list.and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|x| {
                        let t = x
                            .as_str()
                            .map(str::to_string)
                            .or_else(|| x.get("text").and_then(Value::as_str).map(str::to_string));
                        t.filter(|t| !t.trim().is_empty())
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    [pick(data.get("steering")), pick(data.get("followUp"))].concat()
}

async fn abort<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    let state = app(&ctx)?;
    if !crate::rpc::is_live(&id) {
        return Err(err(StatusCode::CONFLICT, "会话未在运行"));
    }
    let resp = rpc_cmd(state, &id, abort_command())
        .await
        .map_err(bad_gateway)?;
    Ok(Json(
        json!({"aborted": true, "restoredTexts": restored_queue_texts(&resp)}),
    ))
}

// ------------------------------------------------------- conversation tree

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NavigateTreeBody {
    entry_id: String,
}

/// Map a `navigate_tree` / `get_tree` failure to a friendly HTTP error.
fn tree_error(e: String) -> ApiError {
    match e.as_str() {
        crate::rpc::tree::ERR_BUSY => err(StatusCode::CONFLICT, "会话正在回答，完成后可切换版本"),
        crate::rpc::tree::ERR_ENTRY_NOT_FOUND => {
            err(StatusCode::NOT_FOUND, "会话记录里找不到这条消息")
        }
        "session is not live" => err(StatusCode::CONFLICT, "会话未在运行"),
        _ => bad_gateway(e),
    }
}

/// `POST /sessions/{id}/navigate-tree {entryId}` → upstream `navigate_tree`
/// data (`{cancelled, editorText?}`): move the same-session leaf pointer.
/// A user-message target rewinds past itself and returns its text for the
/// composer. Success broadcasts to every client (SSE `touch` / desktop event).
async fn navigate_tree<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<NavigateTreeBody>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    if !crate::rpc::is_live(&id) {
        return Err(err(StatusCode::CONFLICT, "会话未在运行"));
    }
    let entry_id = body.entry_id.trim();
    if entry_id.is_empty() {
        return Err(bad_request("entryId 不能为空"));
    }
    let state = app(&ctx)?;
    Ok(Json(
        crate::rpc::tree::navigate(state, &id, entry_id)
            .await
            .map_err(tree_error)?,
    ))
}

/// `GET /sessions/{id}/tree` → upstream `get_tree` data verbatim
/// (`{tree, leafId}`), so clients can filter the transcript to the
/// root→leaf path.
async fn session_tree<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    if !crate::rpc::is_live(&id) {
        return Err(err(StatusCode::CONFLICT, "会话未在运行"));
    }
    Ok(Json(
        crate::rpc::tree::get_tree(&id).await.map_err(tree_error)?,
    ))
}

// ------------------------------------------------------- batch approval

#[derive(Deserialize)]
struct UiRespondAllBody {
    action: String,
    ids: Vec<String>,
}

/// Option label of an `extension_ui_request` select (plain string or object).
fn option_label(o: &Value) -> Option<&str> {
    o.as_str()
        .or_else(|| o.get("label").and_then(Value::as_str))
        .or_else(|| o.get("value").and_then(Value::as_str))
}

/// The response that approves (`approve = true`) or denies one pending UI
/// request, or `None` when it is not a tool approval / confirm dialog and
/// must be left for the user. Mirrors the desktop `PendingUiCard`: a select is
/// an approval only with omp's exact once/Deny labels; a confirm answers
/// `confirmed`.
fn batch_response(request: &Value, approve: bool) -> Option<Value> {
    let id = request.get("id").and_then(Value::as_str)?;
    let method = request.get("method").and_then(Value::as_str)?;
    match method {
        "confirm" => Some(json!({"id": id, "confirmed": approve})),
        "select" => {
            let title = request.get("title").and_then(Value::as_str).unwrap_or("");
            let lower = title.to_lowercase();
            if !(lower.contains("allow")
                || lower.contains("approve")
                || title.contains("权限")
                || title.contains("允许"))
            {
                return None;
            }
            let labels: Vec<&str> = request
                .get("options")
                .or_else(|| request.get("choices"))
                .and_then(Value::as_array)?
                .iter()
                .filter_map(option_label)
                .collect();
            let once = labels
                .iter()
                .find(|l| **l == "Approve Once")
                .or_else(|| labels.iter().find(|l| **l == "Approve"))?;
            let deny = labels.iter().find(|l| **l == "Deny")?;
            Some(if approve {
                json!({"id": id, "value": once, "confirmed": true})
            } else {
                json!({"id": id, "value": deny, "confirmed": false, "cancelled": true})
            })
        }
        _ => None,
    }
}

/// `POST /sessions/{id}/ui-respond-all {action:"approve"|"deny",ids:[...]}` →
/// `{handled, skipped, handledIds}`. Only explicitly seen IDs may be answered.
/// A missing ID list is rejected by JSON extraction, never expanded to all current requests.
async fn ui_respond_all<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<UiRespondAllBody>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    let approve = match body.action.as_str() {
        "approve" => true,
        "deny" => false,
        _ => return Err(bad_request("action 必须是 approve 或 deny")),
    };
    if body.ids.len() > 1000 || body.ids.iter().any(|id| id.is_empty() || id.len() > 256) {
        return Err(bad_request("审批编号列表无效"));
    }
    if super::draft::is_draft(&id) {
        return Ok(Json(json!({"handled": 0, "skipped": 0, "handledIds": []})));
    }
    let (mut handled, mut skipped) = (0u32, 0u32);
    let mut wanted: std::collections::HashSet<String> = body.ids.into_iter().collect();
    let mut handled_ids = Vec::new();
    for p in ctx.backend.pending_ui(&id).await {
        let Some(request_id) = p.request.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !wanted.remove(request_id) {
            continue;
        }
        let Some(mut response) = batch_response(&p.request, approve) else {
            skipped += 1;
            continue;
        };
        response["type"] = json!("extension_ui_response");
        match ctx.backend.ui_respond(&id, response).await {
            Ok(()) => {
                handled += 1;
                handled_ids.push(request_id.to_string());
            }
            Err(_) => skipped += 1,
        }
    }
    skipped += wanted.len() as u32;
    Ok(Json(
        json!({"handled": handled, "skipped": skipped, "handledIds": handled_ids}),
    ))
}

// ------------------------------------------------------- slash commands

struct Cmd {
    name: &'static str,
    title: &'static str,
    description: &'static str,
    arg_hint: Option<&'static str>,
    group: &'static str,
    /// true = executed by this server; false = forwarded as `/name args`.
    native: bool,
    needs_arg: bool,
}

const fn cmd(
    name: &'static str,
    title: &'static str,
    description: &'static str,
    arg_hint: Option<&'static str>,
    group: &'static str,
    native: bool,
    needs_arg: bool,
) -> Cmd {
    Cmd {
        name,
        title,
        description,
        arg_hint,
        group,
        native,
        needs_arg,
    }
}

/// Curated mobile commands (subset of `slash/registry.ts`).
const CURATED: &[Cmd] = &[
    cmd(
        "new",
        "新会话",
        "在当前目录开始一个新会话",
        None,
        "会话",
        true,
        false,
    ),
    cmd(
        "fork",
        "分叉",
        "复制当前对话为新会话，并发送这条消息",
        Some("<消息>"),
        "会话",
        true,
        true,
    ),
    cmd(
        "btw",
        "顺便问一句",
        "开一个侧聊提问，不打断当前会话",
        Some("<问题>"),
        "会话",
        true,
        true,
    ),
    cmd(
        "rename",
        "重命名",
        "修改当前会话的名称",
        Some("<名称>"),
        "会话",
        true,
        true,
    ),
    cmd(
        "compact",
        "压缩上下文",
        "压缩会话上下文，可附带自定义指令",
        Some("[指令]"),
        "会话",
        true,
        false,
    ),
    cmd(
        "handoff",
        "交接",
        "总结当前会话为交接文档并压缩上下文",
        None,
        "会话",
        true,
        false,
    ),
    cmd(
        "retry",
        "重试",
        "重试上一次失败的回合",
        None,
        "会话",
        false,
        false,
    ),
    cmd(
        "resume",
        "继续",
        "恢复上一次被打断的回合",
        None,
        "会话",
        true,
        false,
    ),
    cmd(
        "plan",
        "规划模式",
        "切换规划模式：先出计划再执行",
        None,
        "会话",
        false,
        false,
    ),
    cmd(
        "goal",
        "目标",
        "设置或更新持续追求的目标",
        Some("<目标描述 | pause | resume | off>"),
        "会话",
        true,
        false,
    ),
    cmd(
        "model",
        "切换模型",
        "切换当前会话模型",
        Some("<provider/模型 id>"),
        "模型",
        true,
        true,
    ),
    cmd(
        "thinking",
        "思考等级",
        "设置思考等级",
        Some("<等级>"),
        "模型",
        true,
        true,
    ),
    cmd(
        "fast",
        "快速模式",
        "切换快速服务档位",
        Some("[on|off]"),
        "模型",
        true,
        false,
    ),
    cmd(
        "slow",
        "慢速模式",
        "切换低优先级/经济服务档位",
        Some("[on|off]"),
        "模型",
        true,
        false,
    ),
    cmd(
        "status",
        "会话状态",
        "查看模型、思考、目标与运行状态",
        None,
        "状态",
        true,
        false,
    ),
    cmd(
        "tools",
        "工具列表",
        "列出当前对代理可见的工具",
        None,
        "状态",
        false,
        false,
    ),
    cmd(
        "jobs",
        "后台任务",
        "查看异步后台任务状态",
        None,
        "状态",
        false,
        false,
    ),
    cmd(
        "init",
        "初始化项目",
        "为当前项目生成 AGENTS.md 等配置",
        None,
        "更多 OMP 命令",
        false,
        false,
    ),
    cmd(
        "review",
        "代码审查",
        "让代理审查当前改动",
        Some("[说明]"),
        "更多 OMP 命令",
        false,
        false,
    ),
    cmd(
        "security",
        "安全检查",
        "检查环境与权限配置",
        None,
        "更多 OMP 命令",
        false,
        false,
    ),
    cmd(
        "skill:visualize",
        "Visualize",
        "创建可视化和交互工具",
        Some("<要可视化的内容>"),
        "技能",
        false,
        true,
    ),
];

/// Desktop registry commands that need desktop UI (or are served natively
/// above). Dynamic omp commands with these names are shadowed, as on desktop.
const DESKTOP_ONLY: &[&str] = &[
    "export",
    "copy",
    "share",
    "changelog",
    "todo",
    "stats",
    "context",
    "usage",
    "advisor",
    "mcp",
    "plugins",
    "plugin",
    "marketplace",
    "memory",
    "browser",
    "computer",
    "extended-context",
    "agents",
    "approvals",
    "login",
    "settings",
    "models",
    "visualize",
];

fn is_curated(name: &str) -> bool {
    CURATED.iter().any(|c| c.name == name)
}

/// Canonical command name: strips `/`, lower-cases aliases handled by the
/// desktop registry (`models`→`model`, `visualize`→`skill:visualize`).
fn canonical_name(raw: &str) -> String {
    let n = raw.trim().trim_start_matches('/');
    match n {
        "models" => "model".into(),
        "visualize" => "skill:visualize".into(),
        _ => n.to_string(),
    }
}

fn valid_cmd_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 64
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
}

async fn slash_commands<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let meta = load_session(&ctx, &id).await?;
    let mut list: Vec<Value> = CURATED
        .iter()
        .map(|c| {
            json!({
                "name": c.name,
                "title": c.title,
                "description": c.description,
                "argHint": c.arg_hint,
                "group": c.group,
                "kind": if c.native { "native" } else { "forward" },
                "needsArg": c.needs_arg,
            })
        })
        .collect();
    // Custom commands/skills as discovered by the running omp process. Never
    // resume here: this is a read-only GET fired on chat open, and resuming
    // would take over (kill) an external omp running the session.
    {
        if let Some(handle) = crate::rpc::get_handle(&id) {
            if let Ok(resp) =
                crate::rpc::send_command(&handle, json!({"type": "get_available_commands"})).await
            {
                let data = data_of(&resp);
                let arr = data
                    .get("commands")
                    .and_then(Value::as_array)
                    .or_else(|| data.as_array());
                for c in arr.into_iter().flatten() {
                    let Some(name) = c.get("name").and_then(Value::as_str) else {
                        continue;
                    };
                    let name = name.trim_start_matches('/');
                    if !valid_cmd_name(name)
                        || is_curated(name)
                        || DESKTOP_ONLY.contains(&name)
                        || list.iter().any(|v| v["name"] == name)
                    {
                        continue;
                    }
                    let hint = c
                        .pointer("/input/hint")
                        .or_else(|| c.get("hint"))
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty());
                    list.push(json!({
                        "name": name,
                        "title": name,
                        "description": c.get("description").and_then(Value::as_str).unwrap_or(""),
                        "argHint": hint,
                        "group": "自定义",
                        "kind": "custom",
                        "needsArg": false,
                    }));
                }
            }
        }
    }
    // A draft has no process yet: custom commands come from disk skills.
    if super::draft::is_draft(&id) {
        if let Ok(catalog) = crate::skills::commands::skills_list(Some(meta.cwd.clone())).await {
            for s in catalog.skills {
                let name = format!("skill:{}", s.name);
                if !valid_cmd_name(&name) || list.iter().any(|v| v["name"] == name.as_str()) {
                    continue;
                }
                list.push(json!({
                    "name": name,
                    "title": name,
                    "description": s.description,
                    "argHint": Value::Null,
                    "group": "自定义",
                    "kind": "custom",
                    "needsArg": false,
                }));
            }
        }
    }
    Ok(Json(Value::Array(list)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlashBody {
    name: String,
    #[serde(default)]
    args: String,
    /// `fork` only: cut the copy right after this transcript item id.
    entry_id: Option<String>,
}

fn goal_of(state: &Value) -> Option<(String, String)> {
    let g = state.get("goal")?;
    let goal = g.get("goal").unwrap_or(g);
    let objective = goal.get("objective")?.as_str()?.to_string();
    let status = goal
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Some((objective, status))
}

fn goal_json(state: &Value) -> Value {
    goal_of(state).map_or(Value::Null, |(o, s)| json!({"objective": o, "status": s}))
}

/// Goal ops exactly as `registry.ts`/`GoalBar`: `{type:"goal", op, ...}` then
/// a `get_state` refresh. Returns the refreshed state.
async fn goal_op(
    state: &AppState,
    id: &str,
    op: &str,
    objective: Option<&str>,
) -> Result<Value, ApiError> {
    live(state, id).await?;
    let mut cmd = json!({"type": "goal", "op": op});
    if let Some(o) = objective {
        cmd["objective"] = json!(o);
    }
    rpc_cmd(state, id, cmd).await.map_err(bad_gateway)?;
    let resp = rpc_cmd(state, id, json!({"type": "get_state"}))
        .await
        .map_err(bad_gateway)?;
    Ok(data_of(&resp).clone())
}

/// Create a goal, dropping an existing one first (desktop `/goal <text>`).
async fn goal_create(state: &AppState, id: &str, objective: &str) -> Result<Value, ApiError> {
    live(state, id).await?;
    if let Some(cur) = live_state(id).await {
        if goal_of(&cur).is_some() {
            goal_op(state, id, "drop", None).await?;
        }
    }
    goal_op(state, id, "create", Some(objective)).await
}

fn short(s: &str, n: usize) -> String {
    if s.chars().count() > n {
        format!("{}…", s.chars().take(n).collect::<String>())
    } else {
        s.to_string()
    }
}

fn model_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Object(o) => {
            let p = o.get("provider").and_then(Value::as_str).unwrap_or("");
            let id = o
                .get("id")
                .or_else(|| o.get("modelId"))
                .and_then(Value::as_str)
                .unwrap_or("");
            match (p.is_empty(), id.is_empty()) {
                (false, false) => format!("{p}/{id}"),
                (true, false) => id.to_string(),
                _ => p.to_string(),
            }
        }
        _ => String::new(),
    }
}

fn status_text(id: &str, meta: &SessionMeta, st: Option<&Value>) -> String {
    let mut lines = vec!["**会话状态**".to_string()];
    match st {
        Some(st) => {
            let model = st.get("model").map(model_text).filter(|s| !s.is_empty());
            lines.push(format!(
                "- 模型：{}",
                model
                    .or_else(|| meta.model.clone())
                    .unwrap_or_else(|| "未知".into())
            ));
            if let Some(t) = st.get("thinkingLevel").and_then(Value::as_str) {
                lines.push(format!("- 思考等级：{t}"));
            }
            let streaming = st
                .get("isStreaming")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            lines.push(format!(
                "- 状态：{}",
                if streaming { "运行中" } else { "空闲" }
            ));
            if let Some(p) = st.pointer("/contextUsage/percent").and_then(Value::as_f64) {
                lines.push(format!("- 上下文占用：{:.0}%", p * 100.0));
            }
            if let Some((o, s)) = goal_of(st) {
                lines.push(format!("- 目标：{}（{s}）", short(&o, 60)));
            }
        }
        None => {
            lines.push(format!(
                "- 模型：{}",
                meta.model.clone().unwrap_or_else(|| "未知".into())
            ));
            lines.push("- 状态：进程未运行".into());
        }
    }
    lines.push(format!(
        "- 规划模式：{}",
        if plan_enabled(id) { "开" } else { "关" }
    ));
    lines.join("\n")
}

fn parse_toggle(args: &str, current: bool) -> Result<bool, ApiError> {
    match args.trim().to_ascii_lowercase().as_str() {
        "" => Ok(!current),
        "on" | "开" | "1" | "true" => Ok(true),
        "off" | "关" | "0" | "false" => Ok(false),
        _ => Err(bad_request("参数必须是 on 或 off")),
    }
}

/// Resolve `/model` args to `(provider, modelId)`: `provider/id` directly,
/// otherwise a unique id match among the process's available models.
async fn resolve_model(
    state: &AppState,
    id: &str,
    arg: &str,
) -> Result<(String, String), ApiError> {
    if let Some((p, m)) = arg.split_once('/') {
        let (p, m) = (p.trim(), m.trim());
        if !p.is_empty() && !m.is_empty() {
            return Ok((p.into(), m.into()));
        }
    }
    let resp = rpc_cmd(state, id, json!({"type": "get_available_models"}))
        .await
        .map_err(bad_gateway)?;
    let data = data_of(&resp);
    let arr = data
        .get("models")
        .and_then(Value::as_array)
        .or_else(|| data.as_array());
    let hits: Vec<(String, String)> = arr
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let mid = m.get("id").and_then(Value::as_str)?;
            let p = m.get("provider").and_then(Value::as_str)?;
            (mid == arg).then(|| (p.to_string(), mid.to_string()))
        })
        .collect();
    match hits.len() {
        1 => Ok(hits.into_iter().next().unwrap_or_default()),
        0 => Err(bad_request("未找到该模型，请使用 provider/模型 id")),
        _ => Err(bad_request("模型 id 不唯一，请使用 provider/模型 id")),
    }
}

async fn slash<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<SlashBody>,
) -> ApiResult<Value> {
    let meta = load_session(&ctx, &id).await?;
    let state = app(&ctx)?;
    let name = canonical_name(&body.name);
    if !valid_cmd_name(&name) {
        return Err(bad_request("非法命令名"));
    }
    let args = body.args.trim();
    let ok = |extra: Value| -> ApiResult<Value> {
        let mut v = json!({"ok": true});
        if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        Ok(Json(v))
    };
    let fwd_id = id.clone();
    let forward = |text: String| {
        let text = text.trim().to_string();
        let id = fwd_id.clone();
        let ctx = &ctx;
        async move {
            let (real, _) = send_prompt_ex(ctx, &id, &text, Vec::new(), None).await?;
            let mut out = json!({"ok": true, "forwarded": true});
            if let Some(real) = real {
                out["sessionId"] = json!(real);
            }
            Ok::<_, ApiError>(Json(out))
        }
    };
    // A draft has no omp process yet: commands that act on one cannot run.
    let is_draft = super::draft::is_draft(&id);
    if is_draft
        && matches!(
            name.as_str(),
            "fork" | "btw" | "rename" | "compact" | "handoff" | "goal" | "fast" | "slow"
        )
    {
        return Err(err(
            StatusCode::CONFLICT,
            "新会话还没有内容，请先发送第一条消息",
        ));
    }

    match name.as_str() {
        "new" => {
            if meta.cwd.is_empty() {
                return Err(bad_request("无法确定当前目录"));
            }
            let info = super::draft::create(
                meta.cwd.clone(),
                meta.mode,
                meta.group_id.clone(),
                meta.workspace_id.clone(),
            )
            .await;
            ok(json!({"sessionId": info.session_id}))
        }
        "fork" => {
            let entry_id = body.entry_id.as_deref().filter(|e| !e.is_empty());
            if args.is_empty() && entry_id.is_none() {
                return Err(bad_request("用法: /fork <消息>（分支后发送的第一条消息）"));
            }
            let st = state.app.state::<AppState>();
            let info = crate::rpc::fork::create(&st, &id, entry_id.map(str::to_string), None)
                .await
                .map_err(bad_gateway)?;
            if !args.is_empty() {
                send_prompt_ex(&ctx, &info.session_id, args, Vec::new(), None).await?;
            }
            ok(json!({"sessionId": info.session_id}))
        }
        "btw" => {
            if args.is_empty() {
                return Err(bad_request("用法: /btw <问题>"));
            }
            let st = state.app.state::<AppState>();
            let info = crate::rpc::sidechat::create(&st, &id, None)
                .await
                .map_err(bad_gateway)?;
            crate::rpc::sidechat::ask(&st, &info.session_id, args.to_string(), None, None, None)
                .await
                .map_err(bad_gateway)?;
            ok(json!({"sessionId": info.session_id}))
        }
        "rename" => {
            if args.is_empty() {
                return Err(bad_request("用法: /rename <名称>"));
            }
            live(state, &id).await?;
            rpc_cmd(
                state,
                &id,
                json!({"type": "set_session_name", "name": args}),
            )
            .await
            .map_err(bad_gateway)?;
            ok(json!({"output": format!("已重命名为「{args}」")}))
        }
        "compact" => {
            live(state, &id).await?;
            let mut cmd = json!({"type": "compact"});
            if !args.is_empty() {
                cmd["customInstructions"] = json!(args);
            }
            rpc_cmd(state, &id, cmd).await.map_err(bad_gateway)?;
            let _ = rpc_cmd(state, &id, json!({"type": "get_state"})).await;
            ok(json!({"output": "上下文压缩完成"}))
        }
        "handoff" => {
            live(state, &id).await?;
            let resp = rpc_cmd(state, &id, json!({"type": "handoff"}))
                .await
                .map_err(bad_gateway)?;
            let path = data_of(&resp).get("savedPath").and_then(Value::as_str);
            ok(
                json!({"output": path.map_or("交接完成".to_string(), |p| format!("交接文档已保存: {p}"))}),
            )
        }
        // Desktop only continues when the last assistant message was aborted;
        // the transcript check is left to omp (a stray "Continue" is harmless).
        "resume" => {
            send_prompt_ex(&ctx, &id, "Continue", Vec::new(), None).await?;
            ok(json!({}))
        }
        "goal" => {
            let lower = args.to_ascii_lowercase();
            if args.is_empty() {
                let cur = live_state(&id).await;
                let text = match cur.as_ref().and_then(goal_of) {
                    Some((o, _)) => format!("当前目标：{o}"),
                    None => "当前没有目标".into(),
                };
                return ok(json!({"output": text}));
            }
            let st = if matches!(lower.as_str(), "off" | "drop") {
                goal_op(state, &id, "drop", None).await?
            } else if matches!(lower.as_str(), "pause") || args == "暂停" {
                goal_op(state, &id, "pause", None).await?
            } else if matches!(lower.as_str(), "resume") || args == "继续" {
                goal_op(state, &id, "resume", None).await?
            } else {
                goal_create(state, &id, args).await?
            };
            ok(json!({"goal": goal_json(&st)}))
        }
        "model" => {
            if args.is_empty() {
                return Err(bad_request("用法: /model <provider/模型 id>"));
            }
            if is_draft {
                let (p, m) = split_model(args);
                if p.is_empty() || m.is_empty() {
                    return Err(bad_request("新会话请使用 provider/模型 id"));
                }
                super::draft::set_model(&id, p.clone(), m.clone()).await;
                super::draft::set_active(ctx.clone(), &id, true, true).await;
                return ok(json!({"output": format!("已切换模型：{p}/{m}")}));
            }
            live(state, &id).await?;
            let (provider, model_id) = resolve_model(state, &id, args).await?;
            rpc_cmd(
                state,
                &id,
                json!({"type": "set_model", "provider": provider, "modelId": model_id}),
            )
            .await
            .map_err(bad_gateway)?;
            let _ = rpc_cmd(state, &id, json!({"type": "get_state"})).await;
            ok(json!({"output": format!("已切换模型：{provider}/{model_id}")}))
        }
        "thinking" => {
            let level = args.to_ascii_lowercase();
            if level.is_empty()
                || !level
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return Err(bad_request("用法: /thinking <等级>"));
            }
            if is_draft {
                super::draft::set_thinking(&id, level.clone()).await;
                super::draft::set_active(ctx.clone(), &id, true, true).await;
                return ok(json!({"output": format!("思考等级：{level}")}));
            }
            live(state, &id).await?;
            rpc_cmd(
                state,
                &id,
                json!({"type": "set_thinking_level", "level": level}),
            )
            .await
            .map_err(bad_gateway)?;
            let _ = rpc_cmd(state, &id, json!({"type": "get_state"})).await;
            ok(json!({"output": format!("思考等级：{level}")}))
        }
        "fast" | "slow" => {
            live(state, &id).await?;
            let key = if name == "fast" {
                "fastModeEnabled"
            } else {
                "slowModeEnabled"
            };
            let cur = live_state(&id)
                .await
                .and_then(|s| s.get(key).and_then(Value::as_bool))
                .unwrap_or(false);
            let enabled = parse_toggle(args, cur)?;
            let ty = if name == "fast" {
                "set_fast_mode"
            } else {
                "set_slow_mode"
            };
            rpc_cmd(state, &id, json!({"type": ty, "enabled": enabled}))
                .await
                .map_err(bad_gateway)?;
            let label = if name == "fast" {
                "快速模式"
            } else {
                "慢速模式"
            };
            ok(json!({"output": format!("{label}已{}", if enabled { "开启" } else { "关闭" })}))
        }
        "status" => {
            let st = live_state(&id).await;
            ok(json!({"output": status_text(&id, &meta, st.as_ref())}))
        }
        n if is_curated(n) => forward(format!("/{n} {args}")).await,
        n if DESKTOP_ONLY.contains(&n) => Err(bad_request("该命令仅桌面端可用")),
        // Custom command / skill reported by omp.
        n => forward(format!("/{n} {args}")).await,
    }
}

// -------------------------------------------------- composer state & goal

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftActivityBody {
    active: bool,
    #[serde(default)]
    meaningful: bool,
}

async fn draft_activity<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<DraftActivityBody>,
) -> ApiResult<Value> {
    check_id(&id)?;
    if super::draft::is_draft(&id) {
        super::draft::set_active(ctx.clone(), &id, body.active, body.meaningful).await;
    }
    Ok(Json(json!({"ok": true})))
}

/// Context-window usage shown by the phone's usage chip; all `None` when unknown.
#[derive(Default, Debug, PartialEq)]
struct ContextUsage {
    tokens: Option<u64>,
    window: Option<u64>,
    percent: Option<f64>,
}

/// Derive usage from omp `get_state` (`contextUsage.tokens`, window from
/// `contextUsage.contextWindow` or the model's `contextWindow`), the same
/// fields the desktop composer's context ring reads. A session without a live
/// process falls back to the transcript snapshot's token count (no window).
fn context_usage(state: Option<&Value>, snapshot_tokens: Option<u64>) -> ContextUsage {
    let live = state
        .and_then(|s| s.get("contextUsage"))
        .filter(|u| u.is_object());
    let tokens = live
        .and_then(|u| u.get("tokens"))
        .and_then(Value::as_u64)
        .or(snapshot_tokens);
    let window = live
        .and_then(|u| u.get("contextWindow"))
        .or_else(|| state.and_then(|s| s.pointer("/model/contextWindow")))
        .and_then(Value::as_u64)
        .filter(|w| *w > 0);
    let percent = match (tokens, window) {
        (Some(t), Some(w)) => Some(t as f64 / w as f64 * 100.0),
        _ => live.and_then(|u| u.get("percent")).and_then(Value::as_f64),
    };
    ContextUsage {
        tokens,
        window,
        percent,
    }
}

/// omp's queued user messages from `get_state.queuedMessages`
/// (`{steering, followUp, liveSteered}`), the same snapshot `queue_update`
/// frames carry. Empty queues when there is no live process.
fn queue_json(state: Option<&Value>) -> Value {
    let q = state.and_then(|s| s.get("queuedMessages"));
    let texts = |key: &str| -> Vec<&str> {
        q.and_then(|q| q.get(key))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    };
    json!({
        "steering": texts("steering"),
        "followUp": texts("followUp"),
        "liveSteered": q.and_then(|q| q.get("liveSteered")).and_then(Value::as_u64).unwrap_or(0),
    })
}

async fn composer_state<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let meta = load_session(&ctx, &id).await?;
    let selection = super::draft::selection(&id).await;
    let draft_model = match &selection {
        Some(s) if s.model.is_none() => {
            super::draft::default_model(ctx.backend.app_state(), &id).await
        }
        _ => None,
    };
    let draft_thinking = selection
        .as_ref()
        .and_then(|s| s.thinking.clone())
        .map(Value::String);
    let selected_model = selection
        .as_ref()
        .and_then(|s| s.model.as_ref())
        .map(|(p, m)| format!("{p}/{m}"));
    let is_draft = selection.is_some();
    let st = live_state(&id).await;
    let streaming = crate::rpc::get_handle(&id)
        .is_some_and(|h| h.streaming.load(std::sync::atomic::Ordering::SeqCst));
    let model = selected_model
        .or_else(|| {
            st.as_ref()
                .and_then(|s| s.get("model"))
                .map(model_text)
                .filter(|s| !s.is_empty())
        })
        .or(meta.model.clone())
        .or(draft_model);
    let snapshot_tokens = match (&st, ctx.backend.app_state()) {
        (None, Some(state)) if !is_draft => {
            crate::catalog::commands::session_snapshot(state.app.state::<AppState>(), id.clone())
                .await
                .ok()
                .and_then(|s| s.context_tokens)
        }
        _ => None,
    };
    let usage = if is_draft {
        ContextUsage::default()
    } else {
        context_usage(st.as_ref(), snapshot_tokens)
    };
    let plan_status = if is_draft {
        None
    } else {
        plan_status(&id, &meta.file).await?
    };
    Ok(Json(json!({
        "live": st.is_some(),
        "streaming": streaming,
        "contextTokens": usage.tokens,
        "contextWindow": usage.window,
        "contextPercent": usage.percent,
        "model": model,
        "thinkingLevel": draft_thinking.or_else(|| st.as_ref().and_then(|s| s.get("thinkingLevel")).cloned()),
        "planMode": plan_status.as_ref().and_then(|s| s.get("enabled")).and_then(Value::as_bool).unwrap_or(false),
        "planStatus": plan_status,
        "goal": st.as_ref().map_or(Value::Null, goal_json),
        "fastMode": st.as_ref().and_then(|s| s.get("fastModeEnabled")).and_then(Value::as_bool).unwrap_or(false),
        "slowMode": st.as_ref().and_then(|s| s.get("slowModeEnabled")).and_then(Value::as_bool).unwrap_or(false),
        "queue": queue_json(st.as_ref()),
        "state": st,
    })))
}

// ------------------------------------------------- model / thinking pickers

/// Flatten omp's `thinking` field: `["low","high"]` or `{efforts:[…]}`.
fn extract_levels(v: Option<&Value>) -> Vec<String> {
    let arr = match v {
        Some(Value::Array(a)) => Some(a),
        Some(Value::Object(o)) => o.get("efforts").and_then(Value::as_array),
        _ => None,
    };
    arr.into_iter()
        .flatten()
        .filter_map(|x| x.as_str().map(str::to_string))
        .collect()
}

/// Split `provider/id`; a bare id yields an empty provider.
fn split_model(text: &str) -> (String, String) {
    match text.split_once('/') {
        Some((p, m)) => (p.trim().to_string(), m.trim().to_string()),
        None => (String::new(), text.trim().to_string()),
    }
}

/// Model + thinking-level facts for the pickers. Reads only: a live process is
/// queried through its existing handle, otherwise the transcript snapshot and
/// session metadata are used. Never resumes the session.
async fn model_facts(state: &AppState, meta: &SessionMeta, id: &str) -> Value {
    let st = live_state(id).await;
    let draft = super::draft::selection(id).await;
    let is_draft = draft.is_some();
    // A draft's own choice always wins over the prewarmed process and over
    // the default model; the draft default only fills an untouched draft.
    let selected_model = draft
        .as_ref()
        .and_then(|s| s.model.as_ref())
        .map(|(p, m)| format!("{p}/{m}"));
    let model_v = if selected_model.is_some() {
        None
    } else {
        st.as_ref().and_then(|s| s.get("model"))
    };
    let draft_model = if is_draft && selected_model.is_none() && model_v.is_none() {
        super::draft::default_model(Some(state), id).await
    } else {
        None
    };
    let text = selected_model
        .or_else(|| model_v.map(model_text).filter(|s| !s.is_empty()))
        .or_else(|| meta.model.clone())
        .or(draft_model)
        .unwrap_or_default();
    let (provider, model_id) = split_model(&text);
    let live_level = st
        .as_ref()
        .and_then(|s| s.get("thinkingLevel"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let draft_thinking = draft.as_ref().and_then(|s| s.thinking.clone());
    let thinking_level = match draft_thinking.or(live_level) {
        Some(l) => Some(l),
        None if is_draft => None,
        None => crate::catalog::commands::session_snapshot(
            state.app.state::<AppState>(),
            id.to_string(),
        )
        .await
        .ok()
        .and_then(|s| s.thinking_level),
    };
    json!({
        "live": st.is_some(),
        "current": if model_id.is_empty() { Value::Null } else { json!({"provider": provider, "id": model_id}) },
        "thinkingLevel": thinking_level,
        "liveThinking": extract_levels(model_v.and_then(|m| m.get("thinking"))),
    })
}

async fn models_get<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let meta = load_session(&ctx, &id).await?;
    let state = app(&ctx)?;
    // Global catalog: separate read-only omp process, same source as desktop.
    let models = crate::catalog::commands::list_models(state.app.state::<AppState>())
        .await
        .map_err(bad_gateway)?;
    let mut out = model_facts(state, &meta, &id).await;
    out["models"] = serde_json::to_value(models.models).unwrap_or(Value::Null);
    out["catalogSource"] = json!(models.source);
    out["catalogCompleteness"] = json!(models.completeness);
    Ok(Json(out))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetModelBody {
    provider: String,
    model_id: String,
}

/// Resumes the session if needed (like desktop); `set_model` itself does not
/// abort a running turn.
async fn model_set<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<SetModelBody>,
) -> ApiResult<Value> {
    let meta = load_session(&ctx, &id).await?;
    let state = app(&ctx)?;
    let (provider, model_id) = (body.provider.trim(), body.model_id.trim());
    if provider.is_empty() || model_id.is_empty() || provider.len() > 200 || model_id.len() > 400 {
        return Err(bad_request("模型参数无效"));
    }
    if super::draft::set_model(&id, provider.to_string(), model_id.to_string()).await {
        super::draft::set_active(ctx.clone(), &id, true, true).await;
        let mut out = model_facts(state, &meta, &id).await;
        out["ok"] = json!(true);
        return Ok(Json(out));
    }
    live(state, &id).await?;
    rpc_cmd(
        state,
        &id,
        json!({"type": "set_model", "provider": provider, "modelId": model_id}),
    )
    .await
    .map_err(bad_gateway)?;
    let mut out = model_facts(state, &meta, &id).await;
    out["ok"] = json!(true);
    Ok(Json(out))
}

#[derive(Deserialize)]
struct SetThinkingBody {
    level: String,
}

async fn thinking_set<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<SetThinkingBody>,
) -> ApiResult<Value> {
    let meta = load_session(&ctx, &id).await?;
    let state = app(&ctx)?;
    let level = body.level.trim().to_ascii_lowercase();
    if level.is_empty()
        || level.len() > 32
        || !level
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(bad_request("思考等级无效"));
    }
    if super::draft::set_thinking(&id, level.clone()).await {
        super::draft::set_active(ctx.clone(), &id, true, true).await;
        let mut out = model_facts(state, &meta, &id).await;
        out["ok"] = json!(true);
        return Ok(Json(out));
    }
    live(state, &id).await?;
    rpc_cmd(
        state,
        &id,
        json!({"type": "set_thinking_level", "level": level}),
    )
    .await
    .map_err(bad_gateway)?;
    let mut out = model_facts(state, &meta, &id).await;
    out["ok"] = json!(true);
    Ok(Json(out))
}

#[derive(Deserialize)]
struct GoalBody {
    objective: Option<String>,
    op: Option<String>,
}

async fn goal_set<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<GoalBody>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    let state = app(&ctx)?;
    let st = match (body.op.as_deref(), body.objective.as_deref().map(str::trim)) {
        (Some(op @ ("pause" | "resume" | "drop")), _) => goal_op(state, &id, op, None).await?,
        (Some(_), _) => return Err(bad_request("op 必须是 pause、resume 或 drop")),
        (None, Some(o)) if !o.is_empty() => goal_create(state, &id, o).await?,
        _ => return Err(bad_request("缺少 objective")),
    };
    Ok(Json(json!({"ok": true, "goal": goal_json(&st)})))
}

async fn goal_clear<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    let state = app(&ctx)?;
    let st = goal_op(state, &id, "drop", None).await?;
    Ok(Json(json!({"ok": true, "goal": goal_json(&st)})))
}

#[derive(Deserialize)]
struct PlanBody {
    on: Option<bool>,
}

async fn plan_get<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    Ok(Json(json!({"on": plan_enabled(&id)})))
}

/// Desired plan state → the explicit extension command (never a toggle).
fn plan_command(want: bool) -> &'static str {
    if want {
        "/plan-action enable"
    } else {
        "/plan-action disable"
    }
}

/// Plan mode lives in the bundled omp extension: this sends `/plan-action
/// enable|disable` (never a toggle) and waits (briefly) for the extension's
/// `ompws-plan` status frame.
async fn plan_set<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<PlanBody>,
) -> ApiResult<Value> {
    load_session(&ctx, &id).await?;
    let cur = plan_enabled(&id);
    let want = body.on.unwrap_or(!cur);
    if want == cur {
        return Ok(Json(json!({"on": cur})));
    }
    let (real, _) = send_prompt_ex(&ctx, &id, plan_command(want), Vec::new(), None).await?;
    let target = real.as_deref().unwrap_or(&id);
    let mut on = plan_enabled(target);
    for _ in 0..60 {
        if on != cur {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        on = plan_enabled(target);
    }
    let mut out = json!({"on": on});
    if let Some(real) = real {
        out["sessionId"] = json!(real);
    }
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn prompt_delivery_preserves_queue_policy_across_a_late_turn_start() {
        use std::sync::atomic::Ordering;
        use std::sync::Arc;
        use tokio::sync::mpsc;

        for behavior in [None, Some("steer"), Some("followUp"), Some("aside")] {
            for turn_started in [false, true] {
                let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                let handle = Arc::new(crate::rpc::SessionHandle {
                    stdin_tx: tx,
                    ..crate::rpc::SessionHandle::for_test()
                });
                let image = json!({"type":"image","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==","mimeType":"image/png"});
                // The host is idle while it prepares the mobile text and image.
                assert!(!handle.streaming.load(Ordering::SeqCst));
                let command =
                    crate::rpc::prompt_command("Mobile question", vec![image.clone()], behavior);
                let upstream = handle.clone();
                let consumer = tokio::spawn(async move {
                    let line = rx.recv().await.expect("mobile prompt delivered to RPC");
                    let sent: Value = serde_json::from_str(&line).unwrap();
                    // Upstream rechecks after asynchronous preparation. A new
                    // run here must use the user's policy, not refuse or steer
                    // a non-interrupting aside into a different queue.
                    upstream.streaming.store(turn_started, Ordering::SeqCst);
                    let delivered_as = if turn_started {
                        match sent["streamingBehavior"].as_str() {
                            Some("steer") => Some("steer"),
                            Some("followUp") => Some("followUp"),
                            Some("aside") => Some("aside"),
                            _ => None,
                        }
                    } else {
                        Some("started")
                    };
                    let response = match delivered_as {
                        Some(_) => {
                            json!({"type":"response","command":"prompt","id":sent["id"],"success":true})
                        }
                        None => {
                            json!({"type":"response","command":"prompt","id":sent["id"],"success":false,"error":"Agent is busy"})
                        }
                    };
                    upstream
                        .pending
                        .resolve(sent["id"].as_str().unwrap(), response);
                    (
                        delivered_as,
                        sent["message"].clone(),
                        sent["images"].clone(),
                    )
                });
                crate::rpc::send_command(&handle, command)
                    .await
                    .expect("mobile prompt accepted");
                let delivered_as = if turn_started {
                    behavior.unwrap_or("followUp")
                } else {
                    "started"
                };
                assert_eq!(
                    consumer.await.unwrap(),
                    (Some(delivered_as), json!("Mobile question"), json!([image]))
                );
            }
        }
    }

    #[test]
    fn plan_status_matches_desktop_defaults_and_approved_states() {
        assert!(normalize_plan_status(&json!({"enabled": true}), false).is_none());
        let planning = normalize_plan_status(&json!({
            "enabled": true, "phase": "review", "lastContent": "# Plan\nBody", "prevContent": "Before", "version": 3,
            "tiers": [{"role": "fast", "spec": "p/m"}, {"role": false, "spec": "bad"}],
        }), true).unwrap();
        assert_eq!(planning["content"], "# Plan\nBody");
        assert_eq!(planning["prevContent"], "Before");
        assert_eq!(planning["version"], 3);
        assert_eq!(planning["defaultRole"], "default");
        assert_eq!(planning["tiers"], json!([{"role": "fast", "spec": "p/m"}]));
        for state in ["executing", "completed", "failed", "handoff"] {
            let approved = normalize_plan_status(&json!({"v": 1, "enabled": false,
                "approved": {"content": "Approved snapshot", "status": state, "error": "aborted"}
            }), false).unwrap();
            assert_eq!(approved["enabled"], false);
            assert_eq!(approved["approved"]["content"], "Approved snapshot");
            assert_eq!(approved["approved"]["status"], state);
            assert_eq!(approved["approved"]["version"], 1);
        }
        let invalid = normalize_plan_status(
            &json!({"v": 1, "enabled": false,
            "approved": {"content": "Body", "status": "working"}}),
            false,
        )
        .unwrap();
        assert!(invalid["approved"].is_null());
        assert!(invalid["content"].is_null());
    }

    #[test]
    fn saved_plan_uses_latest_complete_custom_record_only() {
        let dir = std::env::temp_dir().join(format!("mobile-plan-lines-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s.jsonl");
        let entries = [
            json!({"type": "custom", "customType": "ompws-plan-state", "data": {"enabled": true, "lastContent": "Old"}}),
            json!({"type": "message", "customType": "ompws-plan-state", "data": {"enabled": true}}),
            json!({"type": "custom", "customType": "other", "data": {"enabled": true}}),
            json!({"type": "custom", "customType": "ompws-plan-state", "data": {"enabled": false}}),
        ];
        let mut body = entries.iter().map(|v| format!("{v}\n")).collect::<String>();
        body.push_str("{bad ompws-plan-state}\n");
        body.push_str(
            r#"{"type":"custom","customType":"ompws-plan-state","data":{"enabled":true}}"#,
        );
        std::fs::write(&file, body).unwrap();
        assert_eq!(
            read_saved_plan(&file).unwrap(),
            Some(json!({"enabled": false}))
        );
        assert_eq!(read_saved_plan(&dir.join("missing.jsonl")).unwrap(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn cold_plan_snapshot_restores_without_waking_session() {
        let id = format!("mobile-plan-cold-{}", uuid::Uuid::new_v4());
        let dir = std::env::temp_dir().join(&id);
        let file = dir.join("s.jsonl");
        let local = file.with_extension("").join("local");
        std::fs::create_dir_all(&local).unwrap();
        let plan = local.join("task-plan.md");
        std::fs::write(&plan, "# Actual plan\nReal body").unwrap();
        let entry = json!({"type": "custom", "customType": "ompws-plan-state", "data": {
            "enabled": false, "approved": {"planFile": plan, "content": "Approved before edits", "status": "executing", "version": 2}
        }});
        std::fs::write(&file, format!("{entry}\n")).unwrap();
        let status = plan_status(&id, file.to_str().unwrap())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status["approved"]["content"], "Approved before edits");
        assert_eq!(status["approved"]["status"], "executing");
        assert_eq!(status["approved"]["planUrl"], "local://task-plan.md");
        assert!(crate::rpc::get_handle(&id).is_none());
        let entry = json!({"type": "custom", "customType": "ompws-plan-state", "data": {
            "enabled": true, "planFile": plan, "phase": "review", "version": 1
        }});
        std::fs::write(&file, format!("{entry}\n")).unwrap();
        let status = plan_status(&id, file.to_str().unwrap())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status["content"], "# Actual plan\nReal body");
        assert_eq!(status["title"], "Actual plan");
        assert!(crate::rpc::get_handle(&id).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_plan_body_is_bounded_and_session_local() {
        let id = format!("mobile-plan-file-{}", uuid::Uuid::new_v4());
        let dir = std::env::temp_dir().join(&id);
        let file = dir.join("s.jsonl");
        let local = file.with_extension("").join("local");
        std::fs::create_dir_all(&local).unwrap();
        let outside = dir.join("outside.md");
        std::fs::write(&outside, "Outside").unwrap();
        assert!(read_local_plan(outside.to_str().unwrap(), &file, &id).is_none());
        assert!(read_local_plan(local.to_str().unwrap(), &file, &id).is_none());
        let huge = local.join("huge-plan.md");
        std::fs::write(&huge, vec![b'x'; 512 * 1024 + 1]).unwrap();
        assert!(read_local_plan(huge.to_str().unwrap(), &file, &id).is_none());
        #[cfg(unix)]
        {
            let link = local.join("linked-plan.md");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(read_local_plan(link.to_str().unwrap(), &file, &id).is_none());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sidechat_images_are_validated_inside_parent_uploads_before_creation() {
        let dir = std::env::temp_dir().join(format!("mobile-side-images-{}", uuid::Uuid::new_v4()));
        let uploads = dir.join("parent-uploads");
        std::fs::create_dir_all(&uploads).unwrap();
        let image = uploads.join("image.png");
        let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==").unwrap();
        std::fs::write(&image, &png).unwrap();
        let path = image.to_string_lossy().to_string();
        assert_eq!(
            validate_uploaded_image_paths(&uploads, vec![path.clone()])
                .unwrap()
                .len(),
            1
        );
        let invalid = uploads.join("invalid.png");
        std::fs::write(&invalid, "not an image").unwrap();
        assert!(validate_uploaded_image_paths(
            &uploads,
            vec![invalid.to_string_lossy().into_owned()]
        )
        .is_err());
        let outside = dir.join("outside.png");
        std::fs::write(&outside, &png).unwrap();
        let outside_path = outside.to_string_lossy().into_owned();
        assert_eq!(
            validate_uploaded_image_paths(&uploads, vec![outside_path])
                .unwrap_err()
                .0,
            StatusCode::FORBIDDEN
        );
        #[cfg(unix)]
        {
            let link = uploads.join("link.png");
            std::os::unix::fs::symlink(outside, &link).unwrap();
            assert_eq!(
                validate_uploaded_image_paths(&uploads, vec![link.to_string_lossy().into_owned()])
                    .unwrap_err()
                    .0,
                StatusCode::FORBIDDEN
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn plan_command_is_explicit() {
        assert_eq!(plan_command(true), "/plan-action enable");
        assert_eq!(plan_command(false), "/plan-action disable");
    }

    #[test]
    fn context_usage_from_live_state_and_snapshot() {
        let live = json!({"contextUsage": {"tokens": 50000}, "model": {"contextWindow": 200000}});
        let u = context_usage(Some(&live), None);
        assert_eq!((u.tokens, u.window), (Some(50000), Some(200000)));
        assert!((u.percent.unwrap() - 25.0).abs() < 1e-9);

        // contextUsage.contextWindow beats the model's; reported percent is
        // used when no window is known.
        let w = json!({"contextUsage": {"tokens": 10, "contextWindow": 100}, "model": {"contextWindow": 999}});
        assert_eq!(context_usage(Some(&w), None).window, Some(100));
        let p = json!({"contextUsage": {"tokens": 10, "percent": 7.5}});
        assert_eq!(context_usage(Some(&p), None).percent, Some(7.5));

        // No process: snapshot tokens only; nothing at all stays null.
        let snap = context_usage(None, Some(1234));
        assert_eq!(
            (snap.tokens, snap.window, snap.percent),
            (Some(1234), None, None)
        );
        assert_eq!(context_usage(None, None), ContextUsage::default());
    }

    #[test]
    fn sanitizer_strips_paths_and_dots() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("a\\b\\c.txt"), "c.txt");
        assert_eq!(sanitize_filename(".."), "upload");
        assert_eq!(sanitize_filename("."), "upload");
        assert_eq!(sanitize_filename(""), "upload");
        assert_eq!(sanitize_filename("dir/"), "upload");
        assert_eq!(sanitize_filename("..hidden"), "hidden");
        assert_eq!(sanitize_filename("a:b*c?.txt"), "abc.txt");
        assert_eq!(sanitize_filename("x\0y\n.md"), "xy.md");
        assert_eq!(sanitize_filename("  报告 1.pdf "), "报告 1.pdf");
    }

    #[test]
    fn sanitizer_truncates_on_char_boundary_keeping_ext() {
        let long = format!("{}.txt", "文".repeat(100));
        let out = sanitize_filename(&long);
        assert!(out.len() <= MAX_NAME_BYTES);
        assert!(out.ends_with(".txt"));
        assert!(out.starts_with('文'));
        let no_ext = "a".repeat(500);
        assert_eq!(sanitize_filename(&no_ext).len(), MAX_NAME_BYTES);
    }

    #[test]
    fn size_cap() {
        assert!(check_upload_size(1).is_ok());
        assert!(check_upload_size(MAX_UPLOAD).is_ok());
        assert_eq!(
            check_upload_size(MAX_UPLOAD + 1).unwrap_err().0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(check_upload_size(0).unwrap_err().0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn unique_path_avoids_overwrite() {
        let dir = std::env::temp_dir().join(format!("chat-up-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = unique_path(&dir, "f.txt");
        assert_eq!(a, dir.join("f.txt"));
        std::fs::write(&a, b"x").unwrap();
        let b = unique_path(&dir, "f.txt");
        assert_ne!(a, b);
        assert!(b.file_name().unwrap().to_string_lossy().ends_with("-f.txt"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn images_validated() {
        let ok = ImageIn {
            mime: "image/JPG".into(),
            data: "aGk=".into(),
        };
        let v = build_images(&[ok]).ok().unwrap();
        assert_eq!(v[0]["mimeType"], "image/jpeg");
        assert_eq!(v[0]["type"], "image");
        let bad_mime = ImageIn {
            mime: "text/html".into(),
            data: "aGk=".into(),
        };
        assert!(build_images(&[bad_mime]).is_err());
        let bad_data = ImageIn {
            mime: "image/png".into(),
            data: "***".into(),
        };
        assert!(build_images(&[bad_data]).is_err());
        let empty = ImageIn {
            mime: "image/png".into(),
            data: " ".into(),
        };
        assert!(build_images(&[empty]).is_err());
    }

    #[test]
    fn plan_enabled_reads_cached_status() {
        assert!(!plan_enabled("no-such-session"));
    }

    #[test]
    fn names_and_toggles() {
        assert_eq!(canonical_name("/models"), "model");
        assert_eq!(canonical_name("visualize"), "skill:visualize");
        assert!(valid_cmd_name("skill:visualize"));
        assert!(!valid_cmd_name("a b"));
        assert!(!valid_cmd_name("../x"));
        assert!(parse_toggle("", false).ok().unwrap());
        assert!(!parse_toggle("off", true).ok().unwrap());
        assert!(parse_toggle("maybe", true).is_err());
    }

    #[test]
    fn goal_parsing_accepts_both_shapes() {
        let wrapped = json!({"goal": {"goal": {"objective": "ship", "status": "active"}}});
        assert_eq!(goal_of(&wrapped), Some(("ship".into(), "active".into())));
        let bare = json!({"goal": {"objective": "x"}});
        assert_eq!(goal_of(&bare), Some(("x".into(), String::new())));
        assert_eq!(goal_of(&json!({"goal": null})), None);
    }

    #[test]
    fn model_helpers_parse_shapes() {
        let arr = json!(["low", "high"]);
        assert_eq!(extract_levels(Some(&arr)), vec!["low", "high"]);
        let obj = json!({"mode": "effort", "efforts": ["medium", 3]});
        assert_eq!(extract_levels(Some(&obj)), vec!["medium"]);
        assert!(extract_levels(None).is_empty());
        assert_eq!(split_model("a/b/c"), ("a".into(), "b/c".into()));
        assert_eq!(split_model(" m "), (String::new(), "m".into()));
    }

    #[test]
    fn abort_uses_restore_queue_command_and_parses_withdrawn_texts() {
        // Stop must withdraw the queue, not leave stranded steer/follow-up
        // inputs to drain after the abort.
        assert_eq!(abort_command()["type"], "abort_and_restore_queue");
        // Response shapes omp returns: the RPC frame with `data`, entries
        // `{text}` (desktop `restoredQueueTexts` also accepts bare strings),
        // steering first; blank texts are dropped.
        let frame = json!({"type": "abort_and_restore_queue", "data": {
            "steering": [{"text": "排队的追问"}, {"text": "  "}],
            "followUp": [{"text": "排队的后续"}, "裸字符串"],
        }});
        assert_eq!(
            restored_queue_texts(&frame),
            vec![
                "排队的追问".to_string(),
                "排队的后续".to_string(),
                "裸字符串".to_string()
            ]
        );
        let bare = json!({"steering": [{"text": "只有 steer"}]});
        assert_eq!(restored_queue_texts(&bare), vec!["只有 steer".to_string()]);
        assert!(restored_queue_texts(&json!({})).is_empty());
        assert!(restored_queue_texts(&json!({"data": {"steering": []}})).is_empty());
    }

    #[test]
    fn queue_json_reads_omp_queued_messages() {
        let st = json!({"queuedMessages": {"steering": ["a", "b"], "followUp": ["c"], "liveSteered": 1}});
        assert_eq!(
            queue_json(Some(&st)),
            json!({"steering": ["a", "b"], "followUp": ["c"], "liveSteered": 1})
        );
        // No live process / no queue field: empty snapshot, never null.
        assert_eq!(
            queue_json(Some(&json!({}))),
            json!({"steering": [], "followUp": [], "liveSteered": 0})
        );
        assert_eq!(
            queue_json(None),
            json!({"steering": [], "followUp": [], "liveSteered": 0})
        );
        // Non-string queue entries are dropped, not echoed.
        let odd = json!({"queuedMessages": {"steering": ["a", 3], "followUp": [null]}});
        assert_eq!(
            queue_json(Some(&odd)),
            json!({"steering": ["a"], "followUp": [], "liveSteered": 0})
        );
    }
}
