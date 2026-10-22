use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use crate::contracts::{ExtensionItem, SkillIssue, SkillItem, SkillProvider, SkillsCatalog};

/// Parses SKILL.md frontmatter for name and description without loading the entire body.
pub fn parse_skill_frontmatter(header: &str, fallback_name: &str) -> (String, String) {
    let mut name = fallback_name.to_string();
    let mut desc = String::new();

    let header = header.trim_start_matches('\u{feff}');
    let lines: Vec<&str> = header.lines().collect();
    let mut idx = 0;
    while idx < lines.len() && lines[idx].trim().is_empty() {
        idx += 1;
    }
    if idx >= lines.len() || lines[idx].trim() != "---" {
        return (name, desc);
    }
    idx += 1;

    let mut in_desc = false;
    let mut desc_lines: Vec<&str> = Vec::new();

    while idx < lines.len() {
        let line = lines[idx];
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }

        if in_desc {
            // Blank lines are paragraph breaks inside a block scalar, not its end.
            if trimmed.is_empty() {
                idx += 1;
                continue;
            }
            if line.starts_with("  ") || line.starts_with('\t') {
                desc_lines.push(trimmed);
                idx += 1;
                continue;
            } else {
                in_desc = false;
            }
        }

        if let Some(rest) = line.strip_prefix("name:") {
            let val = rest.trim().trim_matches(|c| c == '\'' || c == '"').trim();
            if !val.is_empty() {
                name = val.to_string();
            }
        } else if let Some(rest) = line.strip_prefix("description:") {
            let val = rest.trim();
            if val == ">" || val == "|" || val == ">-" || val == "|-" {
                in_desc = true;
                desc_lines.clear();
            } else {
                let clean = val.trim_matches(|c| c == '\'' || c == '"').trim();
                desc_lines.clear();
                desc_lines.push(clean);
            }
        }
        idx += 1;
    }

    if !desc_lines.is_empty() {
        desc = desc_lines.join(" ").trim().to_string();
    }

    (name, desc)
}

/// Parses the disabled extension ids/names from YAML or JSON config text.
/// `None` = the `disabledExtensions` key is absent; `Some(vec![])` = present but empty.
pub fn parse_disabled_extensions_text(text: &str) -> Option<Vec<String>> {
    let mut results = Vec::new();

    // Check JSON structure first
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(arr) = val.get("disabledExtensions").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(s) = item.as_str() {
                    results.push(s.to_string());
                }
            }
            return Some(results);
        }
    }

    // Line-by-line YAML scanning for `disabledExtensions:` block
    let mut present = false;
    let mut in_block = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("disabledExtensions:") {
            present = true;
            in_block = true;
            // Check for inline array: disabledExtensions: ["a", "b"]
            let after = stripped.trim();
            if after.starts_with('[') && after.ends_with(']') {
                let inner = &after[1..after.len() - 1];
                for part in inner.split(',') {
                    let cleaned = part.trim().trim_matches(|c| c == '\'' || c == '"').trim();
                    if !cleaned.is_empty() {
                        results.push(cleaned.to_string());
                    }
                }
                in_block = false;
            }
            continue;
        }

        if in_block {
            if let Some(stripped) = trimmed.strip_prefix('-') {
                let item = stripped
                    .trim()
                    .trim_matches(|c| c == '\'' || c == '"')
                    .trim();
                if !item.is_empty() {
                    results.push(item.to_string());
                }
            } else if !line.starts_with(' ') && !line.starts_with('\t') && !trimmed.is_empty() {
                in_block = false;
            }
        }
    }

    present.then_some(results)
}

/// Lexically normalizes a path (resolving `.` and `..`) without touching the filesystem.
pub fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(p) => normalized.push(Component::Prefix(p)),
            Component::RootDir => normalized.push(Component::RootDir),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(c) => normalized.push(c),
        }
    }
    normalized
}

/// Project-level agent dirs that may hold a `skills` root.
const PROJECT_SKILL_DOTDIRS: [&str; 6] =
    [".omp", ".agents", ".agent", ".claude", ".codex", ".github"];

/// User-level skill discovery roots; the omp ones follow the shared agent dir
/// (`PI_CODING_AGENT_DIR` / profile), the rest live directly under `$HOME`.
pub(crate) fn user_skill_roots() -> Vec<(PathBuf, SkillProvider)> {
    let agent = crate::paths::agent_dir();
    let mut roots = vec![
        (agent.join("skills"), SkillProvider::Native),
        (agent.join("managed-skills"), SkillProvider::Managed),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push((home.join(".agents").join("skills"), SkillProvider::Agents));
        roots.push((home.join(".agent").join("skills"), SkillProvider::Agents));
        roots.push((home.join(".claude").join("skills"), SkillProvider::Claude));
        roots.push((home.join(".codex").join("skills"), SkillProvider::Codex));
    }
    roots
}

/// True when `canonical` (already resolved) lies inside a `<dotdir>/skills`
/// project structure.
fn has_project_skill_structure(canonical: &Path) -> bool {
    let comps: Vec<_> = canonical
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect();
    comps
        .windows(2)
        .any(|w| w[1] == "skills" && PROJECT_SKILL_DOTDIRS.contains(&w[0].as_ref()))
}

/// Checks that the resolved `canonical` file is inside a known skill root and safe to read.
///
/// The decision rests on the resolved path, so a symlink inside a skill cannot
/// point at files outside the roots. The one deliberate exception: a skill
/// directory (direct child of a root) that is itself a symlink — the way users
/// link shared skills in — may be read, but only inside its own resolved target.
pub fn is_path_allowed(raw_path: &Path, canonical: &Path) -> bool {
    if !canonical.is_file() {
        return false;
    }

    // Must be a Markdown file (.md)
    let is_md = canonical
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if !is_md {
        return false;
    }

    let norm = normalize_path(raw_path);
    let inside_skill_dir = |skill_dir: &Path| {
        skill_dir
            .canonicalize()
            .map(|cd| canonical.starts_with(cd))
            .unwrap_or(false)
    };

    for (root, _) in user_skill_roots() {
        if let Ok(canonical_root) = root.canonicalize() {
            if canonical.starts_with(&canonical_root) {
                return true;
            }
        }
        if let Ok(rel) = norm.strip_prefix(&root) {
            if let Some(first) = rel.components().next() {
                if inside_skill_dir(&root.join(first)) {
                    return true;
                }
            }
        }
    }

    // Project roots: `<dotdir>/skills/<skill>/...` on the raw path, with the
    // skill dir resolving around the target.
    let comps: Vec<Component> = norm.components().collect();
    for i in 0..comps.len().saturating_sub(2) {
        let parent = comps[i].as_os_str().to_string_lossy();
        if comps[i + 1].as_os_str() == "skills" && PROJECT_SKILL_DOTDIRS.contains(&parent.as_ref())
        {
            let skill_dir: PathBuf = comps[..i + 3].iter().collect();
            if inside_skill_dir(&skill_dir) {
                return true;
            }
        }
    }

    has_project_skill_structure(canonical)
}

/// Collects roots for project discovery starting at `cwd` and walking up to git repo root or parent limits.
fn collect_project_roots(cwd: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut current = Some(cwd.to_path_buf());
    let mut depth = 0;

    while let Some(dir) = current {
        if depth > 5 {
            break;
        }
        roots.push(dir.clone());
        if dir.join(".git").exists() {
            break;
        }
        current = dir.parent().map(|p| p.to_path_buf());
        depth += 1;
    }

    roots
}

/// Agent Skills spec limit for description length (chars).
const DESCRIPTION_MAX_CHARS: usize = 1024;

/// Number of SKILL.md bytes read for frontmatter parsing.
const SKILL_HEADER_BYTES: usize = 4096;

/// Formats a skill root for display: project roots become `./relative`,
/// user roots abbreviate `$HOME` to `~`.
pub fn display_skill_root(root: &Path, project_base: Option<&Path>) -> String {
    if let Some(base) = project_base {
        if let Ok(rel) = root.strip_prefix(base) {
            return format!("./{}", rel.to_string_lossy());
        }
    }
    let root_str = root.to_string_lossy();
    if let Some(home) = dirs::home_dir() {
        if let Ok(rel) = root.strip_prefix(&home) {
            let rel_str = rel.to_string_lossy();
            return if rel_str.is_empty() {
                "~".to_string()
            } else {
                format!("~/{}", rel_str)
            };
        }
    }
    root_str.to_string()
}

/// Extracts the leading bytes (max SKILL_HEADER_BYTES) of a SKILL.md file.
/// `Err` means open/read failed or the bytes are not valid UTF-8.
fn read_skill_header(skill_md: &Path) -> Result<String, ()> {
    let mut f = File::open(skill_md).map_err(|_| ())?;
    let mut buf = Vec::new();
    f.by_ref()
        .take(SKILL_HEADER_BYTES as u64)
        .read_to_end(&mut buf)
        .map_err(|_| ())?;
    match String::from_utf8(buf) {
        Ok(s) => Ok(s.trim_start_matches('\u{feff}').to_string()),
        // Byte cap landed mid-codepoint: keep the valid prefix, not a failure.
        Err(e) if e.utf8_error().error_len().is_none() => {
            let valid = e.utf8_error().valid_up_to();
            let s = String::from_utf8_lossy(&e.into_bytes()[..valid]).into_owned();
            Ok(s.trim_start_matches('\u{feff}').to_string())
        }
        Err(_) => Err(()),
    }
}

/// True when `dir` directly contains at least one `.md` file.
fn dir_has_markdown(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten().any(|e| {
                let p = e.path();
                p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md"))
            })
        })
        .unwrap_or(false)
}

/// Scans SKILL.md entries from a directory containing skill subdirectories.
/// `index` maps skill name -> position in `skills` for cross-root duplicate
/// counting; `root_display` is the formatted root copied into each item.
pub(crate) fn scan_skills_in_dir(
    root: &Path,
    source: &str,
    provider: SkillProvider,
    index: &mut HashMap<String, usize>,
    skills: &mut Vec<SkillItem>,
    root_display: &str,
) {
    let mut entries: Vec<_> = match std::fs::read_dir(root) {
        Ok(e) => e.flatten().collect(),
        Err(_) => return,
    };
    // read_dir order is arbitrary; sort so duplicate-name winners are stable.
    entries.sort_by_key(|e| e.file_name());

    // Names already attributed to this root, so a duplicate inside the same
    // root does not inflate `copies` (copies counts roots, not entries).
    let mut counted: HashSet<String> = HashSet::new();

    for entry in entries {
        let entry_path = entry.path();
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if dir_name.starts_with('.') {
            continue;
        }

        // Dangling symlink (or symlink to a non-dir): list it as unreadable.
        let dangling =
            entry.file_type().map(|t| t.is_symlink()).unwrap_or(false) && !entry_path.is_dir();
        if !dangling && !entry_path.is_dir() {
            continue;
        }

        let skill_md = entry_path.join("SKILL.md");
        let (name, description, issues) = if dangling {
            (
                dir_name.clone(),
                String::new(),
                vec![SkillIssue::Unreadable],
            )
        } else if !skill_md.is_file() {
            if !dir_has_markdown(&entry_path) {
                continue;
            }
            (
                dir_name.clone(),
                String::new(),
                vec![SkillIssue::MissingSkillMd],
            )
        } else {
            let mut issues = Vec::new();
            let (name, description) = match read_skill_header(&skill_md) {
                // No frontmatter `---` block at all = parse failure.
                Ok(header) if !header.trim_start().starts_with("---") => {
                    issues.push(SkillIssue::Unreadable);
                    (dir_name.clone(), String::new())
                }
                Ok(header) => {
                    let (name, desc) = parse_skill_frontmatter(&header, &dir_name);
                    if desc.is_empty() {
                        issues.push(SkillIssue::MissingDescription);
                    } else if desc.chars().count() > DESCRIPTION_MAX_CHARS {
                        issues.push(SkillIssue::DescriptionTooLong);
                    }
                    (name, desc)
                }
                Err(_) => {
                    issues.push(SkillIssue::Unreadable);
                    (dir_name.clone(), String::new())
                }
            };
            (name, description, issues)
        };

        if let Some(&idx) = index.get(&name) {
            // Later root loses precedence but still counts as a copy.
            if counted.insert(name) {
                skills[idx].copies += 1;
            }
            continue;
        }

        counted.insert(name.clone());
        index.insert(name.clone(), skills.len());
        let prompt_chars = (name.chars().count() + description.chars().count() + 4) as u32;
        skills.push(SkillItem {
            name,
            description,
            source: source.to_string(),
            provider,
            path: skill_md.to_string_lossy().to_string(),
            dir: entry_path.to_string_lossy().to_string(),
            root: root_display.to_string(),
            copies: 1,
            issues,
            prompt_chars,
        });
    }
}

/// Scans extensions in a given root directory.
fn scan_extensions_in_dir(
    root: &Path,
    source: &str,
    disabled: &HashSet<String>,
    seen: &mut HashSet<String>,
    extensions: &mut Vec<ExtensionItem>,
) {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }

        let is_dir = path.is_dir();
        let (ext_name, mut is_disabled) = if is_dir {
            if path.join("index.ts").is_file() || path.join("index.js").is_file() {
                (file_name.clone(), false)
            } else {
                continue;
            }
        } else if file_name.ends_with(".disabled") {
            let stem = file_name.trim_end_matches(".disabled");
            let clean = stem
                .strip_suffix(".ts")
                .or_else(|| stem.strip_suffix(".js"))
                .or_else(|| stem.strip_suffix(".mjs"))
                .or_else(|| stem.strip_suffix(".cjs"))
                .unwrap_or(stem);
            (clean.to_string(), true)
        } else if file_name.ends_with(".ts")
            || file_name.ends_with(".js")
            || file_name.ends_with(".mjs")
            || file_name.ends_with(".cjs")
        {
            let clean = file_name
                .strip_suffix(".ts")
                .or_else(|| file_name.strip_suffix(".js"))
                .or_else(|| file_name.strip_suffix(".mjs"))
                .or_else(|| file_name.strip_suffix(".cjs"))
                .unwrap_or(&file_name);
            (clean.to_string(), false)
        } else {
            continue;
        };

        if ext_name.is_empty() || seen.contains(&ext_name) {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        if !is_disabled
            && (disabled.contains(&ext_name)
                || disabled.contains(&format!("extension-module:{}", ext_name))
                || disabled.contains(&path_str)
                || disabled.contains(&file_name))
        {
            is_disabled = true;
        }

        seen.insert(ext_name.clone());
        extensions.push(ExtensionItem {
            name: ext_name,
            path: path_str,
            source: source.to_string(),
            enabled: !is_disabled,
        });
    }
}

/// Pure resolution of omp's layered `disabledExtensions`: the project layer's
/// list (when the key is present, even empty) replaces the global list.
pub fn resolve_disabled_extensions(
    global_text: Option<&str>,
    project_text: Option<&str>,
) -> HashSet<String> {
    let project = project_text.and_then(parse_disabled_extensions_text);
    let list = project
        .or_else(|| global_text.and_then(parse_disabled_extensions_text))
        .unwrap_or_default();
    list.into_iter().collect()
}

/// Effective `disabledExtensions`: global `config.yml` (legacy `settings.json`
/// only when it doesn't exist), replaced by `<cwd>/.omp/config.yml` when that
/// file defines the key. Ancestor project roots are not consulted (omp joins
/// the session cwd with `.omp` only).
pub fn load_disabled_extensions_from(agent: &Path, cwd: Option<&Path>) -> HashSet<String> {
    let global_text = std::fs::read_to_string(agent.join("config.yml"))
        .ok()
        .or_else(|| std::fs::read_to_string(agent.join("settings.json")).ok());
    let project_text =
        cwd.and_then(|c| std::fs::read_to_string(c.join(".omp").join("config.yml")).ok());
    resolve_disabled_extensions(global_text.as_deref(), project_text.as_deref())
}

fn load_disabled_extensions(cwd: Option<&Path>) -> HashSet<String> {
    load_disabled_extensions_from(&crate::paths::agent_dir(), cwd)
}

/// Tauri command `skills_list`: lists all skills and extensions discovered in project and user roots.
#[tauri::command]
pub async fn skills_list(cwd: Option<String>) -> Result<SkillsCatalog, String> {
    let cwd_path = cwd.as_deref().map(Path::new);
    let disabled = load_disabled_extensions(cwd_path);

    let mut skills = Vec::new();
    let mut extensions = Vec::new();
    let mut seen_extensions = HashSet::new();
    // skill name -> index in `skills` (winner); losers still bump `copies`.
    let mut skill_index: HashMap<String, usize> = HashMap::new();

    // 1. Project discovery (if cwd is provided)
    if let Some(p) = cwd_path {
        for proj_root in collect_project_roots(p) {
            let skill_subdirs = [
                (proj_root.join(".omp").join("skills"), SkillProvider::Native),
                (
                    proj_root.join(".agents").join("skills"),
                    SkillProvider::Agents,
                ),
                (
                    proj_root.join(".agent").join("skills"),
                    SkillProvider::Agents,
                ),
                (
                    proj_root.join(".claude").join("skills"),
                    SkillProvider::Claude,
                ),
                (
                    proj_root.join(".codex").join("skills"),
                    SkillProvider::Codex,
                ),
                (
                    proj_root.join(".github").join("skills"),
                    SkillProvider::Github,
                ),
            ];

            for (root, provider) in &skill_subdirs {
                if root.is_dir() {
                    let root_display = display_skill_root(root, Some(&proj_root));
                    scan_skills_in_dir(
                        root,
                        "project",
                        *provider,
                        &mut skill_index,
                        &mut skills,
                        &root_display,
                    );
                }
            }

            let ext_dir = proj_root.join(".omp").join("extensions");
            if ext_dir.is_dir() {
                scan_extensions_in_dir(
                    &ext_dir,
                    "project",
                    &disabled,
                    &mut seen_extensions,
                    &mut extensions,
                );
            }
        }
    }

    // 2. User discovery (global)
    for (root, provider) in &user_skill_roots() {
        if root.is_dir() {
            let root_display = display_skill_root(root, None);
            scan_skills_in_dir(
                root,
                "user",
                *provider,
                &mut skill_index,
                &mut skills,
                &root_display,
            );
        }
    }

    let user_ext_root = crate::paths::agent_dir().join("extensions");
    if user_ext_root.is_dir() {
        scan_extensions_in_dir(
            &user_ext_root,
            "user",
            &disabled,
            &mut seen_extensions,
            &mut extensions,
        );
    }

    skills.sort_by_key(|a| a.name.to_lowercase());
    extensions.sort_by_key(|a| a.name.to_lowercase());

    Ok(SkillsCatalog { skills, extensions })
}

/// Tauri command `skills_read`: reads the Markdown body of a skill file, strictly restricted to valid skill roots.
#[tauri::command]
pub async fn skills_read(path: String) -> Result<String, String> {
    let raw_path = Path::new(&path);
    let canonical = raw_path
        .canonicalize()
        .map_err(|e| format!("无法定位技能文件：{e}"))?;

    if !canonical.is_file() {
        return Err("指定路径不是文件".to_string());
    }

    let is_md = canonical
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    if !is_md {
        return Err("仅允许读取 Markdown（.md）文件".to_string());
    }

    if !is_path_allowed(raw_path, &canonical) {
        return Err("访问被拒绝：路径超出允许的技能根目录范围".to_string());
    }

    std::fs::read_to_string(&canonical).map_err(|e| format!("读取技能内容失败：{e}"))
}

/// Validates that `dir` is a direct child of a known skill root and exists.
///
/// Deliberately does NOT canonicalize `dir` itself: a dangling symlink must
/// still be trashable (the link is trashed, never its target). Instead the
/// path is normalized lexically and its parent must be exactly one of the
/// known user skill roots or a `<x>/.omp|.agents|.agent|.claude|.codex|.github/skills`
/// project root — i.e. only whole skill directories one level below a
/// discovery root may be trashed, never a root itself or a nested path.
///
/// Returns the normalized path ready for `trash::delete`.
pub(crate) fn validate_skill_dir_for_trash(dir: &Path) -> Result<PathBuf, String> {
    if !dir.is_absolute() {
        return Err("删除需要绝对路径".to_string());
    }

    let norm = normalize_path(dir);

    let file_name = norm.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if file_name.is_empty() || file_name == "." || file_name == ".." {
        return Err("无效的技能目录名".to_string());
    }

    let parent = norm
        .parent()
        .ok_or_else(|| "无法确定技能目录的父目录".to_string())?;

    // Parent must be exactly a known skill root — same list as `is_path_allowed`.
    let mut allowed = false;
    for (root, _) in user_skill_roots() {
        // Compare both the lexical root and its canonical form: on macOS
        // $HOME can sit behind /System/Volumes/Data symlinks and the
        // caller may hand us either spelling.
        if parent == root.as_path()
            || root
                .canonicalize()
                .is_ok_and(|canonical_root| parent == canonical_root.as_path())
        {
            allowed = true;
            break;
        }
    }
    if !allowed {
        // Project skill root: parent itself is `<x>/<dotdir>/skills`.
        allowed = is_project_skill_root(parent);
    }
    if !allowed {
        return Err("拒绝删除：目录必须直接位于已知的技能根目录之下".to_string());
    }

    // symlink_metadata follows no links: the entry must exist (a symlink to a
    // missing target still counts) and a symlink is trashed as the link itself.
    std::fs::symlink_metadata(&norm).map_err(|e| format!("无法定位技能目录：{e}"))?;

    Ok(norm)
}

/// True when `p` ends in `<dotdir>/skills` where `dotdir` is a project agent dir.
fn is_project_skill_root(p: &Path) -> bool {
    let mut comps = p.components().rev();
    let Some(last) = comps.next() else {
        return false;
    };
    let Some(prev) = comps.next() else {
        return false;
    };
    let last = last.as_os_str().to_string_lossy();
    let prev = prev.as_os_str().to_string_lossy();
    last == "skills"
        && matches!(
            prev.as_ref(),
            ".omp" | ".agents" | ".agent" | ".claude" | ".codex" | ".github"
        )
}

/// Tauri command `skills_trash`: moves a whole skill directory to the OS Trash.
///
/// Only directories validated by `validate_skill_dir_for_trash` are touched —
/// a direct child of a known skill root. On macOS this goes through
/// `NSFileManager trashItemAtURL` (no Finder automation prompt) and the item
/// can be restored from the Trash.
#[tauri::command]
pub async fn skills_trash(dir: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = validate_skill_dir_for_trash(Path::new(&dir))?;
        trash::delete(&path).map_err(|e| format!("移到废纸篓失败：{e}"))
    })
    .await
    .map_err(|e| format!("移到废纸篓失败：{e}"))?
}

/// Validates re-enabling a `.disabled` extension file and returns the target path.
/// Pure filesystem check: catalog membership is verified by the command.
pub(crate) fn enabled_extension_target(path: &Path) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无效的扩展路径".to_string())?;
    let enabled_name = match name.strip_suffix(".disabled") {
        Some(n) if !n.is_empty() => n,
        _ => return Err("该扩展不是通过 .disabled 后缀停用的，无法重命名启用".to_string()),
    };
    if !path.is_file() {
        return Err("扩展文件不存在".to_string());
    }
    let target = path.with_file_name(enabled_name);
    if target.exists() {
        return Err(format!("同名扩展文件已存在，无法启用：{enabled_name}"));
    }
    Ok(target)
}

/// Tauri command `extension_enable_file`: renames `<name>.<ext>.disabled` back to
/// `<name>.<ext>`. `path` must be an extension `skills_list(cwd)` reports.
#[tauri::command]
pub async fn extension_enable_file(cwd: Option<String>, path: String) -> Result<(), String> {
    let catalog = skills_list(cwd).await?;
    if !catalog.extensions.iter().any(|e| e.path == path) {
        return Err("该路径不是已发现的扩展模块，已拒绝启用".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let from = Path::new(&path);
        let target = enabled_extension_target(from)?;
        std::fs::rename(from, target).map_err(|e| format!("启用扩展失败：{e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
