//! Text file IO for the markdown editor (size-capped, atomic writes).

use std::path::{Path, PathBuf};

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

/// Write via temp file + rename in the same directory.
pub fn write_text(path: &Path, content: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_BYTES {
        return Err("内容超过 5 MB，拒绝保存".into());
    }
    if path.is_dir() {
        return Err(format!("是目录：{}", path.display()));
    }
    let dir = path.parent().ok_or("invalid path")?;
    if !dir.is_dir() {
        return Err(format!("目录不存在：{}", dir.display()));
    }
    let name = path.file_name().ok_or("invalid path")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.ompws-{}.tmp", std::process::id()));
    std::fs::write(&tmp, content).map_err(|e| format!("写入失败：{e}"))?;
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("写入失败：{e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
