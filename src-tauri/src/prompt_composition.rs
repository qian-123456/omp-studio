//! 系统提示词构成: what a brand-new, empty session would carry in its context.
//!
//! `prompt_composition_probe(cwd)` spawns a throwaway `omp --mode rpc --no-session --cwd <dir>`
//! (same model / privacy / providers / visualize wiring as an app session, but *without* the
//! status and checkpoints extensions, which write per-session files), sends one `get_state`
//! (zero model cost) and reads `systemPrompt` (string blocks), `dumpTools` and
//! `contextUsage`. The child is always shut down: stdin closed (graceful), then its process
//! group killed if it has not exited within [`GRACEFUL_EXIT`]; `kill_on_drop` covers a cancelled
//! command future. `--no-session` means no session file is ever created.
//!
//! [`compose`] sorts the raw blocks into categories (系统 prompt 主体 / 规则文件 / Skills 列表 /
//! 工具说明 / MCP 工具 / 其他) and [`build_hints`] derives rule-based optimization hints — both
//! pure, so they are unit-tested without a process. Token counts are estimates
//! ([`estimate_tokens`]); OMP's own total is returned alongside as a reference.

use std::collections::BTreeMap;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

use crate::contracts::Settings;
use crate::state::AppState;

/// Whole probe budget (spawn → last `get_state`).
const PROBE_TIMEOUT: Duration = Duration::from_secs(45);
/// Pause before the second `get_state`, so MCP servers that connect after start-up have
/// registered their tools.
const SETTLE_DELAY: Duration = Duration::from_millis(1500);
/// Time omp gets to exit after stdin closes before its process group is killed.
const GRACEFUL_EXIT: Duration = Duration::from_secs(3);
const ESTIMATE_NOTE: &str =
    "估算值：非中日韩字符约 3 个字符 ≈ 1 token，中日韩字符每个 ≈ 1 token；与模型实际计数有偏差，仅用于比较各部分的相对大小";

/// Category ids in display order.
const CATEGORY_ORDER: [(&str, &str); 6] = [
    ("system", "系统 prompt 主体"),
    ("rules", "规则文件"),
    ("skills", "Skills 列表"),
    ("tools", "工具说明"),
    ("mcp", "MCP 工具"),
    ("other", "其他"),
];

/// Skill descriptions above this many characters are flagged.
const BIG_SKILL_CHARS: usize = 220;
/// A single rule file above this many estimated tokens is flagged.
const BIG_RULE_TOKENS: u64 = 3000;
/// A single MCP tool above this many estimated tokens is flagged.
const BIG_MCP_TOOL_TOKENS: u64 = 1000;
/// Paragraphs shorter than this (whitespace-normalised) never count as duplicates.
const MIN_DUP_CHARS: usize = 80;
/// Duplicated content below this many tokens is not worth a hint.
const MIN_DUP_TOKENS: u64 = 40;

// ---------- IPC types (mirrored in src/lib/contracts.ts) ----------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptItem {
    pub id: String,
    pub title: String,
    /// Secondary line: rule-file path, MCP server, …
    pub detail: Option<String>,
    /// Raw text as omp sends it (tools: pretty JSON of name/description/parameters/examples).
    pub text: String,
    pub tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCategory {
    /// `system` | `rules` | `skills` | `tools` | `mcp` | `other`.
    pub id: String,
    pub label: String,
    pub tokens: u64,
    pub items: Vec<PromptItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptHint {
    pub id: String,
    /// `largest` | `duplicate` | `big_skill` | `skills_total` | `big_rule` | `rules_total` | `mcp_always` | `big_mcp_tool`.
    pub kind: String,
    /// `info` | `warn`.
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub item_ids: Vec<String>,
    /// Full quoted text the hint is about (duplicate paragraph), shown in full.
    pub quote: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptComposition {
    pub cwd: String,
    pub categories: Vec<PromptCategory>,
    /// Sum of the estimated category totals.
    pub total_tokens: u64,
    /// `contextUsage.tokens` omp reported for the empty session (its own estimate).
    pub reported_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub hints: Vec<PromptHint>,
    pub probe_ms: u64,
    /// How `tokens` are estimated (shown verbatim in the UI).
    pub estimate_note: String,
}

// ---------- token estimate ----------

fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{2e80}'..='\u{9fff}' | '\u{ac00}'..='\u{d7af}' | '\u{ff00}'..='\u{ffef}')
}

/// Estimated token count: CJK characters count 1 each, everything else 1 per 3 characters
/// (rounded up). Deliberately simple — see [`ESTIMATE_NOTE`].
pub fn estimate_tokens(text: &str) -> u64 {
    let mut cjk = 0u64;
    let mut other = 0u64;
    for c in text.chars() {
        if is_cjk(c) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    cjk + other.div_ceil(3)
}

// ---------- categorisation ----------

fn item(id: String, title: String, detail: Option<String>, text: String) -> PromptItem {
    let tokens = estimate_tokens(&text);
    PromptItem {
        id,
        title,
        detail,
        text,
        tokens,
    }
}

/// Splits `block` at the first `<tag …>…</tag>` pair: `(before, inner, after)`.
fn split_tag<'a>(block: &'a str, tag: &str) -> Option<(&'a str, &'a str, &'a str)> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = block.find(&open)?;
    let inner_start = start + open.len();
    let end = block[inner_start..].find(&close)? + inner_start;
    Some((
        &block[..start],
        &block[inner_start..end],
        &block[end + close.len()..],
    ))
}

/// `- name: description` entries (continuation lines are appended to the previous entry).
fn parse_skills(inner: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in inner.lines() {
        if let Some(rest) = line.strip_prefix("- ") {
            out.push((String::new(), rest.to_string()));
        } else if let Some(last) = out.last_mut() {
            last.1.push('\n');
            last.1.push_str(line);
        }
    }
    for entry in &mut out {
        if let Some((name, _)) = entry.1.split_once(':') {
            entry.0 = name.trim().to_string();
        }
    }
    out.retain(|(_, text)| !text.trim().is_empty());
    out
}

/// Context files inside `<repo-rules>`: `(path, content)` plus the block with those files cut out.
fn extract_rule_files(block: &str) -> (Vec<(String, String)>, String) {
    let Some(rules_start) = block.find("<repo-rules>") else {
        return (Vec::new(), block.to_string());
    };
    let rules_end = block[rules_start..]
        .find("</repo-rules>")
        .map(|i| i + rules_start)
        .unwrap_or(block.len());
    let rules = &block[rules_start..rules_end];
    let mut files = Vec::new();
    let mut remainder = String::from(&block[..rules_start]);
    let mut cursor = 0usize;
    while let Some(rel) = rules[cursor..].find("<file path=\"") {
        let tag_start = cursor + rel;
        let path_start = tag_start + "<file path=\"".len();
        let Some(path_len) = rules[path_start..].find('"') else {
            break;
        };
        let path = rules[path_start..path_start + path_len].to_string();
        let Some(gt) = rules[path_start + path_len..].find('>') else {
            break;
        };
        let body_start = path_start + path_len + gt + 1;
        let Some(close) = rules[body_start..].find("</file>") else {
            break;
        };
        let body = rules[body_start..body_start + close].trim_matches('\n');
        remainder.push_str(&rules[cursor..tag_start]);
        files.push((path, body.to_string()));
        cursor = body_start + close + "</file>".len();
    }
    remainder.push_str(&rules[cursor..]);
    remainder.push_str(&block[rules_end..]);
    (files, remainder)
}

fn trimmed_nonempty(text: &str) -> Option<String> {
    let t = text.trim();
    (!t.is_empty()).then(|| t.to_string())
}

fn tool_text(tool: &Value) -> String {
    let mut shown = serde_json::Map::new();
    for key in ["name", "description", "parameters", "examples"] {
        if let Some(v) = tool.get(key) {
            if !v.is_null() {
                shown.insert(key.to_string(), v.clone());
            }
        }
    }
    serde_json::to_string_pretty(&Value::Object(shown)).unwrap_or_default()
}

/// Token cost of a tool as the provider receives it: compact JSON.
fn tool_tokens(tool: &Value) -> u64 {
    let mut shown = serde_json::Map::new();
    for key in ["name", "description", "parameters", "examples"] {
        if let Some(v) = tool.get(key) {
            if !v.is_null() {
                shown.insert(key.to_string(), v.clone());
            }
        }
    }
    estimate_tokens(&Value::Object(shown).to_string())
}

/// MCP server a `mcp__<server>_<tool>` / `mcp__<server>__<tool>` tool name came from (best effort:
/// omp joins them with `_`, so a server name containing `_` cannot be told apart).
fn mcp_server(tool_name: &str) -> Option<String> {
    let rest = tool_name.strip_prefix("mcp__")?;
    let server = rest
        .split_once("__")
        .or_else(|| rest.split_once('_'))
        .map_or(rest, |(s, _)| s);
    Some(server.to_string())
}

/// Sorts raw `systemPrompt` blocks and `dumpTools` into the six categories.
pub fn compose(blocks: &[String], tools: &[Value]) -> Vec<PromptCategory> {
    let mut by_id: BTreeMap<&str, Vec<PromptItem>> = BTreeMap::new();
    let mut rule_n = 0usize;
    let mut other_n = 0usize;
    for (index, block) in blocks.iter().enumerate() {
        let mut body = block.clone();
        if let Some((before, inner, after)) = split_tag(block, "skills") {
            for (n, (name, text)) in parse_skills(inner).into_iter().enumerate() {
                let title = if name.is_empty() {
                    format!("Skill {}", n + 1)
                } else {
                    name.clone()
                };
                let id = format!(
                    "skill:{}",
                    if name.is_empty() { n.to_string() } else { name }
                );
                by_id
                    .entry("skills")
                    .or_default()
                    .push(item(id, title, None, text));
            }
            body = format!("{before}{after}");
        }
        if body.contains("<repo-rules>") {
            let (files, remainder) = extract_rule_files(&body);
            for (path, content) in files {
                rule_n += 1;
                by_id.entry("rules").or_default().push(item(
                    format!("rule:{rule_n}"),
                    path,
                    None,
                    content,
                ));
            }
            if let Some(text) = trimmed_nonempty(&remainder) {
                other_n += 1;
                by_id.entry("other").or_default().push(item(
                    format!("other:{other_n}"),
                    "项目环境信息（工作区、目录树等）".to_string(),
                    None,
                    text,
                ));
            }
        } else if let Some(text) = trimmed_nonempty(&body) {
            if index == 0 {
                by_id.entry("system").or_default().push(item(
                    "system:base".to_string(),
                    "系统 prompt 主体".to_string(),
                    None,
                    text,
                ));
            } else {
                other_n += 1;
                let first = text.lines().next().unwrap_or("").trim().to_string();
                by_id.entry("other").or_default().push(item(
                    format!("other:{other_n}"),
                    format!("附加指引 {}", index),
                    Some(first),
                    text,
                ));
            }
        }
    }
    for tool in tools {
        let Some(name) = tool.get("name").and_then(Value::as_str) else {
            continue;
        };
        let (cat, id, detail) = match mcp_server(name) {
            Some(server) => (
                "mcp",
                format!("mcp:{name}"),
                Some(format!("来自 MCP 服务器：{server}")),
            ),
            None => ("tools", format!("tool:{name}"), None),
        };
        let mut it = item(id, name.to_string(), detail, tool_text(tool));
        it.tokens = tool_tokens(tool);
        by_id.entry(cat).or_default().push(it);
    }
    CATEGORY_ORDER
        .iter()
        .map(|(id, label)| {
            let items = by_id.remove(id).unwrap_or_default();
            PromptCategory {
                id: (*id).to_string(),
                label: (*label).to_string(),
                tokens: items.iter().map(|i| i.tokens).sum(),
                items,
            }
        })
        .collect()
}

// ---------- hints ----------

fn normalize_ws(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn share(tokens: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        tokens as f64 * 100.0 / total as f64
    }
}

fn hint(
    id: String,
    kind: &str,
    severity: &str,
    title: String,
    detail: String,
    item_ids: Vec<String>,
    quote: Option<String>,
) -> PromptHint {
    PromptHint {
        id,
        kind: kind.to_string(),
        severity: severity.to_string(),
        title,
        detail,
        item_ids,
        quote,
    }
}

/// Rule-based optimization hints (no model call).
pub fn build_hints(categories: &[PromptCategory]) -> Vec<PromptHint> {
    let total: u64 = categories.iter().map(|c| c.tokens).sum();
    let cat = |id: &str| categories.iter().find(|c| c.id == id);
    let mut hints = Vec::new();

    // Largest single items.
    let mut all: Vec<(&PromptCategory, &PromptItem)> = categories
        .iter()
        .flat_map(|c| c.items.iter().map(move |i| (c, i)))
        .collect();
    all.sort_by_key(|(_, i)| std::cmp::Reverse(i.tokens));
    for (c, i) in all.iter().take(3) {
        let pct = share(i.tokens, total);
        if pct >= 5.0 {
            hints.push(hint(
                format!("largest:{}", i.id),
                "largest",
                "info",
                format!("「{}」是较大的一项", i.title),
                format!(
                    "属于「{}」，约 {} tokens（{:.0}%），每个新会话都会带上它。",
                    c.label, i.tokens, pct
                ),
                vec![i.id.clone()],
                None,
            ));
        }
    }

    if let Some(rules) = cat("rules") {
        let pct = share(rules.tokens, total);
        if pct >= 25.0 && !rules.items.is_empty() {
            hints.push(hint(
                "rules_total".to_string(),
                "rules_total",
                "warn",
                format!("规则文件占了 {pct:.0}%"),
                format!(
                    "{} 个规则文件共约 {} tokens。可把只在特定场景用到的内容拆到按需阅读的文档里，规则文件只留路由。",
                    rules.items.len(),
                    rules.tokens
                ),
                rules.items.iter().map(|i| i.id.clone()).collect(),
                None,
            ));
        }
        for i in rules.items.iter().filter(|i| i.tokens >= BIG_RULE_TOKENS) {
            hints.push(hint(
                format!("big_rule:{}", i.id),
                "big_rule",
                "warn",
                format!("规则文件「{}」很长", i.title),
                format!(
                    "{} 约 {} tokens。精简重复表述，或把细则放进按需读取的文档。",
                    i.title, i.tokens
                ),
                vec![i.id.clone()],
                None,
            ));
        }
        hints.extend(duplicate_hints(&rules.items));
    }

    if let Some(skills) = cat("skills") {
        let pct = share(skills.tokens, total);
        if pct >= 10.0 {
            hints.push(hint(
                "skills_total".to_string(),
                "skills_total",
                "warn",
                format!("Skills 列表占了 {pct:.0}%"),
                format!(
                    "{} 个 skill 的名称和说明共约 {} tokens，每个会话都会写进提示词。不常用的 skill 可以停用。",
                    skills.items.len(),
                    skills.tokens
                ),
                skills.items.iter().map(|i| i.id.clone()).collect(),
                None,
            ));
        }
        let big: Vec<&PromptItem> = skills
            .items
            .iter()
            .filter(|i| i.text.chars().count() > BIG_SKILL_CHARS)
            .collect();
        if !big.is_empty() {
            let names: Vec<&str> = big.iter().map(|i| i.title.as_str()).collect();
            hints.push(hint(
                "big_skill".to_string(),
                "big_skill",
                "info",
                format!("{} 个 skill 的说明偏长", big.len()),
                format!(
                    "说明超过 {BIG_SKILL_CHARS} 个字符：{}。skill 说明应只写「什么时候该用」，细节放进 skill 正文。",
                    names.join("、")
                ),
                big.iter().map(|i| i.id.clone()).collect(),
                None,
            ));
        }
    }

    if let Some(mcp) = cat("mcp") {
        if !mcp.items.is_empty() {
            let mut servers: Vec<String> = mcp
                .items
                .iter()
                .filter_map(|i| mcp_server(i.title.as_str()))
                .collect();
            servers.sort();
            servers.dedup();
            let pct = share(mcp.tokens, total);
            hints.push(hint(
                "mcp_always".to_string(),
                "mcp_always",
                if pct >= 15.0 { "warn" } else { "info" },
                format!("{} 个 MCP 工具每个会话都会加载", mcp.items.len()),
                format!(
                    "来自 {}，共约 {} tokens（{:.0}%）。只在个别项目用到的 MCP 服务器，可改为只在那个项目里启用。",
                    servers.join("、"),
                    mcp.tokens,
                    pct
                ),
                mcp.items.iter().map(|i| i.id.clone()).collect(),
                None,
            ));
            for i in mcp.items.iter().filter(|i| i.tokens >= BIG_MCP_TOOL_TOKENS) {
                hints.push(hint(
                    format!("big_mcp_tool:{}", i.id),
                    "big_mcp_tool",
                    "info",
                    format!("MCP 工具「{}」说明很长", i.title),
                    format!("约 {} tokens，是单个工具里偏大的。", i.tokens),
                    vec![i.id.clone()],
                    None,
                ));
            }
        }
    }
    hints
}

/// Paragraphs (≥ [`MIN_DUP_CHARS`]) that appear in two or more rule files, grouped per file pair.
fn duplicate_hints(files: &[PromptItem]) -> Vec<PromptHint> {
    let mut seen: BTreeMap<String, (Vec<usize>, String)> = BTreeMap::new();
    for (idx, f) in files.iter().enumerate() {
        for para in f.text.split("\n\n") {
            let norm = normalize_ws(para);
            if norm.chars().count() < MIN_DUP_CHARS {
                continue;
            }
            let entry = seen
                .entry(norm)
                .or_insert_with(|| (Vec::new(), para.trim().to_string()));
            if !entry.0.contains(&idx) {
                entry.0.push(idx);
            }
        }
    }
    // (i, j) → (paragraph count, tokens, longest original paragraph)
    let mut pairs: BTreeMap<(usize, usize), (usize, u64, String)> = BTreeMap::new();
    for (_, (idxs, original)) in seen {
        for (a, &i) in idxs.iter().enumerate() {
            for &j in &idxs[a + 1..] {
                let e = pairs.entry((i, j)).or_insert((0, 0, String::new()));
                e.0 += 1;
                e.1 += estimate_tokens(&original);
                if original.len() > e.2.len() {
                    e.2.clone_from(&original);
                }
            }
        }
    }
    let mut rows: Vec<_> = pairs
        .into_iter()
        .filter(|(_, (_, tokens, _))| *tokens >= MIN_DUP_TOKENS)
        .collect();
    rows.sort_by_key(|(_, (_, tokens, _))| std::cmp::Reverse(*tokens));
    rows.into_iter()
        .take(4)
        .map(|((i, j), (count, tokens, quote))| {

            hint(
                format!("dup:{}-{}", files[i].id, files[j].id),
                "duplicate",
                "warn",
                format!("两个规则文件有 {count} 段相同内容"),
                format!(
                    "{} 与 {} 重复约 {tokens} tokens，每个会话各带一份。保留一份即可。下面是其中最长的一段。",
                    files[i].title,
                    files[j].title
                ),
                vec![files[i].id.clone(), files[j].id.clone()],
                Some(quote),
            )
        })
        .collect()
}

/// Full composition from the raw `get_state` data.
pub fn build_composition(
    cwd: &str,
    blocks: &[String],
    tools: &[Value],
    reported_tokens: Option<u64>,
    context_window: Option<u64>,
    probe_ms: u64,
) -> PromptComposition {
    let categories = compose(blocks, tools);
    let hints = build_hints(&categories);
    PromptComposition {
        cwd: cwd.to_string(),
        total_tokens: categories.iter().map(|c| c.tokens).sum(),
        categories,
        reported_tokens,
        context_window,
        hints,
        probe_ms,
        estimate_note: ESTIMATE_NOTE.to_string(),
    }
}

// ---------- probe process ----------

#[derive(Debug)]
struct RawState {
    blocks: Vec<String>,
    tools: Vec<Value>,
    reported_tokens: Option<u64>,
    context_window: Option<u64>,
}

fn parse_state(resp: &Value) -> Result<RawState, String> {
    let data = resp.get("data").unwrap_or(resp);
    let blocks: Vec<String> = match data.get("systemPrompt") {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => Vec::new(),
    };
    if blocks.is_empty() {
        return Err("omp 没有返回系统提示词（get_state 缺少 systemPrompt）".to_string());
    }
    let tools = data
        .get("dumpTools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let usage = data.get("contextUsage");
    Ok(RawState {
        blocks,
        tools,
        reported_tokens: usage.and_then(|u| u.get("tokens")).and_then(Value::as_u64),
        context_window: usage
            .and_then(|u| u.get("contextWindow"))
            .and_then(Value::as_u64),
    })
}

fn probe_command(settings: &Settings, cwd: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(&settings.omp_binary);
    cmd.kill_on_drop(true);
    cmd.arg("--mode")
        .arg("rpc")
        .arg("--no-session")
        .arg("--approval-mode")
        .arg(&settings.default_approval_mode)
        .arg("--cwd")
        .arg(cwd)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Own process group so a stuck omp and its children can be killed together.
        .process_group(0);
    if let Some(model) = settings
        .new_session_model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        cmd.arg("--model")
            .arg(crate::todos::omp::normalize_model_selector(model));
    }
    let viz_dir = crate::visualize::spawn_plugin_dir(settings.visualize_enabled);
    if viz_dir.is_some() {
        cmd.arg("--append-system-prompt")
            .arg(crate::prompts::VISUALIZE_HINT.trim());
    }
    // Status / checkpoints extensions are skipped: they write per-session files, and the probe
    // must leave nothing behind.
    let privacy = crate::paths::privacy_extension_path();
    if privacy.exists() {
        cmd.arg("-e").arg(privacy);
    }
    if let Some(ext) = crate::providers::try_extension_path() {
        cmd.arg("-e").arg(ext);
    }
    if let Some(dir) = viz_dir {
        cmd.arg("--plugin-dir").arg(dir);
    }
    cmd.env("PATH", crate::todos::omp::augmented_path());
    for (k, v) in crate::providers::omp_spawn_env() {
        cmd.env(k, v);
    }
    for (k, v) in crate::privacy::spawn_env() {
        cmd.env(k, v);
    }
    cmd
}

/// Reads frames until the response with `id` arrives.
async fn read_response<R: tokio::io::AsyncBufRead + Unpin>(
    lines: &mut tokio::io::Lines<R>,
    id: &str,
) -> Result<Value, String> {
    loop {
        let line = lines
            .next_line()
            .await
            .map_err(|e| format!("读取 omp 输出失败：{e}"))?
            .ok_or_else(|| "omp 在返回结果前退出了".to_string())?;
        let Ok(frame) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if frame.get("type").and_then(Value::as_str) == Some("response")
            && frame.get("id").and_then(Value::as_str) == Some(id)
        {
            if frame.get("success").and_then(Value::as_bool) == Some(false) {
                let msg = frame
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("get_state 失败");
                return Err(msg.to_string());
            }
            return Ok(frame);
        }
    }
}

async fn send_get_state(stdin: &mut tokio::process::ChildStdin, id: &str) -> Result<(), String> {
    let frame = format!("{}\n", json!({"type": "get_state", "id": id}));
    stdin
        .write_all(frame.as_bytes())
        .await
        .map_err(|e| format!("写入 omp 失败：{e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("写入 omp 失败：{e}"))
}

async fn converse(
    stdin: &mut tokio::process::ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
) -> Result<RawState, String> {
    // ready frame
    loop {
        let line = lines
            .next_line()
            .await
            .map_err(|e| format!("读取 omp 输出失败：{e}"))?
            .ok_or_else(|| "omp 启动后立即退出了".to_string())?;
        if serde_json::from_str::<Value>(&line)
            .ok()
            .is_some_and(|f| f.get("type").and_then(Value::as_str) == Some("ready"))
        {
            break;
        }
    }
    send_get_state(stdin, "pc1").await?;
    let first = parse_state(&read_response(lines, "pc1").await?)?;
    // Second read after a short pause: MCP servers register their tools asynchronously.
    tokio::time::sleep(SETTLE_DELAY).await;
    let second = async {
        send_get_state(stdin, "pc2").await?;
        parse_state(&read_response(lines, "pc2").await?)
    }
    .await;
    Ok(match second {
        Ok(s) if s.tools.len() >= first.tools.len() => s,
        _ => first,
    })
}

/// Closes stdin, gives omp [`GRACEFUL_EXIT`] to leave, then kills whatever is left in its process
/// group (omp itself when it hangs, plus any child it started, e.g. MCP servers).
async fn shutdown(mut child: tokio::process::Child, stdin: tokio::process::ChildStdin) {
    drop(stdin);
    let pid = child.id();
    if tokio::time::timeout(GRACEFUL_EXIT, child.wait())
        .await
        .is_err()
    {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    if let Some(pid) = pid {
        // SAFETY: the group was created by `process_group(0)` for this probe only; an empty
        // group just yields ESRCH.
        unsafe {
            libc::killpg(pid as libc::pid_t, libc::SIGKILL);
        }
    }
}

async fn probe_raw(settings: &Settings, cwd: &str, timeout: Duration) -> Result<RawState, String> {
    let mut child = probe_command(settings, cwd)
        .spawn()
        .map_err(|e| format!("无法启动 omp（{}）：{e}", settings.omp_binary))?;
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err("无法连接 omp 的输入输出".to_string());
    };
    let mut stderr = child.stderr.take();
    let mut lines = BufReader::new(stdout).lines();
    let result = match tokio::time::timeout(timeout, converse(&mut stdin, &mut lines)).await {
        Ok(r) => r,
        Err(_) => Err(format!("读取系统提示词超时（{} 秒）", timeout.as_secs())),
    };
    shutdown(child, stdin).await;
    match result {
        Ok(state) => Ok(state),
        Err(error) => {
            let mut err_text = String::new();
            if let Some(s) = stderr.take() {
                let _ = tokio::time::timeout(
                    Duration::from_millis(500),
                    s.take(8192).read_to_string(&mut err_text),
                )
                .await;
            }
            let err_text = err_text.trim();
            Err(if err_text.is_empty() {
                error
            } else {
                format!("{error}\n{err_text}")
            })
        }
    }
}

/// Probes `cwd` and returns what a new empty session there would carry.
#[tauri::command]
pub async fn prompt_composition_probe(
    state: tauri::State<'_, AppState>,
    cwd: String,
) -> Result<PromptComposition, String> {
    let cwd = cwd.trim().to_string();
    if cwd.is_empty() || !std::path::Path::new(&cwd).is_dir() {
        return Err(format!("目录不存在：{cwd}"));
    }
    let settings = state.settings.read().clone();
    let started = Instant::now();
    let raw = probe_raw(&settings, &cwd, PROBE_TIMEOUT).await?;
    let probe_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    Ok(build_composition(
        &cwd,
        &raw.blocks,
        &raw.tools,
        raw.reported_tokens,
        raw.context_window,
        probe_ms,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_block() -> String {
        "Intro line\n# Skills & Rules\n<skills>\n- alpha: Short one.\n- beta: Another skill.\n</skills>\n# Rest\nbody".to_string()
    }

    fn project_block(files: &[(&str, &str)]) -> String {
        let mut s = String::from("<project-context>\n<workstation>\n- OS: x\n</workstation>\n\n<repo-rules>\nMUST follow these:\n");
        for (p, c) in files {
            s.push_str(&format!("<file path=\"{p}\">\n{c}\n</file>\n"));
        }
        s.push_str("</repo-rules>\n\n</project-context>\n\n<critical>\nstop\n</critical>");
        s
    }

    fn cat<'a>(cats: &'a [PromptCategory], id: &str) -> &'a PromptCategory {
        cats.iter().find(|c| c.id == id).unwrap()
    }

    #[test]
    fn estimate_counts_cjk_per_char_and_latin_per_three() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcdef"), 2);
        assert_eq!(estimate_tokens("abcd"), 2);
        assert_eq!(estimate_tokens("你好世界"), 4);
        assert_eq!(estimate_tokens("你好ab"), 3);
    }

    #[test]
    fn compose_splits_blocks_into_categories() {
        let blocks = vec![
            base_block(),
            "Eval guidance middle block\nmore".to_string(),
            project_block(&[("/a/AGENTS.md", "rule a"), ("/b/AGENTS.md", "rule b")]),
        ];
        let tools = vec![
            json!({"name": "read", "description": "Read files", "parameters": {"type": "object"}}),
            json!({"name": "mcp__github_create_issue", "description": "Create", "parameters": {}}),
        ];
        let cats = compose(&blocks, &tools);
        assert_eq!(
            cats.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["system", "rules", "skills", "tools", "mcp", "other"]
        );
        let system = cat(&cats, "system");
        assert_eq!(system.items.len(), 1);
        assert!(!system.items[0].text.contains("<skills>"));
        assert!(system.items[0].text.contains("body"));
        let skills = cat(&cats, "skills");
        assert_eq!(
            skills
                .items
                .iter()
                .map(|i| i.title.as_str())
                .collect::<Vec<_>>(),
            ["alpha", "beta"]
        );
        let rules = cat(&cats, "rules");
        assert_eq!(rules.items.len(), 2);
        assert_eq!(rules.items[0].title, "/a/AGENTS.md");
        assert_eq!(rules.items[0].text, "rule a");
        assert_eq!(cat(&cats, "tools").items[0].title, "read");
        let mcp = cat(&cats, "mcp");
        assert_eq!(
            mcp.items[0].detail.as_deref(),
            Some("来自 MCP 服务器：github")
        );
        let other = cat(&cats, "other");
        assert_eq!(other.items.len(), 2, "middle block + project remainder");
        assert!(other.items.iter().any(|i| i.text.contains("<workstation>")));
        assert!(other.items.iter().all(|i| !i.text.contains("rule a")));
        for c in &cats {
            assert_eq!(c.tokens, c.items.iter().map(|i| i.tokens).sum::<u64>());
        }
    }

    #[test]
    fn mcp_server_handles_both_separators() {
        assert_eq!(
            mcp_server("mcp__github__create_issue").as_deref(),
            Some("github")
        );
        assert_eq!(
            mcp_server("mcp__puppeteer_screenshot").as_deref(),
            Some("puppeteer")
        );
        assert_eq!(mcp_server("read"), None);
    }

    #[test]
    fn duplicate_paragraphs_across_rule_files_are_flagged() {
        let shared = "This paragraph is shared between both rule files and is long enough to count as duplicated content for sure. It keeps going with more words so the estimated duplicated size clears the minimum worth reporting to a reader.";
        let blocks = vec![
            base_block(),
            project_block(&[
                ("/a/AGENTS.md", &format!("unique a\n\n{shared}")),
                ("/b/AGENTS.md", &format!("{shared}\n\nunique b")),
            ]),
        ];
        let cats = compose(&blocks, &[]);
        let hints = build_hints(&cats);
        let dup = hints
            .iter()
            .find(|h| h.kind == "duplicate")
            .expect("duplicate hint");
        assert_eq!(dup.item_ids, ["rule:1", "rule:2"]);
        assert_eq!(dup.quote.as_deref(), Some(shared));
        assert!(dup.title.contains('1'));
    }

    #[test]
    fn distinct_rule_files_produce_no_duplicate_hint() {
        let blocks = vec![
            base_block(),
            project_block(&[("/a/AGENTS.md", "only in a"), ("/b/AGENTS.md", "only in b")]),
        ];
        let hints = build_hints(&compose(&blocks, &[]));
        assert!(hints.iter().all(|h| h.kind != "duplicate"));
    }

    #[test]
    fn oversized_skills_big_rules_and_mcp_are_flagged() {
        let long_desc = "x".repeat(300);
        let base = format!("a\n<skills>\n- big: {long_desc}\n- ok: fine\n</skills>");
        let big_rule = "y ".repeat(6000);
        let blocks = vec![base, project_block(&[("/a/AGENTS.md", &big_rule)])];
        let tools = vec![json!({"name": "mcp__srv__t", "description": "d", "parameters": {}})];
        let hints = build_hints(&compose(&blocks, &tools));
        let kinds: Vec<&str> = hints.iter().map(|h| h.kind.as_str()).collect();
        assert!(kinds.contains(&"big_skill"));
        assert!(kinds.contains(&"big_rule"));
        assert!(kinds.contains(&"rules_total"));
        assert!(kinds.contains(&"mcp_always"));
        assert!(kinds.contains(&"largest"));
        let big_skill = hints.iter().find(|h| h.kind == "big_skill").unwrap();
        assert_eq!(big_skill.item_ids, ["skill:big"]);
    }

    #[test]
    fn parse_state_reads_blocks_tools_and_usage() {
        let resp = json!({"data": {
            "systemPrompt": ["a", "b"],
            "dumpTools": [{"name": "read"}],
            "contextUsage": {"tokens": 123, "contextWindow": 1000}
        }});
        let s = parse_state(&resp).unwrap();
        assert_eq!(s.blocks, ["a", "b"]);
        assert_eq!(s.tools.len(), 1);
        assert_eq!(s.reported_tokens, Some(123));
        assert_eq!(s.context_window, Some(1000));
        assert!(parse_state(&json!({"data": {}})).is_err());
    }

    fn any_process_matching(marker: &str) -> bool {
        std::process::Command::new("pgrep")
            .args(["-f", marker])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn fake_omp(name: &str, body: &str) -> (Settings, String) {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("pc-fake-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("omp");
        std::fs::write(&bin, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let settings = Settings {
            omp_binary: bin.to_string_lossy().to_string(),
            ..Settings::default()
        };
        (settings, dir.to_string_lossy().to_string())
    }

    #[tokio::test]
    async fn probe_kills_a_stuck_omp_and_its_children_on_timeout() {
        let (settings, dir) = fake_omp(
            "stuck",
            "echo '{\"type\":\"ready\"}'\nsleep 7311 &\nsleep 7311",
        );
        let err = probe_raw(&settings, &dir, Duration::from_secs(1))
            .await
            .expect_err("must time out");
        assert!(err.contains("超时"), "{err}");
        assert!(
            !any_process_matching("sleep 7311"),
            "stuck omp or child survived"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn probe_returns_state_and_leaves_no_process_behind() {
        let (settings, dir) = fake_omp(
            "ok",
            "echo '{\"type\":\"ready\"}'\nsleep 7312 &\nn=0\nwhile read line; do n=$((n+1)); echo \"{\\\"id\\\":\\\"pc$n\\\",\\\"type\\\":\\\"response\\\",\\\"success\\\":true,\\\"data\\\":{\\\"systemPrompt\\\":[\\\"x\\\"],\\\"dumpTools\\\":[],\\\"contextUsage\\\":{\\\"tokens\\\":5,\\\"contextWindow\\\":100}}}\"; done",
        );
        let state = probe_raw(&settings, &dir, Duration::from_secs(20))
            .await
            .expect("probe");
        assert_eq!(state.blocks, ["x"]);
        assert_eq!(state.reported_tokens, Some(5));
        assert!(!any_process_matching("sleep 7312"), "child of omp survived");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Real probe against this repo: `cargo test prompt_composition_live -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "spawns the real omp binary"]
    async fn prompt_composition_live() {
        let cwd = env!("CARGO_MANIFEST_DIR").to_string();
        let cwd = std::path::Path::new(&cwd)
            .parent()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let sessions = crate::paths::omp_sessions_dir();
        let count = |d: &std::path::Path| -> usize { walkdir_count(d) };
        // Cleanup proof: after a probe in a unique cwd no omp process for it remains.
        let tmp = std::env::temp_dir().join(format!("pc-live-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let tmp_s = tmp.to_string_lossy().to_string();
        let before = count(&sessions);
        probe_raw(&Settings::default(), &tmp_s, PROBE_TIMEOUT)
            .await
            .expect("probe tmp");
        assert!(
            !any_process_matching(&format!("--cwd {tmp_s}")),
            "probe omp still running"
        );
        let _ = std::fs::remove_dir_all(&tmp);
        let started = Instant::now();
        let raw = probe_raw(&Settings::default(), &cwd, PROBE_TIMEOUT)
            .await
            .expect("probe");
        let comp = build_composition(
            &cwd,
            &raw.blocks,
            &raw.tools,
            raw.reported_tokens,
            raw.context_window,
            started.elapsed().as_millis() as u64,
        );
        for c in &comp.categories {
            println!("{:8} {:>6} tokens, {} items", c.id, c.tokens, c.items.len());
        }
        println!(
            "total est {} / omp reported {:?}",
            comp.total_tokens, comp.reported_tokens
        );
        for h in &comp.hints {
            println!("hint [{}] {}", h.severity, h.title);
        }
        assert!(comp.total_tokens > 0);
        assert_eq!(
            before,
            count(&sessions),
            "probe must not create session files"
        );
    }

    fn walkdir_count(dir: &std::path::Path) -> usize {
        let mut n = 0;
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    n += walkdir_count(&p);
                } else {
                    n += 1;
                }
            }
        }
        n
    }
}
