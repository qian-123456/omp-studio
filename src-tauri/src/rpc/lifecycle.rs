//! Bounded, content-free host lifecycle diagnostics.
use crate::diagnostics::{emit, DiagnosticEvent};
use std::sync::atomic::Ordering;

use super::process::SessionHandle;

pub(super) fn record(handle: &SessionHandle, source: &str, exit_code: Option<i32>) {
    // Test handles do not represent a child process.
    if handle.pid == 0 {
        return;
    }
    let source = match source {
        "explicit_stop" => "explicit_stop",
        "app_shutdown" => "app_shutdown",
        "startup_missing_session_id" => "startup_missing_session_id",
        "registration_replacement" => "registration_replacement",
        "external_writer_conflict" => "external_writer_conflict",
        "explicit_restart" => "explicit_restart",
        "privacy_refresh" => "privacy_refresh",
        "idle_suspension" => "idle_suspension",
        "unused_draft_release" => "unused_draft_release",
        "spawn_aborted" => "spawn_aborted",
        "process_exit" => "process_exit",
        _ => "other",
    };
    let mut event = DiagnosticEvent::new("rpc.lifecycle", source);
    let session_id = handle.session_id.read();
    if uuid::Uuid::parse_str(&session_id).is_ok() {
        event.session_id = Some(session_id.clone());
    }
    drop(session_id);
    event.child_pid = Some(handle.pid);
    event.exit_code = exit_code;
    event.alive = Some(handle.alive.load(Ordering::SeqCst));
    event.streaming = Some(handle.streaming.load(Ordering::SeqCst));
    event.settled = Some(handle.settled.load(Ordering::SeqCst));
    event.async_work = Some(handle.awaiting_async_work.load(Ordering::SeqCst));
    event.subagents = Some(handle.active_subagents.lock().len() as u64);
    event.pending_ui = Some(handle.pending_ui.lock().len() as u64);
    event.pending_commands = Some(handle.pending.len() as u64);
    event.shutdown_requested = Some(*handle.shutdown.borrow());
    emit(event);
}
