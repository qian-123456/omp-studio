//! Directory listing + cached, parallel per-file parsing, and the pure
//! `SessionMeta` builder (title / label / workspace membership).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::SystemTime;

use regex::Regex;

use super::parse::{self, HeadInfo, LastRole, TailInfo};
use super::store::MetaRow;
use crate::contracts::{GitBadge, SessionMeta, Workspace, WorkspaceKind};

/// Cached parse result for one session file, keyed by (path, size, mtime).
#[derive(Debug, Clone)]
pub struct Scanned {
    pub path: PathBuf,
    pub size: u64,
    pub mtime: SystemTime,
    pub head: HeadInfo,
    pub tail: TailInfo,
    pub first_user: Option<String>,
}

impl Scanned {
    /// Timestamp of the last completed assistant turn in the tail, if any.
    pub fn last_turn_ts(&self) -> Option<&str> {
        let last = self.tail.last_msg.as_ref()?;
        (last.role == LastRole::Assistant && !last.has_tool_calls).then_some(last.ts.as_str())
    }
}

pub type FileMap = HashMap<PathBuf, Arc<Scanned>>;

/// `<sessions>/<bucket>/*.jsonl` (depth 2 only; subagent dirs are skipped).
pub fn list_files(dir: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    let mut out = Vec::new();
    let Ok(buckets) = std::fs::read_dir(dir) else {
        return out;
    };
    for bucket in buckets.flatten() {
        if !bucket.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(bucket.path()) else {
            continue;
        };
        for e in entries.flatten() {
            let path = e.path();
            if !is_session_file(dir, &path) {
                continue;
            }
            let Ok(md) = e.metadata() else { continue };
            if md.is_file() {
                out.push((
                    path,
                    md.len(),
                    md.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                ));
            }
        }
    }
    out
}

/// True if `path` is a listable session file (`<dir>/<bucket>/<name>.jsonl`).
pub fn is_session_file(dir: &Path, path: &Path) -> bool {
    path.extension().and_then(|x| x.to_str()) == Some("jsonl")
        && path.parent().and_then(Path::parent) == Some(dir)
}

/// Parse new/changed files (in parallel), reusing cached entries otherwise.
/// Returns the new map and the paths that were (re)parsed.
pub fn scan_files(
    files: Vec<(PathBuf, u64, SystemTime)>,
    prev: &FileMap,
) -> (FileMap, Vec<PathBuf>) {
    let mut map = FileMap::with_capacity(files.len());
    let mut todo = Vec::new();
    for (path, size, mtime) in files {
        match prev.get(&path) {
            Some(s) if s.size == size && s.mtime == mtime => {
                map.insert(path, s.clone());
            }
            p => todo.push((path, size, mtime, p.cloned())),
        }
    }
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .clamp(1, 8);
    let chunk = todo.len().div_ceil(threads).max(1);
    let parsed: Vec<Scanned> = std::thread::scope(|scope| {
        let handles: Vec<_> = todo
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || {
                    part.iter()
                        .filter_map(|(path, size, mtime, prev)| {
                            parse_file(path, *size, *mtime, prev.as_deref())
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap_or_default())
            .collect()
    });
    let changed = parsed.iter().map(|s| s.path.clone()).collect();
    for s in parsed {
        map.insert(s.path.clone(), Arc::new(s));
    }
    (map, changed)
}

/// Parse one file. Appended files reuse the cached head; only the tail is re-read.
pub fn parse_file(
    path: &Path,
    size: u64,
    mtime: SystemTime,
    prev: Option<&Scanned>,
) -> Option<Scanned> {
    let reuse = prev.filter(|p| size >= p.size && !p.head.id.is_empty());
    let head = match reuse {
        Some(p) => p.head.clone(),
        None => parse::read_head(path).ok()??,
    };
    let tail = parse::read_tail(path, size).ok()?;
    let needs_first_user =
        head.slot_title.is_none() && head.header_title.is_none() && tail.title_change.is_none();
    let first_user = if needs_first_user {
        reuse
            .and_then(|p| p.first_user.clone())
            .or_else(|| parse::read_first_user(path))
    } else {
        None
    };
    Some(Scanned {
        path: path.to_path_buf(),
        size,
        mtime,
        head,
        tail,
        first_user,
    })
}

/// Title priority: custom_name > title slot > header title > latest
/// title_change > first user text > "未命名".
pub fn resolve_title(s: &Scanned, row: &MetaRow) -> String {
    row.custom_name
        .clone()
        .or_else(|| s.head.slot_title.clone())
        .or_else(|| s.head.header_title.clone())
        .or_else(|| s.tail.title_change.clone())
        .or_else(|| s.first_user.clone())
        .unwrap_or_else(|| "未命名".to_string())
}

/// `#<n>` from the first title candidate starting with `#<digits>`.
pub fn title_number(s: &Scanned, row: &MetaRow) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^#(\d+)").unwrap());
    [
        row.custom_name.as_deref(),
        s.head.slot_title.as_deref(),
        s.head.header_title.as_deref(),
        s.tail.title_change.as_deref(),
    ]
    .into_iter()
    .flatten()
    .find_map(|t| re.captures(t.trim()).map(|c| format!("#{}", &c[1])))
}

/// Label: stored side-chat label > `#<n>` from title > `#L<seq>`.
pub fn resolve_label(s: &Scanned, row: &MetaRow) -> String {
    if let Some(l) = row.label.as_deref().filter(|l| !l.is_empty()) {
        return l.to_string();
    }
    if let Some(n) = title_number(s, row) {
        return n;
    }
    row.seq.map(|n| format!("#L{n}")).unwrap_or_default()
}

fn path_within(path: &str, root: &str) -> bool {
    let root = root.trim_end_matches('/');
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Membership: explicit override > registered project workspace containing
/// `repo_root ?? cwd` (longest path wins) > Global if cwd under `global_dir` > None.
pub fn resolve_workspace(
    explicit: Option<&str>,
    workspaces: &[Workspace],
    repo_root: Option<&str>,
    cwd: &str,
    global_dir: &str,
) -> Option<String> {
    if let Some(id) = explicit {
        if workspaces.iter().any(|w| w.id == id) {
            return Some(id.to_string());
        }
    }
    for target in [repo_root, Some(cwd)].into_iter().flatten() {
        // macOS: /tmp → /private/tmp, /var → /private/var. Session cwds keep
        // the short form while workspace paths are usually canonicalized —
        // compare canonical forms so symlinked dirs still group correctly.
        let canon = std::fs::canonicalize(target)
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| target.to_string());
        let best = workspaces
            .iter()
            .filter(|w| w.kind == WorkspaceKind::Project)
            .filter(|w| {
                let wcanon = std::fs::canonicalize(&w.path)
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|| w.path.clone());
                path_within(&canon, &wcanon)
            })
            .max_by_key(|w| w.path.len());
        if let Some(w) = best {
            return Some(w.id.clone());
        }
    }
    if path_within(cwd, global_dir) {
        return workspaces
            .iter()
            .find(|w| w.kind == WorkspaceKind::Global)
            .map(|w| w.id.clone());
    }
    None
}

/// Git facts per cwd (from `git::badge` / `git::repo_root`; may be None while stubbed).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GitInfo {
    pub badge: Option<GitBadge>,
    pub repo_root: Option<String>,
}

/// Build the static part of a SessionMeta (status fields are filled by the caller).
pub fn build_meta(
    s: &Scanned,
    row: &MetaRow,
    git: &GitInfo,
    workspaces: &[Workspace],
    global_dir: &str,
    parent_id: Option<String>,
) -> SessionMeta {
    let updated_at = chrono::DateTime::<chrono::Utc>::from(s.mtime)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    SessionMeta {
        id: s.head.id.clone(),
        tool: "omp".to_string(),
        file: s.path.to_string_lossy().to_string(),
        cwd: s.head.cwd.clone(),
        title: resolve_title(s, row),
        label: resolve_label(s, row),
        created_at: s.head.created_at.clone(),
        updated_at,
        fork_depth: row.fork_depth,
        parent_id,
        pinned: row.pinned,
        archived: row.archived,
        unread: row.unread,
        workspace_id: resolve_workspace(
            row.workspace_id.as_deref(),
            workspaces,
            git.repo_root.as_deref(),
            &s.head.cwd,
            global_dir,
        ),
        repo_root: git.repo_root.clone(),
        git: git.badge.clone(),
        result: s.tail.result.clone(),
        last_assistant: s.tail.last_assistant.clone(),
        model: s.tail.model.clone(),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scanned(
        slot: Option<&str>,
        header: Option<&str>,
        change: Option<&str>,
        first: Option<&str>,
    ) -> Scanned {
        Scanned {
            path: PathBuf::from("/s/b/x.jsonl"),
            size: 1,
            mtime: SystemTime::UNIX_EPOCH,
            head: HeadInfo {
                id: "id".into(),
                cwd: "/repo/app".into(),
                slot_title: slot.map(Into::into),
                header_title: header.map(Into::into),
                ..Default::default()
            },
            tail: TailInfo {
                title_change: change.map(Into::into),
                ..Default::default()
            },
            first_user: first.map(Into::into),
        }
    }

    #[test]
    fn title_priority() {
        let row = MetaRow::default();
        assert_eq!(
            resolve_title(&scanned(Some("slot"), Some("h"), Some("c"), None), &row),
            "slot"
        );
        assert_eq!(
            resolve_title(&scanned(None, None, Some("c"), Some("f")), &row),
            "c"
        );
        assert_eq!(
            resolve_title(&scanned(None, None, None, Some("f")), &row),
            "f"
        );
        assert_eq!(
            resolve_title(&scanned(None, None, None, None), &row),
            "未命名"
        );
        let named = MetaRow {
            custom_name: Some("mine".into()),
            ..Default::default()
        };
        assert_eq!(
            resolve_title(&scanned(Some("slot"), None, None, None), &named),
            "mine"
        );
    }

    #[test]
    fn label_rules() {
        let row = MetaRow {
            seq: Some(7),
            ..Default::default()
        };
        assert_eq!(
            resolve_label(&scanned(Some("#115-demo x"), None, None, None), &row),
            "#115"
        );
        assert_eq!(
            resolve_label(&scanned(Some("demo"), None, None, None), &row),
            "#L7"
        );
        let side = MetaRow {
            label: Some("#115.2".into()),
            ..row.clone()
        };
        assert_eq!(
            resolve_label(&scanned(Some("#115"), None, None, None), &side),
            "#115.2"
        );
        assert_eq!(
            resolve_label(&scanned(None, None, None, None), &MetaRow::default()),
            ""
        );
    }

    #[test]
    fn workspace_membership() {
        let ws = |id: &str, path: &str, kind| Workspace {
            id: id.into(),
            path: path.into(),
            name: id.into(),
            kind,
            sort: 0,
        };
        let list = vec![
            ws(
                "global",
                "/home/.omp-workspace/global",
                WorkspaceKind::Global,
            ),
            ws("repo", "/repo", WorkspaceKind::Project),
            ws("sub", "/repo/pkg", WorkspaceKind::Project),
        ];
        let g = "/home/.omp-workspace/global";
        let r = |explicit, root, cwd| resolve_workspace(explicit, &list, root, cwd, g);
        assert_eq!(r(None, None, "/repo/pkg/src"), Some("sub".into()));
        assert_eq!(r(None, None, "/repo/other"), Some("repo".into()));
        assert_eq!(r(None, None, "/repository"), None);
        // Worktree cwd resolves through repo_root.
        assert_eq!(
            r(None, Some("/repo"), "/repo/.worktrees/x"),
            Some("repo".into())
        );
        assert_eq!(r(Some("sub"), None, "/elsewhere"), Some("sub".into()));
        assert_eq!(r(Some("gone"), None, "/elsewhere"), None);
        assert_eq!(
            r(None, None, "/home/.omp-workspace/global"),
            Some("global".into())
        );
    }

    #[test]
    fn session_file_filter() {
        let dir = Path::new("/s");
        assert!(is_session_file(dir, Path::new("/s/b/x.jsonl")));
        assert!(!is_session_file(dir, Path::new("/s/b/x/sub.jsonl")));
        assert!(!is_session_file(dir, Path::new("/s/b/x.txt")));
    }

    #[test]
    fn scan_fixture_dir_and_cache() {
        let dir = std::env::temp_dir().join(format!("ompws-scan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("bucket/sub")).unwrap();
        let f = dir.join("bucket/a.jsonl");
        std::fs::write(
            &f,
            concat!(
                r#"{"type":"session","id":"A","timestamp":"T","cwd":"/w"}"#, "\n",
                r#"{"type":"message","timestamp":"T1","message":{"role":"user","content":"hello world"}}"#, "\n",
            ),
        )
        .unwrap();
        std::fs::write(dir.join("bucket/sub/nested.jsonl"), "{}\n").unwrap();
        let (map, changed) = scan_files(list_files(&dir), &FileMap::new());
        assert_eq!(map.len(), 1);
        assert_eq!(changed.len(), 1);
        let s = map.values().next().unwrap();
        assert_eq!(s.first_user.as_deref(), Some("hello world"));
        // Unchanged files are served from cache.
        let (_, changed) = scan_files(list_files(&dir), &map);
        assert!(changed.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Timing check against the real session store (skipped when absent).
    #[test]
    fn real_sessions_scan_is_fast() {
        let dir = crate::paths::omp_sessions_dir();
        if !dir.is_dir() {
            eprintln!("no real sessions dir; skipping");
            return;
        }
        let t0 = std::time::Instant::now();
        let files = list_files(&dir);
        let n = files.len();
        let bytes: u64 = files.iter().map(|f| f.1).sum();
        let (map, _) = scan_files(files, &FileMap::new());
        let cold = t0.elapsed();
        let t1 = std::time::Instant::now();
        let (_, changed) = scan_files(list_files(&dir), &map);
        let warm = t1.elapsed();
        eprintln!(
            "real scan: {n} files ({} MB), parsed {} in {cold:?} cold; warm rescan {warm:?} ({} reparsed)",
            bytes / 1_000_000,
            map.len(),
            changed.len()
        );
        // Debug builds parse JSON several times slower than release.
        let budget = if cfg!(debug_assertions) { 3_000 } else { 1_000 };
        assert!(cold.as_millis() < budget, "cold scan took {cold:?}");
    }
}
