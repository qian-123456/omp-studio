//! `git status` / `git diff --numstat` parsing and the change summary.

use std::collections::HashMap;
use std::path::Path;

use super::cmd::{git, git_ok};
use crate::contracts::{GitFileChange, GitSummary};

/// Hash of the empty tree; diff base for repositories without commits.
pub const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/// Max files returned in a summary.
const MAX_FILES: usize = 500;
/// Max untracked files whose lines we count.
const MAX_UNTRACKED_COUNT: usize = 200;
/// Max untracked file size whose lines we count.
const MAX_UNTRACKED_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    pub path: String,
    /// M A D R ??
    pub status: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Status {
    pub branch: Option<String>,
    pub entries: Vec<StatusEntry>,
}

/// Map a porcelain v1 `XY` pair to one of M A D R ??.
fn classify(x: char, y: char) -> &'static str {
    if x == '?' && y == '?' {
        return "??";
    }
    if x == 'R' || y == 'R' {
        return "R";
    }
    if x == 'C' || y == 'C' || x == 'A' || y == 'A' {
        // Copies and added files (conflict `AA` is still "added" from the UI's view).
        if x == 'D' || y == 'D' {
            return "M";
        }
        return "A";
    }
    if x == 'D' || y == 'D' {
        return "D";
    }
    "M"
}

/// Parse the `## ...` header line of `status -b`.
fn parse_branch(header: &str) -> Option<String> {
    let h = header.strip_prefix("## ")?;
    if let Some(rest) = h.strip_prefix("No commits yet on ") {
        return Some(rest.trim().to_string());
    }
    if let Some(rest) = h.strip_prefix("Initial commit on ") {
        return Some(rest.trim().to_string());
    }
    if h.starts_with("HEAD (no branch)") {
        return None;
    }
    let name = h.split("...").next().unwrap_or(h);
    let name = name.split(' ').next().unwrap_or(name);
    (!name.is_empty()).then(|| name.to_string())
}

/// Parse `git status --porcelain=v1 -z -b` output.
pub fn parse_porcelain(raw: &[u8]) -> Status {
    let text = String::from_utf8_lossy(raw);
    let mut fields = text.split('\0').filter(|f| !f.is_empty());
    let mut status = Status::default();
    while let Some(field) = fields.next() {
        if field.starts_with("## ") {
            status.branch = parse_branch(field);
            continue;
        }
        if field.len() < 4 {
            continue;
        }
        let mut chars = field.chars();
        let x = chars.next().unwrap_or(' ');
        let y = chars.next().unwrap_or(' ');
        chars.next(); // separator; char-based so non-ASCII records cannot split a code point
        let path = chars.as_str().to_string();
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            // Rename/copy: the original path follows as its own field.
            let _orig = fields.next();
        }
        status.entries.push(StatusEntry {
            path,
            status: classify(x, y).to_string(),
        });
    }
    status
}

/// Parse `git diff --numstat -z` output into path → (added, deleted).
pub fn parse_numstat(raw: &[u8]) -> HashMap<String, (u32, u32)> {
    let text = String::from_utf8_lossy(raw);
    let mut map = HashMap::new();
    let mut fields = text.split('\0');
    while let Some(field) = fields.next() {
        if field.is_empty() {
            continue;
        }
        let mut parts = field.splitn(3, '\t');
        let (Some(a), Some(d), Some(p)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let added = a.parse().unwrap_or(0);
        let deleted = d.parse().unwrap_or(0);
        let path = if p.is_empty() {
            // Rename: `a\td\t\0old\0new\0`.
            let _old = fields.next();
            fields.next().unwrap_or_default().to_string()
        } else {
            p.to_string()
        };
        map.insert(path, (added, deleted));
    }
    map
}

/// Count lines of a small text file; binary or oversized files count as 0.
fn count_lines(path: &Path) -> u32 {
    let Ok(meta) = std::fs::metadata(path) else {
        return 0;
    };
    if !meta.is_file() || meta.len() > MAX_UNTRACKED_BYTES {
        return 0;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return 0;
    };
    if bytes.contains(&0) {
        return 0;
    }
    let n = bytes.iter().filter(|&&b| b == b'\n').count();
    let trailing = !bytes.is_empty() && *bytes.last().unwrap() != b'\n';
    (n + usize::from(trailing)) as u32
}

/// `git status` for a directory; None when it is not a repository.
/// `all_untracked` lists files inside untracked dirs (slower).
pub fn status(dir: &Path, all_untracked: bool) -> Option<Status> {
    let u = if all_untracked { "-uall" } else { "-unormal" };
    let out = git(dir, &["status", "--porcelain=v1", "-z", "-b", u]).ok()?;
    out.ok().then(|| parse_porcelain(&out.stdout))
}

/// Whether HEAD resolves to a commit.
pub fn has_head(dir: &Path) -> bool {
    git(dir, &["rev-parse", "--verify", "-q", "HEAD"])
        .map(|o| o.ok())
        .unwrap_or(false)
}

/// Diff base: HEAD or the empty tree for unborn branches.
pub fn diff_base(dir: &Path) -> &'static str {
    if has_head(dir) {
        "HEAD"
    } else {
        EMPTY_TREE
    }
}

/// Full change summary for the UI (§11 C `git_summary`).
pub fn summary(dir: &Path) -> GitSummary {
    if !dir.is_dir() {
        return GitSummary::default();
    }
    let Some(st) = status(dir, true) else {
        return GitSummary::default();
    };
    let base = diff_base(dir);
    let numstat = git_ok(dir, &["diff", "--numstat", "-z", base])
        .map(|s| parse_numstat(s.as_bytes()))
        .unwrap_or_default();
    let root = git_ok(dir, &["rev-parse", "--show-toplevel"])
        .map(|s| std::path::PathBuf::from(s.trim()))
        .unwrap_or_else(|_| dir.to_path_buf());
    let mut untracked_counted = 0usize;
    let has_uncommitted = !st.entries.is_empty();
    let files = st
        .entries
        .into_iter()
        .take(MAX_FILES)
        .map(|e| {
            let (added, deleted) = if e.status == "??" {
                untracked_counted += 1;
                if untracked_counted <= MAX_UNTRACKED_COUNT {
                    (count_lines(&root.join(&e.path)), 0)
                } else {
                    (0, 0)
                }
            } else {
                numstat.get(&e.path).copied().unwrap_or((0, 0))
            };
            GitFileChange {
                path: e.path,
                status: e.status,
                added,
                deleted,
            }
        })
        .collect();
    GitSummary {
        is_repo: true,
        branch: st.branch,
        files,
        has_uncommitted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_non_ascii_garbage_does_not_panic() {
        // Byte index 3 would fall inside the 3-byte char; must not panic.
        let st = parse_porcelain("é文abc\0".as_bytes());
        assert_eq!(st.entries.len(), 1);
    }

    #[test]
    fn porcelain_parses_all_kinds() {
        let raw = b"## main...origin/main [ahead 1]\0 M src/a.rs\0A  new.txt\0 D gone.txt\0R  new_name.rs\0old_name.rs\0?? untracked file.md\0MM both.rs\0";
        let st = parse_porcelain(raw);
        assert_eq!(st.branch.as_deref(), Some("main"));
        let got: Vec<(&str, &str)> = st
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.status.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("src/a.rs", "M"),
                ("new.txt", "A"),
                ("gone.txt", "D"),
                ("new_name.rs", "R"),
                ("untracked file.md", "??"),
                ("both.rs", "M"),
            ]
        );
    }

    #[test]
    fn branch_header_variants() {
        assert_eq!(
            parse_branch("## No commits yet on main").as_deref(),
            Some("main")
        );
        assert_eq!(parse_branch("## HEAD (no branch)"), None);
        assert_eq!(parse_branch("## feat/x").as_deref(), Some("feat/x"));
    }

    #[test]
    fn numstat_parses_renames_and_binary() {
        let raw = b"3\t1\tsrc/a.rs\0-\t-\timg.png\x000\t0\t\0old.rs\0new.rs\0";
        let m = parse_numstat(raw);
        assert_eq!(m.get("src/a.rs"), Some(&(3, 1)));
        assert_eq!(m.get("img.png"), Some(&(0, 0)));
        assert_eq!(m.get("new.rs"), Some(&(0, 0)));
        assert_eq!(m.len(), 3);
    }
}
