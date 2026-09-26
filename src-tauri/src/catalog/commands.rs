//! [A] Tauri commands (docs/ARCHITECTURE.md §7).

use super::{store, transcript, usage};
use crate::contracts::{
    Model, SessionMeta, SessionMetaPatch, TranscriptPage, UsageSummary, Workspace,
};
use crate::state::AppState;

#[tauri::command]
pub async fn list_sessions(state: tauri::State<'_, AppState>) -> Result<Vec<SessionMeta>, String> {
    Ok(crate::catalog::list(&state).await)
}

#[tauri::command]
pub async fn get_transcript(
    _state: tauri::State<'_, AppState>,
    session_id: String,
    from_offset: Option<u64>,
) -> Result<TranscriptPage, String> {
    let file = crate::catalog::file_of(&session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;
    transcript::read_page(&file, &session_id, from_offset.unwrap_or(0))
        .map_err(|e| format!("read transcript {session_id}: {e}"))
}

#[tauri::command]
pub async fn update_session_meta(
    state: tauri::State<'_, AppState>,
    session_id: String,
    patch: SessionMetaPatch,
) -> Result<SessionMeta, String> {
    {
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
    {
        let db = state.db.lock();
        store::set_unread(&db, &session_id, false)
            .map_err(|e| format!("mark_seen {session_id}: {e}"))?;
    }
    crate::catalog::recompute_async(&state, Some(vec![session_id])).await;
    Ok(())
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
pub async fn add_workspace(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Workspace, String> {
    let ws = {
        let db = state.db.lock();
        store::add_workspace(&db, &path).map_err(|e| format!("add_workspace: {e}"))?
    };
    crate::catalog::recompute_async(&state, None).await;
    Ok(ws)
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

#[tauri::command]
pub async fn session_usage(
    _state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<UsageSummary, String> {
    let file = crate::catalog::file_of(&session_id);
    Ok(usage::summary(&session_id, file.as_deref()).await)
}

#[tauri::command]
pub async fn rescan_sessions(state: tauri::State<'_, AppState>) -> Result<(), String> {
    crate::catalog::rebuild(&state).await;
    Ok(())
}

/// Permanently delete a session: transcript files + meta row.
/// Refuses while the session is still managed by a live RPC process.
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
                let thinking = item
                    .get("thinking")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                out.push(Model {
                    provider: provider.to_string(),
                    id: id.to_string(),
                    name: name.to_string(),
                    thinking,
                });
            }
        }
    }
}

fn load_fallback_models(seen: &mut std::collections::HashSet<String>, out: &mut Vec<Model>) {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"));
    let candidates = [
        home.join(".omp").join("agent").join("models.db"),
        home.join(".omp").join("models.db"),
    ];

    for db_path in candidates {
        if !db_path.is_file() {
            continue;
        }
        let conn = match rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut stmt = match conn.prepare("SELECT provider_id, models FROM model_cache") {
            Ok(s) => s,
            Err(_) => continue,
        };

        let rows = stmt.query_map([], |row| {
            let provider_id: String = row.get(0)?;
            let models_str: String = row.get(1)?;
            Ok((provider_id, models_str))
        });

        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (provider_id, models_str) = row;
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&models_str) {
                    parse_models_value(&parsed, Some(&provider_id), seen, out);
                }
            }
        }

        if !out.is_empty() {
            break;
        }
    }
}

#[tauri::command]
pub async fn list_models(state: tauri::State<'_, AppState>) -> Result<Vec<Model>, String> {
    let bin = state.settings.read().omp_binary.clone();
    let path_env = crate::todos::omp::augmented_path();
    let exe = crate::todos::omp::resolve_binary(&bin, &path_env);

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(["models", "--json"]);
    cmd.env("PATH", &path_env);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    if let Ok(child) = cmd.spawn() {
        if let Ok(Ok(output)) =
            tokio::time::timeout(std::time::Duration::from_secs(8), child.wait_with_output()).await
        {
            if output.status.success() {
                if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                    parse_models_value(&parsed, None, &mut seen, &mut out);
                }
            }
        }
    }

    if !out.is_empty() {
        return Ok(out);
    }

    load_fallback_models(&mut seen, &mut out);

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_load_fallback_models() {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        load_fallback_models(&mut seen, &mut out);
        println!("Loaded fallback models count: {}", out.len());
    }
}
