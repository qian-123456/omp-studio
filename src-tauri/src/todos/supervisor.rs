//! Read-only LLM supervisor: digest of sessions + backlog → Suggestion todos.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::store::{self, NewTodo};
use super::transcript::truncate_chars;
use crate::contracts::{BacklogStatus, TodoKind, TodoSource};
use crate::prompts;
use crate::state::AppState;

const MIN_INTERVAL: Duration = Duration::from_secs(5 * 60);
const MAX_SESSIONS: usize = 12;

static LAST_RUN: parking_lot::Mutex<Option<Instant>> = parking_lot::Mutex::new(None);
static SCHEDULED: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    pub title: String,
    pub detail: String,
    pub session_id: Option<String>,
    pub action: Option<Value>,
}

/// Debounced trigger on status changes (runs at most once per 5 min).
pub fn on_status_change(state: &AppState) {
    if !state.settings.read().supervisor_enabled {
        return;
    }
    if LAST_RUN.lock().is_some_and(|t| t.elapsed() < MIN_INTERVAL) {
        return;
    }
    if SCHEDULED.swap(true, Ordering::SeqCst) {
        return;
    }
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        SCHEDULED.store(false, Ordering::SeqCst);
        if let Err(e) = run(&state).await {
            tracing::debug!("supervisor run skipped: {e}");
        }
    });
}

/// Manual refresh (`supervisor_refresh`).
pub async fn refresh(state: &AppState) -> Result<(), String> {
    if !state.settings.read().supervisor_enabled {
        return Err("监工建议未开启".to_string());
    }
    run(state).await.map(|_| ())
}

async fn run(state: &AppState) -> Result<usize, String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("监工正在分析中".to_string());
    }
    let r = run_inner(state).await;
    *LAST_RUN.lock() = Some(Instant::now());
    RUNNING.store(false, Ordering::SeqCst);
    r
}

async fn run_inner(state: &AppState) -> Result<usize, String> {
    let mut sessions: Vec<_> = crate::catalog::list(state)
        .await
        .into_iter()
        .filter(|s| !s.archived)
        .collect();
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions.truncate(MAX_SESSIONS);
    let mut session_lines = Vec::new();
    for s in &sessions {
        let summary = super::summary::get(state, &s.id, false)
            .await
            .map(|t| truncate_chars(&t, 600))
            .or_else(|| s.last_assistant.as_deref().map(|t| truncate_chars(t, 300)))
            .unwrap_or_default();
        session_lines.push(format!(
            "- id={} {} \"{}\" status={} pending={} updated={} cwd={}\n  summary: {}",
            s.id,
            s.label,
            s.title,
            store::enum_str(s.status),
            s.pending
                .map(store::enum_str)
                .unwrap_or_else(|| "none".into()),
            s.updated_at,
            s.cwd,
            summary.replace('\n', " ")
        ));
    }
    let (backlog_lines, open_lines) = {
        let db = state.db.lock();
        let backlog: Vec<String> = crate::backlog::store::list(&db)
            .unwrap_or_default()
            .into_iter()
            .filter(|b| b.status == BacklogStatus::Inbox)
            .map(|b| {
                format!(
                    "- id={} [{}] {}",
                    b.id,
                    store::enum_str(b.kind),
                    truncate_chars(&b.text, 200)
                )
            })
            .collect();
        let open: Vec<String> = store::open_with_keys(&db, &[TodoKind::Suggestion])
            .unwrap_or_default()
            .into_iter()
            .map(|(t, _)| format!("- {}", t.title))
            .collect();
        (backlog, open)
    };
    if session_lines.is_empty() && backlog_lines.is_empty() {
        return Ok(0);
    }
    let none = || "(none)".to_string();
    let join = |v: &[String]| if v.is_empty() { none() } else { v.join("\n") };
    let mut vars = HashMap::new();
    vars.insert("sessions", join(&session_lines));
    vars.insert("backlog", join(&backlog_lines));
    vars.insert("open_suggestions", join(&open_lines));
    let prompt = prompts::render(prompts::SUPERVISOR, &vars);
    let model = state.settings.read().supervisor_model.clone();
    let out = super::omp::run_print(state, &model, &prompt, Duration::from_secs(240)).await?;
    let suggestions = parse_suggestions(&out);
    let mut inserted = 0;
    {
        let db = state.db.lock();
        for s in suggestions.iter().take(5) {
            let t = NewTodo {
                kind: TodoKind::Suggestion,
                source: TodoSource::Supervisor,
                session_id: s.session_id.clone(),
                title: s.title.clone(),
                detail: s.detail.clone(),
                payload: s
                    .action
                    .clone()
                    .map(|a| json!({ "action": a }))
                    .unwrap_or(json!({})),
            };
            if store::upsert(&db, &suggestion_key(s), &t, false).unwrap_or(false) {
                inserted += 1;
            }
        }
    }
    if inserted > 0 {
        super::notify_changed(state);
    }
    Ok(inserted)
}

fn fnv1a(s: &str) -> u64 {
    s.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    })
}

pub fn suggestion_key(s: &Suggestion) -> String {
    let norm: String = s
        .title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    format!(
        "sup:{}:{:016x}",
        s.session_id.as_deref().unwrap_or("-"),
        fnv1a(&norm)
    )
}

/// Extract the first JSON array from model output and validate its items.
pub fn parse_suggestions(text: &str) -> Vec<Suggestion> {
    let array = text.match_indices('[').find_map(|(i, _)| {
        let mut it = serde_json::Deserializer::from_str(&text[i..]).into_iter::<Value>();
        match it.next() {
            Some(Ok(Value::Array(a))) => Some(a),
            _ => None,
        }
    });
    let str_field = |v: &Value, k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    array
        .unwrap_or_default()
        .iter()
        .filter_map(|v| {
            let title = str_field(v, "title")?;
            let action = v.get("action").filter(|a| {
                a.get("type").and_then(Value::as_str) == Some("dispatch_backlog")
                    && str_field(a, "backlogId").is_some()
                    && str_field(a, "targetSessionId").is_some()
            });
            Some(Suggestion {
                title,
                detail: str_field(v, "detail").unwrap_or_default(),
                session_id: str_field(v, "sessionId"),
                action: action.cloned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_array_amid_prose() {
        let out = r##"Here you go:
```json
[{"title":"#3 卡住了","detail":"重复报错","sessionId":"s3"},
 {"title":"派发 bug","detail":"#2 空闲","action":{"type":"dispatch_backlog","backlogId":"b1","targetSessionId":"s2"}},
 {"title":"","detail":"skip"},
 {"title":"bad action","action":{"type":"other"}}]
```"##;
        let s = parse_suggestions(out);
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].session_id.as_deref(), Some("s3"));
        assert_eq!(s[1].action.as_ref().unwrap()["backlogId"], "b1");
        assert!(s[2].action.is_none());
    }

    #[test]
    fn skips_non_array_brackets() {
        assert!(parse_suggestions("[not json] then []").is_empty());
        assert_eq!(parse_suggestions("x [bad [{\"title\":\"a\"}]").len(), 1);
        assert!(parse_suggestions("nothing").is_empty());
    }

    #[test]
    fn stable_keys() {
        let a = Suggestion {
            title: "Hello  World".into(),
            detail: String::new(),
            session_id: None,
            action: None,
        };
        let b = Suggestion {
            title: "hello world".into(),
            ..a.clone()
        };
        assert_eq!(suggestion_key(&a), suggestion_key(&b));
        assert!(suggestion_key(&a).starts_with("sup:-:"));
    }
}
