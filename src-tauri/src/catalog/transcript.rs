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
/// An offset beyond the file size restarts from 0 with `reset = true`.
pub fn read_page(
    path: &Path,
    session_id: &str,
    from_offset: u64,
) -> std::io::Result<TranscriptPage> {
    let mut f = File::open(path)?;
    let size = f.metadata()?.len();
    let (start, reset) = if from_offset > size {
        (0, true)
    } else {
        (from_offset, false)
    };
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((size - start) as usize);
    f.take(size - start).read_to_end(&mut buf)?;
    // Only complete lines: stop after the last newline.
    let complete = buf.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
    let items = normalize_lines(&buf[..complete]);
    Ok(TranscriptPage {
        session_id: session_id.to_string(),
        items,
        next_offset: start + complete as u64,
        reset,
    })
}

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
                    details: msg.get("details").cloned(),
                });
            } else {
                item.kind = TranscriptKind::User;
                let raw = content_text(msg.get("content"));
                let clean = super::parse::strip_system_reminders(&raw);
                item.hidden = clean.is_empty() || raw.trim_start().starts_with("<system-reminder>");
                item.text = opt(clean.to_string());
                item.images = super::parse::parse_images(msg.get("content"));
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
                details: msg.get("details").cloned(),
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
        let page = read_page(&path, "S", 0).unwrap();
        assert_eq!(page.items.len(), 6);
        assert_eq!(page.next_offset, FIXTURE.len() as u64);
        assert!(!page.reset);
        // Complete the line and read incrementally.
        std::fs::write(
            &path,
            format!("{FIXTURE}{partial},\"content\":\"more\"}}}}\n"),
        )
        .unwrap();
        let page2 = read_page(&path, "S", page.next_offset).unwrap();
        assert_eq!(page2.items.len(), 1);
        assert_eq!(page2.items[0].text.as_deref(), Some("more"));
        // Offset past EOF resets.
        let page3 = read_page(&path, "S", 10_000_000).unwrap();
        assert!(page3.reset);
        assert_eq!(page3.items.len(), 7);
        assert_eq!(sum_usage(&path).unwrap(), (115, 0.5));
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
}
