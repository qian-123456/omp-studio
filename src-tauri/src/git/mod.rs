//! [C] Git status/log/diff/worktrees/time machine.
//! Cross-module API per docs/ARCHITECTURE.md §9.

pub mod cmd;
pub mod commands;
pub mod history;
pub mod status;
pub mod tm;
pub mod worktree;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::contracts::GitBadge;
use crate::state::AppState;

const BADGE_TTL: Duration = Duration::from_secs(5);
const ROOT_TTL: Duration = Duration::from_secs(30);

type Cache<T> = Mutex<HashMap<PathBuf, (Instant, T)>>;

fn badge_cache() -> &'static Cache<Option<GitBadge>> {
    static C: OnceLock<Cache<Option<GitBadge>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn root_cache() -> &'static Cache<Option<String>> {
    static C: OnceLock<Cache<Option<String>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn cached<T: Clone>(cache: &Cache<T>, key: &Path, ttl: Duration, compute: impl FnOnce() -> T) -> T {
    if let Some((at, v)) = cache.lock().get(key) {
        if at.elapsed() < ttl {
            return v.clone();
        }
    }
    let v = compute();
    let mut map = cache.lock();
    if map.len() > 2048 {
        map.retain(|_, (at, _)| at.elapsed() < ttl);
    }
    map.insert(key.to_path_buf(), (Instant::now(), v.clone()));
    v
}

/// Not in §9; module C has no git background task (time-machine runs are
/// spawned on demand).
pub fn init(_state: AppState) {}

fn compute_badge(cwd: &Path) -> Option<GitBadge> {
    let info = worktree::repo_info(cwd)?;
    let st = status::status(cwd, false)?;
    let worktree = info
        .is_linked_worktree()
        .then(|| {
            info.toplevel
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
        })
        .flatten();
    Some(GitBadge {
        branch: st.branch,
        dirty: st.entries.len() as u32,
        worktree,
    })
}

/// Fast (cached ≤5s) git badge for a directory.
pub fn badge(cwd: &Path) -> Option<GitBadge> {
    cached(badge_cache(), cwd, BADGE_TTL, || compute_badge(cwd))
}

/// Main repo root, resolves worktrees via git-common-dir.
pub fn repo_root(cwd: &Path) -> Option<String> {
    cached(root_cache(), cwd, ROOT_TTL, || {
        worktree::repo_info(cwd).map(|i| i.main_root().to_string_lossy().into_owned())
    })
}
