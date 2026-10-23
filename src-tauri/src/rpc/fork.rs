//! Full-session fork: a new ordinary session that starts as a copy of the
//! parent conversation (`omp --fork <cut file>`). Unlike a side chat it has no
//! depth limit, no boundary prompt and all tools. NEVER sends a prompt: the
//! caller sends the user's typed first message through the ordinary path.

use super::forkcut::{self, Cut};
use crate::contracts::{LiveSessionInfo, StartOpts};
use crate::state::AppState;
use crate::{catalog, paths, rpc};

/// `fork_session` command implementation. The copy is computed now: the
/// parent's conversation cut at the last complete turn, or exactly after
/// `entry_id` when the user pinned a specific answer.
pub async fn create(
    state: &AppState,
    parent_session_id: &str,
    entry_id: Option<String>,
    model: Option<String>,
) -> Result<LiveSessionInfo, String> {
    let parent = catalog::get(state, parent_session_id)
        .await
        .ok_or_else(|| format!("找不到要分支的会话 {parent_session_id}"))?;
    if parent.file.is_empty() {
        return Err("该会话还没有会话文件，无法创建分支".into());
    }
    let cwd = Some(parent.cwd.clone())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| paths::global_dir().to_string_lossy().to_string());

    let entry_id = entry_id.filter(|e| !e.trim().is_empty());
    let cut = match entry_id.as_deref() {
        Some(id) => Cut::AfterEntry(id),
        None => Cut::LastCompleteTurn,
    };
    let trimmed = forkcut::truncate(&parent.file, cut, "omp-fork")?;
    let fork_file = trimmed
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| parent.file.clone());

    let started = rpc::start(
        state,
        &StartOpts {
            cwd,
            parent_session_id: Some(parent_session_id.to_string()),
            // Explicit model, else the parent's own (a canonical `provider/id`) so the
            // fork does not silently fall back to the new-session default model.
            model: model
                .filter(|m| !m.trim().is_empty())
                .or_else(|| parent.model.clone().filter(|m| m.contains('/'))),
            fork_file: Some(fork_file),
            // Forks live in the parent's space.
            mode: Some(parent.mode),
            ..Default::default()
        },
    )
    .await;
    if let Some(p) = &trimmed {
        let _ = std::fs::remove_file(p);
    }
    let info = started?;

    // Autotitle skips sessions with a parentSession header, so name it here.
    let base: String = parent.title.trim().chars().take(30).collect();
    let name: Option<String> = if base.is_empty() { None } else { Some(base) };
    {
        let db = state.db.lock();
        let _ = db.execute(
            "INSERT INTO session_meta(session_id, file_path, custom_name, parent_session_id, fork_depth, created_by_app, kind)
             VALUES(?1, ?2, ?3, ?4, 0, 1, 'fork')
             ON CONFLICT(session_id) DO UPDATE SET
               file_path = excluded.file_path,
               custom_name = COALESCE(session_meta.custom_name, excluded.custom_name),
               parent_session_id = excluded.parent_session_id,
               fork_depth = 0,
               created_by_app = 1,
               kind = 'fork'",
            rusqlite::params![info.session_id, info.session_file, name, parent_session_id],
        );
        if let Err(e) = crate::privacy::inherit_session(&db, parent_session_id, &info.session_id) {
            tracing::warn!("privacy inherit_session: {e}");
        }
    }
    catalog::recompute_async(state, Some(vec![info.session_id.clone()])).await;

    Ok(info)
}
