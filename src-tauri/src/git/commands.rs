//! [C] Tauri commands: git + time machine (docs/ARCHITECTURE.md §7).
#![allow(dead_code, unused_variables)]

use crate::contracts::{GitCommit, GitSummary, TmRun, WorktreeInfo};
use crate::state::AppState;

#[tauri::command]
pub async fn git_summary(
    state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<GitSummary, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn git_log(
    state: tauri::State<'_, AppState>,
    cwd: String,
    limit: u32,
) -> Result<Vec<GitCommit>, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn git_diff(
    state: tauri::State<'_, AppState>,
    cwd: String,
    path: Option<String>,
    sha: Option<String>,
) -> Result<String, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn git_create_worktree(
    state: tauri::State<'_, AppState>,
    repo: String,
    name: String,
) -> Result<WorktreeInfo, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn git_list_worktrees(
    state: tauri::State<'_, AppState>,
    repo: String,
) -> Result<Vec<WorktreeInfo>, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn git_remove_worktree(
    state: tauri::State<'_, AppState>,
    repo: String,
    path: String,
    delete_branch: bool,
    force: bool,
) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn git_scan_orphans(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorktreeInfo>, String> {
    Err("not implemented".to_string())
}

/// `mode`: "soft" | "hard".
#[tauri::command]
pub async fn git_reset_to(
    state: tauri::State<'_, AppState>,
    repo: String,
    sha: String,
    mode: String,
) -> Result<(), String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn tm_run(
    state: tauri::State<'_, AppState>,
    repo: String,
    sha: String,
    command: Option<String>,
) -> Result<TmRun, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn tm_list(state: tauri::State<'_, AppState>) -> Result<Vec<TmRun>, String> {
    Err("not implemented".to_string())
}

#[tauri::command]
pub async fn tm_stop(
    state: tauri::State<'_, AppState>,
    run_id: String,
    remove_worktree: bool,
) -> Result<(), String> {
    Err("not implemented".to_string())
}
