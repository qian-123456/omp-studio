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

/// Login-shell PATH, queried once (GUI apps start with a minimal PATH).
fn login_path() -> &'static str {
    static CELL: OnceLock<String> = OnceLock::new();
    CELL.get_or_init(|| {
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
                    std::thread::sleep(Duration::from_millis(50))
                }
                _ => {
                    let _ = child.kill();
                    return String::new();
                }
            }
        }
        child
            .wait_with_output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    })
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

/// Run `omp -p --no-tools --no-session --model <model>` with `prompt` on stdin and
/// return trimmed stdout.
pub async fn run_print(
    state: &AppState,
    model: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<String, String> {
    let bin = state.settings.read().omp_binary.clone();
    let path = augmented_path();
    let exe = resolve_binary(&bin, &path);
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(["-p", "--no-tools", "--no-session", "--no-title"]);
    cmd.arg("-e").arg(crate::providers::extension_path()?);
    if !model.trim().is_empty() {
        cmd.args(["--model", model.trim()]);
    }
    cmd.current_dir(paths::supervisor_dir())
        .env("PATH", path)
        .envs(crate::providers::env_pairs())
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
