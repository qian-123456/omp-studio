//! Agent-aware shell init for drawer terminals (docs/ARCHITECTURE.md §7).
//!
//! `term_open` spawns the user's login shell through generated rc files under
//! `~/.omp-workspace/`: zsh gets `ZDOTDIR` pointed at `zdot/` (whose shims
//! forward to the real `~/.zsh*`), bash gets `--rcfile bashrc`. Both end by
//! sourcing `terminal-init.*`, which installs `omp`/`claude`/`codex` aliases
//! that resume the session recorded in `~/.omp-workspace/current-session`.
//! Session terminals (`term_open_session`) bypass all of this: they run
//! `omp --resume <file>` directly.

use std::path::{Path, PathBuf};

use crate::paths;
/// `~/.omp-workspace/zdot/` — synthetic ZDOTDIR for drawer zsh sessions.
fn zdot_dir() -> PathBuf {
    paths::data_dir().join("zdot")
}

/// `~/.omp-workspace/bashrc` — `--rcfile` target for drawer bash sessions.
fn bashrc_path() -> PathBuf {
    paths::data_dir().join("bashrc")
}

/// Shared POSIX init (both `terminal-init.zsh` and `terminal-init.bash`).
///
/// Wrappers are *aliases to functions*, not bare functions: `\omp` and
/// `command omp` then still reach the real binary, and the wrappers never
/// apply inside user scripts or subshells.
const TERMINAL_INIT: &str = r#"# OMP Workspace terminal init — generated file; manual edits are overwritten.
#
# Bare `omp`/`claude`/`codex` continue the session the app has selected;
# anything else passes through unchanged (`omp list`, `omp -p ...`,
# `omp --resume <file>`, `codex exec`, `claude doctor`, help/version flags).
# Bypass a wrapper with a leading backslash (\omp) or `command omp`.

_ompws_omp() {
    _ompws_f=""
    [ -f "$HOME/.omp-workspace/current-session" ] && \
        _ompws_f="$(<"$HOME/.omp-workspace/current-session")"
    # Only resume when the recorded transcript still exists.
    if [ -z "$_ompws_f" ] || [ ! -f "$_ompws_f" ]; then
        command omp "$@"
        return
    fi
    case "$1" in
        -p|--prompt|-h|--help|-V|--version|--resume|-r)
            command omp "$@" ;;
        ""|-*)
            command omp --resume "$_ompws_f" "$@" ;;
        *)
            command omp "$@" ;;
    esac
}

_ompws_claude() {
    case "$1" in
        -h|--help|-v|--version|--continue|-c|--resume|-r)
            command claude "$@" ;;
        ""|-*)
            command claude --continue "$@" ;;
        *)
            command claude "$@" ;;
    esac
}

_ompws_codex() {
    if [ $# -eq 0 ]; then
        command codex resume --last
    else
        command codex "$@"
    fi
}

alias omp=_ompws_omp
alias claude=_ompws_claude
alias codex=_ompws_codex

# One-time hint (dim gray) so the wrappers are discoverable.
[ -t 1 ] && printf '\033[90mOMP 工作台终端 · omp/claude/codex 自动接回当前会话（\\前缀可跳过）\033[0m\n'
"#;

/// `zdot/.zshrc`: real `~/.zshrc` first, then the agent-aware init. ZDOTDIR is
/// unset afterwards so nested zsh sessions (and `.zlogin` lookup) fall back to
/// the user's home directory.
const ZDOT_ZSHRC: &str = r#"# OMP Workspace ZDOTDIR shim — generated; loads the real ~/.zshrc first.
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc"
[ -f "$HOME/.omp-workspace/terminal-init.zsh" ] && source "$HOME/.omp-workspace/terminal-init.zsh"
unset ZDOTDIR
"#;

/// `bashrc` used via `bash --rcfile`: real `~/.bashrc` first, then the init.
const BASHRC: &str = r#"# OMP Workspace bashrc — generated; loads the real ~/.bashrc first.
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
[ -f "$HOME/.omp-workspace/terminal-init.bash" ] && source "$HOME/.omp-workspace/terminal-init.bash"
"#;

/// `zdot/.zshenv`/`.zprofile`/`.zlogin` shim: ZDOTDIR shadows the user's real
/// dotfiles, so each stub forwards to it.
fn user_file_shim(name: &str) -> String {
    format!(
        "# OMP Workspace ZDOTDIR shim — generated; forwards to the user's real ~/{name}.\n\
         [ -f \"$HOME/{name}\" ] && source \"$HOME/{name}\"\n"
    )
}

fn write_if_changed(path: &Path, content: &[u8]) -> Result<(), String> {
    match std::fs::read(path) {
        Ok(existing) if existing == content => return Ok(()),
        Ok(_) | Err(_) => {}
    }
    std::fs::write(path, content).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Write every generated init file under `dir` (idempotent: unchanged content
/// is left alone, keeping mtimes stable for file watchers).
fn ensure_init_files_in(dir: &Path) -> Result<(), String> {
    let zdot = dir.join("zdot");
    std::fs::create_dir_all(&zdot).map_err(|e| format!("create {}: {e}", zdot.display()))?;
    for name in [".zshenv", ".zprofile", ".zlogin"] {
        write_if_changed(&zdot.join(name), user_file_shim(name).as_bytes())?;
    }
    write_if_changed(&zdot.join(".zshrc"), ZDOT_ZSHRC.as_bytes())?;
    write_if_changed(&dir.join("terminal-init.zsh"), TERMINAL_INIT.as_bytes())?;
    write_if_changed(&dir.join("terminal-init.bash"), TERMINAL_INIT.as_bytes())?;
    write_if_changed(&dir.join("bashrc"), BASHRC.as_bytes())?;
    Ok(())
}

/// Materialize the generated init files under `~/.omp-workspace/` (idempotent).
/// Called at app start and again on each drawer spawn so the files survive
/// deletion while the app is running.
pub fn ensure_shell_init_files() -> Result<(), String> {
    ensure_init_files_in(&paths::data_dir())
}

/// Write/clear `<dir>/current-session`.
fn write_current_session_in(dir: &Path, path: Option<&str>) -> Result<(), String> {
    let file = dir.join("current-session");
    match path {
        Some(p) if !p.is_empty() => {
            if let Some(parent) = file.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("create {}: {e}", parent.display()))?;
            }
            std::fs::write(&file, format!("{p}\n"))
                .map_err(|e| format!("write {}: {e}", file.display()))
        }
        _ => match std::fs::remove_file(&file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("clear {}: {e}", file.display())),
        },
    }
}

/// Record the selected session's transcript (None/empty clears it) so a drawer
/// terminal's bare `omp` resumes the right session.
pub fn set_current_session_file(path: Option<&str>) -> Result<(), String> {
    write_current_session_in(&paths::data_dir(), path)
}

/// argv + extra env produced by [`drawer_spawn`].
pub type DrawerSpawn = (Vec<String>, Vec<(String, String)>);

/// argv + extra env for a drawer terminal. `None` → pass `command` through
/// untouched (explicit non-shell spawns). Only the default shell spawn (empty
/// `command`, i.e. `$SHELL -l`) gets the agent-aware init files.
pub fn drawer_spawn(command: &[String]) -> Option<DrawerSpawn> {
    if !command.is_empty() {
        return None;
    }
    if let Err(e) = ensure_shell_init_files() {
        tracing::warn!("write terminal init files: {e}");
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let name = Path::new(&shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    match name {
        "zsh" => Some((
            vec![shell, "-l".to_string()],
            vec![(
                "ZDOTDIR".to_string(),
                zdot_dir().to_string_lossy().to_string(),
            )],
        )),
        "bash" => Some((
            vec![
                shell,
                "--rcfile".to_string(),
                bashrc_path().to_string_lossy().to_string(),
            ],
            vec![],
        )),
        // Unknown shell: fall back to `$SHELL -l` with no init injection.
        _ => Some((vec![shell, "-l".to_string()], vec![])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_files_are_written_once() {
        let dir = std::env::temp_dir().join(format!("ompws-init-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        ensure_init_files_in(&dir).unwrap();
        let zshrc = dir.join("zdot").join(".zshrc");
        assert!(zshrc.is_file());
        let mtime = std::fs::metadata(&zshrc).unwrap().modified().unwrap();
        // Second run is a no-op for unchanged content.
        ensure_init_files_in(&dir).unwrap();
        assert_eq!(
            mtime,
            std::fs::metadata(&zshrc).unwrap().modified().unwrap()
        );
        let init = std::fs::read_to_string(dir.join("terminal-init.zsh")).unwrap();
        assert!(init.contains("command omp --resume"));
        assert!(init.contains("alias omp=_ompws_omp"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn current_session_write_and_clear() {
        let dir = std::env::temp_dir().join(format!("ompws-cs-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write_current_session_in(&dir, Some("/tmp/s.jsonl")).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("current-session")).unwrap(),
            "/tmp/s.jsonl\n"
        );
        write_current_session_in(&dir, None).unwrap();
        assert!(!dir.join("current-session").exists());
        // Clearing twice is fine.
        write_current_session_in(&dir, None).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
