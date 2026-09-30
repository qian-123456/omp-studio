//! Turn-checkpoints extension: bundled source, install-at-startup, rule text.
//!
//! Mirrors `terminal::extension`: the app keeps a private copy under
//! `~/.omp-workspace/extension/` and app sessions load it via `omp -e <path>`
//! (only when `Settings.turn_checkpoints == Some(true)`).

use std::path::Path;

/// Bundled extension source (repo `extension/omp-workspace-checkpoints.ts`).
pub const EXT_SOURCE: &str = include_str!("../../../extension/omp-workspace-checkpoints.ts");

/// Exact auto-commit rule text injected by the extension (`extension/autocommit-rule.md`).
pub const RULE: &str = include_str!("../../../extension/autocommit-rule.md");

/// Write the extension to `path` when missing or different. Returns true if written.
/// Atomic: temp file + rename, like `terminal::extension::install_to`.
pub fn install_to(path: &Path) -> std::io::Result<bool> {
    if std::fs::read_to_string(path).is_ok_and(|cur| cur == EXT_SOURCE) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("ts.tmp");
    std::fs::write(&tmp, EXT_SOURCE)?;
    std::fs::rename(&tmp, path)?;
    Ok(true)
}

/// Install the bundled extension into `~/.omp-workspace/extension/` (startup).
pub fn install() {
    if let Err(e) = install_to(&crate::paths::checkpoints_extension_path()) {
        tracing::warn!("install checkpoints extension: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_is_embedded_in_extension_source() {
        assert!(EXT_SOURCE.contains(RULE.trim()));
    }

    #[test]
    fn installs_once_then_overwrites_on_change() {
        let dir = std::env::temp_dir().join(format!("ompws-ckpt-ext-{}", uuid::Uuid::new_v4()));
        let path = dir.join("sub/ext.ts");
        assert!(install_to(&path).unwrap());
        assert!(!install_to(&path).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), EXT_SOURCE);
        std::fs::write(&path, "old").unwrap();
        assert!(install_to(&path).unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
