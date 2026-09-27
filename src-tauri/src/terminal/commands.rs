//! [E] Tauri commands: terminal + status extension (docs/ARCHITECTURE.md §7).

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine as _;
use serde_json::json;
use tauri::Emitter as _;

use super::extension;
use super::pty::{self, Sink, TermEvent};
use crate::state::AppState;

/// session_id → termId for terminals opened via `term_open_session`.
fn session_terms() -> &'static parking_lot::Mutex<HashMap<String, String>> {
    static MAP: std::sync::OnceLock<parking_lot::Mutex<HashMap<String, String>>> =
        std::sync::OnceLock::new();
    MAP.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}

fn forget_term(term_id: &str) {
    session_terms().lock().retain(|_, t| t != term_id);
}

/// Sink that forwards PTY output as `terminal:data` / `terminal:exit` events.
fn app_sink(state: &AppState) -> Sink {
    let app = state.app.clone();
    Arc::new(move |term_id: &str, ev: TermEvent| {
        let _ = match ev {
            TermEvent::Data(bytes) => app.emit(
                "terminal:data",
                json!({
                    "termId": term_id,
                    "data": base64::engine::general_purpose::STANDARD.encode(bytes),
                }),
            ),
            TermEvent::Exit(code) => {
                forget_term(term_id);
                app.emit("terminal:exit", json!({ "termId": term_id, "code": code }))
            }
        };
    })
}

/// Returns the new termId.
#[tauri::command]
pub async fn term_open(
    state: tauri::State<'_, AppState>,
    cwd: String,
    command: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    pty::open(&cwd, &command, cols, rows, app_sink(&state))
}

/// `data`: utf8 text.
#[tauri::command]
pub async fn term_write(term_id: String, data: String) -> Result<(), String> {
    pty::write(&term_id, data.as_bytes())
}

#[tauri::command]
pub async fn term_resize(term_id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty::resize(&term_id, cols, rows)
}

#[tauri::command]
pub async fn term_close(term_id: String) -> Result<(), String> {
    pty::close(&term_id);
    forget_term(&term_id);
    Ok(())
}

/// Stops the RPC process for the session if live, then runs
/// `omp --resume <file> -e <extension_path>` in a PTY. Returns termId.
#[tauri::command]
pub async fn term_open_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let meta = crate::catalog::get(&state, &session_id)
        .await
        .ok_or_else(|| format!("找不到会话 {session_id}"))?;
    if crate::rpc::is_live(&session_id) {
        crate::rpc::stop(&state, &session_id)
            .await
            .map_err(|e| format!("停止结构化通道失败: {e}"))?;
    }
    // Re-opening a session terminal replaces the previous one.
    let old = session_terms().lock().get(&session_id).cloned();
    if let Some(old) = old {
        pty::close(&old);
        forget_term(&old);
    }
    let ext = crate::paths::extension_path();
    let _ = extension::install_to(&ext);
    let binary = state.settings.read().omp_binary.clone();
    let argv = vec![
        binary,
        "--resume".to_string(),
        meta.file.clone(),
        "-e".to_string(),
        ext.to_string_lossy().to_string(),
        "-e".to_string(),
        crate::providers::extension_path()?
            .to_string_lossy()
            .to_string(),
    ];
    let cwd = if std::path::Path::new(&meta.cwd).is_dir() {
        meta.cwd.clone()
    } else {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string())
    };
    let term_id = pty::open(&cwd, &argv, cols, rows, app_sink(&state))?;
    session_terms().lock().insert(session_id, term_id.clone());
    Ok(term_id)
}

/// Copies the status extension into `~/.omp/agent/extensions/` (opt-in button).
/// Returns the installed path.
#[tauri::command]
pub async fn install_status_extension_globally() -> Result<String, String> {
    let path = extension::global_path();
    extension::install_to(&path).map_err(|e| format!("安装失败: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}
