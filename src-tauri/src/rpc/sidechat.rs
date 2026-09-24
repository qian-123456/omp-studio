//! [B] Side chats: fork of a main session with guard rules + context (§11 B).

use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;

use crate::contracts::{LiveSessionInfo, StartOpts};
use crate::state::AppState;
use crate::{catalog, paths, prompts, rpc, todos};

const MAX_FORK_DEPTH: u8 = 3;
/// Below this confidence the context router falls back to the default route.
const ROUTE_MIN_CONFIDENCE: f64 = 0.6;

/// `create_side_chat` command implementation.
pub async fn create(
    state: &AppState,
    parent_session_id: &str,
    selection: Option<String>,
    question: String,
) -> Result<LiveSessionInfo, String> {
    let parent = catalog::get(state, parent_session_id).await;
    let parent_depth = parent.as_ref().map(|m| m.fork_depth).unwrap_or(0);
    if parent_depth >= MAX_FORK_DEPTH {
        return Err("side chats are limited to 3 levels; open a new main session".into());
    }
    let parent_label = parent
        .as_ref()
        .map(|m| m.label.clone())
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| "#?".to_string());
    let parent_title = parent.as_ref().map(|m| m.title.clone()).unwrap_or_default();
    let parent_file = parent.as_ref().map(|m| m.file.clone()).unwrap_or_default();
    let cwd = parent
        .as_ref()
        .map(|m| m.cwd.clone())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| paths::global_dir().to_string_lossy().to_string());

    let label = format!(
        "{parent_label}.{}",
        child_count(state, parent_session_id).await + 1
    );

    let context = build_context(state, parent_session_id, &cwd, &selection, &question).await;

    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("parent_label", parent_label);
    vars.insert("parent_title", parent_title);
    vars.insert("cwd", cwd.clone());
    vars.insert("parent_file", parent_file);
    vars.insert("context", context);
    vars.insert("selection", selection.clone().unwrap_or_default());
    vars.insert("question", question);
    let first_prompt = prompts::render(prompts::SIDE_CHAT, &vars);

    let info = rpc::start(
        state,
        &StartOpts {
            cwd: cwd.clone(),
            parent_session_id: Some(parent_session_id.to_string()),
            label: Some(label.clone()),
            ..Default::default()
        },
    )
    .await?;

    // B owns only these session_meta columns; A owns the rest of the row.
    {
        let db = state.db.lock();
        let _ = db.execute(
		"INSERT INTO session_meta(session_id, file_path, label, parent_session_id, fork_depth, created_by_app)
		 VALUES(?1, ?2, ?3, ?4, ?5, 1)
		 ON CONFLICT(session_id) DO UPDATE SET
		   file_path = excluded.file_path,
		   label = excluded.label,
		   parent_session_id = excluded.parent_session_id,
		   fork_depth = excluded.fork_depth,
		   created_by_app = 1",
			rusqlite::params![
				info.session_id,
				info.session_file,
				label,
				parent_session_id,
				parent_depth + 1,
			],
		);
    }

    rpc::send_prompt(state, &info.session_id, &first_prompt).await?;
    Ok(info)
}

/// Children already registered under this parent: session_meta rows plus any
/// catalog entries with `parent_id` (covers rows not yet persisted).
async fn child_count(state: &AppState, parent_session_id: &str) -> u32 {
    let db_count = {
        let db = state.db.lock();
        db.query_row(
            "SELECT COUNT(*) FROM session_meta WHERE parent_session_id = ?1",
            rusqlite::params![parent_session_id],
            |row| row.get::<_, u32>(0),
        )
        .unwrap_or(0)
    };
    let catalog_count = catalog::list(state)
        .await
        .iter()
        .filter(|m| m.parent_id.as_deref() == Some(parent_session_id))
        .count() as u32;
    db_count.max(catalog_count)
}

/// Pick context per `smart_context_routing` classification; the default route
/// ("fork_continue") is also the low-confidence fallback.
async fn build_context(
    state: &AppState,
    parent_session_id: &str,
    cwd: &str,
    selection: &Option<String>,
    question: &str,
) -> String {
    let route = if state.settings.read().smart_context_routing {
        classify_route(state, selection, question).await
    } else {
        None
    };
    match route.as_deref() {
		Some("selection_only") => {
			"(The user's question targets only the selected text below; minimal main-session context.)".to_string()
		}
		// "fork_continue" | "global" | default → summary + fallback.
		_ => {
			if let Some(summary) = todos::summary(state, parent_session_id, true).await {
				return summary;
			}
			fallback_context(cwd)
		}
	}
}

/// Fallback when no summary exists: project path + `git status --short`.
fn fallback_context(cwd: &str) -> String {
    let status = std::process::Command::new("git")
        .args(["-C", cwd, "status", "--short"])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "(clean working tree)".to_string());
    format!("Project: {cwd}\n\ngit status --short:\n{status}")
}

/// `omp -p --no-session --no-tools --model <supervisor_model>` classification.
/// Returns one of selection_only | fork_continue | global, or None.
async fn classify_route(
    state: &AppState,
    selection: &Option<String>,
    question: &str,
) -> Option<String> {
    let model = state.settings.read().supervisor_model.clone();
    let binary = state.settings.read().omp_binary.clone();
    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("selection", selection.clone().unwrap_or_default());
    vars.insert("question", question.to_string());
    let prompt = prompts::render(prompts::CONTEXT_ROUTE, &vars);

    let output = tokio::time::timeout(Duration::from_secs(60), async {
        tokio::process::Command::new(binary)
            .args([
                "-p",
                &prompt,
                "--no-session",
                "--no-tools",
                "--model",
                &model,
            ])
            .current_dir(paths::global_dir())
            .output()
            .await
    })
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_route(&text)
}

/// Extract the first JSON object and read {route, confidence}.
fn parse_route(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    let value: Value = serde_json::from_str(&text[start..=end]).ok()?;
    let route = value.get("route")?.as_str()?;
    if !matches!(route, "selection_only" | "fork_continue" | "global") {
        return None;
    }
    let confidence = value
        .get("confidence")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    (confidence >= ROUTE_MIN_CONFIDENCE).then(|| route.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_route_accepts_valid() {
        assert_eq!(
            parse_route(r#"{"route":"selection_only","confidence":0.9}"#),
            Some("selection_only".to_string())
        );
        assert_eq!(
            parse_route(r#"prefix text {"route":"global","confidence":0.8} tail"#),
            Some("global".to_string())
        );
    }

    #[test]
    fn parse_route_rejects_low_confidence_and_bad_values() {
        assert_eq!(
            parse_route(r#"{"route":"selection_only","confidence":0.2}"#),
            None
        );
        assert_eq!(parse_route(r#"{"route":"bogus","confidence":1.0}"#), None);
        assert_eq!(parse_route("no json here"), None);
    }
}
