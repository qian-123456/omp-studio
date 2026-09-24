//! App wiring: state, plugins, invoke_handler list, background tasks. [LEAD]
//! Contract: docs/ARCHITECTURE.md — do not change shared contracts silently.

mod backlog;
mod catalog;
mod contracts;
mod db;
mod git;
mod mobile;
mod notify;
mod paths;
mod prompts;
mod rpc;
mod services;
mod settings;
mod state;
mod terminal;
mod todos;

use contracts::{AppPaths, Settings};
use state::AppState;
use tauri::Manager as _;

// ---- LEAD commands (§7) — fully implemented ----

#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.settings.read().clone())
}

#[tauri::command]
async fn save_settings(
    state: tauri::State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    settings::save(&state, settings).await
}

#[tauri::command]
async fn app_paths() -> Result<AppPaths, String> {
    Ok(AppPaths {
        data_dir: paths::data_dir().to_string_lossy().to_string(),
        global_dir: paths::global_dir().to_string_lossy().to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    paths::ensure_dirs().expect("create ~/.omp-workspace dirs");

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let conn = db::open().expect("open app.db");
            db::ensure_global_workspace(&conn).expect("ensure global workspace");
            let settings = db::load_settings(&conn);
            let state = AppState::new(app.handle().clone(), conn, settings);
            app.manage(state.clone());

            // Register event consumers before catalog and process producers start.
            todos::init(state.clone());
            backlog::init(state.clone());
            notify::init(state.clone());
            catalog::init(state.clone());
            rpc::init(state.clone());
            git::init(state.clone());
            services::init(state.clone());
            mobile::init(state.clone());
            terminal::init(state.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // LEAD
            get_settings,
            save_settings,
            app_paths,
            // A — catalog
            catalog::commands::list_sessions,
            catalog::commands::get_transcript,
            catalog::commands::update_session_meta,
            catalog::commands::mark_seen,
            catalog::commands::accept_session,
            catalog::commands::list_workspaces,
            catalog::commands::add_workspace,
            catalog::commands::remove_workspace,
            catalog::commands::reorder_workspaces,
            catalog::commands::session_usage,
            catalog::commands::rescan_sessions,
            // B — rpc
            rpc::commands::rpc_start,
            rpc::commands::rpc_ensure_live,
            rpc::commands::rpc_send,
            rpc::commands::rpc_ui_respond,
            rpc::commands::rpc_pending_ui,
            rpc::commands::rpc_stop,
            rpc::commands::rpc_list_live,
            rpc::commands::takeover_external,
            rpc::commands::create_side_chat,
            // C — git + time machine
            git::commands::git_summary,
            git::commands::git_log,
            git::commands::git_diff,
            git::commands::git_create_worktree,
            git::commands::git_list_worktrees,
            git::commands::git_remove_worktree,
            git::commands::git_scan_orphans,
            git::commands::git_reset_to,
            git::commands::tm_run,
            git::commands::tm_list,
            git::commands::tm_stop,
            // C — services + file IO
            services::commands::services_list,
            services::commands::services_stop,
            services::commands::read_text_file,
            services::commands::write_text_file,
            // D — todos / supervisor / summaries / diagnose
            todos::commands::todos_list,
            todos::commands::todos_act,
            todos::commands::todos_counts,
            todos::commands::supervisor_refresh,
            todos::commands::summary_get,
            todos::commands::diagnose_build_prompt,
            todos::commands::dispatch_prompt,
            // D — backlog
            backlog::commands::backlog_list,
            backlog::commands::backlog_add,
            backlog::commands::backlog_update,
            backlog::commands::backlog_delete,
            backlog::commands::backlog_build_prompt,
            // D — notify
            notify::commands::notify_test,
            // E — mobile + tunnel
            mobile::commands::mobile_start,
            mobile::commands::mobile_stop,
            mobile::commands::mobile_status,
            mobile::commands::mobile_create_pairing,
            mobile::commands::mobile_revoke_all,
            mobile::commands::tunnel_start,
            mobile::commands::tunnel_stop,
            // E — terminal
            terminal::commands::term_open,
            terminal::commands::term_write,
            terminal::commands::term_resize,
            terminal::commands::term_close,
            terminal::commands::term_open_session,
            terminal::commands::install_status_extension_globally,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                terminal::pty::close_all();
                mobile::tunnel::stop();
                // Preserve worktrees and autostart settings; stop only app-owned processes.
                let runs = git::tm::list();
                std::thread::scope(|scope| {
                    for run in runs {
                        scope.spawn(move || {
                            let _ = git::tm::stop(&run.id, false);
                        });
                    }
                });
                tauri::async_runtime::block_on(rpc::shutdown());
            }
        });
}
