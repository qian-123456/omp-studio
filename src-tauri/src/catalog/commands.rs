//! [A] Tauri commands (docs/ARCHITECTURE.md §7).

use super::{store, transcript, usage};
use crate::contracts::{SessionMeta, SessionMetaPatch, TranscriptPage, UsageSummary, Workspace};
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
