//! [C] Worktree ↔ local base branch (main/master) operations: diff since fork,
//! rebase, two-way local sync, discard all changes. Purely local, never touches
//! remotes (docs/ARCHITECTURE.md §7).

use std::path::Path;

use super::cmd::git_ok;
use super::{history, status, worktree};
use crate::contracts::BaseSyncResult;

const NO_BASE: &str = "找不到基础分支（本地 main / master）";
const DETACHED: &str = "当前处于游离 HEAD，无法与基础分支同步";
const DIRTY: &str = "工作区有未提交的改动，请先提交或丢弃";

fn local_base(dir: &Path) -> Result<String, String> {
    history::local_base(dir).ok_or_else(|| NO_BASE.to_string())
}

fn head_branch(dir: &Path) -> Option<String> {
    git_ok(dir, &["symbolic-ref", "-q", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Preconditions shared by rebase/sync: clean, on a branch, not the base itself.
/// Returns `(base, branch)`.
fn guard(dir: &Path) -> Result<(String, String), String> {
    let base = local_base(dir)?;
    let branch = head_branch(dir).ok_or(DETACHED)?;
    if branch == base {
        return Err(format!("当前就是基础分支 {base}，无需同步"));
    }
    if worktree::is_dirty(dir) {
        return Err(DIRTY.to_string());
    }
    Ok((base, branch))
}

fn count(dir: &Path, range: &str) -> u32 {
    git_ok(dir, &["rev-list", "--count", range])
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

fn conflict_files(dir: &Path) -> Vec<String> {
    git_ok(dir, &["diff", "--name-only", "--diff-filter=U"])
        .map(|s| s.lines().map(str::to_string).collect())
        .unwrap_or_default()
}

/// `CONFLICT:` + newline-separated paths when conflicts exist, else the raw error.
fn conflict_error(files: Vec<String>, raw: String) -> String {
    if files.is_empty() {
        raw
    } else {
        format!("CONFLICT:\n{}", files.join("\n"))
    }
}

/// Patch of commits on HEAD since its merge-base with the base (`base...HEAD`).
pub fn diff_base(dir: &Path) -> Result<String, String> {
    let base = local_base(dir)?;
    let range = format!("{base}...HEAD");
    git_ok(dir, &["diff", "--no-color", &range]).map(history::cap)
}

/// Rebase the current branch onto the base; aborts on conflict.
pub fn rebase_onto_base(dir: &Path) -> Result<String, String> {
    let (base, _) = guard(dir)?;
    match git_ok(dir, &["rebase", &base]) {
        Ok(out) => Ok(out),
        Err(e) => {
            let files = conflict_files(dir);
            let _ = git_ok(dir, &["rebase", "--abort"]);
            Err(conflict_error(files, e))
        }
    }
}

/// Reset tracked files to HEAD and remove untracked, non-ignored files.
pub fn discard_all(dir: &Path) -> Result<(), String> {
    if status::has_head(dir) {
        git_ok(dir, &["reset", "--hard", "-q", "HEAD"])?;
    } else {
        // Unborn branch: nothing to reset to; just empty the index.
        let _ = git_ok(
            dir,
            &["rm", "-r", "-q", "--cached", "--ignore-unmatch", "."],
        );
    }
    // No `-x`: ignored files (node_modules, .env, …) survive.
    git_ok(dir, &["clean", "-f", "-d", "-q"])?;
    Ok(())
}

/// Merge base into the branch in `dir`, then fast-forward the local base to it.
pub fn sync_with_base(dir: &Path) -> Result<BaseSyncResult, String> {
    let (base, branch) = guard(dir)?;
    let merged_from_base = count(dir, &format!("HEAD..{base}"));
    if merged_from_base > 0 {
        if let Err(e) = git_ok(dir, &["merge", "--no-edit", &base]) {
            let files = conflict_files(dir);
            let _ = git_ok(dir, &["merge", "--abort"]);
            return Err(conflict_error(files, e));
        }
    }
    let fast_forwarded = count(dir, &format!("{base}..HEAD"));
    if fast_forwarded > 0 {
        let base_checkout = worktree::list_entries(dir)?
            .into_iter()
            .find(|e| !e.bare && e.branch.as_deref() == Some(base.as_str()));
        match base_checkout {
            Some(e) => {
                git_ok(Path::new(&e.path), &["merge", "--ff-only", &branch])
                    .map_err(|err| format!("无法快进 {base}：{err}"))?;
            }
            None => {
                let head = git_ok(dir, &["rev-parse", "HEAD"])?.trim().to_string();
                let old = git_ok(dir, &["rev-parse", &base])?.trim().to_string();
                // update-ref with <old> refuses if base moved meanwhile; base is
                // an ancestor of HEAD after the merge above, so this is a fast-forward.
                let full = format!("refs/heads/{base}");
                git_ok(dir, &["update-ref", &full, &head, &old])?;
            }
        }
    }
    Ok(BaseSyncResult {
        merged_from_base,
        fast_forwarded,
    })
}
