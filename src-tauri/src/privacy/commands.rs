//! Tauri commands for privacy placeholders (§7 [P]).

use crate::contracts::{
    PrivacyMarkScope, PrivacySnapshot, SecretClassification, SecretEntry, SecretEntryPatch,
    SecretRisk,
};
use crate::state::AppState;

use super::{classify, store};

/// Run a DB mutation, then re-sync files and emit `privacy_changed` while the
/// DB lock is still held so file writes follow mutation order.
fn mutate<T>(
    state: &AppState,
    op: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let conn = state.db.lock();
    let out = op(&conn)?;
    let entries = store::list(&conn)?;
    if let Err(e) = super::notify_changed(state, &entries) {
        tracing::warn!("privacy: file sync failed: {e}");
    }
    Ok(out)
}

#[tauri::command]
pub async fn privacy_list(state: tauri::State<'_, AppState>) -> Result<PrivacySnapshot, String> {
    let entries = store::list(&state.db.lock())?;
    let (native_status, native_error) = super::native_status();
    Ok(PrivacySnapshot {
        entries,
        native_status,
        native_error,
    })
}

/// Count whole-word occurrences of `value` in every string of a jsonl transcript.
fn transcript_occurrences(path: &str, value: &str) -> u32 {
    fn walk(v: &serde_json::Value, value: &str, n: &mut u32) {
        match v {
            serde_json::Value::String(s) => *n += classify::count_whole_word(s, value),
            serde_json::Value::Array(a) => a.iter().for_each(|x| walk(x, value, n)),
            serde_json::Value::Object(o) => o.values().for_each(|x| walk(x, value, n)),
            _ => {}
        }
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        return 0;
    };
    let mut n = 0;
    for line in text.lines().filter(|l| l.contains(value)) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            walk(&v, value, &mut n);
        }
    }
    n
}

#[tauri::command]
pub async fn privacy_classify(
    state: tauri::State<'_, AppState>,
    session_id: Option<String>,
    value: String,
) -> Result<SecretClassification, String> {
    let (level, reason) = match classify::classify(&value) {
        Err(code) => ("reject", Some(code)),
        Ok((SecretRisk::Safe, reason)) => ("safe", reason),
        Ok((SecretRisk::Risky, reason)) => ("risky", reason),
    };
    let file = session_id
        .as_deref()
        .and_then(|sid| store::session_file(&state.db.lock(), sid));
    let session_occurrences = match file {
        Some(path) if level != "reject" => {
            let v = value.clone();
            tokio::task::spawn_blocking(move || transcript_occurrences(&path, &v))
                .await
                .unwrap_or(0)
        }
        _ => 0,
    };
    Ok(SecretClassification {
        level: level.to_string(),
        reason: reason.map(str::to_string),
        session_occurrences,
    })
}

#[tauri::command]
pub async fn privacy_mark(
    state: tauri::State<'_, AppState>,
    session_id: Option<String>,
    value: String,
    label: Option<String>,
    track: bool,
    scope: Option<PrivacyMarkScope>,
) -> Result<SecretEntry, String> {
    let scope = scope.unwrap_or_default();
    mutate(&state, |c| {
        store::mark(
            c,
            session_id.as_deref(),
            &value,
            label.as_deref(),
            track,
            scope,
        )
    })
}

#[tauri::command]
pub async fn privacy_update(
    state: tauri::State<'_, AppState>,
    id: String,
    patch: SecretEntryPatch,
) -> Result<SecretEntry, String> {
    mutate(&state, |c| store::update(c, &id, &patch))
}

#[tauri::command]
pub async fn privacy_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    mutate(&state, |c| store::delete(c, &id))
}

#[tauri::command]
pub async fn privacy_session_entry_ids(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    store::session_entry_ids(&state.db.lock(), &session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_counts_whole_words_in_strings() {
        let path = std::env::temp_dir().join(format!("ompws-tx-{}.jsonl", uuid::Uuid::new_v4()));
        std::fs::write(
            &path,
            "{\"m\":\"ssh root@h\",\"x\":[\"root\",\"rooted\"]}\n{\"y\":\"none\"}\nnot json root\n",
        )
        .unwrap();
        assert_eq!(transcript_occurrences(path.to_str().unwrap(), "root"), 2);
        let _ = std::fs::remove_file(&path);
    }
}
