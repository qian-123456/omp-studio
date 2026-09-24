//! Data locations (docs/ARCHITECTURE.md §3).
// Some helpers are consumed by module stubs filled in later.
#![allow(dead_code)]

use std::io;
use std::path::PathBuf;

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

/// `~/.omp-workspace`
pub fn data_dir() -> PathBuf {
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

/// `~/.omp-workspace/supervisor-sessions/`
pub fn supervisor_dir() -> PathBuf {
    data_dir().join("supervisor-sessions")
}

/// `~/.omp/agent/sessions/`
pub fn omp_sessions_dir() -> PathBuf {
    home().join(".omp").join("agent").join("sessions")
}

/// Create all app-owned directories at startup.
pub fn ensure_dirs() -> io::Result<()> {
    for dir in [data_dir(), global_dir(), status_dir(), supervisor_dir()] {
        std::fs::create_dir_all(&dir)?;
    }
    if let Some(parent) = extension_path().parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}
