//! Directory listing + cached, parallel per-file parsing, and the pure
//! `SessionMeta` builder (title / label / workspace membership).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::SystemTime;

use regex::Regex;

use super::parse::{self, HeadInfo, LastRole, TailInfo};
use super::store::MetaRow;
use crate::contracts::{GitBadge, SessionMeta, SpaceMode, Workspace, WorkspaceKind};

/// Cached parse result for one session file, keyed by (path, size, mtime).
#[derive(Debug, Clone)]
pub struct Scanned {
    pub path: PathBuf,
    pub size: u64,
    pub mtime: SystemTime,
    pub head: HeadInfo,
    /// Fingerprint of the head window the cached `head` was parsed from
    /// ([`parse::head_fingerprint`]); 0 = unknown (legacy cache entry).
    pub head_hash: u64,
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
    // A longer file is assumed appended-to, but that is only safe while the
    // head bytes are unchanged: an in-place rewrite of the first lines (a new
    // title slot) can keep or grow the size, and reusing the cached head would
    // pin the old title/session id forever. Compare the head window instead of
    // trusting the length.
    let reuse = prev.filter(|p| {
        size >= p.size
            && !p.head.id.is_empty()
            && p.head_hash != 0
            && parse::read_head_bytes(path)
                .is_ok_and(|bytes| parse::head_fingerprint(&bytes) == p.head_hash)
    });
    let (head, head_hash) = match reuse {
        Some(p) => (p.head.clone(), p.head_hash),
        None => {
            let bytes = parse::read_head_bytes(path).ok()?;
            (parse::parse_head(&bytes)?, parse::head_fingerprint(&bytes))
        }
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
        head_hash,
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

pub(crate) fn path_within(path: &str, root: &str) -> bool {
    let root = root.trim_end_matches('/');
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn canon_cache() -> &'static parking_lot::Mutex<HashMap<String, String>> {
    static CANON_CACHE: std::sync::OnceLock<parking_lot::Mutex<HashMap<String, String>>> =
        std::sync::OnceLock::new();
    CANON_CACHE.get_or_init(Default::default)
}

/// Forget memoized canonical paths; called once at the start of each catalog
/// build so symlink/dir changes are picked up by the next build.
pub fn reset_canon_cache() {
    canon_cache().lock().clear();
}

/// `canonicalize` (falling back to the input), memoized for the current build.
fn canon_str(path: &str) -> String {
    if let Some(v) = canon_cache().lock().get(path) {
        return v.clone();
    }
    let v = std::fs::canonicalize(path)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    canon_cache().lock().insert(path.to_string(), v.clone());
    v
}

/// Membership within the session's mode: explicit override > registered
/// project workspace containing `repo_root ?? cwd` (longest path wins) >
/// the global workspace (chat space only) if cwd under `global_dir` > None.
/// Workspaces of other modes are never considered — spaces share nothing.
/// `global_dir` is `paths::global_dir()`.
pub fn resolve_workspace(
    explicit: Option<&str>,
    mode: SpaceMode,
    workspaces: &[Workspace],
    repo_root: Option<&str>,
    cwd: &str,
    global_dir: &str,
) -> Option<String> {
    if let Some(id) = explicit {
        if workspaces.iter().any(|w| w.id == id && w.mode == mode) {
            return Some(id.to_string());
        }
    }
    for target in [repo_root, Some(cwd)].into_iter().flatten() {
        // macOS: /tmp → /private/tmp, /var → /private/var. Session cwds keep
        // the short form while workspace paths are usually canonicalized —
        // compare canonical forms so symlinked dirs still group correctly.
        let canon = canon_str(target);
        let best = workspaces
            .iter()
            .filter(|w| w.kind == WorkspaceKind::Project && w.mode == mode)
            .filter(|w| path_within(&canon, &canon_str(&w.path)))
            .max_by_key(|w| w.path.len());
        if let Some(w) = best {
            return Some(w.id.clone());
        }
    }
    if path_within(cwd, global_dir) {
        return workspaces
            .iter()
            .find(|w| w.kind == WorkspaceKind::Global && w.mode == mode)
            .map(|w| w.id.clone());
    }
    None
}

/// Build the static part of a SessionMeta (status fields are filled by the caller).
/// The session's space is derived: a cwd under the global dir is always
/// `chat` (covers legacy rows and sessions without a row); otherwise the
/// stored `row.mode` applies, except a stale `chat` row outside the global
/// dir, which falls back to `code`.
pub fn build_meta(
    s: &Scanned,
    row: &MetaRow,
    git: &GitInfo,
    workspaces: &[Workspace],
    parent_id: Option<String>,
) -> SessionMeta {
    // Recency = last real conversation message, not file mtime: a terminal
    // `/exit` (or any housekeeping append) touches the file without activity.
    let updated_at = s
        .tail
        .last_msg
        .as_ref()
        .and_then(|m| chrono::DateTime::parse_from_rfc3339(&m.ts).ok())
        .map(|t| t.with_timezone(&chrono::Utc))
        .unwrap_or_else(|| chrono::DateTime::<chrono::Utc>::from(s.mtime))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let cwd = effective_cwd(&s.head, row);
    let global_dir = crate::paths::global_dir().to_string_lossy().to_string();
    let mode = if path_within(cwd, &global_dir) {
        SpaceMode::Chat
    } else if row.mode == SpaceMode::Chat {
        SpaceMode::Code
    } else {
        row.mode
    };
    let workspace_id = resolve_workspace(
        row.workspace_id.as_deref(),
        mode,
        workspaces,
        git.repo_root.as_deref(),
        cwd,
        &global_dir,
    );
    // Groups only apply to global-workspace (通用对话) sessions.
    let group_id = row
        .group_id
        .clone()
        .filter(|_| workspace_id.as_deref() == Some(crate::contracts::GLOBAL_WORKSPACE_ID));
    SessionMeta {
        id: s.head.id.clone(),
        tool: "omp".to_string(),
        file: s.path.to_string_lossy().to_string(),
        cwd: cwd.to_string(),
        title: resolve_title(s, row),
        label: resolve_label(s, row),
        created_at: s.head.created_at.clone(),
        updated_at,
        fork_depth: row.fork_depth,
        kind: row.kind.clone(),
        parent_id,
        pinned: row.pinned,
        archived: row.archived,
        unread: row.unread,
        workspace_id,
        repo_root: git.repo_root.clone(),
        git: git.badge.clone(),
        result: s.tail.result.clone(),
        last_assistant: s.tail.last_assistant.clone(),
        model: s.tail.model.clone(),
        mode,
        group_id,
        created_by_app: row.created_by_app,
        ..Default::default()
    }
}

/// Git facts per cwd (from `git::badge` / `git::repo_root`; may be None while stubbed).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GitInfo {
    pub badge: Option<GitBadge>,
    pub repo_root: Option<String>,
}

/// The cwd the session effectively runs in: the persisted resume override
/// (`session_meta.cwd_override`, chosen after the original worktree dir was
/// deleted) wins over the cwd recorded in the transcript header.
pub fn effective_cwd<'a>(head: &'a HeadInfo, row: &'a MetaRow) -> &'a str {
    row.cwd_override
        .as_deref()
        .filter(|c| !c.trim().is_empty())
        .unwrap_or(&head.cwd)
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
            head_hash: 0,
            tail: TailInfo {
                title_change: change.map(Into::into),
                ..Default::default()
            },
            first_user: first.map(Into::into),
        }
    }

    #[test]
    fn updated_at_follows_last_message_not_mtime() {
        let mut s = scanned(None, None, None, None);
        // File touched long after the last conversation message (terminal /exit).
        s.mtime = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(2_000_000_000);
        let row = MetaRow::default();
        let meta = build_meta(&s, &row, &GitInfo::default(), &[], None);
        assert_eq!(meta.updated_at, "2033-05-18T03:33:20.000Z");

        s.tail.last_msg = Some(parse::LastMsg {
            role: LastRole::Assistant,
            stop_reason: Some("stop".into()),
            has_tool_calls: false,
            ts: "2026-10-07T12:49:54.926Z".into(),
        });
        let meta = build_meta(&s, &row, &GitInfo::default(), &[], None);
        assert_eq!(meta.updated_at, "2026-10-07T12:49:54.926Z");
    }

    #[test]
    fn workspace_membership() {
        let ws = |id: &str, path: &str, kind| Workspace {
            id: id.into(),
            path: path.into(),
            name: id.into(),
            kind,
            sort: 0,
            mode: if kind == WorkspaceKind::Global {
                SpaceMode::Chat
            } else {
                SpaceMode::Code
            },
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
        let r =
            |explicit, root, cwd| resolve_workspace(explicit, SpaceMode::Code, &list, root, cwd, g);
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
        // The global workspace belongs to chat only.
        assert_eq!(
            resolve_workspace(None, SpaceMode::Chat, &list, None, g, g),
            Some("global".into())
        );
        assert_eq!(r(None, None, g), None);
    }

    /// The same cwd can be a project workspace in two modes; each session
    /// resolves only inside its own space (spaces share nothing).
    #[test]
    fn workspace_resolution_is_per_mode() {
        let ws = |id: &str, path: &str, kind, mode: SpaceMode| Workspace {
            id: id.into(),
            path: path.into(),
            name: id.into(),
            kind,
            sort: 0,
            mode,
        };
        let g = "/home/.omp-workspace/global";
        let list = vec![
            ws("global", g, WorkspaceKind::Global, SpaceMode::Chat),
            ws("repo-c", "/repo", WorkspaceKind::Project, SpaceMode::Code),
            ws("repo-w", "/repo", WorkspaceKind::Project, SpaceMode::Work),
        ];
        // Same cwd, different session modes → that mode's project row.
        assert_eq!(
            resolve_workspace(None, SpaceMode::Code, &list, None, "/repo/x", g),
            Some("repo-c".into())
        );
        assert_eq!(
            resolve_workspace(None, SpaceMode::Work, &list, None, "/repo/x", g),
            Some("repo-w".into())
        );
        // An explicit override from the wrong mode is ignored.
        assert_eq!(
            resolve_workspace(
                Some("repo-c"),
                SpaceMode::Work,
                &list,
                None,
                "/elsewhere",
                g
            ),
            None
        );
        // Chat never resolves into a project.
        assert_eq!(
            resolve_workspace(None, SpaceMode::Chat, &list, None, "/repo/x", g),
            None
        );
    }

    /// Sessions whose session_meta row has mode='work' resolve inside the
    /// work space; rows without a mode (pre-migration, external) are code.
    #[test]
    fn build_meta_uses_row_mode() {
        let s = scanned(None, None, None, None);
        let list = vec![
            Workspace {
                id: "global".into(),
                path: "/home/.omp-workspace/global".into(),
                name: "g".into(),
                kind: WorkspaceKind::Global,
                sort: 0,
                mode: SpaceMode::Chat,
            },
            Workspace {
                id: "repo".into(),
                path: "/repo".into(),
                name: "r".into(),
                kind: WorkspaceKind::Project,
                sort: 0,
                mode: SpaceMode::Code,
            },
        ];
        // Code-mode row: /repo/app cwd joins the code project.
        let meta = build_meta(&s, &MetaRow::default(), &GitInfo::default(), &list, None);
        assert_eq!(meta.workspace_id.as_deref(), Some("repo"));
        assert_eq!(meta.mode, SpaceMode::Code);
        // Work-mode row: same cwd finds no work workspace → 未归档.
        let row = MetaRow {
            mode: SpaceMode::Work,
            ..Default::default()
        };
        let meta = build_meta(&s, &row, &GitInfo::default(), &list, None);
        assert_eq!(meta.workspace_id, None);
        assert_eq!(meta.mode, SpaceMode::Work);
    }

    /// build_meta drops group_id once the session no longer resolves to its
    /// mode's global workspace (moved into a project / mode mismatch).
    #[test]
    fn build_meta_group_requires_global_membership() {
        let gdir = crate::paths::global_dir();
        let s = {
            let mut s = scanned(None, None, None, None);
            s.head.cwd = gdir.join("x").to_string_lossy().to_string();
            s
        };
        let list = vec![Workspace {
            id: "global".into(),
            path: gdir.to_string_lossy().to_string(),
            name: "g".into(),
            kind: WorkspaceKind::Global,
            sort: 0,
            mode: SpaceMode::Chat,
        }];
        let row = MetaRow {
            group_id: Some("g1".into()),
            ..Default::default()
        };
        let meta = build_meta(&s, &row, &GitInfo::default(), &list, None);
        assert_eq!(meta.group_id.as_deref(), Some("g1"));
        // A default (code) row under the global dir is derived as chat.
        assert_eq!(meta.mode, SpaceMode::Chat);
        assert_eq!(meta.workspace_id.as_deref(), Some("global"));
        // cwd in a real project: grouped flag suppressed.
        let proj = Workspace {
            id: "repo".into(),
            path: "/repo".into(),
            name: "r".into(),
            kind: WorkspaceKind::Project,
            sort: 0,
            mode: SpaceMode::Code,
        };
        let mut list2 = list.clone();
        list2.push(proj);
        let s2 = scanned(None, None, None, None); // cwd /repo/app
        let meta = build_meta(&s2, &row, &GitInfo::default(), &list2, None);
        assert_eq!(meta.workspace_id.as_deref(), Some("repo"));
        assert_eq!(meta.group_id, None);
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

    /// An in-place rewrite of the first lines that keeps the size must invalidate
    /// the cached head: the old title slot would otherwise win over the new one.
    #[test]
    fn equal_length_head_rewrite_invalidates_cached_head() {
        let dir = std::env::temp_dir().join(format!("ompws-head-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.jsonl");
        let line1 = r#"{"type":"title","title":"AAAA"}"#;
        let line2 = r#"{"type":"session","id":"A","timestamp":"T","cwd":"/w"}"#;
        std::fs::write(&f, format!("{line1}\n{line2}\n")).unwrap();
        let size = std::fs::metadata(&f).unwrap().len();
        let mtime = std::fs::metadata(&f).unwrap().modified().unwrap();
        let first = parse_file(&f, size, mtime, None).unwrap();
        assert_eq!(first.head.slot_title.as_deref(), Some("AAAA"));
        assert_ne!(first.head_hash, 0);

        // Same length, different title (a user rename written in place).
        let rewritten = line1.replace("AAAA", "BBBB");
        assert_eq!(rewritten.len(), line1.len());
        std::fs::write(&f, format!("{rewritten}\n{line2}\n")).unwrap();
        let meta = std::fs::metadata(&f).unwrap();
        assert_eq!(meta.len(), size, "rewrite must keep the size");
        let second = parse_file(&f, meta.len(), meta.modified().unwrap(), Some(&first)).unwrap();
        assert_eq!(second.head.slot_title.as_deref(), Some("BBBB"));

        // An untouched file still reuses the cached head.
        let third = parse_file(&f, meta.len(), meta.modified().unwrap(), Some(&second)).unwrap();
        assert_eq!(third.head_hash, second.head_hash);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn effective_cwd_prefers_override() {
        let s = scanned(None, None, None, None);
        let row = MetaRow {
            cwd_override: Some("/repo".into()),
            ..Default::default()
        };
        assert_eq!(effective_cwd(&s.head, &row), "/repo");
        assert_eq!(effective_cwd(&s.head, &MetaRow::default()), "/repo/app");
        // Blank overrides are ignored.
        let blank = MetaRow {
            cwd_override: Some("  ".into()),
            ..Default::default()
        };
        assert_eq!(effective_cwd(&s.head, &blank), "/repo/app");
        // build_meta puts the override into meta.cwd.
        let meta = build_meta(&s, &row, &GitInfo::default(), &[], None);
        assert_eq!(meta.cwd, "/repo");
        let meta = build_meta(&s, &MetaRow::default(), &GitInfo::default(), &[], None);
        assert_eq!(meta.cwd, "/repo/app");
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
