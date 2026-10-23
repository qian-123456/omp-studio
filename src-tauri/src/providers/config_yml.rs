//! `disabledProviders` in OMP's global `~/.omp/agent/config.yml`.
//!
//! A provider listed there is hidden from new OMP sessions. The list may also
//! hold path-scoped object items (`- path: …`); those are never touched. Edits
//! are line-level so every other byte of the file is preserved; writes go
//! through the shared backup + read-back + restore path.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_yaml_ng::Value;

use super::models_yml_providers::{edit_file, models_block_end, yaml_scalar};
use super::models_yml_write::{ensure_newline, opens_block, parse_line};

const KEY: &str = "disabledProviders";
const ITEM_INDENT: usize = 2;

pub fn config_path() -> PathBuf {
    super::omp_config::home_agent_dir().join("config.yml")
}

/// Provider ids disabled for every project (global string items only).
pub fn disabled_ids(text: &str) -> Result<HashSet<String>, String> {
    let root: Value =
        serde_yaml_ng::from_str(text).map_err(|_| "现有 config.yml 无法解析".to_string())?;
    Ok(match root.get(KEY) {
        Some(Value::Sequence(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        Some(Value::String(s)) => HashSet::from([s.clone()]),
        _ => HashSet::new(),
    })
}

/// Disabled ids of the real config file; missing or unreadable → empty (the
/// parse failure is logged without content).
pub fn read_disabled() -> HashSet<String> {
    let path = config_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return HashSet::new();
    };
    disabled_ids(&text).unwrap_or_else(|e| {
        tracing::warn!("providers: {e}");
        HashSet::new()
    })
}

fn flow_line(items: &[String]) -> String {
    let body: Vec<String> = items.iter().map(|s| yaml_scalar(s)).collect();
    format!("{KEY}: [{}]\n", body.join(", "))
}

/// Pure transform: add (`disabled = true`) or remove the global string item `id`.
pub fn set_disabled_text(text: &str, id: &str, disabled: bool) -> Result<String, String> {
    let mut out: Vec<String> = text.split_inclusive('\n').map(str::to_string).collect();
    let at = out.iter().position(|raw| {
        let l = parse_line(raw);
        !l.trivia && l.indent == 0 && l.entry.as_ref().is_some_and(|(k, _)| k == KEY)
    });
    let Some(at) = at else {
        if !disabled {
            return Ok(text.to_string());
        }
        let end = out.len();
        ensure_newline(&mut out, end);
        out.push(format!(
            "{KEY}:\n{}- {}\n",
            " ".repeat(ITEM_INDENT),
            yaml_scalar(id)
        ));
        return Ok(out.concat());
    };

    let rest = parse_line(&out[at])
        .entry
        .map(|(_, r)| r.to_string())
        .unwrap_or_default();
    if !opens_block(&rest) {
        // Inline value: `[a, b]`, a single string or null.
        let value: Value = serde_yaml_ng::from_str(rest.trim())
            .map_err(|_| format!("config.yml 中 `{KEY}` 无法安全编辑"))?;
        let mut items: Vec<String> = match value {
            Value::Sequence(seq) => seq
                .into_iter()
                .map(|v| match v {
                    Value::String(s) => Ok(s),
                    _ => Err(format!("config.yml 中 `{KEY}` 含复杂条目，无法安全编辑")),
                })
                .collect::<Result<_, _>>()?,
            Value::String(s) => vec![s],
            Value::Null => Vec::new(),
            _ => return Err(format!("config.yml 中 `{KEY}` 无法安全编辑")),
        };
        let present = items.iter().any(|s| s == id);
        if disabled == present {
            return Ok(text.to_string());
        }
        if disabled {
            items.push(id.to_string());
        } else {
            items.retain(|s| s != id);
        }
        let eol_crlf = out[at].ends_with("\r\n");
        let mut line = flow_line(&items);
        if eol_crlf {
            line = line.replace('\n', "\r\n");
        }
        out[at] = line;
        return Ok(out.concat());
    }

    // Block sequence.
    let end = {
        let lines: Vec<&str> = out.iter().map(String::as_str).collect();
        models_block_end(&lines, at, 0)
    };
    let mut item_indent = None;
    let mut total_items = 0usize;
    let mut hits = Vec::new();
    for (i, raw) in out.iter().enumerate().take(end).skip(at + 1) {
        let l = parse_line(raw);
        if l.trivia {
            continue;
        }
        let body = raw.trim_end_matches(['\n', '\r']);
        let trimmed = body.trim_start_matches(' ');
        let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| (trimmed == "-").then_some(""))
        else {
            continue;
        };
        let ind = *item_indent.get_or_insert(l.indent);
        if l.indent != ind {
            continue;
        }
        total_items += 1;
        if let Ok(Value::String(s)) = serde_yaml_ng::from_str::<Value>(item.trim()) {
            if s == id {
                hits.push(i);
            }
        }
    }
    if disabled {
        if !hits.is_empty() {
            return Ok(text.to_string());
        }
        let ind = item_indent.unwrap_or(ITEM_INDENT);
        let at_line = if total_items == 0 { at + 1 } else { end };
        ensure_newline(&mut out, at_line);
        out.insert(
            at_line,
            format!("{}- {}\n", " ".repeat(ind), yaml_scalar(id)),
        );
    } else {
        if hits.is_empty() {
            return Ok(text.to_string());
        }
        if total_items == hits.len() {
            out.splice(at..end, [format!("{KEY}: []\n")]);
        } else {
            for i in hits.into_iter().rev() {
                out.remove(i);
            }
        }
    }
    Ok(out.concat())
}

/// Add/remove `id` in the real config file (backup, read-back verification).
pub fn set_disabled(id: &str, disabled: bool) -> Result<(), String> {
    set_disabled_at(&config_path(), id, disabled)
}

/// [`set_disabled`] on an explicit file.
pub fn set_disabled_at(path: &Path, id: &str, disabled: bool) -> Result<(), String> {
    if !path.exists() && !disabled {
        return Ok(());
    }
    edit_file(
        path,
        &|text| set_disabled_text(text, id, disabled),
        &|written| {
            let got =
                disabled_ids(written).map_err(|_| "写入后 config.yml 无法解析".to_string())?;
            if got.contains(id) == disabled {
                Ok(())
            } else {
                Err(format!("写入后校验失败: {id}"))
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(text: &str) -> Vec<String> {
        let mut v: Vec<_> = disabled_ids(text).unwrap().into_iter().collect();
        v.sort();
        v
    }

    const SCOPED: &str = "# top\nretry:\n  max: 3\ndisabledProviders:\n  - native\n  - path: ~/work\n    providers:\n      - foo\n  - \"my prov\"\nmodelRoles:\n  default: a/b\n";

    #[test]
    fn disable_appends_after_path_scoped_items_and_keeps_rest() {
        let out = set_disabled_text(SCOPED, "x", true).unwrap();
        assert_eq!(
            out,
            "# top\nretry:\n  max: 3\ndisabledProviders:\n  - native\n  - path: ~/work\n    providers:\n      - foo\n  - \"my prov\"\n  - x\nmodelRoles:\n  default: a/b\n"
        );
        assert_eq!(ids(&out), ["my prov", "native", "x"]);
        // already present → byte-identical
        assert_eq!(set_disabled_text(SCOPED, "native", true).unwrap(), SCOPED);
    }

    #[test]
    fn enable_removes_only_the_scalar_item() {
        let out = set_disabled_text(SCOPED, "my prov", false).unwrap();
        assert!(!out.contains("my prov"));
        assert!(out.contains("  - path: ~/work\n    providers:\n      - foo\n"));
        assert!(out.contains("  - native\n"));
        // `foo` only lives inside the scoped object: nothing to remove
        assert_eq!(set_disabled_text(SCOPED, "foo", false).unwrap(), SCOPED);
        assert_eq!(set_disabled_text(SCOPED, "absent", false).unwrap(), SCOPED);
    }

    #[test]
    fn removing_last_item_leaves_empty_list_and_missing_key_is_created() {
        let t = "a: 1\ndisabledProviders:\n  - only\nb: 2\n";
        let out = set_disabled_text(t, "only", false).unwrap();
        assert_eq!(out, "a: 1\ndisabledProviders: []\nb: 2\n");
        assert_eq!(set_disabled_text("a: 1\n", "x", false).unwrap(), "a: 1\n");
        assert_eq!(
            set_disabled_text("a: 1", "x y", true).unwrap(),
            "a: 1\ndisabledProviders:\n  - \"x y\"\n"
        );
        let out = set_disabled_text(&out, "z", true).unwrap();
        assert_eq!(out, "a: 1\ndisabledProviders: [z]\nb: 2\n");
        assert_eq!(
            set_disabled_text("", "z", true).unwrap(),
            "disabledProviders:\n  - z\n"
        );
    }

    #[test]
    fn flow_lists_and_same_indent_sequences() {
        let t = "disabledProviders: [a, b] # c\nx: 1\n";
        let out = set_disabled_text(t, "c", true).unwrap();
        assert_eq!(out, "disabledProviders: [a, b, c]\nx: 1\n");
        assert_eq!(
            set_disabled_text(&out, "a", false).unwrap(),
            "disabledProviders: [b, c]\nx: 1\n"
        );
        let t = "disabledProviders: [{path: p, values: [q]}]\n";
        assert!(set_disabled_text(t, "c", true).is_err());
        let t = "disabledProviders:\n- a\n- b\nx: 1\n";
        assert_eq!(
            set_disabled_text(t, "c", true).unwrap(),
            "disabledProviders:\n- a\n- b\n- c\nx: 1\n"
        );
    }

    #[test]
    fn file_write_backs_up_and_verifies() {
        let dir = std::env::temp_dir().join(format!("ompws-cfg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("config.yml");
        std::fs::write(&p, SCOPED).unwrap();
        edit_file(&p, &|t| set_disabled_text(t, "openai", true), &|w| {
            disabled_ids(w)?
                .contains("openai")
                .then_some(())
                .ok_or_else(|| "x".to_string())
        })
        .unwrap();
        assert!(ids(&std::fs::read_to_string(&p).unwrap()).contains(&"openai".to_string()));
        let baks = std::fs::read_dir(&dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("config.yml.bak-")
            })
            .count();
        assert_eq!(baks, 1);
        std::fs::remove_dir_all(dir).ok();
    }
}
