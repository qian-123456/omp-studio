//! Text file IO for the markdown editor (size-capped, atomic writes).

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, Weak};

pub(crate) fn write_lock(path: &Path) -> Arc<parking_lot::Mutex<()>> {
    // Crate MSRV is 1.77; LazyLock is only available since Rust 1.80.
    static LOCKS: OnceLock<parking_lot::Mutex<HashMap<PathBuf, Weak<parking_lot::Mutex<()>>>>> =
        OnceLock::new();
    let mut locks = LOCKS.get_or_init(Default::default).lock();
    locks.retain(|_, lock| lock.strong_count() > 0);
    let key = canonical_lenient(path);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(parking_lot::Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

struct PendingWrite(PathBuf);

impl Drop for PendingWrite {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Expand a leading `~` and require an absolute path.
pub fn resolve(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.contains('\0') {
        return Err("无效路径".into());
    }
    let p = if path == "~" || path == "~/" || path == "~\\" {
        dirs::home_dir().ok_or("no home dir")?
    } else if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        dirs::home_dir().ok_or("no home dir")?.join(rest)
    } else {
        PathBuf::from(path)
    };
    if !p.is_absolute() {
        return Err(format!("需要绝对路径：{path}"));
    }
    Ok(p)
}

/// Canonicalize the deepest existing ancestor and re-append the missing tail,
/// so not-yet-existing targets (writes) still resolve through symlinks / `..`.
fn canonical_lenient(p: &Path) -> PathBuf {
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = p.to_path_buf();
    loop {
        if let Ok(c) = cur.canonicalize() {
            let mut out = c;
            for t in tail.iter().rev() {
                out.push(t);
            }
            return out;
        }
        match (cur.file_name().map(|n| n.to_os_string()), cur.parent()) {
            (Some(n), Some(parent)) => {
                tail.push(n);
                cur = parent.to_path_buf();
            }
            _ => return p.to_path_buf(),
        }
    }
}

/// Refuse paths inside the app's own secret store (`<data_dir>/env`: vault + master key).
pub fn ensure_not_protected(p: &Path) -> Result<(), String> {
    ensure_not_inside(p, &crate::paths::data_dir().join("env"))
}

fn ensure_not_inside(p: &Path, protected: &Path) -> Result<(), String> {
    if canonical_lenient(p).starts_with(canonical_lenient(protected)) {
        return Err("该路径属于应用密钥库，禁止访问".into());
    }
    Ok(())
}

pub fn read_text(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("无法读取 {}：{e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("不是文件：{}", path.display()));
    }
    if meta.len() > MAX_BYTES {
        return Err("文件超过 5 MB，拒绝打开".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "不是 UTF-8 文本文件".to_string())
}

/// Write via an independently owned temp file + rename in the same directory.
pub fn write_text(path: &Path, content: &str) -> Result<(), String> {
    write_text_checked(path, content, None)
}

/// Compare and replace under the same per-path lock used by unconditional saves.
/// External writers do not share this lock; recheck immediately before rename.
pub fn write_text_checked(
    path: &Path,
    content: &str,
    expected_content: Option<&str>,
) -> Result<(), String> {
    write_text_impl(path, content, expected_content, || {})
}

fn write_text_impl(
    path: &Path,
    content: &str,
    expected_content: Option<&str>,
    before_replace: impl FnOnce(),
) -> Result<(), String> {
    let lock = write_lock(path);
    let _guard = lock.lock();
    write_text_unlocked_impl(path, content, expected_content, before_replace)
}

/// Caller must hold `write_lock(path)` through any baseline check and this write.
pub(crate) fn write_text_unlocked(path: &Path, content: &str) -> Result<(), String> {
    write_text_unlocked_impl(path, content, None, || {})
}

fn write_text_unlocked_impl(
    path: &Path,
    content: &str,
    expected_content: Option<&str>,
    before_replace: impl FnOnce(),
) -> Result<(), String> {
    if content.len() as u64 > MAX_BYTES {
        return Err("内容超过 5 MB，拒绝保存".into());
    }
    let check = || -> Result<(), String> {
        if let Some(expected) = expected_content {
            if read_text(path).as_deref() != Ok(expected) {
                return Err("CONFLICT: 文件已在外部更改，请重新载入后保存".into());
            }
        }
        Ok(())
    };
    check()?;
    if path.is_dir() {
        return Err(format!("是目录：{}", path.display()));
    }
    let dir = path.parent().ok_or("invalid path")?;
    if !dir.is_dir() {
        return Err(format!("目录不存在：{}", dir.display()));
    }
    let name = path.file_name().ok_or("invalid path")?.to_string_lossy();
    let tmp_path = dir.join(format!(".{name}.ompws-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
        .map_err(|e| format!("写入失败：{e}"))?;
    let tmp = PendingWrite(tmp_path);
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入失败：{e}"))?;
    if let Ok(meta) = std::fs::metadata(path) {
        file.set_permissions(meta.permissions())
            .map_err(|e| format!("写入失败：{e}"))?;
    }
    file.sync_all().map_err(|e| format!("写入失败：{e}"))?;
    drop(file);
    before_replace();
    check()?;
    std::fs::rename(&tmp.0, path).map_err(|e| format!("写入失败：{e}"))
}

#[cfg(test)]
mod tests {

    #[cfg(unix)]
    #[test]
    fn atomic_save_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let path = dir.join("private");
        std::fs::write(&path, "base").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        write_text_checked(&path, "saved", Some("base")).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(read_text(&path).unwrap(), "saved");
        std::fs::remove_dir_all(dir).unwrap();
    }
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ompws-files-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn concurrent_saves_own_their_bytes_and_leave_no_temps() {
        let dir = temp_dir();
        let path = dir.join("doc");
        let barrier = Arc::new(std::sync::Barrier::new(12));
        let threads: Vec<_> = (0..12)
            .map(|n| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let body = n.to_string().repeat(64 * 1024);
                    write_text(&path, &body).unwrap();
                    body
                })
            })
            .collect();
        let bodies: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert!(bodies.contains(&read_text(&path).unwrap()));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_replace_does_not_land_or_leave_temp() {
        let dir = temp_dir();
        let path = dir.join("doc");
        write_text(&path, "original").unwrap();
        let result = write_text_impl(&path, "failed", None, || {
            std::fs::remove_file(&path).unwrap();
            std::fs::create_dir(&path).unwrap();
        });
        assert!(result.is_err());
        assert!(path.is_dir());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn checked_saves_reject_stale_baselines_and_write_time_changes() {
        let dir = temp_dir();
        let path = dir.join("doc");
        write_text(&path, "base").unwrap();
        write_text_checked(&path, "first", Some("base")).unwrap();
        assert!(write_text_checked(&path, "stale", Some("base"))
            .unwrap_err()
            .starts_with("CONFLICT:"));
        assert!(write_text_impl(&path, "late", Some("first"), || {
            std::fs::write(&path, "external").unwrap();
        })
        .unwrap_err()
        .starts_with("CONFLICT:"));
        assert_eq!(read_text(&path).unwrap(), "external");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_checked_saves_have_only_one_winner() {
        let dir = temp_dir();
        let path = dir.join("doc");
        write_text(&path, "base").unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|body| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    (body, write_text_checked(&path, body, Some("base")))
                })
            })
            .collect();
        let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|(_, r)| r.is_ok()).count(), 1);
        let winner = results.iter().find(|(_, r)| r.is_ok()).unwrap().0;
        assert_eq!(read_text(&path).unwrap(), winner);
        assert!(results
            .iter()
            .filter_map(|(_, r)| r.as_ref().err())
            .all(|e| e.starts_with("CONFLICT:")));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_write_roundtrip_and_limits() {
        let dir = PathBuf::from(format!("/tmp/ompws-test-c/files-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("doc.md");
        write_text(&f, "# 标题\n").unwrap();
        assert_eq!(read_text(&f).unwrap(), "# 标题\n");
        write_text(&f, "v2").unwrap();
        assert_eq!(read_text(&f).unwrap(), "v2");
        assert!(
            std::fs::read_dir(&dir).unwrap().count() == 1,
            "no temp leftovers"
        );

        let big = dir.join("big.md");
        std::fs::File::create(&big)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert!(read_text(&big).unwrap_err().contains("5 MB"));
        assert!(write_text(&f, &"x".repeat(MAX_BYTES as usize + 1)).is_err());
        std::fs::write(dir.join("bin"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_text(&dir.join("bin")).is_err());
        assert!(resolve("relative/path.md").is_err());
        assert!(resolve("~/x.md").unwrap().is_absolute());
        assert!(write_text(&dir.join("missing/x.md"), "x").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn protected_dir_denied_but_normal_path_allowed() {
        let base = PathBuf::from(format!("/tmp/ompws-test-c/prot-{}", std::process::id()));
        let env = base.join("env");
        let other = base.join("other");
        std::fs::create_dir_all(&env).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(env.join(".master.key"), "k").unwrap();
        assert!(ensure_not_inside(&env.join(".master.key"), &env).is_err());
        assert!(ensure_not_inside(&env, &env).is_err());
        assert!(ensure_not_inside(&env.join("new.txt"), &env).is_err());
        assert!(ensure_not_inside(&other.join("../env/.master.key"), &env).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&env, other.join("link")).unwrap();
            assert!(ensure_not_inside(&other.join("link/.master.key"), &env).is_err());
        }
        assert!(ensure_not_inside(&other.join("doc.md"), &env).is_ok());
        assert!(ensure_not_inside(&base.join("env2/x"), &env).is_ok());
        std::fs::remove_dir_all(&base).unwrap();
    }
}
