//! Per-turn checkpoints: parse `omp-workspace.turn-checkpoint` entries from
//! session .jsonl files, list them per session/worktree (enriched with
//! `restorable`/`undone` from the repo's hidden `refs/omp/*`), and undo any
//! turn — the target plus every later non-undone turn cascade newest-first —
//! restoring files, rolling back HEAD while each turn's commits are still on
//! top, and writing `refs/omp/undone/<sid>/<turnId>` last per turn.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::SystemTime;

use parking_lot::Mutex;
use serde_json::Value;

use super::cmd::git_ok;
use super::worktree;
use crate::contracts::{TurnCheckpoint, TurnFile, TurnUndoResult};

const CHECKPOINT_TYPE: &str = "omp-workspace.turn-checkpoint";
/// Shown when the turn's commits are no longer on top of HEAD.
const HEAD_WARNING: &str = "这一轮之后又有新的存档，版本历史没有回退，只恢复了文件";

/// `sid` = session id with every char outside `[A-Za-z0-9._-]` → `_`
/// (same rule as the extension; contract "Hidden refs").
fn sanitize_sid(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn turn_ref(sid: &str, turn_id: &str, which: &str) -> String {
    format!("refs/omp/turns/{sid}/{turn_id}/{which}")
}

fn undone_ref(sid: &str, turn_id: &str) -> String {
    format!("refs/omp/undone/{sid}/{turn_id}")
}

/// `path` must be relative and unable to escape the worktree.
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

/// Parse one `custom` entry into a checkpoint; None when malformed or unrelated.
fn parse_checkpoint(v: &Value) -> Option<TurnCheckpoint> {
    if v.get("type").and_then(Value::as_str) != Some("custom")
        || v.get("customType").and_then(Value::as_str) != Some(CHECKPOINT_TYPE)
    {
        return None;
    }
    let d = v.get("data")?;
    if d.get("v").and_then(Value::as_u64) != Some(1) {
        return None;
    }
    let turn_id = str_field(d, "turnId").filter(|s| !s.is_empty())?;
    let before = str_field(d, "before").filter(|s| !s.is_empty())?;
    let after = str_field(d, "after").filter(|s| !s.is_empty())?;
    let files = d
        .get("files")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    let path = str_field(f, "path")?;
                    let status = str_field(f, "status")?;
                    (matches!(status.as_str(), "A" | "M" | "D") && safe_path(&path))
                        .then_some(TurnFile { path, status })
                })
                .collect()
        })
        .unwrap_or_default();
    let commits = d
        .get("commits")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    Some(TurnCheckpoint {
        turn_id,
        session_id: str_field(d, "sessionId").unwrap_or_default(),
        user_item_id: str_field(d, "userItemId"),
        prompt: str_field(d, "prompt").unwrap_or_default(),
        before,
        after,
        head_before: str_field(d, "headBefore"),
        head_after: str_field(d, "headAfter"),
        commits,
        files,
        ended_at: str_field(d, "endedAt").unwrap_or_default(),
        restorable: false,
        undone: false,
    })
}
#[derive(Clone)]
struct CacheEntry {
    mtime: SystemTime,
    size: u64,
    parsed: Arc<ParsedSession>,
}

// LazyLock is stable since 1.80 while the declared MSRV is 1.77.2; the pinned
// toolchain is newer, so keep the declaration-site initializer and scope the
// lint to this static.
#[allow(clippy::incompatible_msrv)]
static SESSION_CACHE: LazyLock<Mutex<HashMap<PathBuf, CacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct ParsedSession {
    /// `cwd` from the `type:"session"` header entry.
    cwd: Option<String>,
    /// Session id from the header (fallback for data.sessionId).
    id: String,
    turns: Vec<TurnCheckpoint>,
}

/// Read a session .jsonl; malformed lines/entries are skipped.
/// Results are cached in memory keyed by (mtime, size) to avoid re-reading
/// and re-parsing large historical session files repeatedly.
fn parse_file(path: &Path) -> Result<Arc<ParsedSession>, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取会话记录失败: {e}"))?;
    let mtime = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let size = metadata.len();

    // Check in-memory cache
    {
        let cache = SESSION_CACHE.lock();
        if let Some(entry) = cache.get(path) {
            if entry.mtime == mtime && entry.size == size {
                return Ok(entry.parsed.clone());
            }
        }
    }

    let text = std::fs::read_to_string(path).map_err(|e| format!("读取会话记录失败: {e}"))?;
    let mut parsed = ParsedSession {
        cwd: None,
        id: String::new(),
        turns: Vec::new(),
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Fast pre-filter: skip lines that cannot be a checkpoint or session header,
        // avoiding expensive serde_json::from_str parsing on message/tool output rows.
        if !line.contains(CHECKPOINT_TYPE)
            && (parsed.cwd.is_some() || !line.contains("\"session\""))
        {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match v.get("type").and_then(Value::as_str) {
            Some("session") => {
                if parsed.cwd.is_none() {
                    parsed.cwd = str_field(&v, "cwd");
                }
                if parsed.id.is_empty() {
                    parsed.id = str_field(&v, "id").unwrap_or_default();
                }
            }
            _ => {
                if let Some(t) = parse_checkpoint(&v) {
                    parsed.turns.push(t);
                }
            }
        }
    }
    for t in &mut parsed.turns {
        if t.session_id.is_empty() {
            t.session_id = parsed.id.clone();
        }
    }

    let parsed_arc = Arc::new(parsed);
    {
        let mut cache = SESSION_CACHE.lock();
        if cache.len() > 1000 {
            cache.clear();
        }
        cache.insert(
            path.to_path_buf(),
            CacheEntry {
                mtime,
                size,
                parsed: parsed_arc.clone(),
            },
        );
    }
    Ok(parsed_arc)
}

#[cfg(test)]
pub(crate) fn clear_session_cache_for_test() {
    SESSION_CACHE.lock().clear();
}

/// All `refs/omp/**` refs of the repo containing `dir` (empty on failure).
fn omp_refs(dir: &Path) -> HashSet<String> {
    git_ok(dir, &["for-each-ref", "--format=%(refname)", "refs/omp/"])
        .map(|t| t.lines().map(String::from).collect())
        .unwrap_or_default()
}

/// Fill `restorable` (both snapshot refs exist) and `undone` (undone ref exists).
fn enrich(dir: &Path, turns: &mut [TurnCheckpoint]) {
    if turns.is_empty() {
        return;
    }
    let refs = omp_refs(dir);
    for t in turns.iter_mut() {
        let sid = sanitize_sid(&t.session_id);
        t.restorable = refs.contains(&turn_ref(&sid, &t.turn_id, "before"))
            && refs.contains(&turn_ref(&sid, &t.turn_id, "after"));
        t.undone = refs.contains(&undone_ref(&sid, &t.turn_id));
    }
}

/// `git_session_turns`: checkpoints of one session file, oldest first.
/// Ref enrichment happens in the repo of the session's own cwd.
pub fn session_turns(session_file: &Path) -> Result<Vec<TurnCheckpoint>, String> {
    let parsed = parse_file(session_file)?;
    let mut turns = parsed.turns.clone();
    sort_turns(&mut turns);
    if let Some(cwd) = parsed.cwd.as_deref().filter(|c| !c.is_empty()) {
        enrich(Path::new(cwd), &mut turns);
    }
    Ok(turns)
}

/// Merge checkpoints from several session files of one worktree, oldest first.
fn collect_turns(files: &[PathBuf], repo_dir: &Path) -> Vec<TurnCheckpoint> {
    let mut out = Vec::new();
    for f in files {
        if let Ok(parsed) = parse_file(f) {
            out.extend(parsed.turns.iter().cloned());
        }
    }
    sort_turns(&mut out);
    enrich(repo_dir, &mut out);
    out
}

/// Stable oldest-first order: `endedAt`, then `turnId` as tiebreak.
fn sort_turns(turns: &mut [TurnCheckpoint]) {
    turns.sort_by(|a, b| {
        a.ended_at
            .cmp(&b.ended_at)
            .then_with(|| a.turn_id.cmp(&b.turn_id))
    });
}

/// `git_worktree_turns`: checkpoints of every session assigned to the
/// (deepest) worktree containing `cwd`, oldest first by `endedAt`.
/// Efficient: resolves worktree paths and sessions directly without
/// triggering redundant `git status` checks across all worktrees.
pub fn worktree_turns(
    cwd: &Path,
    sessions: &[(String, String)],
) -> Result<Vec<TurnCheckpoint>, String> {
    let Some(info) = worktree::repo_info(cwd) else {
        return Ok(Vec::new());
    };
    let dir = worktree::canon(cwd);
    let main_root = info.main_root();
    let entries = worktree::list_entries(&main_root)?;
    let paths: Vec<PathBuf> = entries
        .iter()
        .map(|e| worktree::canon(Path::new(&e.path)))
        .collect();
    let Some(entry_path) = paths
        .iter()
        .filter(|p| worktree::is_inside(&dir, p))
        .max_by_key(|p| p.as_os_str().len())
    else {
        return Ok(Vec::new());
    };
    let session_ids = worktree::sessions_for_path(entry_path, &paths, sessions);
    let files: Vec<PathBuf> = session_ids
        .iter()
        .filter_map(|id| crate::catalog::file_of(id))
        .collect();
    Ok(collect_turns(&files, &dir))
}

/// Blob sha of the file as it currently is on disk; None when absent, Some("")
/// when present but not a regular file (never matches a blob sha).
fn worktree_blob(dir: &Path, path: &str) -> Option<String> {
    let meta = std::fs::symlink_metadata(dir.join(path)).ok()?;
    if !meta.is_file() {
        return Some(String::new());
    }
    git_ok(dir, &["hash-object", "--", path])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Blob sha of `path` inside `commit`; None when the path is absent there.
fn blob_at(dir: &Path, commit: &str, path: &str) -> Option<String> {
    git_ok(
        dir,
        &["rev-parse", "-q", "--verify", &format!("{commit}:{path}")],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
}

fn head(dir: &Path) -> Option<String> {
    git_ok(dir, &["rev-parse", "--verify", "-q", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `git_undo_turn`: roll the workspace back to its state before `turn_id`
/// started. That means the target turn AND every later non-undone turn of the
/// session are undone, newest first (a cascade). Per turn: reset HEAD to
/// `head_before` only while it still equals `head_after`, restore the turn's
/// files from their `before` snapshot (created files deleted), then write
/// `refs/omp/undone/<sid>/<turnId>`. `force` skips the post-turn-edit
/// conflict check; without it a non-empty `conflicts` is returned and nothing
/// is written. The whole cascade is pre-flighted before the first write:
/// every non-undone turn after the target must be `restorable`.
pub fn undo_turn(
    cwd: &Path,
    session_file: &Path,
    turn_id: &str,
    force: bool,
) -> Result<TurnUndoResult, String> {
    let parsed = parse_file(session_file)?;
    let mut turns = parsed.turns.clone();
    sort_turns(&mut turns);
    enrich(cwd, &mut turns);
    let Some(idx) = turns.iter().position(|t| t.turn_id == turn_id) else {
        return Err("找不到这一轮".into());
    };
    if turns[idx].undone {
        return Err("这一轮已经撤回过了".into());
    }
    // Cascade: target + every later non-undone turn, processed newest first.
    let cascade: Vec<&TurnCheckpoint> = turns[idx..].iter().filter(|t| !t.undone).rev().collect();

    // Pre-flight (before ANY write): no turn in the cascade may be crossed
    // when its snapshots are gone — a missing checkpoint means the workspace
    // could not be returned to the state before the target started.
    for t in &cascade {
        if !t.restorable {
            let name = if t.prompt.is_empty() {
                t.turn_id.clone()
            } else {
                t.prompt.clone()
            };
            return Err(if t.turn_id == turn_id {
                "这一轮的存档已失效，无法撤回".into()
            } else {
                format!("无法跨过「{name}」撤回更早的轮次：这一轮的存档已失效")
            });
        }
    }

    // Conflict pre-flight: a file conflicts when its current worktree blob
    // differs from the `after` snapshot of the NEWEST cascaded turn that
    // touched it (i.e. it was edited after that turn ended).
    let mut expected: HashMap<&str, &str> = HashMap::new();
    for t in &cascade {
        for f in &t.files {
            expected.entry(f.path.as_str()).or_insert(t.after.as_str());
        }
    }
    let mut conflicts: Vec<String> = expected
        .iter()
        .filter(|(path, after)| {
            worktree_blob(cwd, path).as_deref() != blob_at(cwd, after, path).as_deref()
        })
        .map(|(path, _)| (*path).to_string())
        .collect();
    conflicts.sort();
    if !conflicts.is_empty() && !force {
        return Ok(TurnUndoResult {
            conflicts,
            ..Default::default()
        });
    }

    let mut result = TurnUndoResult::default();
    let mut restored: Vec<String> = Vec::new();
    let mut deleted: Vec<String> = Vec::new();
    let mut undone_count = 0usize;

    for t in cascade {
        if let Err(e) = undo_one(cwd, t, &mut result, &mut restored, &mut deleted) {
            return Err(format!("已成功撤回 {undone_count} 轮后失败: {e}"));
        }
        undone_count += 1;
    }

    // Report each path once, under the OLDEST cascaded action that touched it
    // (the last one that ran) — that is the state the file ends up in.
    restored.sort();
    restored.dedup();
    deleted.sort();
    deleted.dedup();
    let deleted_set: HashSet<&str> = deleted.iter().map(String::as_str).collect();
    restored.retain(|p| !deleted_set.contains(p.as_str()));
    result.restored = restored;
    result.deleted = deleted;
    result.turns_undone = undone_count;
    Ok(result)
}

/// One cascade step: reset HEAD only while this turn's commits are still on
/// top, restore its files from `before` (created files deleted), then write
/// the undone ref last — only after its files were restored.
fn undo_one(
    cwd: &Path,
    t: &TurnCheckpoint,
    result: &mut TurnUndoResult,
    restored: &mut Vec<String>,
    deleted: &mut Vec<String>,
) -> Result<(), String> {
    if !t.commits.is_empty() {
        let now = head(cwd);
        if now.is_some() && now == t.head_after {
            if let Some(base) = &t.head_before {
                git_ok(cwd, &["reset", "--mixed", base])
                    .map_err(|e| format!("回退版本历史失败: {e}"))?;
                result.head_reset = true;
            } else {
                result.warning = Some(HEAD_WARNING.into());
            }
        } else {
            result.warning = Some(HEAD_WARNING.into());
        }
    }

    // Files: only the turn's files are touched. `restore --worktree` never
    // touches the real index; created files are deleted from disk.
    for f in &t.files {
        if f.status == "A" {
            match std::fs::remove_file(cwd.join(&f.path)) {
                Ok(()) => deleted.push(f.path.clone()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("删除 {} 失败: {e}", f.path)),
            }
        } else {
            git_ok(
                cwd,
                &[
                    "restore",
                    &format!("--source={}", t.before),
                    "--worktree",
                    "--",
                    &f.path,
                ],
            )
            .map_err(|e| format!("恢复 {} 失败: {e}", f.path))?;
            restored.push(f.path.clone());
        }
    }

    let sid = sanitize_sid(&t.session_id);
    git_ok(
        cwd,
        &["update-ref", &undone_ref(&sid, &t.turn_id), &t.before],
    )
    .map_err(|e| format!("标记撤回失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::cmd::{git_cmd, run, GIT_TIMEOUT};
    use serde_json::json;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = PathBuf::from(format!(
            "/tmp/ompws-test-c/turns-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn temp_repo(tag: &str) -> PathBuf {
        let dir = temp_dir(tag);
        git_ok(&dir, &["init", "-q", "-b", "main"]).unwrap();
        git_ok(&dir, &["config", "user.name", "Test"]).unwrap();
        git_ok(&dir, &["config", "user.email", "t@example.com"]).unwrap();
        git_ok(&dir, &["config", "commit.gpgsign", "false"]).unwrap();
        dir
    }

    fn g(dir: &Path, args: &[&str]) -> String {
        git_ok(dir, args).unwrap().trim().to_string()
    }

    fn write(dir: &Path, file: &str, content: &str) {
        let p = dir.join(file);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, content).unwrap();
    }

    /// Whole-worktree snapshot commit via a temp index — same plumbing the
    /// extension uses; the real index is never touched.
    fn snap(dir: &Path, msg: &str) -> String {
        let idx = temp_dir("idx").join("index");
        let run_idx = |args: &[&str]| {
            let mut c = git_cmd(dir);
            c.env("GIT_INDEX_FILE", &idx).args(args);
            let out = run(c, GIT_TIMEOUT).unwrap();
            assert!(out.ok(), "{args:?}: {}", out.err_msg());
            out.text()
        };
        let head = head(dir);
        if let Some(h) = &head {
            run_idx(&["read-tree", h]);
        }
        run_idx(&["add", "-A"]);
        let tree = run_idx(&["write-tree"]).trim().to_string();
        let mut args = vec!["commit-tree".to_string(), tree];
        if let Some(h) = &head {
            args.push("-p".into());
            args.push(h.clone());
        }
        args.push("-m".into());
        args.push(msg.into());
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let sha = g(dir, &refs);
        let _ = std::fs::remove_file(&idx);
        sha
    }

    fn refs(dir: &Path, sid: &str, turn_id: &str, before: &str, after: &str) {
        g(
            dir,
            &["update-ref", &turn_ref(sid, turn_id, "before"), before],
        );
        g(
            dir,
            &["update-ref", &turn_ref(sid, turn_id, "after"), after],
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn entry(
        sid: &str,
        turn_id: &str,
        prompt: &str,
        before: &str,
        after: &str,
        head_before: Option<&str>,
        head_after: Option<&str>,
        commits: &[&str],
        files: &[(&str, &str)],
        ended_at: &str,
    ) -> String {
        json!({
            "type": "custom",
            "id": format!("e-{turn_id}"),
            "customType": CHECKPOINT_TYPE,
            "data": {
                "v": 1,
                "turnId": turn_id,
                "sessionId": sid,
                "userItemId": "u1",
                "prompt": prompt,
                "before": before,
                "after": after,
                "headBefore": head_before,
                "headAfter": head_after,
                "commits": commits,
                "files": files
                    .iter()
                    .map(|(p, s)| json!({"path": p, "status": s}))
                    .collect::<Vec<_>>(),
                "endedAt": ended_at,
            }
        })
        .to_string()
    }

    fn session_file(dir: &Path, repo: &Path, sid: &str, lines: &[String]) -> PathBuf {
        let file = dir.join(format!("{sid}.jsonl"));
        let header = json!({
            "type": "session",
            "version": 3,
            "id": sid,
            "timestamp": "2026-09-29T00:00:00Z",
            "cwd": repo.to_string_lossy(),
        })
        .to_string();
        let body = std::iter::once(header)
            .chain(lines.iter().cloned())
            .collect::<Vec<_>>()
            .join("\n");
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&file, body).unwrap();
        file
    }

    /// Turn that modified `mod.txt` m1→m2, deleted `del.txt`, created `new.txt`;
    /// returns (before, after, files-entry).
    fn make_turn(repo: &Path, sid: &str, turn_id: &str, ended: &str) -> (String, String, String) {
        let before = snap(repo, &format!("{turn_id} before"));
        write(repo, "mod.txt", "m2\n");
        std::fs::remove_file(repo.join("del.txt")).unwrap();
        write(repo, "new.txt", "created by turn\n");
        let after = snap(repo, &format!("{turn_id} after"));
        refs(repo, sid, turn_id, &before, &after);
        let e = entry(
            sid,
            turn_id,
            "do the thing",
            &before,
            &after,
            None,
            None,
            &[],
            &[("mod.txt", "M"), ("del.txt", "D"), ("new.txt", "A")],
            ended,
        );
        (before, after, e)
    }

    #[test]
    fn parse_skips_malformed_and_enriches_refs() {
        let repo = temp_repo("parse");
        let sid = "s:1/bad"; // exercises sanitize_sid
        g(&repo, &["commit", "--allow-empty", "-q", "-m", "init"]);
        let before = snap(&repo, "before t1");
        let after = snap(&repo, "after t1");
        refs(&repo, &sanitize_sid(sid), "t1", &before, &after);

        let sess = temp_dir("sess");
        let file = session_file(
            &sess,
            &repo,
            sid,
            &[
                "{not json".to_string(),
                json!({"type": "custom", "customType": "other", "data": {}}).to_string(),
                // missing before/after → malformed
                json!({"type": "custom", "customType": CHECKPOINT_TYPE, "data": {"v": 1, "turnId": "x"}}).to_string(),
                entry(sid, "t1", "first", &before, &after, None, None, &[],
                    &[("mod.txt", "M")], "2026-09-29T10:00:00Z"),
                // refs pruned → restorable=false
                entry(sid, "t2", "second", "0".repeat(40).as_str(), "1".repeat(40).as_str(),
                    None, None, &[], &[("b.txt", "M")], "2026-09-29T10:01:00Z"),
            ],
        );

        let turns = session_turns(&file).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].turn_id, "t1");
        assert_eq!(turns[0].session_id, sid);
        assert!(turns[0].restorable && !turns[0].undone);
        assert_eq!(turns[1].turn_id, "t2");
        assert!(!turns[1].restorable);

        // Undone ref flips the flag.
        g(
            &repo,
            &["update-ref", &undone_ref(&sanitize_sid(sid), "t1"), &before],
        );
        let turns = session_turns(&file).unwrap();
        assert!(turns[0].undone);
        assert!(!turns[1].undone);
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn parse_file_caches_by_mtime_and_size() {
        let sess = temp_dir("cache");
        let sid = "s1";
        // Distinct turn_id per rewrite, same length so size stays identical.
        let line = |turn_id: &str| {
            entry(
                sid,
                turn_id,
                "p",
                &"0".repeat(40),
                &"1".repeat(40),
                None,
                None,
                &[],
                &[("f.txt", "M")],
                "2026-09-29T10:00:00Z",
            )
        };
        let file = session_file(&sess, &sess, sid, &[line("t1")]);
        let set_mtime = |t: SystemTime| {
            std::fs::OpenOptions::new()
                .write(true)
                .open(&file)
                .unwrap()
                .set_modified(t)
                .unwrap();
        };

        clear_session_cache_for_test();
        // First read parses and populates the cache.
        let first = parse_file(&file).unwrap();
        assert_eq!(first.turns[0].turn_id, "t1");
        // Second read with unchanged file → cache hit: same Arc, no re-parse.
        let second = parse_file(&file).unwrap();
        assert!(Arc::ptr_eq(&first, &second));

        // Content changes but (mtime, size) stays identical → still served
        // from cache, proving the key is metadata, not file contents.
        let meta = std::fs::metadata(&file).unwrap();
        let (mtime, size) = (meta.modified().unwrap(), meta.len());
        std::fs::write(
            &file,
            std::fs::read_to_string(&file)
                .unwrap()
                .replace("\"t1\"", "\"t9\""),
        )
        .unwrap();
        set_mtime(mtime);
        assert_eq!(std::fs::metadata(&file).unwrap().len(), size);
        let third = parse_file(&file).unwrap();
        assert!(Arc::ptr_eq(&first, &third));

        // An mtime bump alone invalidates the entry → the file is re-parsed
        // and the updated turn_id is returned.
        set_mtime(mtime + std::time::Duration::from_secs(60));
        let fourth = parse_file(&file).unwrap();
        assert!(!Arc::ptr_eq(&first, &fourth));
        assert_eq!(fourth.turns[0].turn_id, "t9");

        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn collect_turns_merges_sessions_oldest_first() {
        let repo = temp_repo("merge");
        let sid = "s1";
        g(&repo, &["commit", "--allow-empty", "-q", "-m", "init"]);
        let b = snap(&repo, "b");
        let a = snap(&repo, "a");
        refs(&repo, sid, "t1", &b, &a);

        let sess = temp_dir("sess-merge");
        let f1 = session_file(
            &sess,
            &repo,
            sid,
            &[entry(
                sid,
                "t2",
                "later",
                &b,
                &a,
                None,
                None,
                &[],
                &[],
                "2026-09-29T10:05:00Z",
            )],
        );
        let f2 = session_file(
            &sess.with_file_name(format!("{}-2", sess.file_name().unwrap().to_string_lossy())),
            &repo,
            sid,
            &[entry(
                sid,
                "t1",
                "earlier",
                &b,
                &a,
                None,
                None,
                &[],
                &[],
                "2026-09-29T10:00:00Z",
            )],
        );
        let turns = collect_turns(&[f1, f2], &repo);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].turn_id, "t1");
        assert!(turns[0].restorable);
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn undo_restores_turn_files_and_keeps_other_work() {
        let repo = temp_repo("undo");
        let sid = "s1";
        write(&repo, "mod.txt", "m1\n");
        write(&repo, "del.txt", "to be deleted\n");
        write(&repo, "keep.txt", "keep\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);
        // Unrelated staged file — the real index must survive the undo.
        write(&repo, "staged.txt", "staged elsewhere\n");
        g(&repo, &["add", "staged.txt"]);

        let (_b, _a, e) = make_turn(&repo, sid, "t1", "2026-09-29T10:00:00Z");
        // Another session's uncommitted file, created after the turn.
        write(&repo, "dirty.txt", "other session\n");

        let sess = temp_dir("sess-undo");
        let file = session_file(&sess, &repo, sid, &[e]);
        let r = undo_turn(&repo, &file, "t1", false).unwrap();
        assert_eq!(r.restored.len(), 2, "{r:?}");
        assert!(r.restored.contains(&"mod.txt".to_string()));
        assert!(r.restored.contains(&"del.txt".to_string()));
        assert_eq!(r.deleted, vec!["new.txt".to_string()]);
        assert!(!r.head_reset);
        assert_eq!(
            std::fs::read_to_string(repo.join("mod.txt")).unwrap(),
            "m1\n"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("del.txt")).unwrap(),
            "to be deleted\n"
        );
        assert!(!repo.join("new.txt").exists());
        assert_eq!(
            std::fs::read_to_string(repo.join("dirty.txt")).unwrap(),
            "other session\n"
        );
        let st = g(&repo, &["status", "--porcelain"]);
        assert!(st.contains("A  staged.txt"), "index lost staged file: {st}");
        assert!(st.contains("?? dirty.txt"), "{st}");
        // Undone ref written; a second undo errs.
        assert_eq!(
            g(&repo, &["rev-parse", &undone_ref(sid, "t1")]),
            g(&repo, &["rev-parse", &turn_ref(sid, "t1", "before")])
        );
        assert!(undo_turn(&repo, &file, "t1", false).is_err());
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn undo_conflict_blocks_then_force_proceeds() {
        let repo = temp_repo("conflict");
        let sid = "s1";
        write(&repo, "mod.txt", "m1\n");
        write(&repo, "del.txt", "d\n");
        write(&repo, "new-marker.txt", "x\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);
        std::fs::remove_file(repo.join("new-marker.txt")).unwrap();

        let (_b, _a, e) = make_turn(&repo, sid, "t1", "2026-09-29T10:00:00Z");
        // Edited again after the turn ended.
        write(&repo, "mod.txt", "m3 post-turn\n");
        write(&repo, "new.txt", "recreated differently\n");

        let sess = temp_dir("sess-conflict");
        let file = session_file(&sess, &repo, sid, &[e]);
        let r = undo_turn(&repo, &file, "t1", false).unwrap();
        assert!(r.conflicts.contains(&"mod.txt".to_string()), "{r:?}");
        assert!(r.conflicts.contains(&"new.txt".to_string()), "{r:?}");
        assert!(r.restored.is_empty() && r.deleted.is_empty());
        // Nothing changed.
        assert_eq!(
            std::fs::read_to_string(repo.join("mod.txt")).unwrap(),
            "m3 post-turn\n"
        );
        assert!(git_ok(
            &repo,
            &["rev-parse", "-q", "--verify", &undone_ref(sid, "t1")]
        )
        .is_err());

        let r = undo_turn(&repo, &file, "t1", true).unwrap();
        assert!(r.conflicts.is_empty());
        assert_eq!(
            std::fs::read_to_string(repo.join("mod.txt")).unwrap(),
            "m1\n"
        );
        assert!(!repo.join("new.txt").exists());
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn undo_resets_head_only_when_turn_commits_on_top() {
        let repo = temp_repo("head");
        let sid = "s1";
        write(&repo, "f.txt", "f1\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);

        // HEAD == headAfter → reset --mixed headBefore.
        let head_before = g(&repo, &["rev-parse", "HEAD"]);
        let before = snap(&repo, "before");
        write(&repo, "f.txt", "f2\n");
        g(&repo, &["add", "f.txt"]);
        g(&repo, &["commit", "-q", "-m", "turn commit"]);
        let head_after = g(&repo, &["rev-parse", "HEAD"]);
        let after = snap(&repo, "after");
        refs(&repo, sid, "t1", &before, &after);
        let sess = temp_dir("sess-head");
        let file = session_file(
            &sess,
            &repo,
            sid,
            &[entry(
                sid,
                "t1",
                "commit work",
                &before,
                &after,
                Some(&head_before),
                Some(&head_after),
                &[&head_after],
                &[("f.txt", "M")],
                "2026-09-29T10:00:00Z",
            )],
        );
        let r = undo_turn(&repo, &file, "t1", false).unwrap();
        assert!(r.head_reset, "{r:?}");
        assert_eq!(g(&repo, &["rev-parse", "HEAD"]), head_before);
        assert_eq!(std::fs::read_to_string(repo.join("f.txt")).unwrap(), "f1\n");

        // Later commit on top → HEAD untouched, warning set, files restored.
        let repo2 = temp_repo("head-later");
        write(&repo2, "f.txt", "f1\n");
        g(&repo2, &["add", "-A"]);
        g(&repo2, &["commit", "-q", "-m", "init"]);
        let hb = g(&repo2, &["rev-parse", "HEAD"]);
        let before = snap(&repo2, "before");
        write(&repo2, "f.txt", "f2\n");
        g(&repo2, &["add", "f.txt"]);
        g(&repo2, &["commit", "-q", "-m", "turn commit"]);
        let ha = g(&repo2, &["rev-parse", "HEAD"]);
        let after = snap(&repo2, "after");
        refs(&repo2, sid, "t1", &before, &after);
        // A later, unrelated commit.
        write(&repo2, "other.txt", "later\n");
        g(&repo2, &["add", "other.txt"]);
        g(&repo2, &["commit", "-q", "-m", "later work"]);
        let later = g(&repo2, &["rev-parse", "HEAD"]);
        let file2 = session_file(
            &sess,
            &repo2,
            sid,
            &[entry(
                sid,
                "t1",
                "commit work",
                &before,
                &after,
                Some(&hb),
                Some(&ha),
                &[&ha],
                &[("f.txt", "M")],
                "2026-09-29T10:00:00Z",
            )],
        );
        let r = undo_turn(&repo2, &file2, "t1", false).unwrap();
        assert!(!r.head_reset, "{r:?}");
        assert_eq!(r.warning.as_deref(), Some(HEAD_WARNING));
        assert_eq!(g(&repo2, &["rev-parse", "HEAD"]), later);
        assert_eq!(
            std::fs::read_to_string(repo2.join("f.txt")).unwrap(),
            "f1\n"
        );
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&repo2).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn undo_cascade_restores_oldest_before_state() {
        let repo = temp_repo("cascade");
        let sid = "s1";
        write(&repo, "mod.txt", "m1\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);

        // t1: mod m1→m2, creates t1new.txt.
        let b1 = snap(&repo, "t1 before");
        write(&repo, "mod.txt", "m2\n");
        write(&repo, "t1new.txt", "from t1\n");
        let a1 = snap(&repo, "t1 after");
        refs(&repo, sid, "t1", &b1, &a1);
        let e1 = entry(
            sid,
            "t1",
            "first",
            &b1,
            &a1,
            None,
            None,
            &[],
            &[("mod.txt", "M"), ("t1new.txt", "A")],
            "2026-09-29T10:00:00Z",
        );
        // t2: mod m2→m3, creates t2new.txt.
        let b2 = snap(&repo, "t2 before");
        write(&repo, "mod.txt", "m3\n");
        write(&repo, "t2new.txt", "from t2\n");
        let a2 = snap(&repo, "t2 after");
        refs(&repo, sid, "t2", &b2, &a2);
        let e2 = entry(
            sid,
            "t2",
            "second",
            &b2,
            &a2,
            None,
            None,
            &[],
            &[("mod.txt", "M"), ("t2new.txt", "A")],
            "2026-09-29T10:01:00Z",
        );

        let sess = temp_dir("sess-cascade");
        let file = session_file(&sess, &repo, sid, &[e1, e2]);
        // Undoing the OLDER turn cascades: both turns undone, workspace back
        // to before t1 — including the shared file mod.txt.
        let r = undo_turn(&repo, &file, "t1", false).unwrap();
        assert_eq!(r.turns_undone, 2, "{r:?}");
        assert_eq!(
            std::fs::read_to_string(repo.join("mod.txt")).unwrap(),
            "m1\n"
        );
        assert!(!repo.join("t1new.txt").exists());
        assert!(!repo.join("t2new.txt").exists());
        assert!(r.restored.contains(&"mod.txt".to_string()), "{r:?}");
        assert!(r.deleted.contains(&"t1new.txt".to_string()), "{r:?}");
        assert!(r.deleted.contains(&"t2new.txt".to_string()), "{r:?}");
        for tid in ["t1", "t2"] {
            assert_eq!(
                g(&repo, &["rev-parse", &undone_ref(sid, tid)]),
                g(&repo, &["rev-parse", &turn_ref(sid, tid, "before")])
            );
        }
        // Undoing the newest turn alone only restores that turn.
        let repo2 = temp_repo("cascade-newest");
        write(&repo2, "mod.txt", "m1\n");
        g(&repo2, &["add", "-A"]);
        g(&repo2, &["commit", "-q", "-m", "init"]);
        let b1 = snap(&repo2, "t1 before");
        write(&repo2, "mod.txt", "m2\n");
        let a1 = snap(&repo2, "t1 after");
        refs(&repo2, sid, "t1", &b1, &a1);
        let b2 = snap(&repo2, "t2 before");
        write(&repo2, "mod.txt", "m3\n");
        let a2 = snap(&repo2, "t2 after");
        refs(&repo2, sid, "t2", &b2, &a2);
        let sess2 = temp_dir("sess-cascade2");
        let file2 = session_file(
            &sess2,
            &repo2,
            sid,
            &[
                entry(
                    sid,
                    "t1",
                    "first",
                    &b1,
                    &a1,
                    None,
                    None,
                    &[],
                    &[("mod.txt", "M")],
                    "2026-09-29T10:00:00Z",
                ),
                entry(
                    sid,
                    "t2",
                    "second",
                    &b2,
                    &a2,
                    None,
                    None,
                    &[],
                    &[("mod.txt", "M")],
                    "2026-09-29T10:01:00Z",
                ),
            ],
        );
        let r = undo_turn(&repo2, &file2, "t2", false).unwrap();
        assert_eq!(r.turns_undone, 1, "{r:?}");
        assert_eq!(
            std::fs::read_to_string(repo2.join("mod.txt")).unwrap(),
            "m2\n"
        );
        assert!(git_ok(
            &repo2,
            &["rev-parse", "-q", "--verify", &undone_ref(sid, "t1")]
        )
        .is_err());
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&repo2).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
        std::fs::remove_dir_all(&sess2).unwrap();
    }

    #[test]
    fn undo_cascade_conflict_preflight_writes_nothing() {
        let repo = temp_repo("casc-conflict");
        let sid = "s1";
        write(&repo, "mod.txt", "m1\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);

        let b1 = snap(&repo, "t1 before");
        write(&repo, "mod.txt", "m2\n");
        let a1 = snap(&repo, "t1 after");
        refs(&repo, sid, "t1", &b1, &a1);
        let e1 = entry(
            sid,
            "t1",
            "first",
            &b1,
            &a1,
            None,
            None,
            &[],
            &[("mod.txt", "M")],
            "2026-09-29T10:00:00Z",
        );
        let b2 = snap(&repo, "t2 before");
        write(&repo, "mod.txt", "m3\n");
        write(&repo, "t2new.txt", "from t2\n");
        let a2 = snap(&repo, "t2 after");
        refs(&repo, sid, "t2", &b2, &a2);
        let e2 = entry(
            sid,
            "t2",
            "second",
            &b2,
            &a2,
            None,
            None,
            &[],
            &[("mod.txt", "M"), ("t2new.txt", "A")],
            "2026-09-29T10:01:00Z",
        );

        // Edited after t2 ended → conflicts with the whole cascade.
        write(&repo, "mod.txt", "post-turn edit\n");
        let sess = temp_dir("sess-casc-conflict");
        let file = session_file(&sess, &repo, sid, &[e1, e2]);
        let r = undo_turn(&repo, &file, "t1", false).unwrap();
        assert_eq!(r.conflicts, vec!["mod.txt".to_string()], "{r:?}");
        assert_eq!(r.turns_undone, 0);
        // Nothing written: file untouched, no undone refs, no deletes.
        assert_eq!(
            std::fs::read_to_string(repo.join("mod.txt")).unwrap(),
            "post-turn edit\n"
        );
        assert!(repo.join("t2new.txt").exists());
        for tid in ["t1", "t2"] {
            assert!(git_ok(
                &repo,
                &["rev-parse", "-q", "--verify", &undone_ref(sid, tid)]
            )
            .is_err());
        }
        // force proceeds and restores to before t1 anyway.
        let r = undo_turn(&repo, &file, "t1", true).unwrap();
        assert_eq!(r.turns_undone, 2);
        assert_eq!(
            std::fs::read_to_string(repo.join("mod.txt")).unwrap(),
            "m1\n"
        );
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn undo_blocks_on_non_restorable_later_turn() {
        let repo = temp_repo("guard");
        let sid = "s1";
        write(&repo, "mod.txt", "m1\n");
        write(&repo, "del.txt", "d\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);

        let (_b1, _a1, e1) = make_turn(&repo, sid, "t1", "2026-09-29T10:00:00Z");
        // Turn t2: modify mod.txt again — but its snapshot refs are pruned.
        let b2 = snap(&repo, "t2 before");
        write(&repo, "mod.txt", "m3\n");
        write(&repo, "new.txt", "n2\n");
        let a2 = snap(&repo, "t2 after");
        // Deliberately NO refs for t2 → restorable=false.
        let e2 = entry(
            sid,
            "t2",
            "second turn",
            &b2,
            &a2,
            None,
            None,
            &[],
            &[("mod.txt", "M"), ("new.txt", "M")],
            "2026-09-29T10:01:00Z",
        );
        // A file-less turn after t2 (refs exist) — cascades mark it undone.
        let b3 = snap(&repo, "t3 before");
        let a3 = snap(&repo, "t3 after");
        refs(&repo, sid, "t3", &b3, &a3);
        let e3 = entry(
            sid,
            "t3",
            "no-op",
            &b3,
            &a3,
            None,
            None,
            &[],
            &[],
            "2026-09-29T10:02:00Z",
        );

        let sess = temp_dir("sess-guard");
        let file = session_file(&sess, &repo, sid, &[e1, e2, e3]);
        // t1 cannot be undone: crossing t2 would be required but t2's
        // snapshots are gone. Nothing may be written.
        let err = undo_turn(&repo, &file, "t1", false).unwrap_err();
        assert!(
            err.contains("无法跨过") && err.contains("存档已失效"),
            "{err}"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("mod.txt")).unwrap(),
            "m3\n"
        );
        assert!(git_ok(
            &repo,
            &["rev-parse", "-q", "--verify", &undone_ref(sid, "t1")]
        )
        .is_err());

        // Undoing the newest turn (t3, file-less) works alone.
        let r = undo_turn(&repo, &file, "t3", false).unwrap();
        assert_eq!(r.turns_undone, 1);

        // Once t2 is marked undone out-of-band, t1's cascade skips it (t3
        // was already undone) — t2's undone ref keeps it out.
        g(&repo, &["update-ref", &undone_ref(sid, "t2"), &b2]);
        // t1's conflict check: new.txt content changed since t1's after → force.
        let r = undo_turn(&repo, &file, "t1", true).unwrap();
        assert!(r.restored.contains(&"mod.txt".to_string()));
        assert_eq!(r.turns_undone, 1); // t2 was already undone, t3 already undone

        // Target itself non-restorable → refused.
        let e9 = entry(
            sid,
            "t9",
            "gone",
            &"0".repeat(40),
            &"1".repeat(40),
            None,
            None,
            &[],
            &[("mod.txt", "M")],
            "2026-09-29T10:03:00Z",
        );
        let file9 = session_file(&sess, &repo, sid, &[e9]);
        let err = undo_turn(&repo, &file9, "t9", true).unwrap_err();
        assert!(err.contains("无法撤回"), "{err}");
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn undo_cascade_resets_head_stepwise_when_commits_on_top() {
        let repo = temp_repo("casc-head");
        let sid = "s1";
        write(&repo, "f.txt", "f1\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);

        // t1 commits "turn commit 1" (f1→f2), t2 commits "turn commit 2" (f2→f3).
        let hb1 = g(&repo, &["rev-parse", "HEAD"]);
        let b1 = snap(&repo, "t1 before");
        write(&repo, "f.txt", "f2\n");
        g(&repo, &["add", "f.txt"]);
        g(&repo, &["commit", "-q", "-m", "turn commit 1"]);
        let ha1 = g(&repo, &["rev-parse", "HEAD"]);
        let a1 = snap(&repo, "t1 after");
        refs(&repo, sid, "t1", &b1, &a1);

        let b2 = snap(&repo, "t2 before");
        write(&repo, "f.txt", "f3\n");
        g(&repo, &["add", "f.txt"]);
        g(&repo, &["commit", "-q", "-m", "turn commit 2"]);
        let ha2 = g(&repo, &["rev-parse", "HEAD"]);
        let a2 = snap(&repo, "t2 after");
        refs(&repo, sid, "t2", &b2, &a2);

        let sess = temp_dir("sess-casc-head");
        let file = session_file(
            &sess,
            &repo,
            sid,
            &[
                entry(
                    sid,
                    "t1",
                    "commit 1",
                    &b1,
                    &a1,
                    Some(&hb1),
                    Some(&ha1),
                    &[&ha1],
                    &[("f.txt", "M")],
                    "2026-09-29T10:00:00Z",
                ),
                entry(
                    sid,
                    "t2",
                    "commit 2",
                    &b2,
                    &a2,
                    Some(&ha1),
                    Some(&ha2),
                    &[&ha2],
                    &[("f.txt", "M")],
                    "2026-09-29T10:01:00Z",
                ),
            ],
        );
        // Cascading undo of t1: t2 resets HEAD ha2→ha1, then t1 ha1→hb1.
        let r = undo_turn(&repo, &file, "t1", false).unwrap();
        assert!(r.head_reset, "{r:?}");
        assert_eq!(r.turns_undone, 2);
        assert!(r.warning.is_none(), "{r:?}");
        assert_eq!(g(&repo, &["rev-parse", "HEAD"]), hb1);
        assert_eq!(std::fs::read_to_string(repo.join("f.txt")).unwrap(), "f1\n");
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }

    #[test]
    fn undo_cascade_error_reports_done_count() {
        let repo = temp_repo("casc-fail");
        let sid = "s1";
        write(&repo, "mod.txt", "m1\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);

        // t1 claims it created `newdir`, but by undo time that path is a
        // non-empty directory → `remove_file` fails mid-cascade.
        let b1 = snap(&repo, "t1 before");
        write(&repo, "mod.txt", "m2\n");
        write(&repo, "newdir/inner.txt", "x\n");
        let a1 = snap(&repo, "t1 after");
        refs(&repo, sid, "t1", &b1, &a1);
        let e1 = entry(
            sid,
            "t1",
            "first",
            &b1,
            &a1,
            None,
            None,
            &[],
            &[("mod.txt", "M"), ("newdir", "A")],
            "2026-09-29T10:00:00Z",
        );

        let b2 = snap(&repo, "t2 before");
        write(&repo, "other.txt", "o\n");
        let a2 = snap(&repo, "t2 after");
        refs(&repo, sid, "t2", &b2, &a2);
        let e2 = entry(
            sid,
            "t2",
            "second",
            &b2,
            &a2,
            None,
            None,
            &[],
            &[("other.txt", "A")],
            "2026-09-29T10:01:00Z",
        );

        let sess = temp_dir("sess-casc-fail");
        let file = session_file(&sess, &repo, sid, &[e1, e2]);
        // t2 succeeds (newest first), t1 fails on restore — the error says
        // how many turns were already rolled back.
        let err = undo_turn(&repo, &file, "t1", true).unwrap_err();
        assert!(err.contains("已成功撤回 1 轮"), "{err}");
        // t2 was marked undone before the failure; t1's ref was not written.
        assert!(git_ok(
            &repo,
            &["rev-parse", "-q", "--verify", &undone_ref(sid, "t2")]
        )
        .is_ok());
        assert!(git_ok(
            &repo,
            &["rev-parse", "-q", "--verify", &undone_ref(sid, "t1")]
        )
        .is_err());
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }
}
