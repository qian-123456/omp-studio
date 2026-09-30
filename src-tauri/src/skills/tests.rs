use std::path::{Path, PathBuf};

use super::commands::{
    is_path_allowed, normalize_path, parse_disabled_extensions_text, parse_skill_frontmatter,
};

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
