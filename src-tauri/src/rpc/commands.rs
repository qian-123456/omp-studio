//! [B] Tauri commands (docs/ARCHITECTURE.md §7).

use serde_json::Value;
use std::future::Future;
use std::time::Instant;
use tracing::Instrument;

use crate::diagnostics::{self, DiagnosticEvent};

use crate::contracts::{
    LiveSessionInfo, OmpStaleness, PendingUiRequest, StartOpts, SubagentSummary, SubagentTranscript,
};
use crate::state::{AppEvent, AppState};

/// Keep diagnostic failures out of the original result, including pre-dispatch errors.
async fn observe_invoke<T>(
    command: &'static str,
    session_id: Option<&str>,
    operation_id: Option<&str>,
    polling: bool,
    body: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    async {
        let started = Instant::now();
        let event = |name| {
            let mut event = DiagnosticEvent::new(name, "rpc");
            event.command = Some(command.into());
            event.session_id = session_id
                .filter(|id| uuid::Uuid::parse_str(id).is_ok())
                .map(str::to_owned);
            event
        };
        if !polling {
            diagnostics::emit(event("rpc.invoke_started"));
        }
        let result = body.await;
        if !polling || result.is_err() || started.elapsed().as_secs() >= 2 {
            let mut event = event("rpc.invoke_finished");
            event.duration_ms = Some(started.elapsed().as_secs_f64() * 1000.0);
            let cancelled = result.as_ref().err().is_some_and(|error| {
                matches!(error.as_str(), "session is stopping" | "spawn aborted")
            });
            event.outcome = Some(
                if cancelled {
                    "observed"
                } else if result.is_ok() {
                    "ok"
                } else {
                    "error"
                }
                .into(),
            );
            event.code = if cancelled {
                None
            } else {
                result
                    .as_ref()
                    .err()
                    .map(|error| diagnostics::classify_error(error).into())
            };
            diagnostics::emit(event);
        }
        result
    }
    .instrument(diagnostics::operation_span(operation_id))
    .await
}

#[tauri::command]
pub async fn rpc_start(
    state: tauri::State<'_, AppState>,
    opts: StartOpts,
    diagnostic_operation_id: Option<String>,
) -> Result<LiveSessionInfo, String> {
    observe_invoke(
        "rpc_start",
        None,
        diagnostic_operation_id.as_deref(),
        false,
        async { crate::rpc::start(&state, &opts).await },
    )
    .await
}

/// `cwd`: optional override resume directory (repo main dir after the
/// worktree was deleted); persisted as `session_meta.cwd_override`.
/// `model`: explicit user-selected replacement for an unavailable saved model.
#[tauri::command]
pub async fn rpc_ensure_live(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cwd: Option<String>,
    model: Option<String>,
    diagnostic_operation_id: Option<String>,
) -> Result<LiveSessionInfo, String> {
    observe_invoke(
        "rpc_ensure_live",
        Some(&session_id),
        diagnostic_operation_id.as_deref(),
        false,
        async { crate::rpc::ensure_live(&state, &session_id, cwd, model).await },
    )
    .await
}

#[tauri::command]
pub async fn rpc_send(
    state: tauri::State<'_, AppState>,
    session_id: String,
    command: Value,
    diagnostic_operation_id: Option<String>,
) -> Result<Value, String> {
    let polling = matches!(
        command.get("type").and_then(Value::as_str),
        Some("get_state" | "get_subagents")
    );
    observe_invoke(
        "rpc_send",
        Some(&session_id),
        diagnostic_operation_id.as_deref(),
        polling,
        async {
            if !command.is_object() {
                return Err("command must be a JSON object".into());
            }
            // A fresh prompt on an idle session first picks up a changed native secrets snapshot.
            let handle = if command.get("type").and_then(Value::as_str) == Some("prompt") {
                crate::rpc::refresh_privacy(&state, &session_id).await?
            } else {
                crate::rpc::get_handle(&session_id).ok_or("session is not live")?
            };
            let is_prompt = matches!(
                command.get("type").and_then(Value::as_str),
                Some("prompt" | "steer" | "follow_up" | "abort_and_prompt")
            );
            handle.touch();
            let resp = crate::rpc::process::send_command(&handle, command).await?;
            if is_prompt {
                state.emit(AppEvent::PromptSent {
                    session_id: session_id.clone(),
                });
            }
            Ok(resp)
        },
    )
    .await
}

#[tauri::command]
pub async fn rpc_touch(session_id: String) -> Result<(), String> {
    crate::rpc::touch_session(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn rpc_retain(session_id: String) -> Result<(), String> {
    crate::rpc::retain_session(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn rpc_release(session_id: String) -> Result<(), String> {
    crate::rpc::release_session(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn rpc_ui_respond(
    state: tauri::State<'_, AppState>,
    session_id: String,
    response: Value,
) -> Result<(), String> {
    crate::rpc::ui_respond(&state, &session_id, response).await
}

#[tauri::command]
pub async fn rpc_pending_ui(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<PendingUiRequest>, String> {
    Ok(crate::rpc::pending_ui(&state, &session_id).await)
}

#[tauri::command]
pub async fn rpc_stop(
    _state: tauri::State<'_, AppState>,
    session_id: String,
    diagnostic_operation_id: Option<String>,
) -> Result<(), String> {
    observe_invoke(
        "rpc_stop",
        Some(&session_id),
        diagnostic_operation_id.as_deref(),
        false,
        async {
            let handle = crate::rpc::get_handle(&session_id).ok_or("session is not live")?;
            crate::rpc::stop(&handle).await
        },
    )
    .await
}

#[tauri::command]
pub async fn rpc_restart(
    state: tauri::State<'_, AppState>,
    session_id: String,
    diagnostic_operation_id: Option<String>,
) -> Result<LiveSessionInfo, String> {
    observe_invoke(
        "rpc_restart",
        Some(&session_id),
        diagnostic_operation_id.as_deref(),
        false,
        async { crate::rpc::restart(&state, &session_id).await },
    )
    .await
}

#[tauri::command]
pub async fn rpc_list_live(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<LiveSessionInfo>, String> {
    let _ = state;
    Ok(crate::rpc::registry()
        .read()
        .values()
        .filter(|h| h.alive.load(std::sync::atomic::Ordering::SeqCst))
        .map(|h| h.info())
        .collect())
}

/// Stat-only check: which live sessions run an omp binary that has since been
/// replaced (e.g. `omp update` in a terminal) and need `rpc_restart`.
#[tauri::command]
pub async fn rpc_omp_staleness(state: tauri::State<'_, AppState>) -> Result<OmpStaleness, String> {
    let settings = state.settings.read().clone();
    let fingerprint = super::process::current_omp_fingerprint(&settings).await;
    let stale_session_ids = {
        let reg = crate::rpc::registry().read();
        super::process::stale_session_ids(
            fingerprint.as_deref(),
            reg.iter()
                .filter(|(_, h)| h.alive.load(std::sync::atomic::Ordering::SeqCst))
                .map(|(id, h)| (id.as_str(), h.omp_fingerprint.as_deref())),
        )
    };
    Ok(OmpStaleness {
        fingerprint,
        stale_session_ids,
    })
}

#[tauri::command]
pub async fn takeover_external(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::takeover_external(&state, &session_id).await
}

#[tauri::command]
pub async fn create_side_chat(
    state: tauri::State<'_, AppState>,
    parent_session_id: String,
    model: Option<String>,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::sidechat::create(&state, &parent_session_id, model).await
}

/// Full-session fork of `parent_session_id` (cut at the last complete turn or
/// after `entry_id`). Never sends a prompt; the caller sends the first message.
#[tauri::command]
pub async fn fork_session(
    state: tauri::State<'_, AppState>,
    parent_id: String,
    entry_id: Option<String>,
    model: Option<String>,
) -> Result<LiveSessionInfo, String> {
    crate::rpc::fork::create(&state, &parent_id, entry_id, model).await
}

/// First message of a side chat (context + selection + question prompt).
#[tauri::command]
pub async fn side_chat_ask(
    state: tauri::State<'_, AppState>,
    session_id: String,
    question: String,
    selection: Option<String>,
    live_context: Option<String>,
    image_paths: Option<Vec<String>>,
) -> Result<(), String> {
    crate::rpc::sidechat::ask(
        &state,
        &session_id,
        question,
        selection,
        live_context,
        image_paths,
    )
    .await
}

/// Local image files -> omp `ImageContent` blocks (`{type:"image", data, mimeType}`),
/// the same validation as the mobile prompt pipeline. Errors on any unreadable or
/// unsupported file so senders never silently downgrade to text-only.
#[tauri::command]
pub async fn image_contents_from_paths(paths: Vec<String>) -> Result<Vec<Value>, String> {
    crate::rpc::image_blocks_from_paths(&paths)
}

/// Move the session's leaf to `entry_id` in the same conversation tree
/// (upstream `navigate_tree`, no summarize in phase 1). Returns the upstream
/// data (`{ cancelled, editorText? }`); `TREE_BUSY` when the session refuses
/// while streaming/busy. Emits `tree:navigated` on success.
#[tauri::command]
pub async fn tree_navigate(
    state: tauri::State<'_, AppState>,
    session_id: String,
    entry_id: String,
) -> Result<Value, String> {
    crate::rpc::tree::navigate(&state, &session_id, &entry_id).await
}

/// Current conversation tree + leaf id of a live session (upstream `get_tree`,
/// verbatim `{ tree, leafId }`).
#[tauri::command]
pub async fn tree_get(
    _state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    crate::rpc::tree::get_tree(&session_id).await
}

/// Contract C5: subagent sessions of a parent session file
/// (`<parentFile without .jsonl>/<AgentId>.jsonl`).
#[tauri::command]
pub async fn subagent_list(
    _state: tauri::State<'_, AppState>,
    parent_file: String,
) -> Result<Vec<SubagentSummary>, String> {
    crate::rpc::subagents::list(&parent_file)
}

/// Contract C5: normalized subagent transcript + meta + final output.
/// `from_byte` is an incremental cursor (returns only complete lines
/// appended since that offset; `reset` marks a truncation restart).
#[tauri::command]
pub async fn subagent_transcript(
    _state: tauri::State<'_, AppState>,
    parent_file: String,
    agent_id: String,
    from_byte: Option<u64>,
) -> Result<SubagentTranscript, String> {
    crate::rpc::subagents::transcript(&parent_file, &agent_id, from_byte)
}

#[cfg(test)]
mod diagnostic_tests {
    use super::*;
    use tracing::instrument::WithSubscriber;

    #[tokio::test]
    async fn diagnostic_invoke_early_error_retains_result_and_operation() {
        let (dispatch, captured) = diagnostics::test_support::capture();
        let operation = "50000000-0000-4000-8000-000000000004";
        let session = "50000000-0000-4000-8000-000000000005";
        let result: Result<(), String> =
            observe_invoke("rpc_send", Some(session), Some(operation), false, async {
                Err("session is not live".into())
            })
            .with_subscriber(dispatch)
            .await;
        assert_eq!(result.unwrap_err(), "session is not live");
        let events = captured.events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["fields"]["event"], "rpc.invoke_started");
        assert_eq!(events[1]["fields"]["event"], "rpc.invoke_finished");
        assert_eq!(events[1]["fields"]["code"], "not_live");
        assert_eq!(events[1]["fields"]["sessionId"], session);
        assert_eq!(events[1]["span"]["operationId"], operation);
    }

    #[tokio::test]
    async fn diagnostic_invoke_polling_is_silent_except_on_failure() {
        let (dispatch, captured) = diagnostics::test_support::capture();
        let result = observe_invoke("rpc_send", None, None, true, async { Ok::<_, String>(17) })
            .with_subscriber(dispatch.clone())
            .await;
        assert_eq!(result.unwrap(), 17);
        assert!(captured.events().is_empty());
        let result: Result<(), String> = observe_invoke("rpc_send", None, None, true, async {
            Err("command must be a JSON object".into())
        })
        .with_subscriber(dispatch)
        .await;
        assert_eq!(result.unwrap_err(), "command must be a JSON object");
        let events = captured.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["fields"]["event"], "rpc.invoke_finished");
        assert_eq!(events[0]["fields"]["code"], "invalid_command");
    }

    #[tokio::test]
    async fn diagnostic_invoke_invalid_operation_does_not_reject_business() {
        let (dispatch, captured) = diagnostics::test_support::capture();
        for command in [
            "rpc_start",
            "rpc_ensure_live",
            "rpc_send",
            "rpc_stop",
            "rpc_restart",
        ] {
            assert_eq!(
                observe_invoke(command, None, Some("DIAG_SECRET_SENTINEL"), false, async {
                    Ok::<_, String>(23)
                })
                .with_subscriber(dispatch.clone())
                .await
                .unwrap(),
                23
            );
        }
        let events = captured.events();
        assert_eq!(events.len(), 10);
        for record in events {
            let operation = record["span"]["operationId"].as_str().unwrap();
            assert!(uuid::Uuid::parse_str(operation).is_ok());
        }
        assert!(!String::from_utf8(captured.bytes())
            .unwrap()
            .contains("DIAG_SECRET_SENTINEL"));
    }
}
