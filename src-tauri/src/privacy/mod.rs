//! [P] Privacy placeholders: secret store, classification, files for the
//! privacy extension + OMP native secrets layer (docs/ARCHITECTURE.md §9).

pub mod classify;
pub mod commands;
pub mod files;
pub mod store;

use parking_lot::Mutex;
use rusqlite::Connection;
use tauri::Emitter as _;

use crate::contracts::SecretEntry;
use crate::state::{AppEvent, AppState};

/// In-memory mirror of the last file sync.
struct NativeState {
    hash: String,
    tracked: usize,
    /// "ok" | "conflict" | "error".
    status: &'static str,
    error: Option<String>,
}

static NATIVE: Mutex<NativeState> = Mutex::new(NativeState {
    hash: String::new(),
    tracked: 0,
    status: "ok",
    error: None,
});

/// Env vars for an OMP spawn: native hash, plus the overlay enabling OMP's
/// secrets layer when at least one tracked entry exists.
pub fn spawn_env() -> Vec<(String, String)> {
    let (hash, tracked) = {
        let n = NATIVE.lock();
        (n.hash.clone(), n.tracked)
    };
    let mut env = vec![
        ("OMPWS_PRIVACY_NATIVE_HASH".to_string(), hash),
        // Explicit path so isolated instances (`OMPWS_DATA_DIR`) are honored.
        (
            "OMPWS_PRIVACY_FILE".to_string(),
            files::secrets_json_path().to_string_lossy().into_owned(),
        ),
    ];
    if tracked > 0 {
        let overlay = files::overlay_path().to_string_lossy().into_owned();
        let value = match std::env::var("PI_CONFIG_FILES") {
            Ok(prev) if !prev.trim().is_empty() => format!("{prev}:{overlay}"),
            _ => overlay,
        };
        env.push(("PI_CONFIG_FILES".to_string(), value));
    }
    env
}

/// Current native hash (updated on every file sync).
pub fn native_hash() -> String {
    NATIVE.lock().hash.clone()
}

/// Copy `session_secrets` links (including cutoffs, as absolute timestamps) from
/// a parent session to a fork/side chat and, when the child gained a cutoff,
/// re-sync `secrets.json` so the extension sees it before the first child turn.
pub fn inherit_session(
    db: &Connection,
    parent_session_id: &str,
    child_session_id: &str,
) -> Result<(), String> {
    store::inherit(db, parent_session_id, child_session_id)?;
    if store::session_has_cutoff(db, child_session_id)? {
        sync_files(&store::list(db)?)?;
    }
    Ok(())
}

pub(crate) fn native_status() -> (String, Option<String>) {
    let n = NATIVE.lock();
    (n.status.to_string(), n.error.clone())
}

/// Rewrite secrets.json, the overlay and the managed secrets.yml block from
/// `entries`; refresh the in-memory native state.
pub(crate) fn sync_files(entries: &[SecretEntry]) -> Result<(), String> {
    let block = files::managed_block(entries);
    let hash = files::native_hash_of(entries, &block);
    // Cutoff entries are excluded from the native layer (it is global and cannot
    // honor per-session cutoffs), so they must not count toward the overlay either.
    let tracked = entries.iter().filter(|e| files::native_tracked(e)).count();
    let native_path = files::native_secrets_path();
    // Isolated instances (`OMPWS_DATA_DIR`, e.g. time-machine previews) must not
    // rewrite the user's global secrets.yml: it would drop the main app's block.
    let isolated = std::env::var_os("OMPWS_DATA_DIR").is_some_and(|v| !v.is_empty());
    let (status, error) = if tracked == 0 && (isolated || !native_path.exists()) {
        ("ok", None)
    } else if isolated {
        (
            "error",
            Some("隔离实例（OMPWS_DATA_DIR）不写入全局文件".to_string()),
        )
    } else {
        match files::write_native(&native_path, &block) {
            Ok(true) => ("ok", None),
            Ok(false) => (
                "conflict",
                Some("secrets.yml 不是 YAML 列表，未写入隐私条目".to_string()),
            ),
            Err(e) => ("error", Some(e)),
        }
    };
    // Fail closed: when the native layer could not be written, publish a hash no
    // spawn can carry, so the extension cancels compaction instead of leaking.
    let json_hash = if status == "ok" || tracked == 0 {
        hash.clone()
    } else {
        format!("unprotected:{hash}")
    };
    {
        let mut n = NATIVE.lock();
        n.hash = hash;
        n.tracked = tracked;
        n.status = status;
        n.error = error;
    }
    files::ensure_dir(&files::privacy_dir(), true)?;
    files::write_atomic(&files::overlay_path(), files::OVERLAY)?;
    files::write_atomic(
        &files::secrets_json_path(),
        &files::secrets_json(entries, &json_hash),
    )
}

/// Startup: (re)write all privacy files from the database.
pub fn init(state: &AppState) {
    let entries = store::list(&state.db.lock());
    match entries.and_then(|e| sync_files(&e)) {
        Ok(()) => {}
        Err(e) => tracing::warn!("privacy: initial file sync failed: {e}"),
    }
}

/// Re-sync files and notify frontend (`privacy_changed`) + bus.
pub(crate) fn notify_changed(state: &AppState, entries: &[SecretEntry]) -> Result<(), String> {
    let result = sync_files(entries);
    let _ = state.app.emit("privacy_changed", ());
    state.emit(AppEvent::PrivacyChanged);
    result
}
