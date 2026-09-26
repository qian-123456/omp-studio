//! PTY session registry (portable-pty). Output is delivered through a sink so
//! the core logic is testable without a Tauri app.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, OnceLock};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use super::env;

pub enum TermEvent {
    Data(Vec<u8>),
    Exit(Option<i32>),
}

pub type Sink = Arc<dyn Fn(&str, TermEvent) + Send + Sync>;

struct Term {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

fn registry() -> &'static Mutex<HashMap<String, Term>> {
    static REG: OnceLock<Mutex<HashMap<String, Term>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(10),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Spawn `argv` (empty → login shell) in a new PTY. Returns the termId.
pub fn open(
    cwd: &str,
    argv: &[String],
    cols: u16,
    rows: u16,
    sink: Sink,
) -> Result<String, String> {
    if !std::path::Path::new(cwd).is_dir() {
        return Err(format!("目录不存在: {cwd}"));
    }
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| format!("openpty: {e}"))?;

    let mut cmd = match argv.split_first() {
        Some((prog, args)) => {
            let resolved = env::which(prog).ok_or_else(|| format!("找不到命令: {prog}"))?;
            let mut c = CommandBuilder::new(resolved);
            c.args(args);
            c
        }
        None => {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            let mut c = CommandBuilder::new(shell);
            c.arg("-l");
            c
        }
    };
    cmd.cwd(cwd);
    cmd.env("PATH", env::augmented_path());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    // Inject configured API provider keys (best effort; never logged).
    for (key, value) in crate::providers::env_pairs() {
        cmd.env(key, value);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {e}"))?;
    // Drop our slave handle so the reader sees EOF once the child exits.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("pty writer: {e}"))?;
    let killer = child.clone_killer();
    let id = uuid::Uuid::new_v4().to_string();
    registry().lock().insert(
        id.clone(),
        Term {
            master: pair.master,
            writer,
            killer,
        },
    );

    let tid = id.clone();
    std::thread::Builder::new()
        .name(format!("pty-{}", &id[..8]))
        .spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => sink(&tid, TermEvent::Data(buf[..n].to_vec())),
                }
            }
            let code = child.wait().ok().map(|s| s.exit_code() as i32);
            registry().lock().remove(&tid);
            sink(&tid, TermEvent::Exit(code));
        })
        .map_err(|e| format!("reader thread: {e}"))?;
    Ok(id)
}

pub fn write(term_id: &str, data: &[u8]) -> Result<(), String> {
    let mut reg = registry().lock();
    let term = reg.get_mut(term_id).ok_or("终端不存在或已退出")?;
    term.writer
        .write_all(data)
        .and_then(|_| term.writer.flush())
        .map_err(|e| format!("write: {e}"))
}

pub fn resize(term_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let reg = registry().lock();
    let term = reg.get(term_id).ok_or("终端不存在或已退出")?;
    term.master
        .resize(size(cols, rows))
        .map_err(|e| format!("resize: {e}"))
}

/// Kill the child and forget the terminal. Idempotent.
pub fn close(term_id: &str) {
    if let Some(mut term) = registry().lock().remove(term_id) {
        let _ = term.killer.kill();
    }
}

/// Kill every open terminal (app shutdown / teardown). Idempotent.
pub fn close_all() {
    let terms: Vec<Term> = registry().lock().drain().map(|(_, t)| t).collect();
    for mut term in terms {
        let _ = term.killer.kill();
    }
}

#[cfg(test)]
fn is_open(term_id: &str) -> bool {
    registry().lock().contains_key(term_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn channel_sink() -> (Sink, mpsc::Receiver<TermEvent>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        (
            Arc::new(move |_id: &str, ev| {
                let _ = tx.lock().send(ev);
            }),
            rx,
        )
    }

    fn collect(rx: &mpsc::Receiver<TermEvent>) -> (String, Option<i32>) {
        let mut out = Vec::new();
        loop {
            match rx.recv_timeout(Duration::from_secs(10)).expect("pty event") {
                TermEvent::Data(d) => out.extend(d),
                TermEvent::Exit(code) => return (String::from_utf8_lossy(&out).to_string(), code),
            }
        }
    }

    #[test]
    fn runs_command_and_reports_exit() {
        let (sink, rx) = channel_sink();
        let argv = vec!["sh".into(), "-c".into(), "echo hello-pty; exit 3".into()];
        let id = open("/tmp", &argv, 80, 24, sink).unwrap();
        let (out, code) = collect(&rx);
        assert!(out.contains("hello-pty"), "output: {out:?}");
        assert_eq!(code, Some(3));
        assert!(!is_open(&id));
    }

    #[test]
    fn write_resize_and_close() {
        let (sink, rx) = channel_sink();
        let argv = vec!["cat".into()];
        let id = open("/tmp", &argv, 80, 24, sink).unwrap();
        resize(&id, 120, 40).unwrap();
        write(&id, b"ping-pty\n").unwrap();
        let mut out = Vec::new();
        while !String::from_utf8_lossy(&out).contains("ping-pty") {
            if let TermEvent::Data(d) = rx.recv_timeout(Duration::from_secs(10)).unwrap() {
                out.extend(d);
            }
        }
        close(&id);
        let (_, _code) = collect(&rx);
        assert!(write(&id, b"x").is_err());
    }

    #[test]
    fn rejects_missing_cwd_and_binary() {
        let (sink, _rx) = channel_sink();
        assert!(open("/no/such/dir", &[], 80, 24, sink.clone()).is_err());
        assert!(open("/tmp", &["no-such-binary-xyz".into()], 80, 24, sink).is_err());
    }
}
