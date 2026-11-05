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
/// Unlike observation, a writer conflict requires an explicitly writable fd.
/// Access is reported per descriptor by lsof's `a` field.
pub fn parse_lsof_writers(out: &str, sessions_dir: &str) -> HashMap<String, Holder> {
    let mut map = HashMap::new();
    let mut pid = None;
    let mut ppid = None;
    let mut writable = false;
    let own_pid = std::process::id();
    for line in out.lines() {
        let (tag, rest) = line.split_at(line.len().min(1));
        match tag {
            "p" => {
                pid = rest.parse().ok();
                ppid = None;
                writable = false;
            }
            "R" => ppid = rest.parse().ok(),
            "f" => writable = false,
            "a" => writable = matches!(rest, "w" | "u"),
            "n" if writable && rest.ends_with(".jsonl") && rest.starts_with(sessions_dir) => {
                if let Some(pid) = pid {
                    let holder = Holder { pid, ppid };
                    if (holder.pid != own_pid && holder.ppid != Some(own_pid))
                        || !map
                            .get(rest)
                            .is_some_and(|h: &Holder| h.pid != own_pid && h.ppid != Some(own_pid))
                    {
                        map.insert(rest.to_string(), holder);
                    }
                }
            }
            _ => {}
        }
    }
    map
}

/// Query writable omp session descriptors. Errors / missing lsof yield an empty map.
pub fn lsof_holders(sessions_dir: &Path) -> HashMap<String, Holder> {
    let out = Command::new("/usr/sbin/lsof")
        .args(["-w", "-n", "-P", "-c", "omp", "-F", "pRfan"])
        .env("PATH", "/usr/sbin:/usr/bin:/bin:/sbin")
        .output();
    match out {
        Ok(o) => parse_lsof_writers(
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
    /// OS process birth token; legacy status files need lsof corroboration.
    pub process_started_at: Option<String>,
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
        process_started_at: v
            .get("processStartedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
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

/// Cache kernel identity once per PID within one ownership sweep. Never retain
/// this cache across sweeps: a later sweep must observe PID reuse or exit.
pub fn status_validator(lookup: impl Fn(u32) -> Option<String>) -> impl Fn(&StatusFile) -> bool {
    let births = std::cell::RefCell::new(HashMap::<u32, Option<String>>::new());
    move |status| {
        let Some(expected) = status.process_started_at.as_deref() else {
            return false;
        };
        births
            .borrow_mut()
            .entry(status.pid)
            .or_insert_with(|| lookup(status.pid))
            .as_deref()
            == Some(expected)
    }
}

pub(crate) fn process_birth(pid: u32) -> Option<String> {
    if !pid_alive(pid) {
        return None;
    }
    let out = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "lstart="])
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !token.is_empty()).then_some(token)
}

/// Combine lsof holders and live status files into `file -> external pid`,
/// excluding processes owned by this app (direct children).
pub fn external_map(
    holders: HashMap<String, Holder>,
    status: &[StatusFile],
    alive: impl Fn(&StatusFile) -> bool,
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
        if s.session_file.is_empty()
            || s.state == "exited"
            || s.pid == own_pid
            || owned.contains(&s.pid)
        {
            continue;
        }
        if alive(s) {
            map.entry(s.session_file.clone()).or_insert(s.pid);
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writer_detection_ignores_readers_and_keeps_valid_status_fallback() {
        let file = "/sessions/a.jsonl";
        let output = "p10\nR1\nf3\nar\nn/sessions/a.jsonl\np11\nR1\nf4\naw\nn/sessions/b.jsonl\np12\nR1\nf5\nau\nn/sessions/c.jsonl\nf6\nn/sessions/d.jsonl\n";
        let writers = parse_lsof_writers(output, "/sessions");
        assert!(!writers.contains_key(file));
        assert_eq!(writers["/sessions/b.jsonl"].pid, 11);
        assert_eq!(writers["/sessions/c.jsonl"].pid, 12);
        assert!(!writers.contains_key("/sessions/d.jsonl"));
        let status = StatusFile {
            session_id: "a".into(),
            session_file: file.into(),
            pid: 10,
            state: "working".into(),
            process_started_at: Some("birth".into()),
        };
        assert_eq!(
            external_map(writers, &[status], |_| true, 999).get(file),
            Some(&10)
        );
    }

    #[test]
    fn competing_writer_is_not_masked_by_our_child_or_a_later_reader() {
        let own_pid = std::process::id();
        let competitor_pid = own_pid + 2;
        let file = "/sessions/shared.jsonl";
        let owned = format!("p{}\nR{own_pid}\nf3\nau\nn{file}\n", own_pid + 1);
        let competitor = format!("p{competitor_pid}\nR0\nf4\naw\nn{file}\n");
        let reader = format!("p{}\nR0\nf5\nar\nn{file}\n", own_pid + 3);
        for output in [
            format!("{owned}{competitor}{reader}"),
            format!("{competitor}{owned}{reader}"),
        ] {
            let owners = external_map(
                parse_lsof_writers(&output, "/sessions"),
                &[],
                |_| false,
                own_pid,
            );
            assert_eq!(owners.get(file), Some(&competitor_pid));
        }
    }

    const LSOF: &str = "p100\nR1\nfcwd\nn/work\nf23\nn/h/.omp/agent/sessions/b/a.jsonl\nf24\nn/h/.omp/agent/sessions/b/a/sub.txt\np200\nR999\nf5\nn/h/.omp/agent/sessions/b/c.jsonl\np300\nR1\nf5\nn/elsewhere/x.jsonl\n";

    #[test]
    fn status_validation_samples_pid_once_per_sweep_and_rechecks_next_sweep() {
        let calls = std::cell::Cell::new(0);
        let birth = std::cell::RefCell::new("birth-a".to_string());
        let lookup = |pid| {
            calls.set(calls.get() + 1);
            (pid == 9 || pid == 10).then(|| birth.borrow().clone())
        };
        let status = |id: &str, pid, token: &str| StatusFile {
            session_id: id.into(),
            session_file: format!("/{id}.jsonl"),
            pid,
            state: "working".into(),
            process_started_at: Some(token.into()),
        };
        let statuses = vec![
            status("current", 9, "birth-a"),
            status("stale", 9, "old-birth"),
            status("other", 10, "birth-a"),
            status("dead", 11, "old-birth"),
            status("dead-copy", 11, "old-birth"),
        ];
        let validate = status_validator(&lookup);
        let map = external_map(HashMap::new(), &statuses, &validate, 1);
        assert_eq!(map.len(), 2);
        assert!(!map.contains_key("/stale.jsonl"));
        assert_eq!(calls.get(), 3);
        *birth.borrow_mut() = "birth-b".into();
        let next_sweep = status_validator(&lookup);
        assert!(external_map(HashMap::new(), &statuses, next_sweep, 1).is_empty());
        assert_eq!(calls.get(), 6);
    }

    #[test]
    fn reused_pid_and_legacy_status_do_not_claim_ownership() {
        let status_pid_alive = status_validator(process_birth);
        let mut status = parse_status_file(&format!(r#"{{"sessionId":"stale","sessionFile":"/stale.jsonl","pid":{},"state":"working","processStartedAt":"old-birth"}}"#, std::process::id())).unwrap();
        assert!(external_map(HashMap::new(), &[status.clone()], &status_pid_alive, 1).is_empty());
        status.process_started_at = None;
        assert!(external_map(HashMap::new(), &[status.clone()], &status_pid_alive, 1).is_empty());
        let holders = HashMap::from([(
            status.session_file.clone(),
            Holder {
                pid: status.pid,
                ppid: Some(2),
            },
        )]);
        assert_eq!(
            external_map(holders, &[status.clone()], &status_pid_alive, 1)
                .get(&status.session_file),
            Some(&status.pid)
        );
        status.process_started_at = process_birth(status.pid);
        assert!(status_pid_alive(&status));
        assert_eq!(
            external_map(HashMap::new(), &[status.clone()], &status_pid_alive, 1)
                .get(&status.session_file),
            Some(&status.pid)
        );
    }

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
                process_started_at: None,
            },
            StatusFile {
                session_id: "e".into(),
                session_file: "/s/e.jsonl".into(),
                pid: 43,
                state: "idle".into(),
                process_started_at: None,
            },
            StatusFile {
                session_id: "f".into(),
                session_file: "/s/f.jsonl".into(),
                pid: 44,
                state: "exited".into(),
                process_started_at: None,
            },
            // App-owned pid reported by a status file stays non-external.
            StatusFile {
                session_id: "c".into(),
                session_file: "/s/c2.jsonl".into(),
                pid: 200,
                state: "working".into(),
                process_started_at: None,
            },
        ];
        let m = external_map(holders, &status, |s| s.pid == 42 || s.pid == 200, 999);
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
}
