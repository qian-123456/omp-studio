//! [C] Tauri commands: git + time machine (docs/ARCHITECTURE.md §7).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

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

#[tauri::command]
pub async fn git_commit_suggest(
    state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<String, String> {
    let dir = PathBuf::from(&cwd);
    let diff_text = blocking(move || {
        // 1. Check staged changes first
        let staged =
            super::cmd::git_ok(&dir, &["diff", "--staged", "--no-color"]).unwrap_or_default();
        if !staged.trim().is_empty() {
            return Ok(staged);
        }
        // 2. Check unstaged working tree diff vs HEAD / diff_base
        let base = super::status::diff_base(&dir);
        let unstaged = super::cmd::git_ok(&dir, &["diff", "--no-color", base]).unwrap_or_default();
        if !unstaged.trim().is_empty() {
            return Ok(unstaged);
        }
        // 3. If both empty, check status entries for untracked / modified files
        let st =
            super::status::status(&dir, true).ok_or_else(|| "无法获取 git 状态".to_string())?;
        if st.entries.is_empty() {
            return Err("没有检测到任何改动（暂存区和工作区均为空）".to_string());
        }
        let file_list: Vec<String> = st
            .entries
            .into_iter()
            .map(|e| format!("{} {}", e.status, e.path))
            .collect();
        Ok(format!("Changed files:\n{}", file_list.join("\n")))
    })
    .await?;

    let trimmed = diff_text.trim();
    if trimmed.is_empty() {
        return Err("没有检测到任何改动".to_string());
    }

    // Cap diff input to ~8000 chars as specified in the prompt
    let capped_diff: String = trimmed.chars().take(8000).collect();

    let prompt = format!(
        "根据以下 Git diff 生成一条规范的 Git Commit Message。\n\
         要求：\n\
         1. 遵循 Conventional Commits 规范（例如 feat: ..., fix: ..., chore: ..., refactor: ...），简短清晰。\n\
         2. 使用中文描述，第一行为主要摘要，若改动较多可在空一行后附带关键要点列表。\n\
         3. 只输出 Commit Message 本身，严禁包含 markdown 代码块反引号（```）、问候语或额外解释说明。\n\n\
         Diff:\n{}",
        capped_diff
    );

    let model = state.settings.read().supervisor_model.clone();
    let model_to_use = if model.trim().is_empty() {
        "smol"
    } else {
        model.trim()
    };
    let suggestion =
        crate::todos::omp::run_print(&state, model_to_use, &prompt, Duration::from_secs(60))
            .await?;
    let clean = suggestion
        .trim()
        .trim_start_matches("```git")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    Ok(clean.to_string())
}

#[tauri::command]
pub async fn git_commit(
    _state: tauri::State<'_, AppState>,
    cwd: String,
    message: String,
    stage_all: Option<bool>,
) -> Result<String, String> {
    blocking(move || {
        let dir = PathBuf::from(&cwd);
        let msg = message.trim();
        if msg.is_empty() {
            return Err("提交信息不能为空".to_string());
        }
        let should_stage = match stage_all {
            Some(true) => true,
            Some(false) => false,
            None => {
                let staged = super::cmd::git_ok(&dir, &["diff", "--staged", "--name-only"])
                    .unwrap_or_default();
                staged.trim().is_empty()
            }
        };

        if should_stage {
            super::cmd::git_ok(&dir, &["add", "-A"]).map_err(|e| format!("git add 失败: {e}"))?;
        }

        let out = super::cmd::git_ok(&dir, &["commit", "-m", msg])
            .map_err(|e| format!("git commit 失败: {e}"))?;
        Ok(out)
    })
    .await
}
