//! Fast, partial parsing of OMP session files for listing.
//!
//! Listing only reads the head (title slot + header) and the last ~64 KB tail;
//! everything here is pure and unit-tested with fixtures.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
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
    let bytes = read_head_bytes(path)?;
    Ok(parse_head(&bytes))
}

/// First [`HEAD_BYTES`] of a file (the window [`parse_head`] looks at). Also
/// used to prove that a cached head still describes the file: a rewrite that
/// keeps the size (e.g. a new title slot) changes these bytes.
pub fn read_head_bytes(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut f = File::open(path)?;
    let mut buf = vec![0u8; HEAD_BYTES];
    let n = read_up_to(&mut f, &mut buf)?;
    buf.truncate(n);
    Ok(buf)
}

/// Stable 64-bit fingerprint of the head window (FNV-1a).
pub fn head_fingerprint(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Read each byte/complete JSONL line at most once while widening the tail.
pub fn read_tail(path: &Path, size: u64) -> std::io::Result<TailInfo> {
    read_tail_from(&mut File::open(path)?, size)
}

fn read_tail_from(reader: &mut (impl Read + Seek), size: u64) -> std::io::Result<TailInfo> {
    let mut window = TAIL_BYTES;
    let mut previous_start = size;
    let mut partial = Vec::new();
    let mut groups = Vec::new();
    let mut has_message = false;
    let mut has_model = false;
    loop {
        let start = size.saturating_sub(window);
        reader.seek(SeekFrom::Start(start))?;
        let mut buf = Vec::with_capacity((previous_start - start) as usize + partial.len());
        (&mut *reader)
            .take(previous_start - start)
            .read_to_end(&mut buf)?;
        // Only the incomplete first line of the previous window is carried
        // across the boundary. Complete newer lines have already been parsed.
        buf.append(&mut partial);
        let body_start = if start == 0 {
            0
        } else {
            buf.iter()
                .position(|b| *b == b'\n')
                .map_or(buf.len(), |i| i + 1)
        };
        let entries: Vec<_> = buf[body_start..]
            .split(|b| *b == b'\n')
            .filter_map(listing_entry)
            .collect();
        for entry in &entries {
            match entry.get("type").and_then(Value::as_str) {
                Some("message") => {
                    if let Some(message) = entry.get("message") {
                        let role = message.get("role").and_then(Value::as_str);
                        has_message |= matches!(role, Some("assistant" | "user" | "toolResult"));
                        has_model |= role == Some("assistant")
                            && message
                                .get("model")
                                .and_then(Value::as_str)
                                .is_some_and(|m| !m.trim().is_empty());
                    }
                }
                Some("model_change") => {
                    has_model |= entry
                        .get("model")
                        .and_then(Value::as_str)
                        .is_some_and(|m| !m.trim().is_empty());
                }
                _ => {}
            }
        }
        groups.push(entries);
        let next = TAIL_FALLBACKS.iter().copied().find(|w| *w > window);
        match next {
            // Preserve recovery of giant message lines and earlier model
            // entries without re-reading/re-parsing the newer window.
            Some(w) if (!has_message || !has_model) && start > 0 => {
                partial.extend_from_slice(&buf[..body_start]);
                previous_start = start;
                window = w;
            }
            _ => {
                // Process older groups first: bash calls can pair with results
                // in a newer window, and newest title/model/exit ordering wins.
                return Ok(parse_entries(groups.into_iter().rev().flatten()));
            }
        }
    }
}

/// Discard a JSON value without retaining it, but use normal deserialization
/// for every string (including nested object keys). `IgnoredAny` uses
/// serde_json's faster ignore_str path, which accepts invalid UTF-16 escapes
/// that the transcript's Value parser rejects.
struct ValidatedDiscard;

impl<'de> serde::Deserialize<'de> for ValidatedDiscard {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        struct Discard;

        impl<'de> Visitor<'de> for Discard {
            type Value = ValidatedDiscard;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a valid JSON value")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                while map.next_key::<ValidatedDiscard>()?.is_some() {
                    map.next_value::<ValidatedDiscard>()?;
                }
                Ok(ValidatedDiscard)
            }

            fn visit_seq<S: SeqAccess<'de>>(self, mut seq: S) -> Result<Self::Value, S::Error> {
                while seq.next_element::<ValidatedDiscard>()?.is_some() {}
                Ok(ValidatedDiscard)
            }

            fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(ValidatedDiscard)
            }

            fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(ValidatedDiscard)
            }

            fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(ValidatedDiscard)
            }

            fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(ValidatedDiscard)
            }

            fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(ValidatedDiscard)
            }

            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(ValidatedDiscard)
            }
        }

        de.deserialize_any(Discard)
    }
}

/// Deserialize only the fields consumed by listing. In particular, image
/// payloads, thinking blocks, usage and arbitrary tool arguments are validated
/// and skipped rather than allocated as a full serde_json::Value tree.
#[derive(Clone, Copy)]
enum ListingShape {
    Entry,
    Message,
    Content,
    Block,
    Arguments,
    Exit,
    Pending,
}

impl<'de> DeserializeSeed<'de> for ListingShape {
    type Value = Value;

    fn deserialize<D: serde::Deserializer<'de>>(self, de: D) -> Result<Value, D::Error> {
        struct Projection(ListingShape);
        impl<'de> Visitor<'de> for Projection {
            type Value = Value;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a listing record")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Value, M::Error> {
                let mut fields = serde_json::Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    let child = match (self.0, key.as_str()) {
                        (ListingShape::Entry, "message") => Some(ListingShape::Message),
                        (ListingShape::Entry, "data") => Some(ListingShape::Exit),
                        (ListingShape::Message, "content") => Some(ListingShape::Content),
                        (ListingShape::Block, "arguments") => Some(ListingShape::Arguments),
                        (ListingShape::Exit, "pendingToolCalls") => Some(ListingShape::Pending),
                        _ => None,
                    };
                    let scalar = matches!(
                        (self.0, key.as_str()),
                        (
                            ListingShape::Entry,
                            "type" | "timestamp" | "title" | "model" | "customType"
                        ) | (
                            ListingShape::Message,
                            "role"
                                | "toolCallId"
                                | "toolName"
                                | "model"
                                | "provider"
                                | "stopReason"
                                | "isError"
                        ) | (ListingShape::Block, "type" | "id" | "name" | "text")
                            | (ListingShape::Arguments, "command")
                            | (ListingShape::Exit, "kind")
                    );
                    if let Some(shape) = child {
                        fields.insert(key, map.next_value_seed(shape)?);
                    } else if scalar {
                        fields.insert(key, map.next_value()?);
                    } else {
                        map.next_value::<ValidatedDiscard>()?;
                    }
                }
                Ok(Value::Object(fields))
            }

            fn visit_seq<S: SeqAccess<'de>>(self, mut seq: S) -> Result<Value, S::Error> {
                let mut values = Vec::new();
                if matches!(self.0, ListingShape::Content) {
                    while let Some(block) = seq.next_element_seed(ListingShape::Block)? {
                        values.push(block);
                    }
                } else {
                    while seq.next_element::<ValidatedDiscard>()?.is_some() {
                        if matches!(self.0, ListingShape::Pending) && values.is_empty() {
                            // Listing only needs to know whether the array is empty.
                            values.push(Value::Null);
                        }
                    }
                }
                Ok(Value::Array(values))
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Value, E> {
                Ok(if matches!(self.0, ListingShape::Content) {
                    Value::String(value.to_owned())
                } else {
                    Value::Null
                })
            }

            fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Value, E> {
                Ok(Value::Null)
            }

            fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Value, E> {
                Ok(Value::Null)
            }

            fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Value, E> {
                Ok(Value::Null)
            }

            fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Value, E> {
                Ok(Value::Null)
            }

            fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
                Ok(Value::Null)
            }
        }
        de.deserialize_any(Projection(self))
    }
}

fn listing_entry(line: &[u8]) -> Option<Value> {
    let mut de = serde_json::Deserializer::from_slice(line);
    let entry = ListingShape::Entry.deserialize(&mut de).ok()?;
    de.end().ok()?;
    Some(entry)
}

fn parse_entries(entries: impl IntoIterator<Item = Value>) -> TailInfo {
    let mut info = TailInfo::default();
    // Bash tool calls (id -> command) matching the test/build pattern.
    let mut bash_calls: Vec<(String, String)> = Vec::new();
    for v in entries {
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
                        let mut text = "";
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
                                    text = block
                                        .get("text")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default()
                                        .trim();
                                }
                                _ => {}
                            }
                        }
                        if !text.is_empty() {
                            info.last_assistant = Some(snippet(text, 200));
                        }
                        if let Some(m) = non_empty(msg.get("model")) {
                            // Assistant entries carry the provider separately; keep the
                            // `provider/model` form `model_change` uses so the UI can
                            // resolve it against the catalog.
                            info.model = Some(match non_empty(msg.get("provider")) {
                                Some(p) if !m.contains('/') => format!("{p}/{m}"),
                                _ => m,
                            });
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
                let data = v.get("data").unwrap_or(&Value::Null);
                let pending = data
                    .get("pendingToolCalls")
                    .and_then(Value::as_array)
                    .is_some_and(|a| !a.is_empty());
                info.exit = Some(ExitInfo {
                    kind: str_of(data, "kind"),
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
    read_first_user_text(path).map(|t| snippet(&t, 40))
}

/// Full cleaned text of the first user message in the head of the file.
pub fn read_first_user_text(path: &Path) -> Option<String> {
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
        let clean = strip_image_markers(strip_system_reminders(&raw));
        if !clean.is_empty() {
            return Some(clean);
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
    let mut out = String::new();
    let mut count = 0;
    let mut space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            space = !out.is_empty();
            continue;
        }
        if space {
            out.push(' ');
            count += 1;
            space = false;
        }
        out.push(ch);
        count += 1;
        if count > max {
            // Only the bounded normalized prefix is retained, even when an
            // assistant text block contains megabytes of output.
            let end = out
                .char_indices()
                .nth(max.saturating_sub(1))
                .map_or(out.len(), |(i, _)| i);
            out.truncate(end);
            out.push('…');
            return out;
        }
    }
    out
}

fn image_marker_re() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"\[Image #\d+(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|\[图片(?:\s*#\d+)?(?::\s*[^\]]+)?\]",
        )
        .unwrap()
    })
}

fn marker_detail_re() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"\[Image #(?P<num1>\d+)(?:,\s*(?P<w>\d+)x(?P<h>\d+))?(?::\s*(?P<path1>[^\]]+))?\]|\[图片(?:\s*#(?P<num2>\d+))?(?::\s*(?P<path2>[^\]]+))?\]",
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

    let native_count = images.len();
    let check_text =
        |text: &str, images: &mut Vec<crate::contracts::ImageAttachment>, idx: &mut usize| {
            for caps in marker_detail_re().captures_iter(text) {
                let whole = caps.get(0).map(|m| m.as_str()).unwrap_or_default();
                let w = caps.name("w").and_then(|m| m.as_str().parse::<u32>().ok());
                let h = caps.name("h").and_then(|m| m.as_str().parse::<u32>().ok());
                let raw_path = caps
                    .name("path1")
                    .or_else(|| caps.name("path2"))
                    .map(|m| m.as_str().trim().to_string());
                let resolved_path = raw_path.filter(|p| Path::new(p).exists());

                // Numbered markers refer to native image slots, even when the
                // marker's clipboard path differs from the persisted blob path.
                // Width is metadata, never an indication that a slot is unused.
                let number = caps
                    .name("num1")
                    .or_else(|| caps.name("num2"))
                    .and_then(|m| m.as_str().parse::<usize>().ok());
                let existing_index = number
                    .and_then(|n| n.checked_sub(1))
                    .filter(|&n| n < native_count)
                    .or_else(|| {
                        resolved_path.as_ref().and_then(|path| {
                            images
                                .iter()
                                .position(|img| img.path.as_ref() == Some(path))
                        })
                    });
                if let Some(existing) = existing_index.map(|n| &mut images[n]) {
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
                } else if resolved_path.is_some() {
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

    fn parse_tail(bytes: &[u8]) -> TailInfo {
        read_tail_from(&mut std::io::Cursor::new(bytes), bytes.len() as u64).unwrap()
    }

    struct CountingReader {
        inner: std::io::Cursor<Vec<u8>>,
        reads: Vec<(u64, usize)>,
    }

    impl CountingReader {
        fn new(bytes: Vec<u8>) -> Self {
            Self {
                inner: std::io::Cursor::new(bytes),
                reads: Vec::new(),
            }
        }

        fn bytes_read(&self) -> usize {
            self.reads.iter().map(|(_, size)| size).sum()
        }

        fn assert_no_rereads(&self) {
            let mut ranges = self.reads.clone();
            ranges.sort_unstable_by_key(|(start, _)| *start);
            for pair in ranges.windows(2) {
                assert!(
                    pair[0].0 + pair[0].1 as u64 <= pair[1].0,
                    "overlapping reads: {pair:?}"
                );
            }
        }
    }

    impl Read for CountingReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let start = self.inner.position();
            let size = self.inner.read(buf)?;
            if size > 0 {
                self.reads.push((start, size));
            }
            Ok(size)
        }
    }

    impl Seek for CountingReader {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(pos)
        }
    }

    #[test]
    fn tail_reader_bounds_io_independently_of_irrelevant_middle() {
        let suffix = msg(
            "assistant",
            r#","model":"p/m","content":[{"type":"text","text":"done"}],"stopReason":"stop""#,
        );
        for middle_bytes in [2 * 1024 * 1024, 12 * 1024 * 1024] {
            let body = format!(
                "{HEAD}{{\"type\":\"custom\",\"data\":\"{}\"}}\n{suffix}\n",
                "x".repeat(middle_bytes)
            );
            let size = body.len() as u64;
            let mut reader = CountingReader::new(body.into_bytes());
            let tail = read_tail_from(&mut reader, size).unwrap();
            assert_eq!(tail, parse_tail(suffix.as_bytes()));
            assert_eq!(reader.bytes_read(), TAIL_BYTES as usize);
            reader.assert_no_rereads();
        }
    }

    #[test]
    fn tail_reader_caps_missing_model_at_existing_fallback_limit() {
        let suffix = msg("user", r#","content":"pending""#);
        let body = format!(
            "{HEAD}{{\"type\":\"custom\",\"data\":\"{}\"}}\n{suffix}\n",
            "x".repeat(8 * 1024 * 1024)
        );
        let size = body.len() as u64;
        let mut reader = CountingReader::new(body.into_bytes());
        let tail = read_tail_from(&mut reader, size).unwrap();
        assert_eq!(tail.last_msg.as_ref().unwrap().role, LastRole::User);
        assert!(tail.model.is_none());
        assert_eq!(
            reader.bytes_read(),
            *TAIL_FALLBACKS.last().unwrap() as usize
        );
        reader.assert_no_rereads();
    }

    #[test]
    fn tail_reader_recovers_multimegabyte_assistant_without_retaining_thinking() {
        let assistant = msg(
            "assistant",
            &format!(
                r#","model":"p/huge","content":[{{"type":"thinking","thinking":"{}"}},{{"type":"text","text":"recovered"}}],"stopReason":"stop""#,
                r"\uD83D\uDE00".repeat(180 * 1024)
            ),
        );
        let body = format!("{HEAD}{assistant}\n");
        let size = body.len() as u64;
        let mut reader = CountingReader::new(body.into_bytes());
        let tail = read_tail_from(&mut reader, size).unwrap();
        assert_eq!(tail.last_assistant.as_deref(), Some("recovered"));
        assert_eq!(tail.model.as_deref(), Some("p/huge"));
        assert_eq!(tail.state(), TailState::Clean);
        assert_eq!(reader.bytes_read(), size as usize);
        reader.assert_no_rereads();
    }

    #[test]
    fn widened_tail_parses_once_and_preserves_cross_window_ordering() {
        let call = msg(
            "assistant",
            r#","model":"p/earlier","content":[{"type":"toolCall","id":"b","name":"bash","arguments":{"command":"cargo test","ignored":{"image":"unused"}}}],"stopReason":"toolUse""#,
        );
        // The bash call and only model are outside both smaller windows. The
        // result line itself crosses the initial window boundary.
        let body = format!(
            "{HEAD}{call}\n{{\"type\":\"title_change\",\"title\":\"older\"}}\n{{\"type\":\"custom\",\"data\":\"{}\"}}\n{{\"type\":\"message\",\"timestamp\":\"T2\",\"message\":{{\"role\":\"toolResult\",\"toolCallId\":\"b\",\"content\":[{{\"type\":\"text\",\"text\":\"{}\\nCommand exited with code 101\"}}],\"isError\":true}}}}\n{{\"type\":\"custom\",\"customType\":\"session_exit\",\"data\":{{\"kind\":\"signal\",\"pendingToolCalls\":[{{\"large\":\"ignored\"}}]}}}}\n{{\"type\":\"title_change\",\"title\":\"newest\"}}\n",
            "x".repeat(800 * 1024),
            "y".repeat(100 * 1024)
        );
        let expected = parse_entries(
            body.as_bytes()
                .split(|b| *b == b'\n')
                .filter_map(|line| serde_json::from_slice::<Value>(line).ok()),
        );
        let size = body.len() as u64;
        let mut reader = CountingReader::new(body.into_bytes());
        let actual = read_tail_from(&mut reader, size).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(actual.model.as_deref(), Some("p/earlier"));
        assert_eq!(actual.title_change.as_deref(), Some("newest"));
        assert_eq!(
            actual
                .result
                .as_ref()
                .map(|result| (result.ok, result.at.as_str())),
            Some((false, "T2"))
        );
        assert!(actual.exit.as_ref().unwrap().after_last_msg);
        assert_eq!(reader.bytes_read(), size as usize);
        reader.assert_no_rereads();
    }

    #[test]
    fn tail_projection_skips_payload_and_matches_full_value_semantics() {
        let body = concat!(
            "{\"type\":\"custom\",\"customType\":\"session_exit\",\"data\":{\"kind\":\"signal\",\"pendingToolCalls\":[{\"id\":\"x\"}]} }\n",
            "{\"type\":\"message\",\"timestamp\":\"T\",\"usage\":{\"tokens\":123},\"message\":{\"role\":\"assistant\",\"provider\":\"p\",\"model\":\"m\",\"content\":[{\"type\":\"thinking\",\"thinking\":\"not retained\"},{\"type\":\"image\",\"source\":{\"data\":\"not retained\"}},{\"type\":\"text\",\"text\":\"answer\"}],\"stopReason\":\"stop\"}}\n",
            "{\"type\":\"model_change\",\"model\":\"p/new\"}\n",
            "{\"type\":\"title_change\",\"title\":\"new\"}\n",
            // Wrong optional field types remain as permissive as Value parsing.
            "{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":null,\"model\":12,\"stopReason\":false}}\n",
            "{\"type\":\"custom\",\"customType\":\"session_exit\",\"data\":null}\n"
        );
        let expected = parse_entries(
            body.as_bytes()
                .split(|b| *b == b'\n')
                .filter_map(|line| serde_json::from_slice::<Value>(line).ok()),
        );
        assert_eq!(parse_tail(body.as_bytes()), expected);
        assert!(!expected.exit.as_ref().unwrap().pending_tool_calls);
        let entry = listing_entry(body.lines().nth(1).unwrap().as_bytes()).unwrap();
        assert!(entry.get("usage").is_none());
        assert!(entry.pointer("/message/content/0/thinking").is_none());
        assert!(entry.pointer("/message/content/1/source").is_none());
        assert!(listing_entry(b"{} trailing").is_none());
    }

    fn discarded_payload_templates() -> Vec<String> {
        let assistant = serde_json::json!({
            "type": "message",
            "id": "a",
            "timestamp": "T2",
            "message": {
                "role": "assistant",
                "model": "p/m",
                "content": [{"type": "text", "text": "done"}],
                "stopReason": "stop"
            }
        });
        let mut templates = Vec::new();
        let mut entry = assistant.clone();
        entry["unused"] = serde_json::json!({"nested": ["PAYLOAD"]});
        templates.push(entry.to_string());
        let mut entry = assistant.clone();
        entry["message"]["unused"] = serde_json::json!([{"nested": "PAYLOAD"}]);
        templates.push(entry.to_string());
        let mut entry = assistant.clone();
        entry["message"]["content"][0]["unused"] = serde_json::json!({"nested": "PAYLOAD"});
        templates.push(entry.to_string());
        let mut entry = assistant.clone();
        entry["message"]["content"][0] =
            serde_json::json!({"type": "thinking", "thinking": "PAYLOAD"});
        templates.push(entry.to_string());
        let mut entry = assistant.clone();
        entry["message"]["content"][0] =
            serde_json::json!({"type": "image", "source": {"data": "PAYLOAD"}});
        templates.push(entry.to_string());
        let mut entry = assistant.clone();
        entry["message"]["content"][0] = serde_json::json!({
            "type": "toolCall", "id": "call", "name": "read",
            "arguments": {"unused": [{"nested": "PAYLOAD"}]}
        });
        templates.push(entry.to_string());
        let mut entry = assistant;
        // Nested arrays are not listing content, but must still be validated.
        entry["message"]["content"] = serde_json::json!([["PAYLOAD"]]);
        templates.push(entry.to_string());
        templates.push(
            serde_json::json!({
                "type": "custom", "customType": "session_exit",
                "data": {"kind": "normal", "pendingToolCalls": [{"unused": ["PAYLOAD"]}]}
            })
            .to_string(),
        );
        templates.push(
            serde_json::json!({
                "type": "custom", "customType": "session_exit",
                "data": {"kind": "normal", "unused": [{"nested": "PAYLOAD"}]}
            })
            .to_string(),
        );
        // Also exercise keys inside discarded maps, not only their values.
        templates.push(r#"{"type":"message","message":{"role":"assistant","unused":{"PAYLOAD":null},"stopReason":"stop"}}"#.to_string());
        templates
    }

    #[test]
    fn discarded_values_keep_full_json_unicode_validation() {
        let values = [
            (r#""\uD800""#, false),
            (r#""\uDC00""#, false),
            (r#""\uD800x""#, false),
            (r#""\uD800\u0041""#, false),
            (r#""\uDFFF\uD800""#, false),
            (r#""\uD800\uDBFF""#, false),
            (r#""\uD83D\uDE00""#, true),
            (r#""\uDBFF\uDFFF""#, true),
            (r#""\u0000\uD7FF\uE000\t\\\"""#, true),
            (r#""中文😀""#, true),
        ];
        for template in discarded_payload_templates() {
            for (value, valid) in values {
                let line = template.replace("\"PAYLOAD\"", value);
                let full = serde_json::from_slice::<Value>(line.as_bytes());
                assert_eq!(full.is_ok(), valid, "{line}");
                assert_eq!(listing_entry(line.as_bytes()).is_some(), valid, "{line}");
                let expected = parse_entries(full);
                assert_eq!(parse_tail(line.as_bytes()), expected, "{line}");
            }
            let mut bytes = template.into_bytes();
            let offset = bytes
                .windows(b"PAYLOAD".len())
                .position(|s| s == b"PAYLOAD")
                .unwrap();
            bytes[offset] = 0xff;
            assert!(serde_json::from_slice::<Value>(&bytes).is_err());
            assert!(listing_entry(&bytes).is_none());
        }
    }

    #[test]
    fn catalog_scan_and_real_transcript_reject_invalid_discarded_assistant_payloads() {
        let dir = std::env::temp_dir().join(format!("ompws-validity-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("bucket")).unwrap();
        let path = dir.join("bucket/s.jsonl");
        let user = r#"{"type":"message","id":"u","timestamp":"T1","message":{"role":"user","content":"pending"}}"#;
        for template in discarded_payload_templates() {
            let invalid = template.replace("\"PAYLOAD\"", r#""\uD800""#);
            let body = format!("{HEAD}{user}\n{invalid}\n");
            std::fs::write(&path, body).unwrap();
            let (map, changed) = super::super::scan::scan_files(
                super::super::scan::list_files(&dir),
                &super::super::scan::FileMap::new(),
            );
            assert_eq!(changed, vec![path.clone()]);
            let tail = &map[&path].tail;
            assert_eq!(tail.last_msg.as_ref().unwrap().role, LastRole::User);
            assert_eq!(tail.state(), TailState::Interrupted);
            assert!(tail.model.is_none());
            assert!(tail.last_assistant.is_none());
            assert!(tail.exit.is_none());
            let page = super::super::transcript::read_page(&path, "sess-1", 0, None).unwrap();
            assert_eq!(page.items.len(), 1);
            assert_eq!(page.items[0].id, "u");
            assert_eq!(page.items[0].kind, crate::contracts::TranscriptKind::User);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn snippet_matches_normalization_and_truncation_at_boundaries() {
        for text in [
            "",
            " \n ",
            "a",
            "a b",
            " ab\t cd \n ef ",
            "一 二三\u{2003}四",
        ] {
            for max in 0..12 {
                let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
                let expected = if flat.chars().count() <= max {
                    flat
                } else {
                    format!(
                        "{}…",
                        flat.chars().take(max.saturating_sub(1)).collect::<String>()
                    )
                };
                assert_eq!(snippet(text, max), expected, "text={text:?}, max={max}");
            }
        }
    }

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
    fn independent_marker_only_images_do_not_claim_native_slots() {
        let dir = std::env::temp_dir().join(format!("ompws-images-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let one = dir.join("one.png");
        let two = dir.join("two.png");
        std::fs::write(&one, []).unwrap();
        std::fs::write(&two, []).unwrap();
        let content = serde_json::json!(format!(
            "[Image #2: {}] [Image #1: {}]",
            two.display(),
            one.display()
        ));
        let images = parse_images(Some(&content));
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].path.as_deref(), two.to_str());
        assert_eq!(images[1].path.as_deref(), one.to_str());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn image_markers_bind_native_slots_not_first_missing_width() {
        let content = serde_json::json!([
            {"type": "image", "path": "/blob/one.webp"},
            {"type": "image", "path": "/blob/two.webp"},
            {"type": "text", "text": "[Image #2, 200x100: /clip/two.png] [Image #1, 80x40: /clip/one.png]"}
        ]);
        let images = parse_images(Some(&content));
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].path.as_deref(), Some("/blob/one.webp"));
        assert_eq!(images[0].width, Some(80));
        assert_eq!(
            images[0].marker.as_deref(),
            Some("[Image #1, 80x40: /clip/one.png]")
        );
        assert_eq!(images[1].path.as_deref(), Some("/blob/two.webp"));
        assert_eq!(images[1].width, Some(200));
        assert_eq!(
            images[1].marker.as_deref(),
            Some("[Image #2, 200x100: /clip/two.png]")
        );
    }

    #[test]
    fn image_marker_without_dimensions_keeps_each_slot_identity() {
        let content = serde_json::json!([
            {"type": "image", "path": "/blob/one.webp"},
            {"type": "image", "path": "/blob/two.webp"},
            {"type": "text", "text": "[Image #1: /missing/one.png] [Image #2: /missing/two.png]"}
        ]);
        let images = parse_images(Some(&content));
        assert_eq!(images.len(), 2);
        assert_eq!(
            images[0].marker.as_deref(),
            Some("[Image #1: /missing/one.png]")
        );
        assert_eq!(
            images[1].marker.as_deref(),
            Some("[Image #2: /missing/two.png]")
        );
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
    fn assistant_model_keeps_provider_and_window_widens_for_it() {
        let a = r#"{"type":"message","id":"a","timestamp":"T","message":{"role":"assistant","content":[{"type":"text","text":"hi"}],"provider":"prov","model":"m1","stopReason":"stop"}}"#;
        assert_eq!(parse_tail(a.as_bytes()).model.as_deref(), Some("prov/m1"));

        // The only model entry sits before the 64 KB tail window.
        let dir = std::env::temp_dir().join(format!("ompws-parse-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let big = "x".repeat(40 * 1024);
        let tool = |id: &str| {
            format!(
                r#"{{"type":"message","id":"{id}","timestamp":"T","message":{{"role":"toolResult","toolCallId":"c","toolName":"bash","content":[{{"type":"text","text":"{big}"}}]}}}}"#
            ) + "\n"
        };
        let body = format!("{a}\n{}{}{}", tool("r1"), tool("r2"), tool("r3"));
        std::fs::write(&path, &body).unwrap();
        let t = read_tail(&path, body.len() as u64).unwrap();
        assert_eq!(t.model.as_deref(), Some("prov/m1"));
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
    fn first_user_strips_image_markers_and_skips_marker_only() {
        let dir = std::env::temp_dir().join(format!("ompws-fu-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let with_text = dir.join("a.jsonl");
        std::fs::write(
            &with_text,
            r#"{"type":"message","id":"m1","timestamp":"T1","message":{"role":"user","content":[{"type":"text","text":"[Image #1, 640x235: /tmp/a.png] 看看这个"}]}}"#,
        )
        .unwrap();
        assert_eq!(read_first_user(&with_text).as_deref(), Some("看看这个"));

        let markers_then_text = dir.join("b.jsonl");
        let body = concat!(
            r#"{"type":"message","id":"m1","timestamp":"T1","message":{"role":"user","content":[{"type":"text","text":"[Image #1, 640x235: /tmp/a.png]"}]}}"#,
            "\n",
            r#"{"type":"message","id":"m2","timestamp":"T2","message":{"role":"user","content":[{"type":"text","text":"next prompt"}]}}"#,
            "\n",
        );
        std::fs::write(&markers_then_text, body).unwrap();
        assert_eq!(
            read_first_user(&markers_then_text).as_deref(),
            Some("next prompt")
        );

        let only_markers = dir.join("c.jsonl");
        std::fs::write(
            &only_markers,
            r#"{"type":"message","id":"m1","timestamp":"T1","message":{"role":"user","content":[{"type":"text","text":"[Image #1, 640x235: /tmp/a.png]"}]}}"#,
        )
        .unwrap();
        assert_eq!(read_first_user(&only_markers), None);
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
