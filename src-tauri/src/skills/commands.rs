use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use crate::contracts::{ExtensionItem, SkillItem, SkillsCatalog};

/// Parses SKILL.md frontmatter for name and description without loading the entire body.
pub fn parse_skill_frontmatter(header: &str, fallback_name: &str) -> (String, String) {
    let mut name = fallback_name.to_string();
    let mut desc = String::new();

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

/// Parses a list of disabled extension ids/names from YAML or JSON config text.
pub fn parse_disabled_extensions_text(text: &str) -> Vec<String> {
    let mut results = Vec::new();

    // Check JSON structure first
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(arr) = val.get("disabledExtensions").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(s) = item.as_str() {
                    results.push(s.to_string());
                }
            }
            return results;
        }
    }

    // Line-by-line YAML scanning for `disabledExtensions:` block
    let mut in_block = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("disabledExtensions:") {
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

    results
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

/// Checks if a path is inside known skill roots and safe to read.
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

    // List of standard user home roots
    if let Some(home) = dirs::home_dir() {
        let user_roots = [
            home.join(".omp").join("agent").join("skills"),
            home.join(".omp").join("agent").join("managed-skills"),
            home.join(".agents").join("skills"),
            home.join(".agent").join("skills"),
            home.join(".claude").join("skills"),
            home.join(".codex").join("skills"),
        ];

        for root in &user_roots {
            if norm.starts_with(root) {
                return true;
            }
            if let Ok(canonical_root) = root.canonicalize() {
                if canonical.starts_with(&canonical_root) {
                    return true;
                }
            }
        }
    }

    // Check project skill directories (containing `skills` preceded by `.omp`, `.agents`, etc.)
    fn has_project_skill_structure(p: &Path) -> bool {
        let comps: Vec<_> = p
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect();
        for i in 0..comps.len().saturating_sub(1) {
            let parent = comps[i].as_ref();
            let child = comps[i + 1].as_ref();
            if (parent == ".omp"
                || parent == ".agents"
                || parent == ".agent"
                || parent == ".claude"
                || parent == ".codex"
                || parent == ".github")
                && child == "skills"
            {
                return true;
            }
        }
        false
    }

    if has_project_skill_structure(&norm) || has_project_skill_structure(canonical) {
        return true;
    }

    false
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

/// Scans SKILL.md entries from a directory containing skill subdirectories.
fn scan_skills_in_dir(
    root: &Path,
    source: &str,
    seen: &mut HashSet<String>,
    skills: &mut Vec<SkillItem>,
) {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let skill_md = entry_path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }

        let dir_name = entry.file_name().to_string_lossy().to_string();
        if dir_name.starts_with('.') {
            continue;
        }

        // Read up to 4096 bytes for frontmatter parsing
        let mut header = String::new();
        if let Ok(mut f) = File::open(&skill_md) {
            let mut buf = [0u8; 4096];
            if let Ok(n) = f.read(&mut buf) {
                header = String::from_utf8_lossy(&buf[..n]).to_string();
            }
        }

        let (name, description) = parse_skill_frontmatter(&header, &dir_name);
        if seen.contains(&name) {
            continue;
        }

        seen.insert(name.clone());
        skills.push(SkillItem {
            name,
            description,
            source: source.to_string(),
            path: skill_md.to_string_lossy().to_string(),
            dir: entry_path.to_string_lossy().to_string(),
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

/// Discovers disabled extensions by reading global and project config files.
fn load_disabled_extensions(cwd: Option<&Path>) -> HashSet<String> {
    let mut disabled = HashSet::new();

    let mut candidate_files = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidate_files.push(home.join(".omp").join("agent").join("config.yml"));
        candidate_files.push(home.join(".omp").join("agent").join("settings.json"));
    }

    if let Some(cwd_path) = cwd {
        for project_dir in collect_project_roots(cwd_path) {
            candidate_files.push(project_dir.join(".omp").join("config.yml"));
            candidate_files.push(project_dir.join(".omp").join("settings.json"));
        }
    }

    for file_path in candidate_files {
        if let Ok(text) = std::fs::read_to_string(&file_path) {
            for id in parse_disabled_extensions_text(&text) {
                disabled.insert(id);
            }
        }
    }

    disabled
}

/// Tauri command `skills_list`: lists all skills and extensions discovered in project and user roots.
#[tauri::command]
pub async fn skills_list(cwd: Option<String>) -> Result<SkillsCatalog, String> {
    let cwd_path = cwd.as_deref().map(Path::new);
    let disabled = load_disabled_extensions(cwd_path);

    let mut skills = Vec::new();
    let mut extensions = Vec::new();
    let mut seen_skills = HashSet::new();
    let mut seen_extensions = HashSet::new();

    // 1. Project discovery (if cwd is provided)
    if let Some(p) = cwd_path {
        for proj_root in collect_project_roots(p) {
            let skill_subdirs = [
                proj_root.join(".omp").join("skills"),
                proj_root.join(".agents").join("skills"),
                proj_root.join(".agent").join("skills"),
                proj_root.join(".claude").join("skills"),
                proj_root.join(".codex").join("skills"),
                proj_root.join(".github").join("skills"),
            ];

            for root in &skill_subdirs {
                if root.is_dir() {
                    scan_skills_in_dir(root, "project", &mut seen_skills, &mut skills);
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
    if let Some(home) = dirs::home_dir() {
        let user_skill_roots = [
            home.join(".omp").join("agent").join("skills"),
            home.join(".omp").join("agent").join("managed-skills"),
            home.join(".agents").join("skills"),
            home.join(".agent").join("skills"),
            home.join(".claude").join("skills"),
            home.join(".codex").join("skills"),
        ];

        for root in &user_skill_roots {
            if root.is_dir() {
                scan_skills_in_dir(root, "user", &mut seen_skills, &mut skills);
            }
        }

        let user_ext_root = home.join(".omp").join("agent").join("extensions");
        if user_ext_root.is_dir() {
            scan_extensions_in_dir(
                &user_ext_root,
                "user",
                &disabled,
                &mut seen_extensions,
                &mut extensions,
            );
        }
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

    if !is_path_allowed(raw_path, &canonical) {
        return Err("访问被拒绝：路径超出允许的技能根目录范围".to_string());
    }

    std::fs::read_to_string(&canonical).map_err(|e| format!("读取技能内容失败：{e}"))
}
