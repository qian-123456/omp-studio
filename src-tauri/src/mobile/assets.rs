//! The mobile web app bundle (`src-tauri/mobile-dist`, built by
//! `pnpm build:mobile`). Release builds embed it; debug builds read it from
//! disk on every request, so `pnpm dev:mobile` (watch build) is live.
//!
//! Layout contract with the frontend build (`vite.mobile.config.ts`, base
//! `/static/`): `index.html` is served at `/`, every other file at
//! `/static/<path>`, and the service worker `sw.js` at `/sw.js` (scope `/`).

use std::borrow::Cow;

use axum::http::{header, HeaderName, HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Response};

#[derive(rust_embed::RustEmbed)]
#[folder = "mobile-dist"]
struct Dist;

const NO_STORE: &str = "no-store";
/// Hashed build output (`assets/<name>-<hash>.<ext>`) never changes in place.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
/// Unhashed files must be revalidated on every use.
const REVALIDATE: &str = "no-cache";

const MISSING_BUNDLE_HTML: &str = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>OMP</title></head><body><p>手机端界面尚未构建。请在电脑上运行 pnpm build:mobile 后重试。</p></body></html>";

fn embedded(path: &str) -> Option<Cow<'static, [u8]>> {
    Dist::get(path).map(|f| f.data)
}

/// `Content-Type` by extension for everything the Vite build can emit.
fn mime_of(path: &str) -> &'static str {
    let ext = path.rsplit_once('.').map_or("", |(_, e)| e);
    match ext.to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn reply(
    mime: &'static str,
    cache: &'static str,
    body: Cow<'static, [u8]>,
    extra: &[(HeaderName, &'static str)],
) -> Response {
    let mut res = (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, cache),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body.into_owned(),
    )
        .into_response();
    for (k, v) in extra {
        res.headers_mut()
            .insert(k.clone(), HeaderValue::from_static(v));
    }
    res
}

/// `/`: the app shell, never cached so a new build is picked up at once. A
/// missing bundle yields a hint page instead of a bare 404.
pub fn index() -> Response {
    index_from(embedded)
}

fn index_from(get: impl Fn(&str) -> Option<Cow<'static, [u8]>>) -> Response {
    match get("index.html") {
        Some(body) => reply(mime_of("index.html"), NO_STORE, body, &[]),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CACHE_CONTROL, NO_STORE)],
            Html(MISSING_BUNDLE_HTML),
        )
            .into_response(),
    }
}

/// `/static/{path}`: hashed assets are immutable, everything else revalidates.
pub fn static_file(path: &str) -> Response {
    static_from(path, embedded)
}

fn static_from(path: &str, get: impl Fn(&str) -> Option<Cow<'static, [u8]>>) -> Response {
    if path.is_empty() || path.split('/').any(|seg| seg.is_empty() || seg == "..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    match get(path) {
        Some(body) => {
            let cache = if path.starts_with("assets/") {
                IMMUTABLE
            } else {
                REVALIDATE
            };
            reply(mime_of(path), cache, body, &[])
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `/sw.js`: must be served from the root with `Service-Worker-Allowed: /` and
/// without caching so a new worker is always discovered.
pub fn service_worker() -> Response {
    service_worker_from(embedded)
}

fn service_worker_from(get: impl Fn(&str) -> Option<Cow<'static, [u8]>>) -> Response {
    match get("sw.js") {
        Some(body) => reply(
            mime_of("sw.js"),
            NO_STORE,
            body,
            &[(HeaderName::from_static("service-worker-allowed"), "/")],
        ),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake(path: &str) -> Option<Cow<'static, [u8]>> {
        match path {
            "index.html" => Some(Cow::Borrowed(b"<html>app</html>")),
            "sw.js" => Some(Cow::Borrowed(b"self.skipWaiting()")),
            "assets/index-abc123.js" => Some(Cow::Borrowed(b"console.log(1)")),
            "assets/index-abc123.css" => Some(Cow::Borrowed(b"a{}")),
            "icons/logo.svg" => Some(Cow::Borrowed(b"<svg/>")),
            _ => None,
        }
    }

    fn h<'a>(res: &'a Response, name: &str) -> &'a str {
        res.headers()[name].to_str().unwrap()
    }

    #[test]
    fn index_is_never_cached() {
        let res = index_from(fake);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(h(&res, "content-type"), "text/html; charset=utf-8");
        assert_eq!(h(&res, "cache-control"), "no-store");
    }

    #[test]
    fn missing_bundle_serves_a_hint_page() {
        let res = index_from(|_| None);
        assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(h(&res, "cache-control"), "no-store");
        assert!(h(&res, "content-type").starts_with("text/html"));
    }

    #[test]
    fn hashed_assets_are_immutable_with_correct_mime() {
        let js = static_from("assets/index-abc123.js", fake);
        assert_eq!(js.status(), StatusCode::OK);
        assert_eq!(h(&js, "content-type"), "text/javascript; charset=utf-8");
        assert_eq!(h(&js, "cache-control"), IMMUTABLE);
        assert_eq!(h(&js, "x-content-type-options"), "nosniff");
        let css = static_from("assets/index-abc123.css", fake);
        assert_eq!(h(&css, "content-type"), "text/css; charset=utf-8");
        // Unhashed files revalidate.
        let svg = static_from("icons/logo.svg", fake);
        assert_eq!(h(&svg, "content-type"), "image/svg+xml");
        assert_eq!(h(&svg, "cache-control"), REVALIDATE);
    }

    #[test]
    fn static_rejects_missing_and_traversal_paths() {
        for p in ["", "nope.js", "../secret", "assets/../index.html", "a//b"] {
            assert_eq!(
                static_from(p, fake).status(),
                StatusCode::NOT_FOUND,
                "{p:?}"
            );
        }
    }

    #[test]
    fn service_worker_has_root_scope_and_no_cache() {
        let res = service_worker_from(fake);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(h(&res, "service-worker-allowed"), "/");
        assert_eq!(h(&res, "cache-control"), "no-store");
        assert_eq!(h(&res, "content-type"), "text/javascript; charset=utf-8");
        assert_eq!(
            service_worker_from(|_| None).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn mime_table_covers_build_output() {
        assert_eq!(mime_of("assets/font.woff2"), "font/woff2");
        assert_eq!(
            mime_of("assets/x.js.map"),
            "application/json; charset=utf-8"
        );
        assert_eq!(mime_of("noext"), "application/octet-stream");
    }
}
