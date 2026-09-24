//! [E] PTY sessions + status extension install.

pub mod commands;
pub mod env;
pub mod extension;
pub mod pty;

use crate::state::AppState;

/// Background setup for module E terminal side: install the status extension
/// into `extension_path()` (overwrite when the bundled content differs).
pub fn init(_state: AppState) {
    if let Err(e) = extension::install_to(&crate::paths::extension_path()) {
        tracing::warn!("install status extension: {e}");
    }
}
