//! Process helpers: run `git` / arbitrary commands with a timeout.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Default timeout for git invocations.
pub const GIT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone)]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
    /// Human-readable error for a failed command.
    pub fn err_msg(&self) -> String {
        let msg = self.stderr.trim();
        if msg.is_empty() {
            format!("exit code {:?}", self.code)
        } else {
            msg.to_string()
        }
    }
}

/// Run a command to completion, killing it after `timeout`.
pub fn run(mut cmd: Command, timeout: Duration) -> Result<Output, String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let mut out = child.stdout.take().expect("piped stdout");
    let mut err = child.stderr.take().expect("piped stderr");
    let out_t = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let err_t = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = err.read_to_end(&mut buf);
        buf
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out_t.join();
                let _ = err_t.join();
                return Err(format!("wait failed: {e}"));
            }
        }
    };
    let stdout = out_t.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&err_t.join().unwrap_or_default()).into_owned();
    match status {
        Some(st) => Ok(Output {
            code: st.code(),
            stdout,
            stderr,
        }),
        None => Err(format!("command timed out after {}s", timeout.as_secs())),
    }
}

/// Base `git -C <dir>` command with lock-free, non-interactive env.
pub fn git_cmd(dir: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    cmd
}

/// Run `git -C dir <args>` with the default timeout.
pub fn git(dir: &Path, args: &[&str]) -> Result<Output, String> {
    let mut cmd = git_cmd(dir);
    cmd.args(args);
    run(cmd, GIT_TIMEOUT)
}

/// Run git and return stdout text, or Err(stderr) on non-zero exit.
pub fn git_ok(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = git(dir, args)?;
    if out.ok() {
        Ok(out.text())
    } else {
        Err(out.err_msg())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_times_out() {
        let mut cmd = Command::new("sleep");
        cmd.arg("5");
        let err = run(cmd, Duration::from_millis(100)).unwrap_err();
        assert!(err.contains("timed out"));
    }

    #[test]
    fn run_captures_output() {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "echo hi; echo oops >&2; exit 3"]);
        let out = run(cmd, Duration::from_secs(5)).unwrap();
        assert_eq!(out.text(), "hi\n");
        assert_eq!(out.code, Some(3));
        assert_eq!(out.err_msg(), "oops");
    }
}
