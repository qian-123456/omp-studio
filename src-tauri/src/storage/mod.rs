//! Storage page backend (docs/ARCHITECTURE.md §7 "storage"): disk usage of
//! app-owned data, image GC, cache/status cleanup, DB compaction, and bulk
//! session cleanup (to the Trash). Every destructive path is confined to a
//! fixed root and never follows symlinks.

mod fsutil;
pub(crate) mod images;
pub(crate) mod sessions;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::Manager as _;

use crate::paths;
use crate::state::AppState;
use images::GcSummary;
use sessions::{Disposal, MetaView};

/// Background image GC runs at most this often.
const AUTO_GC_INTERVAL_SECS: i64 = 24 * 3600;
const AUTO_GC_KEY: &str = "image_gc_last_run";
/// Status files must be this old before being treated as expired.
const STATUS_MIN_AGE: Duration = Duration::from_secs(24 * 3600);

// ── Roots ──────────────────────────────────────────────────────────────

fn app_cache_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| {
        dirs::cache_dir()
            .map(|d| d.join("omp-workspace"))
            .unwrap_or_else(std::env::temp_dir)
    })
}

/// The two app image dirs: durable store and the legacy clip cache.
fn image_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    vec![paths::images_dir(), app_cache_dir(app).join("ompws-clip")]
}

/// WebKit's disposable network-cache dirs (`<cache>/<name>/WebKit/NetworkCache`).
/// Only these are cleared; `~/Library/WebKit/<name>/WebsiteData` holds
/// LocalStorage/IndexedDB/cookies and is never touched.
fn webkit_cache_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut names: Vec<String> = Vec::new();
    if let Some(n) = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
    {
        names.push(n);
    }
    names.push("omp-workspace".to_string());
    if let Some(n) = app_cache_dir(app)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
    {
        names.push(n);
    }
    names.sort();
    names.dedup();
    let Some(cache) = dirs::cache_dir() else {
        return Vec::new();
    };
    webkit_network_cache_dirs(&cache, &names)
}

fn webkit_network_cache_dirs(cache_root: &Path, names: &[String]) -> Vec<PathBuf> {
    names
        .iter()
        .map(|n| cache_root.join(n).join("WebKit").join("NetworkCache"))
        .filter(|p| p.is_dir())
        .collect()
}

// ── Status files ───────────────────────────────────────────────────────

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusUsage {
    pub count: usize,
    pub bytes: u64,
    pub expired_count: usize,
    pub expired_bytes: u64,
}

/// Status files whose process is gone and which are older than `min_age`.
fn expired_status_files(
    dir: &Path,
    now: SystemTime,
    min_age: Duration,
    alive: &dyn Fn(u32) -> bool,
) -> (StatusUsage, Vec<PathBuf>) {
    let mut usage = StatusUsage::default();
    let mut expired = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (usage, expired);
    };
    for e in rd.flatten() {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Ok(md) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !md.is_file() {
            continue;
        }
        usage.count += 1;
        usage.bytes += md.len();
        let old = md
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .is_some_and(|age| age >= min_age);
        if !old {
            continue;
        }
        let Some(status) = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| crate::catalog::external::parse_status_file(&t))
        else {
            continue;
        };
        if !alive(status.pid) {
            usage.expired_count += 1;
            usage.expired_bytes += md.len();
            expired.push(path);
        }
    }
    (usage, expired)
}

// ── DB ─────────────────────────────────────────────────────────────────

fn db_bytes() -> u64 {
    let db = paths::db_path();
    let mut wal = db.clone().into_os_string();
    wal.push("-wal");
    fsutil::tree_size(&db) + fsutil::tree_size(Path::new(&wal))
}

/// Text columns that may mention an image file, plus every settings value.
fn reference_texts(conn: &rusqlite::Connection) -> Vec<String> {
    let mut out = Vec::new();
    for sql in [
        "SELECT text FROM backlog",
        "SELECT refs FROM backlog",
        "SELECT prompt FROM schedules",
        "SELECT value FROM settings",
    ] {
        let Ok(mut stmt) = conn.prepare(sql) else {
            continue;
        };
        let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) else {
            continue;
        };
        out.extend(rows.flatten());
    }
    out
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn read_last_gc(conn: &rusqlite::Connection) -> Option<i64> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [AUTO_GC_KEY],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse().ok())
}

fn write_last_gc(conn: &rusqlite::Connection, secs: i64) {
    let _ = conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![AUTO_GC_KEY, secs.to_string()],
    );
}

fn gc_plan(state: &AppState, drafts: Vec<String>) -> (images::GcPlan, Vec<PathBuf>) {
    let roots = image_roots(&state.app);
    let mut texts = drafts;
    texts.extend(reference_texts(&state.db.lock()));
    let transcripts = images::transcript_files(&paths::omp_sessions_dir());
    let plan = images::plan(
        &roots,
        SystemTime::now(),
        images::MIN_AGE,
        &texts,
        &transcripts,
    );
    tracing::debug!(
        "image gc plan: {} unreferenced, {} kept (still referenced)",
        plan.unreferenced.len(),
        plan.referenced
    );
    (plan, roots)
}

// ── Commands ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    pub images: GcSummary,
    /// Disposable WebKit network cache.
    pub web_cache_bytes: u64,
    pub status: StatusUsage,
    pub db_bytes: u64,
    pub image_dirs: Vec<String>,
}

#[tauri::command]
pub async fn storage_overview(
    state: tauri::State<'_, AppState>,
) -> Result<StorageOverview, String> {
    let app = state.app.clone();
    tokio::task::spawn_blocking(move || {
        let (status, _) = expired_status_files(
            &paths::status_dir(),
            SystemTime::now(),
            STATUS_MIN_AGE,
            &crate::catalog::external::pid_alive,
        );
        let roots = image_roots(&app);
        StorageOverview {
            images: images::usage(&roots),
            web_cache_bytes: webkit_cache_dirs(&app)
                .iter()
                .map(|d| fsutil::tree_size(d))
                .sum(),
            status,
            db_bytes: db_bytes(),
            image_dirs: roots
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect(),
        }
    })
    .await
    .map_err(|e| format!("读取存储用量失败：{e}"))
}

/// Preview of what 「清理没用到的图片」 would delete. `drafts` are the
/// frontend's unsent draft texts (they live in localStorage).
#[tauri::command]
pub async fn storage_images_preview(
    state: tauri::State<'_, AppState>,
    drafts: Vec<String>,
) -> Result<GcSummary, String> {
    let st = state.inner().clone();
    tokio::task::spawn_blocking(move || gc_plan(&st, drafts).0.summary())
        .await
        .map_err(|e| format!("扫描图片失败：{e}"))
}

#[tauri::command]
pub async fn storage_images_clean(
    state: tauri::State<'_, AppState>,
    drafts: Vec<String>,
) -> Result<GcSummary, String> {
    let st = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let (plan, roots) = gc_plan(&st, drafts);
        images::apply(&plan, &roots)
    })
    .await
    .map_err(|e| format!("清理图片失败：{e}"))
}

/// Startup GC: runs at most once per 24h; `None` when skipped by the throttle.
#[tauri::command]
pub async fn storage_image_gc_auto(
    state: tauri::State<'_, AppState>,
    drafts: Vec<String>,
) -> Result<Option<GcSummary>, String> {
    let st = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let now = now_secs();
        if read_last_gc(&st.db.lock()).is_some_and(|last| now - last < AUTO_GC_INTERVAL_SECS) {
            return None;
        }
        let (plan, roots) = gc_plan(&st, drafts);
        let done = images::apply(&plan, &roots);
        write_last_gc(&st.db.lock(), now);
        Some(done)
    })
    .await
    .map_err(|e| format!("自动清理图片失败：{e}"))
}

/// Clear only WebKit's network cache; returns bytes freed.
#[tauri::command]
pub async fn storage_clear_web_cache(state: tauri::State<'_, AppState>) -> Result<u64, String> {
    let app = state.app.clone();
    tokio::task::spawn_blocking(move || {
        let mut freed = 0;
        for dir in webkit_cache_dirs(&app) {
            freed += fsutil::clear_dir_contents(&dir)
                .map_err(|e| format!("清空缓存失败 {}：{e}", dir.display()))?;
        }
        Ok(freed)
    })
    .await
    .map_err(|e| format!("清空缓存失败：{e}"))?
}

/// Delete status files of sessions that are no longer running.
#[tauri::command]
pub async fn storage_clean_status_records(
    _state: tauri::State<'_, AppState>,
) -> Result<GcSummary, String> {
    tokio::task::spawn_blocking(|| {
        let (_, expired) = expired_status_files(
            &paths::status_dir(),
            SystemTime::now(),
            STATUS_MIN_AGE,
            &crate::catalog::external::pid_alive,
        );
        let mut out = GcSummary::default();
        for p in expired {
            let bytes = fsutil::tree_size(&p);
            if fsutil::remove_path(&p).is_ok() {
                out.count += 1;
                out.bytes += bytes;
            }
        }
        out
    })
    .await
    .map_err(|e| format!("清理过期记录失败：{e}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactResult {
    pub before_bytes: u64,
    pub after_bytes: u64,
}

#[tauri::command]
pub async fn storage_compact_db(
    state: tauri::State<'_, AppState>,
) -> Result<CompactResult, String> {
    let st = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let before = db_bytes();
        {
            let db = st.db.lock();
            db.execute_batch(
                "PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);",
            )
            .map_err(|e| format!("压缩数据库失败：{e}"))?;
        }
        Ok(CompactResult {
            before_bytes: before,
            after_bytes: db_bytes(),
        })
    })
    .await
    .map_err(|e| format!("压缩数据库失败：{e}"))?
}

async fn meta_views(state: &AppState) -> Vec<MetaView> {
    crate::catalog::list(state)
        .await
        .into_iter()
        .map(|m| MetaView {
            id: m.id,
            file: m.file,
            cwd: m.cwd,
            title: m.title,
            updated_at: m.updated_at,
            live: m.live,
            pinned: m.pinned,
            external_pid: m.external_pid,
        })
        .collect()
}

#[tauri::command]
pub async fn storage_sessions_overview(
    state: tauri::State<'_, AppState>,
) -> Result<sessions::SessionsOverview, String> {
    let metas = meta_views(&state).await;
    tokio::task::spawn_blocking(move || sessions::overview(&metas, &paths::omp_sessions_dir()))
        .await
        .map_err(|e| format!("读取会话用量失败：{e}"))
}

#[tauri::command]
pub async fn storage_stale_sessions_preview(
    state: tauri::State<'_, AppState>,
    days: u32,
) -> Result<sessions::StalePreview, String> {
    let metas = meta_views(&state).await;
    tokio::task::spawn_blocking(move || {
        sessions::stale_preview(&metas, &paths::omp_sessions_dir(), chrono::Utc::now(), days)
    })
    .await
    .map_err(|e| format!("扫描旧会话失败：{e}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedSession {
    pub id: String,
    pub reason: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashReport {
    pub trashed: usize,
    pub freed_bytes: u64,
    pub skipped: Vec<SkippedSession>,
}

/// Move sessions (transcript + lock + artifacts dir) to the macOS Trash and
/// drop their catalog/DB state. Running, pinned and terminal-held sessions are
/// skipped and reported.
#[tauri::command]
pub async fn storage_trash_sessions(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
) -> Result<TrashReport, String> {
    let sessions_dir = paths::omp_sessions_dir();
    let mut report = TrashReport::default();
    for id in ids {
        let Some(meta) = crate::catalog::get(&state, &id).await else {
            report.skipped.push(SkippedSession {
                id,
                reason: "会话不存在".to_string(),
            });
            continue;
        };
        if let Some(reason) = sessions::skip_reason(meta.live, meta.pinned, meta.external_pid) {
            report.skipped.push(SkippedSession {
                id,
                reason: reason.to_string(),
            });
            continue;
        }
        let bytes = sessions::footprint(Path::new(&meta.file), &sessions_dir);
        match crate::catalog::delete_with(&state, &id, Disposal::Trash).await {
            Ok(()) => {
                report.trashed += 1;
                report.freed_bytes += bytes;
            }
            Err(reason) => report.skipped.push(SkippedSession { id, reason }),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fsutil::scratch_dir;
    use std::fs;

    #[test]
    fn web_cache_clear_leaves_site_data_alone() {
        let cache = scratch_dir("web-cache");
        let net = cache.join("app/WebKit/NetworkCache");
        fs::create_dir_all(net.join("Records")).unwrap();
        fs::write(net.join("Records/a"), vec![0u8; 50]).unwrap();
        let sibling = cache.join("app/WebKit/CacheStorage");
        fs::create_dir_all(&sibling).unwrap();
        fs::write(sibling.join("keep"), b"x").unwrap();
        let site = scratch_dir("web-site");
        fs::create_dir_all(site.join("LocalStorage")).unwrap();
        fs::write(site.join("LocalStorage/ls.db"), b"state").unwrap();

        let dirs = webkit_network_cache_dirs(&cache, &["app".into(), "missing".into()]);
        assert_eq!(dirs, vec![net.clone()]);
        let freed: u64 = dirs
            .iter()
            .map(|d| fsutil::clear_dir_contents(d).unwrap())
            .sum();
        assert_eq!(freed, 50);
        assert!(net.is_dir());
        assert_eq!(fs::read_dir(&net).unwrap().count(), 0);
        assert!(sibling.join("keep").exists());
        assert!(site.join("LocalStorage/ls.db").exists());
    }

    #[test]
    fn expired_status_files_skip_running_and_recent() {
        let dir = scratch_dir("status");
        let body = |pid: u32| {
            format!(r#"{{"sessionId":"s{pid}","sessionFile":"","pid":{pid},"state":"exited"}}"#)
        };
        for pid in [1u32, 2, 3] {
            fs::write(dir.join(format!("s{pid}.json")), body(pid)).unwrap();
        }
        fs::write(dir.join("broken.json"), b"nope").unwrap();
        fs::write(dir.join("note.txt"), b"x").unwrap();
        // Pretend 1 is alive; everything is "old" with a zero min age.
        let (usage, expired) = expired_status_files(
            &dir,
            SystemTime::now() + Duration::from_secs(5),
            Duration::ZERO,
            &|pid| pid == 1,
        );
        assert_eq!(usage.count, 4);
        assert_eq!(usage.expired_count, 2);
        assert_eq!(expired.len(), 2);
        assert!(expired.iter().all(|p| !p.ends_with("s1.json")));
        // With a real min age nothing freshly written is expired.
        let (usage, _) = expired_status_files(&dir, SystemTime::now(), STATUS_MIN_AGE, &|_| false);
        assert_eq!(usage.expired_count, 0);
    }

    #[test]
    fn reference_texts_cover_backlog_schedules_and_settings() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE backlog(text TEXT, refs TEXT, deleted_at TEXT);
             CREATE TABLE schedules(prompt TEXT);
             CREATE TABLE settings(key TEXT, value TEXT);
             INSERT INTO backlog VALUES('idea a.png', '[{\"path\":\"/x/b.png\"}]', NULL);
             INSERT INTO backlog VALUES('trashed e.png', '[]', '2026-01-01T00:00:00+00:00');
             INSERT INTO schedules VALUES('run c.png');
             INSERT INTO settings VALUES('k', 'd.png');",
        )
        .unwrap();
        let t = reference_texts(&conn).join("\n");
        // Trashed rows still count as references (their images are not cleaned).
        for n in ["a.png", "b.png", "c.png", "d.png", "e.png"] {
            assert!(t.contains(n), "{n}");
        }
    }
}
