//! Provider blocks in OMP's own `~/.omp/agent/models.yml`.
//!
//! This is the single place the app reads and edits `providers.<id>` there:
//! creating / updating / renaming / deleting a block, and setting or removing
//! its `apiKey`. Edits are line-level, so every byte outside the touched lines
//! (comments, other providers, unknown fields) is preserved. Writes reuse
//! `models_yml_write::commit_text`: timestamped backup, read-back verification
//! and restore on failure. OMP recomputes its `models.db` static fingerprint
//! from the file contents, so no cache invalidation is needed.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_yaml_ng::{Mapping, Value};

use super::models_yml_write::{
    block_end, commit_text, ensure_newline, find_child, opens_block, parse_line, yaml_key,
};
use crate::contracts::{ModelEntry, ModelSpec};

const NEW_INDENT: usize = 2;

pub fn models_yml_path() -> PathBuf {
    super::omp_config::home_agent_dir().join("models.yml")
}

/// One `providers.<id>` block as the app understands it. `api_key` is the raw
/// configured value (a literal, env-var name or `!command`); never log it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YmlProvider {
    pub id: String,
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub api_key: Option<String>,
    pub auth_none: bool,
    pub models: Vec<ModelEntry>,
}

fn str_field(m: &Value, key: &str) -> Option<String> {
    m.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Every provider block in `text`, in document order. `Err` when the text is
/// not valid YAML.
pub fn parse_providers(text: &str) -> Result<Vec<YmlProvider>, String> {
    let root: Value =
        serde_yaml_ng::from_str(text).map_err(|_| "现有 models.yml 无法解析".to_string())?;
    let Some(map) = root.get("providers").and_then(Value::as_mapping) else {
        return Ok(Vec::new());
    };
    Ok(map
        .iter()
        .filter(|(_, v)| v.is_mapping())
        .filter_map(|(k, v)| {
            Some(YmlProvider {
                id: k.as_str()?.to_string(),
                name: str_field(v, "name"),
                base_url: str_field(v, "baseUrl"),
                api: str_field(v, "api"),
                api_key: str_field(v, "apiKey"),
                auth_none: str_field(v, "auth").is_some_and(|a| a.eq_ignore_ascii_case("none")),
                models: models_of(v)
                    .into_iter()
                    .map(|(id, f)| entry_of(id, &f))
                    .collect(),
            })
        })
        .collect())
}

/// Providers of the file at `path`; a missing file is an empty list.
pub fn read_providers(path: &Path) -> Result<Vec<YmlProvider>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => parse_providers(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("读取 models.yml 失败: {}", e.kind())),
    }
}

fn provider_of<'a>(root: &'a Value, id: &str) -> Option<&'a Value> {
    root.get("providers")?.get(id).filter(|v| v.is_mapping())
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
pub(super) fn models_block_end(lines: &[&str], start: usize, indent: usize) -> usize {
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
// ---------------------------------------------------------------------------
// Line-level provider block editing.
// ---------------------------------------------------------------------------

/// YAML scalar for `s`: plain when it round-trips as the same string, else a
/// double-quoted (JSON-escaped) scalar.
pub fn yaml_scalar(s: &str) -> String {
    let plain = s.starts_with(|c: char| c.is_ascii_alphanumeric())
        && s.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | '+' | '=' | ':')
        });
    if plain
        && serde_yaml_ng::from_str::<Value>(s)
            .ok()
            .as_ref()
            .and_then(Value::as_str)
            == Some(s)
    {
        s.to_string()
    } else {
        super::key_ref::yaml_double_quoted(s)
    }
}

/// Mapping-key text for a provider id (quoted when plain would not parse back
/// to the same string, e.g. `true`, `123`, spaces, non-ASCII).
fn key_text(id: &str) -> String {
    let k = yaml_key(id);
    if k.starts_with('"')
        || serde_yaml_ng::from_str::<Value>(&k)
            .ok()
            .as_ref()
            .and_then(Value::as_str)
            == Some(id)
    {
        k
    } else {
        super::key_ref::yaml_double_quoted(id)
    }
}

struct Prov {
    line: usize,
    indent: usize,
    end: usize,
}

struct Loc {
    providers_at: Option<usize>,
    p_indent: usize,
    p_end: usize,
    p_child_indent: Option<usize>,
    prov: Option<Prov>,
}

fn locate(lines: &[&str], id: &str) -> Result<Loc, String> {
    let (pa, _) = find_child(lines, (0, lines.len()), None, "providers")?;
    let Some(pa) = pa else {
        return Ok(Loc {
            providers_at: None,
            p_indent: 0,
            p_end: lines.len(),
            p_child_indent: None,
            prov: None,
        });
    };
    let p_indent = parse_line(lines[pa]).indent;
    let p_end = block_end(lines, pa, p_indent);
    let (hit, p_child_indent) = find_child(lines, (pa + 1, p_end), Some(p_indent), id)?;
    let prov = hit.map(|i| {
        let indent = parse_line(lines[i]).indent;
        Prov {
            line: i,
            indent,
            end: block_end(lines, i, indent),
        }
    });
    Ok(Loc {
        providers_at: Some(pa),
        p_indent,
        p_end,
        p_child_indent,
        prov,
    })
}

fn split_lines(text: &str) -> Vec<String> {
    text.split_inclusive('\n').map(str::to_string).collect()
}

fn borrow(out: &[String]) -> Vec<&str> {
    out.iter().map(String::as_str).collect()
}

fn eol_of(raw: &str) -> &'static str {
    if raw.ends_with("\r\n") {
        "\r\n"
    } else if raw.ends_with('\n') {
        "\n"
    } else {
        ""
    }
}

/// Append an empty `providers.<id>:` block when it does not exist yet.
pub fn ensure_provider(text: &str, id: &str) -> Result<String, String> {
    let mut out = split_lines(text);
    let loc = locate(&borrow(&out), id)?;
    if loc.prov.is_some() {
        return Ok(text.to_string());
    }
    match loc.providers_at {
        None => {
            let at = out.len();
            ensure_newline(&mut out, at);
            out.push("providers:\n".to_string());
            out.push(format!("{}{}:\n", " ".repeat(NEW_INDENT), key_text(id)));
        }
        Some(_) => {
            let indent = loc.p_child_indent.unwrap_or(loc.p_indent + NEW_INDENT);
            ensure_newline(&mut out, loc.p_end);
            out.insert(
                loc.p_end,
                format!("{}{}:\n", " ".repeat(indent), key_text(id)),
            );
        }
    }
    Ok(out.concat())
}

/// Set (`Some(rendered scalar)`), replace or remove (`None`) the single-line
/// child `key` of `providers.<id>`. Everything else is left untouched.
pub fn set_field(text: &str, id: &str, key: &str, value: Option<&str>) -> Result<String, String> {
    let mut out = split_lines(text);
    let loc = locate(&borrow(&out), id)?;
    let prov = loc
        .prov
        .ok_or_else(|| "models.yml 中找不到该供应商".to_string())?;

    let mut child_indent = None;
    let mut found = None;
    {
        let lines = borrow(&out);
        for (i, raw) in lines.iter().enumerate().take(prov.end).skip(prov.line + 1) {
            let l = parse_line(raw);
            if l.trivia {
                continue;
            }
            let ci = *child_indent.get_or_insert(l.indent);
            if l.indent == ci {
                if let Some((k, rest)) = &l.entry {
                    if k == key {
                        let t = rest.trim();
                        if opens_block(rest) || t.starts_with(['|', '>']) {
                            return Err(format!("models.yml 中 `{key}` 不是单行值，无法安全编辑"));
                        }
                        found = Some((i, ci));
                        break;
                    }
                }
            }
        }
    }
    match (found, value) {
        (Some((i, ci)), Some(v)) => {
            let eol = eol_of(&out[i]);
            out[i] = format!("{}{}: {v}{eol}", " ".repeat(ci), yaml_key(key));
        }
        (Some((i, _)), None) => {
            out.remove(i);
        }
        (None, Some(v)) => {
            let ci = child_indent.unwrap_or(prov.indent + NEW_INDENT);
            ensure_newline(&mut out, prov.line + 1);
            out.insert(
                prov.line + 1,
                format!("{}{}: {v}\n", " ".repeat(ci), yaml_key(key)),
            );
        }
        (None, None) => {}
    }
    Ok(out.concat())
}

/// Delete the whole `providers.<id>` block (an emptied `providers:` goes too).
pub fn remove_provider(text: &str, id: &str) -> Result<String, String> {
    let mut out = split_lines(text);
    let loc = locate(&borrow(&out), id)?;
    let prov = loc
        .prov
        .ok_or_else(|| "models.yml 中找不到该供应商".to_string())?;
    out.drain(prov.line..prov.end);
    if let Some(pa) = loc.providers_at {
        if block_end(&borrow(&out), pa, loc.p_indent) == pa + 1 {
            out.remove(pa);
        }
    }
    Ok(out.concat())
}

/// Rename the key of `providers.<old>` to `new`, keeping the block body.
pub fn rename_provider(text: &str, old: &str, new: &str) -> Result<String, String> {
    let mut out = split_lines(text);
    let lines = borrow(&out);
    if locate(&lines, new)?.prov.is_some() {
        return Err("供应商 ID 已存在".to_string());
    }
    let prov = locate(&lines, old)?
        .prov
        .ok_or_else(|| "models.yml 中找不到该供应商".to_string())?;
    let rest = parse_line(lines[prov.line])
        .entry
        .map(|(_, rest)| rest.to_string())
        .unwrap_or_default();
    let eol = eol_of(&out[prov.line]);
    out[prov.line] = format!("{}{}:{rest}{eol}", " ".repeat(prov.indent), key_text(new));
    Ok(out.concat())
}

/// Fields the app edits on a custom provider block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockSpec {
    pub id: String,
    pub name: Option<String>,
    pub base_url: String,
    pub api: String,
    pub models: Vec<ModelEntry>,
    /// Write `auth: none` (local engines without a key).
    pub auth_none: bool,
}

/// Create or update `providers.<spec.id>`: sets `name`/`baseUrl`/`api`/models and
/// leaves every other field of an existing block (incl. `apiKey`) untouched.
pub fn upsert_block_text(text: &str, spec: &BlockSpec) -> Result<String, String> {
    let mut t = ensure_provider(text, &spec.id)?;
    let root: Value =
        serde_yaml_ng::from_str(&t).map_err(|_| "现有 models.yml 无法解析".to_string())?;
    let provider = provider_of(&root, &spec.id);
    let existing = provider.map(models_of).unwrap_or_default();
    let has_models_key = provider.is_some_and(|p| p.get("models").is_some());
    if !spec.models.is_empty() || has_models_key {
        let items = build_items(&existing, &spec.models);
        t = replace_models_text(&t, &spec.id, &items)?;
    }
    t = set_field(&t, &spec.id, "api", Some(&yaml_scalar(spec.api.trim())))?;
    t = set_field(
        &t,
        &spec.id,
        "baseUrl",
        Some(&yaml_scalar(spec.base_url.trim())),
    )?;
    let name = spec
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(yaml_scalar);
    t = set_field(&t, &spec.id, "name", name.as_deref())?;
    if spec.auth_none {
        t = set_field(&t, &spec.id, "auth", Some("none"))?;
    }
    Ok(t)
}

/// `(discovery type, api)` OMP needs in a `providers.<id>` block of a
/// discovery-only local engine, or implicit discovery is cancelled.
pub fn discovery_spec(id: &str) -> Option<(&'static str, &'static str)> {
    match id {
        "ollama" => Some(("ollama", "ollama")),
        "llama.cpp" => Some(("llama.cpp", "openai-completions")),
        "lm-studio" => Some(("lm-studio", "openai-completions")),
        "litellm" => Some(("litellm", "openai-completions")),
        "vllm" => Some(("openai-models-list", "openai-completions")),
        _ => None,
    }
}

/// `None` when `providers.<id>` is absent, else whether it has no fields.
pub fn block_is_empty(text: &str, id: &str) -> Result<Option<bool>, String> {
    let root: Value =
        serde_yaml_ng::from_str(text).map_err(|_| "现有 models.yml 无法解析".to_string())?;
    Ok(match root.get("providers").and_then(|p| p.get(id)) {
        None => None,
        Some(Value::Null) => Some(true),
        Some(Value::Mapping(m)) => Some(m.is_empty()),
        Some(_) => Some(false),
    })
}

/// Add `discovery: { type }` and `api` to `providers.<id>` for a
/// discovery-only local engine; fields that already exist are kept.
pub fn ensure_discovery_text(text: &str, id: &str) -> Result<String, String> {
    let Some((kind, api)) = discovery_spec(id) else {
        return Ok(text.to_string());
    };
    let root: Value =
        serde_yaml_ng::from_str(text).map_err(|_| "现有 models.yml 无法解析".to_string())?;
    let block = root.get("providers").and_then(|p| p.get(id));
    let has = |k: &str| block.is_some_and(|b| b.get(k).is_some());
    let mut t = text.to_string();
    if !has("discovery") {
        t = set_field(&t, id, "discovery", Some(&format!("{{ type: {kind} }}")))?;
    }
    if !has("api") {
        t = set_field(&t, id, "api", Some(&yaml_scalar(api)))?;
    }
    Ok(t)
}

/// Replace `providers.<id>.models`; an empty list removes the key entirely.
pub fn set_models_text(text: &str, id: &str, models: &[ModelEntry]) -> Result<String, String> {
    let root: Value =
        serde_yaml_ng::from_str(text).map_err(|_| "现有 models.yml 无法解析".to_string())?;
    let provider = provider_of(&root, id);
    let has_key = provider.is_some_and(|p| p.get("models").is_some());
    if models.is_empty() && !has_key {
        return Ok(text.to_string());
    }
    let existing = provider.map(models_of).unwrap_or_default();
    let t = replace_models_text(text, id, &build_items(&existing, models))?;
    if models.is_empty() {
        set_field(&t, id, "models", None)
    } else {
        Ok(t)
    }
}

/// Read-back check for a built-in override block: `baseUrl`, `auth: none` and
/// the extra models. `None` for `base_url` means no override.
pub fn verify_override(
    text: &str,
    id: &str,
    base_url: Option<&str>,
    auth_none: bool,
    models: &[ModelEntry],
) -> Result<(), String> {
    let all = parse_providers(text).map_err(|_| "写入后 models.yml 无法解析".to_string())?;
    let fail = || format!("写入后校验失败: {id}");
    let Some(got) = all.iter().find(|p| p.id == id) else {
        return Err(fail());
    };
    if got.base_url.as_deref() == base_url
        && got.auth_none == auth_none
        && (models.is_empty() && got.models.is_empty() || same_models(&got.models, models))
    {
        Ok(())
    } else {
        Err(fail())
    }
}

/// Read-back check for [`upsert_block_text`].
pub fn verify_block(text: &str, spec: &BlockSpec) -> Result<(), String> {
    let all = parse_providers(text).map_err(|_| "写入后 models.yml 无法解析".to_string())?;
    let got = all
        .iter()
        .find(|p| p.id == spec.id)
        .ok_or_else(|| format!("写入后校验失败: {}", spec.id))?;
    let name = spec
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty());
    let ok = got.base_url.as_deref() == Some(spec.base_url.trim())
        && got.api.as_deref() == Some(spec.api.trim())
        && got.name.as_deref() == name
        && (spec.models.is_empty() && got.models.is_empty()
            || same_models(&got.models, &spec.models));
    if ok {
        Ok(())
    } else {
        Err(format!("写入后校验失败: {}", spec.id))
    }
}

/// Edit the YAML file at `path` (`models.yml` / `config.yml`) with `edit`, then
/// verify with `check` on the read-back text. Creates the file when absent;
/// backup + restore on failure. `edit` must be a pure text transform. Unchanged
/// output writes nothing.
pub fn edit_file(
    path: &Path,
    edit: &dyn Fn(&str) -> Result<String, String>,
    check: &dyn Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    let label = path.file_name().map_or_else(
        || "models.yml".to_string(),
        |n| n.to_string_lossy().into_owned(),
    );
    let existed = path.exists();
    let original = if existed {
        std::fs::read_to_string(path).map_err(|e| format!("读取 {label} 失败: {}", e.kind()))?
    } else {
        String::new()
    };
    if existed && serde_yaml_ng::from_str::<Value>(&original).is_err() {
        return Err(format!("现有 {label} 无法解析，未做修改"));
    }
    let text = edit(&original)?;
    if text == original {
        return Ok(());
    }
    commit_text(path, existed, &text, check)
}

/// Ids of all provider blocks (for duplicate checks).
pub fn ids_in(text: &str) -> HashSet<String> {
    parse_providers(text)
        .map(|v| v.into_iter().map(|p| p.id).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = "# keep me\nproviders:\n  other:\n    baseUrl: https://o.example\n    apiKey: FAKE_OTHER\n    models:\n      - id: o1\n  swift:\n    api: openai-completions\n    baseUrl: https://s.example/v1\n    apiKey: FAKE_SECRET # trailing\n    models:\n    - id: a\n      name: A\n    - id: g\n      name: G\n      reasoning: true\n      contextWindow: 1000\n      thinking:\n        mode: effort\n        efforts:\n        - low\n    modelOverrides:\n      a:\n        contextWindow: 5\n  \"聪明 AI-散户\":\n    baseUrl: https://t.example\n# end\n";

    fn block(text: &str, id: &str) -> String {
        let out = split_lines(text);
        let lines = borrow(&out);
        let prov = locate(&lines, id).unwrap().prov.expect("provider present");
        lines[prov.line..prov.end].concat()
    }

    fn spec(id: &str) -> BlockSpec {
        BlockSpec {
            id: id.into(),
            name: Some("Nice Name".into()),
            base_url: "https://new.example/v1".into(),
            api: "openai-completions".into(),
            models: vec![
                ModelEntry::Id("m1".into()),
                ModelEntry::Spec(ModelSpec {
                    id: "m2".into(),
                    name: Some("M Two".into()),
                    context_window: Some(64000),
                    max_tokens: Some(4096),
                }),
            ],
            auth_none: false,
        }
    }

    #[test]
    fn scalar_and_key_quoting() {
        assert_eq!(yaml_scalar("sk-abc123"), "sk-abc123");
        assert_eq!(yaml_scalar("https://a.example/v1"), "https://a.example/v1");
        for tricky in [
            "true", "123", "null", "1.5", "a b", "a: b", "#x", "", "x:", "!cmd", "聪明",
        ] {
            let q = yaml_scalar(tricky);
            let v: Value = serde_yaml_ng::from_str(&q).unwrap();
            assert_eq!(v.as_str(), Some(tricky), "{tricky} -> {q}");
        }
        assert_eq!(key_text("openrouter"), "openrouter");
        for id in ["true", "123", "a b", "聪明 AI-散户", "it's", "a:b"] {
            let t = format!("{}: 1\n", key_text(id));
            let v: Value = serde_yaml_ng::from_str(&t).unwrap();
            assert!(v.get(id).is_some(), "{id} -> {t}");
        }
    }

    #[test]
    fn parse_reads_every_block_in_order() {
        let all = parse_providers(FIXTURE).unwrap();
        let ids: Vec<_> = all.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["other", "swift", "聪明 AI-散户"]);
        let swift = &all[1];
        assert_eq!(swift.api_key.as_deref(), Some("FAKE_SECRET"));
        assert_eq!(swift.models.len(), 2);
        assert!(!swift.auth_none);
        assert!(parse_providers("a: [").is_err());
        assert!(parse_providers("other: 1\n").unwrap().is_empty());
    }

    #[test]
    fn insert_appends_block_and_keeps_others_byte_identical() {
        let out = upsert_block_text(FIXTURE, &spec("brand new")).unwrap();
        for id in ["other", "swift", "聪明 AI-散户"] {
            assert_eq!(block(&out, id), block(FIXTURE, id), "{id}");
        }
        assert!(out.starts_with("# keep me\n"));
        assert!(out.ends_with("# end\n") || out.contains("# end\n"));
        verify_block(&out, &spec("brand new")).unwrap();
        let got = parse_providers(&out).unwrap();
        let p = got.iter().find(|p| p.id == "brand new").unwrap();
        assert_eq!(p.name.as_deref(), Some("Nice Name"));
        assert_eq!(p.models.len(), 2);
        assert_eq!(p.api_key, None);
    }

    #[test]
    fn insert_into_file_without_providers_or_empty() {
        let out = upsert_block_text("", &spec("p")).unwrap();
        verify_block(&out, &spec("p")).unwrap();
        let out = upsert_block_text("other: 1", &spec("p")).unwrap();
        assert!(out.starts_with("other: 1\nproviders:\n  p:\n"));
        verify_block(&out, &spec("p")).unwrap();
    }

    #[test]
    fn update_keeps_api_key_unknown_fields_and_others() {
        let mut s = spec("swift");
        s.models = vec![
            ModelEntry::Spec(ModelSpec {
                id: "g".into(),
                name: Some("G2".into()),
                context_window: Some(2000),
                max_tokens: None,
            }),
            ModelEntry::Id("fresh".into()),
        ];
        s.name = None;
        let out = upsert_block_text(FIXTURE, &s).unwrap();
        for id in ["other", "聪明 AI-散户"] {
            assert_eq!(block(&out, id), block(FIXTURE, id), "{id}");
        }
        let b = block(&out, "swift");
        assert!(b.contains("    apiKey: FAKE_SECRET # trailing\n"));
        assert!(b.contains("reasoning: true"));
        assert!(b.contains("modelOverrides:\n      a:\n        contextWindow: 5\n"));
        assert!(b.contains("baseUrl: https://new.example/v1\n"));
        verify_block(&out, &s).unwrap();
    }

    #[test]
    fn delete_leaves_others_identical_and_drops_empty_providers() {
        let out = remove_provider(FIXTURE, "swift").unwrap();
        assert_eq!(block(&out, "other"), block(FIXTURE, "other"));
        assert_eq!(block(&out, "聪明 AI-散户"), block(FIXTURE, "聪明 AI-散户"));
        assert!(!out.contains("swift"));
        assert!(out.starts_with("# keep me\n") && out.ends_with("# end\n"));
        let only = "providers:\n  a:\n    baseUrl: x\n";
        assert_eq!(remove_provider(only, "a").unwrap(), "");
        assert!(remove_provider(only, "zz").is_err());
    }

    #[test]
    fn set_field_replaces_inserts_and_removes_api_key() {
        let out = set_field(FIXTURE, "swift", "apiKey", Some("\"!cmd\"")).unwrap();
        assert!(out.contains("    apiKey: \"!cmd\"\n"));
        assert!(!out.contains("FAKE_SECRET"));
        assert_eq!(block(&out, "other"), block(FIXTURE, "other"));
        let out = set_field(FIXTURE, "聪明 AI-散户", "apiKey", Some("k1")).unwrap();
        assert_eq!(
            block(&out, "聪明 AI-散户"),
            "  \"聪明 AI-散户\":\n    apiKey: k1\n    baseUrl: https://t.example\n"
        );
        let out = set_field(FIXTURE, "swift", "apiKey", None).unwrap();
        assert!(!out.contains("apiKey: FAKE_SECRET"));
        assert_eq!(set_field(FIXTURE, "other", "auth", None).unwrap(), FIXTURE);
        assert!(set_field(FIXTURE, "nope", "apiKey", Some("x")).is_err());
        let block_scalar = "providers:\n  p:\n    apiKey: |\n      abc\n";
        assert!(set_field(block_scalar, "p", "apiKey", Some("x")).is_err());
    }

    #[test]
    fn override_block_over_builtin_is_created_with_key_only() {
        let out = ensure_provider(FIXTURE, "opencode-zen").unwrap();
        let out = set_field(&out, "opencode-zen", "apiKey", Some("k")).unwrap();
        let all = parse_providers(&out).unwrap();
        let p = all.iter().find(|p| p.id == "opencode-zen").unwrap();
        assert_eq!(p.api_key.as_deref(), Some("k"));
        assert_eq!(p.base_url, None);
        assert_eq!(block(&out, "swift"), block(FIXTURE, "swift"));
    }

    #[test]
    fn rename_keeps_body_and_rejects_duplicates() {
        let out = rename_provider(FIXTURE, "swift", "swift 2").unwrap();
        assert!(out.contains("  \"swift 2\":\n    api: openai-completions\n"));
        assert!(parse_providers(&out)
            .unwrap()
            .iter()
            .any(|p| p.id == "swift 2"));
        assert!(rename_provider(FIXTURE, "swift", "other").is_err());
        assert!(rename_provider(FIXTURE, "nope", "x").is_err());
    }

    #[test]
    fn edit_file_backs_up_verifies_and_restores() {
        let dir = std::env::temp_dir().join(format!("ompws-myp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("models.yml");
        std::fs::write(&p, FIXTURE).unwrap();
        let s = spec("swift");
        edit_file(&p, &|t| upsert_block_text(t, &s), &|w| verify_block(w, &s)).unwrap();
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
        // A failing read-back check restores the previous content.
        let before = std::fs::read_to_string(&p).unwrap();
        let err = edit_file(&p, &|t| remove_provider(t, "swift"), &|_| {
            Err("boom".to_string())
        })
        .unwrap_err();
        assert!(err.contains("已恢复原文件"), "{err}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), before);
        // Unparseable files are never edited.
        std::fs::write(&p, "a: [").unwrap();
        assert!(edit_file(&p, &|t| Ok(format!("{t}x")), &|_| Ok(())).is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}
