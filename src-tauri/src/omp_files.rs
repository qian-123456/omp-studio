//! Confined, conflict-checked editing of omp-owned files: memory files under
//! `~/.omp/agent/memories/<slug>/` and rule files (AGENTS.md, RULES.md,
//! APPEND_SYSTEM.md, `rules/*.md`). See docs/ARCHITECTURE.md §7.
//!
//! Every file carries a *stamp* (`<mtime_ns>-<len>`). Writers pass the stamp
//! they loaded; if the file on disk no longer matches, the write is refused
//! with an error starting with [`CONFLICT_PREFIX`] and nothing is touched.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::services::files;

pub const CONFLICT_PREFIX: &str = "CONFLICT:";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StampedText {
    /// `None` = file does not exist.
    pub content: Option<String>,
    pub stamp: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    /// Path relative to the project's memory dir, `/`-separated.
    pub rel: String,
    pub editable: bool,
}

fn stamp_of(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let nanos = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Some(format!("{nanos}-{}", meta.len()))
}

fn read_stamped(path: &Path) -> Result<StampedText, String> {
    if !path.exists() {
        return Ok(StampedText {
            content: None,
            stamp: None,
        });
    }
    let content = files::read_text(path)?;
    Ok(StampedText {
        content: Some(content),
        stamp: stamp_of(path),
    })
}

/// Write only when the on-disk stamp still equals `expected` (`None` = the file
/// must not exist). Returns the new stamp.
fn write_checked(
    path: &Path,
    content: &str,
    expected: Option<&str>,
    create_parents: bool,
) -> Result<Option<String>, String> {
    let current = stamp_of(path);
    if current.as_deref() != expected {
        return Err(format!("{CONFLICT_PREFIX}文件已被 omp 或其他程序更新"));
    }
    if create_parents {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
        }
    }
    files::write_text(path, content)?;
    Ok(stamp_of(path))
}

// ---------------------------------------------------------------- memory ----

fn memories_root() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or("no home dir")?
        .join(".omp")
        .join("agent")
        .join("memories"))
}

/// A single plain path component (no separators, `.`/`..`, NUL).
fn plain_component(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains('\0')
}

/// Whether `rel` is a known memory file shape; `Some(editable)`.
fn classify_memory_rel(rel: &str) -> Option<bool> {
    let parts: Vec<&str> = rel.split('/').collect();
    if !parts.iter().all(|p| plain_component(p)) {
        return None;
    }
    match parts.as_slice() {
        ["memory_summary.md"] | ["MEMORY.md"] => Some(true),
        ["raw_memories.md"] => Some(false),
        ["skills", _, "SKILL.md"] => Some(true),
        ["rollout_summaries", name] if name.ends_with(".md") => Some(false),
        _ => None,
    }
}

/// Resolve `<root>/<slug>/<rel>` and prove it stays inside `root` even through
/// symlinks. The target may be missing; its nearest existing ancestor is checked.
fn confined_memory_path(root: &Path, slug: &str, rel: &str) -> Result<PathBuf, String> {
    if !plain_component(slug) {
        return Err("无效的项目标识".into());
    }
    if classify_memory_rel(rel).is_none() {
        return Err(format!("不支持的记忆文件：{rel}"));
    }
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("无法读取记忆目录：{e}"))?;
    let path = root.join(slug).join(rel);
    let mut probe = path.as_path();
    while !probe.exists() {
        probe = probe.parent().ok_or("invalid path")?;
    }
    let canon = probe.canonicalize().map_err(|e| e.to_string())?;
    if !canon.starts_with(&canon_root) {
        return Err("路径超出记忆目录".into());
    }
    Ok(path)
}

fn list_memory_projects(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(root)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| plain_component(n) && !n.starts_with('.'))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

fn list_memory_files(root: &Path, slug: &str) -> Result<Vec<MemoryFile>, String> {
    if !plain_component(slug) {
        return Err("无效的项目标识".into());
    }
    let dir = root.join(slug);
    let mut out = Vec::new();
    let mut push = |rel: String| {
        if let Some(editable) = classify_memory_rel(&rel) {
            if confined_memory_path(root, slug, &rel).is_ok() {
                out.push(MemoryFile { rel, editable });
            }
        }
    };
    for name in ["memory_summary.md", "MEMORY.md", "raw_memories.md"] {
        if dir.join(name).is_file() {
            push(name.to_string());
        }
    }
    let sub = |d: &str| -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir.join(d))
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v
    };
    for skill in sub("skills") {
        if dir.join("skills").join(&skill).join("SKILL.md").is_file() {
            push(format!("skills/{skill}/SKILL.md"));
        }
    }
    for f in sub("rollout_summaries") {
        if f.ends_with(".md") && dir.join("rollout_summaries").join(&f).is_file() {
            push(format!("rollout_summaries/{f}"));
        }
    }
    Ok(out)
}

fn delete_memory_skill(root: &Path, slug: &str, name: &str) -> Result<(), String> {
    let rel = format!("skills/{name}/SKILL.md");
    let file = confined_memory_path(root, slug, &rel)?;
    if !file.is_file() {
        return Err("技能不存在".into());
    }
    let dir = file.parent().ok_or("invalid path")?;
    std::fs::remove_dir_all(dir).map_err(|e| format!("删除失败：{e}"))
}

#[tauri::command]
pub async fn omp_memory_projects() -> Result<Vec<String>, String> {
    let root = memories_root()?;
    tokio::task::spawn_blocking(move || list_memory_projects(&root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn omp_memory_files(slug: String) -> Result<Vec<MemoryFile>, String> {
    let root = memories_root()?;
    tokio::task::spawn_blocking(move || list_memory_files(&root, &slug))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn omp_memory_read(slug: String, rel: String) -> Result<StampedText, String> {
    let root = memories_root()?;
    tokio::task::spawn_blocking(move || {
        let p = confined_memory_path(&root, &slug, &rel)?;
        read_stamped(&p)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn omp_memory_write(
    slug: String,
    rel: String,
    content: String,
    expected_stamp: Option<String>,
) -> Result<Option<String>, String> {
    let root = memories_root()?;
    tokio::task::spawn_blocking(move || {
        if classify_memory_rel(&rel) != Some(true) {
            return Err("这个文件是只读的".into());
        }
        let p = confined_memory_path(&root, &slug, &rel)?;
        // Memory files are never created from here, only edited in place.
        if !p.is_file() {
            return Err("文件不存在，无法保存".into());
        }
        write_checked(&p, &content, expected_stamp.as_deref(), false)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn omp_memory_delete_skill(slug: String, name: String) -> Result<(), String> {
    let root = memories_root()?;
    tokio::task::spawn_blocking(move || delete_memory_skill(&root, &slug, &name))
        .await
        .map_err(|e| e.to_string())?
}

// ----------------------------------------------------------------- rules ----

/// Only omp rule-file shapes may be read/written through the rule commands:
/// `AGENTS.md`, `RULES.md`, `APPEND_SYSTEM.md`, or `<dir>/rules/<name>.md|.mdc`.
fn check_rule_path(path: &str) -> Result<PathBuf, String> {
    let p = files::resolve(path)?;
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("路径不能包含 ..".into());
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无效路径")?
        .to_string();
    let top = matches!(name.as_str(), "AGENTS.md" | "RULES.md" | "APPEND_SYSTEM.md");
    let in_rules = (name.ends_with(".md") || name.ends_with(".mdc"))
        && p.parent()
            .and_then(|d| d.file_name())
            .is_some_and(|d| d == "rules");
    if !top && !in_rules {
        return Err(format!("不是 omp 规则文件：{name}"));
    }
    Ok(p)
}

#[tauri::command]
pub async fn omp_rule_read(path: String) -> Result<StampedText, String> {
    let p = check_rule_path(&path)?;
    tokio::task::spawn_blocking(move || read_stamped(&p))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn omp_rule_write(
    path: String,
    content: String,
    expected_stamp: Option<String>,
) -> Result<Option<String>, String> {
    let p = check_rule_path(&path)?;
    tokio::task::spawn_blocking(move || {
        write_checked(&p, &content, expected_stamp.as_deref(), true)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- agents ----

/// Only omp sub-agent definition files may go through the agent commands:
/// `<dir>/agents/<name>.md` (global `~/.omp/agent/agents`, project `.omp/agents`).
fn check_agent_path(path: &str) -> Result<PathBuf, String> {
    let p = files::resolve(path)?;
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("路径不能包含 ..".into());
    }
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无效路径")?
        .to_string();
    let in_agents = p
        .parent()
        .and_then(|d| d.file_name())
        .is_some_and(|d| d == "agents");
    if !in_agents || !name.ends_with(".md") || name.starts_with('.') {
        return Err(format!("不是子代理定义文件：{name}"));
    }
    Ok(p)
}

#[tauri::command]
pub async fn omp_agent_read(path: String) -> Result<StampedText, String> {
    let p = check_agent_path(&path)?;
    tokio::task::spawn_blocking(move || read_stamped(&p))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn omp_agent_write(
    path: String,
    content: String,
    expected_stamp: Option<String>,
) -> Result<Option<String>, String> {
    let p = check_agent_path(&path)?;
    tokio::task::spawn_blocking(move || {
        write_checked(&p, &content, expected_stamp.as_deref(), true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = PathBuf::from(format!(
            "/tmp/ompws-test-omp-files/{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn rel_shapes_are_classified() {
        assert_eq!(classify_memory_rel("MEMORY.md"), Some(true));
        assert_eq!(classify_memory_rel("skills/a/SKILL.md"), Some(true));
        assert_eq!(classify_memory_rel("raw_memories.md"), Some(false));
        assert_eq!(classify_memory_rel("rollout_summaries/x.md"), Some(false));
        for bad in [
            "../MEMORY.md",
            "skills/../../x/SKILL.md",
            "/etc/passwd",
            "skills//SKILL.md",
            "skills/a/other.md",
            "rollout_summaries/x.txt",
            "",
        ] {
            assert_eq!(classify_memory_rel(bad), None, "{bad}");
        }
    }

    #[test]
    fn memory_paths_are_confined() {
        let root = tmp("confine");
        std::fs::create_dir_all(root.join("proj")).unwrap();
        assert!(confined_memory_path(&root, "proj", "MEMORY.md").is_ok());
        assert!(confined_memory_path(&root, "..", "MEMORY.md").is_err());
        assert!(confined_memory_path(&root, "a/b", "MEMORY.md").is_err());
        assert!(confined_memory_path(&root, "proj", "../MEMORY.md").is_err());
        // A symlinked slug pointing outside the root is rejected.
        let outside = tmp("outside");
        std::os::unix::fs::symlink(&outside, root.join("evil")).unwrap();
        assert!(confined_memory_path(&root, "evil", "MEMORY.md").is_err());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn lists_files_and_deletes_skill() {
        let root = tmp("list");
        let p = root.join("proj");
        std::fs::create_dir_all(p.join("skills/s1")).unwrap();
        std::fs::create_dir_all(p.join("rollout_summaries")).unwrap();
        std::fs::write(p.join("MEMORY.md"), "m").unwrap();
        std::fs::write(p.join("raw_memories.md"), "r").unwrap();
        std::fs::write(p.join("skills/s1/SKILL.md"), "s").unwrap();
        std::fs::write(p.join("rollout_summaries/a.md"), "a").unwrap();
        std::fs::write(p.join("stray.txt"), "x").unwrap();
        assert_eq!(list_memory_projects(&root), vec!["proj".to_string()]);
        let l = list_memory_files(&root, "proj").unwrap();
        let rels: Vec<_> = l.iter().map(|f| (f.rel.as_str(), f.editable)).collect();
        assert_eq!(
            rels,
            vec![
                ("MEMORY.md", true),
                ("raw_memories.md", false),
                ("skills/s1/SKILL.md", true),
                ("rollout_summaries/a.md", false),
            ]
        );
        assert!(delete_memory_skill(&root, "proj", "..").is_err());
        assert!(delete_memory_skill(&root, "proj", "nope").is_err());
        delete_memory_skill(&root, "proj", "s1").unwrap();
        assert!(!p.join("skills/s1").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn write_detects_external_change() {
        let d = tmp("conflict");
        let f = d.join("RULES.md");
        // Create requires "missing" expectation.
        let s1 = write_checked(&f, "one", None, true).unwrap();
        assert!(s1.is_some());
        // Creating again while expecting missing conflicts.
        let err = write_checked(&f, "x", None, true).unwrap_err();
        assert!(err.starts_with(CONFLICT_PREFIX));
        // Matching stamp writes through and yields a fresh stamp.
        write_checked(&f, "two", s1.as_deref(), true).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "two");
        // External change (different length) is detected; file left alone.
        std::fs::write(&f, "externally longer").unwrap();
        let err = write_checked(&f, "three", s1.as_deref(), true).unwrap_err();
        assert!(err.starts_with(CONFLICT_PREFIX));
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "externally longer");
        // File deleted externally also conflicts.
        std::fs::remove_file(&f).unwrap();
        assert!(write_checked(&f, "x", s1.as_deref(), true)
            .unwrap_err()
            .starts_with(CONFLICT_PREFIX));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn rule_paths_are_restricted() {
        assert!(check_rule_path("/p/.omp/RULES.md").is_ok());
        assert!(check_rule_path("/p/AGENTS.md").is_ok());
        assert!(check_rule_path("/p/.omp/APPEND_SYSTEM.md").is_ok());
        assert!(check_rule_path("/p/.omp/rules/a.md").is_ok());
        assert!(check_rule_path("/p/.omp/rules/a.mdc").is_ok());
        assert!(check_rule_path("/p/.omp/SYSTEM.md").is_err());
        assert!(check_rule_path("/p/.omp/rules/a.txt").is_err());
        assert!(check_rule_path("/p/notrules/a.md").is_err());
        assert!(check_rule_path("/p/../etc/AGENTS.md").is_err());
        assert!(check_rule_path("rules/a.md").is_err());
    }

    #[test]
    fn agent_paths_are_restricted() {
        assert!(check_agent_path("/Users/tester/.omp/agent/agents/scout.md").is_ok());
        assert!(check_agent_path("/p/.omp/agents/reviewer.md").is_ok());
        assert!(check_agent_path("/Users/tester/.omp/agent/agents/my-custom-agent.md").is_ok());
        assert!(check_agent_path("/Users/tester/.omp/agent/agents/../evil.md").is_err());
        assert!(check_agent_path("/Users/tester/.omp/agent/rules/scout.md").is_err());
        assert!(check_agent_path("/Users/tester/.omp/agent/agents/scout.txt").is_err());
        assert!(check_agent_path("/Users/tester/.omp/agent/agents/.hidden.md").is_err());
        assert!(check_agent_path("agents/scout.md").is_err());
    }
}
