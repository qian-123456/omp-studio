//! Targeted writer for `providers.<id>.modelOverrides.<modelId>.contextWindow` in
//! OMP's `~/.omp/agent/models.yml`. Edits are line-level: every byte outside the
//! touched lines (comments, key lines, ordering) is preserved. A timestamped
//! backup is written next to the file, the result is re-parsed and verified, and
//! the original is restored on any failure. File contents are never returned.

use std::path::{Path, PathBuf};

use crate::contracts::ModelContextWindowEdit;

const NEW_INDENT: usize = 2;

#[tauri::command]
pub async fn omp_models_set_context_windows(
    entries: Vec<ModelContextWindowEdit>,
) -> Result<(), String> {
    // models.yml is read-modify-written as a whole by the provider editor too;
    // without the shared lock a concurrent provider save and this edit each
    // plan from the same old content and the later write silently drops the
    // other change.
    let _guard = super::MUTATION_LOCK.lock().await;
    let path = super::omp_config::home_agent_dir().join("models.yml");
    tokio::task::spawn_blocking(move || apply_to_file(&path, &entries))
        .await
        .map_err(|e| format!("写入任务失败: {e}"))?
}

/// Apply all edits to `path` atomically from the caller's point of view.
pub fn apply_to_file(path: &Path, entries: &[ModelContextWindowEdit]) -> Result<(), String> {
    apply_with(path, entries, verify)
}

/// Existing `providers.*.modelOverrides.*.contextWindow` values only; nothing
/// else from models.yml leaves the backend.
#[tauri::command]
pub async fn omp_models_context_window_overrides() -> Result<Vec<ModelContextWindowEdit>, String> {
    let path = super::omp_config::home_agent_dir().join("models.yml");
    tokio::task::spawn_blocking(move || read_overrides(&path))
        .await
        .map_err(|e| format!("读取任务失败: {e}"))?
}

pub fn read_overrides(path: &Path) -> Result<Vec<ModelContextWindowEdit>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("读取 models.yml 失败: {}", e.kind()))?;
    let root: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(&text).map_err(|_| "现有 models.yml 无法解析".to_string())?;
    let mut out = Vec::new();
    let Some(providers) = root.get("providers").and_then(|v| v.as_mapping()) else {
        return Ok(out);
    };
    for (pid, pv) in providers {
        let (Some(pid), Some(overrides)) = (
            pid.as_str(),
            pv.get("modelOverrides").and_then(|v| v.as_mapping()),
        ) else {
            continue;
        };
        for (mid, mv) in overrides {
            let (Some(mid), Some(cw)) = (
                mid.as_str(),
                mv.get("contextWindow").and_then(|v| v.as_u64()),
            ) else {
                continue;
            };
            out.push(ModelContextWindowEdit {
                provider_id: pid.to_string(),
                model_id: mid.to_string(),
                context_window: Some(cw),
            });
        }
    }
    Ok(out)
}

type Verifier = fn(&str, &[ModelContextWindowEdit]) -> Result<(), String>;

fn apply_with(
    path: &Path,
    entries: &[ModelContextWindowEdit],
    check: Verifier,
) -> Result<(), String> {
    for e in entries {
        if e.provider_id.trim().is_empty() || e.model_id.trim().is_empty() {
            return Err("供应商或模型 ID 为空".into());
        }
        if e.context_window == Some(0) {
            return Err("上下文窗口必须大于 0".into());
        }
    }
    let existed = path.exists();
    let original = if existed {
        std::fs::read_to_string(path).map_err(|e| format!("读取 models.yml 失败: {}", e.kind()))?
    } else {
        String::new()
    };
    if existed && serde_yaml_ng::from_str::<serde_yaml_ng::Value>(&original).is_err() {
        return Err("现有 models.yml 无法解析，未做修改".into());
    }
    let mut text = original.clone();
    for e in entries {
        text = edit_text(&text, &e.provider_id, &e.model_id, e.context_window)?;
    }
    if text == original {
        return Ok(());
    }

    commit_text(path, existed, &text, &|written| check(written, entries))
}

/// Write `text` to `path` with a timestamped backup, run `check` on the read-back
/// content, and restore the original on any failure.
pub(super) fn commit_text(
    path: &Path,
    existed: bool,
    text: &str,
    check: &dyn Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    let label = path.file_name().map_or_else(
        || "models.yml".to_string(),
        |n| n.to_string_lossy().into_owned(),
    );
    let backup = if existed {
        let b = backup_path(path);
        std::fs::copy(path, &b).map_err(|e| format!("备份 {label} 失败: {}", e.kind()))?;
        Some(b)
    } else {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e.kind()))?;
        }
        None
    };

    let result = std::fs::write(path, text)
        .map_err(|e| format!("写入 {label} 失败: {}", e.kind()))
        .and_then(|_| {
            let written = std::fs::read_to_string(path)
                .map_err(|e| format!("回读 {label} 失败: {}", e.kind()))?;
            check(&written)
        });
    if let Err(err) = result {
        let restored = match &backup {
            Some(b) => std::fs::copy(b, path).map(|_| ()),
            None => std::fs::remove_file(path),
        };
        return Err(match restored {
            Ok(()) => format!("{err}；已恢复原文件"),
            Err(e) => format!("{err}；恢复原文件失败: {}", e.kind()),
        });
    }
    Ok(())
}

pub(super) fn backup_path(path: &Path) -> PathBuf {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%3f");
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "models.yml".into());
    path.with_file_name(format!("{name}.bak-{stamp}"))
}

fn verify(text: &str, entries: &[ModelContextWindowEdit]) -> Result<(), String> {
    let root: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(text).map_err(|_| "写入后 models.yml 无法解析".to_string())?;
    // Later entries for the same (provider, model) win.
    for (i, e) in entries.iter().enumerate() {
        if entries[i + 1..]
            .iter()
            .any(|n| n.provider_id == e.provider_id && n.model_id == e.model_id)
        {
            continue;
        }
        let got = root
            .get("providers")
            .and_then(|p| p.get(e.provider_id.as_str()))
            .and_then(|p| p.get("modelOverrides"))
            .and_then(|m| m.get(e.model_id.as_str()))
            .and_then(|m| m.get("contextWindow"));
        let ok = match e.context_window {
            Some(v) => got.and_then(|g| g.as_u64()) == Some(v),
            None => got.is_none(),
        };
        if !ok {
            return Err(format!("写入后校验失败: {}/{}", e.provider_id, e.model_id));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Line-level YAML editing (block style only).
// ---------------------------------------------------------------------------

pub(super) struct Line<'a> {
    pub(super) indent: usize,
    /// `Some((key, rest_after_colon))` for `key: value` mapping lines.
    pub(super) entry: Option<(String, &'a str)>,
    /// Blank or comment-only line.
    pub(super) trivia: bool,
}

pub(super) fn parse_line(raw: &str) -> Line<'_> {
    let body = raw.trim_end_matches(['\n', '\r']);
    let trimmed = body.trim_start_matches(' ');
    let indent = body.len() - trimmed.len();
    if trimmed.trim().is_empty() || trimmed.starts_with('#') {
        return Line {
            indent,
            entry: None,
            trivia: true,
        };
    }
    Line {
        indent,
        entry: parse_key(trimmed),
        trivia: false,
    }
}

fn parse_key(s: &str) -> Option<(String, &str)> {
    let (key, after) = if let Some(q) = s.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let end = s[1..].find(q)? + 1;
        let inner = &s[1..end];
        let key = if q == '"' {
            serde_json::from_str::<String>(&s[..=end]).unwrap_or_else(|_| inner.to_string())
        } else {
            inner.replace("''", "'")
        };
        (key, &s[end + 1..])
    } else {
        if s.starts_with('-') {
            return None;
        }
        let colon = s
            .match_indices(':')
            .find(|(i, _)| {
                let next = s[i + 1..].chars().next();
                next.is_none() || next == Some(' ') || next == Some('\t')
            })?
            .0;
        (s[..colon].trim_end().to_string(), &s[colon..])
    };
    let rest = after.trim_start().strip_prefix(':')?;
    Some((key, rest))
}

/// True when the value part after `key:` is empty (a nested block follows).
pub(super) fn opens_block(rest: &str) -> bool {
    let r = rest.trim();
    r.is_empty() || r.starts_with('#')
}

pub(super) fn yaml_key(k: &str) -> String {
    if is_plain_yaml_key(k) {
        k.to_string()
    } else {
        serde_json::to_string(k).unwrap_or_else(|_| format!("\"{k}\""))
    }
}

/// A key that YAML reads back as the same string: safe characters only, not
/// starting with `-`/`.` (block sequence / anchor syntax), and not a scalar
/// that the parser would resolve as a number, bool or null. Without the last
/// check a model id like `123` or `true` would be written as a bare key, read
/// back as a non-string, and fail verification.
fn is_plain_yaml_key(k: &str) -> bool {
    if k.is_empty()
        || k.starts_with(['-', '.'])
        || !k
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/'))
    {
        return false;
    }
    if k.parse::<f64>().is_ok() {
        return false;
    }
    !matches!(
        k.to_ascii_lowercase().as_str(),
        "true" | "false" | "yes" | "no" | "on" | "off" | "null" | "~" | "y" | "n"
    )
}

/// Exclusive end of the block owned by the key at `start` with indent `indent`:
/// one past the last non-trivia line deeper than `indent`.
pub(super) fn block_end(lines: &[&str], start: usize, indent: usize) -> usize {
    let mut end = start + 1;
    for (i, raw) in lines.iter().enumerate().skip(start + 1) {
        let l = parse_line(raw);
        if l.trivia {
            continue;
        }
        if l.indent <= indent {
            break;
        }
        end = i + 1;
    }
    end
}

/// Find direct child `key` inside block `(start, end)` whose parent indent is
/// `parent_indent` (`None` = document root). Returns (line index, child indent).
pub(super) fn find_child(
    lines: &[&str],
    range: (usize, usize),
    parent_indent: Option<usize>,
    key: &str,
) -> Result<(Option<usize>, Option<usize>), String> {
    let mut child_indent = None;
    for (i, raw) in lines.iter().enumerate().take(range.1).skip(range.0) {
        let l = parse_line(raw);
        if l.trivia || parent_indent.is_some_and(|p| l.indent <= p) {
            continue;
        }
        let ci = *child_indent.get_or_insert(l.indent);
        if l.indent != ci {
            continue;
        }
        if let Some((k, rest)) = &l.entry {
            if k == key {
                if !opens_block(rest) && key != "contextWindow" {
                    return Err(format!("models.yml 中 `{key}` 不是块结构，无法安全编辑"));
                }
                return Ok((Some(i), child_indent));
            }
        }
    }
    Ok((None, child_indent))
}

pub(super) fn ensure_newline(out: &mut [String], at: usize) {
    if at > 0 {
        if let Some(prev) = out.get_mut(at - 1) {
            if !prev.ends_with('\n') {
                prev.push('\n');
            }
        }
    }
}

/// Pure text transform; see module docs.
pub fn edit_text(
    text: &str,
    provider: &str,
    model: &str,
    value: Option<u64>,
) -> Result<String, String> {
    let mut out: Vec<String> = text.split_inclusive('\n').map(str::to_string).collect();
    let path = ["providers", provider, "modelOverrides", model];

    // Walk the path; record (line, indent) of each found key.
    let mut found: Vec<(usize, usize)> = Vec::new();
    let mut range = (0usize, out.len());
    let mut parent: Option<usize> = None;
    let mut missing_at: Option<(usize, usize, usize)> = None; // (depth, insert_at, indent)
    for (depth, key) in path.iter().enumerate() {
        let lines: Vec<&str> = out.iter().map(String::as_str).collect();
        let (hit, child_indent) = find_child(&lines, range, parent, key)?;
        match hit {
            Some(i) => {
                let ind = parse_line(lines[i]).indent;
                found.push((i, ind));
                range = (i + 1, block_end(&lines, i, ind));
                parent = Some(ind);
            }
            None => {
                let indent = child_indent.unwrap_or_else(|| parent.map_or(0, |p| p + NEW_INDENT));
                missing_at = Some((depth, range.1, indent));
                break;
            }
        }
    }

    let Some(v) = value else {
        // Delete: only meaningful when the full path exists.
        if missing_at.is_some() {
            return Ok(text.to_string());
        }
        let lines: Vec<&str> = out.iter().map(String::as_str).collect();
        let (hit, _) = find_child(&lines, range, parent, "contextWindow")?;
        let Some(cw) = hit else {
            return Ok(text.to_string());
        };
        out.remove(cw);
        // Drop now-empty model / modelOverrides maps (innermost first).
        for &(line, ind) in found.iter().rev().take(2) {
            let lines: Vec<&str> = out.iter().map(String::as_str).collect();
            if block_end(&lines, line, ind) == line + 1 {
                out.remove(line);
            } else {
                break;
            }
        }
        return Ok(out.concat());
    };

    if let Some((depth, at, indent)) = missing_at {
        let mut ins = String::new();
        for (d, key) in path.iter().enumerate().skip(depth) {
            let ind = indent + (d - depth) * NEW_INDENT;
            ins.push_str(&format!("{}{}:\n", " ".repeat(ind), yaml_key(key)));
        }
        let ind = indent + (path.len() - depth) * NEW_INDENT;
        ins.push_str(&format!("{}contextWindow: {v}\n", " ".repeat(ind)));
        ensure_newline(&mut out, at);
        out.insert(at, ins);
        return Ok(out.concat());
    }

    let lines: Vec<&str> = out.iter().map(String::as_str).collect();
    let (hit, child_indent) = find_child(&lines, range, parent, "contextWindow")?;
    match hit {
        Some(i) => {
            let raw = &out[i];
            let ind = parse_line(raw).indent;
            let eol = if raw.ends_with("\r\n") {
                "\r\n"
            } else if raw.ends_with('\n') {
                "\n"
            } else {
                ""
            };
            out[i] = format!("{}contextWindow: {v}{eol}", " ".repeat(ind));
        }
        None => {
            let ind = child_indent.unwrap_or(parent.unwrap_or(0) + NEW_INDENT);
            let at = range.1;
            ensure_newline(&mut out, at);
            out.insert(at, format!("{}contextWindow: {v}\n", " ".repeat(ind)));
        }
    }
    Ok(out.concat())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(p: &str, m: &str, v: Option<u64>) -> ModelContextWindowEdit {
        ModelContextWindowEdit {
            provider_id: p.into(),
            model_id: m.into(),
            context_window: v,
        }
    }

    const SAMPLE: &str = "# top comment\nproviders:\n  acme:\n    baseUrl: https://x.example # trailing\n    apiKey: FAKE_SECRET_VALUE_123\n    models:\n      - id: m1\n  other:\n    apiKey: \"OTHER_FAKE\"\n# tail comment\n";

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ompws-myw-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("models.yml")
    }

    fn cw(text: &str, p: &str, m: &str) -> Option<u64> {
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(text).unwrap();
        v.get("providers")?
            .get(p)?
            .get("modelOverrides")?
            .get(m)?
            .get("contextWindow")?
            .as_u64()
    }

    #[test]
    fn read_overrides_returns_only_context_windows() {
        let p = tmp("read");
        assert!(read_overrides(&p).unwrap().is_empty());
        std::fs::write(&p, "providers:\n  acme:\n    apiKey: FAKE\n    modelOverrides:\n      m1:\n        contextWindow: 1000\n      m2:\n        name: x\n  other:\n    apiKey: FAKE2\n").unwrap();
        let got = read_overrides(&p).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(
            (
                got[0].provider_id.as_str(),
                got[0].model_id.as_str(),
                got[0].context_window
            ),
            ("acme", "m1", Some(1000))
        );
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn creates_missing_model_overrides_and_preserves_other_lines() {
        let path = tmp("create");
        std::fs::write(&path, SAMPLE).unwrap();
        apply_to_file(&path, &[entry("acme", "gpt-4o:mini", Some(250_000))]).unwrap();
        let out = std::fs::read_to_string(&path).unwrap();
        assert_eq!(cw(&out, "acme", "gpt-4o:mini"), Some(250_000));
        for l in SAMPLE.lines() {
            assert!(out.lines().any(|o| o == l), "lost line: {l}");
        }
        let removed: Vec<&str> = out.lines().filter(|l| !SAMPLE.contains(l)).collect();
        assert_eq!(removed.len(), 3, "{out}");
        let backups = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("models.yml.bak-")
            })
            .count();
        assert_eq!(backups, 1);
    }

    #[test]
    fn updates_then_deletes_override_byte_for_byte() {
        let set = edit_text(SAMPLE, "other", "m", Some(1000)).unwrap();
        let upd = edit_text(&set, "other", "m", Some(2000)).unwrap();
        assert_eq!(cw(&upd, "other", "m"), Some(2000));
        assert_eq!(upd.matches("contextWindow").count(), 1);
        let del = edit_text(&upd, "other", "m", None).unwrap();
        assert_eq!(del, SAMPLE);
    }

    #[test]
    fn delete_keeps_sibling_overrides() {
        let src = "providers:\n  a:\n    modelOverrides:\n      m1:\n        contextWindow: 5\n        maxTokens: 9\n      m2:\n        contextWindow: 7\n";
        let out = edit_text(src, "a", "m1", None).unwrap();
        assert_eq!(
            out,
            "providers:\n  a:\n    modelOverrides:\n      m1:\n        maxTokens: 9\n      m2:\n        contextWindow: 7\n"
        );
        let out = edit_text(src, "a", "m2", None).unwrap();
        assert!(cw(&out, "a", "m1") == Some(5) && !out.contains("m2"));
    }

    /// A model id that YAML would resolve to a number/bool must be quoted, or
    /// the write verifies against a non-string key and fails (and rolls back).
    #[test]
    fn numeric_and_boolean_model_ids_round_trip_as_strings() {
        assert_eq!(yaml_key("123"), "\"123\"");
        assert_eq!(yaml_key("1.5"), "\"1.5\"");
        assert_eq!(yaml_key("true"), "\"true\"");
        assert_eq!(yaml_key("Null"), "\"Null\"");
        assert_eq!(yaml_key("gpt-4o"), "gpt-4o");
        assert_eq!(yaml_key("gpt-4o:mini"), "\"gpt-4o:mini\"");

        let path = tmp("numeric-key");
        std::fs::write(&path, "providers:\n  acme:\n    apiKey: FAKE\n").unwrap();
        apply_to_file(
            &path,
            &[
                entry("acme", "123", Some(4096)),
                entry("acme", "true", Some(8)),
            ],
        )
        .unwrap();
        let out = std::fs::read_to_string(&path).unwrap();
        assert_eq!(cw(&out, "acme", "123"), Some(4096), "{out}");
        assert_eq!(cw(&out, "acme", "true"), Some(8), "{out}");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn creates_provider_and_missing_file() {
        let path = tmp("missing");
        apply_to_file(&path, &[entry("new", "x", Some(42))]).unwrap();
        let out = std::fs::read_to_string(&path).unwrap();
        assert_eq!(cw(&out, "new", "x"), Some(42));
        let out = edit_text("providers:\n  acme:\n    apiKey: k", "zed", "y", Some(9)).unwrap();
        assert_eq!(cw(&out, "zed", "y"), Some(9));
        assert!(out.starts_with("providers:\n  acme:\n    apiKey: k\n"));
    }

    #[test]
    fn rejects_flow_style_and_restores_on_verify_failure() {
        assert!(edit_text(
            "providers:\n  a:\n    modelOverrides: {}\n",
            "a",
            "m",
            Some(1)
        )
        .is_err());
        let path = tmp("restore");
        let src = "providers:\n  a:\n    modelOverrides:\n      m:\n        contextWindow: 1\n";
        std::fs::write(&path, src).unwrap();
        assert!(verify(src, &[entry("a", "m", Some(2))]).is_err());
        let err = apply_with(&path, &[entry("a", "m", Some(2))], |_, _| {
            Err("forced".into())
        })
        .unwrap_err();
        assert!(err.contains("已恢复"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), src);
        // Missing file + failed verify → file removed again.
        let fresh = tmp("restore-new");
        assert!(apply_with(&fresh, &[entry("a", "m", Some(2))], |_, _| Err("x".into())).is_err());
        assert!(!fresh.exists());
        let bad = "providers: [\n";
        std::fs::write(&path, bad).unwrap();
        assert!(apply_to_file(&path, &[entry("a", "m", Some(2))]).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), bad);
    }
}
