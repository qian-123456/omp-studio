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
/// Same name + same size is treated as already copied (idempotent);
/// a clashing different file gets a size suffix.
fn copy_stable(src: &Path, dir: &Path) -> std::io::Result<PathBuf> {
    let name = src
        .file_name()
        .ok_or_else(|| std::io::Error::other("no file name"))?;
    let len = std::fs::metadata(src)?.len();
    let mut dest = dir.join(name);
    if let Ok(m) = std::fs::metadata(&dest) {
        if m.len() == len {
            return Ok(dest);
        }
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("img");
        let file = match src.extension().and_then(|e| e.to_str()) {
            Some(ext) => format!("{stem}-{len}.{ext}"),
            None => format!("{stem}-{len}"),
        };
        dest = dir.join(file);
        if dest.exists() {
            return Ok(dest);
        }
    }
    std::fs::copy(src, &dest)?;
    Ok(dest)
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
}
