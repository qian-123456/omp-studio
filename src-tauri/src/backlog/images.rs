//! One-off, idempotent move of backlog-referenced images into the durable
//! image dir (`paths::images_dir()`). Originals are kept; only the backlog
//! rows (inline `[图片: path]` tags and `image` refs) are rewritten.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::contracts::BacklogRef;

fn tag_re() -> &'static regex::Regex {
    static RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"\[图片:\s*([^\]]+?)\s*\]").unwrap());
    &RE
}

/// Copy `src` into `dir` under a stable name and return the new path.
///
/// An existing target is reused only when its content is byte-identical: two
/// different images that share a file name and size (screenshots from
/// different directories are a real case) must not be folded onto one path,
/// which would silently point the second backlog item at the first image. A
/// clashing different file gets a size suffix, then a numbered one.
fn copy_stable(src: &Path, dir: &Path) -> std::io::Result<PathBuf> {
    let name = src
        .file_name()
        .ok_or_else(|| std::io::Error::other("no file name"))?;
    let len = std::fs::metadata(src)?.len();
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("img");
    let suffix = src.extension().and_then(|e| e.to_str());
    let named = |base: String| match suffix {
        Some(ext) => format!("{base}.{ext}"),
        None => base,
    };

    // Candidates in preference order: `<name>`, `<stem>-<len>[.<ext>]`, then
    // `<stem>-<len>-<n>[.<ext>]`. The first free one is used; an existing one is
    // reused only when it already holds exactly this file.
    let mut candidates = vec![name.to_string_lossy().into_owned()];
    candidates.push(named(format!("{stem}-{len}")));
    for n in 2..100 {
        candidates.push(named(format!("{stem}-{len}-{n}")));
    }
    for candidate in candidates {
        let dest = dir.join(&candidate);
        match std::fs::metadata(&dest) {
            Ok(meta) if meta.len() == len && same_content(src, &dest)? => return Ok(dest),
            Ok(_) => continue,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::copy(src, &dest)?;
                return Ok(dest);
            }
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other("no free image name"))
}

/// Byte comparison of two files (sizes already known equal).
fn same_content(a: &Path, b: &Path) -> std::io::Result<bool> {
    let mut fa = std::io::BufReader::new(std::fs::File::open(a)?);
    let mut fb = std::io::BufReader::new(std::fs::File::open(b)?);
    let mut ba = [0u8; 64 * 1024];
    let mut bb = [0u8; 64 * 1024];
    loop {
        let na = read_full(&mut fa, &mut ba)?;
        let nb = read_full(&mut fb, &mut bb)?;
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }
}

fn read_full(reader: &mut impl std::io::Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match reader.read(&mut buf[filled..])? {
            0 => break,
            n => filled += n,
        }
    }
    Ok(filled)
}

/// Rewrite every backlog image path outside `dir` that still exists on disk.
/// Returns how many rows changed.
pub fn migrate(conn: &Connection, dir: &Path) -> Result<usize, String> {
    let rows: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, text, refs FROM backlog")
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?;
        mapped.filter_map(Result::ok).collect()
    };
    let mut moved: HashMap<String, Option<String>> = HashMap::new();
    let mut resolve = |p: &str| -> Option<String> {
        if Path::new(p).starts_with(dir) {
            return None;
        }
        moved
            .entry(p.to_string())
            .or_insert_with(|| {
                let src = Path::new(p);
                if !src.is_file() {
                    return None;
                }
                std::fs::create_dir_all(dir).ok()?;
                copy_stable(src, dir)
                    .ok()
                    .map(|d| d.to_string_lossy().into_owned())
            })
            .clone()
    };
    let mut changed = 0;
    for (id, text, refs_json) in rows {
        let new_text = tag_re()
            .replace_all(&text, |c: &regex::Captures| match resolve(&c[1]) {
                Some(n) => format!("[图片: {n}]"),
                None => c[0].to_string(),
            })
            .into_owned();
        let mut refs: Vec<BacklogRef> = serde_json::from_str(&refs_json).unwrap_or_default();
        let mut refs_changed = false;
        for r in refs.iter_mut().filter(|r| r.kind == "image") {
            if let Some(n) = r.path.as_deref().and_then(&mut resolve) {
                r.path = Some(n);
                refs_changed = true;
            }
        }
        if new_text == text && !refs_changed {
            continue;
        }
        let refs_out = if refs_changed {
            serde_json::to_string(&refs).map_err(|e| e.to_string())?
        } else {
            refs_json
        };
        conn.execute(
            "UPDATE backlog SET text = ?2, refs = ?3 WHERE id = ?1",
            params![id, new_text, refs_out],
        )
        .map_err(|e| e.to_string())?;
        changed += 1;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_rewrites_paths_and_is_idempotent() {
        let base = std::env::temp_dir().join(format!("ompws-bimg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let old = base.join("old.png");
        std::fs::write(&old, b"img").unwrap();
        let dir = base.join("images");
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE backlog(id TEXT, text TEXT, refs TEXT)", [])
            .unwrap();
        let refs = format!(r#"[{{"kind":"image","path":"{}"}}]"#, old.display());
        let missing = base.join("gone.png");
        conn.execute(
            "INSERT INTO backlog VALUES('a', ?1, ?2), ('b', ?3, '[]')",
            params![
                format!("x [图片: {}]", old.display()),
                refs,
                format!("[图片: {}]", missing.display())
            ],
        )
        .unwrap();

        assert_eq!(migrate(&conn, &dir).unwrap(), 1);
        let (text, refs): (String, String) = conn
            .query_row("SELECT text, refs FROM backlog WHERE id='a'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        let new_path = dir.join("old.png");
        assert_eq!(text, format!("x [图片: {}]", new_path.display()));
        assert!(refs.contains(&new_path.display().to_string()));
        assert_eq!(std::fs::read(&new_path).unwrap(), b"img");
        assert!(old.exists(), "original kept");
        // Missing source: row untouched. Second run: nothing to do.
        assert_eq!(migrate(&conn, &dir).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Two backlog items referencing different images that share a file name and
    /// size must keep pointing at their own file: reusing the first copy would
    /// silently rewrite the second item to the first image.
    #[test]
    fn same_name_and_size_images_are_not_merged() {
        let base = std::env::temp_dir().join(format!("ompws-bimg2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join("images");
        let a_dir = base.join("a");
        let b_dir = base.join("b");
        std::fs::create_dir_all(&a_dir).unwrap();
        std::fs::create_dir_all(&b_dir).unwrap();
        let first = a_dir.join("shot.png");
        let second = b_dir.join("shot.png");
        std::fs::write(&first, b"AAAA").unwrap();
        std::fs::write(&second, b"BBBB").unwrap();
        assert_eq!(
            std::fs::metadata(&first).unwrap().len(),
            std::fs::metadata(&second).unwrap().len()
        );

        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE backlog(id TEXT, text TEXT, refs TEXT)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO backlog VALUES('a', ?1, '[]'), ('b', ?2, '[]')",
            params![
                format!("[图片: {}]", first.display()),
                format!("[图片: {}]", second.display())
            ],
        )
        .unwrap();

        assert_eq!(migrate(&conn, &dir).unwrap(), 2);
        let path_of = |id: &str| -> String {
            let text: String = conn
                .query_row("SELECT text FROM backlog WHERE id=?1", [id], |r| r.get(0))
                .unwrap();
            text.trim_start_matches("[图片: ")
                .trim_end_matches(']')
                .to_string()
        };
        let a_path = PathBuf::from(path_of("a"));
        let b_path = PathBuf::from(path_of("b"));
        assert_ne!(a_path, b_path, "each item keeps its own image file");
        assert_eq!(std::fs::read(&a_path).unwrap(), b"AAAA");
        assert_eq!(std::fs::read(&b_path).unwrap(), b"BBBB");
        // Idempotent: a second run changes nothing.
        assert_eq!(migrate(&conn, &dir).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&base);
    }
}
