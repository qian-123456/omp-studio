//! Mobile API: explorer (read-only) and git (status/branches/log/diff,
//! stage/unstage, commit) scoped to one session.
//!
//! Every route is keyed by session id (404 unknown). The allowed filesystem
//! roots are the canonical forms of the session `cwd`, its `repoRoot` and its
//! registered workspace path. Paths are canonicalized before the containment
//! check (component-wise `starts_with`, so `/proj-evil` is not inside `/proj`),
//! which rejects `..` traversal and symlinks that escape the roots. Git never
//! runs outside the session `cwd`; no push, checkout or destructive command
//! exists here.
//!
//! ## Routes
//! - `GET /sessions/{id}/files?path=` → `{path, parent, roots, entries}`.
//!   `path` is absolute or relative to the session cwd (default: cwd).
//!   `entries: [{name, path, kind: "dir"|"file", size}]` dirs first, ≤2000;
//!   symlinks whose target leaves the roots are omitted. `parent` is null at a
//!   root. 403 outside roots, 404 missing, 400 not a directory.
//! - `GET /sessions/{id}/file?path=` → `{path, size, binary, truncated, text}`.
//!   At most 512 KiB of text; `binary: true` carries `text: ""`.
//! - `GET /sessions/{id}/git/status` → `{isRepo, branch, files: [{path, status,
//!   index, worktree, staged, unstaged}]}`; `status` is M/A/D/R/??, `path`
//!   relative to the repo top (as git prints it).
//! - `GET /sessions/{id}/git/branches` → `BranchInfo[]` (read-only listing).
//! - `GET /sessions/{id}/git/log?limit=` → `GitCommit[]` (limit 1..=200, default 50).
//! - `GET /sessions/{id}/git/diff?path=&staged=&commit=<sha>` → `{diff}` (`commit`: hex sha 4-40
//!   chars → that commit's patch). `staged=true` is `git diff --cached`; otherwise working tree vs HEAD incl. untracked.
//! - `POST /sessions/{id}/git/stage` `{paths: string[]}` → `{ok: true}`.
//! - `POST /sessions/{id}/git/unstage` `{paths: string[]}` → `{ok: true}`.
//! - `POST /sessions/{id}/git/commit` `{message}` → `{output}`; commits what is
//!   staged (400 on empty message or nothing staged).
//!
//! Git paths must be non-empty, relative, free of `..`, not start with `-` or
//! `:`, and are passed as `:(literal)<path>` after `--`.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::extract::{Path as UrlPath, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::git::cmd::git_ok;
use crate::git::{history, status as gstatus};
use crate::mobile::backend::Backend;
use crate::mobile::server::{ApiError, Ctx};

const MAX_ENTRIES: usize = 2000;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_STAGED_DIFF: usize = 200 * 1024;

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new()
        .route("/sessions/{id}/files", get(list_dir::<B>))
        .route("/sessions/{id}/file", get(read_file::<B>))
        .route("/sessions/{id}/git/status", get(git_status::<B>))
        .route("/sessions/{id}/git/branches", get(git_branches::<B>))
        .route("/sessions/{id}/git/log", get(git_log::<B>))
        .route("/sessions/{id}/git/diff", get(git_diff::<B>))
        .route("/sessions/{id}/git/stage", post(git_stage::<B>))
        .route("/sessions/{id}/git/unstage", post(git_unstage::<B>))
        .route("/sessions/{id}/git/commit", post(git_commit::<B>))
        .route("/sessions/{id}/git/suggest", post(git_suggest::<B>))
}

fn err(code: StatusCode, msg: impl Into<String>) -> ApiError {
    ApiError(code, msg.into())
}

// ---------------------------------------------------------------- path guard

/// Canonical roots, dropping any that no longer exist.
fn canonical_roots(raw: &[String]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for r in raw.iter().filter(|r| !r.is_empty()) {
        if let Ok(c) = std::fs::canonicalize(r) {
            if !out.contains(&c) {
                out.push(c);
            }
        }
    }
    out
}

/// Resolve `requested` (absolute, or relative to `base`) to a canonical path
/// inside one of `roots`. Rejects `..` components, missing paths and anything
/// (symlinks included) resolving outside the roots.
fn resolve_in_roots(roots: &[PathBuf], base: &Path, requested: &str) -> Result<PathBuf, ApiError> {
    if requested.contains('\0') {
        return Err(err(StatusCode::BAD_REQUEST, "非法路径"));
    }
    let req = Path::new(requested);
    if req.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(err(StatusCode::FORBIDDEN, "路径不在允许范围内"));
    }
    let joined = if req.is_absolute() {
        req.to_path_buf()
    } else {
        base.join(req)
    };
    let canon =
        std::fs::canonicalize(&joined).map_err(|_| err(StatusCode::NOT_FOUND, "路径不存在"))?;
    if roots.iter().any(|r| canon.starts_with(r)) {
        Ok(canon)
    } else {
        Err(err(StatusCode::FORBIDDEN, "路径不在允许范围内"))
    }
}

struct Scope {
    cwd: PathBuf,
    roots: Vec<PathBuf>,
}

async fn scope<B: Backend>(ctx: &Ctx<B>, id: &str) -> Result<Scope, ApiError> {
    let meta = super::draft::find_session(&ctx.backend, id)
        .await
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "会话不存在"))?;
    let mut raw = vec![meta.cwd.clone()];
    raw.extend(meta.repo_root.clone());
    if let Some(wid) = &meta.workspace_id {
        let db = ctx.db.lock();
        if let Ok(list) = crate::catalog::store::list_workspaces(&db) {
            raw.extend(list.into_iter().filter(|w| &w.id == wid).map(|w| w.path));
        }
    }
    let cwd = std::fs::canonicalize(&meta.cwd)
        .map_err(|_| err(StatusCode::NOT_FOUND, "会话目录不存在"))?;
    Ok(Scope {
        cwd,
        roots: canonical_roots(&raw),
    })
}

async fn blocking<T, F>(f: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ApiError> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
}

// ------------------------------------------------------------------ explorer

#[derive(Deserialize)]
struct PathQuery {
    path: Option<String>,
}

fn list_dir_impl(scope: &Scope, requested: &str) -> Result<Value, ApiError> {
    let dir = resolve_in_roots(&scope.roots, &scope.cwd, requested)?;
    if !dir.is_dir() {
        return Err(err(StatusCode::BAD_REQUEST, "不是目录"));
    }
    let rd = std::fs::read_dir(&dir).map_err(|e| err(StatusCode::FORBIDDEN, e.to_string()))?;
    let mut entries: Vec<(bool, String, PathBuf, u64)> = Vec::new();
    for e in rd.flatten() {
        let Ok(real) = std::fs::canonicalize(e.path()) else {
            continue;
        };
        if !scope.roots.iter().any(|r| real.starts_with(r)) {
            continue; // symlink escaping the roots
        }
        let Ok(md) = std::fs::metadata(&real) else {
            continue;
        };
        entries.push((
            md.is_dir(),
            e.file_name().to_string_lossy().into_owned(),
            real,
            if md.is_dir() { 0 } else { md.len() },
        ));
    }
    entries.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase()))
    });
    entries.truncate(MAX_ENTRIES);
    let parent = dir
        .parent()
        .filter(|p| scope.roots.iter().any(|r| p.starts_with(r)))
        .map(|p| p.to_string_lossy().into_owned());
    Ok(json!({
        "path": dir.to_string_lossy(),
        "parent": parent,
        "roots": scope.roots.iter().map(|r| r.to_string_lossy()).collect::<Vec<_>>(),
        "entries": entries.into_iter().map(|(is_dir, name, path, size)| json!({
            "name": name,
            "path": path.to_string_lossy(),
            "kind": if is_dir { "dir" } else { "file" },
            "size": size,
        })).collect::<Vec<_>>(),
    }))
}

fn read_file_impl(scope: &Scope, requested: &str) -> Result<Value, ApiError> {
    use std::io::Read;
    let file = resolve_in_roots(&scope.roots, &scope.cwd, requested)?;
    let md = std::fs::metadata(&file).map_err(|e| err(StatusCode::NOT_FOUND, e.to_string()))?;
    if !md.is_file() {
        return Err(err(StatusCode::BAD_REQUEST, "不是文件"));
    }
    let mut buf = Vec::new();
    std::fs::File::open(&file)
        .and_then(|f| f.take(MAX_FILE_BYTES).read_to_end(&mut buf))
        .map_err(|e| err(StatusCode::FORBIDDEN, e.to_string()))?;
    let truncated = md.len() > MAX_FILE_BYTES;
    let (binary, text) = decode_text(&buf, truncated);
    Ok(json!({
        "path": file.to_string_lossy(),
        "size": md.len(),
        "binary": binary,
        "truncated": truncated && !binary,
        "text": text,
    }))
}

/// `(is_binary, text)`. A NUL in the first 8 KiB or invalid UTF-8 (other than a
/// character cut by the size cap) means binary.
fn decode_text(buf: &[u8], truncated: bool) -> (bool, String) {
    if buf.iter().take(8192).any(|&b| b == 0) {
        return (true, String::new());
    }
    match std::str::from_utf8(buf) {
        Ok(s) => (false, s.to_string()),
        Err(e) if truncated && e.error_len().is_none() => (
            false,
            String::from_utf8_lossy(&buf[..e.valid_up_to()]).into_owned(),
        ),
        Err(_) => (true, String::new()),
    }
}

async fn list_dir<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
    Query(q): Query<PathQuery>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    let p = q.path.unwrap_or_default();
    let p = if p.is_empty() { ".".to_string() } else { p };
    blocking(move || list_dir_impl(&sc, &p).map(Json)).await
}

async fn read_file<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
    Query(q): Query<PathQuery>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    let p = q
        .path
        .filter(|p| !p.is_empty())
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "缺少 path"))?;
    blocking(move || read_file_impl(&sc, &p).map(Json)).await
}

// ----------------------------------------------------------------------- git

/// Validate a repo-relative path for use as a pathspec; returns the literal
/// pathspec. No user-controlled option can result (`--` always precedes it).
fn git_pathspec(p: &str) -> Result<String, ApiError> {
    let bad = p.is_empty()
        || p.contains('\0')
        || p.starts_with('-')
        || p.starts_with(':')
        || Path::new(p).is_absolute()
        || Path::new(p)
            .components()
            .any(|c| matches!(c, Component::ParentDir));
    if bad {
        return Err(err(StatusCode::BAD_REQUEST, format!("非法路径: {p}")));
    }
    Ok(format!(":(literal){p}"))
}

#[derive(Debug, PartialEq, Eq)]
struct FileState {
    path: String,
    index: char,
    worktree: char,
}

/// Parse `git status --porcelain=v1 -z` entries keeping both XY columns.
fn parse_xy(raw: &[u8]) -> Vec<FileState> {
    let mut out = Vec::new();
    let mut it = raw.split(|&b| b == 0).filter(|s| !s.is_empty());
    while let Some(rec) = it.next() {
        if rec.len() < 4 || rec.starts_with(b"## ") {
            continue;
        }
        let (x, y) = (rec[0] as char, rec[1] as char);
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            it.next(); // original path
        }
        out.push(FileState {
            path: String::from_utf8_lossy(&rec[3..]).into_owned(),
            index: x,
            worktree: y,
        });
    }
    out
}

fn status_code(f: &FileState) -> &'static str {
    let (x, y) = (f.index, f.worktree);
    if x == '?' {
        "??"
    } else if x == 'R' || y == 'R' {
        "R"
    } else if x == 'A' || y == 'A' || x == 'C' || y == 'C' {
        "A"
    } else if x == 'D' || y == 'D' {
        "D"
    } else {
        "M"
    }
}

fn git_status_impl(dir: &Path) -> Result<Value, ApiError> {
    let Some(st) = gstatus::status(dir, true) else {
        return Ok(json!({"isRepo": false, "branch": null, "files": []}));
    };
    let raw = crate::git::cmd::git(dir, &["status", "--porcelain=v1", "-z", "-uall"])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let files: Vec<Value> = parse_xy(&raw.stdout)
        .iter()
        .take(1000)
        .map(|f| {
            json!({
                "path": f.path,
                "status": status_code(f),
                "index": f.index.to_string(),
                "worktree": f.worktree.to_string(),
                "staged": f.index != ' ' && f.index != '?',
                "unstaged": f.worktree != ' ',
            })
        })
        .collect();
    Ok(json!({"isRepo": true, "branch": st.branch, "files": files}))
}

fn stage_impl(dir: &Path, paths: &[String], stage: bool) -> Result<(), ApiError> {
    if paths.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "paths 不能为空"));
    }
    let specs: Vec<String> = paths
        .iter()
        .map(|p| git_pathspec(p))
        .collect::<Result<_, _>>()?;
    let mut args: Vec<&str> = if stage {
        vec!["add", "-A", "--"]
    } else if gstatus::has_head(dir) {
        vec!["restore", "--staged", "--"]
    } else {
        vec!["rm", "--cached", "-r", "-q", "--"]
    };
    args.extend(specs.iter().map(String::as_str));
    git_ok(dir, &args)
        .map(|_| ())
        .map_err(|e| err(StatusCode::BAD_REQUEST, e))
}

/// Commit exactly what is staged.
fn commit_impl(dir: &Path, message: &str) -> Result<String, ApiError> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "提交信息不能为空"));
    }
    let staged = git_ok(dir, &["diff", "--cached", "--name-only", "-z"])
        .map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    if staged.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "没有已暂存的改动"));
    }
    git_ok(dir, &["commit", "-m", msg]).map_err(|e| err(StatusCode::BAD_REQUEST, e))
}

fn staged_diff(dir: &Path, path: Option<&str>) -> Result<String, ApiError> {
    let spec = path.map(git_pathspec).transpose()?;
    let mut args = vec!["diff", "--cached", "--no-color"];
    if let Some(s) = &spec {
        args.extend(["--", s.as_str()]);
    }
    let mut out = git_ok(dir, &args).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    if out.len() > MAX_STAGED_DIFF {
        let mut cut = MAX_STAGED_DIFF;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push_str("\n… 内容过长已截断\n");
    }
    Ok(out)
}

#[derive(Deserialize)]
struct LogQuery {
    limit: Option<u32>,
}

#[derive(Deserialize)]
struct DiffQuery {
    path: Option<String>,
    #[serde(default)]
    staged: bool,
    /// Diff of one commit (hex sha, 4-40 chars) instead of the working tree.
    commit: Option<String>,
}

fn valid_sha(s: &str) -> bool {
    (4..=40).contains(&s.len()) && s.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

#[derive(Deserialize)]
struct PathsBody {
    paths: Vec<String>,
}

#[derive(Deserialize)]
struct CommitBody {
    message: String,
}

async fn git_status<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    blocking(move || git_status_impl(&sc.cwd).map(Json)).await
}

async fn git_branches<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    blocking(move || {
        crate::git::commands::list_branches_detailed(&sc.cwd)
            .map(|b| Json(json!(b)))
            .map_err(|e| err(StatusCode::BAD_REQUEST, e))
    })
    .await
}

async fn git_log<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
    Query(q): Query<LogQuery>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    blocking(move || Ok(Json(json!(history::log(&sc.cwd, limit))))).await
}

async fn git_diff<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
    Query(q): Query<DiffQuery>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    blocking(move || {
        let path = q.path.as_deref().filter(|p| !p.is_empty());
        let diff = if let Some(sha) = q.commit.as_deref().filter(|c| !c.is_empty()) {
            if !valid_sha(sha) {
                return Err(err(StatusCode::BAD_REQUEST, "非法提交哈希"));
            }
            if let Some(p) = path {
                git_pathspec(p)?;
            }
            history::diff(&sc.cwd, path, Some(sha)).map_err(|e| err(StatusCode::BAD_REQUEST, e))?
        } else if q.staged {
            staged_diff(&sc.cwd, path)?
        } else {
            if let Some(p) = path {
                git_pathspec(p)?;
            }
            history::diff(&sc.cwd, path, None).map_err(|e| err(StatusCode::BAD_REQUEST, e))?
        };
        Ok(Json(json!({ "diff": diff })))
    })
    .await
}

async fn git_stage<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
    Json(body): Json<PathsBody>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    blocking(move || stage_impl(&sc.cwd, &body.paths, true).map(|_| Json(json!({"ok": true}))))
        .await
}

async fn git_unstage<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
    Json(body): Json<PathsBody>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    blocking(move || stage_impl(&sc.cwd, &body.paths, false).map(|_| Json(json!({"ok": true}))))
        .await
}

async fn git_commit<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
    Json(body): Json<CommitBody>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    blocking(move || commit_impl(&sc.cwd, &body.message).map(|o| Json(json!({"output": o})))).await
}

async fn git_suggest<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    UrlPath(id): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    let sc = scope(&ctx, &id).await?;
    let app_state = ctx
        .backend
        .app_state()
        .ok_or_else(|| err(StatusCode::NOT_IMPLEMENTED, "State unavailable"))?;
    let msg =
        crate::git::commands::git_commit_suggest_impl(app_state, sc.cwd.to_str().unwrap_or(""))
            .await
            .map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({ "suggestion": msg })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_sha_validation() {
        assert!(valid_sha("abcd"));
        assert!(valid_sha(&"a1".repeat(20)));
        for bad in ["abc", "ABCD", "abcg", "--output=x", "", &"a".repeat(41)] {
            assert!(!valid_sha(bad), "{bad}");
        }
    }

    fn tmp(name: &str) -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("omp-files-{name}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&p).unwrap();
        std::fs::canonicalize(p).unwrap()
    }

    fn ok<T>(r: Result<T, ApiError>) -> T {
        r.unwrap_or_else(|e| panic!("{}", e.1))
    }

    fn code(r: Result<PathBuf, ApiError>) -> StatusCode {
        r.map(|_| StatusCode::OK).unwrap_or_else(|e| e.0)
    }

    #[test]
    fn guard_cases() {
        let base = tmp("guard");
        let proj = base.join("proj");
        let evil = base.join("proj-evil");
        std::fs::create_dir_all(proj.join("sub")).unwrap();
        std::fs::create_dir_all(&evil).unwrap();
        std::fs::write(proj.join("sub/a.txt"), "x").unwrap();
        std::fs::write(evil.join("s.txt"), "x").unwrap();
        let roots = vec![proj.clone()];

        assert!(resolve_in_roots(&roots, &proj, "sub/a.txt").is_ok());
        assert!(resolve_in_roots(&roots, &proj, proj.join("sub").to_str().unwrap()).is_ok());
        assert_eq!(
            code(resolve_in_roots(&roots, &proj, "../proj-evil/s.txt")),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            code(resolve_in_roots(&roots, &proj, "sub/../../proj-evil")),
            StatusCode::FORBIDDEN
        );
        // absolute outside
        assert_eq!(
            code(resolve_in_roots(
                &roots,
                &proj,
                evil.join("s.txt").to_str().unwrap()
            )),
            StatusCode::FORBIDDEN
        );
        // sibling-prefix absolute dir
        assert_eq!(
            code(resolve_in_roots(&roots, &proj, evil.to_str().unwrap())),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            code(resolve_in_roots(&roots, &proj, "missing")),
            StatusCode::NOT_FOUND
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&evil, proj.join("link")).unwrap();
            assert_eq!(
                code(resolve_in_roots(&roots, &proj, "link/s.txt")),
                StatusCode::FORBIDDEN
            );
            // listing hides the escaping symlink
            let sc = Scope {
                cwd: proj.clone(),
                roots: roots.clone(),
            };
            let v = ok(list_dir_impl(&sc, "."));
            let names: Vec<&str> = v["entries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| e["name"].as_str().unwrap())
                .collect();
            assert_eq!(names, vec!["sub"]);
            assert!(v["parent"].is_null());
        }
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn binary_and_truncation() {
        assert_eq!(decode_text(b"a\0b", false), (true, String::new()));
        assert_eq!(decode_text(b"hi", false), (false, "hi".into()));
        // "é" cut in half by the cap is still text
        assert_eq!(decode_text(&[b'a', 0xC3], true), (false, "a".into()));
        assert!(decode_text(&[b'a', 0xFF, b'b'], true).0);
    }

    #[test]
    fn pathspec_rejects_flags_and_traversal() {
        for bad in ["", "-rf", ":(top)x", "../x", "a/../../x", "/etc/passwd"] {
            assert!(git_pathspec(bad).is_err(), "{bad}");
        }
        assert_eq!(ok(git_pathspec("a/b.rs")), ":(literal)a/b.rs");
    }

    #[test]
    fn stage_and_commit_in_temp_repo() {
        let dir = tmp("repo");
        let g = |args: &[&str]| git_ok(&dir, args).unwrap();
        g(&["init", "-q"]);
        g(&["config", "user.name", "t"]);
        g(&["config", "user.email", "t@example.com"]);
        g(&["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join("a.txt"), "hello\n").unwrap();
        std::fs::write(dir.join("b.txt"), "other\n").unwrap();

        assert!(commit_impl(&dir, "msg").is_err()); // nothing staged
        ok(stage_impl(&dir, &["a.txt".into()], true));
        let st = ok(git_status_impl(&dir));
        let files = st["files"].as_array().unwrap();
        let a = files.iter().find(|f| f["path"] == "a.txt").unwrap();
        assert_eq!(a["staged"], true);
        let b = files.iter().find(|f| f["path"] == "b.txt").unwrap();
        assert_eq!(b["status"], "??");
        assert!(ok(staged_diff(&dir, Some("a.txt"))).contains("+hello"));

        ok(stage_impl(&dir, &["a.txt".into()], false));
        assert!(commit_impl(&dir, "msg").is_err());
        ok(stage_impl(&dir, &["a.txt".into()], true));
        assert!(commit_impl(&dir, "  ").is_err());
        ok(commit_impl(&dir, "-n first commit"));
        assert_eq!(g(&["log", "-1", "--format=%s"]).trim(), "-n first commit");
        // b.txt stayed out of the commit
        assert!(!g(&["show", "--name-only", "--format=", "HEAD"]).contains("b.txt"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
