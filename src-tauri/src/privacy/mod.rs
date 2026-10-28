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
    requested_hash: String,
    /// Snapshot confirmed written successfully; never inferred from requested bytes.
    covered_hash: Option<String>,
    tracked: usize,
    /// "ok" | "conflict" | "error".
    status: &'static str,
    error: Option<String>,
}

impl NativeState {
    fn snapshot_hash(&self) -> String {
        self.covered_hash
            .clone()
            .unwrap_or_else(|| format!("unprotected:{}", self.requested_hash))
    }
}

static NATIVE: Mutex<NativeState> = Mutex::new(NativeState {
    requested_hash: String::new(),
    covered_hash: Some(String::new()),
    tracked: 0,
    status: "ok",
    error: None,
});

/// Env vars for an OMP spawn: native hash, plus the overlay enabling OMP's
/// secrets layer when at least one tracked entry exists.
pub fn spawn_env() -> Vec<(String, String)> {
    let (hash, tracked) = {
        let n = NATIVE.lock();
        (n.snapshot_hash(), n.tracked)
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

/// Current coverage token: a native hash only after successful file publication.
pub fn native_hash() -> String {
    NATIVE.lock().snapshot_hash()
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
    let isolated = std::env::var_os("OMPWS_DATA_DIR").is_some_and(|v| !v.is_empty());
    // Serialize publication with spawn snapshots and other privacy mutations.
    let mut native = NATIVE.lock();
    sync_files_at(
        entries,
        &files::privacy_dir(),
        &files::native_secrets_path(),
        isolated,
        &mut native,
    )
}

fn sync_files_at(
    entries: &[SecretEntry],
    privacy_dir: &std::path::Path,
    native_path: &std::path::Path,
    isolated: bool,
    native: &mut NativeState,
) -> Result<(), String> {
    let block = files::managed_block(entries);
    let hash = files::native_hash_of(entries, &block);
    // Cutoff entries are excluded from the native layer (it is global and cannot
    // honor per-session cutoffs), so they must not count toward the overlay either.
    let tracked = entries.iter().filter(|e| files::native_tracked(e)).count();
    // Isolated instances must not rewrite the user's global secrets.yml.
    let (status, error) = if tracked == 0 && (isolated || !native_path.exists()) {
        ("ok", None)
    } else if isolated {
        (
            "error",
            Some("隔离实例（OMPWS_DATA_DIR）不写入全局文件".to_string()),
        )
    } else {
        match files::write_native(native_path, &block) {
            Ok(true) => ("ok", None),
            Ok(false) => (
                "conflict",
                Some("secrets.yml 不是 YAML 列表，未写入隐私条目".to_string()),
            ),
            Err(e) => ("error", Some(e)),
        }
    };
    native.requested_hash = hash;
    native.covered_hash = (status == "ok" || tracked == 0).then(|| native.requested_hash.clone());
    native.tracked = tracked;
    native.status = status;
    native.error = error;
    let result = (|| {
        files::ensure_dir(privacy_dir, true)?;
        files::write_atomic(&privacy_dir.join("omp-overlay.yml"), files::OVERLAY)?;
        files::write_atomic(
            &privacy_dir.join("secrets.json"),
            &files::secrets_json(entries, &native.snapshot_hash()),
        )
    })();
    if let Err(error) = &result {
        native.covered_hash = None;
        native.status = "error";
        native.error = Some(error.clone());
    }
    result
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> SecretEntry {
        SecretEntry {
            id: "synthetic".into(),
            value: "synthetic-secret-value-0001".into(),
            label: None,
            placeholder: "⟦SECRET_ab12⟧".into(),
            aliases: vec![],
            risk: crate::contracts::SecretRisk::Safe,
            track: true,
            in_library: false,
            library_prompted: false,
            created_at: String::new(),
            session_count: 0,
            cutoffs: Default::default(),
        }
    }

    fn native_state() -> NativeState {
        NativeState {
            requested_hash: String::new(),
            covered_hash: Some(String::new()),
            tracked: 0,
            status: "ok",
            error: None,
        }
    }

    #[test]
    fn failed_native_sync_recovery_changes_coverage_even_for_identical_entries() {
        let dir = std::env::temp_dir().join(format!("ompws-privacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let native_path = dir.join("secrets.yml");
        let privacy_dir = dir.join("privacy");
        std::fs::write(&native_path, "not_a_sequence: true\n").unwrap();
        let mut native = native_state();
        let entries = [entry()];
        sync_files_at(&entries, &privacy_dir, &native_path, false, &mut native).unwrap();
        assert_eq!(native.status, "conflict");
        assert!(native.covered_hash.is_none());
        let spawn_hash = native.snapshot_hash();
        assert_eq!(spawn_hash, format!("unprotected:{}", native.requested_hash));
        let json: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(privacy_dir.join("secrets.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(json["nativeHash"], spawn_hash);

        std::fs::write(&native_path, "# recovered secrets\n").unwrap();
        sync_files_at(&entries, &privacy_dir, &native_path, false, &mut native).unwrap();
        assert_eq!(native.status, "ok");
        assert_eq!(native.covered_hash.as_ref(), Some(&native.requested_hash));
        assert_ne!(spawn_hash, native.snapshot_hash());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn isolated_native_sync_never_claims_coverage_or_changes_global_file() {
        let dir = std::env::temp_dir().join(format!("ompws-privacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secrets.yml");
        std::fs::write(&path, "[]\n").unwrap();
        let mut native = native_state();
        sync_files_at(&[entry()], &dir.join("privacy"), &path, true, &mut native).unwrap();
        assert_eq!(native.status, "error");
        assert!(native.covered_hash.is_none());
        assert!(native.snapshot_hash().starts_with("unprotected:"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), "[]\n");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_snapshot_publication_revokes_native_coverage() {
        let dir = std::env::temp_dir().join(format!("ompws-privacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let privacy_dir = dir.join("privacy");
        std::fs::write(&privacy_dir, "synthetic obstruction").unwrap();
        let mut native = native_state();
        assert!(sync_files_at(
            &[entry()],
            &privacy_dir,
            &dir.join("secrets.yml"),
            false,
            &mut native
        )
        .is_err());
        assert_eq!(native.status, "error");
        assert!(native.covered_hash.is_none());
        assert!(native.error.is_some());
        assert!(native.snapshot_hash().starts_with("unprotected:"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
