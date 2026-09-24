//! PATH augmentation for child processes (macOS GUI apps start with a minimal PATH).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

/// The user's login-shell PATH, computed once (`$SHELL -lc 'echo $PATH'`).
fn login_shell_path() -> Option<String> {
    static CACHE: OnceLock<Option<String>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            let out = std::process::Command::new(shell)
                .args(["-lc", "echo $PATH"])
                .stdin(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output()
                .ok()?;
            let text = String::from_utf8_lossy(&out.stdout);
            let line = text.lines().last()?.trim().to_string();
            (!line.is_empty()).then_some(line)
        })
        .clone()
}

/// Merge PATH lists left-to-right, dropping empty and duplicate entries.
pub fn merge_paths<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
    let mut seen = Vec::<&str>::new();
    for part in parts {
        for entry in part.split(':') {
            if !entry.is_empty() && !seen.contains(&entry) {
                seen.push(entry);
            }
        }
    }
    seen.join(":")
}

/// `~/.local/bin`, `~/.bun/bin`, Homebrew and `/usr/local/bin` prepended to the
/// login-shell PATH and the current process PATH.
pub fn augmented_path() -> String {
    let h = home();
    let extra = [
        h.join(".local/bin"),
        h.join(".bun/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]
    .iter()
    .map(|p| p.to_string_lossy().to_string())
    .collect::<Vec<_>>()
    .join(":");
    let login = login_shell_path().unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    merge_paths([
        extra.as_str(),
        login.as_str(),
        current.as_str(),
        "/usr/bin:/bin:/usr/sbin:/sbin",
    ])
}

/// Resolve a binary name against the augmented PATH (absolute paths pass through).
pub fn which(bin: &str) -> Option<PathBuf> {
    if bin.contains('/') {
        let p = Path::new(bin);
        return p.is_file().then(|| p.to_path_buf());
    }
    augmented_path()
        .split(':')
        .map(|dir| Path::new(dir).join(bin))
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_dedupes_and_keeps_order() {
        assert_eq!(merge_paths(["/a:/b", "/b::/c", "/a:/d"]), "/a:/b:/c:/d");
    }

    #[test]
    fn augmented_contains_system_dirs() {
        let p = augmented_path();
        assert!(p.split(':').any(|e| e == "/usr/bin"));
        assert!(p.contains(".local/bin"));
        assert!(which("sh").is_some());
        assert!(which("definitely-not-a-binary-xyz").is_none());
    }
}
