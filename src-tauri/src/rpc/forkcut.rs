//! Cut a copy of a session file for `omp --fork`: shared by side chats
//! (`sidechat.rs`) and full-session forks (`fork.rs`).

use serde_json::Value;

/// Where to cut the parent transcript.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Cut<'a> {
    /// End of the last COMPLETE turn: the last assistant message that issues
    /// no tool call. An in-flight turn (a trailing unanswered user message, an
    /// assistant message with a dangling tool call, tool results awaiting the
    /// next assistant step) is dropped entirely so the fork never inherits
    /// unfinished work. With no complete turn only the pre-message header
    /// entries are kept.
    LastCompleteTurn,
    /// Exactly after the entry with this id (an explicitly chosen answer).
    AfterEntry(&'a str),
}

/// Write a cut copy of `file` to a fresh temp path. `Ok(None)` when nothing
/// needs cutting (fork the original); the caller deletes the returned file
/// once omp has loaded it. `Err` when the file cannot be read/written or the
/// pinned entry does not exist.
pub(crate) fn truncate(
    file: &str,
    cut: Cut<'_>,
    tmp_prefix: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let text =
        std::fs::read_to_string(file).map_err(|e| format!("无法读取会话文件 {file}：{e}"))?;
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let keep = match cut {
        Cut::LastCompleteTurn => complete_prefix_len(&lines),
        Cut::AfterEntry(id) => prefix_len_after_entry(&lines, id)
            .ok_or_else(|| format!("在会话文件中找不到所选回复（条目 {id}）"))?,
    };
    if keep == lines.len() {
        return Ok(None);
    }
    let out = std::env::temp_dir().join(format!("{tmp_prefix}-{}.jsonl", uuid::Uuid::new_v4()));
    let mut body = lines[..keep].join("\n");
    body.push('\n');
    std::fs::write(&out, body).map_err(|e| format!("无法写入分支临时文件：{e}"))?;
    Ok(Some(out))
}

/// Number of leading lines forming complete turns only (see [`Cut::LastCompleteTurn`]).
pub(crate) fn complete_prefix_len(lines: &[&str]) -> usize {
    let mut first_message = lines.len();
    let mut last_complete = None;
    for (i, line) in lines.iter().enumerate() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        first_message = first_message.min(i);
        if is_final_assistant(&v) {
            last_complete = Some(i);
        }
    }
    match last_complete {
        Some(i) => i + 1,
        None => first_message,
    }
}

/// Number of leading lines up to and including the entry with `id`.
pub(crate) fn prefix_len_after_entry(lines: &[&str], id: &str) -> Option<usize> {
    lines
        .iter()
        .position(|line| {
            serde_json::from_str::<Value>(line)
                .ok()
                .is_some_and(|v| v.get("id").and_then(Value::as_str) == Some(id))
        })
        .map(|i| i + 1)
}

/// Assistant message that ends its turn: no tool call part, not stopped for tool use.
fn is_final_assistant(v: &Value) -> bool {
    if v.pointer("/message/role").and_then(Value::as_str) != Some("assistant") {
        return false;
    }
    if v.pointer("/message/stopReason").and_then(Value::as_str) == Some("toolUse") {
        return false;
    }
    let has_tool_call = v
        .pointer("/message/content")
        .and_then(Value::as_array)
        .is_some_and(|parts| {
            parts.iter().any(|p| {
                matches!(
                    p.get("type").and_then(Value::as_str),
                    Some("toolCall" | "tool_use" | "toolUse")
                )
            })
        });
    !has_tool_call
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_file(lines: &[&str]) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("omp-cut-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("parent.jsonl");
        std::fs::write(&src, format!("{}\n", lines.join("\n"))).unwrap();
        (dir, src)
    }

    fn last_turn(file: &std::path::Path) -> Result<Option<std::path::PathBuf>, String> {
        truncate(
            file.to_str().unwrap(),
            Cut::LastCompleteTurn,
            "omp-cut-test",
        )
    }

    const HEAD: &str = r#"{"type":"session","id":"p"}"#;
    const U1: &str = r#"{"type":"message","id":"u1","message":{"role":"user","content":"first"}}"#;
    const A1: &str = r#"{"type":"message","id":"a1","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"stopReason":"stop"}}"#;
    const U2: &str = r#"{"type":"message","id":"u2","message":{"role":"user","content":"second"}}"#;
    const A2: &str = r#"{"type":"message","id":"a2","message":{"role":"assistant","content":[{"type":"text","text":"later"}],"stopReason":"stop"}}"#;
    const A_TOOL: &str = r#"{"type":"message","id":"at","message":{"role":"assistant","content":[{"type":"text","text":"mid-turn"},{"type":"toolCall","id":"t1","name":"bash"}],"stopReason":"toolUse"}}"#;
    const TR: &str =
        r#"{"type":"message","id":"tr","message":{"role":"toolResult","content":"x"}}"#;

    #[test]
    fn in_flight_user_message_is_dropped() {
        let (dir, src) = tmp_file(&[HEAD, U1, A1, U2]);
        let out = last_turn(&src).unwrap().unwrap();
        let kept = std::fs::read_to_string(&out).unwrap();
        assert_eq!(kept.lines().count(), 3);
        assert!(kept.contains("first") && !kept.contains("second"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn dangling_tool_call_turn_is_dropped() {
        let (dir, src) = tmp_file(&[HEAD, U1, A1, U2, A_TOOL, TR]);
        let out = last_turn(&src).unwrap().unwrap();
        let kept = std::fs::read_to_string(&out).unwrap();
        assert_eq!(kept.lines().count(), 3);
        assert!(!kept.contains("mid-turn") && !kept.contains("second"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn completed_turns_with_tool_calls_are_kept() {
        let (dir, src) = tmp_file(&[HEAD, U1, A_TOOL, TR, A1, U2, A_TOOL]);
        let out = last_turn(&src).unwrap().unwrap();
        let kept = std::fs::read_to_string(&out).unwrap();
        assert_eq!(kept.lines().count(), 5);
        assert!(kept.contains("mid-turn") && kept.contains("done") && !kept.contains("second"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn clean_file_is_forked_as_is_and_no_turn_keeps_header_only() {
        let (dir, src) = tmp_file(&[HEAD, U1, A1]);
        assert!(last_turn(&src).unwrap().is_none());
        let (dir2, src2) = tmp_file(&[HEAD, U1]);
        let out = last_turn(&src2).unwrap().unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap().lines().count(), 1);
        assert!(last_turn(&dir.join("missing.jsonl")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&dir2);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn pinned_entry_cuts_exactly_after_it() {
        let (dir, src) = tmp_file(&[HEAD, U1, A1, U2, A2]);
        let out = truncate(src.to_str().unwrap(), Cut::AfterEntry("a1"), "omp-cut-test")
            .unwrap()
            .unwrap();
        let kept = std::fs::read_to_string(&out).unwrap();
        assert_eq!(kept.lines().count(), 3);
        assert!(kept.contains("done") && !kept.contains("second"));
        // Pinning the last entry keeps everything: fork the original.
        assert!(
            truncate(src.to_str().unwrap(), Cut::AfterEntry("a2"), "omp-cut-test")
                .unwrap()
                .is_none()
        );
        // Unknown entry is an error, never a silent full copy.
        assert!(truncate(
            src.to_str().unwrap(),
            Cut::AfterEntry("nope"),
            "omp-cut-test"
        )
        .is_err());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_file(out);
    }
}
