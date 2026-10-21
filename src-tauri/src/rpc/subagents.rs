//! [B] Subagent session files (contract C5): `subagent_list` / `subagent_transcript`.
//!
//! omp writes one `<AgentId>.jsonl` session per spawned subagent under a sibling
//! directory named after the parent session file (`<parentFile without .jsonl>/`),
//! plus `<AgentId>.md|.json` final outputs and `.<AgentId>.jsonl.lock.os` locks.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use serde_json::Value;

use crate::catalog::{parse as cat_parse, transcript as cat_transcript};
use crate::contracts::{SubagentStatus, SubagentSummary, SubagentTranscript};
use crate::paths;

/// Locks touched within this window mark the agent as still running.
const LOCK_FRESH: Duration = Duration::from_secs(300);
/// Output files are capped by omp (~500KB); cap our read anyway.
const MAX_OUTPUT_BYTES: u64 = 1_000_000;
/// Prompt preview length for `SubagentSummary::prompt`.
const PROMPT_PREVIEW: usize = 160;

fn allowed_root() -> PathBuf {
    paths::omp_sessions_dir()
}

/// `parentFile` must be an existing `*.jsonl` under the OMP sessions root.
/// Returns the canonical path.
fn validate_parent(parent_file: &str, root: &Path) -> Result<PathBuf, String> {
    let path = PathBuf::from(parent_file);
    if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
        return Err("parentFile must be a .jsonl session file".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|_| "parent session file not found".to_string())?;
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if !canon.starts_with(&root) {
        return Err("session file is outside the sessions directory".into());
    }
    Ok(canon)
}

/// Agent ids become file names: reject anything that could escape the dir.
fn validate_agent_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id == ".." || id.starts_with('.') || id.contains('/') || id.contains('\\') {
        return Err(format!("invalid agent id: {id:?}"));
    }
    Ok(())
}

/// `<parentFile>` → `<parent stem>/` sibling dir holding subagent files.
fn subagent_dir(parent: &Path) -> PathBuf {
    let stem = parent.file_stem().unwrap_or_default();
    parent.parent().unwrap_or_else(|| Path::new("")).join(stem)
}

/// The agent's transcript / output paths inside `dir`.
fn agent_paths(dir: &Path, id: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
    (
        dir.join(format!("{id}.jsonl")),
        dir.join(format!(".{id}.jsonl.lock.os")),
        dir.join(format!("{id}.md")),
        dir.join(format!("{id}.json")),
    )
}

fn mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|m| m.modified()).ok()
}

fn fresh_enough(t: Option<SystemTime>) -> bool {
    t.and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age <= LOCK_FRESH)
}

/// Per-file metadata accumulated while scanning the jsonl once.
#[derive(Default)]
struct AgentMeta {
    model: Option<String>,
    thinking_level: Option<String>,
    system_prompt: Option<String>,
    /// `session_init.agent`: the omp agent type.
    agent: Option<String>,
    /// Full first user message (the spawned prompt / assignment).
    prompt: Option<String>,
    message_count: u32,
    tool_call_count: u32,
    request_count: u32,
    /// input + output + cacheWrite, matching AgentProgress.tokens.
    tokens: u64,
    cost: f64,
    last_assistant_text: Option<String>,
    last_stop_reason: Option<String>,
    has_assistant: bool,
}

fn accumulate(meta: &mut AgentMeta, v: &Value) {
    let ts = v.get("timestamp").and_then(Value::as_str);
    match v.get("type").and_then(Value::as_str) {
        Some("model_change") => {
            meta.model = v.get("model").and_then(Value::as_str).map(str::to_string);
        }
        Some("thinking_level_change") => {
            meta.thinking_level = v
                .get("thinkingLevel")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        Some("session_init") => {
            if meta.system_prompt.is_none() {
                meta.system_prompt = v
                    .get("systemPrompt")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
            if meta.agent.is_none() {
                meta.agent = v
                    .get("agent")
                    .and_then(Value::as_str)
                    .filter(|a| !a.is_empty())
                    .map(str::to_string);
            }
        }
        Some("message") => {
            meta.message_count += 1;
            let Some(msg) = v.get("message") else { return };
            match msg.get("role").and_then(Value::as_str) {
                Some("user") => {
                    if meta.prompt.is_none()
                        && msg.get("toolCallId").is_none()
                        && msg.get("toolName").is_none()
                    {
                        meta.prompt = Some(cat_parse::content_text(msg.get("content")));
                    }
                }
                Some("assistant") => {
                    meta.has_assistant = true;
                    meta.request_count += 1;
                    if let Some(content) = msg.get("content").and_then(Value::as_array) {
                        meta.tool_call_count += content
                            .iter()
                            .filter(|b| b.get("type").and_then(Value::as_str) == Some("toolCall"))
                            .count() as u32;
                    }
                    let text = cat_parse::content_text(msg.get("content"));
                    if !text.trim().is_empty() {
                        meta.last_assistant_text = Some(text);
                    }
                    if let Some(u) = msg.get("usage") {
                        let u = cat_transcript::parse_usage(u);
                        meta.tokens += u.input + u.output + u.cache_write;
                        meta.cost += u.cost;
                    }
                    if let Some(sr) = msg.get("stopReason").and_then(Value::as_str) {
                        meta.last_stop_reason = Some(sr.to_string());
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
    let _ = ts;
}

/// Parsed pass over a subagent jsonl: meta + transcript items (only lines
/// at/after `from_byte` are normalized).
struct AgentScan {
    meta: AgentMeta,
    items: Vec<crate::contracts::TranscriptItem>,
    started_at: Option<String>,
    ended_at: Option<String>,
    next_byte: u64,
    reset: bool,
}

fn scan_agent(path: &Path, from_byte: u64) -> std::io::Result<AgentScan> {
    let bytes = fs::read(path)?;
    let size = bytes.len() as u64;
    let (start, reset) = if from_byte > size {
        (0, true)
    } else {
        (from_byte.min(size), false)
    };
    // Only complete lines: stop after the last newline.
    let complete = bytes.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
    let mut scan = AgentScan {
        meta: AgentMeta::default(),
        items: Vec::new(),
        started_at: None,
        ended_at: None,
        next_byte: complete as u64,
        reset,
    };
    let mut offset = 0usize;
    for line in bytes[..complete].split(|b| *b == b'\n') {
        let line_start = offset;
        offset += line.len() + 1;
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if let Some(ts) = v.get("timestamp").and_then(Value::as_str) {
            if scan.started_at.is_none() {
                scan.started_at = Some(ts.to_string());
            }
            scan.ended_at = Some(ts.to_string());
        }
        accumulate(&mut scan.meta, &v);
        if reset || line_start >= start as usize {
            if let Some(item) = cat_transcript::normalize_entry(&v) {
                scan.items.push(item);
            }
        }
    }
    Ok(scan)
}

/// Inferred status for a subagent file.
fn infer_status(
    dir: &Path,
    id: &str,
    meta: &AgentMeta,
    file_mtime: Option<SystemTime>,
) -> (SubagentStatus, Option<PathBuf>) {
    let (_jsonl, lock, out_md, out_json) = agent_paths(dir, id);
    let output = [out_md, out_json].into_iter().find(|p| p.is_file());
    if output.is_some() {
        return (SubagentStatus::Completed, output);
    }
    // omp keeps the lock file while the child is alive; treat a recently
    // touched lock (or a still-hot transcript) as running.
    if fresh_enough(mtime(&lock)) || fresh_enough(file_mtime) {
        return (SubagentStatus::Running, None);
    }
    let stop = meta.last_stop_reason.as_deref().unwrap_or("");
    if stop.contains("error") || stop.contains("Error") {
        return (SubagentStatus::Failed, None);
    }
    if stop.contains("abort") || stop.contains("cancel") {
        return (SubagentStatus::Aborted, None);
    }
    if meta.has_assistant {
        // Idle, produced a final text, no output file.
        return (SubagentStatus::Completed, None);
    }
    // Stale file that never got past the prompt.
    (SubagentStatus::Pending, None)
}

fn summary_from(
    id: &str,
    path: &Path,
    scan: &AgentScan,
    status: SubagentStatus,
    output: Option<PathBuf>,
) -> SubagentSummary {
    SubagentSummary {
        id: id.to_string(),
        status,
        model: scan.meta.model.clone(),
        thinking_level: scan.meta.thinking_level.clone(),
        agent: scan.meta.agent.clone(),
        prompt: scan
            .meta
            .prompt
            .as_deref()
            .map(|p| cat_parse::snippet(p, PROMPT_PREVIEW)),
        message_count: scan.meta.message_count,
        tool_call_count: scan.meta.tool_call_count,
        request_count: scan.meta.request_count,
        tokens: scan.meta.tokens,
        cost: scan.meta.cost,
        started_at: scan.started_at.clone(),
        ended_at: scan.ended_at.clone(),
        output_path: output.map(|p| p.to_string_lossy().into_owned()),
        file_path: path.to_string_lossy().into_owned(),
    }
}

/// Read the output file; caps at MAX_OUTPUT_BYTES.
fn read_output(path: &Path) -> Option<String> {
    let size = fs::metadata(path).ok()?.len();
    if size == 0 || size > MAX_OUTPUT_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// What the cache remembers per subagent transcript: the summary scan (items
/// are never kept) plus the file identity it was computed from.
struct CachedScan {
    size: u64,
    mtime: Option<SystemTime>,
    scan: AgentScan,
}

/// Per-transcript scan summaries keyed by path, so listing does not re-read
/// and re-parse unchanged files. Transcripts are append-only: when a file only
/// grew, just the bytes after the last parsed newline are read and folded in.
#[derive(Default)]
struct ScanCache {
    map: HashMap<PathBuf, CachedScan>,
    /// Total transcript bytes read from disk (observability / tests).
    bytes_read: u64,
}

impl ScanCache {
    /// Summary scan of `path`, reading from disk only what changed.
    fn scan(&mut self, path: &Path) -> std::io::Result<&AgentScan> {
        let md = fs::metadata(path)?;
        let (size, modified) = (md.len(), md.modified().ok());
        let fresh = match self.map.get(path) {
            Some(c) if c.size == size && c.mtime == modified => false,
            // Grew: continue after the last complete line already parsed.
            Some(c) if size > c.size && c.scan.next_byte <= size => {
                self.append(path, size, modified)?;
                false
            }
            _ => true,
        };
        if fresh {
            let mut f = fs::File::open(path)?;
            let mut bytes = Vec::with_capacity(size as usize);
            f.read_to_end(&mut bytes)?;
            self.bytes_read += bytes.len() as u64;
            let mut scan = AgentScan {
                meta: AgentMeta::default(),
                items: Vec::new(),
                started_at: None,
                ended_at: None,
                next_byte: 0,
                reset: false,
            };
            fold_lines(&mut scan, &bytes);
            self.map.insert(
                path.to_path_buf(),
                CachedScan {
                    size: bytes.len() as u64,
                    mtime: modified,
                    scan,
                },
            );
        }
        Ok(&self.map[path].scan)
    }

    fn append(
        &mut self,
        path: &Path,
        size: u64,
        modified: Option<SystemTime>,
    ) -> std::io::Result<()> {
        let Some(c) = self.map.get_mut(path) else {
            return Ok(());
        };
        let mut f = fs::File::open(path)?;
        f.seek(SeekFrom::Start(c.scan.next_byte))?;
        let mut tail = Vec::new();
        f.read_to_end(&mut tail)?;
        self.bytes_read += tail.len() as u64;
        fold_lines(&mut c.scan, &tail);
        c.size = size;
        c.mtime = modified;
        Ok(())
    }

    /// Drop entries under `dir` that were not seen in the latest listing.
    fn retain_seen(&mut self, dir: &Path, seen: &HashSet<PathBuf>) {
        self.map
            .retain(|p, _| p.parent() != Some(dir) || seen.contains(p));
    }
}

/// Parse the complete lines of `bytes` (which start at `scan.next_byte`) into
/// the running summary; a trailing partial line is left for the next pass.
fn fold_lines(scan: &mut AgentScan, bytes: &[u8]) {
    let complete = bytes.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
    for line in bytes[..complete].split(|b| *b == b'\n') {
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if let Some(ts) = v.get("timestamp").and_then(Value::as_str) {
            if scan.started_at.is_none() {
                scan.started_at = Some(ts.to_string());
            }
            scan.ended_at = Some(ts.to_string());
        }
        accumulate(&mut scan.meta, &v);
    }
    // The list never shows the system prompt; do not keep it resident.
    scan.meta.system_prompt = None;
    scan.next_byte += complete as u64;
}

// `LazyLock` needs Rust 1.80; the crate's MSRV is 1.77.
fn scan_cache() -> &'static Mutex<ScanCache> {
    static CACHE: OnceLock<Mutex<ScanCache>> = OnceLock::new();
    CACHE.get_or_init(Mutex::default)
}

fn list_with(
    parent_file: &str,
    root: &Path,
    cache: &mut ScanCache,
) -> Result<Vec<SubagentSummary>, String> {
    let parent = validate_parent(parent_file, root)?;
    let dir = subagent_dir(&parent);
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        cache.retain_seen(&dir, &HashSet::new());
        return Ok(out);
    };
    let mut seen = HashSet::new();
    for e in entries.flatten() {
        let path = e.path();
        let name = e.file_name();
        let Some(name) = name.to_str() else { continue };
        // Skip dotfiles: lock files (.X.jsonl.lock.os) and hidden junk.
        if name.starts_with('.') {
            continue;
        }
        if !e.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if validate_agent_id(&id).is_err() {
            continue;
        }
        let Ok(scan) = cache.scan(&path) else {
            continue;
        };
        let (status, output) = infer_status(&dir, &id, &scan.meta, mtime(&path));
        out.push(summary_from(&id, &path, scan, status, output));
        seen.insert(path);
    }
    cache.retain_seen(&dir, &seen);
    out.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    Ok(out)
}

#[cfg(test)]
fn list_in(parent_file: &str, root: &Path) -> Result<Vec<SubagentSummary>, String> {
    list_with(parent_file, root, &mut ScanCache::default())
}

pub fn list(parent_file: &str) -> Result<Vec<SubagentSummary>, String> {
    let mut cache = scan_cache().lock().unwrap_or_else(|e| e.into_inner());
    list_with(parent_file, &allowed_root(), &mut cache)
}

pub fn transcript_in(
    parent_file: &str,
    agent_id: &str,
    from_byte: u64,
    root: &Path,
) -> Result<SubagentTranscript, String> {
    validate_agent_id(agent_id)?;
    let parent = validate_parent(parent_file, root)?;
    let dir = subagent_dir(&parent);
    let (file, _lock, _out_md, _out_json) = agent_paths(&dir, agent_id);
    if !file.is_file() {
        return Err(format!("subagent session not found: {agent_id}"));
    }
    let scan = scan_agent(&file, from_byte)
        .map_err(|e| format!("read subagent transcript {agent_id}: {e}"))?;
    let (status, output_path) = infer_status(&dir, agent_id, &scan.meta, mtime(&file));
    let summary = summary_from(agent_id, &file, &scan, status, output_path.clone());
    // Prefer the output artifact; fall back to the last assistant text.
    let output = output_path
        .as_deref()
        .and_then(read_output)
        .or_else(|| scan.meta.last_assistant_text.clone());
    Ok(SubagentTranscript {
        agent_id: agent_id.to_string(),
        file: file.to_string_lossy().into_owned(),
        summary,
        system_prompt: scan.meta.system_prompt,
        prompt: scan.meta.prompt,
        items: scan.items,
        output,
        output_path: output_path.map(|p| p.to_string_lossy().into_owned()),
        next_byte: scan.next_byte,
        reset: scan.reset,
    })
}

pub fn transcript(
    parent_file: &str,
    agent_id: &str,
    from_byte: Option<u64>,
) -> Result<SubagentTranscript, String> {
    transcript_in(
        parent_file,
        agent_id,
        from_byte.unwrap_or(0),
        &allowed_root(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        std::env::temp_dir().join(format!("ompws-sub-{}", uuid::Uuid::new_v4()))
    }

    /// `<root>/<bucket>/<parent>.jsonl` plus a `<parent>/` subagent dir.
    fn setup() -> (PathBuf, PathBuf, PathBuf) {
        let root = tmp_root();
        let bucket = root.join("-proj");
        let parent = bucket.join("parent.jsonl");
        let subdir = bucket.join("parent");
        fs::create_dir_all(&subdir).unwrap();
        fs::write(
            &parent,
            r#"{"type":"session","version":3,"id":"P","timestamp":"T0"}"#,
        )
        .unwrap();
        (root, parent, subdir)
    }

    const AGENT: &str = concat!(
        r#"{"type":"title","v":1,"title":"agent"}"#,
        "\n",
        r#"{"type":"session","version":3,"id":"A","timestamp":"T0","cwd":"/w"}"#,
        "\n",
        r#"{"type":"model_change","id":"m","timestamp":"T1","model":"prov/mid"}"#,
        "\n",
        r#"{"type":"thinking_level_change","id":"t","timestamp":"T2","thinkingLevel":"high"}"#,
        "\n",
        r#"{"type":"session_init","id":"i","timestamp":"T3","systemPrompt":"SYS","agent":"scout"}"#,
        "\n",
        r#"{"type":"message","id":"u","timestamp":"T4","message":{"role":"user","content":[{"type":"text","text":"do the thing"}]}}"#,
        "\n",
        r#"{"type":"message","id":"a","timestamp":"T5","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"ls"}}],"usage":{"input":10,"output":5,"cacheRead":3,"cacheWrite":1,"totalTokens":19,"cost":{"total":0.5}},"stopReason":"toolUse"}}"#,
        "\n",
        r#"{"type":"message","id":"r","timestamp":"T6","message":{"role":"toolResult","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"x"}],"isError":false}}"#,
        "\n",
        r#"{"type":"message","id":"z","timestamp":"T7","message":{"role":"assistant","content":[{"type":"text","text":"final answer"}],"stopReason":"stop","usage":{"input":3,"output":2,"cacheRead":0,"cacheWrite":0,"totalTokens":5,"cost":{"total":0.1}}}}"#,
        "\n",
    );

    #[test]
    fn parses_summary_and_statuses() {
        let (root, parent, subdir) = setup();
        fs::write(subdir.join("Done.jsonl"), AGENT).unwrap();
        fs::write(subdir.join("Done.md"), "OUTPUT").unwrap();
        // Hidden lock file must be skipped as a list entry.
        fs::write(subdir.join(".Done.jsonl.lock.os"), "").unwrap();
        // A fresh lock on a file without output => running.
        fs::write(subdir.join("Live.jsonl"), AGENT).unwrap();
        fs::write(subdir.join(".Live.jsonl.lock.os"), "").unwrap();

        let list = list_in(parent.to_str().unwrap(), &root).unwrap();
        let by: std::collections::HashMap<_, _> = list.iter().map(|s| (s.id.as_str(), s)).collect();
        assert_eq!(list.len(), 2);
        let done = by["Done"];
        assert_eq!(done.status, SubagentStatus::Completed);
        assert_eq!(done.model.as_deref(), Some("prov/mid"));
        assert_eq!(done.thinking_level.as_deref(), Some("high"));
        assert_eq!(done.agent.as_deref(), Some("scout"));
        assert_eq!(done.prompt.as_deref(), Some("do the thing"));
        assert_eq!(done.tool_call_count, 1);
        assert_eq!(done.request_count, 2);
        assert_eq!(done.tokens, 10 + 5 + 1 + 3 + 2); // cacheRead excluded
        assert!((done.cost - 0.6).abs() < 1e-9);
        assert_eq!(done.started_at.as_deref(), Some("T0"));
        assert_eq!(done.ended_at.as_deref(), Some("T7"));
        assert!(done.output_path.as_deref().unwrap().ends_with("Done.md"));
        assert_eq!(by["Live"].status, SubagentStatus::Running);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn transcript_returns_items_prompt_and_output() {
        let (root, parent, subdir) = setup();
        fs::write(subdir.join("A.jsonl"), AGENT).unwrap();
        fs::write(subdir.join("A.md"), "# out").unwrap();
        let t = transcript_in(parent.to_str().unwrap(), "A", 0, &root).unwrap();
        assert_eq!(t.prompt.as_deref(), Some("do the thing"));
        assert_eq!(t.system_prompt.as_deref(), Some("SYS"));
        assert_eq!(t.output.as_deref(), Some("# out"));
        assert!(t.output_path.unwrap().ends_with("A.md"));
        assert_eq!(t.summary.status, SubagentStatus::Completed);
        // Items are normalized: model_change + user + assistant + tool_result + assistant.
        use crate::contracts::TranscriptKind as K;
        let kinds: Vec<_> = t.items.iter().map(|i| i.kind).collect();
        assert_eq!(
            kinds,
            vec![
                K::ModelChange,
                K::User,
                K::Assistant,
                K::ToolResult,
                K::Assistant
            ]
        );
        assert!(t.next_byte > 0);
        // Incremental read past EOF returns no items, keeps nextByte.
        let t2 = transcript_in(parent.to_str().unwrap(), "A", t.next_byte, &root).unwrap();
        assert!(t2.items.is_empty());
        assert!(!t2.reset);
        assert_eq!(t2.next_byte, t.next_byte);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn output_falls_back_to_last_assistant_text() {
        let (root, parent, subdir) = setup();
        fs::write(subdir.join("B.jsonl"), AGENT).unwrap();
        let t = transcript_in(parent.to_str().unwrap(), "B", 0, &root).unwrap();
        assert_eq!(t.output.as_deref(), Some("final answer"));
        assert!(t.output_path.is_none());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn validates_ids_and_paths() {
        let (root, parent, _subdir) = setup();
        let p = parent.to_str().unwrap();
        for bad in ["", "..", "a/b", "a\\b", ".hidden"] {
            assert!(transcript_in(p, bad, 0, &root).is_err(), "{bad:?}");
        }
        assert!(list_in("/nope.jsonl", &root).is_err());
        assert!(list_in("/tmp/x.txt", &root).is_err());
        // Outside the sessions root.
        let outside =
            std::env::temp_dir().join(format!("ompws-sub-out-{}.jsonl", uuid::Uuid::new_v4()));
        fs::write(&outside, "{}\n").unwrap();
        assert!(list_in(outside.to_str().unwrap(), &root).is_err());
        fs::remove_dir_all(&root).ok();
        fs::remove_file(&outside).ok();
    }

    #[test]
    fn failed_and_aborted_inferred_from_stop_reason() {
        let (root, parent, subdir) = setup();
        let err = AGENT.replace(r#""stopReason":"stop""#, r#""stopReason":"error""#);
        let ab = AGENT.replace(r#""stopReason":"stop""#, r#""stopReason":"aborted""#);
        fs::write(subdir.join("Err.jsonl"), err).unwrap();
        fs::write(subdir.join("Ab.jsonl"), ab).unwrap();
        // Stale: pretend files are old by writing them first, but mtime may be
        // fresh on tmpfs — force via filetime-free approach: set status check
        // relies on freshness, so age the files via `touch -t` is unavailable;
        // instead drop the freshness window by directly asserting infer logic
        // through list_in when mtimes are stale is unreliable. We just verify
        // the stopReason mapping does not panic and statuses differ.
        let list = list_in(parent.to_str().unwrap(), &root).unwrap();
        // On a fresh CI box the files were just written => may read "running";
        // the completed/failed mapping is verified via infer_status directly.
        let _ = list;
        let scan_err = scan_agent(&subdir.join("Err.jsonl"), 0).unwrap();
        // Force staleness: use an mtime of UNIX_EPOCH to simulate old files.
        let (status, _) =
            infer_status(&subdir, "Err", &scan_err.meta, Some(SystemTime::UNIX_EPOCH));
        assert_eq!(status, SubagentStatus::Failed);
        let scan_ab = scan_agent(&subdir.join("Ab.jsonl"), 0).unwrap();
        let (status, _) = infer_status(&subdir, "Ab", &scan_ab.meta, Some(SystemTime::UNIX_EPOCH));
        assert_eq!(status, SubagentStatus::Aborted);
        fs::remove_dir_all(&root).ok();
    }

    fn json(list: &[SubagentSummary]) -> String {
        serde_json::to_string(list).unwrap()
    }

    #[test]
    fn cache_skips_unchanged_and_reads_only_appended_bytes() {
        let (root, parent, subdir) = setup();
        let p = parent.to_str().unwrap();
        let file = subdir.join("A.jsonl");
        fs::write(&file, AGENT).unwrap();
        let mut cache = ScanCache::default();

        let first = list_with(p, &root, &mut cache).unwrap();
        assert_eq!(cache.bytes_read, AGENT.len() as u64);
        assert_eq!(json(&first), json(&list_in(p, &root).unwrap()));

        // Unchanged file: identical result, zero bytes re-read.
        let again = list_with(p, &root, &mut cache).unwrap();
        assert_eq!(cache.bytes_read, AGENT.len() as u64);
        assert_eq!(json(&first), json(&again));

        // Append one complete line plus a partial one: only the tail is read,
        // and the result equals a from-scratch scan.
        let extra = concat!(
            r#"{"type":"message","id":"y","timestamp":"T8","message":{"role":"assistant","content":[{"type":"text","text":"more"}],"stopReason":"stop"}}"#,
            "\n",
            r#"{"type":"mess"#,
        );
        let mut f = fs::OpenOptions::new().append(true).open(&file).unwrap();
        std::io::Write::write_all(&mut f, extra.as_bytes()).unwrap();
        drop(f);
        let grown = list_with(p, &root, &mut cache).unwrap();
        assert_eq!(cache.bytes_read, (AGENT.len() + extra.len()) as u64);
        assert_eq!(json(&grown), json(&list_in(p, &root).unwrap()));
        assert_eq!(grown[0].message_count, first[0].message_count + 1);

        // Removed files leave the cache.
        fs::remove_file(&file).unwrap();
        assert!(list_with(p, &root, &mut cache).unwrap().is_empty());
        assert!(cache.map.is_empty());
        fs::remove_dir_all(&root).ok();
    }
}
