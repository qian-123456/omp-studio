//! One-shot `omp -p` runner for summaries / supervisor (prompt via stdin).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use tokio::io::AsyncWriteExt;

use crate::paths;
use crate::state::AppState;

const EXTRA_DIRS: &[&str] = &[
    "~/.local/bin",
    "~/.bun/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
];

fn expand(dir: &str) -> String {
    match dir.strip_prefix("~/") {
        Some(rest) => dirs::home_dir()
            .map(|h| h.join(rest).to_string_lossy().to_string())
            .unwrap_or_else(|| dir.to_string()),
        None => dir.to_string(),
    }
}

static CELL: OnceLock<String> = OnceLock::new();

fn query_login_path_blocking() -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = match std::process::Command::new(shell)
        .args(["-lc", "echo $PATH"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => {
                #[cfg(unix)]
                {
                    let pid = child.id();
                    if pid > 1 {
                        unsafe {
                            libc::killpg(pid as libc::pid_t, libc::SIGKILL);
                        }
                    }
                }
                let _ = child.kill();
                // Reap child so it doesn't become a zombie (<defunct>).
                let _ = child.wait();
                return String::new();
            }
        }
    }
    child
        .wait_with_output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Asynchronously initialize login-shell PATH on a blocking thread pool if not already done.
pub async fn init_login_path() {
    if CELL.get().is_some() {
        return;
    }
    let path = tokio::task::spawn_blocking(query_login_path_blocking)
        .await
        .unwrap_or_default();
    let _ = CELL.set(path);
}

fn query_login_path() -> String {
    // If we're inside a Tokio multi-threaded runtime, use block_in_place + spawn_blocking
    // so the Tokio worker thread is freed while waiting for the shell-out.
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread {
            return tokio::task::block_in_place(|| {
                handle.block_on(async {
                    tokio::task::spawn_blocking(query_login_path_blocking)
                        .await
                        .unwrap_or_default()
                })
            });
        }
    }
    query_login_path_blocking()
}

/// Login-shell PATH, queried once (GUI apps start with a minimal PATH).
fn login_path() -> &'static str {
    CELL.get_or_init(query_login_path)
}

/// Augmented PATH: common tool dirs + login-shell PATH + current PATH (deduped).
pub fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut seen = Vec::<String>::new();
    let extra = EXTRA_DIRS.iter().map(|d| expand(d));
    let rest = login_path()
        .split(':')
        .chain(current.split(':'))
        .map(str::to_string);
    for dir in extra.chain(rest) {
        if !dir.is_empty() && !seen.contains(&dir) {
            seen.push(dir);
        }
    }
    seen.join(":")
}

pub fn resolve_binary(bin: &str, path: &str) -> PathBuf {
    if bin.contains('/') {
        return PathBuf::from(expand(bin));
    }
    path.split(':')
        .map(|d| Path::new(d).join(bin))
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(bin))
}

/// omp role ids (mirrors `src/features/settings/modelRoles.ts`).
const OMP_ROLES: &[&str] = &[
    "default",
    "smol",
    "slow",
    "vision",
    "plan",
    "commit",
    "tiny",
    "memory",
    "task",
    "advisor",
    "image",
    "web",
    "speech",
    "dictation",
    "judge",
];

/// Turn a bare role name (`smol`, `smol:high`) into omp's role alias syntax
/// (`@smol`, `@smol:high`). Bare names only resolve as roles in omp when
/// configured; `@role` falls back to `default`. Other values are returned trimmed.
pub fn normalize_model_selector(model: &str) -> String {
    let m = model.trim();
    if m.starts_with('@') || m.contains('/') {
        return m.to_string();
    }
    let base = m.split_once(':').map_or(m, |(b, _)| b);
    if OMP_ROLES.contains(&base) {
        format!("@{m}")
    } else {
        m.to_string()
    }
}

/// Overlay that turns off the `native` discovery provider for one-shot runs.
/// That provider is where omp finds user/project MCP servers (and AGENTS.md);
/// without it a text-only prompt no longer waits on MCP startup or ships every
/// MCP tool schema to the model. `--no-tools` only covers built-in tools.
const LIGHT_OVERLAY: &str = "disabledProviders:\n  - native\n";

/// Flags that keep a text-only `omp -p` run from loading extensions, skills,
/// rules and MCP servers. Model auth and role settings are unaffected.
pub fn lightweight_args() -> Vec<String> {
    let mut args: Vec<String> = ["--no-extensions", "--no-skills", "--no-rules"]
        .into_iter()
        .map(String::from)
        .collect();
    let path = paths::data_dir().join("omp-light.yml");
    let current = std::fs::read_to_string(&path).ok();
    let ready = current.as_deref() == Some(LIGHT_OVERLAY)
        || std::fs::create_dir_all(paths::data_dir())
            .and_then(|()| std::fs::write(&path, LIGHT_OVERLAY))
            .is_ok();
    if ready {
        args.push("--config".into());
        args.push(path.to_string_lossy().into_owned());
    }
    args
}

/// Run `omp -p --no-tools --no-session --model <model>` with `prompt` on stdin and
/// return trimmed stdout.
pub async fn run_print(
    state: &AppState,
    model: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<String, String> {
    init_login_path().await;
    let bin = state.settings.read().omp_binary.clone();
    let path = augmented_path();
    let exe = resolve_binary(&bin, &path);
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(["-p", "--no-tools", "--no-session", "--no-title"]);
    cmd.args(lightweight_args());
    if let Some(ext) = crate::providers::try_extension_path() {
        cmd.arg("-e").arg(ext);
    }
    let model = normalize_model_selector(model);
    if !model.is_empty() {
        cmd.arg("--model").arg(&model);
    }
    cmd.current_dir(paths::supervisor_dir())
        .env("PATH", path)
        .envs(crate::providers::omp_spawn_env())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", exe.display()))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("write prompt: {e}"))?;
        drop(stdin);
    }
    let out = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| "omp timed out".to_string())?
        .map_err(|e| format!("omp failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: String = stderr
            .chars()
            .rev()
            .take(400)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return Err(format!("omp exited with {}: {}", out.status, tail.trim()));
    }
    if stdout.is_empty() {
        return Err("omp returned empty output".to_string());
    }
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_model_selector_cases() {
        assert_eq!(normalize_model_selector("smol"), "@smol");
        assert_eq!(normalize_model_selector("default"), "@default");
        assert_eq!(normalize_model_selector("smol:high"), "@smol:high");
        assert_eq!(normalize_model_selector("@smol"), "@smol");
        assert_eq!(normalize_model_selector("@slow:low"), "@slow:low");
        assert_eq!(
            normalize_model_selector("anthropic/claude-sonnet-4"),
            "anthropic/claude-sonnet-4"
        );
        assert_eq!(
            normalize_model_selector("openai/gpt-5:high"),
            "openai/gpt-5:high"
        );
        assert_eq!(normalize_model_selector("gpt-5"), "gpt-5");
        assert_eq!(normalize_model_selector("smolx"), "smolx");
        assert_eq!(normalize_model_selector("  smol  "), "@smol");
        assert_eq!(normalize_model_selector("   "), "");
    }

    #[test]
    fn path_contains_extra_dirs_once() {
        let p = augmented_path();
        assert!(p.contains("/opt/homebrew/bin"));
        assert!(p.matches("/opt/homebrew/bin:").count() <= 1);
    }

    #[test]
    fn resolves_absolute_binary() {
        assert_eq!(resolve_binary("/bin/sh", ""), PathBuf::from("/bin/sh"));
        assert_eq!(
            resolve_binary("sh", "/nonexistent:/bin"),
            PathBuf::from("/bin/sh")
        );
    }
}
