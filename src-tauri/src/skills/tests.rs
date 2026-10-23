use std::path::{Path, PathBuf};

use std::collections::HashMap;

use super::commands::{
    display_skill_root, enabled_extension_target, is_path_allowed, load_disabled_extensions_from,
    normalize_path, parse_disabled_extensions_text, parse_skill_frontmatter,
    resolve_disabled_extensions, scan_skills_in_dir, validate_skill_dir_for_trash,
};
use super::usage::{classify_line, scan_sessions_for_test};
use crate::contracts::{SkillIssue, SkillItem, SkillProvider};

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
    let disabled = parse_disabled_extensions_text(yaml).unwrap();
    assert_eq!(disabled, vec!["session-autoname", "otty-integration"]);
}

#[test]
fn test_parse_disabled_extensions_inline_yaml() {
    let yaml = r#"disabledExtensions: ["ext1", "ext2"]"#;
    let disabled = parse_disabled_extensions_text(yaml).unwrap();
    assert_eq!(disabled, vec!["ext1", "ext2"]);
}

#[test]
fn test_parse_disabled_extensions_json() {
    let json = r#"{"disabledExtensions": ["foo-ext", "bar-ext"]}"#;
    let disabled = parse_disabled_extensions_text(json).unwrap();
    assert_eq!(disabled, vec!["foo-ext", "bar-ext"]);
}

#[test]
fn test_parse_disabled_extensions_absent_vs_empty() {
    assert_eq!(
        parse_disabled_extensions_text("skills:\n  enabled: true\n"),
        None
    );
    assert_eq!(
        parse_disabled_extensions_text("disabledExtensions: []\n"),
        Some(vec![])
    );
    assert_eq!(
        parse_disabled_extensions_text("disabledExtensions:\nx: 1\n"),
        Some(vec![])
    );
    assert_eq!(
        parse_disabled_extensions_text(r#"{"disabledExtensions": []}"#),
        Some(vec![])
    );
}

fn set(items: &[&str]) -> std::collections::HashSet<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn test_disabled_extensions_project_replaces_global() {
    let global = "disabledExtensions:\n  - a\n  - b\n";
    let project = "disabledExtensions:\n  - c\n";
    assert_eq!(
        resolve_disabled_extensions(Some(global), Some(project)),
        set(&["c"])
    );
}

#[test]
fn test_disabled_extensions_empty_project_reenables() {
    let global = "disabledExtensions: [a, b]\n";
    let project = "disabledExtensions: []\n";
    assert_eq!(
        resolve_disabled_extensions(Some(global), Some(project)),
        set(&[])
    );
}

#[test]
fn test_disabled_extensions_absent_key_inherits_global() {
    let global = "disabledExtensions: [a, b]\n";
    let project = "skills:\n  enabled: true\n";
    assert_eq!(
        resolve_disabled_extensions(Some(global), Some(project)),
        set(&["a", "b"])
    );
    assert_eq!(
        resolve_disabled_extensions(Some(global), None),
        set(&["a", "b"])
    );
}

#[test]
fn test_disabled_extensions_ancestor_project_config_ignored() {
    let root = std::env::temp_dir().join(format!("ompws-dis-ext-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let agent = root.join("agent");
    let parent = root.join("proj");
    let child = parent.join("child");
    std::fs::create_dir_all(&agent).unwrap();
    std::fs::create_dir_all(parent.join(".omp")).unwrap();
    std::fs::create_dir_all(&child).unwrap();
    std::fs::write(agent.join("config.yml"), "disabledExtensions: [g]\n").unwrap();
    std::fs::write(
        parent.join(".omp/config.yml"),
        "disabledExtensions: [anc]\n",
    )
    .unwrap();
    assert_eq!(
        load_disabled_extensions_from(&agent, Some(&child)),
        set(&["g"])
    );
    assert_eq!(
        load_disabled_extensions_from(&agent, Some(&parent)),
        set(&["anc"])
    );
    let _ = std::fs::remove_dir_all(&root);
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

#[test]
fn test_scan_sessions_incremental_resumes_after_append() {
    use super::usage::scan_sessions_with_cache_for_test;
    use std::io::Write;

    let base = fresh_test_dir("usage-incr");
    let line = |n: &str| {
        format!(
            r#"{{"type":"message","timestamp":"2999-01-01T00:00:00.000Z","message":{{"content":[{{"type":"toolCall","name":"read","arguments":{{"path":"skill://{n}"}}}}]}}}}"#
        )
    };
    let file = base.join("a.jsonl");
    std::fs::write(&file, format!("{}\n", line("one"))).unwrap();

    let mut cache = Default::default();
    let r1 = scan_sessions_with_cache_for_test(&base, 45, &mut cache);
    assert_eq!(r1.total_triggers, 1);

    // Append one full line plus a partial (still being written) line.
    let partial = line("three");
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(&file)
        .unwrap();
    write!(f, "{}\n{}", line("two"), &partial[..20]).unwrap();
    drop(f);
    let r2 = scan_sessions_with_cache_for_test(&base, 45, &mut cache);
    assert_eq!(
        r2.total_triggers, 2,
        "no double count, partial line ignored"
    );

    // Finish the partial line: it is counted exactly once.
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(&file)
        .unwrap();
    writeln!(f, "{}", &partial[20..]).unwrap();
    drop(f);
    let r3 = scan_sessions_with_cache_for_test(&base, 45, &mut cache);
    assert_eq!(r3.total_triggers, 3);

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

    scan_skills_in_dir(
        &root_a,
        "project",
        SkillProvider::Native,
        &mut index,
        &mut skills,
        &display_a,
    );
    scan_skills_in_dir(
        &root_b,
        "user",
        SkillProvider::Claude,
        &mut index,
        &mut skills,
        &display_b,
    );

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
    scan_skills_in_dir(
        &root,
        "project",
        SkillProvider::Native,
        &mut index,
        &mut skills,
        "./.omp/skills",
    );

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
    scan_skills_in_dir(
        &root,
        "project",
        SkillProvider::Native,
        &mut index,
        &mut skills,
        "./.omp/skills",
    );

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
    scan_skills_in_dir(
        &root,
        "project",
        SkillProvider::Native,
        &mut index,
        &mut skills,
        "./.omp/skills",
    );

    let bare = skills.iter().find(|s| s.name == "bare").unwrap();
    assert_eq!(bare.issues, vec![SkillIssue::Unreadable]);

    let _ = std::fs::remove_dir_all(&base);
}

// ---- skills_trash validation ----

#[test]
fn test_trash_validation_accepts_project_skill_dir() {
    let base = fresh_test_dir("trash-proj");
    let skills_root = base.join("proj").join(".omp").join("skills");
    write_skill(
        &skills_root,
        "my-skill",
        "---\nname: my-skill\ndescription: ok\n---\n",
    );

    let skill_dir = skills_root.join("my-skill");
    let validated = validate_skill_dir_for_trash(&skill_dir).unwrap();
    assert_eq!(validated, skill_dir);

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn test_trash_validation_accepts_user_root_shape() {
    let Some(home) = dirs::home_dir() else {
        return; // no HOME in this environment — nothing to assert
    };
    // A direct child of a user skill root passes the shape check; a
    // nonexistent name fails only at the existence check, proving the parent
    // was accepted.
    let skill_dir = home
        .join(".omp")
        .join("agent")
        .join("skills")
        .join("ompws-nonexistent-skill-dir");
    let err = validate_skill_dir_for_trash(&skill_dir).unwrap_err();
    assert!(
        err.contains("无法定位技能目录"),
        "expected existence failure, got: {err}"
    );
    // A name NOT under a skill root is rejected by the shape check first.
    let outside = home.join(".omp").join("skills").join("anything");
    assert!(validate_skill_dir_for_trash(&outside).is_err());
}

#[test]
fn test_trash_validation_rejects_root_nested_and_traversal() {
    let base = fresh_test_dir("trash-reject");
    let root = base.join("proj").join(".omp").join("skills");
    write_skill(&root, "a", "---\nname: a\ndescription: ok\n---\n");

    // The skill root itself must never be trashable.
    assert!(validate_skill_dir_for_trash(&root).is_err());
    // A file nested deeper than one level is rejected.
    let nested = root.join("a").join("SKILL.md");
    assert!(validate_skill_dir_for_trash(&nested).is_err());
    // `..` traversal that escapes the root is rejected (normalizes to a
    // directory that is not a direct child of a skill root).
    let escaped = root.join("a").join("..").join("..").join("skills");
    assert!(validate_skill_dir_for_trash(&escaped).is_err());
    // A path outside every known root is rejected.
    let outside = base.join("elsewhere").join("thing");
    std::fs::create_dir_all(&outside).unwrap();
    assert!(validate_skill_dir_for_trash(&outside).is_err());
    // Relative paths are rejected outright.
    assert!(validate_skill_dir_for_trash(Path::new(".omp/skills/a")).is_err());

    let _ = std::fs::remove_dir_all(&base);
}

#[cfg(unix)]
#[test]
fn test_trash_validation_resolves_symlink_to_itself() {
    use std::os::unix::fs::symlink;

    let base = fresh_test_dir("trash-symlink");
    let root = base.join("proj").join(".omp").join("skills");
    // Real target lives OUTSIDE the skill root.
    let outside_target = base.join("real-target");
    std::fs::create_dir_all(&outside_target).unwrap();
    std::fs::write(outside_target.join("keep.txt"), "keep me").unwrap();
    std::fs::create_dir_all(&root).unwrap();

    // Symlink inside the skill root pointing at the outside dir.
    let link = root.join("linked-skill");
    symlink(&outside_target, &link).unwrap();
    // Plus a dangling symlink to a missing target.
    let dangling = root.join("dangling-skill");
    symlink(base.join("missing-target"), &dangling).unwrap();

    // Validation must accept both — trash::delete canonicalizes only the
    // parent, so the link itself is what gets trashed, never the target.
    let v_link = validate_skill_dir_for_trash(&link).unwrap();
    assert_eq!(
        v_link, link,
        "validated path must be the link, not its resolved target"
    );
    assert_eq!(
        validate_skill_dir_for_trash(&dangling).unwrap(),
        dangling,
        "dangling symlink must be trashable"
    );
    // And the target file is untouched (still exists afterwards).
    assert!(outside_target.join("keep.txt").is_file());

    let _ = std::fs::remove_dir_all(&base);
}

// ---- hardening regressions ----

fn scan_dir(root: &Path) -> Vec<SkillItem> {
    let mut index = HashMap::new();
    let mut skills = Vec::new();
    scan_skills_in_dir(
        root,
        "project",
        SkillProvider::Native,
        &mut index,
        &mut skills,
        "./x",
    );
    skills
}

#[cfg(unix)]
#[test]
fn test_is_path_allowed_rejects_symlink_escape() {
    let base = fresh_test_dir("symlink-escape");
    let skill = base.join("proj").join(".omp").join("skills").join("foo");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(skill.join("SKILL.md"), "---\nname: foo\n---\n").unwrap();
    let outside = base.join("secret");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("leak.md"), "secret").unwrap();
    std::os::unix::fs::symlink(outside.join("leak.md"), skill.join("leak.md")).unwrap();

    let ok = skill.join("SKILL.md");
    assert!(is_path_allowed(&ok, &ok.canonicalize().unwrap()));
    let bad = skill.join("leak.md");
    assert!(!is_path_allowed(&bad, &bad.canonicalize().unwrap()));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn test_is_path_allowed_rejects_non_markdown() {
    let base = fresh_test_dir("non-md");
    let skill = base.join(".omp").join("skills").join("foo");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(skill.join("script.sh"), "echo").unwrap();
    let p = skill.join("script.sh");
    assert!(!is_path_allowed(&p, &p.canonicalize().unwrap()));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn test_parse_frontmatter_blank_line_in_block_description() {
    let header = "---\nname: x\ndescription: >\n  first part.\n\n  second part.\nother: 1\n---\n";
    let (name, desc) = parse_skill_frontmatter(header, "d");
    assert_eq!(name, "x");
    assert_eq!(desc, "first part. second part.");
}

#[test]
fn test_bom_skill_md_parses() {
    let root = fresh_test_dir("bom");
    let dir = root.join("bomskill");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("SKILL.md"),
        "\u{feff}---\nname: bom-name\ndescription: bom desc\n---\nbody\n",
    )
    .unwrap();
    let skills = scan_dir(&root);
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "bom-name");
    assert_eq!(skills[0].description, "bom desc");
    assert!(skills[0].issues.is_empty());
    let (n, d) = parse_skill_frontmatter("\u{feff}---\nname: a\ndescription: b\n---\n", "z");
    assert_eq!((n.as_str(), d.as_str()), ("a", "b"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn test_missing_skill_md_issue() {
    let root = fresh_test_dir("missing-skill-md");
    std::fs::create_dir_all(root.join("docs-only")).unwrap();
    std::fs::write(root.join("docs-only").join("README.md"), "hi").unwrap();
    std::fs::create_dir_all(root.join("empty")).unwrap();
    std::fs::create_dir_all(root.join("no-md")).unwrap();
    std::fs::write(root.join("no-md").join("a.txt"), "x").unwrap();
    let skills = scan_dir(&root);
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "docs-only");
    assert_eq!(skills[0].description, "");
    assert_eq!(skills[0].issues, vec![SkillIssue::MissingSkillMd]);
    assert!(skills[0].path.ends_with("docs-only/SKILL.md"));
    // The directory itself stays trashable-shaped (path/dir populated).
    assert!(skills[0].dir.ends_with("docs-only"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn test_enabled_extension_target_rules() {
    let dir = fresh_test_dir("ext-enable");
    let disabled = dir.join("a.ts.disabled");
    std::fs::write(&disabled, "x").unwrap();
    let target = enabled_extension_target(&disabled).unwrap();
    assert_eq!(target, dir.join("a.ts"));
    std::fs::rename(&disabled, &target).unwrap();
    assert!(target.is_file() && !disabled.exists());

    // Not a .disabled file.
    assert!(enabled_extension_target(&target).is_err());

    // Target already exists.
    let b_dis = dir.join("b.js.disabled");
    std::fs::write(&b_dis, "x").unwrap();
    std::fs::write(dir.join("b.js"), "y").unwrap();
    assert!(enabled_extension_target(&b_dis).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_agent_dir_from_honors_override_and_profile() {
    use crate::paths::agent_dir_from;
    let home = Path::new("/h");
    assert_eq!(agent_dir_from(None, None, home), Path::new("/h/.omp/agent"));
    assert_eq!(
        agent_dir_from(Some("/custom"), Some("p"), home),
        Path::new("/custom")
    );
    assert_eq!(
        agent_dir_from(Some("  "), Some("p"), home),
        Path::new("/h/.omp/profiles/p/agent")
    );
}
