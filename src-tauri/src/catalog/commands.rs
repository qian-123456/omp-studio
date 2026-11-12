//! [A] Tauri commands (docs/ARCHITECTURE.md §7).

use super::{store, transcript, usage};
use crate::contracts::{
    Model, SessionGroup, SessionMeta, SessionMetaPatch, SessionSnapshot, SessionStatus, SpaceMode,
    TranscriptPage, UsageSummary, Workspace,
};
use crate::state::AppState;
use tauri::Emitter as _;

#[tauri::command]
pub async fn list_sessions(state: tauri::State<'_, AppState>) -> Result<Vec<SessionMeta>, String> {
    Ok(crate::catalog::list(&state).await)
}

#[tauri::command]
pub async fn get_transcript(
    _state: tauri::State<'_, AppState>,
    session_id: String,
    from_offset: Option<u64>,
    tail_id: Option<String>,
) -> Result<TranscriptPage, String> {
    let file = crate::catalog::file_of(&session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;
    // Live sessions flush the transcript on the first message; before that the
    // destined file doesn't exist. Mirror the zero-byte case: empty page.
    if !file.exists() {
        return Ok(TranscriptPage {
            session_id,
            ..Default::default()
        });
    }
    let sid = session_id.clone();
    tokio::task::spawn_blocking(move || {
        transcript::read_page(&file, &sid, from_offset.unwrap_or(0), tail_id.as_deref())
            .map_err(|e| format!("read transcript {sid}: {e}"))
    })
    .await
    .map_err(|e| format!("read transcript {session_id}: {e}"))?
}

#[tauri::command]
pub async fn update_session_meta(
    state: tauri::State<'_, AppState>,
    session_id: String,
    patch: SessionMetaPatch,
) -> Result<SessionMeta, String> {
    {
        let _mutation = crate::catalog::session_mutation_lock().lock().await;
        let db = state.db.lock();
        store::apply_patch(&db, &session_id, &patch)
            .map_err(|e| format!("apply_patch {session_id}: {e}"))?;
    }
    crate::catalog::recompute_async(&state, Some(vec![session_id.clone()])).await;
    crate::catalog::get(&state, &session_id)
        .await
        .ok_or_else(|| format!("session not found after update: {session_id}"))
}

#[tauri::command]
pub async fn mark_seen(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let review_status = crate::catalog::get(&state, &session_id)
        .await
        .is_some_and(|m| m.status == SessionStatus::Review);
    let accepted = {
        let db = state.db.lock();
        store::mark_seen(&db, &session_id, review_status)
            .map_err(|e| format!("mark_seen {session_id}: {e}"))?
    };
    if accepted {
        state.emit(crate::state::AppEvent::SessionAccepted {
            session_id: session_id.clone(),
        });
    }
    crate::catalog::recompute_async(&state, Some(vec![session_id])).await;
    Ok(())
}

/// Arm/disarm the quiet-turn flag: the session's next settle (e.g. a side
/// chat's hand-back summary) must not raise the unread dot or review mark.
#[tauri::command]
pub fn set_quiet_turn(session_id: String, quiet: bool) {
    crate::catalog::set_quiet_turn(&session_id, quiet);
}

/// Workspace file list for the composer's `@` completion. Walks `cwd`
/// recursively, skipping heavy/irrelevant dirs and respecting nothing beyond
/// a fixed skip-list (no .gitignore parsing — dependency-free). Returns
/// relative paths, capped, sorted.
#[tauri::command]
pub async fn list_workspace_files(
    _state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<Vec<String>, String> {
    const MAX_FILES: usize = 4000;
    const MAX_DEPTH: usize = 12;
    const SKIP: &[&str] = &[
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        "out",
        ".next",
        ".cache",
        ".turbo",
        ".vercel",
        ".idea",
        ".vscode",
        "coverage",
        "__pycache__",
        ".venv",
        "venv",
        "vendor",
        "Pods",
        ".derived",
        ".omp-workspace",
        ".superset",
        ".worktrees",
    ];

    let root = std::path::PathBuf::from(&cwd);
    if !root.is_dir() {
        return Err(format!("not a directory: {cwd}"));
    }

    let mut out: Vec<String> = Vec::new();
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(root.clone(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        if out.len() >= MAX_FILES || depth > MAX_DEPTH {
            break;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if out.len() >= MAX_FILES {
                break;
            }
            let name = entry.file_name();
            let name = match name.to_str() {
                Some(n) => n,
                None => continue,
            };
            // Hidden files/dirs at root are skipped below (depth == 0 check);
            // deeper dot-paths like .github/workflows are kept.
            let path = entry.path();
            let is_dir = path.is_dir();
            if is_dir {
                if SKIP.contains(&name) {
                    continue;
                }
                stack.push((path, depth + 1));
            } else {
                if name.starts_with('.') && depth == 0 {
                    continue;
                }
                if let Ok(rel) = path.strip_prefix(&root) {
                    if let Some(rel_str) = rel.to_str() {
                        out.push(rel_str.to_string());
                    }
                }
            }
        }
    }

    out.sort();
    out.truncate(MAX_FILES);
    Ok(out)
}

#[tauri::command]
pub async fn accept_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    archive: bool,
) -> Result<(), String> {
    {
        let db = state.db.lock();
        store::accept(&db, &session_id, archive)
            .map_err(|e| format!("accept_session {session_id}: {e}"))?;
    }
    state.emit(crate::state::AppEvent::SessionAccepted {
        session_id: session_id.clone(),
    });
    crate::catalog::recompute_async(&state, Some(vec![session_id])).await;
    Ok(())
}

#[tauri::command]
pub async fn list_workspaces(state: tauri::State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    let db = state.db.lock();
    store::list_workspaces(&db).map_err(|e| format!("list_workspaces: {e}"))
}

#[tauri::command]
pub async fn remove_workspace(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    {
        let db = state.db.lock();
        store::remove_workspace(&db, &id).map_err(|e| format!("remove_workspace: {e}"))?;
    }
    crate::catalog::recompute_async(&state, None).await;
    Ok(())
}

#[tauri::command]
pub async fn reorder_workspaces(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let db = state.db.lock();
    store::reorder_workspaces(&db, &ids).map_err(|e| format!("reorder_workspaces: {e}"))
}
/// Add `path` as a project workspace of `mode` (default code). The 通用对话
/// (`chat`) space has no project directories.
#[tauri::command]
pub async fn add_workspace(
    state: tauri::State<'_, AppState>,
    path: String,
    mode: Option<SpaceMode>,
) -> Result<Workspace, String> {
    let mode = mode.unwrap_or_default();
    if mode == SpaceMode::Chat {
        return Err("通用对话不能添加项目目录".to_string());
    }
    let ws = {
        let db = state.db.lock();
        store::add_workspace(&db, &path, mode).map_err(|e| format!("add_workspace: {e}"))?
    };
    crate::catalog::recompute_async(&state, None).await;
    Ok(ws)
}

#[tauri::command]
pub async fn list_session_groups(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SessionGroup>, String> {
    let db = state.db.lock();
    store::list_session_groups(&db).map_err(|e| format!("list_session_groups: {e}"))
}

#[tauri::command]
pub async fn create_session_group(
    state: tauri::State<'_, AppState>,
    mode: SpaceMode,
    name: String,
) -> Result<SessionGroup, String> {
    if mode != SpaceMode::Chat {
        return Err("分组只能创建在通用对话中".to_string());
    }
    let group = {
        let db = state.db.lock();
        store::create_session_group(&db, mode, &name)?
    };
    emit_groups_changed(&state);
    Ok(group)
}

#[tauri::command]
pub async fn rename_session_group(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<SessionGroup, String> {
    let group = {
        let db = state.db.lock();
        store::rename_session_group(&db, &id, &name)?
    };
    emit_groups_changed(&state);
    Ok(group)
}

/// Delete a group; its sessions become ungrouped (never deleted).
#[tauri::command]
pub async fn delete_session_group(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    {
        let db = state.db.lock();
        store::delete_session_group(&db, &id)?;
    }
    emit_groups_changed(&state);
    crate::catalog::recompute_async(&state, None).await;
    Ok(())
}

#[tauri::command]
pub async fn reorder_session_groups(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    {
        let db = state.db.lock();
        store::reorder_session_groups(&db, &ids)
            .map_err(|e| format!("reorder_session_groups: {e}"))?;
    }
    emit_groups_changed(&state);
    Ok(())
}

/// File a 无项目 session under a group (`group_id`) or ungroup it (null).
/// Validates: group exists, group.mode == session mode, and the session's
/// resolved workspace is that mode's global workspace.
#[tauri::command]
pub async fn set_session_group(
    state: tauri::State<'_, AppState>,
    session_id: String,
    group_id: Option<String>,
) -> Result<(), String> {
    if let Some(gid) = group_id.as_deref() {
        let group = {
            let db = state.db.lock();
            store::get_session_group(&db, gid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "分组不存在".to_string())?
        };
        // Session mode: stored row wins; for sessions not yet written to disk
        // (e.g. freshly started draft), check the live RPC process cwd or the
        // stored mode. Chat mode sessions always belong to the global workspace.
        let (session_mode, workspace_id) = match crate::catalog::get(&state, &session_id).await {
            Some(m) => (m.mode, m.workspace_id),
            None => {
                let db = state.db.lock();
                let row = store::load_meta_row(&db, &session_id);
                let live_handle = crate::rpc::get_handle(&session_id);
                let live_cwd = live_handle.as_ref().map(|h| h.cwd.clone());
                let cwd = live_cwd.as_deref().or(row.cwd_override.as_deref());
                let global_dir = crate::paths::global_dir().to_string_lossy().to_string();
                let mode = match cwd {
                    Some(c) if super::scan::path_within(c, &global_dir) => SpaceMode::Chat,
                    _ => row.mode,
                };
                let workspace_id = if mode == SpaceMode::Chat {
                    Some(crate::contracts::GLOBAL_WORKSPACE_ID.to_string())
                } else {
                    row.workspace_id
                };
                (mode, workspace_id)
            }
        };
        validate_group_assignment(&group, session_mode, workspace_id.as_deref())?;
    }
    {
        let db = state.db.lock();
        store::set_session_group(&db, &session_id, group_id.as_deref())
            .map_err(|e| format!("set_session_group: {e}"))?;
    }
    emit_groups_changed(&state);
    crate::catalog::recompute_async(&state, Some(vec![session_id])).await;
    Ok(())
}

/// Group-assignment rules (§6): the session must be in the 通用对话 space,
/// the group must belong to it, and the session must be a global-workspace
/// (project-less) session.
fn validate_group_assignment(
    group: &SessionGroup,
    session_mode: SpaceMode,
    resolved_workspace_id: Option<&str>,
) -> Result<(), String> {
    if session_mode != group.mode || group.mode != SpaceMode::Chat {
        return Err("会话与分组不属于同一空间".to_string());
    }
    if resolved_workspace_id != Some(crate::contracts::GLOBAL_WORKSPACE_ID) {
        return Err("仅通用对话会话可以加入分组".to_string());
    }
    Ok(())
}

fn emit_groups_changed(state: &AppState) {
    let _ = state.app.emit("session_groups:changed", ());
}

#[tauri::command]
pub async fn session_usage(
    _state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<UsageSummary, String> {
    let file = crate::catalog::file_of(&session_id);
    Ok(usage::summary(&session_id, file.as_deref()).await)
}

/// Historical request usage, independent of live RPC handles or Token Tracker.
/// Coalesces concurrent IPC calls on an async gate so background refreshes never
/// pile up on Tokio's blocking pool during active streaming.
#[tauri::command]
pub async fn activity_usage() -> Result<crate::contracts::ActivityUsage, String> {
    use std::sync::LazyLock;
    use std::time::{Duration, Instant};

    static GATE: LazyLock<tokio::sync::Mutex<Option<(Instant, crate::contracts::ActivityUsage)>>> =
        LazyLock::new(|| tokio::sync::Mutex::new(None));
    const MIN_RESCAN_INTERVAL: Duration = Duration::from_secs(3);

    let mut guard = GATE.lock().await;
    if let Some((at, cached)) = guard.as_ref() {
        if at.elapsed() < MIN_RESCAN_INTERVAL {
            return Ok(cached.clone());
        }
    }
    let usage = tokio::task::spawn_blocking(super::activity::load)
        .await
        .map_err(|e| format!("activity scan: {e}"))??;
    *guard = Some((Instant::now(), usage.clone()));
    Ok(usage)
}

/// Transcript-derived thinking level / context size for a session with no live
/// process. Missing file (nothing flushed yet) yields an empty snapshot.
#[tauri::command]
pub async fn session_snapshot(
    _state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<SessionSnapshot, String> {
    let Some(file) = crate::catalog::file_of(&session_id).filter(|f| f.exists()) else {
        return Ok(SessionSnapshot::default());
    };
    tokio::task::spawn_blocking(move || transcript::session_snapshot(&file))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("read snapshot {session_id}: {e}"))
}

#[tauri::command]
pub async fn rescan_sessions(state: tauri::State<'_, AppState>) -> Result<(), String> {
    crate::catalog::rebuild(&state).await;
    Ok(())
}

/// Permanently delete a session: transcript files + meta row.
/// Stops a live-but-idle RPC process first; refuses only while the session is
/// mid-turn or has an open dialog.
#[tauri::command]
pub async fn delete_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    crate::catalog::delete(&state, &session_id).await
}

fn parse_models_value(
    val: &serde_json::Value,
    fallback_provider: Option<&str>,
    seen: &mut std::collections::HashSet<String>,
    out: &mut Vec<Model>,
) {
    let list = if let Some(arr) = val.as_array() {
        arr
    } else if let Some(arr) = val.get("models").and_then(|v| v.as_array()) {
        arr
    } else if let Some(arr) = val.get("data").and_then(|v| {
        v.as_array()
            .or_else(|| v.get("models").and_then(|m| m.as_array()))
    }) {
        arr
    } else {
        return;
    };

    for item in list {
        let id = item
            .get("id")
            .or_else(|| item.get("modelId"))
            .or_else(|| item.get("model"))
            .and_then(|v| v.as_str());
        let provider = item
            .get("provider")
            .or_else(|| item.get("providerId"))
            .and_then(|v| v.as_str())
            .or(fallback_provider);
        if let (Some(id), Some(provider)) = (id, provider) {
            let id = id.trim();
            let provider = provider.trim();
            if id.is_empty() || provider.is_empty() {
                continue;
            }
            let key = format!("{provider}/{id}");
            if seen.insert(key.clone()) {
                let name = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&key);
                // `thinking` is a flat array in `omp models --json`, but an object
                // {mode, efforts:[…], defaultLevel, …} in models.db model_cache and
                // get_state snapshots. Accept both.
                let thinking = item
                    .get("thinking")
                    .map(|v| {
                        let arr = v
                            .as_array()
                            .or_else(|| v.get("efforts").and_then(|e| e.as_array()));
                        arr.map(|a| {
                            a.iter()
                                .filter_map(|e| e.as_str().map(|s| s.to_string()))
                                .collect::<Vec<String>>()
                        })
                        .unwrap_or_default()
                    })
                    .unwrap_or_default();
                let context_window = item
                    .get("contextWindow")
                    .and_then(|v| v.as_u64())
                    .filter(|w| *w > 0);
                let reasoning = item.get("reasoning").and_then(|v| v.as_bool());
                out.push(Model {
                    provider: provider.to_string(),
                    id: id.to_string(),
                    name: name.to_string(),
                    thinking,
                    context_window,
                    reasoning,
                });
            }
        }
    }
}

fn decode_model_catalog(stdout: &[u8]) -> Result<crate::contracts::ModelCatalogSnapshot, String> {
    let value: serde_json::Value =
        serde_json::from_slice(stdout).map_err(|_| "MODEL_CATALOG_INVALID_JSON".to_string())?;
    let list = value
        .as_array()
        .or_else(|| value.get("models").and_then(serde_json::Value::as_array))
        .or_else(|| {
            value.get("data").and_then(|v| {
                v.as_array()
                    .or_else(|| v.get("models").and_then(serde_json::Value::as_array))
            })
        })
        .ok_or_else(|| "MODEL_CATALOG_INVALID_SHAPE".to_string())?;
    // Malformed rows must not silently produce a successful subset.
    for item in list {
        let id = item
            .get("id")
            .or_else(|| item.get("modelId"))
            .or_else(|| item.get("model"));
        let provider = item.get("provider").or_else(|| item.get("providerId"));
        if !id
            .and_then(serde_json::Value::as_str)
            .is_some_and(|s| !s.trim().is_empty())
            || !provider
                .and_then(serde_json::Value::as_str)
                .is_some_and(|s| !s.trim().is_empty())
        {
            return Err("MODEL_CATALOG_INVALID_ROW".to_string());
        }
    }
    let mut models = Vec::new();
    parse_models_value(
        &value,
        None,
        &mut std::collections::HashSet::new(),
        &mut models,
    );
    Ok(crate::contracts::ModelCatalogSnapshot {
        models,
        source: "cli",
        completeness: "unverified",
    })
}

async fn read_model_catalog(
    exe: &std::path::Path,
    path_env: &str,
) -> Result<crate::contracts::ModelCatalogSnapshot, String> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(["models", "--json"]);
    cmd.env("PATH", path_env);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    cmd.kill_on_drop(true);
    let child = cmd
        .spawn()
        .map_err(|_| "MODEL_CATALOG_SPAWN_FAILED".to_string())?;
    let output = tokio::time::timeout(std::time::Duration::from_secs(8), child.wait_with_output())
        .await
        .map_err(|_| "MODEL_CATALOG_TIMEOUT".to_string())?
        .map_err(|_| "MODEL_CATALOG_READ_FAILED".to_string())?;
    if !output.status.success() {
        return Err("MODEL_CATALOG_EXIT_FAILED".to_string());
    }
    decode_model_catalog(&output.stdout)
}

#[tauri::command]
pub async fn list_models(
    state: tauri::State<'_, AppState>,
) -> Result<crate::contracts::ModelCatalogSnapshot, String> {
    let bin = state.settings.read().omp_binary.clone();
    let path_env = crate::todos::omp::augmented_path();
    let exe = crate::todos::omp::resolve_binary(&bin, &path_env);
    // models.db omits static/keyless providers and cannot substitute for this read.
    read_model_catalog(std::path::Path::new(&exe), &path_env).await
}

fn parse_export_output(stdout: &str, working_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(stripped) = line.strip_prefix("Exported to:") {
            let target = std::path::Path::new(stripped.trim());
            return Some(if target.is_absolute() {
                target.to_path_buf()
            } else {
                working_dir.join(target)
            });
        }
    }
    None
}

/// Runs `omp <args…> <session file>` for a saved session and returns
/// (stdout, working dir). `action` labels error messages (e.g. "导出").
async fn run_omp_on_session(
    state: &AppState,
    session_id: &str,
    args: &[&str],
    timeout_secs: u64,
    action: &str,
) -> Result<(String, std::path::PathBuf), String> {
    let (file, cwd) = crate::rpc::find_session_file(state, session_id)
        .await
        .ok_or_else(|| format!("找不到会话文件: {session_id}"))?;

    if !std::path::Path::new(&file).exists() {
        return Err(format!("会话文件不存在: {file}"));
    }

    crate::todos::omp::init_login_path().await;
    let bin = state.settings.read().omp_binary.clone();
    let path_env = crate::todos::omp::augmented_path();
    let exe = crate::todos::omp::resolve_binary(&bin, &path_env);

    let working_dir = if std::path::Path::new(&cwd).is_dir() {
        std::path::PathBuf::from(&cwd)
    } else if let Some(parent) = std::path::Path::new(&file).parent() {
        parent.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    };

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(args)
        .arg(&file)
        .current_dir(&working_dir)
        .env("PATH", &path_env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| format!("执行 omp 失败 ({}): {e}", exe.display()))?;

    let out = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| format!("omp {action}超时 ({timeout_secs}s)"))?
    .map_err(|e| format!("omp 执行错误: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: String = stderr
            .chars()
            .rev()
            .take(400)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return Err(format!("{action}失败 ({}): {}", out.status, tail.trim()));
    }
    Ok((stdout, working_dir))
}

#[tauri::command]
pub async fn session_export_html(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let (stdout, working_dir) =
        run_omp_on_session(&state, &session_id, &["--export"], 60, "导出").await?;

    if let Some(path) = parse_export_output(&stdout, &working_dir) {
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    if stdout.is_empty() {
        Ok(working_dir.to_string_lossy().to_string())
    } else {
        Ok(stdout)
    }
}

/// First http(s) URL in `omp share` output (the link carries its key in `#…`).
fn parse_share_url(stdout: &str) -> Option<String> {
    stdout
        .split_whitespace()
        .find(|w| w.starts_with("https://") || w.starts_with("http://"))
        .map(|w| w.trim_end_matches(['.', ',', ')', '"', '\'']).to_string())
}

/// Runs `omp share <file>` (same as the `/share` slash command): uploads an
/// end-to-end encrypted snapshot and returns the share link.
#[tauri::command]
pub async fn session_share(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let (stdout, _) = run_omp_on_session(&state, &session_id, &["share"], 120, "分享").await?;
    parse_share_url(&stdout).ok_or_else(|| format!("未能从 omp 输出中解析分享链接: {stdout}"))
}

/// AI doctor diagnosis for the heatmap panel. `prompt` is built from the
/// distilled session skeleton (never raw transcripts). Model: explicit `model`,
/// else `doctor_model`, else "smol".
#[tauri::command]
pub async fn heatmap_diagnose(
    state: tauri::State<'_, AppState>,
    prompt: String,
    model: Option<String>,
) -> Result<String, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("诊断内容不能为空".to_string());
    }
    let model = {
        let s = state.settings.read();
        let picked = [model.as_deref().unwrap_or(""), s.doctor_model.as_str()]
            .into_iter()
            .map(str::trim)
            .find(|m| !m.is_empty())
            .unwrap_or("smol")
            .to_string();
        picked
    };
    crate::todos::omp::run_print(&state, &model, prompt, std::time::Duration::from_secs(120)).await
}
#[cfg(test)]
mod tests {
    use super::*;

    /// Group-assignment validation: chat space + global-workspace sessions only.
    #[test]
    fn group_assignment_rejects_mode_mismatch_and_non_global() {
        let group = SessionGroup {
            id: "g1".into(),
            mode: SpaceMode::Chat,
            name: "清理".into(),
            sort: 1,
        };
        validate_group_assignment(&group, SpaceMode::Chat, Some("global")).unwrap();
        // Session from another space is rejected.
        assert_eq!(
            validate_group_assignment(&group, SpaceMode::Code, Some("global")).unwrap_err(),
            "会话与分组不属于同一空间"
        );
        // A project session (or 未归档) is rejected.
        for ws in [Some("repo-w"), None] {
            assert_eq!(
                validate_group_assignment(&group, SpaceMode::Chat, ws).unwrap_err(),
                "仅通用对话会话可以加入分组"
            );
        }
        // Legacy groups that still carry a project mode are never assignable.
        let legacy = SessionGroup {
            mode: SpaceMode::Work,
            ..group.clone()
        };
        assert_eq!(
            validate_group_assignment(&legacy, SpaceMode::Work, Some("global")).unwrap_err(),
            "会话与分组不属于同一空间"
        );
    }

    #[test]
    fn parse_share_url_keeps_key_fragment_and_skips_prose() {
        let out = "Uploading snapshot…\nShare link: https://my.omp.sh/s/abc123#k3y-_Z.\n";
        assert_eq!(
            parse_share_url(out).as_deref(),
            Some("https://my.omp.sh/s/abc123#k3y-_Z")
        );
        assert_eq!(parse_share_url("no link here"), None);
    }

    #[test]
    fn test_parse_models_value_models_key() {
        let val = serde_json::json!({
            "models": [
                { "provider": "anthropic", "id": "claude-3-7-sonnet", "name": "Claude 3.7 Sonnet" },
                { "provider": "openai", "id": "gpt-4o" }
            ]
        });
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        parse_models_value(&val, None, &mut seen, &mut out);

        assert_eq!(out.len(), 2);
        assert_eq!(out[0].provider, "anthropic");
        assert_eq!(out[0].id, "claude-3-7-sonnet");
        assert_eq!(out[0].name, "Claude 3.7 Sonnet");
        assert_eq!(out[1].provider, "openai");
        assert_eq!(out[1].id, "gpt-4o");
        assert_eq!(out[1].name, "openai/gpt-4o");
    }

    #[test]
    fn test_parse_models_value_array_and_dedup() {
        let val = serde_json::json!([
            { "provider": "anthropic", "id": "claude-3-7-sonnet", "name": "Claude 3.7 Sonnet" },
            { "provider": "anthropic", "id": "claude-3-7-sonnet", "name": "Duplicate" }
        ]);
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        parse_models_value(&val, None, &mut seen, &mut out);

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "Claude 3.7 Sonnet");
    }

    #[test]
    fn test_parse_models_value_thinking_object_shape() {
        // models.db model_cache stores thinking as {mode, efforts, …}, not an array.
        let val = serde_json::json!([
            {
                "provider": "devin",
                "id": "swe-2",
                "thinking": {
                    "mode": "effort",
                    "efforts": ["medium", "high", "max"],
                    "defaultLevel": "high"
                }
            },
            { "provider": "anthropic", "id": "claude", "thinking": ["low", "high"] },
            { "provider": "x", "id": "no-thinking" }
        ]);
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        parse_models_value(&val, None, &mut seen, &mut out);

        assert_eq!(out[0].thinking, vec!["medium", "high", "max"]);
        assert_eq!(out[1].thinking, vec!["low", "high"]);
        assert!(out[2].thinking.is_empty());
    }

    #[test]
    fn model_catalog_requires_valid_shape_and_every_row() {
        for invalid in [
            b"oops".as_slice(),
            b"{}".as_slice(),
            br#"[{"provider":"p","id":"ok"},{"id":"bad"}]"#.as_slice(),
        ] {
            assert!(decode_model_catalog(invalid).is_err());
        }
        let empty = decode_model_catalog(b"[]").unwrap();
        assert!(empty.models.is_empty());
        assert_eq!(empty.completeness, "unverified");
        let partial = decode_model_catalog(br#"[{"provider":"only-one","id":"m"}]"#).unwrap();
        assert_eq!(partial.models.len(), 1);
        assert_eq!(partial.completeness, "unverified");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn model_catalog_process_failures_are_errors_not_database_fallbacks() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("ompws-catalog-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("fixture");
        for (body, expected) in [
            ("exit 1", "MODEL_CATALOG_EXIT_FAILED"),
            ("printf 'not-json'", "MODEL_CATALOG_INVALID_JSON"),
            ("exec /bin/sleep 20", "MODEL_CATALOG_TIMEOUT"),
            ("printf '{}'", "MODEL_CATALOG_INVALID_SHAPE"),
        ] {
            std::fs::write(&exe, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o700)).unwrap();
            assert_eq!(read_model_catalog(&exe, "").await.unwrap_err(), expected);
        }
        assert_eq!(
            read_model_catalog(&dir.join("missing"), "")
                .await
                .unwrap_err(),
            "MODEL_CATALOG_SPAWN_FAILED"
        );
        std::fs::write(&exe, "#!/bin/sh\nprintf '[]'\n").unwrap();
        assert!(read_model_catalog(&exe, "")
            .await
            .unwrap()
            .models
            .is_empty());
        std::fs::remove_file(&exe).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn test_parse_export_output() {
        let working = std::path::Path::new("/tmp/test_dir");
        let out1 = "Exported to: omp-session-abc.html";
        assert_eq!(
            parse_export_output(out1, working),
            Some(working.join("omp-session-abc.html"))
        );

        let out2 = "Exporting...\nExported to: /absolute/path/omp-session-abc.html\nDone.";
        assert_eq!(
            parse_export_output(out2, working),
            Some(std::path::PathBuf::from(
                "/absolute/path/omp-session-abc.html"
            ))
        );

        let out3 = "No export line here";
        assert_eq!(parse_export_output(out3, working), None);
    }
}
