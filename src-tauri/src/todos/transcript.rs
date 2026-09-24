//! Lightweight read-only scanning of OMP session JSONL files (summaries, diagnose).
//! Only the bits D needs; full normalization lives in the catalog module (A).

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

/// Truncate to `max` chars, appending an ellipsis when cut.
pub fn truncate_chars(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Read the whole file (lossy UTF-8).
pub fn read_all(path: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Read at most the last `max_bytes` of the file, dropping a leading partial line.
pub fn read_tail(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    let at_line_start = if start > 0 {
        f.seek(SeekFrom::Start(start - 1))?;
        let mut previous = [0u8];
        f.read_exact(&mut previous)?;
        previous[0] == b'\n'
    } else {
        true
    };
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    f.read_to_end(&mut buf)?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    if at_line_start {
        return Ok(text);
    }
    Ok(match text.find('\n') {
        Some(i) => text[i + 1..].to_string(),
        None => String::new(),
    })
}

fn entries(content: &str) -> impl Iterator<Item = Value> + '_ {
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
}

/// Concatenated `text` parts of a message `content` (string or block array).
pub fn message_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn role(entry: &Value) -> Option<&str> {
    if entry.get("type").and_then(Value::as_str) != Some("message") {
        return None;
    }
    entry.pointer("/message/role").and_then(Value::as_str)
}

fn ts(entry: &Value) -> String {
    entry
        .get("timestamp")
        .and_then(Value::as_str)
        .map(|t| t.chars().take(19).collect::<String>().replace('T', " "))
        .unwrap_or_default()
}

/// Latest `compaction` summary and the byte offset just past its line.
pub fn latest_compaction(content: &str) -> Option<(u64, String)> {
    let mut offset = 0u64;
    let mut best = None;
    for line in content.split_inclusive('\n') {
        offset += line.len() as u64;
        if !line.contains("\"compaction\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("compaction") {
            continue;
        }
        if let Some(s) = v.get("summary").and_then(Value::as_str) {
            if !s.trim().is_empty() {
                best = Some((offset, s.trim().to_string()));
            }
        }
    }
    best
}

/// Last `n` user/assistant texts, oldest first, each truncated to `max_chars`.
pub fn recent_texts(content: &str, n: usize, max_chars: usize) -> Vec<String> {
    let mut out: Vec<String> = entries(content)
        .filter_map(|e| {
            let who = match role(&e)? {
                "user" => "用户",
                "assistant" => "助手",
                _ => return None,
            };
            let text = message_text(e.get("message")?);
            (!text.trim().is_empty())
                .then(|| format!("[{who}] {}", truncate_chars(&text, max_chars)))
        })
        .collect();
    let skip = out.len().saturating_sub(n);
    out.drain(..skip);
    out
}

/// Last `n` error records (tool errors, error stop reasons, abnormal exits), oldest first.
pub fn recent_errors(content: &str, n: usize) -> Vec<String> {
    let mut out: Vec<String> = entries(content)
        .filter_map(|e| {
            let when = ts(&e);
            if e.get("type").and_then(Value::as_str) == Some("custom")
                && e.get("customType").and_then(Value::as_str) == Some("session_exit")
            {
                let data = e.get("data")?;
                let kind = data.get("kind").and_then(Value::as_str).unwrap_or("?");
                let pending = data
                    .get("pendingToolCalls")
                    .is_some_and(|p| p.as_array().is_some_and(|a| !a.is_empty()));
                if kind == "normal" && !pending {
                    return None;
                }
                let reason = data.get("reason").and_then(Value::as_str).unwrap_or("");
                let extra = if pending {
                    "，有未完成的工具调用"
                } else {
                    ""
                };
                return Some(format!("- [{when}] 进程退出：{kind} {reason}{extra}"));
            }
            let msg = e.get("message")?;
            match role(&e)? {
                "toolResult" if msg.get("isError").and_then(Value::as_bool) == Some(true) => {
                    let tool = msg
                        .get("toolName")
                        .and_then(Value::as_str)
                        .unwrap_or("tool");
                    let text = truncate_chars(&message_text(msg), 400);
                    Some(format!("- [{when}] 工具 {tool} 报错：{text}"))
                }
                "assistant" if msg.get("stopReason").and_then(Value::as_str) == Some("error") => {
                    let err = msg
                        .get("errorMessage")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown error");
                    Some(format!(
                        "- [{when}] 模型请求出错：{}",
                        truncate_chars(err, 400)
                    ))
                }
                _ => None,
            }
        })
        .collect();
    let skip = out.len().saturating_sub(n);
    out.drain(..skip);
    out
}

/// Text of the last assistant message that has any text.
pub fn last_assistant_text(content: &str) -> Option<String> {
    let mut last = None;
    for e in entries(content) {
        if role(&e) == Some("assistant") {
            let t = e.get("message").map(message_text).unwrap_or_default();
            if !t.trim().is_empty() {
                last = Some(t.trim().to_string());
            }
        }
    }
    last
}

/// Session header (`type:"session"`) and title slot from the head of a file.
pub fn head_info(path: &Path) -> Option<(String, String, String)> {
    let head = {
        let mut f = std::fs::File::open(path).ok()?;
        let mut buf = vec![0u8; 16 * 1024];
        let n = f.read(&mut buf).ok()?;
        String::from_utf8_lossy(&buf[..n]).into_owned()
    };
    let mut id = None;
    let mut cwd = String::new();
    let mut title = String::new();
    for line in head.lines().take(4) {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match v.get("type").and_then(Value::as_str) {
            Some("title") => {
                if let Some(t) = v.get("title").and_then(Value::as_str) {
                    title = t.to_string();
                }
            }
            Some("session") => {
                id = v.get("id").and_then(Value::as_str).map(str::to_string);
                cwd = v
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if title.is_empty() {
                    title = v
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                }
            }
            _ => {}
        }
    }
    Some((id?, cwd, title))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r###"{"type":"title","v":1,"title":"#12 Fix login","source":"auto"}
{"type":"session","version":3,"id":"sess-1","timestamp":"2026-09-04T15:12:03.683Z","cwd":"/tmp/proj"}
{"type":"message","id":"a","timestamp":"2026-09-04T15:12:05.000Z","message":{"role":"user","content":[{"type":"text","text":"Please fix the login bug"}]}}
{"type":"message","id":"b","timestamp":"2026-09-04T15:12:06.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"toolCall","id":"c1","name":"bash","arguments":{}}],"stopReason":"toolUse"}}
{"type":"message","id":"c","timestamp":"2026-09-04T15:12:07.000Z","message":{"role":"toolResult","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"TypeError: boom"}],"isError":true}}
{"type":"compaction","id":"d","timestamp":"2026-09-04T15:13:00.000Z","summary":"## Goal\nFix login"}
{"type":"message","id":"e","timestamp":"2026-09-04T15:14:00.000Z","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"429 quota reached"}}
{"type":"custom","customType":"session_exit","data":{"reason":"dispose","kind":"normal"},"id":"f","timestamp":"2026-09-04T15:15:00.000Z"}
{"type":"custom","customType":"session_exit","data":{"reason":"sighup","kind":"signal"},"id":"g","timestamp":"2026-09-04T15:16:00.000Z"}
{"type":"message","id":"h","timestamp":"2026-09-04T15:17:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Fixed it. Tests pass."}],"stopReason":"stop"}}
"###;

    #[test]
    fn finds_latest_compaction_with_offset() {
        let (off, s) = latest_compaction(FIXTURE).unwrap();
        assert_eq!(s, "## Goal\nFix login");
        let upto = &FIXTURE[..off as usize];
        assert!(upto.ends_with("Fix login\"}\n"));
    }

    #[test]
    fn collects_recent_texts() {
        let t = recent_texts(FIXTURE, 40, 100);
        assert_eq!(
            t,
            vec![
                "[用户] Please fix the login bug",
                "[助手] Fixed it. Tests pass."
            ]
        );
        assert_eq!(recent_texts(FIXTURE, 1, 100).len(), 1);
    }

    #[test]
    fn collects_errors() {
        let e = recent_errors(FIXTURE, 10);
        assert_eq!(e.len(), 3, "{e:?}");
        assert!(e[0].contains("工具 bash 报错：TypeError: boom"));
        assert!(e[1].contains("429 quota reached"));
        assert!(e[2].contains("signal sighup"));
        assert_eq!(recent_errors(FIXTURE, 1).len(), 1);
    }

    #[test]
    fn last_assistant() {
        assert_eq!(
            last_assistant_text(FIXTURE).unwrap(),
            "Fixed it. Tests pass."
        );
    }

    #[test]
    fn truncates_by_chars() {
        assert_eq!(truncate_chars("你好世界", 3), "你好…");
        assert_eq!(truncate_chars("abc", 3), "abc");
    }

    #[test]
    fn reads_head_and_tail() {
        let dir = std::env::temp_dir().join(format!("ompws-d-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("x_sess-1.jsonl");
        std::fs::write(&p, FIXTURE).unwrap();
        let (id, cwd, title) = head_info(&p).unwrap();
        assert_eq!(
            (id.as_str(), cwd.as_str(), title.as_str()),
            ("sess-1", "/tmp/proj", "#12 Fix login")
        );
        let last_line = FIXTURE.lines().last().unwrap();
        let tail = read_tail(&p, last_line.len() as u64 + 1).unwrap();
        assert_eq!(tail, format!("{last_line}\n"));
        assert!(read_tail(&p, 150).unwrap().is_empty());
        let wider_tail = read_tail(&p, last_line.len() as u64 + 12).unwrap();
        assert_eq!(wider_tail, tail);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
