//! RpcProcess: spawn `omp --mode rpc`, protocol handshake, stdout reader,
//! stdin writer, request/response correlation.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdout};
use tokio::sync::{mpsc, oneshot, watch};

use crate::contracts::{LiveSessionInfo, PendingUiRequest, Settings, StartOpts};
use crate::rpc::frame::ChunkReassembler;
use crate::state::{AppEvent, AppState};
use crate::{paths, rpc};

const READY_TIMEOUT: Duration = Duration::from_secs(30);
const CMD_TIMEOUT: Duration = Duration::from_secs(120);
/// Compaction/handoff summarise the whole context with a model call and can
/// legitimately run for many minutes.
const LONG_CMD_TIMEOUT: Duration = Duration::from_secs(900);
/// Grace period between stdin close and SIGKILL on stop.
const STOP_GRACE: Duration = Duration::from_secs(5);

static REQ_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Request-id → response channel map. Responses echo the command `id`.
#[derive(Default)]
pub struct PendingMap {
    map: parking_lot::Mutex<HashMap<String, oneshot::Sender<Value>>>,
}

impl PendingMap {
    pub fn insert(&self, id: String) -> oneshot::Receiver<Value> {
        let (tx, rx) = oneshot::channel();
        self.map.lock().insert(id, tx);
        rx
    }

    /// Resolve a pending request. Returns false when the id is unknown
    /// (e.g. a same-id late `prompt` error after an early ack, or unsolicited).
    pub fn resolve(&self, id: &str, value: Value) -> bool {
        if let Some(tx) = self.map.lock().remove(id) {
            let _ = tx.send(value);
            return true;
        }
        false
    }

    /// Fail every outstanding request (process exit / stdin closed).
    pub fn fail_all(&self, msg: &str) {
        let pending = std::mem::take(&mut *self.map.lock());
        for (id, tx) in pending {
            let _ = tx.send(json!({
                "id": id,
                "type": "response",
                "success": false,
                "error": msg,
            }));
        }
    }
}

/// UI-request methods that wait for a host answer (track for rpc_pending_ui).
const DIALOG_METHODS: [&str; 4] = ["select", "confirm", "input", "editor"];

pub struct SessionHandle {
    pub session_id: parking_lot::RwLock<String>,
    pub session_file: parking_lot::RwLock<String>,
    pub cwd: String,
    pub pid: u32,
    /// Outbound JSONL lines (one command per line).
    pub stdin_tx: mpsc::UnboundedSender<String>,
    /// Signalled to close stdin → graceful omp exit.
    pub shutdown: watch::Sender<bool>,
    pub pending: PendingMap,
    pub pending_ui: parking_lot::Mutex<Vec<PendingUiRequest>>,
    pub pending_frames: parking_lot::Mutex<Vec<Value>>,
    pub streaming: AtomicBool,
    pub alive: AtomicBool,
    pub last_activity: parking_lot::Mutex<Instant>,
    /// Identity of the omp binary exec'd at spawn (`omp_fingerprint`); None if unknown.
    pub omp_fingerprint: Option<String>,
    /// `privacy::native_hash()` at spawn (native secrets.yml snapshot the process loaded).
    pub native_hash: String,
}

impl SessionHandle {
    #[cfg(test)]
    pub fn for_test() -> Self {
        let (stdin_tx, _rx) = mpsc::unbounded_channel();
        let (shutdown, _srx) = watch::channel(false);
        Self {
            session_id: parking_lot::RwLock::new("s1".to_string()),
            session_file: parking_lot::RwLock::new("/tmp/s1.jsonl".to_string()),
            cwd: "/tmp".to_string(),
            pid: 0,
            stdin_tx,
            shutdown,
            pending: PendingMap::default(),
            pending_ui: parking_lot::Mutex::new(Vec::new()),
            pending_frames: parking_lot::Mutex::new(Vec::new()),
            streaming: AtomicBool::new(false),
            alive: AtomicBool::new(true),
            last_activity: parking_lot::Mutex::new(Instant::now()),
            omp_fingerprint: None,
            native_hash: String::new(),
        }
    }

    pub fn info(&self) -> LiveSessionInfo {
        LiveSessionInfo {
            session_id: self.session_id.read().clone(),
            session_file: self.session_file.read().clone(),
            pid: self.pid,
            cwd: self.cwd.clone(),
        }
    }

    pub fn touch(&self) {
        *self.last_activity.lock() = Instant::now();
    }
}

/// Opaque identity of the file `bin` resolves to under `path` (the PATH given
/// to the child): canonical path + mtime + size. Stat only; None if unresolvable.
pub(crate) fn omp_fingerprint(bin: &str, path: &str) -> Option<String> {
    let exe = crate::todos::omp::resolve_binary(bin, path);
    let canonical = std::fs::canonicalize(&exe).ok()?;
    let meta = std::fs::metadata(&canonical).ok()?;
    if !meta.is_file() {
        return None;
    }
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Some(format!("{}|{mtime}|{}", canonical.display(), meta.len()))
}

/// Fingerprint of the omp binary a new session spawned now would exec.
pub(crate) async fn current_omp_fingerprint(settings: &Settings) -> Option<String> {
    let path = augmented_path().await;
    omp_fingerprint(&settings.omp_binary, &path)
}

/// Sessions whose spawn fingerprint is known and differs from `current`.
/// Unknown spawn fingerprints, or an unknown current one, are never stale.
pub(crate) fn stale_session_ids<'a>(
    current: Option<&str>,
    sessions: impl IntoIterator<Item = (&'a str, Option<&'a str>)>,
) -> Vec<String> {
    let Some(current) = current else {
        return Vec::new();
    };
    let mut ids: Vec<String> = sessions
        .into_iter()
        .filter(|(_, fp)| fp.is_some_and(|fp| fp != current))
        .map(|(id, _)| id.to_string())
        .collect();
    ids.sort();
    ids
}

/// Apply one inbound logical frame to handle state (no emission).
/// Testable without a running process.
pub(crate) fn apply_frame(handle: &SessionHandle, frame: &Value) {
    handle.touch();
    let ty = frame.get("type").and_then(Value::as_str).unwrap_or("");
    match ty {
        "response" => {
            if let Some(id) = frame.get("id").and_then(Value::as_str) {
                handle.pending.resolve(id, frame.clone());
            }
        }
        "extension_ui_request" => {
            let method = frame.get("method").and_then(Value::as_str).unwrap_or("");
            if DIALOG_METHODS.contains(&method) {
                let session_id = handle.session_id.read().clone();
                handle.pending_ui.lock().push(PendingUiRequest {
                    session_id,
                    request: frame.clone(),
                    received_at: chrono::Utc::now().to_rfc3339(),
                });
            } else if method == "cancel" {
                // Cancels a previously issued request: match targetId or id.
                let target = frame
                    .get("targetId")
                    .and_then(Value::as_str)
                    .or_else(|| frame.get("id").and_then(Value::as_str))
                    .map(str::to_string);
                if let Some(target) = target {
                    handle.pending_ui.lock().retain(|r| {
                        r.request.get("id").and_then(Value::as_str) != Some(target.as_str())
                    });
                }
            }
        }
        "agent_start" => handle.streaming.store(true, Ordering::SeqCst),
        "agent_end" if frame.get("isTerminal").and_then(Value::as_bool) != Some(false) => {
            handle.streaming.store(false, Ordering::SeqCst);
        }
        _ => {}
    }
}

/// Outbound events from a session process (frontend `rpc:*` + bus events).
/// Abstracted so tests can run a real process without a Tauri AppHandle.
pub(crate) enum OutEvent {
    Frame {
        session_id: String,
        frame: Value,
    },
    Process {
        session_id: String,
        running: bool,
        exit_code: Option<i32>,
    },
}

pub(crate) type OutSink = Arc<dyn Fn(OutEvent) + Send + Sync + 'static>;

/// Production sink: `rpc:frame`/`rpc:process` to the webview + AppEvent on the bus.
pub(crate) fn sink_from_state(state: &AppState) -> OutSink {
    let state = state.clone();
    Arc::new(move |ev| match ev {
        OutEvent::Frame { session_id, frame } => {
            let _ = state.app.emit(
                "rpc:frame",
                json!({ "sessionId": session_id, "frame": frame }),
            );
            state.emit(AppEvent::RpcFrame { session_id, frame });
        }
        OutEvent::Process {
            session_id,
            running,
            exit_code,
        } => {
            let _ = state.app.emit(
                "rpc:process",
                json!({ "sessionId": session_id, "running": running, "exitCode": exit_code }),
            );
            state.emit(AppEvent::RpcProcess {
                session_id,
                running,
                exit_code,
            });
        }
    })
}

/// Emit a frame to the frontend (`rpc:frame`) and the bus (`AppEvent::RpcFrame`).
fn emit_frame(sink: &OutSink, handle: &SessionHandle, frame: &Value) {
    let session_id = handle.session_id.read().clone();
    if session_id.is_empty() {
        let mut guard = handle.pending_frames.lock();
        let session_id = handle.session_id.read().clone();
        if session_id.is_empty() {
            guard.push(frame.clone());
            return;
        }
        drop(guard);
        sink(OutEvent::Frame {
            session_id,
            frame: frame.clone(),
        });
        return;
    }
    sink(OutEvent::Frame {
        session_id,
        frame: frame.clone(),
    });
}

fn drain_pending_frames(sink: &OutSink, handle: &SessionHandle) {
    let frames = {
        let mut guard = handle.pending_frames.lock();
        std::mem::take(&mut *guard)
    };
    for frame in frames {
        emit_frame(sink, handle, &frame);
    }
}

/// macOS GUI apps get a minimal PATH — merge the login-shell PATH once and
/// prepend the usual user bins.
async fn augmented_path() -> String {
    static CACHED: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();
    CACHED
        .get_or_init(|| async {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
            let mut parts: Vec<String> = vec![
                home.join(".local/bin").to_string_lossy().to_string(),
                home.join(".bun/bin").to_string_lossy().to_string(),
                "/opt/homebrew/bin".to_string(),
                "/usr/local/bin".to_string(),
            ];
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            let login_path = tokio::time::timeout(Duration::from_secs(3), async {
                tokio::process::Command::new(shell)
                    .args(["-lc", "echo $PATH"])
                    .output()
                    .await
            })
            .await
            .ok()
            .and_then(Result::ok)
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty());
            if let Some(path) = login_path.or_else(|| std::env::var("PATH").ok()) {
                parts.push(path);
            }
            parts.join(":")
        })
        .await
        .clone()
}

/// Prompt-cache key a session transcript already uses, read from its `session`
/// header (`providerPromptCacheKey`). `fall_back_to_id` (forks) also accepts the
/// header's own `id`, which omp uses as the key when none is recorded. The
/// header sits within the first few lines (a `title` row may precede it).
fn transcript_cache_key(file: &str, fall_back_to_id: bool) -> Option<String> {
    use std::io::BufRead;
    let reader = std::io::BufReader::new(std::fs::File::open(file).ok()?);
    for line in reader.lines().take(4) {
        let Ok(v) = serde_json::from_str::<Value>(&line.ok()?) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("session") {
            continue;
        }
        let field = |k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        return field("providerPromptCacheKey").or_else(|| {
            if fall_back_to_id {
                field("id")
            } else {
                None
            }
        });
    }
    None
}

/// Prompt-shaping arguments shared by every app launch path for one transcript
/// (`build_command` here and `term_open_session`'s `omp --resume` terminal).
///
/// omp keys its provider prompt cache on the exact system prompt + tool shape
/// it sends, and it drops a transcript's inherited cache key as soon as a
/// cache-shape flag (`--model`, `--append-system-prompt`, `--plugin-dir`, …) is
/// present. Two launch paths for the same session must therefore produce the
/// *same* prompt-shaping argv or the first turn after switching views cold-misses
/// the whole prefix (transcript `system-prompt-digest` changes).
///
/// `append_system_prompt` is the RPC-only hidden-instruction channel (side chats);
/// the terminal cannot reproduce it because `StartOpts` is not persisted, so a
/// side chat's terminal gets the shared shape without it (documented tradeoff).
pub fn prompt_shape_args(
    resume_file: Option<&str>,
    fork_file: Option<&str>,
    append_system_prompt: Option<&str>,
    settings: &Settings,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    // omp falls back to the NEW session's id as the provider prompt-cache key
    // whenever any cache-shape flag is present, which sends a forked/resumed
    // session to a cold cache. Pin the key the source transcript already used.
    if let Some(key) = fork_file
        .and_then(|f| transcript_cache_key(f, true))
        .or_else(|| resume_file.and_then(|f| transcript_cache_key(f, false)))
    {
        args.push("--prompt-cache-key".to_string());
        args.push(key);
    }
    // Visualize skill plugin: loaded for app sessions unless the user opted
    // out (§settings.visualize_enabled). Registers the `visualize` skill +
    // `/skill:visualize` command in omp. A short standing hint tells the model
    // to use it proactively; the skill alone is only used when asked.
    let viz_dir = crate::visualize::spawn_plugin_dir(settings.visualize_enabled);
    let mut append_prompt = append_system_prompt
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or_default()
        .to_string();
    if viz_dir.is_some() {
        if !append_prompt.is_empty() {
            append_prompt.push_str("\n\n");
        }
        append_prompt.push_str(crate::prompts::VISUALIZE_HINT.trim());
    }
    if !append_prompt.is_empty() {
        args.push("--append-system-prompt".to_string());
        args.push(append_prompt);
    }
    // Extension list and order are part of the prompt shape: the status extension
    // reports progress (§8), checkpoints is opt-in (§8), privacy placeholders are
    // always on for app sessions.
    let status_ext = paths::extension_path();
    if status_ext.exists() {
        args.push("-e".to_string());
        args.push(status_ext.to_string_lossy().into_owned());
    }
    if settings.turn_checkpoints == Some(true) {
        let ext = paths::checkpoints_extension_path();
        if ext.exists() {
            args.push("-e".to_string());
            args.push(ext.to_string_lossy().into_owned());
        }
    }
    let privacy_ext = paths::privacy_extension_path();
    if privacy_ext.exists() {
        args.push("-e".to_string());
        args.push(privacy_ext.to_string_lossy().into_owned());
    }
    if let Some(dir) = viz_dir {
        args.push("--plugin-dir".to_string());
        args.push(dir.to_string_lossy().into_owned());
    }
    args
}

fn build_command(opts: &StartOpts, settings: &Settings) -> Result<tokio::process::Command, String> {
    let approval_mode = opts
        .approval_mode
        .clone()
        .unwrap_or_else(|| settings.default_approval_mode.clone());
    let mut cmd = tokio::process::Command::new(&settings.omp_binary);
    cmd.kill_on_drop(true);
    cmd.arg("--mode")
        .arg("rpc")
        .arg("--approval-mode")
        .arg(approval_mode)
        .arg("--cwd")
        .arg(&opts.cwd)
        .current_dir(&opts.cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let effective_model = opts.model.as_deref().or_else(|| {
        let m = settings.new_session_model.as_deref()?.trim();
        if m.is_empty() {
            None
        } else {
            Some(m)
        }
    });
    if let Some(model) = effective_model {
        cmd.arg("--model")
            .arg(crate::todos::omp::normalize_model_selector(model));
    }
    if let Some(file) = &opts.fork_file {
        cmd.arg("--fork").arg(file);
    }
    cmd.args(prompt_shape_args(
        opts.resume_file.as_deref(),
        opts.fork_file.as_deref(),
        opts.append_system_prompt.as_deref(),
        settings,
    ));
    if let Some(file) = &opts.resume_file {
        cmd.arg("--resume").arg(file);
    } else if opts.plan_yolo == Some(true) {
        cmd.arg("--plan-yolo");
    }
    Ok(cmd)
}

/// Send one command, correlating the response by generated id.
/// `success:false` → `Err(error)`.
pub async fn send_command(
    handle: &Arc<SessionHandle>,
    mut command: Value,
) -> Result<Value, String> {
    if !command.is_object() {
        return Err("command must be a JSON object".into());
    }
    if !handle.alive.load(Ordering::SeqCst) || *handle.shutdown.borrow() {
        return Err("session process is not running".into());
    }
    let id = format!("req_{}", REQ_COUNTER.fetch_add(1, Ordering::Relaxed));
    command["id"] = json!(id);
    let rx = handle.pending.insert(id.clone());
    handle
        .stdin_tx
        .send(command.to_string())
        .map_err(|_| "session stdin closed".to_string())?;
    let timeout = match command.get("type").and_then(Value::as_str) {
        Some("compact" | "handoff") => LONG_CMD_TIMEOUT,
        _ => CMD_TIMEOUT,
    };
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(resp)) => {
            if resp.get("success").and_then(Value::as_bool) == Some(false) {
                let err = resp
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("command failed");
                return Err(err.to_string());
            }
            Ok(resp)
        }
        Ok(Err(_)) => Err("response channel dropped".into()),
        Err(_) => Err("command timed out".into()),
    }
}

/// Write a fire-and-forget frame (extension_ui_response etc.).
pub fn send_raw(handle: &Arc<SessionHandle>, frame: Value) -> Result<(), String> {
    if !handle.alive.load(Ordering::SeqCst) || *handle.shutdown.borrow() {
        return Err("session process is not running".into());
    }
    handle
        .stdin_tx
        .send(frame.to_string())
        .map_err(|_| "session stdin closed".to_string())
}

/// Spawn + handshake (ready → negotiate v2 → get_state → subagent sub →
/// optional new_session{parentSession} + get_state). Returns a handle that is
/// NOT yet in the registry — `rpc::start` registers it.
pub async fn spawn(state: &AppState, opts: &StartOpts) -> Result<Arc<SessionHandle>, String> {
    let settings = state.settings.read().clone();
    spawn_with_sink(opts, &settings, sink_from_state(state)).await
}

/// Inner spawn used by tests (custom sink) and by `spawn`.
pub async fn spawn_with_sink(
    opts: &StartOpts,
    settings: &Settings,
    sink: OutSink,
) -> Result<Arc<SessionHandle>, String> {
    let mut cmd = build_command(opts, settings)?;
    let path = augmented_path().await;
    cmd.env("PATH", &path);
    // Same resolution std uses for the child (program looked up in the child's PATH).
    let omp_fingerprint = omp_fingerprint(&settings.omp_binary, &path);
    let mut native_hash = String::new();
    for (key, value) in crate::privacy::spawn_env() {
        if key == "OMPWS_PRIVACY_NATIVE_HASH" {
            native_hash.clone_from(&value);
        }
        cmd.env(key, value);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn omp failed ({path}): {e}"))?;
    let pid = child.id().unwrap_or(0);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "omp stdout not piped".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "omp stdin not piped".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(target: "omp-stderr", "{line}");
            }
        });
    }

    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let (ready_tx, ready_rx) = oneshot::channel::<Value>();

    let handle = Arc::new(SessionHandle {
        session_id: parking_lot::RwLock::new(String::new()),
        session_file: parking_lot::RwLock::new(String::new()),
        cwd: opts.cwd.clone(),
        pid,
        stdin_tx,
        shutdown: shutdown_tx,
        pending: PendingMap::default(),
        pending_ui: parking_lot::Mutex::new(Vec::new()),
        pending_frames: parking_lot::Mutex::new(Vec::new()),
        streaming: AtomicBool::new(false),
        alive: AtomicBool::new(true),
        last_activity: parking_lot::Mutex::new(Instant::now()),
        omp_fingerprint,
        native_hash,
    });

    // stdin writer task: drains the channel, exits on shutdown/close.
    let writer_handle = handle.clone();
    let stdin_task = tokio::spawn(async move {
        let mut stdin = stdin;
        loop {
            tokio::select! {
                line = stdin_rx.recv() => match line {
                    Some(line) => {
                        let ok = stdin.write_all(line.as_bytes()).await.is_ok()
                            && stdin.write_all(b"\n").await.is_ok()
                            && stdin.flush().await.is_ok();
                        if !ok { break; }
                    }
                    None => break,
                },
                _ = shutdown_rx.changed() => {
                    while stdin_rx.try_recv().is_ok() {}
                    break;
                }
            }
        }
        writer_handle.pending.fail_all("session stdin closed");
        // Dropping ChildStdin closes stdin → omp exits gracefully.
    });

    // stdout reader task.
    let reader_handle = handle.clone();
    let reader_sink = sink.clone();
    let reader_task = tokio::spawn(read_loop(reader_sink, reader_handle, stdout, ready_tx));

    // Monitor task owns the child; emits rpc:process on exit and cleans up.
    let monitor_handle = handle.clone();
    let monitor_sink = sink.clone();
    let monitor_task = tokio::spawn(monitor(monitor_sink, monitor_handle, child));

    struct SpawnGuard {
        handle: Arc<SessionHandle>,
        stdin_task: tokio::task::JoinHandle<()>,
        reader_task: tokio::task::JoinHandle<()>,
        monitor_task: tokio::task::JoinHandle<()>,
        armed: bool,
    }

    impl Drop for SpawnGuard {
        fn drop(&mut self) {
            if self.armed {
                let _ = self.handle.shutdown.send(true);
                self.handle.alive.store(false, Ordering::SeqCst);
                self.handle.pending.fail_all("spawn aborted");
                self.stdin_task.abort();
                self.reader_task.abort();
                let pid = self.handle.pid;
                if pid > 1 {
                    // SAFETY: best-effort kill of child process if spawn failed before completion.
                    unsafe {
                        libc::kill(pid as libc::pid_t, libc::SIGKILL);
                    }
                }
                self.monitor_task.abort();
            }
        }
    }

    let mut guard = SpawnGuard {
        handle: handle.clone(),
        stdin_task,
        reader_task,
        monitor_task,
        armed: true,
    };

    // Handshake.
    let ready = tokio::time::timeout(READY_TIMEOUT, ready_rx)
        .await
        .map_err(|_| "omp did not emit a ready frame".to_string())?
        .map_err(|_| "ready channel dropped".to_string())?;
    if ready
        .get("supportedProtocolVersions")
        .and_then(Value::as_array)
        .is_some_and(|v| v.contains(&json!(2)))
    {
        let _ = send_command(
            &handle,
            json!({"type": "negotiate_protocol", "protocolVersion": 2}),
        )
        .await;
    }
    let state_resp = send_command(&handle, json!({"type": "get_state"})).await?;
    apply_state(&handle, &state_resp);
    drain_pending_frames(&sink, &handle);
    let _ = send_command(
        &handle,
        json!({"type": "set_subagent_subscription", "level": "progress"}),
    )
    .await;
    if let Some(parent) = &opts.parent_session_id {
        // `--fork` already copied the parent transcript; a blank `new_session`
        // would discard it and break prefix caching.
        if opts.fork_file.is_none() {
            send_command(
                &handle,
                json!({"type": "new_session", "parentSession": parent}),
            )
            .await?;
        }
        let state_resp = send_command(&handle, json!({"type": "get_state"})).await?;
        apply_state(&handle, &state_resp);
        drain_pending_frames(&sink, &handle);
    }
    guard.armed = false;
    Ok(handle)
}
fn apply_state(handle: &SessionHandle, resp: &Value) {
    let data = resp.get("data").unwrap_or(resp);
    if let Some(id) = data.get("sessionId").and_then(Value::as_str) {
        *handle.session_id.write() = id.to_string();
    }
    if let Some(file) = data.get("sessionFile").and_then(Value::as_str) {
        *handle.session_file.write() = file.to_string();
    }
    if let Some(streaming) = data.get("isStreaming").and_then(Value::as_bool) {
        handle.streaming.store(streaming, Ordering::SeqCst);
    }
}

async fn read_loop(
    sink: OutSink,
    handle: Arc<SessionHandle>,
    stdout: ChildStdout,
    ready_tx: oneshot::Sender<Value>,
) {
    let mut lines = BufReader::new(stdout).lines();
    let mut reasm = ChunkReassembler::default();
    let mut ready_tx = Some(ready_tx);
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            tracing::warn!("rpc: unparseable stdout line ({} bytes)", line.len());
            continue;
        };
        match reasm.feed(value) {
            Ok(Some(frame)) => {
                if frame.get("type").and_then(Value::as_str) == Some("ready") {
                    if let Some(max) = frame
                        .get("maxReassembledFrameBytes")
                        .and_then(Value::as_u64)
                    {
                        reasm.set_max_reassembled(max as usize);
                    }
                    if let Some(tx) = ready_tx.take() {
                        let _ = tx.send(frame);
                    }
                    continue;
                }
                apply_frame(&handle, &frame);
                emit_frame(&sink, &handle, &frame);
            }
            Ok(None) => {}
            Err(e) => tracing::warn!("rpc_chunk: {e}"),
        }
    }
}

async fn monitor(sink: OutSink, handle: Arc<SessionHandle>, mut child: Child) {
    let status = child.wait().await;
    handle.alive.store(false, Ordering::SeqCst);
    // Wake the stdin writer: it owns a handle clone, so its channel never closes on its own.
    let _ = handle.shutdown.send(true);
    let code = status.ok().and_then(|s| s.code());
    handle.pending.fail_all("omp process exited");
    handle.pending_ui.lock().clear();
    let session_id = handle.session_id.read().clone();
    if session_id.is_empty() {
        return;
    }
    sink(OutEvent::Process {
        session_id: session_id.clone(),
        running: false,
        exit_code: code,
    });
    let mut reg = rpc::registry().write();
    if let Some(existing) = reg.get(&session_id) {
        if Arc::ptr_eq(existing, &handle) {
            reg.remove(&session_id);
        }
    }
}

/// Close stdin, wait ≤5s for exit, then SIGKILL.
pub async fn stop_handle(handle: &Arc<SessionHandle>) -> Result<(), String> {
    let _ = handle.shutdown.send(true);
    handle.pending.fail_all("session is stopping");
    for _ in 0..50 {
        if !handle.alive.load(Ordering::SeqCst) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let pid = handle.pid;
    if pid > 1 {
        // SAFETY: SIGKILL the child process after grace window.
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGKILL);
        }
    }
    // Wait for the monitor to observe the exit so callers never respawn while
    // the old process may still write the session file.
    for _ in 0..20 {
        if !handle.alive.load(Ordering::SeqCst) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("session process did not exit".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_ids_compare_known_fingerprints_only() {
        let sessions = [("a", Some("fp1")), ("b", Some("fp2")), ("c", None)];
        assert_eq!(stale_session_ids(Some("fp1"), sessions), vec!["b"]);
        assert_eq!(stale_session_ids(Some("fp2"), sessions), vec!["a"]);
        assert!(stale_session_ids(None, sessions).is_empty());
    }

    #[test]
    fn fingerprint_changes_when_binary_rewritten() {
        let dir = std::env::temp_dir().join(format!("omp-fp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("omp");
        std::fs::write(&bin, b"v1").unwrap();
        let path = dir.to_string_lossy().to_string();
        let by_name = omp_fingerprint("omp", &path).unwrap();
        let by_path = omp_fingerprint(bin.to_str().unwrap(), "").unwrap();
        assert_eq!(by_name, by_path);
        std::fs::write(&bin, b"version-2").unwrap();
        let after = omp_fingerprint("omp", &path).unwrap();
        assert_ne!(after, by_name);
        assert_eq!(
            stale_session_ids(Some(&after), [("s", Some(by_name.as_str()))]),
            vec!["s"]
        );
        assert!(omp_fingerprint("omp-missing", &path).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn test_handle() -> Arc<SessionHandle> {
        Arc::new(SessionHandle::for_test())
    }

    #[test]
    fn response_resolves_pending_by_id() {
        let h = test_handle();
        let rx = h.pending.insert("req_1".into());
        let resp = json!({"id": "req_1", "type": "response", "success": true, "data": {"x": 1}});
        apply_frame(&h, &resp);
        assert_eq!(rx.blocking_recv().unwrap(), resp);
    }

    #[test]
    fn response_with_unknown_id_is_ignored() {
        let h = test_handle();
        let rx = h.pending.insert("req_1".into());
        apply_frame(
            &h,
            &json!({"id": "req_other", "type": "response", "success": true}),
        );
        // Still pending: resolve now and confirm we get our own response.
        apply_frame(
            &h,
            &json!({"id": "req_1", "type": "response", "success": true}),
        );
        assert!(rx.blocking_recv().is_ok());
    }

    #[test]
    fn dialog_requests_are_tracked_and_cancelled() {
        let h = test_handle();
        apply_frame(
            &h,
            &json!({"type":"extension_ui_request","id":"ui_1","method":"select","options":["Approve","Deny"]}),
        );
        // Fire-and-forget methods are not tracked.
        apply_frame(
            &h,
            &json!({"type":"extension_ui_request","id":"w1","method":"setWidget"}),
        );
        assert_eq!(h.pending_ui.lock().len(), 1);
        apply_frame(
            &h,
            &json!({"type":"extension_ui_request","id":"c1","method":"cancel","targetId":"ui_1"}),
        );
        assert!(h.pending_ui.lock().is_empty());
    }

    #[test]
    fn streaming_tracks_agent_lifecycle() {
        let h = test_handle();
        apply_frame(&h, &json!({"type":"agent_start"}));
        assert!(h.streaming.load(Ordering::SeqCst));
        // Non-terminal agent_end keeps streaming (maintenance turn).
        apply_frame(&h, &json!({"type":"agent_end","isTerminal":false}));
        assert!(h.streaming.load(Ordering::SeqCst));
        apply_frame(&h, &json!({"type":"agent_end","isTerminal":true}));
        assert!(!h.streaming.load(Ordering::SeqCst));
        // Missing isTerminal is terminal-compatible.
        apply_frame(&h, &json!({"type":"agent_start"}));
        apply_frame(&h, &json!({"type":"agent_end"}));
        assert!(!h.streaming.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn send_command_reports_closed_stdin_and_dead_process() {
        // stdin receiver dropped → send fails fast.
        let h = test_handle();
        let err = send_command(&h, json!({"type":"get_state"}))
            .await
            .unwrap_err();
        assert_eq!(err, "session stdin closed");

        h.alive.store(false, Ordering::SeqCst);
        let err = send_command(&h, json!({"type":"get_state"}))
            .await
            .unwrap_err();
        assert_eq!(err, "session process is not running");
    }

    #[tokio::test]
    async fn send_command_success_false_maps_to_err() {
        // Keep the stdin receiver alive and resolve the pending request with a
        // failure response, mimicking the read loop.
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let h = Arc::new(SessionHandle {
            stdin_tx: tx,
            ..SessionHandle::for_test()
        });
        let h3 = h.clone();
        let writer = tokio::spawn(async move {
            let line = rx.recv().await.expect("stdin line");
            let sent: Value = serde_json::from_str(&line).unwrap();
            let id = sent["id"].as_str().unwrap().to_string();
            h3.pending.resolve(
                &id,
                json!({"id": id, "type":"response","success":false,"error":"nope"}),
            );
        });
        let err = send_command(&h, json!({"type":"get_state"}))
            .await
            .unwrap_err();
        writer.await.unwrap();
        assert_eq!(err, "nope");
    }

    #[test]
    fn emit_frame_buffers_when_session_id_empty_and_drains() {
        let h = test_handle();
        *h.session_id.write() = String::new();

        let emitted = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let emitted_clone = emitted.clone();
        let sink: OutSink = Arc::new(move |ev| {
            if let OutEvent::Frame { session_id, frame } = ev {
                emitted_clone.lock().push((session_id, frame));
            }
        });

        let frame1 = json!({"type": "available_commands_update", "commands": []});
        let frame2 = json!({"type": "extension_ui_request", "id": "1"});

        emit_frame(&sink, &h, &frame1);
        emit_frame(&sink, &h, &frame2);

        // Buffering: nothing emitted yet
        assert_eq!(emitted.lock().len(), 0);
        assert_eq!(h.pending_frames.lock().len(), 2);

        // Apply state / set session_id
        *h.session_id.write() = "s_test_123".to_string();
        drain_pending_frames(&sink, &h);

        assert_eq!(h.pending_frames.lock().len(), 0);
        let items = emitted.lock().clone();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].0, "s_test_123");
        assert_eq!(items[0].1, frame1);
        assert_eq!(items[1].0, "s_test_123");
        assert_eq!(items[1].1, frame2);
    }

    #[tokio::test]
    async fn send_command_rejects_non_object() {
        let h = test_handle();
        let err = send_command(&h, json!("not an object")).await.unwrap_err();
        assert_eq!(err, "command must be a JSON object");

        let err2 = send_command(&h, json!([1, 2, 3])).await.unwrap_err();
        assert_eq!(err2, "command must be a JSON object");
    }

    #[tokio::test]
    async fn send_command_rejects_when_shutdown() {
        let (tx, _rx) = mpsc::unbounded_channel::<String>();
        let (shutdown, _srx) = watch::channel(false);
        let h = Arc::new(SessionHandle {
            stdin_tx: tx,
            shutdown,
            ..SessionHandle::for_test()
        });
        let _ = h.shutdown.send(true);
        let err = send_command(&h, json!({"type": "get_state"}))
            .await
            .unwrap_err();
        assert_eq!(err, "session process is not running");
    }

    #[tokio::test]
    async fn stop_handle_fails_pending_requests() {
        let h = test_handle();
        let rx = h.pending.insert("req_test".into());
        let _ = stop_handle(&h).await;
        let resp = rx.await.expect("pending request resolved by stop_handle");
        assert_eq!(resp.get("success").and_then(Value::as_bool), Some(false));
        assert_eq!(
            resp.get("error").and_then(Value::as_str),
            Some("session is stopping")
        );
    }

    #[test]
    fn build_command_plan_yolo_appended_for_fresh_session() {
        let settings = Settings::default();
        let opts = StartOpts {
            cwd: "/tmp".into(),
            plan_yolo: Some(true),
            ..Default::default()
        };
        let cmd = build_command(&opts, &settings).unwrap();
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"--plan-yolo".to_string()));
    }

    #[test]
    fn build_command_plan_yolo_skipped_when_resuming() {
        let settings = Settings::default();
        let opts = StartOpts {
            cwd: "/tmp".into(),
            resume_file: Some("/tmp/session.jsonl".into()),
            plan_yolo: Some(true),
            ..Default::default()
        };
        let cmd = build_command(&opts, &settings).unwrap();
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(!args.contains(&"--plan-yolo".to_string()));
        assert!(args.contains(&"--resume".to_string()));
    }

    #[test]
    fn build_command_plan_yolo_skipped_when_false_or_none() {
        let settings = Settings::default();
        let opts = StartOpts {
            cwd: "/tmp".into(),
            plan_yolo: Some(false),
            ..Default::default()
        };
        let cmd = build_command(&opts, &settings).unwrap();
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(!args.contains(&"--plan-yolo".to_string()));

        let opts_none = StartOpts {
            cwd: "/tmp".into(),
            plan_yolo: None,
            ..Default::default()
        };
        let cmd_none = build_command(&opts_none, &settings).unwrap();
        let args_none: Vec<String> = cmd_none
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(!args_none.contains(&"--plan-yolo".to_string()));
    }
    #[test]
    fn build_command_plugin_dir_gated_by_visualize_enabled() {
        // Install the bundled plugin under an isolated data dir so the
        // `--plugin-dir` arg has a real manifest to point at.
        let dir = std::env::temp_dir().join(format!("ompws-viz-spawn-{}", uuid::Uuid::new_v4()));
        std::env::set_var("OMPWS_DATA_DIR", &dir);
        crate::visualize::install();

        let opts = StartOpts {
            cwd: "/tmp".into(),
            ..Default::default()
        };
        let args_of = |s: &Settings| {
            build_command(&opts, s)
                .unwrap()
                .as_std()
                .get_args()
                .map(|a| a.to_string_lossy().to_string())
                .collect::<Vec<String>>()
        };

        let on = args_of(&Settings::default());
        let pos = on.iter().position(|a| a == "--plugin-dir");
        assert!(pos.is_some(), "expected --plugin-dir in {on:?}");
        assert_eq!(
            on[pos.unwrap() + 1],
            crate::visualize::plugin_dir().to_string_lossy()
        );
        let hint_pos = on.iter().position(|a| a == "--append-system-prompt");
        assert!(hint_pos.is_some_and(|p| on[p + 1].contains("skill://visualize")));

        let off = args_of(&Settings {
            visualize_enabled: false,
            ..Settings::default()
        });
        assert!(!off.iter().any(|a| a == "--plugin-dir"));
        assert!(!off.iter().any(|a| a == "--append-system-prompt"));

        // The terminal's `omp --resume` must get the identical prompt-shaping argv
        // as the RPC spawn, or the first turn after switching views cold-misses
        // the provider prompt cache.
        let file = dir.join("s.jsonl");
        std::fs::write(
            &file,
            "{\"type\":\"session\",\"id\":\"sid\",\"providerPromptCacheKey\":\"pinned\"}\n",
        )
        .unwrap();
        let file = file.to_string_lossy().to_string();
        let resume_opts = StartOpts {
            cwd: "/tmp".into(),
            resume_file: Some(file.clone()),
            ..Default::default()
        };
        for visualize_enabled in [true, false] {
            let s = Settings {
                visualize_enabled,
                ..Settings::default()
            };
            let shape = prompt_shape_args(Some(&file), None, None, &s);
            let pos = shape
                .iter()
                .position(|a| a == "--prompt-cache-key")
                .unwrap();
            assert_eq!(shape[pos + 1], "pinned");
            let rpc: Vec<String> = build_command(&resume_opts, &s)
                .unwrap()
                .as_std()
                .get_args()
                .map(|a| a.to_string_lossy().to_string())
                .collect();
            assert!(
                rpc.windows(shape.len()).any(|w| w == shape.as_slice()),
                "rpc argv {rpc:?} lacks shared shape {shape:?}"
            );
        }

        std::env::remove_var("OMPWS_DATA_DIR");
        std::fs::remove_dir_all(&dir).ok();
    }

    fn session_file(lines: &[&str]) -> (PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("ompws-ckey-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s.jsonl");
        std::fs::write(&file, format!("{}\n", lines.join("\n"))).unwrap();
        (dir, file.to_string_lossy().to_string())
    }

    #[test]
    fn transcript_cache_key_reads_header_after_title_row() {
        let (dir, file) = session_file(&[
            r#"{"type":"title","title":"t"}"#,
            r#"{"type":"session","id":"child","providerPromptCacheKey":"parent-key"}"#,
        ]);
        assert_eq!(
            transcript_cache_key(&file, true).as_deref(),
            Some("parent-key")
        );
        assert_eq!(
            transcript_cache_key(&file, false).as_deref(),
            Some("parent-key")
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn transcript_cache_key_falls_back_to_id_only_for_forks() {
        let (dir, file) = session_file(&[r#"{"type":"session","id":"parent-id"}"#]);
        assert_eq!(
            transcript_cache_key(&file, true).as_deref(),
            Some("parent-id")
        );
        assert_eq!(transcript_cache_key(&file, false), None);
        assert_eq!(transcript_cache_key("/nonexistent/x.jsonl", true), None);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn fork_spawn_pins_parent_prompt_cache_key() {
        let (dir, file) = session_file(&[r#"{"type":"session","id":"parent-id"}"#]);
        let opts = StartOpts {
            cwd: "/tmp".into(),
            fork_file: Some(file),
            model: Some("openai/gpt-5".into()),
            ..Default::default()
        };
        let args: Vec<String> = build_command(&opts, &Settings::default())
            .unwrap()
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        let pos = args.iter().position(|a| a == "--prompt-cache-key").unwrap();
        assert_eq!(args[pos + 1], "parent-id");
        std::fs::remove_dir_all(dir).ok();
    }
}
