//! Files consumed by the privacy extension and OMP's native secrets layer (§3 [P]).

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest as _, Sha256};

use super::classify::whole_word_regex;
use crate::contracts::{SecretEntry, SecretRisk};

pub const BLOCK_BEGIN: &str = "# >>> omp-workspace privacy (managed, do not edit) >>>";
pub const BLOCK_END: &str = "# <<< omp-workspace privacy <<<";

/// `~/.omp-workspace/privacy/`
pub fn privacy_dir() -> PathBuf {
    crate::paths::data_dir().join("privacy")
}

/// `~/.omp-workspace/privacy/secrets.json`
pub fn secrets_json_path() -> PathBuf {
    privacy_dir().join("secrets.json")
}

/// `~/.omp-workspace/privacy/omp-overlay.yml`
pub fn overlay_path() -> PathBuf {
    privacy_dir().join("omp-overlay.yml")
}

/// OMP global `secrets.yml`, resolved like `models.yml` in `providers/models_yml_write.rs`.
pub fn native_secrets_path() -> PathBuf {
    crate::providers::omp_config::home_agent_dir().join("secrets.yml")
}

pub const OVERLAY: &str = "secrets:\n  enabled: true\n";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonEntry<'a> {
    placeholders: Vec<&'a str>,
    current: &'a str,
    value: &'a str,
    track: bool,
    whole_word: bool,
    /// sessionId → epoch ms; messages older than the cutoff stay unmasked.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    cutoffs: &'a BTreeMap<String, i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonFile<'a> {
    native_hash: &'a str,
    entries: Vec<JsonEntry<'a>>,
}

/// `secrets.json` body read live by the extension.
pub fn secrets_json(entries: &[SecretEntry], native_hash: &str) -> String {
    let file = JsonFile {
        native_hash,
        entries: entries
            .iter()
            .map(|e| JsonEntry {
                placeholders: std::iter::once(e.placeholder.as_str())
                    .chain(e.aliases.iter().map(String::as_str))
                    .collect(),
                current: &e.placeholder,
                value: &e.value,
                track: e.track,
                whole_word: e.risk == SecretRisk::Risky,
                cutoffs: &e.cutoffs,
            })
            .collect(),
    };
    serde_json::to_string_pretty(&file).unwrap_or_else(|_| "{}".into())
}

#[derive(Serialize)]
struct NativeItem<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    content: String,
    mode: &'static str,
    replacement: &'a str,
}

/// Entries covered by OMP's global secrets layer: tracked and without any
/// per-session cutoff (the native layer cannot honor cutoffs).
pub fn native_tracked(e: &SecretEntry) -> bool {
    e.track && e.cutoffs.is_empty()
}

/// Managed block text (markers + one JSON-flow item per natively tracked entry).
pub fn managed_block(entries: &[SecretEntry]) -> String {
    let mut out = format!("{BLOCK_BEGIN}\n");
    for e in entries.iter().filter(|e| native_tracked(e)) {
        let item = match e.risk {
            SecretRisk::Safe => NativeItem {
                kind: "plain",
                content: e.value.clone(),
                mode: "replace",
                replacement: &e.placeholder,
            },
            SecretRisk::Risky => NativeItem {
                kind: "regex",
                content: whole_word_regex(&e.value),
                mode: "replace",
                replacement: &e.placeholder,
            },
        };
        if let Ok(json) = serde_json::to_string(&item) {
            out.push_str("- ");
            out.push_str(&json);
            out.push('\n');
        }
    }
    out.push_str(BLOCK_END);
    out.push('\n');
    out
}

/// Hex SHA-256 of the block; empty string when no entry is natively tracked.
pub fn native_hash_of(entries: &[SecretEntry], block: &str) -> String {
    if !entries.iter().any(native_tracked) {
        return String::new();
    }
    let digest = Sha256::digest(block.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Outcome of merging the managed block into an existing secrets.yml.
#[derive(Debug, PartialEq, Eq)]
pub enum Merge {
    Write(String),
    Conflict,
}

/// Byte range of an existing managed block (begin line start .. end line end).
fn block_range(text: &str) -> Option<(usize, usize)> {
    let start = text.find(BLOCK_BEGIN)?;
    if start > 0 && !text[..start].ends_with('\n') {
        return None;
    }
    let rel = text[start..].find(BLOCK_END)?;
    let mut end = start + rel + BLOCK_END.len();
    if text[end..].starts_with("\r\n") {
        end += 2;
    } else if text[end..].starts_with('\n') {
        end += 1;
    }
    Some((start, end))
}

/// True when `text` (outside the managed block) can host appended top-level
/// `- ` items: empty/comments-only, or a YAML block sequence.
fn is_block_sequence_or_empty(text: &str) -> bool {
    let first = text
        .lines()
        .map(str::trim_start)
        .find(|l| !l.is_empty() && !l.starts_with('#') && *l != "---");
    let Some(first) = first else {
        return true;
    };
    if !(first == "-" || first.starts_with("- ")) {
        return false;
    }
    matches!(
        serde_yaml_ng::from_str::<serde_yaml_ng::Value>(text),
        Ok(serde_yaml_ng::Value::Sequence(_))
    )
}

/// Merge `block` into `existing` (None = missing file), preserving user bytes.
pub fn merge_block(existing: Option<&str>, block: &str) -> Merge {
    let Some(text) = existing else {
        return Merge::Write(block.to_string());
    };
    let (before, after) = match block_range(text) {
        Some((s, e)) => (&text[..s], &text[e..]),
        None => (text, ""),
    };
    let rest = format!("{before}{after}");
    if !is_block_sequence_or_empty(&rest) {
        return Merge::Conflict;
    }
    if block_range(text).is_some() {
        return Merge::Write(format!("{before}{block}{after}"));
    }
    let sep = if text.is_empty() || text.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    Merge::Write(format!("{text}{sep}{block}"))
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt as _;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) {}

/// Create `dir` (0700 when `private`).
pub fn ensure_dir(dir: &Path, private: bool) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    if private {
        set_mode(dir, 0o700);
    }
    Ok(())
}

/// Atomic tmp+rename write with 0600 permissions.
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("无效路径")?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无效路径")?;
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        set_mode(&tmp, 0o600);
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("写入 {name} 失败: {e}"));
    }
    Ok(())
}

/// Write the managed block into the secrets.yml at `path`. `Ok(false)` = conflict.
pub fn write_native(path: &Path, block: &str) -> Result<bool, String> {
    let existing = match std::fs::read_to_string(path) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("读取 secrets.yml 失败: {e}")),
    };
    match merge_block(existing.as_deref(), block) {
        Merge::Conflict => Ok(false),
        Merge::Write(text) => {
            if existing.as_deref() == Some(text.as_str()) {
                return Ok(true);
            }
            if let Some(dir) = path.parent() {
                ensure_dir(dir, false)?;
            }
            write_atomic(path, &text)?;
            Ok(true)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(value: &str, placeholder: &str, risk: SecretRisk, track: bool) -> SecretEntry {
        SecretEntry {
            id: value.into(),
            value: value.into(),
            label: None,
            placeholder: placeholder.into(),
            aliases: vec!["⟦OLD_0000⟧".into()],
            risk,
            track,
            in_library: false,
            library_prompted: false,
            created_at: String::new(),
            session_count: 0,
            cutoffs: Default::default(),
        }
    }

    fn sample() -> Vec<SecretEntry> {
        vec![
            entry("sk-\"quoted\"\\x", "⟦KEY_aaaa⟧", SecretRisk::Safe, true),
            entry("root.1", "⟦USER_bbbb⟧", SecretRisk::Risky, true),
            entry("untracked-value", "⟦SECRET_cccc⟧", SecretRisk::Safe, false),
        ]
    }

    #[test]
    fn block_items_are_valid_yaml() {
        let block = managed_block(&sample());
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(&block).unwrap();
        let seq = v.as_sequence().unwrap();
        assert_eq!(seq.len(), 2);
        assert_eq!(seq[0]["content"].as_str(), Some("sk-\"quoted\"\\x"));
        assert_eq!(seq[0]["type"].as_str(), Some("plain"));
        assert_eq!(
            seq[1]["content"].as_str(),
            Some(r"(?<![A-Za-z0-9_])root\.1(?![A-Za-z0-9_])")
        );
        assert_eq!(seq[1]["replacement"].as_str(), Some("⟦USER_bbbb⟧"));
        assert_eq!(native_hash_of(&sample(), &block).len(), 64);
    }

    #[test]
    fn empty_block_without_tracked_entries() {
        let untracked = vec![entry(
            "untracked-value",
            "⟦S_cccc⟧",
            SecretRisk::Safe,
            false,
        )];
        let block = managed_block(&untracked);
        assert_eq!(block, format!("{BLOCK_BEGIN}\n{BLOCK_END}\n"));
        assert_eq!(native_hash_of(&untracked, &block), "");
    }

    #[test]
    fn merge_preserves_user_bytes_and_replaces_block() {
        let block = managed_block(&sample());
        assert_eq!(merge_block(None, &block), Merge::Write(block.clone()));
        let user = "# my secrets\n- type: plain\n  content: abc123xyz   \n";
        let Merge::Write(first) = merge_block(Some(user), &block) else {
            panic!("conflict")
        };
        assert!(first.starts_with(user));
        let tail = "\n# trailing user comment\n";
        let with_tail = format!("{first}{tail}");
        let new_block = managed_block(&[]);
        let Merge::Write(second) = merge_block(Some(&with_tail), &new_block) else {
            panic!("conflict")
        };
        assert_eq!(second, format!("{user}{new_block}{tail}"));
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(&first).unwrap();
        assert_eq!(v.as_sequence().unwrap().len(), 3);
        // No trailing newline in user file.
        let Merge::Write(third) = merge_block(Some("- {type: plain, content: zzzzzzzz}"), &block)
        else {
            panic!("conflict")
        };
        assert!(third.starts_with("- {type: plain, content: zzzzzzzz}\n# >>>"));
        assert_eq!(
            merge_block(Some("# only comments\n"), &block),
            Merge::Write(format!("# only comments\n{block}"))
        );
    }

    #[test]
    fn merge_refuses_conflicts() {
        let block = managed_block(&sample());
        assert_eq!(merge_block(Some("[]\n"), &block), Merge::Conflict);
        assert_eq!(
            merge_block(Some("secrets:\n  - a\n"), &block),
            Merge::Conflict
        );
        assert_eq!(merge_block(Some("key: value\n"), &block), Merge::Conflict);
    }

    #[test]
    fn write_native_creates_and_skips_conflict() {
        let dir = std::env::temp_dir().join(format!("ompws-privacy-{}", uuid::Uuid::new_v4()));
        let path = dir.join("agent").join("secrets.yml");
        let block = managed_block(&sample());
        assert!(write_native(&path, &block).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), block);
        std::fs::write(&path, "{}\n").unwrap();
        assert!(!write_native(&path, &block).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}\n");
        let json = secrets_json(&sample(), "h");
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["nativeHash"], "h");
        assert_eq!(v["entries"][1]["wholeWord"], true);
        assert_eq!(v["entries"][0]["placeholders"][1], "⟦OLD_0000⟧");
        assert!(v["entries"][0].get("cutoffs").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn with_cutoff(mut e: SecretEntry) -> SecretEntry {
        e.cutoffs.insert("sess-1".into(), 1_700_000_000_123);
        e
    }

    #[test]
    fn secrets_json_emits_cutoffs() {
        let entries = vec![with_cutoff(entry(
            "a-value-1",
            "⟦A_1111⟧",
            SecretRisk::Safe,
            true,
        ))];
        let v: serde_json::Value = serde_json::from_str(&secrets_json(&entries, "h")).unwrap();
        assert_eq!(v["entries"][0]["cutoffs"]["sess-1"], 1_700_000_000_123_i64);
    }

    #[test]
    fn cutoff_entries_are_excluded_from_native_block_and_hash() {
        let mut entries = sample();
        entries[0] = with_cutoff(entries[0].clone());
        let block = managed_block(&entries);
        assert!(!block.contains("quoted"));
        assert!(!block.contains("⟦KEY_aaaa⟧"));
        assert!(block.contains("⟦USER_bbbb⟧"));
        let hash = native_hash_of(&entries, &block);
        assert_eq!(hash.len(), 64);
        assert_eq!(
            hash,
            native_hash_of(&entries[1..], &managed_block(&entries[1..]))
        );
        // Only a cutoff entry tracked: empty block, empty hash.
        let only = vec![with_cutoff(entry(
            "only-value",
            "⟦O_2222⟧",
            SecretRisk::Safe,
            true,
        ))];
        let b = managed_block(&only);
        assert_eq!(b, format!("{BLOCK_BEGIN}\n{BLOCK_END}\n"));
        assert_eq!(native_hash_of(&only, &b), "");
    }
}
