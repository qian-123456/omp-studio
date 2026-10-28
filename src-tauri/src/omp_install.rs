//! In-app installer for the omp CLI (the app's engine): runs the official
//! `https://omp.sh/install --binary` script, streams its output and download progress
//! (`omp:install` event) and re-probes omp afterwards. macOS/Linux only.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::Emitter as _;

use crate::settings::OmpInfo;
use crate::state::AppState;

/// The installer downloads a ~200 MB binary; leave generous headroom for slow routes.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(1800);
const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// How long to wait for the output readers after the installer exited.
const READER_DRAIN: Duration = Duration::from_secs(5);
const DOWNLOAD_PREFIX: &str = ".omp.download.";
#[cfg(unix)]
const INSTALL_SCRIPT: &str = r#"script=$(curl -fsSL --connect-timeout 20 https://omp.sh/install) || { echo "下载安装脚本失败：无法访问 https://omp.sh/install" >&2; exit 1; }
printf '%s\n' "$script" | sh -s -- --binary"#;
#[cfg(not(unix))]
const WINDOWS_UNSUPPORTED: &str =
    "Windows 暂不支持自动安装，请在 PowerShell 运行：irm https://omp.sh/install.ps1 | iex";
#[cfg(unix)]
const MANUAL_COMMAND: &str = "curl -fsSL https://omp.sh/install | sh -s -- --binary";

/// Return value of `omp_install_run`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpInstallResult {
    pub success: bool,
    /// ANSI-stripped full log; on failure ends with a plain Chinese hint.
    pub output: String,
    /// omp info re-probed after the run.
    pub info: OmpInfo,
}

/// Payload of the `omp:install` event.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OmpInstallProgress {
    /// One ANSI-stripped output line.
    pub line: Option<String>,
    /// Size of the in-progress `.omp.download.*` file in the install dir.
    pub downloaded_bytes: Option<u64>,
}

/// How an installer run ended.
#[derive(Debug, Clone, PartialEq)]
struct InstallOutcome {
    pub success: bool,
    pub output: String,
}

struct Active {
    run_id: String,
    pgid: Option<u32>,
    cancelled: bool,
}

const MAX_CANCELLATION_REQUESTS: usize = 32;

#[derive(Default)]
struct InstallState {
    active: Option<Active>,
    pending_cancels: VecDeque<String>,
    finished_requests: VecDeque<String>,
}

impl InstallState {
    fn remember(requests: &mut VecDeque<String>, run_id: String) {
        if requests.contains(&run_id) {
            return;
        }
        if requests.len() == MAX_CANCELLATION_REQUESTS {
            requests.pop_front();
        }
        requests.push_back(run_id);
    }

    fn begin(&mut self, run_id: String) -> Result<(), String> {
        if let Some(active) = self.active.as_ref() {
            if active.run_id != run_id {
                self.retire(run_id);
            }
            return Err("omp 正在安装中".to_string());
        }
        if self.finished_requests.contains(&run_id) {
            return Err("安装请求已结束".to_string());
        }
        let cancelled = self
            .pending_cancels
            .iter()
            .position(|id| id == &run_id)
            .and_then(|index| self.pending_cancels.remove(index))
            .is_some();
        self.active = Some(Active {
            run_id,
            pgid: None,
            cancelled,
        });
        Ok(())
    }

    fn cancel(&mut self, run_id: String) {
        if let Some(active) = self.active.as_mut() {
            if active.run_id == run_id {
                active.cancelled = true;
                if let Some(pgid) = active.pgid {
                    kill_group(pgid);
                }
                return;
            }
        }
        // Commands run on independent async tasks: cancel can be polled before begin.
        if !self.finished_requests.contains(&run_id) {
            Self::remember(&mut self.pending_cancels, run_id);
        }
    }

    fn retire(&mut self, run_id: String) {
        self.pending_cancels.retain(|id| id != &run_id);
        Self::remember(&mut self.finished_requests, run_id);
    }

    fn finish(&mut self) {
        if let Some(active) = self.active.take() {
            if let Some(pgid) = active.pgid {
                kill_group(pgid);
            }
            self.retire(active.run_id);
        }
    }
}

/// Single-flight ownership and bounded pre-registration/finished request records share a lock.
static INSTALL_STATE: Mutex<InstallState> = Mutex::new(InstallState {
    active: None,
    pending_cancels: VecDeque::new(),
    finished_requests: VecDeque::new(),
});

fn lock_install() -> std::sync::MutexGuard<'static, InstallState> {
    INSTALL_STATE.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(unix)]
fn kill_group(pgid: u32) {
    // SAFETY: the group was created by `process_group(0)` for this installer only; a group
    // that is already gone just yields ESRCH.
    unsafe {
        libc::killpg(pgid as libc::pid_t, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn kill_group(_pgid: u32) {}

/// Holds the single-flight slot; releasing it (also on drop of the future) kills any
/// leftover installer process group.
struct InstallGuard;

impl InstallGuard {
    fn begin(run_id: String) -> Result<Self, String> {
        lock_install().begin(run_id)?;
        Ok(InstallGuard)
    }

    fn is_cancelled(&self) -> bool {
        lock_install().active.as_ref().is_some_and(|a| a.cancelled)
    }

    /// Registers the spawned group; returns true when a cancel arrived before that.
    fn set_pgid(&self, pgid: u32) -> bool {
        let mut state = lock_install();
        match state.active.as_mut() {
            Some(a) => {
                a.pgid = Some(pgid);
                a.cancelled
            }
            None => false,
        }
    }

    /// Forgets the group once the leader was reaped (its id may be reused afterwards).
    fn clear_pgid(&self) -> bool {
        let mut state = lock_install();
        match state.active.as_mut() {
            Some(a) => {
                a.pgid = None;
                a.cancelled
            }
            None => false,
        }
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        lock_install().finish();
    }
}

/// Aborts the wrapped task when dropped, so the poller stops on every exit path.
struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Install dir used by the official installer: `$PI_INSTALL_DIR` or `$HOME/.local/bin`.
fn install_dir() -> PathBuf {
    match std::env::var_os("PI_INSTALL_DIR") {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => dirs::home_dir().unwrap_or_default().join(".local/bin"),
    }
}

/// Size of the biggest in-progress `.omp.download.*` file among `(name, size)` entries.
fn pick_download_size<'a>(entries: impl IntoIterator<Item = (&'a str, u64)>) -> Option<u64> {
    entries
        .into_iter()
        .filter(|(name, _)| name.starts_with(DOWNLOAD_PREFIX))
        .map(|(_, size)| size)
        .max()
}

async fn download_size(dir: &Path) -> Option<u64> {
    let mut rd = tokio::fs::read_dir(dir).await.ok()?;
    let mut found = Vec::new();
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(DOWNLOAD_PREFIX) {
            continue;
        }
        if let Ok(meta) = entry.metadata().await {
            found.push((name, meta.len()));
        }
    }
    pick_download_size(found.iter().map(|(n, s)| (n.as_str(), *s)))
}

/// Splits raw installer output into display lines: ANSI stripped, `\r` progress rewrites
/// split apart, blanks dropped.
fn clean_lines(raw: &str) -> Vec<String> {
    crate::git::tm::strip_ansi(raw)
        .split(['\n', '\r'])
        .map(str::trim_end)
        .filter(|l| !l.trim().is_empty())
        .map(str::to_string)
        .collect()
}

/// Builds the final log: the collected output, plus a plain Chinese hint on failure.
fn build_output(
    log: &str,
    success: bool,
    cancelled: bool,
    timed_out: bool,
    code: Option<i32>,
) -> String {
    let body = log.trim();
    if success {
        return body.to_string();
    }
    let hint = if cancelled {
        "安装已取消。".to_string()
    } else if timed_out {
        format!(
            "安装超过 {} 分钟仍未完成，已终止。请检查网络后重试。",
            INSTALL_TIMEOUT.as_secs() / 60
        )
    } else {
        let code = code.map_or(String::new(), |c| format!("（退出码 {c}）"));
        #[cfg(unix)]
        let manual = MANUAL_COMMAND;
        #[cfg(not(unix))]
        let manual = "irm https://omp.sh/install.ps1 | iex";
        format!("安装失败{code}。请检查网络后重试，或在终端手动运行：{manual}")
    };
    if body.is_empty() {
        hint
    } else {
        format!("{body}\n\n{hint}")
    }
}

/// Runs the official installer, calling `emit` for every output line and download-size poll.
#[cfg(unix)]
async fn run_installer(
    guard: &InstallGuard,
    emit: impl Fn(OmpInstallProgress) + Send + Sync + Clone + 'static,
) -> Result<InstallOutcome, String> {
    use std::os::unix::process::CommandExt as _;
    use tokio::io::{AsyncBufReadExt as _, AsyncRead, BufReader};

    if guard.is_cancelled() {
        return Ok(InstallOutcome {
            success: false,
            output: build_output("", false, true, false, None),
        });
    }

    let mut cmd = std::process::Command::new("sh");
    cmd.arg("-c")
        .arg(INSTALL_SCRIPT)
        .current_dir(crate::settings::neutral_cwd()?)
        .env("PATH", crate::todos::omp::augmented_path())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Own process group so cancel/timeout also kill curl and the downloaded binary's helpers.
        .process_group(0);
    let mut cmd = tokio::process::Command::from(cmd);
    cmd.kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| format!("无法启动安装程序：{e}"))?;
    let pgid = child.id();
    if let Some(pgid) = pgid {
        if guard.set_pgid(pgid) {
            kill_group(pgid);
        }
    }

    let log = std::sync::Arc::new(Mutex::new(String::new()));
    fn spawn_reader<R: AsyncRead + Unpin + Send + 'static>(
        pipe: R,
        log: std::sync::Arc<Mutex<String>>,
        emit: impl Fn(OmpInstallProgress) + Send + 'static,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut reader = BufReader::new(pipe);
            let mut buf = Vec::new();
            // `read_until` + lossy decode: installer output is not guaranteed to be UTF-8.
            while let Ok(n) = reader.read_until(b'\n', &mut buf).await {
                if n == 0 {
                    break;
                }
                let raw = String::from_utf8_lossy(&buf).into_owned();
                buf.clear();
                for line in clean_lines(&raw) {
                    {
                        let mut l = log.lock().unwrap_or_else(|e| e.into_inner());
                        l.push_str(&line);
                        l.push('\n');
                    }
                    emit(OmpInstallProgress {
                        line: Some(line),
                        downloaded_bytes: None,
                    });
                }
            }
        })
    }
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(spawn_reader(out, log.clone(), emit.clone()));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(spawn_reader(err, log.clone(), emit.clone()));
    }

    let dir = install_dir();
    let poll_emit = emit.clone();
    let _poller = AbortOnDrop(tokio::spawn(async move {
        let mut tick = tokio::time::interval(POLL_INTERVAL);
        loop {
            tick.tick().await;
            if let Some(bytes) = download_size(&dir).await {
                poll_emit(OmpInstallProgress {
                    line: None,
                    downloaded_bytes: Some(bytes),
                });
            }
        }
    }));

    let mut timed_out = false;
    let status = match tokio::time::timeout(INSTALL_TIMEOUT, child.wait()).await {
        Ok(r) => r.map_err(|e| format!("等待安装程序失败：{e}")),
        Err(_) => {
            timed_out = true;
            if let Some(pgid) = pgid {
                kill_group(pgid);
            }
            child
                .wait()
                .await
                .map_err(|e| format!("等待安装程序失败：{e}"))
        }
    };
    // The leader is reaped now; make sure no group member (curl) lingers, then forget the id.
    let cancelled = guard.clear_pgid();
    for r in readers {
        let abort = r.abort_handle();
        if tokio::time::timeout(READER_DRAIN, r).await.is_err() {
            abort.abort();
        }
    }
    let status = status?;
    let log = log.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let success = status.success() && !cancelled && !timed_out;
    Ok(InstallOutcome {
        success,
        output: build_output(&log, success, cancelled, timed_out, status.code()),
    })
}

/// `omp_install_run` (§7): installs omp with the official installer (`--binary`).
#[tauri::command]
pub async fn omp_install_run(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<OmpInstallResult, String> {
    #[cfg(not(unix))]
    {
        let _ = &state;
        lock_install().retire(run_id);
        Err(WINDOWS_UNSUPPORTED.to_string())
    }
    #[cfg(unix)]
    {
        let guard = InstallGuard::begin(run_id)?;
        let app = state.app.clone();
        let outcome = run_installer(&guard, move |p| {
            let _ = app.emit("omp:install", p);
        })
        .await?;
        drop(guard);
        let (exe, path) = crate::settings::omp_exe(&state);
        let info = crate::settings::probe_omp_info(exe, &path).await?;
        Ok(OmpInstallResult {
            success: outcome.success,
            output: outcome.output,
            info,
        })
    }
}

/// `omp_install_cancel` (§7): cancels only this request, including before registration.
#[tauri::command]
pub async fn omp_install_cancel(run_id: String) -> Result<(), String> {
    lock_install().cancel(run_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_largest_download_file() {
        let entries = [
            ("omp", 999u64),
            (".omp.download.123", 10),
            (".omp.download.456", 20),
            (".other.download.1", 500),
        ];
        assert_eq!(pick_download_size(entries), Some(20));
        assert_eq!(pick_download_size([("omp", 5u64)]), None);
        assert_eq!(pick_download_size(std::iter::empty()), None);
    }

    #[test]
    fn clean_lines_strips_ansi_and_splits_cr() {
        let lines = clean_lines("\x1b[32m✓ Installed\x1b[0m omp\n\n  50%\r100%\r\n");
        assert_eq!(lines, vec!["✓ Installed omp", "  50%", "100%"]);
    }

    #[test]
    fn output_success_is_plain_log() {
        assert_eq!(build_output("a\nb\n", true, false, false, Some(0)), "a\nb");
    }

    #[test]
    fn output_failure_appends_hint() {
        let out = build_output("boom\n", false, false, false, Some(1));
        assert!(out.starts_with("boom\n\n安装失败（退出码 1）"));
        let out = build_output("", false, false, false, None);
        assert!(out.starts_with("安装失败。"));
    }

    #[test]
    fn output_cancel_and_timeout_hints() {
        assert!(build_output("x", false, true, false, None).ends_with("安装已取消。"));
        assert!(build_output("x", false, false, true, None).contains("30 分钟"));
        // Cancel wins over a non-zero exit code caused by the kill.
        assert!(build_output("", false, true, false, Some(137)).contains("已取消"));
    }

    #[tokio::test]
    async fn request_scoped_commands_preserve_single_flight_and_retry() {
        // Only test touching the global slot; no real installer is started.
        omp_install_cancel("before-begin".into()).await.unwrap();
        let cancelled = InstallGuard::begin("before-begin".into()).unwrap();
        assert!(cancelled.is_cancelled());
        #[cfg(unix)]
        {
            let outcome = run_installer(&cancelled, |_| panic!("cancelled run emitted progress"))
                .await
                .unwrap();
            assert!(!outcome.success);
            assert!(outcome.output.contains("已取消"));
        }
        drop(cancelled);

        let first = InstallGuard::begin("first".into()).expect("first install starts");
        assert!(!first.is_cancelled());
        omp_install_cancel("other-request".into()).await.unwrap();
        assert!(!first.is_cancelled());
        assert_eq!(
            InstallGuard::begin("overlapping".into()).err().as_deref(),
            Some("omp 正在安装中")
        );
        omp_install_cancel("first".into()).await.unwrap();
        assert!(first.is_cancelled());
        drop(first);
        let again = InstallGuard::begin("retry".into()).expect("slot is free after drop");
        omp_install_cancel("first".into()).await.unwrap();
        assert!(!again.is_cancelled());
        drop(again);
        assert!(lock_install().active.is_none());
    }

    #[test]
    fn cancel_before_begin_is_consumed_and_finished_request_is_cleaned_up() {
        let mut state = InstallState::default();
        state.cancel("pending".into());
        state.cancel("pending".into());
        assert_eq!(state.pending_cancels.len(), 1);
        state.begin("pending".into()).unwrap();
        assert!(state.active.as_ref().unwrap().cancelled);
        assert!(state.pending_cancels.is_empty());
        state.finish();
        assert!(state.active.is_none());
        assert_eq!(
            state.finished_requests.front().map(String::as_str),
            Some("pending")
        );
        state.cancel("pending".into());
        assert!(state.pending_cancels.is_empty());
        assert_eq!(state.begin("pending".into()).unwrap_err(), "安装请求已结束");
    }

    #[test]
    fn mismatched_and_late_cancels_do_not_cancel_another_request() {
        let mut state = InstallState::default();
        state.begin("first".into()).unwrap();
        state.cancel("not-yet-started".into());
        assert!(!state.active.as_ref().unwrap().cancelled);
        state.finish();

        state.begin("retry".into()).unwrap();
        state.cancel("first".into());
        assert!(!state.active.as_ref().unwrap().cancelled);
        assert_eq!(state.pending_cancels.len(), 1);
        state.cancel("retry".into());
        assert!(state.active.as_ref().unwrap().cancelled);
        state.finish();

        state.begin("not-yet-started".into()).unwrap();
        assert!(state.active.as_ref().unwrap().cancelled);
        assert!(state.pending_cancels.is_empty());
        state.finish();
    }

    #[test]
    fn rejected_request_drops_pending_cancel_without_retiring_the_active_owner() {
        let mut state = InstallState::default();
        state.begin("active".into()).unwrap();
        state.cancel("rejected".into());
        assert_eq!(
            state.begin("rejected".into()).unwrap_err(),
            "omp 正在安装中"
        );
        assert!(state.pending_cancels.is_empty());
        state.cancel("rejected".into());
        assert!(state.pending_cancels.is_empty());
        assert!(!state.active.as_ref().unwrap().cancelled);
        assert_eq!(state.begin("active".into()).unwrap_err(), "omp 正在安装中");
        assert!(!state.finished_requests.iter().any(|id| id == "active"));
        state.cancel("active".into());
        assert!(state.active.as_ref().unwrap().cancelled);
        state.finish();
    }

    #[test]
    fn cancellation_records_stay_bounded_across_request_lifecycles() {
        let mut state = InstallState::default();
        for index in 0..MAX_CANCELLATION_REQUESTS + 5 {
            state.cancel(format!("pending-{index}"));
        }
        assert_eq!(state.pending_cancels.len(), MAX_CANCELLATION_REQUESTS);
        assert_eq!(
            state.pending_cancels.front().map(String::as_str),
            Some("pending-5")
        );
        let newest = format!("pending-{}", MAX_CANCELLATION_REQUESTS + 4);
        state.cancel(newest.clone());
        assert_eq!(state.pending_cancels.len(), MAX_CANCELLATION_REQUESTS);
        state.begin(newest.clone()).unwrap();
        assert!(state.active.as_ref().unwrap().cancelled);
        assert_eq!(state.pending_cancels.len(), MAX_CANCELLATION_REQUESTS - 1);
        state.finish();
        state.cancel(newest);
        assert_eq!(state.pending_cancels.len(), MAX_CANCELLATION_REQUESTS - 1);

        for index in 0..MAX_CANCELLATION_REQUESTS + 5 {
            state.begin(format!("finished-{index}")).unwrap();
            state.finish();
        }
        assert_eq!(state.finished_requests.len(), MAX_CANCELLATION_REQUESTS);
        assert_eq!(
            state.finished_requests.front().map(String::as_str),
            Some("finished-5")
        );
        state.cancel(format!("finished-{}", MAX_CANCELLATION_REQUESTS + 4));
        assert_eq!(state.pending_cancels.len(), MAX_CANCELLATION_REQUESTS - 1);
        assert!(state.active.is_none());
    }
}
