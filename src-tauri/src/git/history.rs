//! Commit log, diffs and resets.

use std::path::Path;

use super::cmd::{git, git_ok};
use super::status::{diff_base, status};
use crate::contracts::{GitCommit, GitHistory};

/// Max diff size returned to the UI.
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
/// Max untracked files rendered in a whole-tree diff.
const MAX_UNTRACKED_DIFFS: usize = 20;

/// Validate a commit id (hex, 4..=40 chars) to prevent option injection.
pub fn valid_sha(sha: &str) -> bool {
    (4..=40).contains(&sha.len()) && sha.chars().all(|c| c.is_ascii_hexdigit())
}

/// Reject paths that could be parsed as options.
fn valid_path(path: &str) -> bool {
    !path.is_empty() && !path.starts_with('-')
}

pub fn parse_log(text: &str) -> Vec<GitCommit> {
    text.split('\x1e')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            if rec.is_empty() {
                return None;
            }
            let mut f = rec.split('\x1f');
            Some(GitCommit {
                sha: f.next()?.to_string(),
                short: f.next()?.to_string(),
                subject: f.next()?.to_string(),
                author: f.next()?.to_string(),
                ts: f.next()?.trim().to_string(),
            })
        })
        .collect()
}

pub fn log(dir: &Path, limit: u32) -> Vec<GitCommit> {
    let n = format!("-n{}", limit.clamp(1, 1000));
    git_ok(
        dir,
        &[
            "log",
            &n,
            "--no-color",
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e",
        ],
    )
    .map(|t| parse_log(&t))
    .unwrap_or_default()
}

/// The raw base ref: `origin/HEAD`'s target, else local `main`/`master`.
fn base_ref(dir: &Path) -> Option<String> {
    let short = |full: &str| full.trim_start_matches("refs/remotes/").to_string();
    git_ok(dir, &["symbolic-ref", "-q", "refs/remotes/origin/HEAD"])
        .ok()
        .map(|t| short(t.trim()))
        .or_else(|| local_main(dir))
}

fn local_branch_exists(dir: &Path, name: &str) -> bool {
    let full = format!("refs/heads/{name}");
    git_ok(dir, &["rev-parse", "--verify", "-q", &full])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

fn local_main(dir: &Path) -> Option<String> {
    ["main", "master"]
        .into_iter()
        .find(|b| local_branch_exists(dir, b))
        .map(str::to_string)
}

/// Local base branch name (the local counterpart of the history base, else
/// local `main`/`master`). Unlike `fork_base`, returned even when HEAD is it.
pub fn local_base(dir: &Path) -> Option<String> {
    base_ref(dir)
        .map(|b| b.trim_start_matches("origin/").to_string())
        .filter(|b| local_branch_exists(dir, b))
        .or_else(|| local_main(dir))
}

/// The branch a worktree's history forks from: `origin/HEAD`'s target, else
/// local `main`/`master`. None when HEAD itself is the base branch.
pub fn fork_base(dir: &Path) -> Option<String> {
    let base = base_ref(dir)?;
    // Don't fork a worktree against itself (the base's own worktree view).
    // Detached HEAD keeps the base — it can still have a fork point.
    let head_branch = git_ok(dir, &["symbolic-ref", "-q", "--short", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if !head_branch.is_empty()
        && (head_branch == base || head_branch == base.trim_start_matches("origin/"))
    {
        return None;
    }
    Some(base)
}

pub fn history(dir: &Path, limit: u32) -> GitHistory {
    let base = fork_base(dir);
    let fork_point = base.as_deref().and_then(|b| {
        git_ok(dir, &["merge-base", "HEAD", b]).ok().and_then(|s| {
            let sha = s.trim();
            (!sha.is_empty()).then(|| sha.to_string())
        })
    });
    GitHistory {
        commits: log(dir, limit),
        fork_point,
        base,
    }
}

pub(super) fn cap(mut s: String) -> String {
    if s.len() > MAX_DIFF_BYTES {
        let mut end = MAX_DIFF_BYTES;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
        s.push_str("\n… (diff 过大，已截断)\n");
    }
    s
}

/// Diff of an untracked file against /dev/null (exit code 1 means "differs").
fn untracked_diff(dir: &Path, path: &str) -> String {
    git(
        dir,
        &["diff", "--no-color", "--no-index", "--", "/dev/null", path],
    )
    .map(|o| o.text())
    .unwrap_or_default()
}

/// `git_diff`: commit diff when `sha` is set, else working tree vs HEAD
/// (including untracked files), optionally limited to `path`.
pub fn diff(dir: &Path, path: Option<&str>, sha: Option<&str>) -> Result<String, String> {
    if let Some(p) = path {
        if !valid_path(p) {
            return Err("invalid path".into());
        }
    }
    // Paths from status/numstat are relative to the toplevel.
    let top = git_ok(dir, &["rev-parse", "--show-toplevel"])?;
    let top = Path::new(top.trim());
    if let Some(sha) = sha {
        if !valid_sha(sha) {
            return Err("invalid commit id".into());
        }
        let mut args = vec!["show", "--no-color", "--format=medium", "--patch", sha];
        if let Some(p) = path {
            args.extend(["--", p]);
        }
        return git_ok(top, &args).map(cap);
    }
    let base = diff_base(dir);
    let untracked: Vec<String> = status(dir, true)
        .map(|s| {
            s.entries
                .into_iter()
                .filter(|e| e.status == "??")
                .map(|e| e.path)
                .collect()
        })
        .unwrap_or_default();
    let mut out = String::new();
    match path {
        Some(p) if untracked.iter().any(|u| u == p) => {
            out.push_str(&untracked_diff(top, p));
        }
        Some(p) => out.push_str(&git_ok(top, &["diff", "--no-color", base, "--", p])?),
        None => {
            out.push_str(&git_ok(top, &["diff", "--no-color", base])?);
            for u in untracked.iter().take(MAX_UNTRACKED_DIFFS) {
                out.push_str(&untracked_diff(top, u));
            }
            if untracked.len() > MAX_UNTRACKED_DIFFS {
                out.push_str(&format!(
                    "\n… 另有 {} 个未跟踪文件未显示\n",
                    untracked.len() - MAX_UNTRACKED_DIFFS
                ));
            }
        }
    }
    Ok(cap(out))
}

/// `git reset --soft|--hard <sha>`.
pub fn reset_to(dir: &Path, sha: &str, mode: &str) -> Result<(), String> {
    if !valid_sha(sha) {
        return Err("invalid commit id".into());
    }
    let flag = match mode {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => return Err(format!("unknown reset mode: {mode}")),
    };
    git_ok(dir, &["reset", flag, sha]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records() {
        let text = "abc123\x1fabc\x1ffix: thing\x1fAlice\x1f2025-01-01T00:00:00+08:00\x1e\ndef456\x1fdef\x1fsecond\x1fBob\x1f2025-01-02T00:00:00Z\x1e\n";
        let log = parse_log(text);
        assert_eq!(log.len(), 2);
        assert_eq!(log[1].author, "Bob");
        assert_eq!(log[0].sha, "abc123");
        assert_eq!(log[0].subject, "fix: thing");
        assert_eq!(log[0].ts, "2025-01-01T00:00:00+08:00");
    }

    #[test]
    fn sha_validation() {
        assert!(valid_sha("deadbeef"));
        assert!(!valid_sha("--hard"));
        assert!(!valid_sha("abc"));
        assert!(!valid_sha("HEAD~1"));
    }
}
