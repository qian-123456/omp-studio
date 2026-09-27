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

/// Collect "configured" provider ids: keys under `providers:` in omp's YAML
/// configs plus providers holding credentials in agent.db. Only keys are read,
/// never values — keys are names, values carry secrets. A `provider/model`
/// selector key (config.yml style) contributes its `provider` prefix.
fn configured_providers(home: &std::path::Path) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    for name in ["models.yml", "models-snippet.yml", "config.yml"] {
        let path = home.join(".omp").join("agent").join(name);
        if let Ok(text) = std::fs::read_to_string(&path) {
            collect_provider_keys(&text, &mut set);
        }
    }
    let db = home.join(".omp").join("agent").join("agent.db");
    if let Ok(conn) =
        rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    {
        if let Ok(mut stmt) = conn
            .prepare("SELECT DISTINCT provider FROM auth_credentials WHERE disabled_cause IS NULL")
        {
            if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
                for p in rows.flatten() {
                    set.insert(p);
                }
            }
        }
    }
    set
}

/// Extract provider names: keys at the first child level under a `providers:`
/// mapping. Tolerant line scan — enough for omp's machine-written configs.
/// `provider/model` selector keys contribute their `provider` prefix.
fn collect_provider_keys(text: &str, out: &mut std::collections::HashSet<String>) {
    let mut base: Option<usize> = None;
    let mut child_indent: Option<usize> = None;
    for raw in text.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        match base {
            None => {
                if trimmed == "providers:" {
                    base = Some(indent);
                    child_indent = None;
                }
            }
            Some(b) => {
                if indent <= b {
                    // Left the block; allow a later sibling `providers:` too.
                    base = if trimmed == "providers:" {
                        child_indent = None;
                        Some(indent)
                    } else {
                        None
                    };
                    continue;
                }
                match child_indent {
                    None => child_indent = Some(indent),
                    Some(ci) if indent != ci => continue,
                    _ => {}
                }
                if let Some(key) = line
                    .split_once(':')
                    .map(|(k, _)| k.trim().trim_matches(|c| c == '"' || c == '\''))
                {
                    let provider = key.split('/').next().unwrap_or(key);
                    if !provider.is_empty() {
                        out.insert(provider.to_string());
                    }
                }
            }
        }
    }
}

fn load_fallback_models(seen: &mut std::collections::HashSet<String>, out: &mut Vec<Model>) {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"));
    // model_cache also holds the *entire upstream catalog* for providers the
    // user never configured — restrict to configured ones, matching what
    // `omp models --json` emits.
    let configured = configured_providers(&home);
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
                // Cache keys may carry a catalog suffix: "opencode-zen:models-v3:…"
                let provider_name = provider_id.split(':').next().unwrap_or(&provider_id);
                if !configured.is_empty()
                    && !configured.contains(&provider_id)
                    && !configured.contains(provider_name)
                {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&models_str) {
                    parse_models_value(&parsed, Some(provider_name), seen, out);
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
    if let Some(ext) = crate::providers::try_extension_path() {
        cmd.arg("-e").arg(ext);
    }
    cmd.env("PATH", &path_env);
    cmd.envs(crate::providers::omp_spawn_env());
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
    fn test_collect_provider_keys_models_yml_shape() {
        // models.yml: provider keys at one indent level, secret fields deeper.
        let text = "providers:\n  devin:\n    apiKey: \"sk-xxx\"\n    models:\n      - id: swe-2\n  sub2api-gpt-pro:\n    baseUrl: https://x\n    apiKey: k\nsettings:\n  foo: 1\n";
        let mut set = std::collections::HashSet::new();
        collect_provider_keys(text, &mut set);
        assert!(set.contains("devin"));
        assert!(set.contains("sub2api-gpt-pro"));
        assert_eq!(set.len(), 2, "nested keys must not leak: {set:?}");
    }

    #[test]
    fn test_collect_provider_keys_selector_prefix() {
        // config.yml style: "provider/model" selectors and quoted keys.
        let text = "providers:\n    CTAI-luna+plus/gpt-5.6-luna:\n      model: x\n    \"google-antigravity/*\":\n      model: y\n";
        let mut set = std::collections::HashSet::new();
        collect_provider_keys(text, &mut set);
        assert!(set.contains("CTAI-luna+plus"));
        assert!(set.contains("google-antigravity"));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn test_load_fallback_models() {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        load_fallback_models(&mut seen, &mut out);
        println!("Loaded fallback models count: {}", out.len());
    }
}
