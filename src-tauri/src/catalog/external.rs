//! External (non app-owned) omp process detection: `lsof` + status files (§8).

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// An omp process holding a session file open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Holder {
    pub pid: u32,
    pub ppid: Option<u32>,
}

/// Parse `lsof -F pRn` output into `file -> holder` for `.jsonl` files under `sessions_dir`.
pub fn parse_lsof(out: &str, sessions_dir: &str) -> HashMap<String, Holder> {
    let mut map = HashMap::new();
    let mut pid: Option<u32> = None;
    let mut ppid: Option<u32> = None;
    for line in out.lines() {
        let (tag, rest) = line.split_at(line.len().min(1));
        match tag {
            "p" => {
                pid = rest.parse().ok();
                ppid = None;
            }
            "R" => ppid = rest.parse().ok(),
            "n" => {
                if let Some(pid) = pid {
                    if rest.ends_with(".jsonl") && rest.starts_with(sessions_dir) {
                        map.insert(rest.to_string(), Holder { pid, ppid });
                    }
                }
            }
            _ => {}
        }
    }
    map
}

/// Run lsof for omp processes. Errors / missing lsof yield an empty map.
pub fn lsof_holders(sessions_dir: &Path) -> HashMap<String, Holder> {
    let out = Command::new("/usr/sbin/lsof")
        .args(["-w", "-n", "-P", "-c", "omp", "-F", "pRn"])
        .env("PATH", "/usr/sbin:/usr/bin:/bin:/sbin")
        .output();
    match out {
        Ok(o) => parse_lsof(
            &String::from_utf8_lossy(&o.stdout),
            &sessions_dir.to_string_lossy(),
        ),
        Err(e) => {
            tracing::debug!("lsof failed: {e}");
            HashMap::new()
        }
    }
}

/// Status file (§8) fields we use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusFile {
    pub session_id: String,
    pub session_file: String,
    pub pid: u32,
    pub state: String,
}

pub fn parse_status_file(text: &str) -> Option<StatusFile> {
    let v: Value = serde_json::from_str(text).ok()?;
    Some(StatusFile {
        session_id: v.get("sessionId")?.as_str()?.to_string(),
        session_file: v
            .get("sessionFile")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        pid: u32::try_from(v.get("pid")?.as_u64()?).ok()?,
        state: v
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

pub fn read_status_files(dir: &Path) -> Vec<StatusFile> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|t| parse_status_file(&t))
        .collect()
}

pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    // SAFETY: kill with signal 0 performs only a permission/existence check.
    let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Combine lsof holders and live status files into `file -> external pid`,
/// excluding processes owned by this app (direct children).
pub fn external_map(
    holders: HashMap<String, Holder>,
    status: &[StatusFile],
    alive: impl Fn(u32) -> bool,
    own_pid: u32,
) -> HashMap<String, u32> {
    let owned: Vec<u32> = holders
        .values()
        .filter(|h| h.ppid == Some(own_pid))
        .map(|h| h.pid)
        .collect();
    let mut map: HashMap<String, u32> = holders
        .into_iter()
        .filter(|(_, h)| h.ppid != Some(own_pid))
        .map(|(f, h)| (f, h.pid))
        .collect();
    for s in status {
        if s.session_file.is_empty() || s.state == "exited" || owned.contains(&s.pid) {
            continue;
        }
        if alive(s.pid) {
            map.entry(s.session_file.clone()).or_insert(s.pid);
        } else if map.get(&s.session_file) == Some(&s.pid) {
            map.remove(&s.session_file);
        }
    }
    map
}

/// An external (terminal) omp that opened an app-owned live session's file
/// while we held it: omp refuses to share the file and forks into a NEW
/// session file (`parentSession` = the app session id) — the two copies then
/// diverge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalFork {
    /// The app-owned live session that was forked.
    pub live_session_id: String,
    /// Session id of the terminal's fork.
    pub fork_session_id: String,
    pub pid: u32,
}

/// `live` = (session id, session file) of app-owned handles. A live external
/// status file (pid != own) whose file differs and whose header names a live
/// session as parent (`parent_of(file)`) is such a fork.
pub fn detect_forks(
    live: &[(String, String)],
    status: &[StatusFile],
    alive: impl Fn(u32) -> bool,
    own_pids: &[u32],
    parent_of: impl Fn(&str) -> Option<String>,
) -> Vec<ExternalFork> {
    let mut out = Vec::new();
    for s in status {
        if s.session_file.is_empty()
            || s.state == "exited"
            || own_pids.contains(&s.pid)
            || !alive(s.pid)
        {
            continue;
        }
        let Some(parent) = parent_of(&s.session_file) else {
            continue;
        };
        if live
            .iter()
            .any(|(id, file)| *id == parent && *file != s.session_file && *id != s.session_id)
        {
            out.push(ExternalFork {
                live_session_id: parent,
                fork_session_id: s.session_id.clone(),
                pid: s.pid,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const LSOF: &str = "p100\nR1\nfcwd\nn/work\nf23\nn/h/.omp/agent/sessions/b/a.jsonl\nf24\nn/h/.omp/agent/sessions/b/a/sub.txt\np200\nR999\nf5\nn/h/.omp/agent/sessions/b/c.jsonl\np300\nR1\nf5\nn/elsewhere/x.jsonl\n";

    #[test]
    fn parses_lsof_output() {
        let m = parse_lsof(LSOF, "/h/.omp/agent/sessions");
        assert_eq!(m.len(), 2);
        assert_eq!(
            m["/h/.omp/agent/sessions/b/a.jsonl"],
            Holder {
                pid: 100,
                ppid: Some(1)
            }
        );
        assert_eq!(m["/h/.omp/agent/sessions/b/c.jsonl"].ppid, Some(999));
    }

    #[test]
    fn excludes_app_owned_and_merges_status_files() {
        let holders = parse_lsof(LSOF, "/h/.omp/agent/sessions");
        let status = vec![
            StatusFile {
                session_id: "d".into(),
                session_file: "/s/d.jsonl".into(),
                pid: 42,
                state: "working".into(),
            },
            StatusFile {
                session_id: "e".into(),
                session_file: "/s/e.jsonl".into(),
                pid: 43,
                state: "idle".into(),
            },
            StatusFile {
                session_id: "f".into(),
                session_file: "/s/f.jsonl".into(),
                pid: 44,
                state: "exited".into(),
            },
            // App-owned pid reported by a status file stays non-external.
            StatusFile {
                session_id: "c".into(),
                session_file: "/s/c2.jsonl".into(),
                pid: 200,
                state: "working".into(),
            },
        ];
        let m = external_map(holders, &status, |pid| pid == 42 || pid == 200, 999);
        assert_eq!(m.get("/h/.omp/agent/sessions/b/a.jsonl"), Some(&100));
        assert!(!m.contains_key("/h/.omp/agent/sessions/b/c.jsonl"));
        assert_eq!(m.get("/s/d.jsonl"), Some(&42));
        assert!(
            !m.contains_key("/s/e.jsonl")
                && !m.contains_key("/s/f.jsonl")
                && !m.contains_key("/s/c2.jsonl")
        );
    }

    #[test]
    fn status_file_parsing_and_pid_check() {
        let s = parse_status_file(
            r#"{"sessionId":"x","sessionFile":"/f","pid":7,"state":"idle","updatedAt":"t"}"#,
        )
        .unwrap();
        assert_eq!((s.session_id.as_str(), s.pid), ("x", 7));
        assert!(parse_status_file("{}").is_none());
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(0));
    }

    #[test]
    fn detects_terminal_fork_of_live_session() {
        let live = vec![("a".to_string(), "/a.jsonl".to_string())];
        let sf = |id: &str, file: &str, pid: u32| StatusFile {
            session_id: id.into(),
            session_file: file.into(),
            pid,
            state: "idle".into(),
        };
        let status = vec![sf("b", "/b.jsonl", 9), sf("a", "/a.jsonl", 5)];
        let parent = |f: &str| (f == "/b.jsonl").then(|| "a".to_string());
        let forks = detect_forks(&live, &status, |_| true, &[1], parent);
        assert_eq!(forks.len(), 1);
        assert_eq!(forks[0].live_session_id, "a");
        assert_eq!(forks[0].fork_session_id, "b");
        assert!(detect_forks(&live, &status, |_| false, &[1], parent).is_empty());
        assert!(detect_forks(&live, &status, |_| true, &[9], parent).is_empty());
    }
}
