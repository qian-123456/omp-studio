//! Listening-port discovery via `lsof` + `ps` and dev-process filtering.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use crate::contracts::ServiceInfo;
use crate::git::cmd::run;

const SCAN_TIMEOUT: Duration = Duration::from_secs(10);

/// One listening process with its ports.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Listener {
    pub pid: u32,
    pub name: String,
    pub ports: Vec<u16>,
}

fn lsof_bin() -> &'static str {
    if Path::new("/usr/sbin/lsof").exists() {
        "/usr/sbin/lsof"
    } else {
        "lsof"
    }
}

/// Port from an lsof name like `*:5173`, `127.0.0.1:3000`, `[::1]:8080`.
fn port_of(name: &str) -> Option<u16> {
    name.rsplit(':').next()?.parse().ok()
}

/// Parse `lsof -F pcn` output (fields: p=pid, c=command, n=name).
pub fn parse_lsof_listen(text: &str) -> Vec<Listener> {
    let mut map: BTreeMap<u32, Listener> = BTreeMap::new();
    let mut cur: Option<u32> = None;
    for line in text.lines() {
        let (tag, val) = line.split_at(line.len().min(1));
        match tag {
            "p" => {
                let pid = val.parse().ok();
                cur = pid;
                if let Some(pid) = pid {
                    map.entry(pid).or_insert_with(|| Listener {
                        pid,
                        ..Default::default()
                    });
                }
            }
            "c" => {
                if let Some(l) = cur.and_then(|p| map.get_mut(&p)) {
                    l.name = val.to_string();
                }
            }
            "n" => {
                if let (Some(l), Some(port)) = (cur.and_then(|p| map.get_mut(&p)), port_of(val)) {
                    if !l.ports.contains(&port) {
                        l.ports.push(port);
                    }
                }
            }
            _ => {}
        }
    }
    map.into_values().filter(|l| !l.ports.is_empty()).collect()
}

/// Parse `lsof -d cwd -F n` output into pid → cwd.
pub fn parse_lsof_cwd(text: &str) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    let mut cur: Option<u32> = None;
    for line in text.lines() {
        if let Some(p) = line.strip_prefix('p') {
            cur = p.parse().ok();
        } else if let (Some(n), Some(pid)) = (line.strip_prefix('n'), cur) {
            out.insert(pid, n.to_string());
        }
    }
    out
}

/// Parse `ps -o pid=,pgid=,command=` output into pid → (pgid, command).
pub fn parse_ps(text: &str) -> HashMap<u32, (i32, String)> {
    text.lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let pid = it.next()?.parse().ok()?;
            let pgid = it.next()?.parse().ok()?;
            let rest: Vec<&str> = it.collect();
            Some((pid, (pgid, rest.join(" "))))
        })
        .collect()
}

const DEV_NAMES: &[&str] = &[
    "node",
    "bun",
    "deno",
    "python",
    "ruby",
    "java",
    "go",
    "cargo",
    "vite",
    "next",
    "next-server",
    "tokentracker",
    "uvicorn",
    "gunicorn",
    "php",
    "esbuild",
    "webpack",
    "tsx",
    "rails",
    "puma",
    "pnpm",
    "npm",
    "yarn",
    "air",
];

/// Heuristic: is this a dev server-like process?
pub fn is_dev_like(name: &str, command: &str) -> bool {
    let argv0 = command.split_whitespace().next().unwrap_or_default();
    let base = Path::new(argv0)
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let name = name.to_lowercase();
    let matches = |s: &str| {
        DEV_NAMES.iter().any(|d| {
            s == *d
                || s.strip_prefix(d)
                    .is_some_and(|rest| rest.chars().all(|c| c.is_ascii_digit() || c == '.'))
        })
    };
    matches(&name)
        || matches(&base)
        || command.contains("/target/debug/")
        || command.contains("/target/release/")
        || command.contains("/go-build")
        || command.contains("node_modules/.bin/")
}

/// Raw scan: listeners joined with cwd, command and pgid.
pub struct Scanned {
    pub listener: Listener,
    pub cwd: Option<String>,
    pub command: String,
    pub pgid: i32,
}

pub fn scan() -> Vec<Scanned> {
    let mut cmd = Command::new(lsof_bin());
    cmd.args(["+c", "0", "-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"]);
    let Ok(out) = run(cmd, SCAN_TIMEOUT) else {
        return Vec::new();
    };
    let listeners = parse_lsof_listen(&out.text());
    if listeners.is_empty() {
        return Vec::new();
    }
    let pids = listeners
        .iter()
        .map(|l| l.pid.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let mut cmd = Command::new(lsof_bin());
    cmd.args(["-a", "-p", &pids, "-d", "cwd", "-F", "n"]);
    let cwds = run(cmd, SCAN_TIMEOUT)
        .map(|o| parse_lsof_cwd(&o.text()))
        .unwrap_or_default();
    let mut cmd = Command::new("/bin/ps");
    cmd.args(["-o", "pid=,pgid=,command=", "-p", &pids]);
    let ps = run(cmd, SCAN_TIMEOUT)
        .map(|o| parse_ps(&o.text()))
        .unwrap_or_default();
    listeners
        .into_iter()
        .map(|l| {
            let (pgid, command) = ps.get(&l.pid).cloned().unwrap_or((0, l.name.clone()));
            Scanned {
                cwd: cwds.get(&l.pid).cloned(),
                command,
                pgid,
                listener: l,
            }
        })
        .collect()
}

/// Deepest session cwd containing `cwd` → session id.
pub fn match_session(cwd: &str, sessions: &[(String, String)]) -> Option<String> {
    let cwd = Path::new(cwd);
    sessions
        .iter()
        .filter(|(_, s)| !s.is_empty() && cwd.starts_with(s))
        .max_by_key(|(_, s)| s.len())
        .map(|(id, _)| id.clone())
}

/// Build `ServiceInfo` rows (one per port) from a scan.
pub fn to_services(
    scanned: Vec<Scanned>,
    all: bool,
    sessions: &[(String, String)],
    app_pgids: &[i32],
) -> Vec<ServiceInfo> {
    let mut out: Vec<ServiceInfo> = scanned
        .into_iter()
        .filter(|s| all || is_dev_like(&s.listener.name, &s.command))
        .flat_map(|s| {
            let session_id = s.cwd.as_deref().and_then(|c| match_session(c, sessions));
            let started_by_app = app_pgids.contains(&s.pgid);
            let ports = s.listener.ports.clone();
            ports.into_iter().map(move |port| ServiceInfo {
                pid: s.listener.pid,
                name: s.listener.name.clone(),
                port,
                cwd: s.cwd.clone(),
                command: s.command.clone(),
                url: format!("http://localhost:{port}"),
                session_id: session_id.clone(),
                started_by_app,
            })
        })
        .collect();
    out.sort_by_key(|s| (s.port, s.pid));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lsof_listen_output() {
        let text = "p123\ncnode\nf21\nn*:5173\nf22\nn[::1]:5173\np456\ncControlCenter\nf9\nn*:7000\np789\ncpostgres\nf5\nn127.0.0.1:5432\n";
        let l = parse_lsof_listen(text);
        assert_eq!(l.len(), 3);
        assert_eq!(l[0].pid, 123);
        assert_eq!(l[0].ports, vec![5173]);
        assert_eq!(l[2].ports, vec![5432]);
    }

    #[test]
    fn parses_cwd_and_ps() {
        let cwd = parse_lsof_cwd("p123\nfcwd\nn/Users/me/proj\np456\nfcwd\nn/\n");
        assert_eq!(cwd.get(&123).map(String::as_str), Some("/Users/me/proj"));
        let ps = parse_ps(
            "  123   120 node /x/node_modules/.bin/vite --port 5173\n 456 456 /usr/bin/foo\n",
        );
        assert_eq!(ps.get(&123).unwrap().0, 120);
        assert_eq!(
            ps.get(&123).unwrap().1,
            "node /x/node_modules/.bin/vite --port 5173"
        );
    }

    #[test]
    fn dev_filter() {
        assert!(is_dev_like("node", "node server.js"));
        assert!(is_dev_like("Python", "/usr/bin/python3.12 -m http.server"));
        assert!(is_dev_like("python3.12", ""));
        assert!(is_dev_like("myapp", "/repo/target/debug/myapp"));
        assert!(!is_dev_like(
            "ControlCenter",
            "/System/Library/ControlCenter"
        ));
        assert!(!is_dev_like("postgres", "postgres -D /data"));
        assert!(!is_dev_like("nodemon-ish", "/usr/bin/goodbye"));
    }

    #[test]
    fn session_matching_and_rows() {
        let sessions = vec![
            ("root".to_string(), "/r".to_string()),
            ("wt".to_string(), "/r/.worktrees/a".to_string()),
        ];
        assert_eq!(
            match_session("/r/.worktrees/a/web", &sessions).as_deref(),
            Some("wt")
        );
        assert_eq!(match_session("/r/src", &sessions).as_deref(), Some("root"));
        assert_eq!(match_session("/rx", &sessions), None);
        let scanned = vec![
            Scanned {
                listener: Listener {
                    pid: 1,
                    name: "node".into(),
                    ports: vec![5173, 24678],
                },
                cwd: Some("/r/src".into()),
                command: "node vite".into(),
                pgid: 7,
            },
            Scanned {
                listener: Listener {
                    pid: 2,
                    name: "postgres".into(),
                    ports: vec![5432],
                },
                cwd: None,
                command: "postgres".into(),
                pgid: 2,
            },
        ];
        let rows = to_services(scanned, false, &sessions, &[7]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].url, "http://localhost:5173");
        assert_eq!(rows[0].session_id.as_deref(), Some("root"));
        assert!(rows[0].started_by_app);
    }
}
