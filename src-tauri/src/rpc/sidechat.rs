//! [B] Side chats: fork of a main session with guard rules + context (§11 B).

use std::collections::HashMap;
use std::time::Duration;

use serde_json::Value;

use super::forkcut;
use crate::contracts::{LiveSessionInfo, StartOpts};
use crate::state::AppState;
use crate::{catalog, paths, prompts, rpc, todos};

const MAX_FORK_DEPTH: u8 = 3;
/// Below this confidence the context router falls back to the default route.
const ROUTE_MIN_CONFIDENCE: f64 = 0.6;

/// `create_side_chat` command implementation: fork the parent into a new side
/// chat session. NEVER sends a prompt — the first message goes through [`ask`].
/// The fork is cut at the last complete turn so unfinished work of a running
/// parent (or a dangling tool call) is not inherited.
pub async fn create(
    state: &AppState,
    parent_session_id: &str,
    model: Option<String>,
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

    let trimmed_fork = forkcut::truncate(
        &parent_file,
        forkcut::Cut::LastCompleteTurn,
        "omp-sidechat-fork",
    )
    .ok()
    .flatten();
    let fork_file = trimmed_fork
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(parent_file);

    let started = rpc::start(
        state,
        &StartOpts {
            cwd: cwd.clone(),
            parent_session_id: Some(parent_session_id.to_string()),
            label: Some(label.clone()),
            model: model.filter(|m| !m.trim().is_empty()),
            fork_file: Some(fork_file).filter(|f| !f.is_empty()),
            // The boundary rides in the first user prompt (see `ask`), NOT in
            // `--append-system-prompt`: a changed system prompt invalidates
            // the whole forked prefix in the provider's prompt cache.
            // Side chats live in the parent's space.
            mode: Some(parent.as_ref().map(|m| m.mode).unwrap_or_default()),
            ..Default::default()
        },
    )
    .await;
    if let Some(p) = &trimmed_fork {
        let _ = std::fs::remove_file(p);
    }
    let info = started?;

    // B owns only these session_meta columns; A owns the rest of the row.
    {
        let db = state.db.lock();
        let _ = db.execute(
            "INSERT INTO session_meta(session_id, file_path, label, parent_session_id, fork_depth, created_by_app, kind)
             VALUES(?1, ?2, ?3, ?4, ?5, 1, 'side')
             ON CONFLICT(session_id) DO UPDATE SET
               file_path = excluded.file_path,
               label = excluded.label,
               parent_session_id = excluded.parent_session_id,
               fork_depth = excluded.fork_depth,
               created_by_app = 1,
               kind = 'side'",
            rusqlite::params![
                info.session_id,
                info.session_file,
                label,
                parent_session_id,
                parent_depth + 1,
            ],
        );
        // The forked transcript carries the parent's placeholders.
        if let Err(e) = crate::privacy::inherit_session(&db, parent_session_id, &info.session_id) {
            tracing::warn!("privacy inherit_session: {e}");
        }
    }
    catalog::recompute_async(state, Some(vec![info.session_id.clone()])).await;

    Ok(info)
}

/// `side_chat_ask` command implementation: send the side chat's first message
/// (rendered `side_chat.md`: parent context + selection + question) as exactly
/// one prompt. Later messages use the ordinary send path.
pub async fn ask(
    state: &AppState,
    session_id: &str,
    question: String,
    selection: Option<String>,
) -> Result<(), String> {
    let q = question.trim();
    if q.is_empty() {
        return Err("question must not be empty".into());
    }
    // The fork's transcript may not be cataloged yet; the session_meta row
    // written by `create` is authoritative for the parent link.
    let own = catalog::get(state, session_id).await;
    let parent_id = match own.as_ref().and_then(|m| m.parent_id.clone()) {
        Some(p) => p,
        None => {
            let db = state.db.lock();
            db.query_row(
                "SELECT parent_session_id FROM session_meta WHERE session_id = ?1",
                rusqlite::params![session_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .ok_or_else(|| format!("session {session_id} is not a side chat"))?
        }
    };
    let parent = catalog::get(state, &parent_id).await;
    let cwd = own
        .as_ref()
        .map(|m| m.cwd.clone())
        .filter(|c| !c.is_empty())
        .or_else(|| {
            parent
                .as_ref()
                .map(|m| m.cwd.clone())
                .filter(|c| !c.is_empty())
        })
        .unwrap_or_else(|| paths::global_dir().to_string_lossy().to_string());

    let context = build_context(state, &parent_id, &cwd, &selection, &question).await;
    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert(
        "parent_label",
        parent
            .as_ref()
            .map(|m| m.label.clone())
            .filter(|l| !l.is_empty())
            .unwrap_or_else(|| "#?".to_string()),
    );
    vars.insert(
        "parent_title",
        parent.as_ref().map(|m| m.title.clone()).unwrap_or_default(),
    );
    vars.insert("cwd", cwd);
    vars.insert(
        "parent_file",
        parent.as_ref().map(|m| m.file.clone()).unwrap_or_default(),
    );
    vars.insert("context", context);
    vars.insert("boundary", prompts::SIDE_CHAT_BOUNDARY.trim().to_string());
    vars.insert("selection", selection.unwrap_or_default());
    vars.insert("question", question.clone());
    let prompt = prompts::render(prompts::SIDE_CHAT, &vars);

    // Name the side chat after its first question (never overrides a rename).
    let name: String = q.chars().take(40).collect();
    {
        let db = state.db.lock();
        let _ = db.execute(
            "UPDATE session_meta SET custom_name = COALESCE(custom_name, ?2) WHERE session_id = ?1",
            rusqlite::params![session_id, name],
        );
    }
    catalog::recompute_async(state, Some(vec![session_id.to_string()])).await;

    rpc::send_prompt(state, session_id, &prompt).await
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
		// "fork_continue" | "global" | default → cached summary + fallback.
		// Never generate here: that is a blocking LLM call (up to 180s) and the
		// child already forks the full parent transcript.
		_ => {
			if let Some(summary) = todos::summary(state, parent_session_id, false).await {
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

/// `omp -p --no-session --no-tools --model smol` classification.
/// Returns one of selection_only | fork_continue | global, or None.
async fn classify_route(
    state: &AppState,
    selection: &Option<String>,
    question: &str,
) -> Option<String> {
    let model = crate::todos::omp::normalize_model_selector("smol");
    let binary = state.settings.read().omp_binary.clone();
    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("selection", selection.clone().unwrap_or_default());
    vars.insert("question", question.to_string());
    let prompt = prompts::render(prompts::CONTEXT_ROUTE, &vars);

    let output = tokio::time::timeout(Duration::from_secs(60), async {
        let mut cmd = tokio::process::Command::new(binary);
        cmd.args([
            "-p",
            &prompt,
            "--no-session",
            "--no-tools",
            "--model",
            &model,
        ]);
        cmd.current_dir(paths::global_dir()).output().await
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

    #[test]
    fn first_prompt_carries_boundary_and_stays_display_parsable() {
        let mut vars: HashMap<&str, String> = HashMap::new();
        vars.insert("parent_label", "#1".into());
        vars.insert("parent_title", "t".into());
        vars.insert("cwd", "/x".into());
        vars.insert("boundary", prompts::SIDE_CHAT_BOUNDARY.trim().to_string());
        vars.insert("context", "ctx".into());
        vars.insert("question", "why?".into());
        let p = prompts::render(prompts::SIDE_CHAT, &vars);
        assert!(p.starts_with("Side chat forked from main session"));
        assert!(p.contains("reference only"));
        // Boundary comes before the volatile context/question.
        assert!(p.find("reference only").unwrap() < p.find("ctx").unwrap());
        assert!(p.trim_end().ends_with("## User question\nwhy?"));
    }
}
