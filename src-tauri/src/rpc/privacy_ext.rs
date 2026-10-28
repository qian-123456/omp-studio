//! Privacy-placeholders extension: bundled source + install-at-startup.
//!
//! Mirrors `git::checkpoints_ext`: the app keeps a private copy under
//! `~/.omp-workspace/extension/` and every app RPC session loads it via `omp -e <path>`.

use std::path::Path;

/// Bundled extension source (repo `extension/omp-workspace-privacy.ts`).
pub const EXT_SOURCE: &str = include_str!("../../../extension/omp-workspace-privacy.ts");

/// Write the extension to `path` when missing or different. Returns true if written.
pub fn install_to(path: &Path) -> std::io::Result<bool> {
    write_if_changed(path, EXT_SOURCE)
}

/// Atomically write `source` to `path` unless it already holds exactly that text.
pub(super) fn write_if_changed(path: &Path, source: &str) -> std::io::Result<bool> {
    if std::fs::read_to_string(path).is_ok_and(|cur| cur == source) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("ts.tmp");
    std::fs::write(&tmp, source)?;
    std::fs::rename(&tmp, path)?;
    Ok(true)
}

/// Install the bundled extension into `~/.omp-workspace/extension/` (startup).
pub fn install() {
    if let Err(e) = install_to(&crate::paths::privacy_extension_path()) {
        tracing::warn!("install privacy extension: {e}");
    }
}

/// A session spawned with `spawn_hash` must be restarted before the next prompt
/// when the coverage token changed and no turn is in flight. Failed syncs carry
/// `unprotected:<hash>`: recovery to the same requested bytes still needs restart.
pub fn needs_restart(spawn_hash: &str, current_hash: &str, streaming: bool) -> bool {
    !streaming && spawn_hash != current_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_once_then_overwrites_on_change() {
        let dir = std::env::temp_dir().join(format!("ompws-priv-ext-{}", uuid::Uuid::new_v4()));
        let path = dir.join("sub/ext.ts");
        assert!(install_to(&path).unwrap());
        assert!(!install_to(&path).unwrap());
        std::fs::write(&path, "old").unwrap();
        assert!(install_to(&path).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), EXT_SOURCE);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restart_only_when_stale_and_idle() {
        assert!(!needs_restart("a", "a", false));
        assert!(!needs_restart("a", "a", true));
        assert!(needs_restart("a", "b", false));
        assert!(needs_restart("", "b", false));
        assert!(!needs_restart("a", "b", true));
        assert!(!needs_restart("unprotected:a", "unprotected:a", false));
        assert!(needs_restart("unprotected:a", "a", false));
        assert!(!needs_restart("unprotected:a", "a", true));
        assert!(needs_restart("a", "unprotected:a", false));
    }
}
