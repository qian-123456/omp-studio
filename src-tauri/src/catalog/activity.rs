//! Historical activity from persisted OMP requests, not context-window size.
//! The disposable SQLite index stores accounting metadata only (never message text).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, UNIX_EPOCH};

use chrono::{DateTime, Local, Utc};
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::Value;

use crate::contracts::{ActivityDayUsage, ActivityUsage};

type FileSignatures = HashMap<String, (u64, String)>;

#[derive(Clone)]
struct CachedScan {
    root: PathBuf,
    cache: PathBuf,
    local_day: String,
    signatures: FileSignatures,
    usage: ActivityUsage,
}

pub(crate) fn load() -> Result<ActivityUsage, String> {
    static SCAN: LazyLock<Mutex<Option<CachedScan>>> = LazyLock::new(|| Mutex::new(None));
    let mut guard = SCAN.lock();
    let dir = crate::paths::data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let root = crate::paths::omp_sessions_dir();
    let cache = dir.join("activity-cache.sqlite");
    let local_day = Local::now().format("%Y-%m-%d").to_string();

    if let Some(prev) = guard.as_ref() {
        if prev.root == root && prev.cache == cache && prev.local_day == local_day && cache.exists()
        {
            if let Ok(current) = collect_signatures(&root) {
                if current == prev.signatures {
                    return Ok(prev.usage.clone());
                }
            }
        }
    }

    let (usage, signatures) = load_from_with_signatures(&root, &cache)
        .map_err(|e| format!("read activity usage: {e}"))?;
    *guard = Some(CachedScan {
        root,
        cache,
        local_day,
        signatures,
        usage: usage.clone(),
    });
    Ok(usage)
}

fn collect_signatures(root: &Path) -> anyhow::Result<FileSignatures> {
    let mut out = HashMap::new();
    for path in session_files(root)? {
        let metadata = std::fs::metadata(&path)?;
        let size = metadata.len();
        let modified = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)?
            .as_nanos()
            .to_string();
        out.insert(path.to_string_lossy().into_owned(), (size, modified));
    }
    Ok(out)
}

/// File signatures persist across launches. Only added/changed files are parsed;
/// deleted files are removed. A rewrite replaces its rows rather than adding them.
#[cfg(test)]
pub(crate) fn load_from(root: &Path, cache: &Path) -> anyhow::Result<ActivityUsage> {
    load_from_with_signatures(root, cache).map(|(usage, _)| usage)
}

fn load_from_with_signatures(
    root: &Path,
    cache: &Path,
) -> anyhow::Result<(ActivityUsage, FileSignatures)> {
    let mut db = Connection::open(cache)?;
    db.busy_timeout(Duration::from_secs(5))?;
    let version: u32 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version != 1 {
        db.execute_batch(
            "DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS files; PRAGMA user_version=1;",
        )?;
    }
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS files (
           path TEXT PRIMARY KEY, size INTEGER NOT NULL, modified TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS events (
           file TEXT NOT NULL, event_key TEXT NOT NULL, session TEXT NOT NULL,
           session_created TEXT NOT NULL, timestamp INTEGER NOT NULL,
           model TEXT, tokens INTEGER, is_turn INTEGER NOT NULL,
           PRIMARY KEY(file, event_key)
         );
         CREATE INDEX IF NOT EXISTS idx_events_order ON events(session_created, file, timestamp);",
    )?;
    let previous: HashMap<String, (u64, String)> = {
        let mut stmt = db.prepare("SELECT path, size, modified FROM files")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut signatures: HashMap<String, (u64, String)> = HashMap::new();
    let mut present = HashSet::new();
    let tx = db.transaction()?;
    for path in session_files(root)? {
        let metadata = std::fs::metadata(&path)?;
        let size = metadata.len();
        let modified = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)?
            .as_nanos()
            .to_string();
        let name = path.to_string_lossy().into_owned();
        present.insert(name.clone());
        signatures.insert(name.clone(), (size, modified.clone()));
        if previous
            .get(&name)
            .is_some_and(|(s, m)| *s == size && *m == modified)
        {
            continue;
        }
        tx.execute("DELETE FROM events WHERE file = ?1", [&name])?;
        {
            let mut insert = tx.prepare_cached(
                "INSERT OR REPLACE INTO events
                 (file,event_key,session,session_created,timestamp,model,tokens,is_turn)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            )?;
            scan_file(&path, root, size, |event| {
                insert.execute(params![
                    &name,
                    event.key,
                    event.session,
                    event.session_created,
                    event.timestamp,
                    event.model,
                    event.tokens,
                    event.is_turn
                ])?;
                Ok(())
            })?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO files(path,size,modified) VALUES (?1,?2,?3)",
            params![&name, size, modified],
        )?;
    }
    for path in previous.keys().filter(|p| !present.contains(*p)) {
        tx.execute("DELETE FROM events WHERE file = ?1", [path])?;
        tx.execute("DELETE FROM files WHERE path = ?1", [path])?;
    }
    tx.commit()?;

    // A fork carries its parent's entries with the original ids and timestamps.
    // Visit the oldest session first so copied requests count once, in their
    // originating session, even after the source has been archived or moved.
    let mut stmt = db.prepare(
        "SELECT event_key, session, timestamp, model, tokens, is_turn
         FROM events ORDER BY session_created, file, timestamp",
    )?;
    let mut rows = stmt.query([])?;
    let mut seen = HashSet::new();
    let mut days: BTreeMap<String, Day> = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let key: String = row.get(0)?;
        if !seen.insert(key) {
            continue;
        }
        let timestamp: i64 = row.get(2)?;
        let Some(date) = DateTime::<Utc>::from_timestamp_millis(timestamp) else {
            continue;
        };
        let day = days
            .entry(date.with_timezone(&Local).format("%Y-%m-%d").to_string())
            .or_default();
        day.sessions.insert(row.get::<_, String>(1)?);
        if row.get::<_, bool>(5)? {
            day.turns += 1;
            continue;
        }
        let tokens: Option<u64> = row.get(4)?;
        if let Some(tokens) = tokens {
            day.tokens = day
                .tokens
                .checked_add(tokens)
                .ok_or_else(|| anyhow::anyhow!("activity token total overflow"))?;
            day.known_requests += 1;
        } else {
            day.missing_requests += 1;
        }
        if let Some(model) = row.get::<_, Option<String>>(3)? {
            let entry = day.models.entry(model).or_default();
            *entry += tokens.unwrap_or(0);
        }
    }
    Ok((
        ActivityUsage {
            days: days
                .into_iter()
                .map(|(date, day)| ActivityDayUsage {
                    date,
                    tokens: (day.known_requests > 0 || day.missing_requests == 0)
                        .then_some(day.tokens),
                    missing_requests: day.missing_requests,
                    sessions: day.sessions.len() as u64,
                    turns: day.turns,
                    top_model: day
                        .models
                        .into_iter()
                        .max_by(|(ma, a), (mb, b)| a.cmp(b).then_with(|| mb.cmp(ma)))
                        .map(|(m, _)| m),
                })
                .collect(),
        },
        signatures,
    ))
}

#[derive(Default)]
struct Day {
    tokens: u64,
    known_requests: u64,
    missing_requests: u64,
    sessions: HashSet<String>,
    turns: u64,
    models: BTreeMap<String, u64>,
}

fn session_files(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    let buckets = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut files = Vec::new();
    for bucket in buckets {
        let bucket = bucket?;
        if !bucket.file_type()?.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(bucket.path())? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|e| e == "jsonl")
                && entry.file_type()?.is_file()
            {
                files.push(entry.path());
                let children = entry.path().with_extension("");
                if children.is_dir() {
                    collect_children(&children, &mut files)?;
                }
            }
        }
    }
    Ok(files)
}

fn collect_children(dir: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            collect_children(&entry.path(), files)?;
        } else if kind.is_file() && entry.path().extension().is_some_and(|e| e == "jsonl") {
            files.push(entry.path());
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type")]
    kind: String,
    id: Option<String>,
    timestamp: Option<Value>,
    message: Option<Message>,
    #[serde(rename = "customType")]
    custom_type: Option<String>,
    usage: Option<Value>,
    model: Option<String>,
    provider: Option<String>,
}
#[derive(Deserialize)]
struct Message {
    role: String,
    timestamp: Option<Value>,
    provider: Option<String>,
    model: Option<String>,
    usage: Option<Value>,
    #[serde(rename = "toolCallId")]
    tool_call_id: Option<String>,
    #[serde(rename = "toolName")]
    tool_name: Option<String>,
}
struct Event<'a> {
    key: String,
    session: &'a str,
    session_created: &'a str,
    timestamp: i64,
    model: Option<String>,
    tokens: Option<u64>,
    is_turn: bool,
}

fn scan_file(
    path: &Path,
    root: &Path,
    size: u64,
    mut emit: impl FnMut(Event<'_>) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    // Bound to the signature's snapshot; an appended partial record is retried
    // after its size/mtime changes. Reuse the line buffer, including for images.
    let mut reader = BufReader::with_capacity(256 * 1024, File::open(path)?.take(size));
    let mut line = Vec::new();
    let mut owner = path.to_path_buf();
    while owner.parent().and_then(Path::parent) != Some(root) {
        let Some(parent) = owner.parent() else {
            anyhow::bail!("session outside root");
        };
        let mut name = parent.as_os_str().to_os_string();
        name.push(".jsonl");
        owner = PathBuf::from(name);
    }
    let nested = owner != path;
    let header = super::parse::read_head(&owner)?;
    let session = header
        .as_ref()
        .map(|h| h.id.clone())
        .unwrap_or_else(|| owner.to_string_lossy().into_owned());
    let created = header.map(|h| h.created_at).unwrap_or_default();
    let mut line_number = 0;
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            break;
        }
        line_number += 1;
        // A final complete JSON record is valid even without a newline.
        // Deserialize accounting fields only; serde skips message text/images.
        let Ok(entry) = serde_json::from_slice::<Entry>(&line) else {
            continue;
        };
        if entry.kind == "session" {
            continue;
        }
        let is_skill =
            entry.kind == "custom_message" && entry.custom_type.as_deref() == Some("skill-prompt");
        let message = entry.message.as_ref();
        let metering = entry.kind == "model_usage";
        let role = if metering {
            "model_usage"
        } else if is_skill {
            "user"
        } else {
            if entry.kind != "message" {
                continue;
            }
            match message.map(|m| m.role.as_str()) {
                Some("assistant") => "assistant",
                Some("user") => "user",
                _ => continue,
            }
        };
        // A subagent's prompt is not a new user interaction. Legacy user-role
        // tool results likewise must not inflate the turn count.
        if role == "user"
            && (nested
                || message.is_some_and(|m| m.tool_call_id.is_some() || m.tool_name.is_some()))
        {
            continue;
        }
        let Some(timestamp) = message
            .and_then(|m| m.timestamp.as_ref())
            .and_then(parse_timestamp)
            .or_else(|| entry.timestamp.as_ref().and_then(parse_timestamp))
        else {
            continue;
        };
        if timestamp < 1_577_836_800_000 {
            continue;
        }
        let provider = message
            .and_then(|m| m.provider.as_deref())
            .or(entry.provider.as_deref())
            .unwrap_or("");
        let model = message
            .and_then(|m| m.model.as_deref())
            .or(entry.model.as_deref());
        let key = match entry.id {
            Some(id) => serde_json::to_string(&(role, id, timestamp, provider, model))?,
            None => format!("{}:{line_number}", path.display()),
        };
        let tokens = message
            .and_then(|m| m.usage.as_ref())
            .or(entry.usage.as_ref())
            .and_then(usage_tokens);
        let model = model.map(|m| {
            if provider.is_empty() || m.contains('/') {
                m.to_string()
            } else {
                format!("{provider}/{m}")
            }
        });
        emit(Event {
            key,
            session: &session,
            session_created: &created,
            timestamp,
            model,
            tokens,
            is_turn: role == "user",
        })?;
    }
    Ok(())
}

fn parse_timestamp(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        DateTime::parse_from_rfc3339(value.as_str()?)
            .ok()
            .map(|d| d.timestamp_millis())
    })
}

/// Upstream normalizeAssistantUsage: reported total wins; otherwise input +
/// output + cache read/write + orchestration. A wholly absent usage stays unknown.
fn usage_tokens(usage: &Value) -> Option<u64> {
    if let Some(total) = usage.get("totalTokens").and_then(Value::as_u64) {
        return (total <= i64::MAX as u64).then_some(total);
    }
    let keys = ["input", "output", "cacheRead", "cacheWrite"];
    if !keys.iter().any(|key| usage.get(*key).is_some()) {
        return None;
    }
    let mut total = 0u64;
    for key in keys {
        total = total.checked_add(match usage.get(key) {
            Some(v) => v.as_u64()?,
            None => 0,
        })?;
    }
    if let Some(orchestration) = usage.get("orchestration") {
        for key in ["input", "output", "cacheRead"] {
            total = total.checked_add(match orchestration.get(key) {
                Some(v) => v.as_u64()?,
                None => 0,
            })?;
        }
    }
    // SQLite stores signed integers; reject impossible values instead of wrapping.
    (total <= i64::MAX as u64).then_some(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (PathBuf, PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ompws-activity-{}", uuid::Uuid::new_v4()));
        let root = dir.join("sessions");
        let bucket = root.join("repo");
        std::fs::create_dir_all(&bucket).unwrap();
        (dir.clone(), root, dir.join("cache.sqlite"))
    }
    fn write(path: &Path, id: &str, created: &str, entries: &[Value]) {
        let mut body = format!(
            "{}\n",
            json!({"type":"session","id":id,"timestamp":created})
        );
        for entry in entries {
            body.push_str(&format!("{entry}\n"));
        }
        std::fs::write(path, body).unwrap();
    }
    fn request(id: &str, ts: &str, usage: Value) -> Value {
        json!({"type":"message","id":id,"timestamp":ts,"message":{"role":"assistant","provider":"test","model":"model","usage":usage}})
    }
    #[test]
    fn normalizes_totals_cache_and_unknown_usage() {
        assert_eq!(
            usage_tokens(&json!({"totalTokens":10,"input":5,"cacheRead":100})),
            Some(10)
        );
        assert_eq!(
            usage_tokens(
                &json!({"input":2,"output":3,"cacheRead":4,"cacheWrite":5,"orchestration":{"input":6,"output":7,"cacheRead":8}})
            ),
            Some(35)
        );
        assert_eq!(usage_tokens(&json!({"input":0,"output":0})), Some(0));
        assert_eq!(usage_tokens(&json!({})), None);
        assert_eq!(usage_tokens(&json!({"input":-1})), None);
    }
    #[test]
    fn indexes_request_dates_deduplicates_forks_and_replaces_changes() {
        let (dir, root, cache) = fixture();
        let first = root.join("repo/a.jsonl");
        let second = root.join("repo/b.jsonl");
        let ts = "2026-10-01T12:00:00Z";
        let local_day = DateTime::parse_from_rfc3339(ts)
            .unwrap()
            .with_timezone(&Local)
            .format("%Y-%m-%d")
            .to_string();
        let user = json!({"type":"message","id":"u1","timestamp":ts,"message":{"role":"user"}});
        let one = request("a1", ts, json!({"input":100,"output":20,"cacheRead":80}));
        write(
            &first,
            "original",
            "2026-10-01T00:00:00Z",
            &[user.clone(), one.clone()],
        );
        write(
            &second,
            "fork",
            "2026-10-02T00:00:00Z",
            &[
                user,
                one,
                request("a2", "2026-10-03T12:00:00Z", json!({"totalTokens":50})),
            ],
        );
        let usage = load_from(&root, &cache).unwrap();
        let day = usage.days.iter().find(|d| d.date == local_day).unwrap();
        assert_eq!((day.tokens, day.sessions, day.turns), (Some(200), 1, 1));
        assert_eq!(day.top_model.as_deref(), Some("test/model"));
        assert_eq!(
            usage.days.iter().map(|d| d.tokens.unwrap()).sum::<u64>(),
            250
        );
        // Opening a fresh connection must reuse the same persisted accounting.
        assert_eq!(
            load_from(&root, &cache)
                .unwrap()
                .days
                .iter()
                .map(|d| d.tokens.unwrap())
                .sum::<u64>(),
            250
        );
        write(
            &second,
            "fork",
            "2026-10-02T00:00:00Z",
            &[request(
                "a2",
                "2026-10-03T12:00:00Z",
                json!({"totalTokens":75}),
            )],
        );
        assert_eq!(
            load_from(&root, &cache)
                .unwrap()
                .days
                .iter()
                .map(|d| d.tokens.unwrap())
                .sum::<u64>(),
            275
        );
        std::fs::remove_file(first).unwrap();
        let usage = load_from(&root, &cache).unwrap();
        assert_eq!(usage.days.len(), 1);
        assert_eq!(usage.days[0].tokens, Some(75));
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn missing_usage_does_not_become_zero_and_partial_append_is_retried() {
        use std::io::Write;
        let (dir, root, cache) = fixture();
        let file = root.join("repo/a.jsonl");
        write(
            &file,
            "s",
            "2026-10-01T00:00:00Z",
            &[request("a", "2026-10-01T12:00:00Z", Value::Null)],
        );
        assert_eq!(load_from(&root, &cache).unwrap().days[0].tokens, None);
        let entry = format!(
            "{}\n",
            request("b", "2026-10-02T12:00:00Z", json!({"totalTokens":42}))
        );
        let mut out = std::fs::OpenOptions::new()
            .append(true)
            .open(&file)
            .unwrap();
        out.write_all(&entry.as_bytes()[..20]).unwrap();
        assert_eq!(load_from(&root, &cache).unwrap().days.len(), 1);
        out.write_all(&entry.as_bytes()[20..]).unwrap();
        let usage = load_from(&root, &cache).unwrap();
        assert_eq!(usage.days.len(), 2);
        assert_eq!(usage.days[1].tokens, Some(42));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn includes_child_and_metered_usage_without_inflating_user_turns() {
        let (dir, root, cache) = fixture();
        let main = root.join("repo/a.test.jsonl");
        let child_dir = main.with_extension("");
        std::fs::create_dir_all(&child_dir).unwrap();
        let ts = "2026-10-01T12:00:00Z";
        let user = json!({"type":"message","id":"user","timestamp":ts,"message":{"role":"user"}});
        let tool = json!({"type":"message","id":"tool","timestamp":ts,"message":{"role":"user","toolCallId":"call"}});
        let metered = json!({"type":"model_usage","id":"meter","timestamp":ts,"provider":"test","model":"meter","usage":{"totalTokens":400}});
        write(
            &main,
            "main",
            ts,
            &[
                user.clone(),
                tool,
                metered,
                request("known", ts, json!({"totalTokens":100})),
                request("missing", ts, Value::Null),
            ],
        );
        write(
            &child_dir.join("agent.jsonl"),
            "child",
            ts,
            &[
                user,
                request("child-answer", ts, json!({"totalTokens":200})),
            ],
        );
        let usage = load_from(&root, &cache).unwrap();
        assert_eq!(usage.days.len(), 1);
        let day = &usage.days[0];
        assert_eq!(
            (day.tokens, day.missing_requests, day.sessions, day.turns),
            (Some(700), 1, 1, 1)
        );
        assert_eq!(day.top_model.as_deref(), Some("test/meter"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn uses_request_time_and_accepts_complete_final_record() {
        let (dir, root, cache) = fixture();
        let file = root.join("repo/a.jsonl");
        let actual = 1_792_000_000_000i64;
        let mut event = request("request", "2026-01-01T12:00:00Z", json!({"totalTokens":42}));
        event["message"]["timestamp"] = json!(actual);
        write(&file, "main", "2026-01-01T00:00:00Z", &[]);
        use std::io::Write;
        std::fs::OpenOptions::new()
            .append(true)
            .open(&file)
            .unwrap()
            .write_all(event.to_string().as_bytes())
            .unwrap();
        let usage = load_from(&root, &cache).unwrap();
        let expected = DateTime::<Utc>::from_timestamp_millis(actual)
            .unwrap()
            .with_timezone(&Local)
            .format("%Y-%m-%d")
            .to_string();
        assert_eq!(usage.days[0].date, expected);
        assert_eq!(usage.days[0].tokens, Some(42));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
