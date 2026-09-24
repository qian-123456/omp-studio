//! Last assistant text from a session jsonl tail (for `GET /api/sessions/:id/last`).

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const TAIL_BYTES: u64 = 512 * 1024;
const MAX_CHARS: usize = 4000;

/// Text of the latest assistant message with non-empty text content, read from
/// the last 512 KB of the file. Truncated to 4000 chars.
pub fn last_assistant_text(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    // A partial first line (when start > 0) simply fails to parse and is skipped.
    text.lines().rev().find_map(|line| {
        if !line.contains("\"assistant\"") {
            return None;
        }
        let v: serde_json::Value = serde_json::from_str(line).ok()?;
        if v.get("type")?.as_str()? != "message" {
            return None;
        }
        let msg = v.get("message")?;
        if msg.get("role")?.as_str()? != "assistant" {
            return None;
        }
        let joined = match msg.get("content")? {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Array(parts) => parts
                .iter()
                .filter(|p| p.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n"),
            _ => return None,
        };
        let trimmed = joined.trim();
        (!trimmed.is_empty()).then(|| truncate(trimmed))
    })
}

fn truncate(s: &str) -> String {
    match s.char_indices().nth(MAX_CHARS) {
        Some((idx, _)) => format!("{}…", &s[..idx]),
        None => s.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_latest_assistant_text_skipping_tool_only() {
        let dir = std::env::temp_dir().join(format!("ompws-last-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s.jsonl");
        let lines = [
            r#"{"type":"session","id":"x"}"#,
            r#"{"type":"message","message":{"role":"user","content":"hi"}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"first answer"}]}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"second "},{"type":"text","text":"part"}]}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"t","name":"bash","arguments":{}}]}}"#,
            r#"{"type":"custom","customType":"assistant"}"#,
        ];
        std::fs::write(&file, lines.join("\n")).unwrap();
        assert_eq!(last_assistant_text(&file).as_deref(), Some("second \npart"));
        assert!(last_assistant_text(&dir.join("missing.jsonl")).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn truncates_long_text() {
        let long = "字".repeat(MAX_CHARS + 10);
        let t = truncate(&long);
        assert_eq!(t.chars().count(), MAX_CHARS + 1);
    }
}
