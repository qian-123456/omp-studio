use std::path::{Path, PathBuf};

use std::collections::HashMap;

use super::commands::{
    display_skill_root, is_path_allowed, normalize_path, parse_disabled_extensions_text,
    parse_skill_frontmatter, scan_skills_in_dir,
};
use super::usage::{classify_line, scan_sessions_for_test};
use crate::contracts::{SkillIssue, SkillItem};

#[test]
fn test_parse_frontmatter_standard() {
    let header = r#"---
name: eli5
description: Explain a topic like I'm a 5 year old.
---
# eli5 body
"#;
    let (name, desc) = parse_skill_frontmatter(header, "default-dir");
    assert_eq!(name, "eli5");
    assert_eq!(desc, "Explain a topic like I'm a 5 year old.");
}

#[test]
fn test_parse_frontmatter_multiline_folded() {
    let header = r#"---
name: ego-browser
description: >
  When you need a browser, read this Skill by default.
  Use it to open and operate websites.
---
# ego-browser body
"#;
    let (name, desc) = parse_skill_frontmatter(header, "ego-browser");
    assert_eq!(name, "ego-browser");
    assert_eq!(
        desc,
        "When you need a browser, read this Skill by default. Use it to open and operate websites."
    );
}

#[test]
fn test_parse_frontmatter_multiline_literal() {
    let header = r#"---
name: multi-lit
description: |
  Line 1 of description
  Line 2 of description
---
"#;
    let (name, desc) = parse_skill_frontmatter(header, "fallback");
    assert_eq!(name, "multi-lit");
    assert_eq!(desc, "Line 1 of description Line 2 of description");
}

#[test]
fn test_parse_frontmatter_missing_name_uses_fallback() {
    let header = r#"---
description: A skill without explicit name
---
"#;
    let (name, desc) = parse_skill_frontmatter(header, "my-fallback-folder");
    assert_eq!(name, "my-fallback-folder");
    assert_eq!(desc, "A skill without explicit name");
}

#[test]
fn test_parse_frontmatter_quotes_and_spacing() {
    let header = r#"---
name: "quoted-skill"
description: 'Single quoted description with extra spaces'
---
"#;
    let (name, desc) = parse_skill_frontmatter(header, "default");
    assert_eq!(name, "quoted-skill");
    assert_eq!(desc, "Single quoted description with extra spaces");
}

#[test]
fn test_parse_frontmatter_no_delimiters() {
    let header = "# Just markdown\nNo frontmatter here.";
    let (name, desc) = parse_skill_frontmatter(header, "plain");
    assert_eq!(name, "plain");
    assert_eq!(desc, "");
}

#[test]
fn test_parse_disabled_extensions_yaml() {
    let yaml = r#"
modelRoles:
  default: devin
disabledExtensions:
  - session-autoname
  - otty-integration
providers:
  foo: bar
"#;
    let disabled = parse_disabled_extensions_text(yaml);
    assert_eq!(disabled, vec!["session-autoname", "otty-integration"]);
}

#[test]
fn test_parse_disabled_extensions_inline_yaml() {
    let yaml = r#"disabledExtensions: ["ext1", "ext2"]"#;
    let disabled = parse_disabled_extensions_text(yaml);
    assert_eq!(disabled, vec!["ext1", "ext2"]);
}

#[test]
fn test_parse_disabled_extensions_json() {
    let json = r#"{"disabledExtensions": ["foo-ext", "bar-ext"]}"#;
    let disabled = parse_disabled_extensions_text(json);
    assert_eq!(disabled, vec!["foo-ext", "bar-ext"]);
}

#[test]
fn test_normalize_path_resolves_dot_dot() {
    let path = PathBuf::from("/a/b/../c/./d");
    let norm = normalize_path(&path);
    assert_eq!(norm, PathBuf::from("/a/c/d"));
}

#[test]
fn test_path_restriction_rejects_arbitrary_files() {
    let etc_passwd = Path::new("/etc/passwd");
    if etc_passwd.exists() {
        assert!(!is_path_allowed(etc_passwd, etc_passwd));
    }

    let fake_txt = Path::new("/tmp/test.txt");
    assert!(!is_path_allowed(fake_txt, fake_txt));
}

#[test]
fn test_path_restriction_rejects_traversal_attempts() {
    if let Some(home) = dirs::home_dir() {
        let traversal = home.join(".omp/agent/skills/../../.ssh/id_rsa");
        let norm = normalize_path(&traversal);
        assert!(!is_path_allowed(&traversal, &norm));
    }
}

#[test]
fn test_path_restriction_accepts_project_skills() {
    let temp_dir = std::env::temp_dir();
    let project_skill_dir = temp_dir
        .join("test_proj")
        .join(".omp")
        .join("skills")
        .join("sample");
    let skill_file = project_skill_dir.join("SKILL.md");

    // Create temporary skill file for testing
    let _ = std::fs::create_dir_all(&project_skill_dir);
    let _ = std::fs::write(&skill_file, "---\nname: sample\n---\n# Sample");

    if let Ok(canonical) = skill_file.canonicalize() {
        assert!(is_path_allowed(&skill_file, &canonical));
    }

    // Clean up
    let _ = std::fs::remove_file(&skill_file);
    let _ = std::fs::remove_dir_all(temp_dir.join("test_proj"));
}

// ---- usage line classifier ----

#[test]
fn test_classify_tool_call_read_skill_uri() {
    let line = r#"{"type":"message","timestamp":"2026-09-28T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"read","arguments":{"path":"skill://ego-browser","i":"x"}}]}}"#;
    let (names, ts) = classify_line(line, 0).expect("should classify");
    assert_eq!(names, vec!["ego-browser".to_string()]);
    assert!(ts > 0);
}

#[test]
fn test_classify_ignores_plain_text_skill_mentions() {
    // System prompt / thinking text mentioning skill:// must not count.
    let line = r#"{"type":"message","timestamp":"2026-09-28T10:00:00.000Z","message":{"role":"system","content":[{"type":"text","text":"read skill://ego-browser then skill://wrangler"}]}}"#;
    assert!(classify_line(line, 0).is_none());
}

#[test]
fn test_classify_ignores_tool_execution_start_mirror() {
    // `custom` tool_execution_start mirrors the toolCall args; counting it
    // would double every trigger.
    let line = r#"{"type":"custom","customType":"tool_execution_start","timestamp":"2026-09-28T10:00:00.000Z","data":{"toolName":"read","args":{"path":"skill://obsidian-vault"}}}"#;
    assert!(classify_line(line, 0).is_none());
}

#[test]
fn test_classify_ignores_non_read_tool_call() {
    let line = r#"{"type":"message","timestamp":"2026-09-28T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{"command":"cat skill://ego-browser"}}]}}"#;
    assert!(classify_line(line, 0).is_none());
}

#[test]
fn test_classify_skill_uri_subpath_uses_head() {
    let line = r#"{"type":"message","timestamp":"2026-09-28T10:00:00.000Z","message":{"role":"assistant","content":[{"type":"toolCall","name":"read","arguments":{"path":"skill://ego-browser/references/install.md"}}]}}"#;
    let (names, _) = classify_line(line, 0).expect("should classify");
    assert_eq!(names, vec!["ego-browser".to_string()]);
}

#[test]
fn test_classify_user_skill_prompt() {
    let line = r#"{"type":"custom_message","customType":"skill-prompt","timestamp":"2026-09-28T10:00:00.000Z","details":{"name":"grill-me","path":"/home/u/.omp/agent/skills/grill-me/SKILL.md","prompt":"/skill:grill-me grill me"}}"#;
    let (names, _) = classify_line(line, 0).expect("should classify");
    assert_eq!(names, vec!["grill-me".to_string()]);
}

#[test]
fn test_classify_line_without_timestamp_uses_fallback() {
    let line = r#"{"type":"message","message":{"content":[{"type":"toolCall","name":"read","arguments":{"path":"skill://wrangler"}}]}}"#;
    let (names, ts) = classify_line(line, 4242).expect("should classify");
    assert_eq!(names, vec!["wrangler".to_string()]);
    assert_eq!(ts, 4242);
}

// ---- scan_sessions aggregation ----

fn fresh_test_dir(tag: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("ompws-skills-test-{}-{}", std::process::id(), tag));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn test_scan_sessions_window_and_nested_dirs() {
    let base = fresh_test_dir("usage");
    // Subagent sessions live in nested dirs with spaces.
    let nested = base.join("sess dir").join("sub agent");
    std::fs::create_dir_all(&nested).unwrap();

    let recent = r#"{"type":"message","timestamp":"2999-01-01T00:00:00.000Z","message":{"content":[{"type":"toolCall","name":"read","arguments":{"path":"skill://hot"}}]}}"#;
    let old = r#"{"type":"message","timestamp":"2020-01-01T00:00:00.000Z","message":{"content":[{"type":"toolCall","name":"read","arguments":{"path":"skill://cold"}}]}}"#;
    // No timestamp -> falls back to file mtime (now, inside window).
    let no_ts = r#"{"type":"message","message":{"content":[{"type":"toolCall","name":"read","arguments":{"path":"skill://mtime-fallback"}}]}}"#;
    std::fs::write(
        nested.join("a.jsonl"),
        format!("{recent}\n{old}\n{no_ts}\n"),
    )
    .unwrap();

    let report = scan_sessions_for_test(&base, 45);
    assert_eq!(report.days, 45);
    assert_eq!(report.scanned_files, 1);
    assert_eq!(report.total_triggers, 2);
    let names: Vec<&str> = report.usage.iter().map(|u| u.name.as_str()).collect();
    assert!(names.contains(&"hot"));
    assert!(names.contains(&"mtime-fallback"));
    assert!(!names.contains(&"cold"), "old timestamp must be filtered");
    assert!(report.usage[0].last_used_at.is_some());

    let _ = std::fs::remove_dir_all(&base);
}

// ---- skill scanning: copies + issues ----

fn write_skill(root: &Path, dir_name: &str, header: &str) {
    let dir = root.join(dir_name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("SKILL.md"), header).unwrap();
}

#[test]
fn test_skill_copies_count_losing_roots() {
    let base = fresh_test_dir("copies");
    let root_a = base.join("a").join(".omp").join("skills");
    let root_b = base.join("b").join(".claude").join("skills");
    write_skill(
        &root_a,
        "dup",
        "---\nname: dup\ndescription: first wins\n---\n",
    );
    write_skill(&root_b, "dup", "---\nname: dup\ndescription: loser\n---\n");
    write_skill(
        &root_b,
        "solo",
        "---\nname: solo\ndescription: only here\n---\n",
    );

    let mut index: HashMap<String, usize> = HashMap::new();
    let mut skills: Vec<SkillItem> = Vec::new();
    let display_a = display_skill_root(&root_a, Some(&base.join("a")));
    let display_b = display_skill_root(&root_b, Some(&base.join("b")));
    assert_eq!(display_a, "./.omp/skills");
    assert_eq!(display_b, "./.claude/skills");

    scan_skills_in_dir(&root_a, "project", &mut index, &mut skills, &display_a);
    scan_skills_in_dir(&root_b, "user", &mut index, &mut skills, &display_b);

    assert_eq!(skills.len(), 2);
    let dup = skills.iter().find(|s| s.name == "dup").unwrap();
    assert_eq!(dup.copies, 2);
    assert_eq!(dup.description, "first wins", "precedence: first root wins");
    assert_eq!(dup.source, "project");
    assert_eq!(dup.root, "./.omp/skills");
    let solo = skills.iter().find(|s| s.name == "solo").unwrap();
    assert_eq!(solo.copies, 1);

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn test_skill_issues_and_prompt_chars() {
    let base = fresh_test_dir("issues");
    let root = base.join(".omp").join("skills");
    // missing description
    write_skill(&root, "nodesc", "---\nname: nodesc\n---\nbody\n");
    // description too long (> 1024 chars)
    let long_desc = "x".repeat(1100);
    write_skill(
        &root,
        "toolong",
        &format!("---\nname: toolong\ndescription: {long_desc}\n---\n"),
    );
    // healthy
    write_skill(&root, "fine", "---\nname: fine\ndescription: ok\n---\n");

    let mut index: HashMap<String, usize> = HashMap::new();
    let mut skills: Vec<SkillItem> = Vec::new();
    scan_skills_in_dir(&root, "project", &mut index, &mut skills, "./.omp/skills");

    let nodesc = skills.iter().find(|s| s.name == "nodesc").unwrap();
    assert_eq!(nodesc.issues, vec![SkillIssue::MissingDescription]);
    let toolong = skills.iter().find(|s| s.name == "toolong").unwrap();
    assert_eq!(toolong.issues, vec![SkillIssue::DescriptionTooLong]);
    let fine = skills.iter().find(|s| s.name == "fine").unwrap();
    assert!(fine.issues.is_empty());
    // promptChars = name.chars + description.chars + 4
    assert_eq!(fine.prompt_chars, 4 + 2 + 4);

    let _ = std::fs::remove_dir_all(&base);
}

#[cfg(unix)]
#[test]
fn test_skill_dangling_symlink_is_unreadable() {
    use std::os::unix::fs::symlink;

    let base = fresh_test_dir("dangling");
    let root = base.join(".omp").join("skills");
    std::fs::create_dir_all(&root).unwrap();
    symlink(base.join("does-not-exist"), root.join("broken-skill")).unwrap();
    write_skill(&root, "real", "---\nname: real\ndescription: ok\n---\n");

    let mut index: HashMap<String, usize> = HashMap::new();
    let mut skills: Vec<SkillItem> = Vec::new();
    scan_skills_in_dir(&root, "project", &mut index, &mut skills, "./.omp/skills");

    let broken = skills
        .iter()
        .find(|s| s.name == "broken-skill")
        .expect("dangling symlink should be listed");
    assert_eq!(broken.issues, vec![SkillIssue::Unreadable]);
    assert!(broken.description.is_empty());

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn test_skill_unreadable_frontmatter() {
    let base = fresh_test_dir("nofrontmatter");
    let root = base.join(".omp").join("skills");
    // SKILL.md exists but has no frontmatter block at all.
    write_skill(&root, "bare", "# just markdown\n");

    let mut index: HashMap<String, usize> = HashMap::new();
    let mut skills: Vec<SkillItem> = Vec::new();
    scan_skills_in_dir(&root, "project", &mut index, &mut skills, "./.omp/skills");

    let bare = skills.iter().find(|s| s.name == "bare").unwrap();
    assert_eq!(bare.issues, vec![SkillIssue::Unreadable]);

    let _ = std::fs::remove_dir_all(&base);
}
