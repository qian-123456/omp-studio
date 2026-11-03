//! Same-session conversation-tree navigation (phase 1): thin passthroughs to
//! the upstream `navigate_tree` / `get_tree` RPC commands. Nothing here edits
//! the session file; omp owns the append-only entry tree. `branch`/`fork`
//! keep their existing "new session" semantics and are untouched.

use serde_json::{json, Value};
use tauri::Emitter;

use crate::state::{AppEvent, AppState};

/// Error marker returned when the session refuses `navigate_tree` because a
/// response is streaming / bash / compaction / retry is running. The frontend
/// maps it to a friendly "try again when the answer finishes" message.
pub const ERR_BUSY: &str = "TREE_BUSY";
/// Upstream did not recognize the entry id.
pub const ERR_ENTRY_NOT_FOUND: &str = "TREE_ENTRY_NOT_FOUND";

/// Map an upstream error string (`"<code>: <message>"` since `send_command`
/// surfaces the top-level `code`) to a recognizable local marker; other
/// errors pass through untouched.
pub fn map_tree_error(err: String) -> String {
    if err.starts_with("session_busy") {
        ERR_BUSY.into()
    } else if err.starts_with("entry_not_found") {
        ERR_ENTRY_NOT_FOUND.into()
    } else {
        err
    }
}

/// Data payload of an upstream response (`data_of`).
fn data_of(resp: Value) -> Value {
    match resp.get("data") {
        Some(d) => d.clone(),
        None => resp,
    }
}

/// `navigate_tree {entryId}` (never `summarize` in phase 1): move the leaf
/// pointer to `entry_id` in the same session file. A user-message target
/// rewinds past itself and carries its text back in `editorText`. Broadcasts
/// `tree:navigated` (desktop) + the bus event the mobile SSE maps to `touch`,
/// so every client refetches; failures change nothing.
pub async fn navigate(state: &AppState, session_id: &str, entry_id: &str) -> Result<Value, String> {
    let handle =
        crate::rpc::get_handle(session_id).ok_or_else(|| "session is not live".to_string())?;
    let resp = crate::rpc::send_command(
        &handle,
        json!({"type": "navigate_tree", "entryId": entry_id}),
    )
    .await
    .map_err(map_tree_error)?;
    // Only success reaches here: a refused navigation never moves the leaf,
    // so there is nothing to broadcast.
    state.emit(AppEvent::TreeNavigated {
        session_id: session_id.to_string(),
    });
    let _ = state
        .app
        .emit("tree:navigated", json!({ "sessionId": session_id }));
    Ok(data_of(resp))
}

/// `get_tree`: the session's entry tree + current leaf id, verbatim
/// (`{ tree: [...], leafId: string | null }`).
pub async fn get_tree(session_id: &str) -> Result<Value, String> {
    let handle =
        crate::rpc::get_handle(session_id).ok_or_else(|| "session is not live".to_string())?;
    let resp = crate::rpc::send_command(&handle, json!({"type": "get_tree"})).await?;
    Ok(data_of(resp))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_upstream_refusal_codes() {
        assert_eq!(map_tree_error("session_busy: busy".into()), ERR_BUSY);
        assert_eq!(map_tree_error("session_busy".into()), ERR_BUSY);
        assert_eq!(
            map_tree_error("entry_not_found: nope".into()),
            ERR_ENTRY_NOT_FOUND
        );
    }

    #[test]
    fn passes_other_errors_through() {
        assert_eq!(
            map_tree_error("command timed out".into()),
            "command timed out"
        );
        assert_eq!(
            map_tree_error("session is not live".into()),
            "session is not live"
        );
    }
}
