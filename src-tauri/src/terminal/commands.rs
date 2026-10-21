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
            let settings = state.settings.read().clone();
            let mut argv = vec![
                settings.omp_binary.clone(),
                "--resume".to_string(),
                meta.file.clone(),
            ];
            // Same prompt-shaping args as the RPC process, or the first turn after
            // switching views cold-misses the provider prompt cache.
            argv.extend(crate::rpc::prompt_shape_args(
                Some(&meta.file),
                None,
                None,
                &settings,
            ));
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

/// POSIX single-quote `s` unless it is made only of shell-safe characters.
fn sh_quote(s: &str) -> String {
    let safe = !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c));
    if safe {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// One-line shell command that resumes `file` in an external terminal with the
/// same prompt-shaping argv (`shape`) and non-secret env as the app's own omp
/// processes. A bare `omp --resume` there drops the app's `--append-system-prompt`
/// / `--plugin-dir` / `-e` flags, which changes the system prompt and cold-misses
/// the provider prompt cache for the whole transcript.
fn resume_command_line(
    cwd: &str,
    binary: &str,
    file: &str,
    shape: &[String],
    env: &[(String, String)],
) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (k, v) in env {
        parts.push(format!("{k}={}", sh_quote(v)));
    }
    parts.push(sh_quote(binary));
    parts.push("--resume".to_string());
    parts.push(sh_quote(file));
    parts.extend(shape.iter().map(|a| sh_quote(a)));
    format!("cd {} && {}", sh_quote(cwd), parts.join(" "))
}

/// Shell command for resuming the session from an external terminal while
/// keeping the app's prompt shape (so the prompt cache stays warm). Never
/// includes provider API keys: only the secret-free routing metadata and
/// privacy file pointers ride along.
#[tauri::command]
pub async fn session_resume_command(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let meta = crate::catalog::get(&state, &session_id)
        .await
        .ok_or_else(|| format!("找不到会话 {session_id}"))?;
    let _ = extension::install_to(&crate::paths::extension_path());
    let settings = state.settings.read().clone();
    let shape = crate::rpc::prompt_shape_args(Some(&meta.file), None, None, &settings);
    let mut env: Vec<(String, String)> =
        crate::providers::terminal_extra_env().into_iter().collect();
    env.extend(crate::privacy::spawn_env());
    Ok(resume_command_line(
        &meta.cwd,
        &settings.omp_binary,
        &meta.file,
        &shape,
        &env,
    ))
}

#[cfg(test)]
mod resume_command_tests {
    use super::*;

    #[test]
    fn quotes_only_when_needed() {
        assert_eq!(sh_quote("omp"), "omp");
        assert_eq!(sh_quote("/a/b-c_d.jsonl"), "/a/b-c_d.jsonl");
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(sh_quote(""), "''");
    }

    #[test]
    fn resume_line_carries_prompt_shape_and_env() {
        let shape = vec![
            "--append-system-prompt".to_string(),
            "line one\nline 'two'".to_string(),
            "-e".to_string(),
            "/x/ext.ts".to_string(),
        ];
        let env = vec![("OMPWS_PRIVACY_FILE".to_string(), "/d/s.json".to_string())];
        let line = resume_command_line("/my proj", "omp", "/s/a b.jsonl", &shape, &env);
        assert_eq!(
            line,
            "cd '/my proj' && OMPWS_PRIVACY_FILE=/d/s.json omp --resume '/s/a b.jsonl' \
             --append-system-prompt 'line one\nline '\\''two'\\''' -e /x/ext.ts"
        );
    }
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
