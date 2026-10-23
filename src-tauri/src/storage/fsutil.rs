//! Filesystem helpers shared by the storage modules. Never follow symlinks.

use std::fs;
use std::io;
use std::path::Path;

/// Total size in bytes of a file or directory tree (symlinks counted as their
/// own tiny entry, never followed). Missing paths count as 0.
pub fn tree_size(path: &Path) -> u64 {
    let Ok(md) = fs::symlink_metadata(path) else {
        return 0;
    };
    if !md.is_dir() {
        return md.len();
    }
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries.flatten().map(|e| tree_size(&e.path())).sum()
}

/// Remove a file or directory tree; a missing path is success.
pub fn remove_path(path: &Path) -> io::Result<()> {
    let md = match fs::symlink_metadata(path) {
        Ok(md) => md,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let res = if md.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match res {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// Remove every child of `dir` but keep `dir` itself. Returns bytes freed.
pub fn clear_dir_contents(dir: &Path) -> io::Result<u64> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(0);
    };
    let mut freed = 0;
    for e in entries.flatten() {
        let p = e.path();
        let size = tree_size(&p);
        remove_path(&p)?;
        freed += size;
    }
    Ok(freed)
}

#[cfg(test)]
pub fn scratch_dir(tag: &str) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "ompws-storage-{tag}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}
