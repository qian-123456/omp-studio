//! App wiring: state, plugins, invoke_handler list, background tasks. [LEAD]
//! Contract: docs/ARCHITECTURE.md — do not change shared contracts silently.

mod backlog;
mod catalog;
mod contracts;
mod db;
mod git;
mod mobile;
mod model_replace;
mod notify;
mod paths;
mod privacy;
mod prompt_composition;
mod prompts;
mod providers;
mod rpc;
mod schedules;
mod services;
mod settings;
mod settings_mcp;
mod settings_model_roles;
mod settings_plugins;
mod skills;
mod state;
mod terminal;
mod todos;
mod visualize;

use contracts::{AppPaths, Settings};
use state::AppState;
use tauri::{Emitter as _, Manager as _};

/// Menu id of the custom Cmd+W item; the webview decides what it closes (src/lib/nativeShortcuts.ts).
const CLOSE_TAB_MENU_ID: &str = "close-tab";

/// Default app menu with every native "Close Window" item (Cmd+W → `performClose:`,
/// which closes the only window and quits the app) swapped for a custom item that
/// just notifies the webview. The Window submenu copy is dropped to avoid a duplicate accelerator.
fn build_app_menu(handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuItem, MenuItemKind};
    let menu = tauri::menu::Menu::default(handle)?;
    let mut replaced = false;
    for top in menu.items()? {
        let MenuItemKind::Submenu(sub) = top else {
            continue;
        };
        for (pos, item) in sub.items()?.into_iter().enumerate() {
            let MenuItemKind::Predefined(p) = &item else {
                continue;
            };
            if p.text()? != "Close Window" && p.text()? != "Close" {
                continue;
            }
            sub.remove(&item)?;
            if !replaced {
                let close = MenuItem::with_id(
                    handle,
                    CLOSE_TAB_MENU_ID,
                    "关闭标签页",
                    true,
                    Some("CmdOrCtrl+W"),
                )?;
                sub.insert(&close, pos)?;
                replaced = true;
            }
        }
    }
    Ok(menu)
}

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
    let saved = settings::save(&state, settings).await?;
    notify::refresh_badge(&state).await;
    settings::apply_window_title(&state);
    Ok(saved)
}

#[tauri::command]
async fn app_paths() -> Result<AppPaths, String> {
    Ok(AppPaths {
        data_dir: paths::data_dir().to_string_lossy().to_string(),
        global_dir: paths::global_dir().to_string_lossy().to_string(),
    })
}

pub fn parse_allowed_tools_from_text(content: &str) -> Option<Vec<String>> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("allowed_tools") || trimmed.starts_with("allowed-tools") {
            let sep = if trimmed.contains('=') { '=' } else { ':' };
            if let Some((_, val)) = trimmed.split_once(sep) {
                let val = val.trim();
                if val.starts_with('[') && val.ends_with(']') {
                    let inner = &val[1..val.len() - 1];
                    let tools: Vec<String> = inner
                        .split(',')
                        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    return Some(tools);
                }
            }
        }
    }
    None
}

#[tauri::command]
async fn allowed_tools_list() -> Result<Vec<String>, String> {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"));
    let candidates = [
        home.join(".omp").join("settings.toml"),
        home.join(".omp").join("agent").join("settings.toml"),
        home.join(".config").join("omp").join("settings.toml"),
        home.join(".omp").join("agent").join("config.yml"),
    ];

    for path in candidates {
        if path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Some(tools) = parse_allowed_tools_from_text(&content) {
                    return Ok(tools);
                }
            }
        }
    }

    Ok(Vec::new())
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
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == CLOSE_TAB_MENU_ID {
                let _ = app.emit("native:close-tab", ());
            }
        })
        .setup(|app| {
            let conn = db::open().expect("open app.db");
            db::ensure_global_workspace(&conn).expect("ensure global workspace");
            let settings = db::load_settings(&conn);
            let state = AppState::new(app.handle().clone(), conn, settings);
            app.manage(state.clone());
            // Rewrite privacy files from the DB before any OMP process spawns.
            privacy::init(&state);

            // Register event consumers before catalog and process producers start.
            providers::init();
            todos::init(state.clone());
            backlog::init(state.clone());
            notify::init(state.clone());
            catalog::init(state.clone());
            rpc::init(state.clone());
            git::init(state.clone());
            services::init(state.clone());
            settings::apply_window_title(&state);
            mobile::init(state.clone());
            terminal::init(state.clone());
            schedules::init(state.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // LEAD
            get_settings,
            save_settings,
            app_paths,
            allowed_tools_list,
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
            catalog::commands::list_session_groups,
            catalog::commands::create_session_group,
            catalog::commands::rename_session_group,
            catalog::commands::delete_session_group,
            catalog::commands::reorder_session_groups,
            catalog::commands::set_session_group,
            catalog::commands::session_usage,
            catalog::commands::session_snapshot,
            catalog::commands::rescan_sessions,
            catalog::commands::delete_session,
            catalog::commands::list_models,
            catalog::commands::list_workspace_files,
            catalog::commands::session_export_html,
            catalog::commands::session_share,
            catalog::commands::heatmap_diagnose,
            // B — rpc
            rpc::commands::rpc_start,
            rpc::commands::rpc_ensure_live,
            rpc::commands::rpc_send,
            rpc::commands::rpc_ui_respond,
            rpc::commands::rpc_pending_ui,
            rpc::commands::rpc_stop,
            rpc::commands::rpc_restart,
            rpc::commands::rpc_list_live,
            rpc::commands::rpc_omp_staleness,
            rpc::commands::takeover_external,
            rpc::commands::create_side_chat,
            rpc::commands::side_chat_ask,
            rpc::commands::fork_session,
            rpc::commands::subagent_list,
            rpc::commands::subagent_transcript,
            // C — git + time machine
            git::commands::git_summary,
            git::commands::git_badge,
            git::commands::git_repo_root,
            git::commands::git_log,
            git::commands::git_diff,
            git::commands::git_create_worktree,
            git::commands::git_list_worktrees,
            git::commands::git_remove_worktree,
            git::commands::git_scan_orphans,
            git::commands::git_reset_to,
            git::commands::git_restore_file,
            git::commands::git_list_branches,
            git::commands::git_list_branches_detailed,
            git::commands::git_delete_branch,
            git::commands::git_sync_branch,
            git::commands::git_merge_preview,
            git::commands::git_merge_branch,
            git::commands::git_diff_base,
            git::commands::git_rebase_onto_base,
            git::commands::git_discard_all,
            git::commands::git_sync_with_base,
            git::commands::git_get_pr_url,
            git::commands::git_commit_suggest,
            git::commands::git_commit,
            git::commands::git_session_turns,
            git::commands::git_worktree_turns,
            git::commands::git_undo_turn,
            git::commands::checkpoints_rule,
            git::commands::tm_run,
            git::commands::tm_list,
            git::commands::tm_stop,
            // C — services + file IO
            services::commands::services_list,
            services::commands::services_stop,
            services::commands::read_text_file,
            services::commands::write_text_file,
            services::commands::fs_read_dir,
            services::commands::validate_path,
            services::commands::save_clipboard_image,
            services::clipboard::clipboard_file_paths,
            services::clipboard::save_clipboard_file,
            services::commands::save_share_image,
            services::commands::app_memory_usage,
            services::commands::perf_breakdown,
            // D — todos / summaries / diagnose
            todos::commands::todos_list,
            todos::commands::todos_act,
            todos::commands::todos_counts,
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
            // D — settings (OMP config bridge)
            settings::omp_config_list,
            settings::omp_config_set,
            settings::omp_config_reset,
            settings::omp_project_config_read,
            settings_model_roles::omp_model_roles_read,
            settings_model_roles::omp_model_roles_set,
            // D — bulk model replace (全局批量替换模型)
            model_replace::model_usage_scan,
            model_replace::model_replace_apply,
            model_replace::model_replace_history,
            model_replace::model_replace_undo,
            model_replace::model_probe,
            model_replace::model_kind_catalog,
            prompt_composition::prompt_composition_probe,
            settings::omp_info,
            settings::omp_update_check,
            settings::omp_update_run,
            // providers (API provider manager + encrypted vault)
            providers::commands::provider_list,
            providers::commands::provider_save,
            providers::commands::provider_delete,
            providers::commands::provider_set_enabled,
            providers::commands::provider_reorder,
            providers::commands::provider_test,
            providers::commands::provider_test_model,
            providers::commands::provider_fetch_models,
            providers::commands::provider_export_env_text,
            providers::commands::omp_providers_list,
            providers::commands::provider_import_omp,
            providers::models_yml_write::omp_models_set_context_windows,
            providers::models_yml_write::omp_models_context_window_overrides,
            providers::commands::oauth_login_providers,
            providers::commands::oauth_login_start,
            providers::commands::oauth_login_respond,
            providers::commands::oauth_login_cancel,
            providers::commands::oauth_login_open_url,
            providers::commands::oauth_login_status,
            providers::commands::omp_usage_report,
            // E — mobile + tunnel
            mobile::commands::mobile_start,
            mobile::commands::mobile_stop,
            mobile::commands::mobile_status,
            mobile::commands::mobile_create_pairing,
            mobile::commands::mobile_revoke_all,
            mobile::commands::mobile_ipv6_start,
            mobile::commands::mobile_ipv6_stop,
            mobile::commands::tunnel_start,
            mobile::commands::tunnel_stop,
            // E — mobile DDNS
            mobile::ddns::mobile_ddns_set_token,
            mobile::ddns::mobile_ddns_clear_token,
            mobile::ddns::mobile_ddns_sync,
            // E — terminal
            terminal::commands::term_open,
            terminal::commands::term_write,
            terminal::commands::term_resize,
            terminal::commands::term_close,
            terminal::commands::term_open_session,
            terminal::commands::terminal_set_current_session,
            terminal::commands::install_status_extension_globally,
            // E — schedules (定时任务)
            schedules::commands::schedules_list,
            schedules::commands::schedules_save,
            schedules::commands::schedules_delete,
            schedules::commands::schedules_set_enabled,
            schedules::commands::schedules_run_now,
            schedules::commands::schedule_runs,
            // F — skills & extensions (技能与扩展)
            skills::commands::skills_list,
            skills::commands::skills_read,
            skills::usage::skills_usage,
            skills::commands::skills_trash,
            // D — MCP servers + plugin enablement (OMP-managed config files)
            settings_mcp::mcp_config_list,
            settings_mcp::mcp_server_upsert,
            settings_mcp::mcp_server_remove,
            settings_mcp::mcp_server_set_enabled,
            settings_mcp::mcp_server_move,
            settings_plugins::plugins_list,
            settings_plugins::plugin_set_enabled,
            settings_plugins::extension_delete,
            // P — privacy placeholders
            privacy::commands::privacy_list,
            privacy::commands::privacy_classify,
            privacy::commands::privacy_mark,
            privacy::commands::privacy_update,
            privacy::commands::privacy_delete,
            privacy::commands::privacy_session_entry_ids,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Cmd+W with nothing left to close hides the window; a Dock click brings it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = app;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_allowed_tools_from_toml() {
        let content = r#"
default_model = "gpt-4o"
allowed_tools = ["read", "write", "bash"]
"#;
        let tools = parse_allowed_tools_from_text(content).unwrap();
        assert_eq!(tools, vec!["read", "write", "bash"]);
    }

    #[test]
    fn test_parse_allowed_tools_from_yaml() {
        let content = r#"
tools:
  approvalMode: write
allowed-tools: ["edit", "glob"]
"#;
        let tools = parse_allowed_tools_from_text(content).unwrap();
        assert_eq!(tools, vec!["edit", "glob"]);
    }

    #[test]
    fn test_parse_allowed_tools_none() {
        let content = r#"
tools:
  approvalMode: write
"#;
        assert!(parse_allowed_tools_from_text(content).is_none());
    }
}
