//! Fast, partial parsing of OMP session files for listing.
//!
//! Listing only reads the head (title slot + header) and the last ~64 KB tail;
//! everything here is pure and unit-tested with fixtures.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use crate::contracts::ResultBadge;

/// Bytes read from the start of the file for the title slot + header.
const HEAD_BYTES: usize = 16 * 1024;
/// Default tail window.
pub const TAIL_BYTES: u64 = 64 * 1024;
/// Tail windows tried when the default one holds no complete message line.
const TAIL_FALLBACKS: [u64; 2] = [512 * 1024, 4 * 1024 * 1024];
/// Head window scanned for the first user message (title fallback only).
const FIRST_USER_BYTES: u64 = 256 * 1024;

/// Head fields: title slot + session header.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HeadInfo {
    pub id: String,
    pub cwd: String,
    pub created_at: String,
    pub slot_title: Option<String>,
    pub header_title: Option<String>,
    pub parent_session: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LastRole {
    User,
    ToolResult,
    Assistant,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LastMsg {
    pub role: LastRole,
    pub stop_reason: Option<String>,
    pub has_tool_calls: bool,
    pub ts: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExitInfo {
    pub kind: String,
    pub pending_tool_calls: bool,
    /// Exit recorded after the last conversation message.
    pub after_last_msg: bool,
}

/// Derived conversation state of the transcript tail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TailState {
    /// No conversation messages at all.
    Empty,
    /// Last turn completed normally.
    Clean,
    /// Turn left non-terminal (or process exit with pending tool calls).
    Interrupted,
    /// Last assistant message ended with `stopReason: "error"`.
    Error,
}

/// Everything listing needs from the tail window.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TailInfo {
    pub last_msg: Option<LastMsg>,
    pub last_assistant: Option<String>,
    pub model: Option<String>,
    pub title_change: Option<String>,
    pub exit: Option<ExitInfo>,
    pub result: Option<ResultBadge>,
}

impl TailInfo {
    pub fn state(&self) -> TailState {
        let Some(last) = &self.last_msg else {
            return TailState::Empty;
        };
        let non_terminal = match last.role {
            LastRole::User | LastRole::ToolResult => true,
            LastRole::Assistant => {
                last.has_tool_calls || last.stop_reason.as_deref() == Some("toolUse")
            }
        };
        if non_terminal {
            return TailState::Interrupted;
        }
        if last.stop_reason.as_deref() == Some("error") {
            return TailState::Error;
        }
        if let Some(exit) = &self.exit {
            if exit.after_last_msg && exit.pending_tool_calls {
                return TailState::Interrupted;
            }
            // An abnormal exit only counts when the turn itself did not finish
            // cleanly (a SIGHUP after a completed turn is just a closed terminal).
            if exit.after_last_msg
                && exit.kind != "normal"
                && last.stop_reason.as_deref() != Some("stop")
            {
                return TailState::Interrupted;
            }
        }
        TailState::Clean
    }
}

/// Parse the title slot / header from the first bytes of a file.
pub fn parse_head(bytes: &[u8]) -> Option<HeadInfo> {
    let mut info = HeadInfo::default();
    for line in bytes.split(|b| *b == b'\n').take(3) {
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        match v.get("type").and_then(Value::as_str) {
            Some("title") => info.slot_title = non_empty(v.get("title")),
            Some("session") => {
                info.id = v.get("id").and_then(Value::as_str)?.to_string();
                info.cwd = str_of(&v, "cwd");
                info.created_at = str_of(&v, "timestamp");
                info.header_title = non_empty(v.get("title"));
                info.parent_session = non_empty(v.get("parentSession"));
                return Some(info);
            }
            _ => {}
        }
    }
    None
}

pub fn read_head(path: &Path) -> std::io::Result<Option<HeadInfo>> {
    let mut f = File::open(path)?;
    let mut buf = vec![0u8; HEAD_BYTES];
    let n = read_up_to(&mut f, &mut buf)?;
    buf.truncate(n);
    Ok(parse_head(&buf))
}

/// Read the tail window, widening it if it holds no complete message line.
pub fn read_tail(path: &Path, size: u64) -> std::io::Result<TailInfo> {
    let mut f = File::open(path)?;
    let mut window = TAIL_BYTES;
    loop {
        let start = size.saturating_sub(window);
        f.seek(SeekFrom::Start(start))?;
        let mut buf = Vec::with_capacity((size - start) as usize);
        (&mut f).take(size - start).read_to_end(&mut buf)?;
        let body = if start > 0 {
            match buf.iter().position(|b| *b == b'\n') {
                Some(i) => &buf[i + 1..],
                None => &buf[..0],
            }
        } else {
            &buf[..]
        };
        let info = parse_tail(body);
        let next = TAIL_FALLBACKS.iter().copied().find(|w| *w > window);
        match next {
            Some(w) if info.last_msg.is_none() && start > 0 => window = w,
            _ => return Ok(info),
        }
    }
}

/// Analyse complete JSONL lines of the tail window (in file order).
pub fn parse_tail(bytes: &[u8]) -> TailInfo {
    let mut info = TailInfo::default();
    // Bash tool calls (id -> command) matching the test/build pattern.
    let mut bash_calls: Vec<(String, String)> = Vec::new();
    for line in bytes.split(|b| *b == b'\n') {
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        let ts = str_of(&v, "timestamp");
        match v.get("type").and_then(Value::as_str) {
            Some("message") => {
                let Some(msg) = v.get("message") else {
                    continue;
                };
                match msg.get("role").and_then(Value::as_str) {
                    Some("user") => {
                        if msg.get("toolCallId").is_some() || msg.get("toolName").is_some() {
                            info.last_msg =
                                Some(last(LastRole::ToolResult, None, false, ts.clone()));
                            mark_exit_stale(&mut info);
                            let call_id = str_of(msg, "toolCallId");
                            if let Some(pos) = bash_calls.iter().position(|(id, _)| *id == call_id)
                            {
                                let (_, cmd) = bash_calls.remove(pos);
                                info.result = Some(result_badge(&cmd, msg, &ts));
                            }
                        } else {
                            info.last_msg = Some(last(LastRole::User, None, false, ts));
                            mark_exit_stale(&mut info);
                        }
                    }
                    Some("toolResult") => {
                        info.last_msg = Some(last(LastRole::ToolResult, None, false, ts.clone()));
                        mark_exit_stale(&mut info);
                        let call_id = str_of(msg, "toolCallId");
                        if let Some(pos) = bash_calls.iter().position(|(id, _)| *id == call_id) {
                            let (_, cmd) = bash_calls.remove(pos);
                            info.result = Some(result_badge(&cmd, msg, &ts));
                        }
                    }
                    Some("assistant") => {
                        let content = msg.get("content").and_then(Value::as_array);
                        let mut has_calls = false;
                        let mut text = String::new();
                        for block in content.into_iter().flatten() {
                            match block.get("type").and_then(Value::as_str) {
                                Some("toolCall") => {
                                    has_calls = true;
                                    if block.get("name").and_then(Value::as_str) == Some("bash") {
                                        let cmd = block
                                            .pointer("/arguments/command")
                                            .and_then(Value::as_str)
                                            .unwrap_or_default();
                                        if is_result_command(cmd) {
                                            bash_calls.push((str_of(block, "id"), cmd.to_string()));
                                        }
                                    }
                                }
                                Some("text") if text.is_empty() => {
                                    text = str_of(block, "text").trim().to_string();
                                }
                                _ => {}
                            }
                        }
                        if !text.is_empty() {
                            info.last_assistant = Some(snippet(&text, 200));
                        }
                        if let Some(m) = non_empty(msg.get("model")) {
                            info.model = Some(m);
                        }
                        let stop = non_empty(msg.get("stopReason"));
                        info.last_msg = Some(last(LastRole::Assistant, stop, has_calls, ts));
                        mark_exit_stale(&mut info);
                    }
                    _ => {}
                }
            }
            Some("custom")
                if v.get("customType").and_then(Value::as_str) == Some("session_exit") =>
            {
                let data = v.get("data").cloned().unwrap_or(Value::Null);
                let pending = data
                    .get("pendingToolCalls")
                    .and_then(Value::as_array)
                    .is_some_and(|a| !a.is_empty());
                info.exit = Some(ExitInfo {
                    kind: str_of(&data, "kind"),
                    pending_tool_calls: pending,
                    after_last_msg: true,
                });
            }
            Some("title_change") => {
                if let Some(t) = non_empty(v.get("title")) {
                    info.title_change = Some(t);
                }
            }
            Some("model_change") => {
                if let Some(m) = non_empty(v.get("model")) {
                    info.model = Some(m);
                }
            }
            _ => {}
        }
    }
    info
}

/// First user text (≤40 chars) from the head of the file — title fallback.
pub fn read_first_user(path: &Path) -> Option<String> {
    let f = File::open(path).ok()?;
    let mut buf = Vec::new();
    f.take(FIRST_USER_BYTES).read_to_end(&mut buf).ok()?;
    for line in buf.split(|b| *b == b'\n') {
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let Some(msg) = v.get("message") else {
            continue;
        };
        if msg.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        if msg.get("toolCallId").is_some() || msg.get("toolName").is_some() {
            continue;
        }
        let raw = content_text(msg.get("content"));
        let clean = strip_system_reminders(&raw);
        if !clean.is_empty() {
            return Some(snippet(clean, 40));
        }
    }
    None
}

/// Strip leading `<system-reminder>` and `<system-notice>` wrapper blocks.
pub fn strip_system_reminders(mut s: &str) -> &str {
    s = s.trim();
    while s.starts_with('<') {
        if let Some(rest) = s.strip_prefix("<system-reminder>") {
            if let Some(end) = rest.find("</system-reminder>") {
                s = rest[end + "</system-reminder>".len()..].trim();
                continue;
            }
        }
        if let Some(rest) = s.strip_prefix("<system-notice>") {
            if let Some(end) = rest.find("</system-notice>") {
                s = rest[end + "</system-notice>".len()..].trim();
                continue;
            }
        }
        break;
    }
    s.trim()
}

fn result_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\b(test|vitest|jest|pytest|cargo (test|build|check)|tsc|build)\b").unwrap()
    })
}

pub fn is_result_command(cmd: &str) -> bool {
    result_regex().is_match(cmd)
}

/// Build a ResultBadge from a bash command and its toolResult message.
pub fn result_badge(cmd: &str, msg: &Value, ts: &str) -> ResultBadge {
    static TEST_RE: OnceLock<Regex> = OnceLock::new();
    static EXIT_RE: OnceLock<Regex> = OnceLock::new();
    static FAIL_RE: OnceLock<Regex> = OnceLock::new();
    let test_re =
        TEST_RE.get_or_init(|| Regex::new(r"\b(test|vitest|jest|pytest|cargo test)\b").unwrap());
    let exit_re = EXIT_RE.get_or_init(|| Regex::new(r"(?i)exited with code (\d+)").unwrap());
    let fail_re = FAIL_RE.get_or_init(|| {
        Regex::new(r"(?i)(\b[1-9]\d* (failed|failing)\b|\bFAILED\b|\bFAIL\b|error\[E\d+\]|error TS\d+|panicked at|\btest result: FAILED)").unwrap()
    });
    let kind = if test_re.is_match(cmd) {
        "test"
    } else {
        "build"
    };
    let text = content_text(msg.get("content"));
    let is_error = msg.get("isError").and_then(Value::as_bool).unwrap_or(false);
    let exit_code = exit_re
        .captures_iter(&text)
        .last()
        .and_then(|c| c[1].parse::<i64>().ok());
    let ok = match exit_code {
        Some(code) => code == 0,
        None => !is_error && !fail_re.is_match(&text),
    };
    let detail = match exit_code {
        Some(code) if code != 0 => format!("exit {code}"),
        _ if ok => "通过".to_string(),
        _ => "失败".to_string(),
    };
    ResultBadge {
        kind: kind.to_string(),
        ok,
        at: ts.to_string(),
        summary: format!("{} · {}", snippet(cmd.trim(), 60), detail),
    }
}

/// Concatenate text blocks of a message `content` (string or block array).
pub fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocks)) => {
            let mut out = String::new();
            for b in blocks {
                let b_type = b.get("type").and_then(Value::as_str);
                if b_type == Some("tool_result") || b_type == Some("toolResult") {
                    continue;
                }
                match b_type {
                    Some("text") => {
                        if !out.is_empty() {
                            out.push('\n');
                        }
                        out.push_str(b.get("text").and_then(Value::as_str).unwrap_or_default());
                    }
                    Some("image") => {
                        // Structured images are handled via parse_images
                    }
                    _ => {}
                }
            }
            out
        }
        _ => String::new(),
    }
}

/// Collapse whitespace and truncate to `max` chars with an ellipsis.
pub fn snippet(text: &str, max: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut s: String = flat.chars().take(max.saturating_sub(1)).collect();
    s.push('…');
    s
}

fn image_marker_re() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\[Image #\d+(?:,\s*\d+x\d+)?\]|\[图片(?::\s*[^\]]+)?\]").unwrap()
    })
}

fn marker_detail_re() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"\[Image #\d+(?:,\s*(?P<w>\d+)x(?P<h>\d+))?\]|\[图片(?::\s*(?P<path>[^\]]+))?\]",
        )
        .unwrap()
    })
}

fn image_annotation_re() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\[\d+\]\s*\([^\)]*?\.(?:png|jpe?g|gif|webp|svg|bmp)[^\)]*\)\s*\n?>?\s*")
            .unwrap()
    })
}

/// Strip raw image markers (`[Image #N...]`, `[图片...]`) and leftover image
/// annotation headers (`[1] (/tmp/x.png)\n> `) from text.
pub fn strip_image_markers(text: &str) -> String {
    let without_headers = image_annotation_re().replace_all(text, "");
    let cleaned = image_marker_re().replace_all(&without_headers, "");
    cleaned.trim().to_string()
}

/// Resolve an image hash to a file in ~/.omp/agent/blobs if it exists.
pub fn resolve_blob_path(hash: &str) -> Option<String> {
    let clean = hash.strip_prefix("blob:sha256:").unwrap_or(hash);
    let home = std::env::var("HOME")
        .ok()
        .map(std::path::PathBuf::from)
        .or_else(dirs::home_dir)?;
    let blob_dir = home.join(".omp").join("agent").join("blobs");
    let direct = blob_dir.join(clean);
    if direct.is_file() {
        return Some(direct.to_string_lossy().into_owned());
    }
    for ext in &["png", "webp", "jpg", "jpeg", "gif"] {
        let with_ext = blob_dir.join(format!("{clean}.{ext}"));
        if with_ext.is_file() {
            return Some(with_ext.to_string_lossy().into_owned());
        }
    }
    None
}

/// Extract structured image attachments from message content (both blocks and markers).
pub fn parse_images(content: Option<&Value>) -> Vec<crate::contracts::ImageAttachment> {
    let mut images = Vec::new();
    let mut idx = 1;

    if let Some(Value::Array(blocks)) = content {
        for b in blocks {
            if b.get("type").and_then(Value::as_str) == Some("image") {
                let data = b.get("data").and_then(Value::as_str);
                let path_field = b.get("path").and_then(Value::as_str);
                let mime_type = b
                    .get("mimeType")
                    .or_else(|| b.get("mediaType"))
                    .and_then(Value::as_str)
                    .map(str::to_string);

                let resolved_path = if let Some(p) = path_field {
                    Some(p.to_string())
                } else if let Some(d) = data {
                    resolve_blob_path(d)
                } else {
                    None
                };

                let marker = format!("[图片 #{idx}]");
                images.push(crate::contracts::ImageAttachment {
                    id: format!("img-{idx}"),
                    marker: Some(marker),
                    path: resolved_path,
                    mime_type,
                    width: None,
                    height: None,
                });
                idx += 1;
            }
        }
    }

    let check_text =
        |text: &str, images: &mut Vec<crate::contracts::ImageAttachment>, idx: &mut usize| {
            for caps in marker_detail_re().captures_iter(text) {
                let whole = caps.get(0).map(|m| m.as_str()).unwrap_or_default();
                let w = caps.name("w").and_then(|m| m.as_str().parse::<u32>().ok());
                let h = caps.name("h").and_then(|m| m.as_str().parse::<u32>().ok());
                let raw_path = caps.name("path").map(|m| m.as_str().trim().to_string());
                let resolved_path = raw_path.filter(|p| Path::new(p).exists());

                if let Some(existing) = images.iter_mut().find(|img| {
                    img.width.is_none() && (w.is_some() || h.is_some() || resolved_path.is_some())
                }) {
                    if existing.width.is_none() {
                        existing.width = w;
                    }
                    if existing.height.is_none() {
                        existing.height = h;
                    }
                    if existing.path.is_none() && resolved_path.is_some() {
                        existing.path = resolved_path;
                    }
                    existing.marker = Some(whole.to_string());
                } else {
                    images.push(crate::contracts::ImageAttachment {
                        id: format!("img-{}", *idx),
                        marker: Some(whole.to_string()),
                        path: resolved_path,
                        mime_type: None,
                        width: w,
                        height: h,
                    });
                    *idx += 1;
                }
            }
        };

    match content {
        Some(Value::String(s)) => check_text(s, &mut images, &mut idx),
        Some(Value::Array(blocks)) => {
            for b in blocks {
                if b.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(t) = b.get("text").and_then(Value::as_str) {
                        check_text(t, &mut images, &mut idx);
                    }
                }
            }
        }
        _ => {}
    }

    images
}

fn last(role: LastRole, stop_reason: Option<String>, has_tool_calls: bool, ts: String) -> LastMsg {
    LastMsg {
        role,
        stop_reason,
        has_tool_calls,
        ts,
    }
}

fn mark_exit_stale(info: &mut TailInfo) {
    if let Some(exit) = &mut info.exit {
        exit.after_last_msg = false;
    }
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn non_empty(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn read_up_to(f: &mut File, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match f.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_image_markers_removes_image_annotation_headers() {
        let text = "[1] (/var/folders/x/shot.PNG)\n> [图片: /var/folders/x/shot.PNG]\n看看这个";
        assert_eq!(strip_image_markers(text), "看看这个");
        assert_eq!(
            strip_image_markers("[2] (src/a.ts)\n> code"),
            "[2] (src/a.ts)\n> code"
        );
    }

    const HEAD: &str = r##"{"type":"title","v":1,"title":"#90-demo 计划","source":"user","pad":"   "}
{"type":"session","version":3,"id":"sess-1","timestamp":"2026-09-21T18:04:50.877Z","cwd":"/work/demo","title":"old"}
"##;

    fn msg(role: &str, extra: &str) -> String {
        format!(
            r#"{{"type":"message","id":"x","timestamp":"2026-09-21T18:10:00.000Z","message":{{"role":"{role}"{extra}}}}}"#
        )
    }

    #[test]
    fn head_reads_slot_and_header() {
        let h = parse_head(HEAD.as_bytes()).unwrap();
        assert_eq!(h.id, "sess-1");
        assert_eq!(h.cwd, "/work/demo");
        assert_eq!(h.slot_title.as_deref(), Some("#90-demo 计划"));
        assert_eq!(h.header_title.as_deref(), Some("old"));
    }

    #[test]
    fn legacy_head_without_slot() {
        let h = parse_head(br#"{"type":"session","id":"a","cwd":"/x","timestamp":"t"}"#).unwrap();
        assert_eq!(h.id, "a");
        assert!(h.slot_title.is_none());
        assert!(parse_head(b"{\"type\":\"message\"}\n").is_none());
    }

    #[test]
    fn tail_clean_turn() {
        let body = [
            msg("user", r#","content":[{"type":"text","text":"hi"}]"#),
            msg(
                "assistant",
                r#","content":[{"type":"thinking","thinking":"t"},{"type":"text","text":"Done   now"}],"model":"m1","stopReason":"stop""#,
            ),
        ]
        .join("\n");
        let t = parse_tail(body.as_bytes());
        assert_eq!(t.state(), TailState::Clean);
        assert_eq!(t.last_assistant.as_deref(), Some("Done now"));
        assert_eq!(t.model.as_deref(), Some("m1"));
    }

    #[test]
    fn tail_non_terminal_states() {
        let user_last = msg("user", r#","content":"x""#);
        assert_eq!(
            parse_tail(user_last.as_bytes()).state(),
            TailState::Interrupted
        );
        let calls = msg(
            "assistant",
            r#","content":[{"type":"toolCall","id":"c1","name":"read","arguments":{}}],"stopReason":"toolUse""#,
        );
        assert_eq!(parse_tail(calls.as_bytes()).state(), TailState::Interrupted);
        let err = msg("assistant", r#","content":[],"stopReason":"error""#);
        assert_eq!(parse_tail(err.as_bytes()).state(), TailState::Error);
        assert_eq!(parse_tail(b"").state(), TailState::Empty);
    }

    #[test]
    fn tail_session_exit_rules() {
        let done = msg(
            "assistant",
            r#","content":[{"type":"text","text":"ok"}],"stopReason":"stop""#,
        );
        let exit = |kind: &str, pending: &str| {
            format!(
                r#"{{"type":"custom","customType":"session_exit","data":{{"reason":"r","kind":"{kind}"{pending}}}}}"#
            )
        };
        // SIGHUP after a completed turn is not an interruption.
        let t = parse_tail(format!("{done}\n{}", exit("signal", "")).as_bytes());
        assert_eq!(t.state(), TailState::Clean);
        // Pending tool calls recorded at exit are.
        let t = parse_tail(
            format!(
                "{done}\n{}",
                exit("normal", r#","pendingToolCalls":[{"toolName":"bash"}]"#)
            )
            .as_bytes(),
        );
        assert_eq!(t.state(), TailState::Interrupted);
        // Aborted turn + signal exit is.
        let aborted = msg("assistant", r#","content":[],"stopReason":"aborted""#);
        let t = parse_tail(format!("{aborted}\n{}", exit("signal", "")).as_bytes());
        assert_eq!(t.state(), TailState::Interrupted);
        // An exit followed by a new completed turn is stale.
        let t = parse_tail(format!("{aborted}\n{}\n{done}", exit("signal", "")).as_bytes());
        assert_eq!(t.state(), TailState::Clean);
    }

    #[test]
    fn result_badge_from_bash() {
        let call = msg(
            "assistant",
            r#","content":[{"type":"toolCall","id":"b1","name":"bash","arguments":{"command":"cargo test --lib"}}],"stopReason":"toolUse""#,
        );
        let fail = r#"{"type":"message","timestamp":"T1","message":{"role":"toolResult","toolCallId":"b1","toolName":"bash","content":[{"type":"text","text":"test result: FAILED\nCommand exited with code 101"}],"isError":true}}"#.to_string();
        let t = parse_tail(format!("{call}\n{fail}").as_bytes());
        let r = t.result.unwrap();
        assert_eq!(r.kind, "test");
        assert!(!r.ok);
        assert_eq!(r.at, "T1");
        assert!(r.summary.contains("exit 101"));

        let call2 = msg(
            "assistant",
            r#","content":[{"type":"toolCall","id":"b2","name":"bash","arguments":{"command":"pnpm tsc --noEmit"}}]"#,
        );
        let pass = r#"{"type":"message","timestamp":"T2","message":{"role":"toolResult","toolCallId":"b2","content":[{"type":"text","text":"(no output)"}],"isError":false}}"#;
        let t = parse_tail(format!("{call}\n{fail}\n{call2}\n{pass}").as_bytes());
        let r = t.result.unwrap();
        assert_eq!(
            (r.kind.as_str(), r.ok, r.at.as_str()),
            ("build", true, "T2")
        );
        assert!(!is_result_command("ls -la"));
    }

    #[test]
    fn title_change_and_partial_lines() {
        let body = format!(
            "garbage-partial\n{}\n{}",
            r#"{"type":"title_change","title":"New name","source":"user"}"#,
            r#"{"type":"model_change","model":"p/m2"}"#
        );
        let t = parse_tail(body.as_bytes());
        assert_eq!(t.title_change.as_deref(), Some("New name"));
        assert_eq!(t.model.as_deref(), Some("p/m2"));
    }

    #[test]
    fn read_tail_widens_window_for_huge_lines() {
        let dir = std::env::temp_dir().join(format!("ompws-parse-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let big = "x".repeat(100 * 1024);
        let body = format!(
            "{HEAD}{}\n",
            msg(
                "assistant",
                &format!(r#","content":[{{"type":"text","text":"{big}"}}],"stopReason":"stop""#)
            )
        );
        std::fs::write(&path, &body).unwrap();
        let t = read_tail(&path, body.len() as u64).unwrap();
        assert_eq!(t.state(), TailState::Clean);
        assert!(t.last_assistant.unwrap().chars().count() <= 200);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn snippet_truncates_by_chars() {
        assert_eq!(snippet("一二三四五", 3), "一二…");
        assert_eq!(snippet(" a \n b ", 10), "a b");
    }

    #[test]
    fn user_role_tool_result_is_not_user_content() {
        // A "user" role message carrying toolCallId/toolName is a tool result,
        // not user text — it must not feed the title fallback.
        let fake_user = r#"{"type":"message","id":"x","timestamp":"T","message":{"role":"user","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"tool output"}]}}"#;
        let t = parse_tail(fake_user.as_bytes());
        assert_eq!(t.last_msg.as_ref().unwrap().role, LastRole::ToolResult);

        let real_user = r#"{"type":"message","id":"y","timestamp":"T","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}"#;
        let t = parse_tail(real_user.as_bytes());
        assert_eq!(t.last_msg.as_ref().unwrap().role, LastRole::User);
    }

    #[test]
    fn first_user_skips_tool_results_and_strips_reminders() {
        let dir = std::env::temp_dir().join(format!("ompws-fu-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let body = concat!(
            r#"{"type":"session","version":3,"id":"s","timestamp":"T0","cwd":"/w"}"#,
            "\n",
            // tool result masquerading as user role — must be skipped
            r#"{"type":"message","id":"m1","timestamp":"T1","message":{"role":"user","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"tool output"}]}}"#,
            "\n",
            // system-reminder-only user message — must be skipped
            r#"{"type":"message","id":"m2","timestamp":"T2","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>note</system-reminder>"}]}}"#,
            "\n",
            // real user text after reminders
            r#"{"type":"message","id":"m3","timestamp":"T3","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>note</system-reminder>\nactual prompt"}]}}"#,
            "\n",
        );
        std::fs::write(&path, body).unwrap();
        assert_eq!(read_first_user(&path).as_deref(), Some("actual prompt"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn content_text_skips_tool_result_blocks() {
        let v = serde_json::json!([
            {"type": "text", "text": "hello"},
            {"type": "tool_result", "tool_use_id": "x", "content": "output"},
            {"type": "text", "text": "world"}
        ]);
        assert_eq!(content_text(Some(&v)), "hello\nworld");
    }

    #[test]
    fn strip_system_reminders_works() {
        assert_eq!(
            strip_system_reminders("<system-reminder>a</system-reminder>hello"),
            "hello"
        );
        assert_eq!(
            strip_system_reminders("<system-notice>n</system-notice>world"),
            "world"
        );
        assert_eq!(
            strip_system_reminders(
                "<system-reminder>a</system-reminder><system-notice>b</system-notice>text"
            ),
            "text"
        );
        assert_eq!(strip_system_reminders("plain"), "plain");
        assert_eq!(
            strip_system_reminders("<system-reminder>only</system-reminder>"),
            ""
        );
    }
}
