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
    /// unfinished work. Tail plan-state custom entries are retained for full
    /// forks, but never the unfinished messages they followed. With no complete
    /// turn only the pre-message header and that plan state are kept.
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
    cut_copy(file, cut, tmp_prefix, false)
}

/// Like [`truncate`], but the copy also has bundled plan mode switched off: a
/// side chat is an independent conversation and must not inherit the parent's
/// planning state (read-only tools and the `plan` role model).
pub(crate) fn truncate_for_side_chat(
    file: &str,
    cut: Cut<'_>,
    tmp_prefix: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    cut_copy(file, cut, tmp_prefix, true)
}

/// Entry type the bundled plan extension persists its state under
/// (`extension/omp-workspace-plan.ts` `STATE_ENTRY`).
const PLAN_STATE_ENTRY: &str = "ompws-plan-state";

/// Turn `enabled` off in a plan-state entry line; `None` when the line is not
/// an enabled plan-state entry. The entry stays in place so parent links hold.
fn disable_plan_state(line: &str) -> Option<String> {
    if !line.contains(PLAN_STATE_ENTRY) {
        return None;
    }
    let mut v: Value = serde_json::from_str(line).ok()?;
    if v.get("customType").and_then(Value::as_str) != Some(PLAN_STATE_ENTRY) {
        return None;
    }
    let data = v.get_mut("data")?.as_object_mut()?;
    if data.get("enabled").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    data.insert("enabled".into(), Value::Bool(false));
    serde_json::to_string(&v).ok()
}

fn cut_copy(
    file: &str,
    cut: Cut<'_>,
    tmp_prefix: &str,
    drop_plan_mode: bool,
) -> Result<Option<std::path::PathBuf>, String> {
    let text =
        std::fs::read_to_string(file).map_err(|e| format!("无法读取会话文件 {file}：{e}"))?;
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let keep = match cut {
        Cut::LastCompleteTurn => complete_prefix_len(&lines),
        Cut::AfterEntry(id) => prefix_len_after_entry(&lines, id)
            .ok_or_else(|| format!("在会话文件中找不到所选回复（条目 {id}）"))?,
    };
    let mut kept: Vec<std::borrow::Cow<'_, str>> = lines[..keep]
        .iter()
        .map(
            |l| match drop_plan_mode.then(|| disable_plan_state(l)).flatten() {
                Some(changed) => std::borrow::Cow::Owned(changed),
                None => std::borrow::Cow::Borrowed(*l),
            },
        )
        .collect();
    // Plan toggles/review updates can be persisted after the last answer (even
    // while the next turn is unfinished). A full fork must restore that state,
    // not the older snapshot in the completed prefix. Pinned forks stay exact.
    if !drop_plan_mode && matches!(cut, Cut::LastCompleteTurn) {
        let mut parent_id = lines[..keep].iter().rev().find_map(|line| {
            let v = serde_json::from_str::<Value>(line).ok()?;
            (v.get("type").and_then(Value::as_str) != Some("session"))
                .then(|| v.get("id").cloned())
                .flatten()
        });
        for line in &lines[keep..] {
            let Ok(mut v) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if v.get("type").and_then(Value::as_str) != Some("custom")
                || v.get("customType").and_then(Value::as_str) != Some(PLAN_STATE_ENTRY)
            {
                continue;
            }
            // Do not leave a dangling link to an excluded user/tool message.
            v["parentId"] = parent_id.clone().unwrap_or(Value::Null);
            parent_id = v.get("id").cloned().or(parent_id);
            kept.push(std::borrow::Cow::Owned(
                serde_json::to_string(&v).map_err(|e| format!("无法保存分支计划状态：{e}"))?,
            ));
        }
    }
    let rewritten = kept.iter().any(|l| matches!(l, std::borrow::Cow::Owned(_)));
    if keep == lines.len() && !rewritten {
        return Ok(None);
    }
    let out = std::env::temp_dir().join(format!("{tmp_prefix}-{}.jsonl", uuid::Uuid::new_v4()));
    let mut body = kept.join("\n");
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

    const PLAN_ON: &str = r#"{"type":"custom","id":"ps","customType":"ompws-plan-state","data":{"enabled":true,"version":2,"phase":"planning"}}"#;

    fn plan_enabled_in(file: &std::path::Path) -> Vec<bool> {
        std::fs::read_to_string(file)
            .unwrap()
            .lines()
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .filter(|v| v["customType"] == PLAN_STATE_ENTRY)
            .map(|v| v["data"]["enabled"].as_bool().unwrap())
            .collect()
    }

    #[test]
    fn side_chat_copy_switches_plan_mode_off_even_when_nothing_is_cut() {
        let (dir, src) = tmp_file(&[HEAD, PLAN_ON, U1, A1]);
        let out =
            truncate_for_side_chat(src.to_str().unwrap(), Cut::LastCompleteTurn, "omp-cut-test")
                .unwrap()
                .expect("a plan-enabled parent always needs a rewritten copy");
        assert_eq!(plan_enabled_in(&out), vec![false]);
        // Entries and their order are untouched.
        assert_eq!(std::fs::read_to_string(&out).unwrap().lines().count(), 4);
        // The parent file itself is never modified.
        assert_eq!(plan_enabled_in(&src), vec![true]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn plain_fork_copy_keeps_plan_mode() {
        let (dir, src) = tmp_file(&[HEAD, PLAN_ON, U1, A1]);
        assert!(last_turn(&src).unwrap().is_none());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn side_chat_copy_without_plan_state_is_not_rewritten() {
        let (dir, src) = tmp_file(&[HEAD, U1, A1]);
        assert!(truncate_for_side_chat(
            src.to_str().unwrap(),
            Cut::LastCompleteTurn,
            "omp-cut-test"
        )
        .unwrap()
        .is_none());
        std::fs::remove_dir_all(dir).ok();
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
    const PLAN_OFF: &str = r#"{"type":"custom","id":"ps-off","parentId":"a1","customType":"ompws-plan-state","data":{"enabled":false,"version":3,"phase":"review","lastContent":"saved plan"}}"#;
    const TAIL_PLAN_ON: &str = r#"{"type":"custom","id":"ps-tail","parentId":"tr","customType":"ompws-plan-state","data":{"enabled":true,"version":4,"phase":"review","lastContent":"new plan"}}"#;

    #[test]
    fn full_fork_keeps_plan_disable_after_last_complete_answer() {
        let (dir, src) = tmp_file(&[HEAD, PLAN_ON, U1, A1, PLAN_OFF]);
        let out = last_turn(&src).unwrap().unwrap();
        assert_eq!(plan_enabled_in(&out), vec![true, false]);
        let body = std::fs::read_to_string(&out).unwrap();
        let tail: Value = serde_json::from_str(body.lines().last().unwrap()).unwrap();
        let original: Value = serde_json::from_str(PLAN_OFF).unwrap();
        assert_eq!(tail["data"], original["data"]);
        assert_eq!(tail["parentId"], "a1");
        assert_eq!(body.lines().count(), 5);
        assert_eq!(plan_enabled_in(&src), vec![true, false]);
        std::fs::remove_file(out).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn full_fork_keeps_tail_plan_snapshots_but_not_unfinished_messages() {
        let unrelated = r#"{"type":"custom_message","id":"unfinished-context","customType":"ompws-plan-context","content":"unfinished prompt"}"#;
        let (dir, src) = tmp_file(&[
            HEAD,
            U1,
            A1,
            U2,
            A_TOOL,
            TR,
            PLAN_OFF,
            unrelated,
            TAIL_PLAN_ON,
        ]);
        let out = last_turn(&src).unwrap().unwrap();
        let body = std::fs::read_to_string(&out).unwrap();
        let entries: Vec<Value> = body
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(entries.len(), 5);
        assert_eq!(entries[3]["id"], "ps-off");
        assert_eq!(entries[3]["parentId"], "a1");
        assert_eq!(entries[4]["id"], "ps-tail");
        assert_eq!(entries[4]["parentId"], "ps-off");
        assert_eq!(entries[4]["data"]["version"], 4);
        assert_eq!(entries[4]["data"]["lastContent"], "new plan");
        assert_eq!(plan_enabled_in(&out), vec![false, true]);
        assert!(!body.contains("second"));
        assert!(!body.contains("mid-turn"));
        assert!(!body.contains("unfinished-context"));
        assert!(!body.contains("toolResult"));
        std::fs::remove_file(out).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn full_fork_without_complete_turn_keeps_only_header_and_tail_plan_state() {
        let (dir, src) = tmp_file(&[HEAD, U2, A_TOOL, TR, TAIL_PLAN_ON]);
        let out = last_turn(&src).unwrap().unwrap();
        let body = std::fs::read_to_string(&out).unwrap();
        let entries: Vec<Value> = body
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1]["id"], "ps-tail");
        assert!(entries[1]["parentId"].is_null());
        assert_eq!(plan_enabled_in(&out), vec![true]);
        std::fs::remove_file(out).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn pinned_fork_and_side_chat_do_not_import_tail_plan_state() {
        let (dir, src) = tmp_file(&[HEAD, PLAN_ON, U1, A1, U2, TAIL_PLAN_ON]);
        let pinned = truncate(src.to_str().unwrap(), Cut::AfterEntry("a1"), "omp-cut-test")
            .unwrap()
            .unwrap();
        let side =
            truncate_for_side_chat(src.to_str().unwrap(), Cut::LastCompleteTurn, "omp-cut-test")
                .unwrap()
                .unwrap();
        assert_eq!(plan_enabled_in(&pinned), vec![true]);
        assert_eq!(plan_enabled_in(&side), vec![false]);
        for file in [&pinned, &side] {
            let body = std::fs::read_to_string(file).unwrap();
            assert!(!body.contains("ps-tail"));
            assert!(!body.contains("second"));
            std::fs::remove_file(file).unwrap();
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn side_chat_copy_write_failure_is_propagated() {
        let (dir, src) = tmp_file(&[HEAD, PLAN_ON, U1, A1]);
        // A nested prefix with a nonexistent directory deterministically fails
        // the write without permissions tricks or global environment changes.
        let prefix = dir.join("missing").join("fork");
        let error = truncate_for_side_chat(
            src.to_str().unwrap(),
            Cut::LastCompleteTurn,
            prefix.to_str().unwrap(),
        )
        .unwrap_err();
        assert!(error.contains("无法写入分支临时文件"));
        assert_eq!(plan_enabled_in(&src), vec![true]);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
