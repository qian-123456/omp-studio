//! [D] Tauri commands: backlog (docs/ARCHITECTURE.md §7).

use super::{notify_changed, store};
use crate::contracts::{BacklogItem, BacklogKind, BacklogPatch, BacklogRef};
use crate::state::AppState;

#[tauri::command]
pub async fn backlog_list(state: tauri::State<'_, AppState>) -> Result<Vec<BacklogItem>, String> {
    store::list(&state.db.lock()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backlog_add(
    state: tauri::State<'_, AppState>,
    text: String,
    kind: BacklogKind,
    refs: Vec<BacklogRef>,
    project_dir: Option<String>,
) -> Result<BacklogItem, String> {
    let item = store::add(&state.db.lock(), &text, kind, &refs, project_dir.as_deref())?;
    notify_changed(&state);
    Ok(item)
}

#[tauri::command]
pub async fn backlog_update(
    state: tauri::State<'_, AppState>,
    id: String,
    patch: BacklogPatch,
) -> Result<BacklogItem, String> {
    let item = store::update(&state.db.lock(), &id, &patch)?;
    notify_changed(&state);
    Ok(item)
}

#[tauri::command]
pub async fn backlog_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    store::delete(&state.db.lock(), &id)?;
    notify_changed(&state);
    Ok(())
}

#[tauri::command]
pub async fn backlog_build_prompt(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
) -> Result<String, String> {
    let mut items = Vec::with_capacity(ids.len());
    for id in &ids {
        let item = store::get(&state.db.lock(), id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "条目不存在".to_string())?;
        items.push(item);
    }
    if items.is_empty() {
        return Err("请选择要派发的条目".to_string());
    }
    Ok(super::prompt::build_batch(&state, &items).await)
}
