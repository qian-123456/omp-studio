//! [C] Tauri commands: git + time machine (docs/ARCHITECTURE.md §7).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::Emitter;

use super::{badge, checkpoints_ext, history, repo_root, status, tm, turns, worktree};
use crate::contracts::{
    GitBadge, GitHistory, GitSummary, TmRun, TurnCheckpoint, TurnUndoResult, WorktreeInfo,
};
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

/// Sidebar badge for a directory (branch, dirty count, worktree name).
/// Fast: the underlying probe is cached for ~5s.
#[tauri::command]
pub async fn git_badge(
    _state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<Option<GitBadge>, String> {
    blocking(move || Ok(badge(&PathBuf::from(cwd)))).await
}

/// Main repo root for a directory (resolves linked worktrees).
#[tauri::command]
pub async fn git_repo_root(
    _state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<Option<String>, String> {
    blocking(move || Ok(repo_root(&PathBuf::from(cwd)))).await
}

#[tauri::command]
pub async fn git_log(
    _state: tauri::State<'_, AppState>,
    cwd: String,
    limit: u32,
) -> Result<GitHistory, String> {
    blocking(move || Ok(history::history(&PathBuf::from(cwd), limit))).await
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
    branch: Option<String>,
    base: Option<String>,
) -> Result<WorktreeInfo, String> {
    blocking(move || {
        worktree::create(
            &PathBuf::from(repo),
            &name,
            branch.as_deref(),
            base.as_deref(),
        )
    })
    .await
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

/// Everything `git add -A && git commit` would record, as a stat + patch against HEAD
/// (new files included). Works on a throwaway copy of the index, so the real staging
/// area is never touched.
pub fn pending_diff(dir: &std::path::Path) -> Result<String, String> {
    use super::cmd::{git_cmd, git_ok, run, GIT_TIMEOUT};
    let index = git_ok(
        dir,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
    )?;
    let index = PathBuf::from(index.trim());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let tmp = std::env::temp_dir().join(format!("omp-pending-{}-{nanos}.idx", std::process::id()));
    if index.is_file() {
        std::fs::copy(&index, &tmp).map_err(|e| format!("复制暂存区失败: {e}"))?;
    }
    let in_tmp = |args: &[&str]| -> Result<String, String> {
        let mut cmd = git_cmd(dir);
        cmd.env("GIT_INDEX_FILE", &tmp).args(args);
        let out = run(cmd, GIT_TIMEOUT)?;
        if out.ok() {
            Ok(out.text())
        } else {
            Err(out.err_msg())
        }
    };
    let result = in_tmp(&["add", "-A"])
        .and_then(|_| in_tmp(&["diff", "--cached", "--no-color", "--stat", "--patch"]));
    let _ = std::fs::remove_file(&tmp);
    result
}

#[tauri::command]
pub async fn git_commit_suggest(
    state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<String, String> {
    let dir = PathBuf::from(&cwd);
    let (diff, recent) = blocking(move || {
        let diff = pending_diff(&dir)?;
        if diff.trim().is_empty() {
            return Err("没有检测到任何改动".to_string());
        }
        let recent = super::cmd::git_ok(&dir, &["log", "-10", "--no-merges", "--format=%s"])
            .unwrap_or_default();
        Ok((diff, recent))
    })
    .await?;

    // The stat block comes first, so the file list survives truncation.
    let capped_diff: String = diff.chars().take(8000).collect();
    let prompt = format!(
        "Write a git commit message for the changes below.\n\
         Rules:\n\
         1. Conventional Commits: `type(scope): summary`, type is one of feat, fix, refactor, docs, test, chore, perf, style, build, ci, revert.\n\
         2. English, imperative mood, lowercase summary, no trailing period, first line at most 72 characters.\n\
         3. Reuse the scope names of the recent commits below when they fit.\n\
         4. Only for large changes: a blank line, then at most 5 short `- ` bullet points.\n\
         5. Output only the message itself: no code fences, quotes, or commentary.\n\n\
         Recent commits:\n{recent}\n\
         Changes (may be truncated):\n{capped_diff}"
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

/// Save every uncommitted change (new files included) as one commit.
#[tauri::command]
pub async fn git_commit(
    _state: tauri::State<'_, AppState>,
    cwd: String,
    message: String,
) -> Result<String, String> {
    blocking(move || {
        let dir = PathBuf::from(&cwd);
        let msg = message.trim();
        if msg.is_empty() {
            return Err("提交信息不能为空".to_string());
        }
        super::cmd::git_ok(&dir, &["add", "-A"]).map_err(|e| format!("git add 失败: {e}"))?;
        super::cmd::git_ok(&dir, &["commit", "-m", msg])
            .map_err(|e| format!("git commit 失败: {e}"))
    })
    .await
}

/// Turn checkpoints of one session file (oldest first), enriched with
/// `restorable`/`undone` from the repo's `refs/omp/*`.
#[tauri::command]
pub async fn git_session_turns(
    _state: tauri::State<'_, AppState>,
    session_file: String,
) -> Result<Vec<TurnCheckpoint>, String> {
    blocking(move || turns::session_turns(&PathBuf::from(session_file))).await
}

/// Turn checkpoints of every session assigned to the worktree containing
/// `cwd`, oldest first.
#[tauri::command]
pub async fn git_worktree_turns(
    state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<Vec<TurnCheckpoint>, String> {
    let sessions = session_cwds(&state).await;
    blocking(move || turns::worktree_turns(&PathBuf::from(cwd), &sessions)).await
}

/// Undo the newest turn of a session: restore its files, roll back HEAD when
/// the turn's commits are still on top, then mark the turn undone.
#[tauri::command]
pub async fn git_undo_turn(
    _state: tauri::State<'_, AppState>,
    cwd: String,
    session_file: String,
    turn_id: String,
    force: bool,
) -> Result<TurnUndoResult, String> {
    blocking(move || {
        turns::undo_turn(
            &PathBuf::from(cwd),
            &PathBuf::from(session_file),
            &turn_id,
            force,
        )
    })
    .await
}

/// Auto-commit rule text the checkpoints extension injects (consent card).
#[tauri::command]
pub async fn checkpoints_rule() -> Result<String, String> {
    Ok(checkpoints_ext::RULE.to_string())
}
