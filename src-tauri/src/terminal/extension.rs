//! Status extension installation (§8): app-private copy at startup, optional global copy.

use std::path::{Path, PathBuf};

pub const EXTENSION_SRC: &str = include_str!("../../../extension/omp-workspace-status.ts");

/// Write the extension to `path` when missing or different. Returns true if written.
pub fn install_to(path: &Path) -> std::io::Result<bool> {
    if std::fs::read_to_string(path).is_ok_and(|cur| cur == EXTENSION_SRC) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("ts.tmp");
    std::fs::write(&tmp, EXTENSION_SRC)?;
    std::fs::rename(&tmp, path)?;
    Ok(true)
}

/// `~/.omp/agent/extensions/omp-workspace-status.ts`
pub fn global_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".omp/agent/extensions/omp-workspace-status.ts")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_once_then_overwrites_on_change() {
        let dir = std::env::temp_dir().join(format!("ompws-ext-{}", uuid::Uuid::new_v4()));
        let path = dir.join("sub/ext.ts");
        assert!(install_to(&path).unwrap());
        assert!(!install_to(&path).unwrap());
        std::fs::write(&path, "old").unwrap();
        assert!(install_to(&path).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), EXTENSION_SRC);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
