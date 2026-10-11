//! [E] Tauri commands: terminal + status extension (docs/ARCHITECTURE.md §7).

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine as _;
use serde_json::json;
use tauri::Emitter as _;

use super::extension;
use super::pty::{self, Sink, TermEvent};
use super::shell_init;
use crate::state::AppState;

/// session_id → (termId, runs omp) for terminals opened via `term_open_session`.
type SessionTerms = parking_lot::Mutex<HashMap<String, (String, bool)>>;
fn session_terms() -> &'static SessionTerms {
    // OnceLock: MSRV 1.77 predates LazyLock.
    static MAP: std::sync::OnceLock<SessionTerms> = std::sync::OnceLock::new();
    MAP.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}

fn forget_term(term_id: &str) {
    session_terms().lock().retain(|_, (t, _)| t != term_id);
}

/// True while this session's `omp --resume` terminal runs: it writes the same
/// JSONL, so the RPC process must not be spawned alongside it.
pub fn omp_terminal_open(session_id: &str) -> bool {
    session_terms()
        .lock()
        .get(session_id)
        .is_some_and(|(_, omp)| *omp)
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

/// Spawns a local drawer shell (empty `command` → `$SHELL` with the generated
/// agent-aware init files; explicit commands pass through). Returns termId.
#[tauri::command]
pub async fn term_open(
    state: tauri::State<'_, AppState>,
    cwd: String,
    command: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let (argv, extra_env) = shell_init::drawer_spawn(&command).unwrap_or((command, vec![]));
    pty::open(&cwd, &argv, cols, rows, app_sink(&state), &extra_env)
}

/// Records the selected session's transcript in
/// `~/.omp-workspace/current-session` (None clears it) so a drawer terminal's
/// bare `omp`/`claude`/`codex` can resume it.
#[tauri::command]
pub async fn terminal_set_current_session(path: Option<String>) -> Result<(), String> {
    shell_init::set_current_session_file(path.as_deref())
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

/// Agent CLI a session terminal runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TerminalAgent {
    Omp,
    Claude,
    Codex,
}

impl TerminalAgent {
    fn parse(agent: &str) -> Result<Self, String> {
        match agent {
            "omp" => Ok(Self::Omp),
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            other => Err(format!("未知的 Agent: {other}")),
        }
    }

    /// argv for the non-omp agents (resume the latest conversation in cwd).
    fn foreign_argv(self) -> Option<Vec<String>> {
        let v: &[&str] = match self {
            Self::Omp => return None,
            Self::Claude => &["claude", "--continue"],
            Self::Codex => &["codex", "resume", "--last"],
        };
        Some(v.iter().map(|s| s.to_string()).collect())
    }

    fn label(self) -> &'static str {
        match self {
            Self::Omp => "omp",
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
        }
    }
}

/// Opens the session's agent terminal (one per session; reopening replaces it).
/// `omp`: stops the RPC process, then runs `omp --resume <file> -e <ext>`.
/// `claude` / `codex`: run `claude --continue` / `codex resume --last` in the
/// session cwd without touching the RPC process. Returns termId.
#[tauri::command]
pub async fn term_open_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    agent: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let agent = TerminalAgent::parse(&agent)?;
    let lock = crate::rpc::session_resume_lock(&session_id);
    let _guard = lock.lock().await;
    let meta = crate::catalog::get(&state, &session_id)
        .await
        .ok_or_else(|| format!("找不到会话 {session_id}"))?;
    let foreign = agent.foreign_argv();
    if let Some(argv) = &foreign {
        // Resolve against the login-shell PATH before tearing anything down.
        if crate::terminal::env::which(&argv[0]).is_none() {
            return Err(format!(
                "找不到 {} 命令行（{}），请先安装并确认它在登录 Shell 的 PATH 中",
                agent.label(),
                argv[0]
            ));
        }
    } else if let Some(handle) = crate::rpc::get_handle(&session_id) {
        if let Err(e) = crate::rpc::stop(&handle).await {
            if e != "session is not live" && e != "session process is not running" {
                return Err(format!("停止结构化通道失败: {e}"));
            }
        }
    }
    // Re-opening a session terminal replaces the previous one.
    let old = session_terms().lock().get(&session_id).cloned();
    if let Some((old, _)) = old {
        pty::close(&old);
        forget_term(&old);
    }
    let is_omp = foreign.is_none();
    let argv = match foreign {
        Some(argv) => argv,
        None => {
            let ext = crate::paths::extension_path();
            let _ = extension::install_to(&ext);
            let binary = state.settings.read().omp_binary.clone();
            let mut argv = vec![
                binary,
                "--resume".to_string(),
                meta.file.clone(),
                "-e".to_string(),
                ext.to_string_lossy().to_string(),
            ];
            let privacy_ext = crate::paths::privacy_extension_path();
            if privacy_ext.exists() {
                argv.push("-e".to_string());
                argv.push(privacy_ext.to_string_lossy().to_string());
            }
            if let Some(provider_ext) = crate::providers::try_extension_path() {
                argv.push("-e".to_string());
                argv.push(provider_ext.to_string_lossy().to_string());
            }
            argv
        }
    };
    let mut extra_env: Vec<(String, String)> =
        crate::providers::terminal_extra_env().into_iter().collect();
    if is_omp {
        extra_env.extend(crate::privacy::spawn_env());
    }
    let cwd = if std::path::Path::new(&meta.cwd).is_dir() {
        meta.cwd.clone()
    } else {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string())
    };
    let term_id = pty::open(&cwd, &argv, cols, rows, app_sink(&state), &extra_env)?;
    session_terms()
        .lock()
        .insert(session_id, (term_id.clone(), is_omp));
    Ok(term_id)
}

#[cfg(test)]
mod agent_tests {
    use super::TerminalAgent;

    #[test]
    fn parses_known_agents_and_rejects_others() {
        assert_eq!(TerminalAgent::parse("omp"), Ok(TerminalAgent::Omp));
        assert_eq!(TerminalAgent::parse("claude"), Ok(TerminalAgent::Claude));
        assert_eq!(TerminalAgent::parse("codex"), Ok(TerminalAgent::Codex));
        assert_eq!(
            TerminalAgent::parse("Claude"),
            Err("未知的 Agent: Claude".to_string())
        );
    }

    #[test]
    fn foreign_agents_resume_latest_conversation() {
        assert_eq!(TerminalAgent::Omp.foreign_argv(), None);
        assert_eq!(
            TerminalAgent::Claude.foreign_argv().unwrap(),
            ["claude", "--continue"]
        );
        assert_eq!(
            TerminalAgent::Codex.foreign_argv().unwrap(),
            ["codex", "resume", "--last"]
        );
    }
}

/// Copies the status extension into `~/.omp/agent/extensions/` (opt-in button).
/// Returns the installed path.
#[tauri::command]
pub async fn install_status_extension_globally() -> Result<String, String> {
    let path = extension::global_path();
    extension::install_to(&path).map_err(|e| format!("安装失败: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}
