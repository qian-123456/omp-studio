//! Raw image bytes for the phone (the JSON API carries only file paths).
//!
//! - `GET /sessions/{id}/image?path=<ImageAttachment.path>` → image bytes. The canonical
//!   path must lie in the session's `mobile-uploads/<id>` dir, omp's blob store
//!   (`~/.omp/agent/blobs`) or the pasted-image stores (`~/.omp-workspace/images`, legacy
//!   `ompws-clip`).
//! - `GET /ideas/image?path=<ref.path>` → image bytes from `~/.omp-workspace/images`.
//!
//! Only png/jpeg/gif/webp (extension and magic bytes), ≤ 20 MiB; anything else is 404/403.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use tauri::Manager as _;

use crate::mobile::backend::Backend;
use crate::mobile::server::{ApiError, Ctx};

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new()
        .route("/sessions/{id}/image", get(session_image::<B>))
        .route("/ideas/image", get(idea_image::<B>))
}

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

fn err(code: StatusCode, msg: &str) -> ApiError {
    ApiError(code, msg.to_string())
}

/// MIME type by magic bytes (`None` when not one of the four allowed formats).
pub(crate) fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Read `requested` when it canonicalises into one of `roots`. Blob files may
/// have no extension, so the magic bytes decide the type.
fn read_image(requested: &str, roots: &[PathBuf]) -> Result<Response, ApiError> {
    let canon =
        std::fs::canonicalize(requested).map_err(|_| err(StatusCode::NOT_FOUND, "图片不存在"))?;
    let allowed = roots
        .iter()
        .filter_map(|r| std::fs::canonicalize(r).ok())
        .any(|r| canon.starts_with(r));
    if !allowed {
        return Err(err(StatusCode::FORBIDDEN, "路径不在允许范围内"));
    }
    let meta = std::fs::metadata(&canon).map_err(|_| err(StatusCode::NOT_FOUND, "图片不存在"))?;
    if !meta.is_file() {
        return Err(err(StatusCode::NOT_FOUND, "图片不存在"));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "图片超过 20MB"));
    }
    let bytes = std::fs::read(&canon).map_err(|_| err(StatusCode::NOT_FOUND, "图片不存在"))?;
    let mime = sniff(&bytes)
        .ok_or_else(|| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, "不是支持的图片格式"))?;
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "private, max-age=3600"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}

/// Stores holding user-pasted images (current and legacy).
fn clip_roots(state: Option<&crate::state::AppState>) -> Vec<PathBuf> {
    let mut roots = vec![crate::paths::images_dir()];
    if let Some(cache) = state.and_then(|s| s.app.path().app_cache_dir().ok()) {
        roots.push(cache.join("ompws-clip"));
    }
    roots
}

async fn session_image<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Path(id): Path<String>,
    Query(q): Query<PathQuery>,
) -> Result<Response, ApiError> {
    if id.is_empty()
        || id.len() > 128
        || id.contains("..")
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(err(StatusCode::BAD_REQUEST, "非法标识符"));
    }
    super::draft::find_session(&ctx.backend, &id)
        .await
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "会话不存在"))?;
    let state = ctx.backend.app_state();
    let mut roots = clip_roots(state);
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".omp").join("agent").join("blobs"));
    }
    if let Some(state) = state {
        let base = state
            .app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| crate::paths::data_dir());
        roots.push(base.join("mobile-uploads").join(&id));
    }
    read_image(&q.path, &roots)
}

async fn idea_image<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Query(q): Query<PathQuery>,
) -> Result<Response, ApiError> {
    read_image(&q.path, &clip_roots(ctx.backend.app_state()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    fn dir(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("omp-media-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn sniff_known_formats_only() {
        assert_eq!(sniff(PNG), Some("image/png"));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff(b"GIF89a.."), Some("image/gif"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff(b"<svg xmlns='http://www.w3.org/2000/svg'/>"), None);
        assert_eq!(sniff(b"%PDF-1.7"), None);
    }

    #[test]
    fn reads_only_images_inside_allowed_roots() {
        let root = dir("root");
        let outside = dir("outside");
        std::fs::write(root.join("a.png"), PNG).unwrap();
        std::fs::write(root.join("blob"), PNG).unwrap(); // extensionless blob
        std::fs::write(root.join("note.png"), b"not an image").unwrap();
        std::fs::write(outside.join("b.png"), PNG).unwrap();
        let roots = [root.clone()];

        let ok = read_image(root.join("a.png").to_str().unwrap(), &roots).unwrap();
        assert_eq!(ok.headers()[header::CONTENT_TYPE], "image/png");
        assert!(read_image(root.join("blob").to_str().unwrap(), &roots).is_ok());
        let code = |r: Result<Response, ApiError>| r.unwrap_err().0;
        assert_eq!(
            code(read_image(outside.join("b.png").to_str().unwrap(), &roots)),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            code(read_image(root.join("note.png").to_str().unwrap(), &roots)),
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        assert_eq!(
            code(read_image(
                root.join("missing.png").to_str().unwrap(),
                &roots
            )),
            StatusCode::NOT_FOUND
        );
        // `..` traversal and symlinks out of the root are canonicalised away.
        let sneaky = format!(
            "{}/../{}/b.png",
            root.display(),
            outside.file_name().unwrap().to_string_lossy()
        );
        assert_eq!(code(read_image(&sneaky, &roots)), StatusCode::FORBIDDEN);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.join("b.png"), root.join("link.png")).unwrap();
            assert_eq!(
                code(read_image(root.join("link.png").to_str().unwrap(), &roots)),
                StatusCode::FORBIDDEN
            );
        }
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
    }
}
