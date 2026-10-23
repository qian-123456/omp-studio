//! Transcript normalization (`get_transcript`) and transcript usage sums.

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

use super::parse::content_text;
use crate::contracts::{
    SessionSnapshot, ToolCall, ToolResultInfo, TranscriptItem, TranscriptKind, TranscriptPage,
    Usage,
};

/// Read complete lines from `from_offset` and normalize them.
///
/// The offset is trusted only while the bytes before it are still the ones the
/// caller read. omp rewrites the file in place (`/shake` elides old tool
/// results), after which a stale offset points mid-line or at a later entry and
/// an incremental read would silently skip the entries in between. The read
/// restarts from 0 with `reset = true` when the offset is past EOF, is not a
/// line boundary, or the entry ending there is not `tail_id` (the previous
/// page's `tail_id`; `None` skips that check).
pub fn read_page(
    path: &Path,
    session_id: &str,
    from_offset: u64,
    tail_id: Option<&str>,
) -> std::io::Result<TranscriptPage> {
    let mut f = File::open(path)?;
    let size = f.metadata()?.len();
    let mut tail = None;
    let start = if from_offset == 0 || from_offset > size {
        0
    } else {
        match line_ending_at(&mut f, from_offset)? {
            Some(line) => {
                let id = entry_id(&line);
                if tail_id.map_or(true, |t| id.as_deref() == Some(t)) {
                    tail = id;
                    from_offset
                } else {
                    0
                }
            }
            None => 0,
        }
    };
    let reset = start != from_offset;
    f.seek(SeekFrom::Start(start))?;
    // Stream line by line instead of buffering the whole (possibly tens of MB)
    // file next to its parsed form. Only complete lines count; a trailing
    // fragment without a newline is left for the next incremental read.
    let mut reader = BufReader::with_capacity(256 * 1024, f.take(size - start));
    let mut items = Vec::new();
    let mut consumed = 0u64;
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = reader.read_until(b'\n', &mut line)?;
        if n == 0 || line.last() != Some(&b'\n') {
            break;
        }
        consumed += n as u64;
        let value = serde_json::from_slice::<Value>(&line[..n - 1]).ok();
        tail = value.as_ref().and_then(value_id);
        if let Some(item) = value.as_ref().and_then(normalize_entry) {
            items.push(item);
        }
    }
    Ok(TranscriptPage {
        session_id: session_id.to_string(),
        items,
        next_offset: start + consumed,
        reset,
        tail_id: tail,
    })
}

/// The line (without its `\n`) that ends exactly at byte `end`, or `None` when
/// `end` is not a line boundary. Reads backwards in chunks, so only that one
/// line is loaded however large the file is.
fn line_ending_at(f: &mut File, end: u64) -> std::io::Result<Option<Vec<u8>>> {
    const CHUNK: u64 = 64 * 1024;
    let mut chunks: Vec<Vec<u8>> = Vec::new();
    let mut pos = end;
    while pos > 0 {
        let n = CHUNK.min(pos);
        pos -= n;
        let mut chunk = vec![0u8; n as usize];
        f.seek(SeekFrom::Start(pos))?;
        f.read_exact(&mut chunk)?;
        // The newest chunk ends with the line's own terminator: skip it.
        let search = if chunks.is_empty() {
            if chunk.last() != Some(&b'\n') {
                return Ok(None);
            }
            chunk.len() - 1
        } else {
            chunk.len()
        };
        if let Some(i) = chunk[..search].iter().rposition(|b| *b == b'\n') {
            chunk.drain(..=i);
            chunks.push(chunk);
            break;
        }
        chunks.push(chunk);
    }
    let mut line: Vec<u8> = chunks.into_iter().rev().flatten().collect();
    line.pop();
    Ok(Some(line))
}

fn value_id(v: &Value) -> Option<String> {
    v.get("id").and_then(Value::as_str).map(str::to_string)
}

fn entry_id(line: &[u8]) -> Option<String> {
    serde_json::from_slice::<Value>(line)
        .ok()
        .as_ref()
        .and_then(value_id)
}

/// Tool-result `details` the UI never reads dominate a long session's payload
/// (`read`/`grep` `displayContent` repeats the result text, `edit` repeats its
/// diff as `oldText`/`newText`/`perFileResults`). The renderers only use
/// `details.diff` (ToolCard), the `ask` answers and the `task`/`agent`
/// progress+results, so every other tool keeps just its diff.
fn slim_details(tool_name: &str, details: Option<&Value>) -> Option<Value> {
    let details = details?;
    if matches!(tool_name, "task" | "agent" | "ask") {
        return Some(details.clone());
    }
    let diff = details.get("diff").filter(|d| d.is_string())?;
    Some(serde_json::json!({ "diff": diff }))
}

#[cfg(test)]
pub fn normalize_lines(bytes: &[u8]) -> Vec<TranscriptItem> {
    bytes
        .split(|b| *b == b'\n')
        .filter(|l| !l.is_empty())
        .filter_map(|l| serde_json::from_slice::<Value>(l).ok())
        .filter_map(|v| normalize_entry(&v))
        .collect()
}

/// Map one session entry to a transcript item (None = not shown).
pub fn normalize_entry(v: &Value) -> Option<TranscriptItem> {
    let mut item = TranscriptItem {
        id: s(v, "id"),
        parent_id: v
            .get("parentId")
            .and_then(Value::as_str)
            .map(str::to_string),
        ts: s(v, "timestamp"),
        ..Default::default()
    };
    match v.get("type").and_then(Value::as_str)? {
        "message" => normalize_message(v.get("message")?, &mut item),
        "custom_message" => {
            // A user-invoked skill (`/skill:x args`) starts its own turn. Kept as
            // a generic custom item it would be folded into the previous turn as
            // a notice, hiding that turn's real answer behind the skill's reply.
            let skill_prompt = (v.get("customType").and_then(Value::as_str)
                == Some("skill-prompt")
                && v.get("display").and_then(Value::as_bool) == Some(true))
            .then(|| v.pointer("/details/prompt").and_then(Value::as_str))
            .flatten();
            if let Some(prompt) = skill_prompt {
                item.kind = TranscriptKind::User;
                item.text = Some(prompt.to_string());
            } else {
                item.kind = TranscriptKind::Custom;
                item.text = opt(content_text(v.get("content")));
                item.hidden = v.get("display").and_then(Value::as_bool) != Some(true);
            }
        }
        "compaction" => {
            item.kind = TranscriptKind::Compaction;
            item.text = v.get("summary").and_then(Value::as_str).map(str::to_string);
            item.first_kept_entry_id = v
                .get("firstKeptEntryId")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        "branch_summary" => {
            item.kind = TranscriptKind::BranchSummary;
            item.text = v.get("summary").and_then(Value::as_str).map(str::to_string);
        }
        "model_change" => {
            item.kind = TranscriptKind::ModelChange;
            item.model = v.get("model").and_then(Value::as_str).map(str::to_string);
        }
        _ => return None,
    }
    Some(item)
}

fn normalize_message(msg: &Value, item: &mut TranscriptItem) {
    let role = msg.get("role").and_then(Value::as_str).unwrap_or_default();
    match role {
        "user" => {
            if msg.get("toolCallId").is_some() || msg.get("toolName").is_some() {
                item.kind = TranscriptKind::ToolResult;
                item.tool_result = Some(ToolResultInfo {
                    tool_call_id: s(msg, "toolCallId"),
                    tool_name: s(msg, "toolName"),
                    text: content_text(msg.get("content")),
                    is_error: msg.get("isError").and_then(Value::as_bool).unwrap_or(false),
                    details: slim_details(&s(msg, "toolName"), msg.get("details")),
                });
            } else {
                item.kind = TranscriptKind::User;
                let raw = content_text(msg.get("content"));
                let clean = super::parse::strip_system_reminders(&raw);
                item.images = super::parse::parse_images(msg.get("content"));
                // Hidden only when there is nothing to show: a message whose
                // only content is an image keeps its text empty but must stay
                // visible (the UI renders the attachments).
                item.hidden = (clean.is_empty() && item.images.is_empty())
                    || raw.trim_start().starts_with("<system-reminder>");
                item.text = opt(clean.to_string());
            }
        }
        "developer" => {
            item.kind = TranscriptKind::System;
            item.text = opt(content_text(msg.get("content")));
            item.hidden = true;
        }
        "assistant" => {
            item.kind = TranscriptKind::Assistant;
            let mut texts = Vec::new();
            let mut thinking = Vec::new();
            for block in msg
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => texts.push(s(block, "text")),
                    Some("thinking") => thinking.push(s(block, "thinking")),
                    Some("toolCall") => {
                        let args = block.get("arguments").cloned().unwrap_or(Value::Null);
                        let intent = block
                            .get("intent")
                            .and_then(Value::as_str)
                            .or_else(|| args.get("i").and_then(Value::as_str))
                            .map(str::to_string);
                        item.tool_calls.push(ToolCall {
                            id: s(block, "id"),
                            name: s(block, "name"),
                            args,
                            intent,
                        });
                    }
                    _ => {}
                }
            }
            let raw_text = opt(texts.join("\n\n")).or_else(|| {
                msg.get("errorMessage")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
            item.text = raw_text
                .map(|t| super::parse::strip_image_markers(&t))
                .filter(|t| !t.trim().is_empty());
            item.thinking = opt(thinking.join("\n\n"));
            item.usage = msg.get("usage").map(parse_usage);
            item.model = msg.get("model").and_then(Value::as_str).map(str::to_string);
            item.stop_reason = msg
                .get("stopReason")
                .and_then(Value::as_str)
                .map(str::to_string);
            item.duration = num_u64(msg.get("duration"));
            item.ttft = num_u64(msg.get("ttft"));
            item.completed_at = num_i64(msg.get("completedAt"));
        }
        "toolResult" => {
            item.kind = TranscriptKind::ToolResult;
            item.tool_result = Some(ToolResultInfo {
                tool_call_id: s(msg, "toolCallId"),
                tool_name: s(msg, "toolName"),
                text: content_text(msg.get("content")),
                is_error: msg.get("isError").and_then(Value::as_bool).unwrap_or(false),
                details: slim_details(&s(msg, "toolName"), msg.get("details")),
            });
        }
        "bashExecution" | "pythonExecution" => {
            item.kind = TranscriptKind::Bash;
            let cmd = msg
                .get("command")
                .or_else(|| msg.get("code"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let output = msg
                .get("output")
                .and_then(Value::as_str)
                .unwrap_or_default();
            item.text = Some(format!("$ {cmd}\n{output}"));
        }
        "custom" | "hookMessage" | "fileMention" => {
            item.kind = TranscriptKind::Custom;
            item.text = opt(content_text(msg.get("content")));
            item.hidden = msg.get("display").and_then(Value::as_bool) == Some(false);
        }
        "branchSummary" => {
            item.kind = TranscriptKind::BranchSummary;
            item.text = msg
                .get("summary")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        "compactionSummary" => {
            item.kind = TranscriptKind::Compaction;
            item.text = msg
                .get("summary")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        _ => {
            item.kind = TranscriptKind::Unknown;
            item.text = opt(content_text(msg.get("content")));
        }
    }
}

pub fn parse_usage(u: &Value) -> Usage {
    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    let mut usage = Usage {
        input: n("input"),
        output: n("output"),
        cache_read: n("cacheRead"),
        cache_write: n("cacheWrite"),
        total_tokens: n("totalTokens"),
        cost: u
            .pointer("/cost/total")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    };
    if usage.total_tokens == 0 {
        usage.total_tokens = usage.input + usage.output + usage.cache_read + usage.cache_write;
    }
    usage
}

/// Non-negative JSON number as u64; accepts integer or float spelling and
/// rejects anything else (negatives included, where the cast would wrap).
fn num_u64(v: Option<&Value>) -> Option<u64> {
    let n = v?.as_f64()?;
    (n >= 0.0 && n <= u64::MAX as f64).then_some(n as u64)
}

/// Epoch-ms JSON number as i64 (accepts integer or float spelling).
fn num_i64(v: Option<&Value>) -> Option<i64> {
    let n = v?.as_f64()?;
    (n >= i64::MIN as f64 && n <= i64::MAX as f64).then_some(n as i64)
}

/// Sum assistant `usage` over the whole transcript: (total tokens, cost).
pub fn sum_usage(path: &Path) -> std::io::Result<(u64, f64)> {
    let reader = BufReader::with_capacity(256 * 1024, File::open(path)?);
    let (mut tokens, mut cost) = (0u64, 0f64);
    for line in reader.split(b'\n') {
        let line = line?;
        // Cheap prefilter before JSON parsing.
        if !contains(&line, b"\"usage\"") || !contains(&line, b"\"assistant\"") {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        if let Some(u) = v.pointer("/message/usage") {
            let u = parse_usage(u);
            tokens += u.total_tokens;
            cost += u.cost;
        }
    }
    Ok((tokens, cost))
}

/// Last thinking level and context size recorded in the transcript. File order
/// is treated as chronological; side branches are not distinguished.
pub fn session_snapshot(path: &Path) -> std::io::Result<SessionSnapshot> {
    let reader = BufReader::with_capacity(256 * 1024, File::open(path)?);
    let mut snap = SessionSnapshot::default();
    for line in reader.split(b'\n') {
        let line = line?;
        // Cheap prefilter before JSON parsing.
        let level = contains(&line, b"\"thinking_level_change\"");
        let compaction = contains(&line, b"\"compaction\"");
        let usage = contains(&line, b"\"usage\"") && contains(&line, b"\"assistant\"");
        if !(level || compaction || usage) {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        match v.get("type").and_then(Value::as_str) {
            Some("thinking_level_change") => {
                let l = v
                    .get("configured")
                    .and_then(Value::as_str)
                    .or_else(|| v.get("thinkingLevel").and_then(Value::as_str));
                if let Some(l) = l.filter(|l| !l.is_empty()) {
                    snap.thinking_level = Some(l.to_string());
                }
            }
            // The pre-compaction request size no longer describes the context.
            Some("compaction") => snap.context_tokens = None,
            Some("message") => {
                if v.pointer("/message/role").and_then(Value::as_str) != Some("assistant") {
                    continue;
                }
                if let Some(u) = v.pointer("/message/usage") {
                    let u = parse_usage(u);
                    let prompt = u.input + u.cache_read + u.cache_write;
                    if prompt > 0 {
                        snap.context_tokens = Some(prompt);
                    }
                }
            }
            _ => {}
        }
    }
    Ok(snap)
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

fn s(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn opt(s: String) -> Option<String> {
    (!s.trim().is_empty()).then_some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = concat!(
        r#"{"type":"title","v":1,"title":"t","pad":"  "}"#,
        "\n",
        r#"{"type":"session","version":3,"id":"S","timestamp":"T0","cwd":"/w"}"#,
        "\n",
        r#"{"type":"model_change","id":"m","parentId":null,"timestamp":"T1","model":"p/m"}"#,
        "\n",
        r#"{"type":"custom_message","id":"cm","parentId":"m","timestamp":"T2","customType":"x","content":"<system-reminder>hi</system-reminder>","display":false}"#,
        "\n",
        r#"{"type":"message","id":"u","parentId":"cm","timestamp":"T3","message":{"role":"user","content":[{"type":"text","text":"do it"},{"type":"image","data":"blob:sha256:x"}]}}"#,
        "\n",
        r#"{"type":"message","id":"a","parentId":"u","timestamp":"T4","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"ok"},{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"ls","i":"List"}}],"model":"m","stopReason":"toolUse","usage":{"input":10,"output":5,"cacheRead":100,"cacheWrite":0,"totalTokens":115,"cost":{"total":0.5}}}}"#,
        "\n",
        r#"{"type":"custom","id":"cu","parentId":"a","timestamp":"T5","customType":"tool_execution_start","data":{}}"#,
        "\n",
        r#"{"type":"message","id":"r","parentId":"cu","timestamp":"T6","message":{"role":"toolResult","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"a.txt"}],"isError":false,"details":{"x":1}}}"#,
        "\n",
        r#"{"type":"compaction","id":"k","parentId":"r","timestamp":"T7","summary":"sum"}"#,
        "\n",
    );

    #[test]
    fn normalizes_fixture() {
        let items = normalize_lines(FIXTURE.as_bytes());
        let kinds: Vec<_> = items.iter().map(|i| i.kind).collect();
        use TranscriptKind as K;
        assert_eq!(
            kinds,
            vec![
                K::ModelChange,
                K::Custom,
                K::User,
                K::Assistant,
                K::ToolResult,
                K::Compaction
            ]
        );

        assert!(items[1].hidden);
        assert_eq!(items[2].text.as_deref(), Some("do it"));
        assert_eq!(items[2].images.len(), 1);
        let a = &items[3];
        assert_eq!(a.thinking.as_deref(), Some("hmm"));
        assert_eq!(a.tool_calls[0].intent.as_deref(), Some("List"));
        assert_eq!(a.usage.as_ref().unwrap().total_tokens, 115);
        assert_eq!(a.parent_id.as_deref(), Some("u"));
        let r = items[4].tool_result.as_ref().unwrap();
        assert_eq!((r.tool_call_id.as_str(), r.text.as_str()), ("c1", "a.txt"));
        assert_eq!(items[5].text.as_deref(), Some("sum"));
    }

    /// A user message whose only content is an image must stay visible: the
    /// text is empty by design, but hiding it drops the attachment from the
    /// chat transcript.
    #[test]
    fn image_only_user_message_is_not_hidden() {
        let line = r#"{"type":"message","id":"u2","parentId":"x","timestamp":"T","message":{"role":"user","content":[{"type":"image","data":"blob:sha256:abc"}]}}"#;
        let item = normalize_entry(&serde_json::from_str(line).unwrap()).unwrap();
        assert_eq!(item.kind, TranscriptKind::User);
        assert_eq!(item.text, None);
        assert_eq!(item.images.len(), 1);
        assert!(!item.hidden, "image-only message must stay visible");

        // Nothing at all (empty content) stays hidden.
        let empty = r#"{"type":"message","id":"u3","parentId":"x","timestamp":"T","message":{"role":"user","content":[]}}"#;
        let item = normalize_entry(&serde_json::from_str(empty).unwrap()).unwrap();
        assert!(item.hidden);

        // A system reminder alone stays hidden even though it carries no text.
        let reminder = r#"{"type":"message","id":"u4","parentId":"x","timestamp":"T","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>x</system-reminder>"}]}}"#;
        let item = normalize_entry(&serde_json::from_str(reminder).unwrap()).unwrap();
        assert!(item.hidden);
    }

    #[test]
    fn skill_prompt_starts_a_user_turn() {
        let line = r#"{"type":"custom_message","id":"sp","parentId":"x","timestamp":"T","customType":"skill-prompt","content":"[IMPORTANT: ...] # Visualize ...","display":true,"details":{"name":"visualize","prompt":"/skill:visualize chart this"}}"#;
        let item = normalize_entry(&serde_json::from_str(line).unwrap()).unwrap();
        assert_eq!(item.kind, TranscriptKind::User);
        assert_eq!(item.text.as_deref(), Some("/skill:visualize chart this"));
        assert!(!item.hidden);

        // Hidden skill prompts keep the generic custom mapping.
        let hidden = line.replace("\"display\":true", "\"display\":false");
        let item = normalize_entry(&serde_json::from_str(&hidden).unwrap()).unwrap();
        assert_eq!(item.kind, TranscriptKind::Custom);
    }

    #[test]
    fn incremental_reads_only_complete_lines() {
        let dir = std::env::temp_dir().join(format!("ompws-tr-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        // Last line is incomplete (no trailing newline).
        let partial = r#"{"type":"message","id":"z","message":{"role":"user""#;
        std::fs::write(&path, format!("{FIXTURE}{partial}")).unwrap();
        let page = read_page(&path, "S", 0, None).unwrap();
        assert_eq!(page.items.len(), 6);
        assert_eq!(page.next_offset, FIXTURE.len() as u64);
        assert!(!page.reset);
        assert_eq!(page.tail_id.as_deref(), Some("k"));
        // Complete the line and read incrementally.
        std::fs::write(
            &path,
            format!("{FIXTURE}{partial},\"content\":\"more\"}}}}\n"),
        )
        .unwrap();
        let page2 = read_page(&path, "S", page.next_offset, page.tail_id.as_deref()).unwrap();
        assert!(!page2.reset);
        assert_eq!(page2.items.len(), 1);
        assert_eq!(page2.items[0].text.as_deref(), Some("more"));
        assert_eq!(page2.tail_id.as_deref(), Some("z"));
        // Nothing new: the tail is kept, no reset.
        let page2b = read_page(&path, "S", page2.next_offset, Some("z")).unwrap();
        assert!(!page2b.reset && page2b.items.is_empty());
        assert_eq!(page2b.tail_id.as_deref(), Some("z"));
        // Offset past EOF resets.
        let page3 = read_page(&path, "S", 10_000_000, None).unwrap();
        assert!(page3.reset);
        assert_eq!(page3.items.len(), 7);
        assert_eq!(sum_usage(&path).unwrap(), (115, 0.5));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn user_line(id: &str, text: &str) -> String {
        format!(
            r#"{{"type":"message","id":"{id}","timestamp":"T","message":{{"role":"user","content":[{{"type":"text","text":"{text}"}}]}}}}"#
        ) + "\n"
    }

    /// omp `/shake` rewrites the file in place (old tool results shrink), then
    /// the next turn is appended. The stale offset now points into the middle
    /// of the new content: reading from it skipped the user's message.
    #[test]
    fn rewritten_file_restarts_instead_of_skipping_entries() {
        let dir = std::env::temp_dir().join(format!("ompws-tr-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let big = "x".repeat(400);
        let before = user_line("u1", "first") + &user_line("r1", &big);
        std::fs::write(&path, &before).unwrap();
        let page = read_page(&path, "S", 0, None).unwrap();
        assert_eq!(page.tail_id.as_deref(), Some("r1"));

        // Shake shrinks r1, then a new turn is appended past the old offset.
        let after = user_line("u1", "first")
            + &user_line("r1", "elided")
            + &user_line("u2", "new message")
            + &user_line("a2", &big);
        std::fs::write(&path, &after).unwrap();
        assert!((page.next_offset as usize) < after.len());
        let page2 = read_page(&path, "S", page.next_offset, page.tail_id.as_deref()).unwrap();
        assert!(page2.reset);
        let ids: Vec<_> = page2.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["u1", "r1", "u2", "a2"]);

        // Same length rewrite: the offset is still a line boundary, but the
        // entry ending there is a different one.
        let before = user_line("u1", "first") + &user_line("aa", "old");
        std::fs::write(&path, &before).unwrap();
        let page = read_page(&path, "S", 0, None).unwrap();
        let after = user_line("u1", "first") + &user_line("bb", "new") + &user_line("u3", "next");
        std::fs::write(&path, &after).unwrap();
        let page2 = read_page(&path, "S", page.next_offset, page.tail_id.as_deref()).unwrap();
        assert!(page2.reset);
        assert_eq!(page2.items.len(), 3);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn line_ending_at_spans_chunks() {
        let dir = std::env::temp_dir().join(format!("ompws-tr-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        // A line longer than one 64 KiB backwards chunk, and the first line.
        let long = user_line("big", &"y".repeat(150_000));
        let content = user_line("u0", "head") + &long;
        std::fs::write(&path, &content).unwrap();
        let mut f = File::open(&path).unwrap();
        let end = content.len() as u64;
        let line = line_ending_at(&mut f, end).unwrap().unwrap();
        assert_eq!(line, long.trim_end().as_bytes());
        let first = user_line("u0", "head");
        let line = line_ending_at(&mut f, first.len() as u64).unwrap().unwrap();
        assert_eq!(line, first.trim_end().as_bytes());
        assert!(line_ending_at(&mut f, first.len() as u64 + 5)
            .unwrap()
            .is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn snapshot_tracks_last_level_and_context() {
        let dir = std::env::temp_dir().join(format!("ompws-snap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let asst = |input: u64, cache: u64| {
            format!(
                r#"{{"type":"message","id":"a","message":{{"role":"assistant","content":[],"usage":{{"input":{input},"output":9,"cacheRead":{cache},"cacheWrite":0,"totalTokens":{}}}}}}}"#,
                input + cache + 9
            )
        };
        let body = [
            r#"{"type":"thinking_level_change","thinkingLevel":"low","configured":"auto"}"#
                .to_string(),
            asst(10, 100),
            r#"{"type":"thinking_level_change","thinkingLevel":"high"}"#.to_string(),
            asst(20, 200),
        ]
        .join("\n");
        std::fs::write(&path, &body).unwrap();
        let snap = session_snapshot(&path).unwrap();
        assert_eq!(snap.thinking_level.as_deref(), Some("high"));
        assert_eq!(snap.context_tokens, Some(220));

        let compaction = r#"{"type":"compaction","summary":"s"}"#;
        std::fs::write(&path, format!("{body}\n{compaction}")).unwrap();
        assert_eq!(session_snapshot(&path).unwrap().context_tokens, None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn user_role_tool_result_normalizes_as_tool_result() {
        let line = r#"{"type":"message","id":"x","timestamp":"T","message":{"role":"user","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"output"}],"isError":false}}"#;
        let items = normalize_lines(line.as_bytes());
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, TranscriptKind::ToolResult);
        let r = items[0].tool_result.as_ref().unwrap();
        assert_eq!(r.tool_call_id, "c1");
        assert_eq!(r.text, "output");
    }

    #[test]
    fn user_message_strips_system_reminders() {
        let line = r#"{"type":"message","id":"x","timestamp":"T","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>note</system-reminder>\nactual prompt"}]}}"#;
        let items = normalize_lines(line.as_bytes());
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, TranscriptKind::User);
        assert_eq!(items[0].text.as_deref(), Some("actual prompt"));
        assert!(items[0].hidden);
    }

    #[test]
    fn request_stats_parsed_for_assistant_messages() {
        let with = r#"{"type":"message","id":"a","timestamp":"T","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"model":"m","stopReason":"stop","duration":6967.0,"ttft":2400,"completedAt":1759345643000,"usage":{"input":2,"output":306,"cacheRead":27000,"cacheWrite":3592}}}"#;
        let item = normalize_entry(&serde_json::from_str(with).unwrap()).unwrap();
        assert_eq!(item.kind, TranscriptKind::Assistant);
        assert_eq!(item.duration, Some(6967));
        assert_eq!(item.ttft, Some(2400));
        assert_eq!(item.completed_at, Some(1_759_345_643_000));

        // Older transcripts carry none of them: every field stays None.
        let old = r#"{"type":"message","id":"b","timestamp":"T","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"output":1}}}"#;
        let item = normalize_entry(&serde_json::from_str(old).unwrap()).unwrap();
        assert_eq!(
            (item.duration, item.ttft, item.completed_at),
            (None, None, None)
        );

        // Non-assistant items and non-numeric values never carry request stats.
        let user = r#"{"type":"message","id":"c","timestamp":"T","message":{"role":"user","content":[{"type":"text","text":"hi"}],"duration":10,"ttft":"1","completedAt":true}}"#;
        let item = normalize_entry(&serde_json::from_str(user).unwrap()).unwrap();
        assert_eq!(
            (item.duration, item.ttft, item.completed_at),
            (None, None, None)
        );
        let bad = r#"{"type":"message","id":"d","timestamp":"T","message":{"role":"assistant","content":[],"duration":"1s","ttft":-5,"completedAt":null}}"#;
        let item = normalize_entry(&serde_json::from_str(bad).unwrap()).unwrap();
        assert_eq!(
            (item.duration, item.ttft, item.completed_at),
            (None, None, None)
        );
    }

    #[test]
    fn tool_result_details_keep_only_what_the_ui_reads() {
        let line = |name: &str, details: &str| {
            format!(
                r#"{{"type":"message","id":"r","timestamp":"T","message":{{"role":"toolResult","toolCallId":"c","toolName":"{name}","content":[{{"type":"text","text":"out"}}],"details":{details}}}}}"#
            )
        };
        let details = |name: &str, d: &str| {
            let item = normalize_entry(&serde_json::from_str(&line(name, d)).unwrap()).unwrap();
            item.tool_result.unwrap().details
        };
        // read: the duplicated display copy is dropped, nothing else is used.
        assert_eq!(
            details("read", r#"{"displayContent":"out","totalLines":1}"#),
            None
        );
        // edit: only the diff survives.
        assert_eq!(
            details(
                "edit",
                r#"{"diff":" 1|a","oldText":"a","newText":"b","perFileResults":[1]}"#
            ),
            Some(serde_json::json!({"diff":" 1|a"}))
        );
        // task / ask results are rendered from details.
        let task = r#"{"results":[{"id":"A"}],"progress":[]}"#;
        assert_eq!(
            details("task", task),
            Some(serde_json::from_str(task).unwrap())
        );
        assert!(details("ask", r#"{"results":[]}"#).is_some());
    }
}
