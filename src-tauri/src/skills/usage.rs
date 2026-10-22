//! Skill usage statistics: scans `~/.omp/agent/sessions/**/*.jsonl` for
//! model triggers (`read` toolCall with `path":"skill://NAME`) and user
//! triggers (`/skill:NAME` prompts), aggregated into a `SkillUsageReport`.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, SecondsFormat, Utc};

use crate::contracts::{SkillUsage, SkillUsageReport};

/// Defensive per-line cap; JSONL lines beyond this are skipped.
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
/// Safety bound for recursive directory walking.
const MAX_WALK_DEPTH: usize = 8;

/// Per-file scan result cached in the process: file size, mtime, and the
/// extracted `(skill name, epoch_ms)` triggers.
type Triggers = Vec<(String, i64)>;
type FileCache = HashMap<PathBuf, (u64, SystemTime, Triggers)>;

static FILE_CACHE: OnceLock<Mutex<FileCache>> = OnceLock::new();

fn file_cache() -> &'static Mutex<FileCache> {
    FILE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_cache() -> std::sync::MutexGuard<'static, FileCache> {
    file_cache().lock().unwrap_or_else(|e| e.into_inner())
}

/// Recursively collects `*.jsonl` files under `dir` (subagent sessions live in
/// nested folders whose names may contain spaces). Symlinked dirs are not
/// followed to avoid cycles.
fn collect_jsonl_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_WALK_DEPTH {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            collect_jsonl_files(&path, depth + 1, out);
        } else if ft.is_file() && path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(path);
        }
    }
}

/// Skill name chars after `skill://` or `/skill:` end at the first of
/// `"` `/` `#` `?` `:` or whitespace. Returns `None` for empty/`...` names.
fn skill_name_after_marker(s: &str, marker: &str) -> Option<String> {
    let start = s.find(marker)? + marker.len();
    let rest = &s[start..];
    let end = rest
        .find(|c: char| {
            c == '"' || c == '/' || c == '#' || c == '?' || c == ':' || c.is_whitespace()
        })
        .unwrap_or(rest.len());
    let name = &rest[..end];
    if name.is_empty() || name == "..." {
        None
    } else {
        Some(name.to_string())
    }
}

/// Best-effort `skill://` extraction inside a raw (unparsed) arguments string:
/// only counts when a `path` key appears just before the URI.
fn skill_uri_in_raw(s: &str) -> Option<String> {
    let pos = s.find("skill://")?;
    let before = &s[..pos];
    let tail = &before[before.len().saturating_sub(40)..];
    if tail.contains("path") {
        skill_name_after_marker(s, "skill://")
    } else {
        None
    }
}

/// Extracts a `read` toolCall's skill name from its `arguments` value.
fn arguments_skill_name(args: &serde_json::Value) -> Option<String> {
    match args {
        serde_json::Value::Object(map) => map
            .get("path")
            .and_then(|v| v.as_str())
            .filter(|p| p.starts_with("skill://"))
            .and_then(|p| skill_name_after_marker(p, "skill://")),
        serde_json::Value::String(s) => skill_uri_in_raw(s),
        _ => None,
    }
}

/// Recursively finds `{"type":"toolCall","name":"read",...}` objects carrying a
/// `skill://` path anywhere in the JSON tree (toolCalls nest inside
/// `message.content[]`). Each such tool call counts once.
fn collect_tool_triggers(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(map) => {
            let is_skill_read = map
                .get("type")
                .and_then(|t| t.as_str())
                .map(|t| t == "toolCall")
                .unwrap_or(false)
                && map
                    .get("name")
                    .and_then(|n| n.as_str())
                    .map(|n| n == "read")
                    .unwrap_or(false);
            if is_skill_read {
                if let Some(args) = map.get("arguments") {
                    if let Some(name) = arguments_skill_name(args) {
                        out.push(name);
                    }
                }
            }
            for val in map.values() {
                collect_tool_triggers(val, out);
            }
        }
        serde_json::Value::Array(items) => {
            for val in items {
                collect_tool_triggers(val, out);
            }
        }
        _ => {}
    }
}

/// Extracts the user-invocation skill name from a `/skill:NAME` prompt held in
/// `details.prompt` (real shape) or a top-level `prompt` field.
fn user_trigger_name(v: &serde_json::Value) -> Option<String> {
    let prompts = [
        v.get("details")
            .and_then(|d| d.get("prompt"))
            .and_then(|p| p.as_str()),
        v.get("prompt").and_then(|p| p.as_str()),
    ];
    for prompt in prompts.into_iter().flatten() {
        if let Some(name) = prompt
            .find("/skill:")
            .map(|i| &prompt[i + "/skill:".len()..])
            .map(|rest| {
                let end = rest
                    .find(|c: char| {
                        c == '"'
                            || c == '/'
                            || c == '#'
                            || c == '?'
                            || c == ':'
                            || c.is_whitespace()
                    })
                    .unwrap_or(rest.len());
                &rest[..end]
            })
            .filter(|n| !n.is_empty() && *n != "...")
        {
            return Some(name.to_string());
        }
    }
    None
}

/// Classifies one JSONL line. Returns `(names, timestamp_epoch_ms)` where
/// `names` may hold several skill names from one line (counted once each).
/// The `skill://`/`/skill:` substring prefilter keeps parsing rare.
pub(crate) fn classify_line(line: &str, fallback_ms: i64) -> Option<(Vec<String>, i64)> {
    if !line.contains("skill://") && !line.contains("/skill:") {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let ts_ms = v
        .get("timestamp")
        .and_then(|t| t.as_str())
        .and_then(parse_iso_ms)
        .unwrap_or(fallback_ms);

    let mut names = Vec::new();
    if line.contains("\"type\":\"toolCall\"") {
        collect_tool_triggers(&v, &mut names);
    }
    if line.contains("/skill:") {
        if let Some(name) = user_trigger_name(&v) {
            names.push(name);
        }
    }
    if names.is_empty() {
        None
    } else {
        Some((names, ts_ms))
    }
}

enum LineRead {
    Line(String),
    /// Line exceeded MAX_LINE_BYTES; remainder was drained.
    TooLong,
    Eof,
}

/// Reads one line, bounded at MAX_LINE_BYTES; overlong lines are drained.
fn next_line(reader: &mut BufReader<File>) -> LineRead {
    let mut buf = Vec::new();
    let n = match reader
        .by_ref()
        .take(MAX_LINE_BYTES as u64 + 1)
        .read_until(b'\n', &mut buf)
    {
        Ok(n) => n,
        Err(_) => return LineRead::Eof,
    };
    if n == 0 {
        return LineRead::Eof;
    }
    if !buf.ends_with(b"\n") && buf.len() > MAX_LINE_BYTES {
        // Overlong line: consume the rest so we resync on the next newline.
        let mut sink = Vec::new();
        let _ = reader.read_until(b'\n', &mut sink);
        return LineRead::TooLong;
    }
    match String::from_utf8(buf) {
        Ok(s) => LineRead::Line(s),
        Err(e) => LineRead::Line(String::from_utf8_lossy(e.as_bytes()).into_owned()),
    }
}

/// Scans one session file, returning `(skill name, epoch_ms)` trigger pairs.
fn scan_file(path: &Path, mtime_ms: i64) -> Vec<(String, i64)> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut out = Vec::new();
    loop {
        match next_line(&mut reader) {
            LineRead::Line(line) => {
                if let Some((names, ts)) = classify_line(&line, mtime_ms) {
                    for name in names {
                        out.push((name, ts));
                    }
                }
            }
            LineRead::TooLong => continue,
            LineRead::Eof => break,
        }
    }
    out
}

fn system_time_ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_iso_ms(s: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}

fn ms_to_iso(ms: i64) -> Option<String> {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339_opts(SecondsFormat::Millis, true))
}

/// Scans all session files under `base` and aggregates per-skill usage over
/// the last `days` days. File-level results are cached by (size, mtime).
fn scan_sessions(base: &Path, days: u32) -> SkillUsageReport {
    let now = SystemTime::now();
    let cutoff = now
        .checked_sub(Duration::from_secs(days as u64 * 86_400))
        .unwrap_or(UNIX_EPOCH);
    let cutoff_ms = system_time_ms(cutoff);

    let mut files = Vec::new();
    collect_jsonl_files(base, 0, &mut files);

    // Stat candidates first; only files touched inside the window are read.
    let mut fresh: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    for path in files {
        if let Ok(meta) = fs::metadata(&path) {
            if let Ok(mtime) = meta.modified() {
                if mtime >= cutoff {
                    fresh.push((path, meta.len(), mtime));
                }
            }
        }
    }

    let mut scanned_files = 0u64;
    let mut per_skill: HashMap<String, (u64, i64)> = HashMap::new();

    {
        // Split into cache hits and misses; scan misses in parallel without
        // holding the cache lock.
        let mut results: Vec<Vec<(String, i64)>> = Vec::with_capacity(fresh.len());
        let mut misses: Vec<usize> = Vec::new();
        {
            let mut cache = lock_cache();
            // Drop entries for vanished files.
            let live: std::collections::HashSet<&Path> =
                fresh.iter().map(|(p, _, _)| p.as_path()).collect();
            cache.retain(|p, _| live.contains(p.as_path()));
            for (i, (path, size, mtime)) in fresh.iter().enumerate() {
                match cache.get(path).filter(|(s, m, _)| s == size && m == mtime) {
                    Some((_, _, t)) => results.push(t.clone()),
                    None => {
                        results.push(Vec::new());
                        misses.push(i);
                    }
                }
            }
        }

        if !misses.is_empty() {
            let workers = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
                .min(misses.len());
            let next = std::sync::atomic::AtomicUsize::new(0);
            let scanned: Mutex<Vec<(usize, Triggers)>> = Mutex::new(Vec::new());
            std::thread::scope(|scope| {
                for _ in 0..workers {
                    scope.spawn(|| loop {
                        let k = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(&i) = misses.get(k) else { break };
                        let (path, _, mtime) = &fresh[i];
                        let t = scan_file(path, system_time_ms(*mtime));
                        scanned
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .push((i, t));
                    });
                }
            });
            let mut cache = lock_cache();
            for (i, t) in scanned.into_inner().unwrap_or_else(|e| e.into_inner()) {
                let (path, size, mtime) = &fresh[i];
                cache.insert(path.clone(), (*size, *mtime, t.clone()));
                results[i] = t;
            }
        }

        for triggers in results {
            scanned_files += 1;
            for (name, ts_ms) in triggers {
                if ts_ms < cutoff_ms {
                    continue;
                }
                let entry = per_skill.entry(name).or_insert((0, i64::MIN));
                entry.0 += 1;
                if ts_ms > entry.1 {
                    entry.1 = ts_ms;
                }
            }
        }
    }

    let mut usage: Vec<SkillUsage> = per_skill
        .into_iter()
        .map(|(name, (count, last_ms))| SkillUsage {
            name,
            count,
            last_used_at: ms_to_iso(last_ms),
        })
        .collect();
    usage.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));

    let total_triggers = usage.iter().map(|u| u.count).sum();
    SkillUsageReport {
        days,
        total_triggers,
        scanned_files,
        usage,
    }
}

/// Pre-fills the per-file cache in the background so the first visit to the
/// Skills page does not wait for a cold scan.
pub fn warm_up(days: u32) {
    std::thread::spawn(move || {
        if let Some(base) = dirs::home_dir().map(|h| h.join(".omp").join("agent").join("sessions"))
        {
            let _ = scan_sessions(&base, days);
        }
    });
}

/// Tauri command `skills_usage`: per-skill trigger counts over `days` days.
#[tauri::command]
pub async fn skills_usage(days: u32) -> Result<SkillUsageReport, String> {
    let base = dirs::home_dir()
        .map(|h| h.join(".omp").join("agent").join("sessions"))
        .ok_or_else(|| "无法定位主目录".to_string())?;

    let report = tokio::task::spawn_blocking(move || scan_sessions(&base, days))
        .await
        .map_err(|e| format!("技能用量扫描失败：{e}"))?;
    Ok(report)
}

#[cfg(test)]
pub(crate) fn scan_sessions_for_test(base: &Path, days: u32) -> SkillUsageReport {
    scan_sessions(base, days)
}
