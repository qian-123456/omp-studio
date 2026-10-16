//! Data locations (docs/ARCHITECTURE.md §3).
// Some helpers are consumed by module stubs filled in later.
#![allow(dead_code)]

use std::io;
use std::path::PathBuf;

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

/// `~/.omp-workspace` (overridable via `OMPWS_DATA_DIR` for isolated dev/preview instances)
pub fn data_dir() -> PathBuf {
    if let Ok(val) = std::env::var("OMPWS_DATA_DIR") {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    home().join(".omp-workspace")
}

/// `~/.omp-workspace/app.db`
pub fn db_path() -> PathBuf {
    data_dir().join("app.db")
}

/// `~/.omp-workspace/global/` — cwd for the 🌐 global workspace.
pub fn global_dir() -> PathBuf {
    data_dir().join("global")
}

/// `~/.omp-workspace/status/` — status files written by the extension (§8).
pub fn status_dir() -> PathBuf {
    data_dir().join("status")
}

/// `~/.omp-workspace/extension/omp-workspace-status.ts`
pub fn extension_path() -> PathBuf {
    data_dir().join("extension").join("omp-workspace-status.ts")
}

/// `~/.omp-workspace/extension/omp-workspace-checkpoints.ts`
pub fn checkpoints_extension_path() -> PathBuf {
    data_dir()
        .join("extension")
        .join("omp-workspace-checkpoints.ts")
}

/// `~/.omp-workspace/extension/omp-workspace-privacy.ts`
pub fn privacy_extension_path() -> PathBuf {
    data_dir()
        .join("extension")
        .join("omp-workspace-privacy.ts")
}

/// `~/.omp-workspace/oneshot-sessions/`
pub fn oneshot_dir() -> PathBuf {
    data_dir().join("oneshot-sessions")
}

/// `~/.omp/agent/sessions/`
pub fn omp_sessions_dir() -> PathBuf {
    home().join(".omp").join("agent").join("sessions")
}

/// Create all app-owned directories at startup.
pub fn ensure_dirs() -> io::Result<()> {
    for dir in [data_dir(), global_dir(), status_dir(), oneshot_dir()] {
        std::fs::create_dir_all(&dir)?;
    }
    if let Some(parent) = extension_path().parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Seed the global workspace guide once; never overwrite user edits.
    let guide = global_dir().join("AGENTS.md");
    if !guide.exists() {
        std::fs::write(&guide, include_str!("../prompts/global-agents.md"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_dir_default_and_override() {
        let default_dir = data_dir();
        assert!(default_dir.ends_with(".omp-workspace"));

        std::env::set_var("OMPWS_DATA_DIR", "/tmp/ompws-test-env");
        assert_eq!(data_dir(), PathBuf::from("/tmp/ompws-test-env"));
        std::env::remove_var("OMPWS_DATA_DIR");
        assert_eq!(data_dir(), default_dir);
    }
}
