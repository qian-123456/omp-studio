//! Worktree create/list/remove and orphan detection.

use std::path::{Path, PathBuf};

use super::cmd::{git, git_ok};
use crate::contracts::WorktreeInfo;

/// Directory (under the main repo root) holding session / time-machine worktrees.
pub const WORKTREES_DIR: &str = ".worktrees";

/// Resolved repository locations for a directory.
#[derive(Debug, Clone)]
pub struct RepoInfo {
    /// Toplevel of the worktree containing `dir`.
    pub toplevel: PathBuf,
    /// Shared `.git` directory.
    pub common_dir: PathBuf,
    /// Per-worktree git dir (equals `common_dir` in the main worktree).
    pub git_dir: PathBuf,
}

impl RepoInfo {
    /// Main repository root (parent of the common `.git` dir).
    pub fn main_root(&self) -> PathBuf {
        if self.common_dir.file_name().is_some_and(|n| n == ".git") {
            self.common_dir
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| self.toplevel.clone())
        } else {
            self.toplevel.clone()
        }
    }
    pub fn is_linked_worktree(&self) -> bool {
        self.git_dir != self.common_dir
    }
}

pub fn repo_info(dir: &Path) -> Option<RepoInfo> {
    if !dir.is_dir() {
        return None;
    }
    let text = git_ok(
        dir,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-common-dir",
            "--git-dir",
        ],
    )
    .ok()?;
    let mut lines = text.lines();
    let toplevel = canon(Path::new(lines.next()?));
    let common_dir = canon(Path::new(lines.next()?));
    let git_dir = canon(Path::new(lines.next()?));
    Some(RepoInfo {
        toplevel,
        common_dir,
        git_dir,
    })
}

/// Canonicalize when possible (macOS `/tmp` → `/private/tmp`).
pub fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Whether `child` equals or is inside `parent` (both canonical).
pub fn is_inside(child: &Path, parent: &Path) -> bool {
    child.starts_with(parent)
}

/// Turn a free-form name into a safe branch/dir slug.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if c == '.' {
            // git refs forbid "..".
            if !out.ends_with('.') {
                out.push(c);
            }
        } else if matches!(c, '-' | '_') {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches(|c| c == '-' || c == '.').to_string();
    let out: String = out.chars().take(48).collect();
    let out = out.trim_end_matches(['-', '.']);
    // git refs reject a trailing ".lock".
    out.strip_suffix(".lock").unwrap_or(out).to_string()
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WtEntry {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub bare: bool,
}

/// Parse `git worktree list --porcelain -z`.
pub fn parse_worktree_list(raw: &[u8]) -> Vec<WtEntry> {
    let text = String::from_utf8_lossy(raw);
    let mut out = Vec::new();
    let mut cur: Option<WtEntry> = None;
    for field in text.split('\0') {
        if field.is_empty() {
            // Blank field terminates a record.
            if let Some(e) = cur.take() {
                out.push(e);
            }
            continue;
        }
        if let Some(p) = field.strip_prefix("worktree ") {
            if let Some(e) = cur.take() {
                out.push(e);
            }
            cur = Some(WtEntry {
                path: p.to_string(),
                ..Default::default()
            });
        } else if let Some(e) = cur.as_mut() {
            if let Some(h) = field.strip_prefix("HEAD ") {
                e.head = h.to_string();
            } else if let Some(b) = field.strip_prefix("branch ") {
                e.branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
            } else if field == "bare" {
                e.bare = true;
            }
        }
    }
    if let Some(e) = cur {
        out.push(e);
    }
    out
}

pub fn list_entries(repo: &Path) -> Result<Vec<WtEntry>, String> {
    let out = git_ok(repo, &["worktree", "list", "--porcelain", "-z"])?;
    Ok(parse_worktree_list(out.as_bytes()))
}

/// Number of uncommitted changes (tracked or untracked) in a worktree.
pub fn dirty_count(path: &Path) -> u32 {
    git(path, &["status", "--porcelain", "-z"])
        .ok()
        .filter(|o| o.ok())
        .map(|o| porcelain_z_entries(&o.stdout))
        .unwrap_or(0)
}

/// Whether a worktree has uncommitted changes (tracked or untracked).
pub fn is_dirty(path: &Path) -> bool {
    dirty_count(path) > 0
}

/// Count entries in `git status --porcelain -z` output. Renames/copies carry
/// an extra NUL-terminated source path that must not be counted twice.
fn porcelain_z_entries(out: &[u8]) -> u32 {
    let mut n = 0;
    let mut fields = out.split(|&b| b == 0).filter(|f| !f.is_empty());
    while let Some(entry) = fields.next() {
        n += 1;
        if entry.len() >= 2 && matches!(entry[..2], [b'R' | b'C', _] | [_, b'R' | b'C']) {
            fields.next();
        }
    }
    n
}

/// Assign each session to the deepest worktree path containing its cwd.
/// `sessions` contains pre-canonicalized paths `(session_id, canon_cwd)` to avoid
/// running `std::fs::canonicalize` repeatedly inside nested loops.
fn sessions_for_canon(
    path: &Path,
    all_paths: &[PathBuf],
    sessions: &[(&str, PathBuf)],
) -> Vec<String> {
    sessions
        .iter()
        .filter(|(_, cwd)| {
            if !is_inside(cwd, path) {
                return false;
            }
            // Not claimed by a deeper worktree nested inside `path`.
            !all_paths
                .iter()
                .any(|p| p != path && is_inside(p, path) && is_inside(cwd, p))
        })
        .map(|(id, _)| (*id).to_string())
        .collect()
}

/// Public helper for callers that need session assignment without running `dirty_count`.
pub fn sessions_for_path(
    path: &Path,
    all_paths: &[PathBuf],
    sessions: &[(String, String)],
) -> Vec<String> {
    let canon_sessions: Vec<(&str, PathBuf)> = sessions
        .iter()
        .map(|(id, cwd)| (id.as_str(), canon(Path::new(cwd))))
        .collect();
    sessions_for_canon(path, all_paths, &canon_sessions)
}

/// List worktrees of `repo` with dirty flags and session mapping.
pub fn list(repo: &Path, sessions: &[(String, String)]) -> Result<Vec<WorktreeInfo>, String> {
    let entries: Vec<WtEntry> = list_entries(repo)?
        .into_iter()
        .filter(|e| !e.bare)
        .collect();
    let paths: Vec<PathBuf> = entries.iter().map(|e| canon(Path::new(&e.path))).collect();
    // Pre-canonicalize session paths once before the loop (avoids O(worktrees * sessions) syscalls)
    let canon_sessions: Vec<(&str, PathBuf)> = sessions
        .iter()
        .map(|(id, cwd)| (id.as_str(), canon(Path::new(cwd))))
        .collect();
    let base = super::history::local_base(repo);
    Ok(entries
        .into_iter()
        .zip(paths.iter())
        .map(|(e, p)| {
            let (ahead, behind) = match base.as_deref() {
                Some(b) if p.is_dir() && e.branch.as_deref() != Some(b) => ahead_behind(p, b),
                _ => (0, 0),
            };
            WorktreeInfo {
                dirty: if p.is_dir() { dirty_count(p) } else { 0 },
                session_ids: sessions_for_canon(p, &paths, &canon_sessions),
                path: p.to_string_lossy().into_owned(),
                branch: e.branch,
                head: e.head,
                ahead,
                behind,
            }
        })
        .collect())
}

/// `(ahead, behind)` of HEAD in `dir` relative to `base`; failures → (0, 0).
pub fn ahead_behind(dir: &Path, base: &str) -> (u32, u32) {
    let range = format!("{base}...HEAD");
    git_ok(dir, &["rev-list", "--left-right", "--count", &range])
        .ok()
        .and_then(|t| {
            let mut it = t.split_whitespace().map(|n| n.parse::<u32>().ok());
            let behind = it.next()??;
            let ahead = it.next()??;
            Some((ahead, behind))
        })
        .unwrap_or((0, 0))
}

/// Make sure `<common-dir>/info/exclude` ignores `.worktrees/`.
pub fn ensure_excluded(common_dir: &Path) -> Result<(), String> {
    let file = common_dir.join("info").join("exclude");
    let current = std::fs::read_to_string(&file).unwrap_or_default();
    let line = format!("/{WORKTREES_DIR}/");
    if current.lines().any(|l| {
        matches!(
            l.trim(),
            "/.worktrees/" | ".worktrees/" | ".worktrees" | "/.worktrees"
        )
    }) {
        return Ok(());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut next = current;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(&line);
    next.push('\n');
    std::fs::write(&file, next).map_err(|e| format!("write {}: {e}", file.display()))
}

fn info_for(path: &Path, sessions: &[(String, String)]) -> Result<WorktreeInfo, String> {
    let canon_path = canon(path);
    list(path, sessions)?
        .into_iter()
        .find(|w| Path::new(&w.path) == canon_path)
        .ok_or_else(|| "worktree not found after creation".to_string())
}

/// `git worktree add` into `<root>/.worktrees/<slug>` checking out `branch`
/// (default `omp/<slug>`). When the branch doesn't exist yet it is created
/// from `base` (default: current HEAD).
pub fn create(
    repo: &Path,
    name: &str,
    branch: Option<&str>,
    base: Option<&str>,
) -> Result<WorktreeInfo, String> {
    let info = repo_info(repo).ok_or("不是 git 仓库")?;
    let slug = slugify(name);
    if slug.is_empty() {
        return Err("worktree 名称无效".into());
    }
    if !super::status::has_head(&info.toplevel) {
        return Err("仓库还没有任何提交，无法创建 worktree".into());
    }
    let root = info.main_root();
    ensure_excluded(&info.common_dir)?;
    let target = root.join(WORKTREES_DIR).join(&slug);
    if target.exists() {
        return Err(format!("目录已存在：{}", target.display()));
    }
    // `branch` is a real ref name (slashes allowed), not a slug.
    let branch = match branch.map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) => b.to_string(),
        None => format!("omp/{slug}"),
    };
    let valid = git(&root, &["check-ref-format", "--branch", &branch])
        .map(|o| o.ok())
        .unwrap_or(false);
    if !valid {
        return Err(format!("分支名无效：{branch}"));
    }
    // Friendlier message than git's "already checked out at ...".
    if let Some(holder) = list_entries(&root)?
        .into_iter()
        .find(|e| e.branch.as_deref() == Some(branch.as_str()))
    {
        return Err(format!(
            "分支 {branch} 已被另一个工作树使用：{}",
            holder.path
        ));
    }
    let target_s = target.to_string_lossy().into_owned();
    let branch_exists = git(
        &root,
        &[
            "rev-parse",
            "--verify",
            "-q",
            &format!("refs/heads/{branch}"),
        ],
    )
    .map(|o| o.ok())
    .unwrap_or(false);
    if branch_exists {
        git_ok(&root, &["worktree", "add", &target_s, &branch])?;
    } else {
        let base = base
            .map(str::trim)
            .filter(|b| !b.is_empty())
            .unwrap_or("HEAD");
        let base_exists = git(
            &root,
            &["rev-parse", "--verify", "-q", &format!("{base}^{{commit}}")],
        )
        .map(|o| o.ok())
        .unwrap_or(false);
        if !base_exists {
            return Err(format!("基准分支不存在：{base}"));
        }
        git_ok(&root, &["worktree", "add", "-b", &branch, &target_s, base])?;
    }
    info_for(&target, &[])
}

/// `git worktree add --detach <root>/.worktrees/<dir> <sha>` (reuses an existing one).
pub fn create_detached(repo: &Path, dir_name: &str, sha: &str) -> Result<PathBuf, String> {
    let info = repo_info(repo).ok_or("不是 git 仓库")?;
    let root = info.main_root();
    ensure_excluded(&info.common_dir)?;
    let target = root.join(WORKTREES_DIR).join(dir_name);
    if target.is_dir() && repo_info(&target).is_some() {
        return Ok(canon(&target));
    }
    let target_s = target.to_string_lossy().into_owned();
    git_ok(&root, &["worktree", "add", "--detach", &target_s, sha])?;
    Ok(canon(&target))
}

/// Remove a linked worktree; refuses when dirty unless `force`.
pub fn remove(repo: &Path, path: &Path, delete_branch: bool, force: bool) -> Result<(), String> {
    let info = repo_info(repo).ok_or("不是 git 仓库")?;
    let root = info.main_root();
    let target = canon(path);
    let entries = list_entries(&root)?;
    let main_path = entries.first().map(|e| canon(Path::new(&e.path)));
    if main_path.as_deref() == Some(target.as_path()) {
        return Err("不能删除主工作区".into());
    }
    let entry = entries
        .iter()
        .find(|e| canon(Path::new(&e.path)) == target)
        .ok_or("不是该仓库的 worktree")?;
    if target.is_dir() && !force && is_dirty(&target) {
        return Err("worktree 有未提交的改动，已拒绝删除（可选择强制删除）".into());
    }
    let target_s = target.to_string_lossy().into_owned();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&target_s);
    if target.is_dir() {
        git_ok(&root, &args)?;
    } else {
        git_ok(&root, &["worktree", "prune"])?;
    }
    if delete_branch {
        if let Some(branch) = &entry.branch {
            let flag = if force { "-D" } else { "-d" };
            git_ok(&root, &["branch", flag, "--", branch])
                .map_err(|e| format!("worktree 已删除，但分支 {branch} 未删除：{e}"))?;
        }
    }
    Ok(())
}

/// Worktrees under `<root>/.worktrees/` of each repo with no session inside.
pub fn orphans(workspace_paths: &[String], sessions: &[(String, String)]) -> Vec<WorktreeInfo> {
    let mut roots: Vec<PathBuf> = workspace_paths
        .iter()
        .filter_map(|p| repo_info(Path::new(p)).map(|i| i.main_root()))
        .collect();
    roots.sort();
    roots.dedup();
    let mut out = Vec::new();
    for root in roots {
        let dir = root.join(WORKTREES_DIR);
        let Ok(list) = list(&root, sessions) else {
            continue;
        };
        out.extend(
            list.into_iter()
                .filter(|w| Path::new(&w.path).starts_with(&dir) && w.session_ids.is_empty()),
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_rules() {
        assert_eq!(slugify("Fix Login Bug!"), "fix-login-bug");
        assert_eq!(slugify("  中文 name "), "name");
        assert_eq!(slugify("---"), "");
        assert_eq!(slugify("a/b..c"), "a-b.c");
    }

    #[test]
    fn parses_worktree_porcelain() {
        let raw = b"worktree /r\0HEAD aaa\0branch refs/heads/main\0\0worktree /r/.worktrees/x\0HEAD bbb\0detached\0\0";
        let list = parse_worktree_list(raw);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert_eq!(list[1].branch, None);
        assert_eq!(list[1].head, "bbb");
    }

    #[test]
    fn nested_worktree_claims_sessions() {
        let main = PathBuf::from("/r");
        let wt = PathBuf::from("/r/.worktrees/x");
        let all = vec![main.clone(), wt.clone()];
        let sessions = vec![
            ("s1".to_string(), "/r/src".to_string()),
            ("s2".to_string(), "/r/.worktrees/x/pkg".to_string()),
        ];
        assert_eq!(sessions_for_path(&main, &all, &sessions), vec!["s1"]);
        assert_eq!(sessions_for_path(&wt, &all, &sessions), vec!["s2"]);
    }
}
