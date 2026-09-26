//! [C] Tauri commands: git + time machine (docs/ARCHITECTURE.md §7).

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Emitter;

use super::{history, status, tm, worktree};
use crate::contracts::{GitCommit, GitSummary, TmRun, WorktreeInfo};
use crate::state::AppState;

/// Run blocking git work off the async runtime.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

/// `(session_id, cwd)` pairs from the catalog (empty while A is a stub).
async fn session_cwds(state: &AppState) -> Vec<(String, String)> {
    crate::catalog::list(state)
        .await
        .into_iter()
        .map(|s| (s.id, s.cwd))
        .collect()
}

/// Paths of registered project workspaces.
fn workspace_paths(state: &AppState) -> Vec<String> {
    let db = state.db.lock();
    let Ok(mut stmt) = db.prepare("SELECT path FROM workspaces WHERE kind = 'project'") else {
        return Vec::new();
    };
    stmt.query_map([], |r| r.get::<_, String>(0))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn git_summary(
    _state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<GitSummary, String> {
    blocking(move || Ok(status::summary(&PathBuf::from(cwd)))).await
}

#[tauri::command]
pub async fn git_log(
    _state: tauri::State<'_, AppState>,
    cwd: String,
    limit: u32,
) -> Result<Vec<GitCommit>, String> {
    blocking(move || Ok(history::log(&PathBuf::from(cwd), limit))).await
}

#[tauri::command]
pub async fn git_diff(
    _state: tauri::State<'_, AppState>,
    cwd: String,
    path: Option<String>,
    sha: Option<String>,
) -> Result<String, String> {
    blocking(move || history::diff(&PathBuf::from(cwd), path.as_deref(), sha.as_deref())).await
}

#[tauri::command]
pub async fn git_create_worktree(
    _state: tauri::State<'_, AppState>,
    repo: String,
    name: String,
) -> Result<WorktreeInfo, String> {
    blocking(move || worktree::create(&PathBuf::from(repo), &name)).await
}

#[tauri::command]
pub async fn git_list_worktrees(
    state: tauri::State<'_, AppState>,
    repo: String,
) -> Result<Vec<WorktreeInfo>, String> {
    let sessions = session_cwds(&state).await;
    blocking(move || {
        let root = worktree::repo_info(&PathBuf::from(&repo))
            .map(|i| i.main_root())
            .ok_or("不是 git 仓库")?;
        worktree::list(&root, &sessions)
    })
    .await
}

#[tauri::command]
pub async fn git_remove_worktree(
    _state: tauri::State<'_, AppState>,
    repo: String,
    path: String,
    delete_branch: bool,
    force: bool,
) -> Result<(), String> {
    blocking(move || {
        worktree::remove(
            &PathBuf::from(repo),
            &PathBuf::from(path),
            delete_branch,
            force,
        )
    })
    .await
}

#[tauri::command]
pub async fn git_scan_orphans(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorktreeInfo>, String> {
    let sessions = session_cwds(&state).await;
    // Without session data every worktree would look orphaned; report none.
    if sessions.is_empty() {
        return Ok(Vec::new());
    }
    let paths = workspace_paths(&state);
    blocking(move || Ok(worktree::orphans(&paths, &sessions))).await
}

/// `mode`: "soft" | "hard".
#[tauri::command]
pub async fn git_reset_to(
    _state: tauri::State<'_, AppState>,
    repo: String,
    sha: String,
    mode: String,
) -> Result<(), String> {
    blocking(move || history::reset_to(&PathBuf::from(repo), &sha, &mode)).await
}

#[tauri::command]
pub async fn tm_run(
    state: tauri::State<'_, AppState>,
    repo: String,
    sha: String,
    command: Option<String>,
) -> Result<TmRun, String> {
    let app = state.app.clone();
    let sink: tm::LogSink = Arc::new(move |run_id: &str, line: &str| {
        let _ = app.emit(
            "tm:log",
            serde_json::json!({ "runId": run_id, "line": line }),
        );
    });
    blocking(move || tm::run(&PathBuf::from(repo), &sha, command.as_deref(), sink)).await
}

#[tauri::command]
pub async fn tm_list(_state: tauri::State<'_, AppState>) -> Result<Vec<TmRun>, String> {
    Ok(tm::list())
}

#[tauri::command]
pub async fn tm_stop(
    _state: tauri::State<'_, AppState>,
    run_id: String,
    remove_worktree: bool,
) -> Result<(), String> {
    blocking(move || tm::stop(&run_id, remove_worktree)).await
}

pub fn restore_file(repo: &std::path::Path, path: &str) -> Result<(), String> {
    let status_out = super::cmd::git(repo, &["status", "--porcelain", "--", path])?;
    let text = status_out.text();
    if text.trim_start().starts_with("??") {
        super::cmd::git_ok(repo, &["clean", "-f", "-d", "--", path])?;
    } else {
        let res = super::cmd::git(repo, &["restore", "--staged", "--worktree", "--", path])?;
        if !res.ok() {
            super::cmd::git_ok(repo, &["restore", "--", path])?;
        }
    }
    Ok(())
}

pub fn list_branches(repo: &std::path::Path) -> Result<Vec<String>, String> {
    let out = super::cmd::git_ok(repo, &["branch", "-a", "--format=%(HEAD) %(refname:short)"])?;
    let mut current_branch: Option<String> = None;
    let mut other_branches: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in out.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let is_head = trimmed.starts_with('*');
        let raw_name = trimmed.trim_start_matches('*').trim();
        if raw_name.is_empty() || raw_name.contains("HEAD") {
            continue;
        }
        let clean_name = if let Some(stripped) = raw_name.strip_prefix("origin/") {
            stripped
        } else {
            raw_name
        };
        if clean_name.is_empty() {
            continue;
        }

        if is_head {
            current_branch = Some(clean_name.to_string());
            seen.insert(clean_name.to_string());
        } else if !seen.contains(clean_name) {
            seen.insert(clean_name.to_string());
            other_branches.push(clean_name.to_string());
        }
    }

    let mut result = Vec::new();
    if let Some(curr) = current_branch {
        result.push(curr);
    }
    result.extend(other_branches);
    Ok(result)
}

#[tauri::command]
pub async fn git_restore_file(
    _state: tauri::State<'_, AppState>,
    repo: String,
    path: String,
) -> Result<(), String> {
    blocking(move || restore_file(&PathBuf::from(repo), &path)).await
}

#[tauri::command]
pub async fn git_list_branches(
    _state: tauri::State<'_, AppState>,
    repo: String,
) -> Result<Vec<String>, String> {
    blocking(move || list_branches(&PathBuf::from(repo))).await
}
