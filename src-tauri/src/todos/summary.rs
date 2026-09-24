//! Session summaries: latest compaction summary, cached `summaries` row, or generated
//! with `omp -p --model smol` from a condensed transcript. Background refresh loop.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

use super::omp;
use super::sessions::lookup;
use super::transcript;
use crate::contracts::SessionMeta;
use crate::prompts;
use crate::state::AppState;

/// A summary is "fresh" while the file grew less than this since it was made.
pub const STALE_BYTES: u64 = 20 * 1024;
const SUMMARY_MODEL: &str = "smol";
const TAIL_BYTES: u64 = 2 * 1024 * 1024;

static IN_FLIGHT: parking_lot::Mutex<Option<HashSet<String>>> = parking_lot::Mutex::new(None);

pub fn cached(conn: &Connection, session_id: &str) -> Option<(String, u64)> {
    conn.query_row(
        "SELECT summary, upto_offset FROM summaries WHERE session_id = ?1",
        params![session_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64)),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn store(conn: &Connection, session_id: &str, summary: &str, upto: u64) {
    let _ = conn.execute(
        "INSERT INTO summaries(session_id, summary, upto_offset, updated_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary,
           upto_offset = excluded.upto_offset, updated_at = excluded.updated_at",
        params![session_id, summary, upto as i64, super::store::now()],
    );
}

/// Pick the newer of (compaction, cached) by covered offset.
pub fn best_of(
    compaction: Option<(u64, String)>,
    cached: Option<(String, u64)>,
) -> Option<(u64, String)> {
    let cached = cached.map(|(s, off)| (off, s));
    match (compaction, cached) {
        (Some(a), Some(b)) => Some(if b.0 >= a.0 { b } else { a }),
        (a, b) => a.or(b),
    }
}

struct Scan {
    size: u64,
    compaction: Option<(u64, String)>,
}

async fn scan(file: PathBuf) -> Option<Scan> {
    tokio::task::spawn_blocking(move || {
        let content = transcript::read_all(&file).ok()?;
        Some(Scan {
            size: content.len() as u64,
            compaction: transcript::latest_compaction(&content),
        })
    })
    .await
    .ok()
    .flatten()
}

pub async fn get(state: &AppState, session_id: &str, ensure: bool) -> Option<String> {
    let meta = lookup(state, session_id).await?;
    let scan = scan(PathBuf::from(&meta.file)).await?;
    let row = cached(&state.db.lock(), session_id);
    let best = best_of(scan.compaction, row);
    let fresh = best
        .as_ref()
        .is_some_and(|(off, _)| scan.size.saturating_sub(*off) < STALE_BYTES);
    if fresh || !ensure {
        return best.map(|(_, s)| s);
    }
    let previous = best.as_ref().map(|(_, s)| s.clone());
    match generate(state, &meta, previous.as_deref(), scan.size).await {
        Ok(s) => Some(s),
        Err(e) => {
            tracing::warn!("summary for {session_id} failed: {e}");
            previous
        }
    }
}

/// Generate and store a summary covering the file up to `size` bytes.
async fn generate(
    state: &AppState,
    meta: &SessionMeta,
    previous: Option<&str>,
    size: u64,
) -> Result<String, String> {
    {
        let mut guard = IN_FLIGHT.lock();
        if !guard
            .get_or_insert_with(HashSet::new)
            .insert(meta.id.clone())
        {
            return Err("summary already in progress".to_string());
        }
    }
    let result = generate_inner(state, meta, previous, size).await;
    if let Some(set) = IN_FLIGHT.lock().as_mut() {
        set.remove(&meta.id);
    }
    result
}

async fn generate_inner(
    state: &AppState,
    meta: &SessionMeta,
    previous: Option<&str>,
    size: u64,
) -> Result<String, String> {
    let file = PathBuf::from(&meta.file);
    let texts = tokio::task::spawn_blocking(move || {
        transcript::read_tail(&file, TAIL_BYTES).map(|c| transcript::recent_texts(&c, 40, 600))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if texts.is_empty() {
        return Err("no transcript text".to_string());
    }
    let mut vars = HashMap::new();
    vars.insert("previous_summary", previous.unwrap_or("").to_string());
    vars.insert("label", meta.label.clone());
    vars.insert("title", meta.title.clone());
    vars.insert("cwd", meta.cwd.clone());
    vars.insert("transcript", texts.join("\n\n"));
    let prompt = prompts::render(prompts::SUMMARY, &vars);
    let out = omp::run_print(state, SUMMARY_MODEL, &prompt, Duration::from_secs(180)).await?;
    store(&state.db.lock(), &meta.id, &out, size);
    Ok(out)
}

/// Every 3 min: refresh summaries of sessions active in the last hour whose file grew
/// ≥ 20 KB since the last summary (at most 3 per cycle).
pub fn spawn_refresh(state: AppState) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            refresh_once(&state).await;
            tokio::time::sleep(Duration::from_secs(180)).await;
        }
    });
}

async fn refresh_once(state: &AppState) {
    let hour_ago = chrono::Utc::now() - chrono::Duration::hours(1);
    let mut candidates: Vec<SessionMeta> = crate::catalog::list(state)
        .await
        .into_iter()
        .filter(|s| !s.archived)
        .filter(|s| chrono::DateTime::parse_from_rfc3339(&s.updated_at).is_ok_and(|t| t > hour_ago))
        .collect();
    candidates.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let mut done = 0;
    for meta in candidates {
        if done >= 3 {
            break;
        }
        let Some(scan) = scan(PathBuf::from(&meta.file)).await else {
            continue;
        };
        let row = cached(&state.db.lock(), &meta.id);
        let best = best_of(scan.compaction, row);
        let covered = best.as_ref().map(|(o, _)| *o).unwrap_or(0);
        if scan.size.saturating_sub(covered) < STALE_BYTES {
            continue;
        }
        let previous = best.map(|(_, s)| s);
        if let Err(e) = generate(state, &meta, previous.as_deref(), scan.size).await {
            tracing::debug!("background summary {} failed: {e}", meta.id);
        }
        done += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn best_prefers_newer_offset() {
        let c = Some((100, "compact".to_string()));
        let k = Some(("cached".to_string(), 200));
        assert_eq!(best_of(c.clone(), k).unwrap().1, "cached");
        let k = Some(("cached".to_string(), 50));
        assert_eq!(best_of(c.clone(), k).unwrap().1, "compact");
        assert_eq!(best_of(None, None), None);
        assert_eq!(best_of(c, None).unwrap().0, 100);
    }

    #[test]
    fn cache_roundtrip() {
        let c = super::super::store::test_conn();
        assert!(cached(&c, "s").is_none());
        store(&c, "s", "one", 10);
        store(&c, "s", "two", 20);
        assert_eq!(cached(&c, "s"), Some(("two".to_string(), 20)));
    }
}
