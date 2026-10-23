//! `diagnose_build_prompt`: target session context rendered into prompts/diagnose.md.

use std::collections::HashMap;
use std::path::PathBuf;

use super::sessions::lookup;
use super::transcript;
use crate::prompts;
use crate::state::AppState;

const TAIL_BYTES: u64 = 4 * 1024 * 1024;

pub struct Evidence {
    pub errors: Vec<String>,
    pub last_assistant: Option<String>,
}

pub fn evidence(content: &str) -> Evidence {
    Evidence {
        errors: transcript::recent_errors(content, 10),
        last_assistant: transcript::last_assistant_text(content)
            .map(|t| transcript::truncate_chars(&t, 1500)),
    }
}

pub async fn build_prompt(state: &AppState, session_id: &str) -> Result<String, String> {
    let meta = lookup(state, session_id)
        .await
        .ok_or_else(|| format!("找不到会话 {session_id}"))?;
    let file = PathBuf::from(&meta.file);
    let ev = tokio::task::spawn_blocking(move || {
        transcript::read_tail(&file, TAIL_BYTES).map(|c| evidence(&c))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("读取会话文件失败: {e}"))?;
    let summary = super::summary::get(state, session_id, false).await;
    let mut vars = HashMap::new();
    vars.insert("file", meta.file.clone());
    vars.insert("label", meta.label.clone());
    vars.insert("title", meta.title.clone());
    vars.insert("cwd", meta.cwd.clone());
    vars.insert("status", super::store::enum_str(meta.status));
    vars.insert(
        "summary",
        summary.unwrap_or_else(|| "(no summary yet)".to_string()),
    );
    vars.insert(
        "errors",
        if ev.errors.is_empty() {
            "(none found)".to_string()
        } else {
            ev.errors.join("\n")
        },
    );
    vars.insert(
        "last_assistant",
        ev.last_assistant
            .or(meta.last_assistant.clone())
            .unwrap_or_else(|| "(none)".to_string()),
    );
    Ok(prompts::render(prompts::DIAGNOSE, &vars))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_template_with_evidence() {
        let content = r#"{"type":"message","id":"a","timestamp":"2026-09-04T15:12:07.000Z","message":{"role":"toolResult","toolName":"bash","content":[{"type":"text","text":"boom"}],"isError":true}}
{"type":"message","id":"b","timestamp":"2026-09-04T15:12:08.000Z","message":{"role":"assistant","content":[{"type":"text","text":"I am stuck"}],"stopReason":"stop"}}
"#;
        let ev = evidence(content);
        assert_eq!(ev.errors.len(), 1);
        let mut vars = HashMap::new();
        for k in ["file", "label", "title", "cwd", "status", "summary"] {
            vars.insert(k, format!("<{k}>"));
        }
        vars.insert("errors", ev.errors.join("\n"));
        vars.insert("last_assistant", ev.last_assistant.unwrap());
        let out = prompts::render(prompts::DIAGNOSE, &vars);
        assert!(!out.contains("{{"), "unrendered var in: {out}");
        assert!(out.contains("I am stuck") && out.contains("boom"));
    }
}
