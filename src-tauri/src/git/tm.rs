//! Time machine: run an old commit in a detached worktree.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use regex::Regex;

use super::cmd::git_ok;
use super::history::valid_sha;
use super::worktree;
use crate::contracts::TmRun;

/// Max lines kept per run for `log_tail`.
const LOG_LINES: usize = 300;

/// Callback receiving `(run_id, line)` for every output line.
pub type LogSink = Arc<dyn Fn(&str, &str) + Send + Sync>;

struct Run {
    info: TmRun,
    log: VecDeque<String>,
}

fn runs() -> &'static Mutex<HashMap<String, Run>> {
    static RUNS: OnceLock<Mutex<HashMap<String, Run>>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}

fn ansi_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]",
        )
        .expect("ansi regex")
    })
}

fn url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s]*")
            .expect("url regex")
    })
}

pub fn strip_ansi(s: &str) -> String {
    ansi_re().replace_all(s, "").into_owned()
}

/// First local dev-server URL in a (ANSI-stripped) line.
pub fn detect_url(line: &str) -> Option<String> {
    let m = url_re().find(line)?;
    let url = m.as_str().trim_end_matches(['.', ',', ')', ']', '\'', '"']);
    Some(url.replace("0.0.0.0", "localhost"))
}

/// Package manager implied by the lockfile in `dir`.
fn package_manager(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

fn install_cmd(dir: &Path) -> String {
    match package_manager(dir) {
        "pnpm" => "pnpm install --frozen-lockfile".into(),
        "yarn" => "yarn install --frozen-lockfile".into(),
        "bun" => "bun install --frozen-lockfile".into(),
        _ if dir.join("package-lock.json").exists() => "npm ci".into(),
        _ => "npm install".into(),
    }
}

fn has_dev_script(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join("package.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .is_some_and(|v| v["scripts"]["dev"].is_string())
}

/// Custom run command from `.omp-workspace/run.json` or `.omp/run.json`.
fn custom_command(dir: &Path) -> Option<String> {
    [".omp-workspace/run.json", ".omp/run.json"].iter().find_map(|p| {
        let s = std::fs::read_to_string(dir.join(p)).ok()?;
        let v: serde_json::Value = serde_json::from_str(&s).ok()?;
        let c = v["command"].as_str()?.trim();
        (!c.is_empty()).then(|| c.to_string())
    })
}

/// Whether `dir` is a Tauri desktop project.
pub fn is_tauri(dir: &Path) -> bool {
    dir.join("src-tauri/tauri.conf.json").exists()
        || dir.join("src-tauri/Cargo.toml").exists()
        || dir.join("tauri.conf.json").exists()
}

/// Detected run command (no install step), or None when nothing is runnable.
pub fn detect_command(dir: &Path) -> Option<String> {
    if let Some(c) = custom_command(dir) {
        return Some(c);
    }
    if is_tauri(dir) {
        return Some(match package_manager(dir) {
            "pnpm" => "pnpm tauri dev".into(),
            "yarn" => "yarn tauri dev".into(),
            "bun" => "bun run tauri dev".into(),
            _ => "npm run tauri dev".into(),
        });
    }
    if has_dev_script(dir) {
        return Some(match package_manager(dir) {
            "pnpm" => "pnpm dev".into(),
            "yarn" => "yarn dev".into(),
            "bun" => "bun run dev".into(),
            _ => "npm run dev".into(),
        });
    }
    if dir.join("Cargo.toml").exists() {
        return Some("cargo run".into());
    }
    None
}

/// Isolated data dir for a time-machine Tauri child, so it never contends
/// for the main instance's SQLite lock.
pub fn isolated_data_dir(sha: &str) -> PathBuf {
    std::env::temp_dir().join(format!("ompws-tm-{sha}"))
}

/// Full shell command: optional dependency install followed by the run command.
pub fn full_command(dir: &Path, command: Option<&str>) -> Option<String> {
    let run = match command.map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) => c.to_string(),
        None => detect_command(dir)?,
    };
    if dir.join("package.json").exists() && !dir.join("node_modules").exists() {
        Some(format!("{} && {run}", install_cmd(dir)))
    } else {
        Some(run)
    }
}

/// PATH with common user tool locations prepended (GUI apps get a minimal PATH).
pub fn augmented_path() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let mut parts: Vec<String> = [
        home.join(".local/bin"),
        home.join(".bun/bin"),
        home.join(".cargo/bin"),
        home.join("Library/pnpm"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]
    .iter()
    .map(|p| p.to_string_lossy().into_owned())
    .collect();
    if let Ok(cur) = std::env::var("PATH") {
        parts.extend(cur.split(':').map(str::to_string));
    }
    let mut seen = std::collections::HashSet::new();
    parts.retain(|p| !p.is_empty() && seen.insert(p.clone()));
    parts.join(":")
}

fn push_line(run_id: &str, line: String, sink: &LogSink) {
    {
        let mut map = runs().lock();
        let Some(run) = map.get_mut(run_id) else {
            return;
        };
        if run.info.url.is_none() {
            run.info.url = detect_url(&line);
        }
        run.log.push_back(line.clone());
        while run.log.len() > LOG_LINES {
            run.log.pop_front();
        }
    }
    sink(run_id, &line);
}

fn pump<R: Read + Send + 'static>(reader: R, run_id: String, sink: LogSink) {
    std::thread::spawn(move || {
        let mut r = BufReader::new(reader);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match r.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let raw = String::from_utf8_lossy(&buf);
                    let line = strip_ansi(raw.trim_end_matches(['\n', '\r']));
                    // Progress bars redraw with \r; keep the last frame.
                    let line = line.rsplit('\r').next().unwrap_or_default().to_string();
                    push_line(&run_id, line, &sink);
                }
            }
        }
    });
}

fn snapshot(run: &Run) -> TmRun {
    let mut info = run.info.clone();
    info.log_tail = run.log.iter().cloned().collect::<Vec<_>>().join("\n");
    info
}

/// Start (or return the already-running) time-machine run for `sha`.
pub fn run(repo: &Path, sha: &str, command: Option<&str>, sink: LogSink) -> Result<TmRun, String> {
    if !valid_sha(sha) {
        return Err("invalid commit id".into());
    }
    let full_sha = git_ok(
        repo,
        &["rev-parse", "--verify", &format!("{sha}^{{commit}}")],
    )?
    .trim()
    .to_string();
    let repo_root = worktree::repo_info(repo)
        .ok_or("不是 git 仓库")?
        .main_root();
    let repo_s = repo_root.to_string_lossy().into_owned();
    {
        let mut map = runs().lock();
        if let Some(r) = map
            .values()
            .find(|r| r.info.repo == repo_s && r.info.sha == full_sha && r.info.pid.is_some())
        {
            return Ok(snapshot(r));
        }
        // Drop finished runs of the same commit; the worktree is reused.
        map.retain(|_, r| !(r.info.repo == repo_s && r.info.sha == full_sha));
    }
    let short: String = full_sha.chars().take(8).collect();
    let wt = worktree::create_detached(&repo_root, &format!("tm-{short}"), &full_sha)?;
    let id = uuid::Uuid::new_v4().to_string();
    let full = full_command(&wt, command);
    let mut info = TmRun {
        id: id.clone(),
        repo: repo_s,
        sha: full_sha,
        worktree: wt.to_string_lossy().into_owned(),
        command: full.clone().unwrap_or_default(),
        pid: None,
        url: None,
        log_tail: String::new(),
    };
    let Some(full) = full else {
        let mut log = VecDeque::new();
        log.push_back(format!(
            "未检测到可运行的命令，已创建 worktree：{}",
            info.worktree
        ));
        let run = Run { info, log };
        let snap = snapshot(&run);
        runs().lock().insert(id, run);
        return Ok(snap);
    };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = Command::new(shell);
    cmd.arg("-lc")
        .arg(&full)
        .current_dir(&wt)
        .env("PATH", augmented_path())
        .env("BROWSER", "none")
        .env("FORCE_COLOR", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if is_tauri(&wt) {
        cmd.env("OMPWS_DATA_DIR", isolated_data_dir(&info.sha));
    }
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| format!("启动失败：{e}"))?;
    info.pid = Some(child.id());
    let mut log = VecDeque::new();
    log.push_back(format!("$ {full}"));
    let run = Run { info, log };
    let snap = snapshot(&run);
    runs().lock().insert(id.clone(), run);
    if let Some(out) = child.stdout.take() {
        pump(out, id.clone(), sink.clone());
    }
    if let Some(err) = child.stderr.take() {
        pump(err, id.clone(), sink.clone());
    }
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        if let Some(r) = runs().lock().get_mut(&id) {
            r.info.pid = None;
        }
        let msg = match code {
            Some(c) => format!("[进程已退出，退出码 {c}]"),
            None => "[进程已被终止]".to_string(),
        };
        push_line(&id, msg, &sink);
    });
    Ok(snap)
}

pub fn list() -> Vec<TmRun> {
    let mut v: Vec<TmRun> = runs().lock().values().map(snapshot).collect();
    v.sort_by(|a, b| a.worktree.cmp(&b.worktree));
    v
}

/// Process-group ids of live runs (used by services to flag `started_by_app`).
pub fn app_pgids() -> Vec<i32> {
    runs()
        .lock()
        .values()
        .filter_map(|r| r.info.pid.map(|p| p as i32))
        .collect()
}

fn group_alive(pgid: i32) -> bool {
    // SAFETY: kill with signal 0 only checks for existence/permission.
    unsafe { libc::kill(-pgid, 0) == 0 }
}

/// Terminate a process group: SIGTERM, wait ≤3 s, then SIGKILL.
pub fn kill_group(pgid: i32) {
    // SAFETY: getpgid(0) only queries our own process group.
    let own = unsafe { libc::getpgid(0) };
    if pgid <= 1 || pgid == own {
        return;
    }
    // SAFETY: plain signal delivery to a process group we spawned.
    unsafe {
        libc::kill(-pgid, libc::SIGTERM);
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while group_alive(pgid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    if group_alive(pgid) {
        // SAFETY: as above.
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
}

/// Stop a run's process group and optionally remove its worktree.
pub fn stop(run_id: &str, remove_worktree: bool) -> Result<(), String> {
    let (pid, repo, wt) = {
        let map = runs().lock();
        let r = map.get(run_id).ok_or("运行记录不存在")?;
        (r.info.pid, r.info.repo.clone(), r.info.worktree.clone())
    };
    if let Some(pid) = pid {
        kill_group(pid as i32);
        // Reflect the stop immediately; the waiter thread may lag behind.
        if let Some(r) = runs().lock().get_mut(run_id) {
            r.info.pid = None;
        }
    }
    if remove_worktree {
        runs().lock().remove(run_id);
        if Path::new(&wt).exists() {
            worktree::remove(Path::new(&repo), Path::new(&wt), false, true)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_vite_url_through_ansi() {
        let raw = "  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m";
        let line = strip_ansi(raw);
        assert_eq!(detect_url(&line).as_deref(), Some("http://localhost:5173/"));
        assert_eq!(
            detect_url("listening on http://0.0.0.0:3000.").as_deref(),
            Some("http://localhost:3000")
        );
        assert_eq!(detect_url("see https://example.com:443"), None);
    }

    #[test]
    fn command_detection() {
        let dir = PathBuf::from(format!(
            "/tmp/ompws-test-c/tm-detect-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(full_command(&dir, None), None);
        std::fs::write(dir.join("Cargo.toml"), "[package]").unwrap();
        assert_eq!(full_command(&dir, None).as_deref(), Some("cargo run"));
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(
            full_command(&dir, None).as_deref(),
            Some("pnpm install --frozen-lockfile && pnpm dev")
        );
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        assert_eq!(full_command(&dir, None).as_deref(), Some("pnpm dev"));
        assert_eq!(
            full_command(&dir, Some("make run")).as_deref(),
            Some("make run")
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn fresh(name: &str) -> PathBuf {
        let dir = PathBuf::from(format!(
            "/tmp/ompws-test-c/tm-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_project_kinds() {
        let web = fresh("web");
        std::fs::write(web.join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).unwrap();
        std::fs::write(web.join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(detect_command(&web).as_deref(), Some("pnpm dev"));

        let tauri = fresh("tauri");
        std::fs::write(tauri.join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).unwrap();
        std::fs::write(tauri.join("pnpm-lock.yaml"), "").unwrap();
        std::fs::create_dir_all(tauri.join("src-tauri")).unwrap();
        std::fs::write(tauri.join("src-tauri/tauri.conf.json"), "{}").unwrap();
        assert!(is_tauri(&tauri));
        assert_eq!(detect_command(&tauri).as_deref(), Some("pnpm tauri dev"));

        let cargo = fresh("cargo");
        std::fs::write(cargo.join("Cargo.toml"), "[package]").unwrap();
        assert!(!is_tauri(&cargo));
        assert_eq!(detect_command(&cargo).as_deref(), Some("cargo run"));

        std::fs::create_dir_all(tauri.join(".omp")).unwrap();
        std::fs::write(tauri.join(".omp/run.json"), r#"{"command":"make serve"}"#).unwrap();
        assert_eq!(detect_command(&tauri).as_deref(), Some("make serve"));
        std::fs::create_dir_all(tauri.join(".omp-workspace")).unwrap();
        std::fs::write(tauri.join(".omp-workspace/run.json"), r#"{"command":"just dev"}"#).unwrap();
        assert_eq!(detect_command(&tauri).as_deref(), Some("just dev"));

        for d in [web, tauri, cargo] {
            std::fs::remove_dir_all(d).unwrap();
        }
    }
}
