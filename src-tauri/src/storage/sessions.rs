//! omp session footprints on disk and the skip rules for bulk cleanup.
//!
//! A session `<bucket>/<stem>.jsonl` owns up to three paths: the transcript,
//! the hidden lock `<bucket>/.<stem>.jsonl.lock.os`, and the artifacts dir
//! `<bucket>/<stem>/` (subagent transcripts, tool logs).

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::fsutil;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposal {
    /// Unlink immediately (sidebar 永久删除).
    Permanent,
    /// Move to the macOS Trash (recoverable).
    Trash,
}

/// Paths a session owns beyond its transcript, if `file` is a canonical
/// `<sessions_dir>/<bucket>/<stem>.jsonl`. Anything else yields nothing so a
/// stray handle path can never drag unrelated siblings along.
pub fn companion_paths(file: &Path, sessions_dir: &Path) -> Vec<PathBuf> {
    if !is_session_file(file, sessions_dir) {
        return Vec::new();
    }
    let (Some(bucket), Some(name)) = (file.parent(), file.file_name().and_then(|n| n.to_str()))
    else {
        return Vec::new();
    };
    let Some(stem) = name.strip_suffix(".jsonl") else {
        return Vec::new();
    };
    if stem.is_empty() {
        return Vec::new();
    }
    vec![bucket.join(stem), bucket.join(format!(".{name}.lock.os"))]
}

/// `<dir>/<bucket>/<name>.jsonl` with no `..` components.
pub fn is_session_file(file: &Path, sessions_dir: &Path) -> bool {
    file.extension().and_then(|x| x.to_str()) == Some("jsonl")
        && file.parent().and_then(Path::parent) == Some(sessions_dir)
        && !file
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
}

/// Bytes the session occupies: transcript + lock + artifacts dir.
pub fn footprint(file: &Path, sessions_dir: &Path) -> u64 {
    fsutil::tree_size(file)
        + companion_paths(file, sessions_dir)
            .iter()
            .map(|p| fsutil::tree_size(p))
            .sum::<u64>()
}

fn permanent(path: &Path) -> Result<(), String> {
    fsutil::remove_path(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn to_trash(path: &Path) -> Result<(), String> {
    if std::fs::symlink_metadata(path).is_err() {
        return Ok(());
    }
    trash::delete(path).map_err(|e| format!("移到废纸篓失败 {}: {e}", path.display()))
}

/// Remove a session's files: artifacts dir, lock, then the transcript last so
/// a failure midway leaves the session listed and retryable.
pub fn remove_files(file: &Path, sessions_dir: &Path, disposal: Disposal) -> Result<(), String> {
    match disposal {
        Disposal::Permanent => remove_files_with(file, sessions_dir, &permanent),
        Disposal::Trash => remove_files_with(file, sessions_dir, &to_trash),
    }
}

pub fn remove_files_with(
    file: &Path,
    sessions_dir: &Path,
    remover: &dyn Fn(&Path) -> Result<(), String>,
) -> Result<(), String> {
    for p in companion_paths(file, sessions_dir) {
        remover(&p)?;
    }
    remover(file)
}

/// Why a session must not be bulk-deleted from the storage page.
pub fn skip_reason(live: bool, pinned: bool, external_pid: Option<u32>) -> Option<&'static str> {
    if live {
        Some("正在运行")
    } else if external_pid.is_some() {
        Some("正被终端里的 omp 使用")
    } else if pinned {
        Some("已置顶")
    } else {
        None
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub bytes: u64,
    pub pinned: bool,
    /// Non-empty ⇒ cannot be deleted from this page.
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    /// Absolute bucket directory (target of 在访达中显示).
    pub dir: String,
    pub name: String,
    pub cwd: Option<String>,
    /// Whole bucket dir, including files the catalog does not list.
    pub bytes: u64,
    pub sessions: Vec<SessionRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsOverview {
    pub root: String,
    pub total_bytes: u64,
    pub session_count: usize,
    pub projects: Vec<ProjectRow>,
}

/// Minimal projection of `SessionMeta` so this module is testable without the catalog.
pub struct MetaView {
    pub id: String,
    pub file: String,
    pub cwd: String,
    pub title: String,
    pub updated_at: String,
    pub live: bool,
    pub pinned: bool,
    pub external_pid: Option<u32>,
}

pub fn overview(metas: &[MetaView], sessions_dir: &Path) -> SessionsOverview {
    use std::collections::BTreeMap;
    let mut by_bucket: BTreeMap<PathBuf, Vec<&MetaView>> = BTreeMap::new();
    for m in metas {
        let file = PathBuf::from(&m.file);
        if !is_session_file(&file, sessions_dir) {
            continue;
        }
        if let Some(bucket) = file.parent() {
            by_bucket.entry(bucket.to_path_buf()).or_default().push(m);
        }
    }
    // Buckets with no cataloged session still count towards the total.
    if let Ok(rd) = std::fs::read_dir(sessions_dir) {
        for e in rd.flatten() {
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                by_bucket.entry(e.path()).or_default();
            }
        }
    }
    let mut projects = Vec::new();
    let mut total = 0;
    let mut count = 0;
    for (bucket, members) in by_bucket {
        let bytes = fsutil::tree_size(&bucket);
        total += bytes;
        count += members.len();
        let mut sessions: Vec<SessionRow> = members
            .iter()
            .map(|m| SessionRow {
                id: m.id.clone(),
                title: m.title.clone(),
                updated_at: m.updated_at.clone(),
                bytes: footprint(Path::new(&m.file), sessions_dir),
                pinned: m.pinned,
                skip_reason: skip_reason(m.live, m.pinned, m.external_pid).map(str::to_string),
            })
            .collect();
        sessions.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.id.cmp(&b.id)));
        let cwd = members
            .iter()
            .max_by(|a, b| a.updated_at.cmp(&b.updated_at))
            .map(|m| m.cwd.clone())
            .filter(|c| !c.is_empty());
        projects.push(ProjectRow {
            name: bucket
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            dir: bucket.to_string_lossy().to_string(),
            cwd,
            bytes,
            sessions,
        });
    }
    projects.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.dir.cmp(&b.dir)));
    SessionsOverview {
        root: sessions_dir.to_string_lossy().to_string(),
        total_bytes: total,
        session_count: count,
        projects,
    }
}

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StalePreview {
    pub count: usize,
    pub bytes: u64,
    pub ids: Vec<String>,
}

/// Deletable sessions whose last update is more than `days` days before `now`.
pub fn stale_preview(
    metas: &[MetaView],
    sessions_dir: &Path,
    now: chrono::DateTime<chrono::Utc>,
    days: u32,
) -> StalePreview {
    let cutoff = now - chrono::Duration::days(i64::from(days));
    let mut out = StalePreview::default();
    for m in metas {
        if skip_reason(m.live, m.pinned, m.external_pid).is_some() {
            continue;
        }
        let file = PathBuf::from(&m.file);
        if !is_session_file(&file, sessions_dir) {
            continue;
        }
        let Ok(updated) = chrono::DateTime::parse_from_rfc3339(&m.updated_at) else {
            continue;
        };
        if updated.with_timezone(&chrono::Utc) < cutoff {
            out.count += 1;
            out.bytes += footprint(&file, sessions_dir);
            out.ids.push(m.id.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::fsutil::scratch_dir;
    use std::cell::RefCell;
    use std::fs;

    fn make_session(root: &Path, bucket: &str, stem: &str) -> PathBuf {
        let b = root.join(bucket);
        fs::create_dir_all(b.join(stem)).unwrap();
        fs::write(b.join(stem).join("0.bash.log"), b"log").unwrap();
        fs::write(b.join(format!(".{stem}.jsonl.lock.os")), b"").unwrap();
        let f = b.join(format!("{stem}.jsonl"));
        fs::write(&f, b"{}\n").unwrap();
        f
    }

    fn meta(id: &str, file: &Path, updated: &str) -> MetaView {
        MetaView {
            id: id.into(),
            file: file.to_string_lossy().to_string(),
            cwd: "/x".into(),
            title: id.into(),
            updated_at: updated.into(),
            live: false,
            pinned: false,
            external_pid: None,
        }
    }

    #[test]
    fn permanent_removal_takes_dir_and_lock() {
        let root = scratch_dir("sess-del");
        let f = make_session(&root, "-proj", "2026_abc");
        let other = make_session(&root, "-proj", "2026_keep");
        remove_files(&f, &root, Disposal::Permanent).unwrap();
        assert!(!f.exists());
        assert!(!root.join("-proj/2026_abc").exists());
        assert!(!root.join("-proj/.2026_abc.jsonl.lock.os").exists());
        assert!(other.exists());
        assert!(root.join("-proj/2026_keep").exists());
        assert!(root.join("-proj/.2026_keep.jsonl.lock.os").exists());
    }

    #[test]
    fn trash_path_receives_dir_lock_then_transcript() {
        let root = scratch_dir("sess-trash");
        let f = make_session(&root, "-proj", "2026_abc");
        let seen = RefCell::new(Vec::new());
        remove_files_with(&f, &root, &|p| {
            seen.borrow_mut().push(p.to_path_buf());
            Ok(())
        })
        .unwrap();
        let seen = seen.into_inner();
        assert_eq!(seen.len(), 3);
        assert_eq!(seen[0], root.join("-proj/2026_abc"));
        assert_eq!(seen[1], root.join("-proj/.2026_abc.jsonl.lock.os"));
        assert_eq!(seen[2], f);
    }

    #[test]
    fn files_outside_sessions_dir_get_no_companions() {
        let root = scratch_dir("sess-out");
        let elsewhere = scratch_dir("sess-out-else");
        fs::create_dir_all(elsewhere.join("2026_x")).unwrap();
        let f = elsewhere.join("2026_x.jsonl");
        fs::write(&f, b"{}").unwrap();
        assert!(companion_paths(&f, &root).is_empty());
        remove_files(&f, &root, Disposal::Permanent).unwrap();
        assert!(!f.exists());
        assert!(elsewhere.join("2026_x").exists());
    }

    #[test]
    fn skip_rules() {
        assert_eq!(skip_reason(true, false, None), Some("正在运行"));
        assert!(skip_reason(false, false, Some(1)).is_some());
        assert!(skip_reason(false, true, None).is_some());
        assert!(skip_reason(false, false, None).is_none());
    }

    #[test]
    fn stale_preview_applies_age_and_skip_rules() {
        let root = scratch_dir("sess-stale");
        let old = make_session(&root, "-p", "old");
        let fresh = make_session(&root, "-p", "fresh");
        let pinned = make_session(&root, "-p", "pinned");
        let live = make_session(&root, "-p", "live");
        let mut metas = vec![
            meta("old", &old, "2026-01-01T00:00:00Z"),
            meta("fresh", &fresh, "2026-10-20T00:00:00Z"),
            meta("pinned", &pinned, "2026-01-01T00:00:00Z"),
            meta("live", &live, "2026-01-01T00:00:00Z"),
        ];
        metas[2].pinned = true;
        metas[3].live = true;
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-21T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let p = stale_preview(&metas, &root, now, 90);
        assert_eq!(p.ids, vec!["old".to_string()]);
        assert_eq!(p.count, 1);
        assert_eq!(p.bytes, footprint(&old, &root));
        assert!(p.bytes > 3);
    }

    #[test]
    fn overview_sorts_sessions_by_size() {
        let root = scratch_dir("sess-ov");
        let small = make_session(&root, "-p", "small");
        let big = make_session(&root, "-p", "big");
        fs::write(&big, vec![0u8; 5000]).unwrap();
        let metas = vec![
            meta("small", &small, "2026-01-01T00:00:00Z"),
            meta("big", &big, "2026-01-01T00:00:00Z"),
        ];
        let ov = overview(&metas, &root);
        assert_eq!(ov.projects.len(), 1);
        assert_eq!(ov.projects[0].sessions[0].id, "big");
        assert_eq!(ov.session_count, 2);
        assert_eq!(ov.total_bytes, ov.projects[0].bytes);
    }
}
