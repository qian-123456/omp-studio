//! Providers that live in OMP's `~/.omp/agent/models.yml`.
//!
//! OMP reads `providers.<slug>.models` itself, so for a provider whose slug exists
//! there, models.yml is the single source of truth: the app reads the model list
//! from it (`overlay_models`) and saves write back into it (`write_models`). The
//! private `ompws-<slug>` extension skips such providers (see `managed_slugs`),
//! otherwise OMP would list every model twice.
//!
//! Writes are line-level on the `models:` block only; every other byte (comments,
//! keys, other providers) is preserved, with a timestamped backup, read-back
//! verification and restore on failure. OMP recomputes its `models.db` static
//! fingerprint from the file contents, so no cache invalidation is needed.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_yaml_ng::{Mapping, Value};

use super::models_yml_write::{block_end, commit_text, ensure_newline, find_child, parse_line};
use crate::contracts::{ModelEntry, ModelSpec, ProviderConfig};

const NEW_INDENT: usize = 2;

pub fn models_yml_path() -> PathBuf {
    super::omp_config::home_agent_dir().join("models.yml")
}

fn load_root(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_yaml_ng::from_str(&text).ok()
}

fn provider_of<'a>(root: &'a Value, slug: &str) -> Option<&'a Value> {
    root.get("providers")?.get(slug).filter(|v| v.is_mapping())
}

/// Slugs of every provider block present in models.yml.
pub fn managed_slugs(path: &Path) -> HashSet<String> {
    load_root(path)
        .and_then(|r| {
            r.get("providers")?.as_mapping().map(|m| {
                m.iter()
                    .filter(|(_, v)| v.is_mapping())
                    .filter_map(|(k, _)| k.as_str().map(str::to_string))
                    .collect()
            })
        })
        .unwrap_or_default()
}

/// Models of one provider as `(id, fields)`; accepts the sequence form
/// (`- id: x`, bare strings) and the map form (`x: {..}`).
fn models_of(provider: &Value) -> Vec<(String, Mapping)> {
    let mut out = Vec::new();
    match provider.get("models") {
        Some(Value::Sequence(items)) => {
            for item in items {
                match item {
                    Value::String(id) => out.push((id.clone(), Mapping::new())),
                    Value::Mapping(m) => {
                        if let Some(id) = m.get("id").and_then(Value::as_str) {
                            out.push((id.to_string(), m.clone()));
                        }
                    }
                    _ => {}
                }
            }
        }
        Some(Value::Mapping(map)) => {
            for (k, v) in map {
                if let Some(id) = k.as_str() {
                    out.push((id.to_string(), v.as_mapping().cloned().unwrap_or_default()));
                }
            }
        }
        _ => {}
    }
    out
}

fn u32_field(m: &Mapping, key: &str) -> Option<u32> {
    m.get(key)
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
}

fn entry_of(id: String, fields: &Mapping) -> ModelEntry {
    let name = fields
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string);
    let context_window = u32_field(fields, "contextWindow");
    let max_tokens = u32_field(fields, "maxTokens");
    if name.is_none() && context_window.is_none() && max_tokens.is_none() {
        ModelEntry::Id(id)
    } else {
        ModelEntry::Spec(ModelSpec {
            id,
            name,
            context_window,
            max_tokens,
        })
    }
}

/// Models of `slug` in models.yml; `None` when the file or provider is absent.
#[cfg(test)]
fn read_models(path: &Path, slug: &str) -> Option<Vec<ModelEntry>> {
    let root = load_root(path)?;
    let provider = provider_of(&root, slug)?;
    Some(
        models_of(provider)
            .into_iter()
            .map(|(id, f)| entry_of(id, &f))
            .collect(),
    )
}

/// Replace each provider's model list with the one in models.yml when the
/// provider exists there.
pub fn overlay_models(path: &Path, providers: &mut [ProviderConfig]) {
    let Some(root) = load_root(path) else {
        return;
    };
    for p in providers {
        if let Some(provider) = provider_of(&root, &p.slug) {
            p.models = models_of(provider)
                .into_iter()
                .map(|(id, f)| entry_of(id, &f))
                .collect();
        }
    }
}

fn set_or_remove(m: &mut Mapping, key: &str, value: Option<Value>) {
    match value {
        Some(v) => {
            m.insert(Value::String(key.into()), v);
        }
        None => {
            m.remove(key);
        }
    }
}

/// Build the new model items, keeping fields the app does not edit
/// (`reasoning`, `thinking`, `input`, …) of models that already exist.
fn build_items(existing: &[(String, Mapping)], models: &[ModelEntry]) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for entry in models {
        let id = entry.id().trim();
        if id.is_empty() || !seen.insert(id.to_string()) {
            continue;
        }
        let mut item = Mapping::new();
        item.insert("id".into(), Value::String(id.into()));
        if let Some((_, old)) = existing.iter().find(|(i, _)| i == id) {
            for (k, v) in old {
                if k.as_str() != Some("id") {
                    item.insert(k.clone(), v.clone());
                }
            }
        }
        if let ModelEntry::Spec(spec) = entry {
            set_or_remove(
                &mut item,
                "name",
                spec.name
                    .clone()
                    .filter(|n| !n.trim().is_empty())
                    .map(Value::String),
            );
            set_or_remove(
                &mut item,
                "contextWindow",
                spec.context_window.map(|v| Value::Number(v.into())),
            );
            set_or_remove(
                &mut item,
                "maxTokens",
                spec.max_tokens.map(|v| Value::Number(v.into())),
            );
        }
        items.push(Value::Mapping(item));
    }
    items
}

/// Exclusive end of the `models:` value block at line `start` (indent `indent`):
/// deeper lines plus same-indent `- ` sequence items (OMP's own layout).
fn models_block_end(lines: &[&str], start: usize, indent: usize) -> usize {
    let mut end = start + 1;
    for (i, raw) in lines.iter().enumerate().skip(start + 1) {
        let l = parse_line(raw);
        if l.trivia {
            continue;
        }
        let is_item = l.indent == indent && raw.trim_start().starts_with("- ");
        if l.indent < indent || (l.indent == indent && !is_item) {
            break;
        }
        end = i + 1;
    }
    end
}

fn render_block(indent: usize, items: &[Value]) -> Result<String, String> {
    let pad = " ".repeat(indent);
    if items.is_empty() {
        return Ok(format!("{pad}models: []\n"));
    }
    let body = serde_yaml_ng::to_string(&Value::Sequence(items.to_vec()))
        .map_err(|_| "序列化模型列表失败".to_string())?;
    let mut out = format!("{pad}models:\n");
    for line in body.lines() {
        out.push_str(&pad);
        out.push_str(line);
        out.push('\n');
    }
    Ok(out)
}

/// Pure text transform: replace (or add) `providers.<slug>.models`.
fn replace_models_text(text: &str, slug: &str, items: &[Value]) -> Result<String, String> {
    let mut out: Vec<String> = text.split_inclusive('\n').map(str::to_string).collect();
    let lines: Vec<&str> = out.iter().map(String::as_str).collect();
    let missing = || "models.yml 中找不到该供应商，无法写入".to_string();

    let (providers_at, _) = find_child(&lines, (0, lines.len()), None, "providers")?;
    let providers_at = providers_at.ok_or_else(missing)?;
    let p_indent = parse_line(lines[providers_at]).indent;
    let p_range = (providers_at + 1, block_end(&lines, providers_at, p_indent));
    let (slug_at, _) = find_child(&lines, p_range, Some(p_indent), slug)?;
    let slug_at = slug_at.ok_or_else(missing)?;
    let s_indent = parse_line(lines[slug_at]).indent;
    let s_range = (slug_at + 1, block_end(&lines, slug_at, s_indent));

    // Direct `models` child of the provider (not found through `find_child`,
    // which rejects inline `models: [...]`).
    let mut child_indent = None;
    let mut models_at = None;
    for (i, raw) in lines.iter().enumerate().take(s_range.1).skip(s_range.0) {
        let l = parse_line(raw);
        if l.trivia {
            continue;
        }
        let ci = *child_indent.get_or_insert(l.indent);
        if l.indent == ci && l.entry.as_ref().is_some_and(|(k, _)| k == "models") {
            models_at = Some((i, ci));
            break;
        }
    }

    match models_at {
        Some((i, ci)) => {
            let end = models_block_end(&lines, i, ci);
            let block = render_block(ci, items)?;
            out.splice(i..end, [block]);
        }
        None => {
            let ci = child_indent.unwrap_or(s_indent + NEW_INDENT);
            let block = render_block(ci, items)?;
            ensure_newline(&mut out, s_range.1);
            out.insert(s_range.1, block);
        }
    }
    Ok(out.concat())
}

fn same_models(got: &[ModelEntry], want: &[ModelEntry]) -> bool {
    let mut seen = HashSet::new();
    let want: Vec<&ModelEntry> = want
        .iter()
        .filter(|m| {
            let id = m.id().trim();
            !id.is_empty() && seen.insert(id.to_string())
        })
        .collect();
    got.len() == want.len()
        && got.iter().zip(&want).all(|(g, w)| match (g, w) {
            (_, ModelEntry::Id(id)) => g.id() == id.trim(),
            (ModelEntry::Spec(g), ModelEntry::Spec(w)) => {
                g.id == w.id.trim()
                    && g.context_window == w.context_window
                    && g.max_tokens == w.max_tokens
                    && g.name == w.name.clone().filter(|n| !n.trim().is_empty())
            }
            (ModelEntry::Id(g), ModelEntry::Spec(w)) => {
                g == w.id.trim()
                    && w.name.as_deref().map_or(true, |n| n.trim().is_empty())
                    && w.context_window.is_none()
                    && w.max_tokens.is_none()
            }
        })
}

/// Write `models` into `providers.<slug>.models`. Returns `Ok(false)` without
/// touching anything when models.yml has no such provider.
pub fn write_models(path: &Path, slug: &str, models: &[ModelEntry]) -> Result<bool, String> {
    let Ok(original) = std::fs::read_to_string(path) else {
        return Ok(false);
    };
    let Ok(root) = serde_yaml_ng::from_str::<Value>(&original) else {
        // Unparsable file: never edit it blindly, and never block app saves.
        return Ok(false);
    };
    let Some(provider) = provider_of(&root, slug) else {
        return Ok(false);
    };
    let items = build_items(&models_of(provider), models);
    let text = replace_models_text(&original, slug, &items)?;
    if text == original {
        return Ok(true);
    }
    commit_text(path, true, &text, &|written| {
        let root: Value = serde_yaml_ng::from_str(written)
            .map_err(|_| "写入后 models.yml 无法解析".to_string())?;
        let got: Vec<ModelEntry> = provider_of(&root, slug)
            .map(|p| {
                models_of(p)
                    .into_iter()
                    .map(|(id, f)| entry_of(id, &f))
                    .collect()
            })
            .unwrap_or_default();
        if same_models(&got, models) {
            Ok(())
        } else {
            Err(format!("写入后校验失败: {slug}"))
        }
    })?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = "# keep me\nproviders:\n  other:\n    baseUrl: https://o.example\n    apiKey: FAKE_OTHER\n    models:\n      - id: o1\n  swift:\n    api: openai-completions\n    baseUrl: https://s.example/v1\n    apiKey: FAKE_SECRET\n    models:\n    - id: a\n      name: A\n    - id: g\n      name: G\n      reasoning: true\n      contextWindow: 1000\n      thinking:\n        mode: effort\n        efforts:\n        - low\n    modelOverrides:\n      a:\n        contextWindow: 5\n  tail:\n    baseUrl: https://t.example\n# end\n";

    fn fixture(text: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ompws-myp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("models.yml");
        std::fs::write(&p, text).unwrap();
        (dir, p)
    }

    fn spec(id: &str, name: Option<&str>, cw: Option<u32>) -> ModelEntry {
        ModelEntry::Spec(ModelSpec {
            id: id.into(),
            name: name.map(str::to_string),
            context_window: cw,
            max_tokens: None,
        })
    }

    #[test]
    fn parse_same_indent_sequence_in_omp_config_and_reader() {
        let (dir, p) = fixture(FIXTURE);
        let raw = super::super::omp_config::parse_yaml_providers(FIXTURE, true);
        let swift = raw.iter().find(|r| r.id == "swift").unwrap();
        assert_eq!(swift.model_ids, vec!["a".to_string(), "g".to_string()]);
        let models = read_models(&p, "swift").unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0], spec("a", Some("A"), None));
        assert_eq!(models[1], spec("g", Some("G"), Some(1000)));
        assert!(read_models(&p, "missing").is_none());
        assert!(managed_slugs(&p).contains("tail"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn write_round_trip_preserves_rest_and_extra_fields() {
        let (dir, p) = fixture(FIXTURE);
        let new = vec![
            spec("g", Some("G2"), Some(2000)),
            ModelEntry::Id("new-model".into()),
            ModelEntry::Id("g".into()),
        ];
        assert!(write_models(&p, "swift", &new).unwrap());
        let text = std::fs::read_to_string(&p).unwrap();
        // untouched content survives byte for byte
        assert!(text.starts_with("# keep me\nproviders:\n  other:\n"));
        assert!(text.contains("    apiKey: FAKE_SECRET\n"));
        assert!(text.contains("    modelOverrides:\n      a:\n        contextWindow: 5\n"));
        assert!(text.ends_with("  tail:\n    baseUrl: https://t.example\n# end\n"));
        // OMP layout kept; unedited fields of existing models kept; removed model gone
        assert!(text.contains("    models:\n    - id: g\n"));
        assert!(text.contains("reasoning: true"));
        assert!(text.contains("efforts:"));
        assert!(!text.contains("name: A\n"));
        let back = read_models(&p, "swift").unwrap();
        assert_eq!(
            back,
            vec![
                spec("g", Some("G2"), Some(2000)),
                "new-model".to_string().into()
            ]
        );
        // other providers untouched
        assert_eq!(
            read_models(&p, "other").unwrap(),
            vec![ModelEntry::Id("o1".into())]
        );
        // backup exists
        let baks = std::fs::read_dir(&dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("models.yml.bak-")
            })
            .count();
        assert_eq!(baks, 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn write_handles_indented_inline_empty_and_missing_models() {
        let text = "providers:\n  p:\n    baseUrl: x\n    models:\n      - id: a\n  q:\n    baseUrl: y\n    models: [b, c]\n  r:\n    baseUrl: z\n";
        let (dir, p) = fixture(text);
        write_models(&p, "p", &[ModelEntry::Id("a2".into())]).unwrap();
        write_models(&p, "q", &[spec("c", None, Some(9))]).unwrap();
        write_models(&p, "r", &["m".to_string().into()]).unwrap();
        assert_eq!(
            read_models(&p, "p").unwrap(),
            vec![ModelEntry::Id("a2".into())]
        );
        assert_eq!(
            read_models(&p, "q").unwrap(),
            vec![spec("c", None, Some(9))]
        );
        assert_eq!(
            read_models(&p, "r").unwrap(),
            vec![ModelEntry::Id("m".into())]
        );
        write_models(&p, "p", &[]).unwrap();
        assert!(read_models(&p, "p").unwrap().is_empty());
        assert!(std::fs::read_to_string(&p)
            .unwrap()
            .contains("    models: []\n"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn write_skips_absent_provider_or_file() {
        let (dir, p) = fixture(FIXTURE);
        assert!(!write_models(&p, "nope", &[ModelEntry::Id("x".into())]).unwrap());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), FIXTURE);
        assert!(!write_models(&dir.join("none.yml"), "swift", &[]).unwrap());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn overlay_replaces_models_only_for_managed_slugs() {
        let (dir, p) = fixture(FIXTURE);
        let mut list = vec![
            ProviderConfig {
                slug: "swift".into(),
                models: vec![ModelEntry::Id("stale".into())],
                ..Default::default()
            },
            ProviderConfig {
                slug: "app-only".into(),
                models: vec![ModelEntry::Id("keep".into())],
                ..Default::default()
            },
        ];
        overlay_models(&p, &mut list);
        assert_eq!(list[0].models.len(), 2);
        assert_eq!(list[1].models, vec![ModelEntry::Id("keep".into())]);
        std::fs::remove_dir_all(dir).ok();
    }
}
