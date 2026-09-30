//! Per-turn checkpoints: parse `omp-workspace.turn-checkpoint` entries from
//! session .jsonl files, list them per session/worktree (enriched with
//! `restorable`/`undone` from the repo's hidden `refs/omp/*`), and undo the
//! newest turn — restore its files, roll back HEAD when its commits are still
//! on top, and write `refs/omp/undone/<sid>/<turnId>` last.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

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

struct ParsedSession {
    /// `cwd` from the `type:"session"` header entry.
    cwd: Option<String>,
    /// Session id from the header (fallback for data.sessionId).
    id: String,
    turns: Vec<TurnCheckpoint>,
}

/// Read a session .jsonl; malformed lines/entries are skipped.
fn parse_file(path: &Path) -> Result<ParsedSession, String> {
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
    Ok(parsed)
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
    let mut turns = parsed.turns;
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
            out.extend(parsed.turns);
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
pub fn worktree_turns(
    cwd: &Path,
    sessions: &[(String, String)],
) -> Result<Vec<TurnCheckpoint>, String> {
    if worktree::repo_info(cwd).is_none() {
        return Ok(Vec::new());
    }
    let dir = worktree::canon(cwd);
    let entries = worktree::list(cwd, sessions)?;
    let Some(entry) = entries
        .iter()
        .filter(|e| worktree::is_inside(&dir, Path::new(&e.path)))
        .max_by_key(|e| e.path.len())
    else {
        return Ok(Vec::new());
    };
    let files: Vec<PathBuf> = entry
        .session_ids
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

/// `git_undo_turn`: restore the newest non-undone turn's files to their
/// `before` state, roll back HEAD when the turn's commits are still on top,
/// then mark the turn undone. `force` skips the post-turn-edit conflict check.
pub fn undo_turn(
    cwd: &Path,
    session_file: &Path,
    turn_id: &str,
    force: bool,
) -> Result<TurnUndoResult, String> {
    let parsed = parse_file(session_file)?;
    let mut turns = parsed.turns;
    sort_turns(&mut turns);
    enrich(cwd, &mut turns);
    let Some(idx) = turns.iter().position(|t| t.turn_id == turn_id) else {
        return Err("找不到这一轮".into());
    };
    let turn = &turns[idx];
    if turn.undone {
        return Err("这一轮已经撤回过了".into());
    }
    if turns.iter().skip(idx + 1).any(|t| !t.undone) {
        return Err("只能撤回最近的一轮".into());
    }
    if !turn.restorable {
        return Err("这一轮的存档已失效，无法撤回".into());
    }

    // Post-turn edits to the turn's files block the undo unless forced.
    let conflicts: Vec<String> = turn
        .files
        .iter()
        .filter(|f| {
            worktree_blob(cwd, &f.path).as_deref() != blob_at(cwd, &turn.after, &f.path).as_deref()
        })
        .map(|f| f.path.clone())
        .collect();
    if !conflicts.is_empty() && !force {
        return Ok(TurnUndoResult {
            conflicts,
            ..Default::default()
        });
    }

    let mut result = TurnUndoResult::default();

    // HEAD: reset only when the turn's commits are still on top.
    if !turn.commits.is_empty() {
        let now = head(cwd);
        if now.is_some() && now == turn.head_after {
            if let Some(base) = &turn.head_before {
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
    for f in &turn.files {
        if f.status == "A" {
            match std::fs::remove_file(cwd.join(&f.path)) {
                Ok(()) => result.deleted.push(f.path.clone()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("删除 {} 失败: {e}", f.path)),
            }
        } else {
            git_ok(
                cwd,
                &[
                    "restore",
                    &format!("--source={}", turn.before),
                    "--worktree",
                    "--",
                    &f.path,
                ],
            )
            .map_err(|e| format!("恢复 {} 失败: {e}", f.path))?;
            result.restored.push(f.path.clone());
        }
    }

    // Mark the turn undone only after every file was restored.
    let sid = sanitize_sid(&turn.session_id);
    git_ok(
        cwd,
        &["update-ref", &undone_ref(&sid, &turn.turn_id), &turn.before],
    )
    .map_err(|e| format!("标记撤回失败: {e}"))?;
    Ok(result)
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
    fn undo_rejects_non_latest_and_non_restorable() {
        let repo = temp_repo("guard");
        let sid = "s1";
        write(&repo, "mod.txt", "m1\n");
        write(&repo, "del.txt", "d\n");
        g(&repo, &["add", "-A"]);
        g(&repo, &["commit", "-q", "-m", "init"]);

        let (_b1, _a1, e1) = make_turn(&repo, sid, "t1", "2026-09-29T10:00:00Z");
        // Turn t2: just modify mod.txt again.
        let b2 = snap(&repo, "t2 before");
        write(&repo, "mod.txt", "m3\n");
        write(&repo, "new.txt", "n2\n");
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
            &[("mod.txt", "M"), ("new.txt", "M")],
            "2026-09-29T10:01:00Z",
        );

        let sess = temp_dir("sess-guard");
        let file = session_file(&sess, &repo, sid, &[e1, e2]);
        // t1 is not the newest non-undone turn.
        let err = undo_turn(&repo, &file, "t1", false).unwrap_err();
        assert!(err.contains("只能撤回最近的一轮"), "{err}");
        // Once t2 is undone, t1 becomes undoable.
        g(&repo, &["update-ref", &undone_ref(sid, "t2"), &b2]);
        // t1's conflict check: new.txt content changed since t1's after → force.
        let r = undo_turn(&repo, &file, "t1", true).unwrap();
        assert!(r.restored.contains(&"mod.txt".to_string()));

        // Pruned refs → not restorable.
        let e3 = entry(
            sid,
            "t9",
            "gone",
            &"0".repeat(40),
            &"1".repeat(40),
            None,
            None,
            &[],
            &[("mod.txt", "M")],
            "2026-09-29T10:02:00Z",
        );
        let file3 = session_file(&sess, &repo, sid, &[e3]);
        let err = undo_turn(&repo, &file3, "t9", true).unwrap_err();
        assert!(err.contains("无法撤回"), "{err}");
        std::fs::remove_dir_all(&repo).unwrap();
        std::fs::remove_dir_all(&sess).unwrap();
    }
}
