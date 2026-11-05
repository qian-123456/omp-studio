//! Bounded, content-free host lifecycle diagnostics.
use std::io::Write;
use std::sync::atomic::Ordering;

use super::process::SessionHandle;

const MAX_BYTES: u64 = 1024 * 1024;
static LOG_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

pub(super) fn record(handle: &SessionHandle, source: &str, exit_code: Option<i32>) {
    // Test handles do not represent a child process.
    if handle.pid == 0 {
        return;
    }
    let entry = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "sessionId": *handle.session_id.read(),
        "pid": handle.pid,
        "source": source,
        "exitCode": exit_code,
        "alive": handle.alive.load(Ordering::SeqCst),
        "streaming": handle.streaming.load(Ordering::SeqCst),
        "settled": handle.settled.load(Ordering::SeqCst),
        "asyncWork": handle.awaiting_async_work.load(Ordering::SeqCst),
        "subagents": handle.active_subagents.lock().len(),
        "pendingUi": handle.pending_ui.lock().len(),
        "pendingCommands": handle.pending.len(),
        "shutdownRequested": *handle.shutdown.borrow(),
    });
    let _guard = LOG_LOCK.lock();
    let result = (|| -> std::io::Result<()> {
        let root = crate::paths::data_dir();
        std::fs::create_dir_all(&root)?;
        let path = root.join("rpc-lifecycle.jsonl");
        if std::fs::metadata(&path).is_ok_and(|m| m.len() >= MAX_BYTES) {
            std::fs::rename(&path, root.join("rpc-lifecycle.previous.jsonl"))?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        writeln!(file, "{entry}")?;
        file.sync_data()
    })();
    if let Err(error) = result {
        tracing::warn!("rpc lifecycle diagnostic write failed: {error}");
    }
}
