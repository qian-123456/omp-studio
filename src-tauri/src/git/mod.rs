//! [C] Git status/log/diff/worktrees/time machine.
//! Cross-module API per docs/ARCHITECTURE.md §9 — stubbed at scaffold time.
#![allow(dead_code, unused_variables)]

pub mod commands;

use std::path::Path;

use crate::contracts::GitBadge;
use crate::state::AppState;

/// Not in §9; reserved for module C background tasks.
pub fn init(state: AppState) {}

/// Fast (cached ≤5s) git badge for a directory.
pub fn badge(cwd: &Path) -> Option<GitBadge> {
    None
}

/// Main repo root, resolves worktrees via git-common-dir.
pub fn repo_root(cwd: &Path) -> Option<String> {
    None
}
