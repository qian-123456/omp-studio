//! Mobile API: 想法 (backlog). Mirrors the desktop §7 `backlog_*` commands and
//! the `DispatchDialog` dispatch flow in `IdeasCapsule.tsx`.
//!
//! ## Routes
//! - `GET /ideas` → `BacklogItem[]` (createdAt desc, same as `backlog_list`).
//! - `POST /ideas` `{text, kind, projectDir?, sessionIds?: string[], imagePaths?: string[]}`
//!   → `BacklogItem`. `sessionIds` become `session` refs; `imagePaths` must point
//!   inside the `images` dir (i.e. results of `POST /ideas/images`) and
//!   become `image` refs — no `file`/`annotation` refs on mobile. Empty text with
//!   images falls back to "（图片）", mirroring `QuickCapture`.
//! - `PATCH /ideas/{id}` `{text?, kind?, status?, targetSessionId?}` (= the
//!   `BacklogPatch` of `backlog_update`) → updated `BacklogItem`; 404 unknown id;
//!   `targetSessionId: ""` clears the link.
//! - `DELETE /ideas/{id}` → `{ok: true}`; 404 unknown id.
//! - `POST /ideas/images` — raw image bytes (≤20 MiB, no multipart) → `{path}`.
//!   Stored under `~/.omp-workspace/images/<ts>-<rand>.<ext>` (`paths::images_dir()`), the same directory
//!   the desktop `save_clipboard_image` (used by `IdeaImages.tsx`) writes to;
//!   extension is sniffed from magic bytes (png/jpg/gif/webp/heic), others 415.
//! - `POST /ideas/{id}/dispatch` `{sessionId?, cwd?}` and
//!   `POST /ideas/dispatch` `{ids: string[], sessionId?, cwd?}`
//!   → `{sessionId, items: BacklogItem[]}`. Mirrors `DispatchDialog.run`:
//!   `prompt::build_batch` (multi → one preamble + compact item list + one
//!   closing), `rpc::send_prompt` into the target
//!   (existing non-archived session, or a spawned session at
//!   item.projectDir → body.cwd → global dir; `chat` mode for the global dir,
//!   `code` otherwise), then `dispatched` + `targetSessionId` on every item.

use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::backlog::{self, store};
use crate::contracts::{
    BacklogItem, BacklogPatch, BacklogRef, BacklogStatus, SpaceMode, StartOpts,
};
use crate::mobile::backend::Backend;
use crate::mobile::server::{ApiError, Ctx};
use crate::state::AppState;

type ApiResult<T> = Result<Json<T>, ApiError>;

/// Raw-body upload cap for idea images (same 20 MB as other mobile uploads).
const MAX_IMAGE_UPLOAD: usize = 20 * 1024 * 1024;

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new()
        .route("/ideas", get(list_ideas::<B>).post(add_idea::<B>))
        .route("/ideas/dispatch", post(dispatch_many::<B>))
        .route(
            "/ideas/images",
            post(upload_image::<B>).route_layer(DefaultBodyLimit::max(MAX_IMAGE_UPLOAD)),
        )
        .route(
            "/ideas/{id}",
            patch(update_idea::<B>).delete(delete_idea::<B>),
        )
        .route("/ideas/{id}/dispatch", post(dispatch_one::<B>))
}

fn unavailable() -> ApiError {
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "app state unavailable".into(),
    )
}

fn state<B: Backend>(ctx: &Ctx<B>) -> Result<&AppState, ApiError> {
    ctx.backend.app_state().ok_or_else(unavailable)
}

fn not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "条目不存在".into())
}

fn bad_request(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

fn internal(e: impl ToString) -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn bad_gateway(e: String) -> ApiError {
    ApiError(StatusCode::BAD_GATEWAY, e)
}

/// Same identifier policy as `server.rs::validate_id` (private there, so this
/// is a mirror for path/body ids used by this slice).
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

/// Idea images live in `paths::images_dir()` (`~/.omp-workspace/images`), shared
/// with the desktop clipboard-image storage.
fn clip_dir() -> PathBuf {
    crate::paths::images_dir()
}

/// Image extension from magic bytes; `None` when the payload isn't a known
/// image format. Desktop labels every saved clipboard blob `.png`; uploads from
/// a phone are real files, so pick the true format, defaulting to `png` only
/// when bytes look fine but unfamiliar... unknown payloads are rejected.
fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    let b = bytes;
    if b.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        Some("png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if b.starts_with(b"GIF8") {
        Some("gif")
    } else if b.len() >= 12 && b.starts_with(b"RIFF") && &b[8..12] == b"WEBP" {
        Some("webp")
    } else if b.len() >= 12 && &b[4..8] == b"ftyp" && b[8..12].starts_with(b"he") {
        Some("heic")
    } else {
        None
    }
}

/// Write uploaded bytes under `dir` as `<millis>-<rand>.<ext>`; mirrors the
/// timestamped naming of `save_clipboard_image_internal`. Creates `dir`.
fn save_upload(dir: &FsPath, bytes: &[u8], ext: &str) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建图片缓存目录失败：{e}"))?;
    let ts = chrono::Utc::now().timestamp_millis();
    let rand = &uuid::Uuid::new_v4().simple().to_string()[..8];
    let path = dir.join(format!("{ts}-{rand}.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| format!("保存图片失败：{e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Build refs from the mobile request shape: session refs first, then image
/// refs (same order as `QuickCapture`). Image paths must live in `clip_dir`
/// (i.e. come from `POST /ideas/images`), never arbitrary filesystem paths.
fn build_refs(
    session_ids: &[String],
    image_paths: &[String],
    clip: &FsPath,
) -> Result<Vec<BacklogRef>, ApiError> {
    let mut refs = Vec::with_capacity(session_ids.len() + image_paths.len());
    for id in session_ids {
        check_id(id)?;
        refs.push(BacklogRef {
            kind: "session".into(),
            session_id: Some(id.clone()),
            ..Default::default()
        });
    }
    for p in image_paths {
        if FsPath::new(p).parent() != Some(clip) {
            return Err(bad_request("图片必须先通过上传接口保存"));
        }
        refs.push(BacklogRef {
            kind: "image".into(),
            path: Some(p.clone()),
            ..Default::default()
        });
    }
    Ok(refs)
}

async fn list_ideas<B: Backend>(State(ctx): State<Arc<Ctx<B>>>) -> ApiResult<Vec<BacklogItem>> {
    let st = state(&ctx)?;
    let items = {
        let db = st.db.lock();
        store::list(&db).map_err(internal)?
    };
    Ok(Json(items))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddBody {
    text: String,
    kind: crate::contracts::BacklogKind,
    project_dir: Option<String>,
    #[serde(default)]
    session_ids: Vec<String>,
    #[serde(default)]
    image_paths: Vec<String>,
}

async fn add_idea<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Json(body): Json<AddBody>,
) -> ApiResult<BacklogItem> {
    let st = state(&ctx)?;
    let refs = build_refs(&body.session_ids, &body.image_paths, &clip_dir())?;
    // QuickCapture saves `trimmed || "（图片）"` so image-only captures work.
    let text = if body.text.trim().is_empty() && !body.image_paths.is_empty() {
        "（图片）".to_string()
    } else {
        body.text
    };
    if text.trim().is_empty() {
        return Err(bad_request("内容不能为空"));
    }
    let item = {
        let db = st.db.lock();
        store::add(&db, &text, body.kind, &refs, body.project_dir.as_deref()).map_err(internal)?
    };
    backlog::notify_changed(st);
    Ok(Json(item))
}

async fn update_idea<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(patch): Json<BacklogPatch>,
) -> ApiResult<BacklogItem> {
    check_id(&id)?;
    let st = state(&ctx)?;
    if let Some(t) = &patch.text {
        if t.trim().is_empty() {
            return Err(bad_request("内容不能为空"));
        }
    }
    let item = {
        let db = st.db.lock();
        if store::get(&db, &id).map_err(internal)?.is_none() {
            return Err(not_found());
        }
        store::update(&db, &id, &patch).map_err(internal)?
    };
    backlog::notify_changed(st);
    Ok(Json(item))
}

async fn delete_idea<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    check_id(&id)?;
    let st = state(&ctx)?;
    {
        let db = st.db.lock();
        if store::get(&db, &id).map_err(internal)?.is_none() {
            return Err(not_found());
        }
        store::delete(&db, &id).map_err(internal)?;
    }
    backlog::notify_changed(st);
    Ok(Json(json!({ "ok": true })))
}

async fn upload_image<B: Backend>(State(ctx): State<Arc<Ctx<B>>>, body: Bytes) -> ApiResult<Value> {
    state(&ctx)?;
    if body.is_empty() {
        return Err(bad_request("内容为空"));
    }
    let Some(ext) = image_ext(&body) else {
        return Err(ApiError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "仅支持 png/jpg/gif/webp/heic 图片".into(),
        ));
    };
    let dir = clip_dir();
    let path = tokio::task::spawn_blocking(move || save_upload(&dir, &body, ext))
        .await
        .map_err(internal)?
        .map_err(bad_request)?;
    Ok(Json(json!({ "path": path })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DispatchBody {
    /// Existing target session; absent/empty → spawn a new session (the two
    /// tabs of the desktop DispatchDialog).
    session_id: Option<String>,
    /// New-session cwd override; lower priority than the item's own
    /// project_dir, like desktop's `item.projectDir ?? currentProject`.
    cwd: Option<String>,
    /// Batch dispatch (`POST /ideas/dispatch`); `/{id}/dispatch` injects [id].
    #[serde(default)]
    ids: Vec<String>,
}

/// New-session cwd: item project_dir → request cwd → global dir (desktop uses
/// `item.projectDir ?? currentProject ?? globalPath`; mobile has no current
/// project, so the request's `cwd` stands in for it).
fn pick_cwd(item_dir: Option<&str>, req_dir: Option<&str>, global: &str) -> String {
    [item_dir, req_dir]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|p| !p.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| global.to_string())
}

/// Space mode for a spawned session, matching the desktop rule: the global dir
/// gets `chat`, everything else `code` (mobile has no space picker).
fn dispatch_mode(cwd: &str, global: &FsPath) -> SpaceMode {
    if FsPath::new(cwd) == global {
        SpaceMode::Chat
    } else {
        SpaceMode::Code
    }
}

async fn dispatch<B: Backend>(
    ctx: &Arc<Ctx<B>>,
    ids: &[String],
    body: &DispatchBody,
) -> ApiResult<Value> {
    let st = state(ctx)?;
    if ids.is_empty() {
        return Err(bad_request("请选择要派发的条目"));
    }
    for id in ids {
        check_id(id)?;
    }
    // 1) backlog prompt for the whole batch (one preamble/closing).
    let mut items = Vec::with_capacity(ids.len());
    {
        let db = st.db.lock();
        for id in ids {
            let Some(item) = store::get(&db, id).map_err(internal)? else {
                return Err(not_found());
            };
            items.push(item);
        }
    }
    let prompt = backlog::prompt::build_batch(st, &items).await;

    // 2) Resolve the target: existing session, or spawn at the desktop cwd rule.
    let target_id = match body.session_id.as_deref().map(str::trim) {
        Some(sid) if !sid.is_empty() => {
            check_id(sid)?;
            let meta = ctx
                .backend
                .session(sid)
                .await
                .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;
            if meta.archived {
                return Err(bad_request("已归档的会话不可操作"));
            }
            sid.to_string()
        }
        _ => {
            let global = crate::paths::global_dir();
            let cwd = pick_cwd(
                items[0].project_dir.as_deref(),
                body.cwd.as_deref(),
                &global.to_string_lossy(),
            );
            if !FsPath::new(&cwd).is_dir() {
                return Err(bad_request("当前模式没有可用的项目目录，请先添加项目"));
            }
            let info = crate::rpc::start(
                st,
                &StartOpts {
                    mode: Some(dispatch_mode(&cwd, &global)),
                    cwd,
                    ..Default::default()
                },
            )
            .await
            .map_err(bad_gateway)?;
            info.session_id
        }
    };

    // 3) dispatch_prompt → rpc::send_prompt (ensure_live + followUp if streaming).
    ctx.backend
        .send_prompt(&target_id, &prompt)
        .await
        .map_err(bad_gateway)?;

    // 4) Mark every item dispatched with the target link (DispatchDialog loop).
    let mut updated = Vec::with_capacity(items.len());
    {
        let db = st.db.lock();
        for item in &items {
            let patch = BacklogPatch {
                status: Some(BacklogStatus::Dispatched),
                target_session_id: Some(target_id.clone()),
                ..Default::default()
            };
            updated.push(store::update(&db, &item.id, &patch).map_err(internal)?);
        }
    }
    backlog::notify_changed(st);
    Ok(Json(json!({ "sessionId": target_id, "items": updated })))
}

async fn dispatch_one<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Json(body): Json<DispatchBody>,
) -> ApiResult<Value> {
    dispatch(&ctx, std::slice::from_ref(&id), &body).await
}

async fn dispatch_many<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Json(body): Json<DispatchBody>,
) -> ApiResult<Value> {
    dispatch(&ctx, &body.ids, &body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_image_formats() {
        assert_eq!(image_ext(&[0x89, 0x50, 0x4E, 0x47, 0x0D]), Some("png"));
        assert_eq!(image_ext(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(image_ext(b"GIF89a..."), Some("gif"));
        assert_eq!(image_ext(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some("webp"));
        assert_eq!(image_ext(b"\x00\x00\x00\x18ftypheic"), Some("heic"));
        assert_eq!(image_ext(b"heic"), None);
        assert_eq!(image_ext(b"plain text"), None);
        assert_eq!(image_ext(&[]), None);
    }

    #[test]
    fn id_policy_matches_server() {
        for ok in ["abc", "a-b_c.d", &"x".repeat(128)] {
            assert!(check_id(ok).is_ok(), "{ok}");
        }
        for bad in ["", "../x", "a/b", "a b", &"x".repeat(129)] {
            assert!(check_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn refs_require_clip_dir_images() {
        let clip = FsPath::new("/cache/ompws-clip");
        let Ok(refs) = build_refs(&["s-1".into()], &["/cache/ompws-clip/1.png".into()], clip)
        else {
            panic!("refs rejected");
        };
        assert_eq!(refs[0].kind, "session");
        assert_eq!(refs[0].session_id.as_deref(), Some("s-1"));
        assert_eq!(refs[1].kind, "image");
        assert_eq!(refs[1].path.as_deref(), Some("/cache/ompws-clip/1.png"));
        // Wrong dir, traversal, and bad session ids are all rejected.
        for bad in ["/etc/a.png", "/cache/other/a.png", "a.png"] {
            assert!(build_refs(&[], &[bad.into()], clip).is_err(), "{bad}");
        }
        assert!(build_refs(&["../x".into()], &[], clip).is_err());
    }

    #[test]
    fn cwd_priority_and_mode() {
        assert_eq!(
            pick_cwd(Some("/p/a"), Some("/p/b"), "/g"),
            "/p/a",
            "item project wins"
        );
        assert_eq!(pick_cwd(None, Some(" /p/b "), "/g"), "/p/b");
        assert_eq!(pick_cwd(Some("  "), None, "/g"), "/g");
        assert_eq!(
            dispatch_mode("/g", FsPath::new("/g")),
            SpaceMode::Chat,
            "global dir → chat"
        );
        assert_eq!(
            dispatch_mode("/g/", FsPath::new("/g")),
            SpaceMode::Chat,
            "trailing slash still the global dir"
        );
        assert_eq!(dispatch_mode("/p/a", FsPath::new("/g")), SpaceMode::Code);
    }

    #[test]
    fn upload_writes_inside_clip_dir() {
        let dir = std::env::temp_dir().join(format!("ompws-ideas-{}", uuid::Uuid::new_v4()));
        let png = [0x89, 0x50, 0x4E, 0x47, 1, 2, 3];
        let path = save_upload(&dir, &png, "png").unwrap();
        let p = FsPath::new(&path);
        assert_eq!(p.parent(), Some(dir.as_path()));
        assert_eq!(std::fs::read(p).unwrap(), png);
        // The stored name ends in .<ext> and starts with a millisecond timestamp.
        let name = p.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with(".png") && name.contains('-'));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
