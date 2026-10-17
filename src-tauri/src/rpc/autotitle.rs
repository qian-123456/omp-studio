//! Automatic session titles for app-owned `omp --mode rpc` sessions.
//!
//! omp disables its own title generation in RPC mode (`PI_NO_TITLE=1`, see the
//! RPC protocol reference), so sessions stayed named after their first user
//! message. After the first terminal `agent_end` of an untitled session this
//! generates a title with a one-shot `omp -p` run on the `tiny` role (JSON reply,
//! re-validated) and applies it through the `set_session_name` RPC command.

use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;

use crate::catalog::parse;
use crate::prompts;
use crate::state::{AppEvent, AppState};

const TITLE_MODEL: &str = "tiny";
const MAX_TITLE_CHARS: usize = 60;
const MAX_MESSAGE_CHARS: usize = 1200;
const GENERATE_TIMEOUT: Duration = Duration::from_secs(60);

/// Sessions already examined (titled or attempted) in this app run.
static HANDLED: OnceLock<parking_lot::Mutex<HashSet<String>>> = OnceLock::new();

fn handled() -> &'static parking_lot::Mutex<HashSet<String>> {
    HANDLED.get_or_init(Default::default)
}

pub fn spawn(state: AppState) {
    let mut rx = state.bus.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(AppEvent::RpcFrame { session_id, frame }) if is_terminal_agent_end(&frame) => {
                    let state = state.clone();
                    tauri::async_runtime::spawn(async move {
                        maybe_title(&state, &session_id).await;
                    });
                }
                Ok(_) | Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    });
}

fn is_terminal_agent_end(frame: &Value) -> bool {
    frame.get("type").and_then(Value::as_str) == Some("agent_end")
        && frame.get("isTerminal").and_then(Value::as_bool) != Some(false)
}

/// True when the file has no title of any kind (slot, header, `title_change`),
/// i.e. the catalog would fall back to the first user message.
fn is_untitled(head: &parse::HeadInfo, tail: &parse::TailInfo) -> bool {
    head.slot_title.is_none()
        && head.header_title.is_none()
        && tail.title_change.is_none()
        && head.parent_session.is_none()
}

fn file_is_untitled(file: &std::path::Path) -> Option<bool> {
    let head = parse::read_head(file).ok()??;
    let size = std::fs::metadata(file).ok()?.len();
    let tail = parse::read_tail(file, size).ok()?;
    Some(is_untitled(&head, &tail))
}

async fn maybe_title(state: &AppState, session_id: &str) {
    if handled().lock().contains(session_id) {
        return;
    }
    let Some(handle) = super::get_handle(session_id) else {
        return;
    };
    let file = std::path::PathBuf::from(handle.session_file.read().clone());
    match file_is_untitled(&file) {
        Some(true) => {}
        Some(false) => {
            handled().lock().insert(session_id.to_string());
            return;
        }
        None => return,
    }
    let Some(message) = parse::read_first_user_text(&file) else {
        return;
    };
    if !handled().lock().insert(session_id.to_string()) {
        return;
    }
    let Some(title) = generate(state, &message).await else {
        return;
    };
    // The user may have renamed the session while the model call ran.
    if file_is_untitled(&file) != Some(true) {
        return;
    }
    if let Err(e) =
        super::send_command(&handle, json!({"type": "set_session_name", "name": title})).await
    {
        tracing::warn!("autotitle: set_session_name failed for {session_id}: {e}");
    }
}

async fn generate(state: &AppState, message: &str) -> Option<String> {
    let clipped: String = message.chars().take(MAX_MESSAGE_CHARS).collect();
    let mut vars = std::collections::HashMap::new();
    vars.insert("message", clipped);
    let prompt = prompts::render(prompts::SESSION_TITLE, &vars);
    // `run_print` skips MCP/extension loading; the full tool set made Gemini reject the request.
    match crate::todos::omp::run_print(state, TITLE_MODEL, &prompt, GENERATE_TIMEOUT).await {
        Ok(out) => parse_title(&out),
        Err(e) => {
            tracing::warn!("autotitle: title generation failed: {e}");
            None
        }
    }
}

#[derive(serde::Deserialize)]
struct TitleDraft {
    title: String,
}

/// Find the last JSON object in `reply` that fits `TitleDraft` (the model may wrap
/// it in prose or a code fence) and normalize its title. `omp -p` cannot enforce a
/// schema, so the shape is re-validated here.
fn parse_title(reply: &str) -> Option<String> {
    let draft = reply
        .match_indices('{')
        .filter_map(|(i, _)| {
            serde_json::Deserializer::from_str(&reply[i..])
                .into_iter::<TitleDraft>()
                .next()?
                .ok()
        })
        .next_back()?;
    clean_title(&draft.title)
}

/// First non-empty line, stripped of wrapping quotes / `Title:` prefix /
/// trailing punctuation and capped at `MAX_TITLE_CHARS`.
fn clean_title(raw: &str) -> Option<String> {
    let line = raw.lines().map(str::trim).find(|l| !l.is_empty())?;
    let line = line
        .strip_prefix("Title:")
        .or_else(|| line.strip_prefix("标题："))
        .or_else(|| line.strip_prefix("标题:"))
        .unwrap_or(line);
    let strip = [
        '"', '\'', '`', '“', '”', '‘', '’', '「', '」', '*', '#', '.', '。', '!', '！',
    ];
    let trimmed = line.trim().trim_matches(&strip[..]).trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(parse::snippet(trimmed, MAX_TITLE_CHARS))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_agent_end_only() {
        assert!(is_terminal_agent_end(&json!({"type":"agent_end"})));
        assert!(is_terminal_agent_end(
            &json!({"type":"agent_end","isTerminal":true})
        ));
        assert!(!is_terminal_agent_end(
            &json!({"type":"agent_end","isTerminal":false})
        ));
        assert!(!is_terminal_agent_end(&json!({"type":"agent_start"})));
    }

    #[test]
    fn parse_title_reads_schema_json() {
        assert_eq!(
            parse_title(r#"{"title": "修复登录 bug"}"#),
            Some("修复登录 bug".into())
        );
        assert_eq!(
            parse_title("Sure!\n```json\n{\"title\":\"Fix login.\"}\n```"),
            Some("Fix login".into())
        );
        assert_eq!(parse_title("Fix login"), None);
        assert_eq!(parse_title(r#"{"title":"a","extra":1}"#), Some("a".into()));
        assert_eq!(parse_title(r#"{"title":"  "}"#), None);
    }

    #[test]
    fn clean_title_normalizes_model_output() {
        assert_eq!(
            clean_title("\n\"修复登录 bug\"。\nextra"),
            Some("修复登录 bug".into())
        );
        assert_eq!(clean_title("Title: Fix login."), Some("Fix login".into()));
        assert_eq!(clean_title("  \n "), None);
        assert_eq!(clean_title("\"\""), None);
        let long = "x".repeat(200);
        assert_eq!(clean_title(&long).unwrap().chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn untitled_detection() {
        let head = parse::HeadInfo::default();
        let tail = parse::TailInfo::default();
        assert!(is_untitled(&head, &tail));
        let titled = parse::HeadInfo {
            slot_title: Some("x".into()),
            ..Default::default()
        };
        assert!(!is_untitled(&titled, &tail));
        let forked = parse::HeadInfo {
            parent_session: Some("p".into()),
            ..Default::default()
        };
        assert!(!is_untitled(&forked, &tail));
        let renamed = parse::TailInfo {
            title_change: Some("n".into()),
            ..Default::default()
        };
        assert!(!is_untitled(&head, &renamed));
    }

    #[test]
    fn reads_full_first_user_text() {
        let dir = std::env::temp_dir().join(format!("autotitle-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s.jsonl");
        let long = "请帮我".repeat(30);
        std::fs::write(
            &file,
            format!(
                "{}\n{}\n",
                r#"{"type":"session","version":3,"id":"s","timestamp":"T","cwd":"/x"}"#,
                json!({"type":"message","message":{"role":"user","content":[{"type":"text","text":long}]}})
            ),
        )
        .unwrap();
        assert_eq!(parse::read_first_user_text(&file), Some(long.clone()));
        assert_eq!(file_is_untitled(&file), Some(true));
        std::fs::remove_dir_all(&dir).ok();
    }
}
