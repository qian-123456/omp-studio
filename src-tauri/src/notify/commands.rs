//! [D] Tauri commands: notifications (docs/ARCHITECTURE.md §7).

use crate::state::AppState;

#[tauri::command]
pub async fn notify_test(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let sound = state.settings.read().notify_sound;
    super::send(&state, "omp-workspace", "测试通知：通知功能正常", sound)
}
