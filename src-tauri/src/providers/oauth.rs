//! [providers] OAuth and RPC login process manager.
//! Drives `omp --mode rpc` to execute graphical/browser login flows (e.g. OpenAI Codex OAuth,
//! API key prompts, extension UI requests).
//!
//! Concurrency and safety:
//! - Child processes are spawned without vault secrets or provider environments.
//! - Writing to child stdin is serialized and never holds locks during I/O.
//! - Frame bodies carrying secrets are never logged; only event kinds and provider IDs.

use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio::sync::{oneshot, Mutex};

use crate::contracts::OauthUiEvent;

struct LoginProc {
    provider_id: String,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    child: Arc<Mutex<tokio::process::Child>>,
    cancel_tx: Option<oneshot::Sender<()>>,
}

static ACTIVE: Mutex<Option<LoginProc>> = Mutex::const_new(None);
static LAST: Mutex<Option<OauthUiEvent>> = Mutex::const_new(None);

/// Clean up active process if it matches the target provider.
async fn cleanup_active(target_provider_id: &str) {
    let mut guard = ACTIVE.lock().await;
    if let Some(proc) = &*guard {
        if proc.provider_id == target_provider_id {
            if let Some(proc) = guard.take() {
                let mut child = proc.child.lock().await;
                let _ = child.kill().await;
            }
        }
    }
}

/// Validate that a URL has a permitted HTTP or HTTPS scheme.
pub fn validate_url_scheme(url: &str) -> Result<(), String> {
    let lower = url.trim().to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err("仅支持 HTTP/HTTPS 协议".to_string())
    }
}

/// Open a URL in the user's default system browser.
pub fn open_browser_url(url: &str) -> Result<(), String> {
    validate_url_scheme(url)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("打开系统浏览器失败: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("打开系统浏览器失败: {e}"))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("打开系统浏览器失败: {e}"))?;
    }
    Ok(())
}

/// Map an incoming RPC line JSON frame to an `OauthUiEvent`.
/// Pure function for testability.
pub fn map_rpc_frame(val: &serde_json::Value, provider_id: &str) -> Option<OauthUiEvent> {
    let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if msg_type == "extension_ui_request" {
        let method = val.get("method").and_then(|v| v.as_str()).unwrap_or("");
        let req_id = val.get("id").and_then(|v| v.as_str()).map(String::from);
        match method {
            "open_url" => {
                let url = val.get("url").and_then(|v| v.as_str()).map(String::from);
                let launch_url = val
                    .get("launchUrl")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let instructions = val
                    .get("instructions")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                Some(OauthUiEvent {
                    kind: "openUrl".to_string(),
                    provider_id: provider_id.to_string(),
                    url,
                    launch_url,
                    instructions,
                    request_id: req_id,
                    ..Default::default()
                })
            }
            "input" => {
                let title = val.get("title").and_then(|v| v.as_str()).map(String::from);
                let placeholder = val
                    .get("placeholder")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let timeout_ms = val
                    .get("timeout")
                    .or_else(|| val.get("timeoutMs"))
                    .and_then(|v| v.as_u64());
                Some(OauthUiEvent {
                    kind: "needsInput".to_string(),
                    provider_id: provider_id.to_string(),
                    request_id: req_id,
                    title,
                    placeholder,
                    timeout_ms,
                    ..Default::default()
                })
            }
            "notify" => {
                let message = val
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                Some(OauthUiEvent {
                    kind: "notify".to_string(),
                    provider_id: provider_id.to_string(),
                    request_id: req_id,
                    message,
                    ..Default::default()
                })
            }
            "cancel" => Some(OauthUiEvent {
                kind: "cancelledRequest".to_string(),
                provider_id: provider_id.to_string(),
                request_id: req_id,
                ..Default::default()
            }),
            other => {
                let message = val
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .or_else(|| serde_json::to_string(val).ok());
                Some(OauthUiEvent {
                    kind: "ui".to_string(),
                    provider_id: provider_id.to_string(),
                    request_id: req_id,
                    method: Some(other.to_string()),
                    message,
                    ..Default::default()
                })
            }
        }
    } else if msg_type == "response" {
        let cmd = val.get("command").and_then(|v| v.as_str()).unwrap_or("");
        let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if cmd == "login" || id == "login" {
            let success = val
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let error = val.get("error").and_then(|v| v.as_str()).map(String::from);
            Some(OauthUiEvent {
                kind: "completed".to_string(),
                provider_id: provider_id.to_string(),
                ok: Some(success),
                error: if success {
                    None
                } else {
                    error.or_else(|| Some("登录未成功".to_string()))
                },
                ..Default::default()
            })
        } else {
            None
        }
    } else {
        None
    }
}

/// Query available login providers by launching a probe `omp --mode rpc` process.
pub async fn oauth_login_providers() -> Result<Vec<serde_json::Value>, String> {
    let mut cmd = tokio::process::Command::new("omp");
    cmd.args([
        "--mode",
        "rpc",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-rules",
    ]);
    cmd.current_dir(std::env::temp_dir());
    cmd.env("PATH", crate::terminal::env::augmented_path());
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 omp 探测进程失败: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("无法打开子进程标准输入")?;
    let stdout = child.stdout.take().ok_or("无法打开子进程标准输出")?;

    let run_probe = async move {
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        let mut ready = false;
        while let Ok(Ok(Some(line))) =
            tokio::time::timeout(Duration::from_secs(15), lines.next_line()).await
        {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                if val.get("type").and_then(|v| v.as_str()) == Some("ready") {
                    ready = true;
                    break;
                }
            }
        }
        if !ready {
            return Err("等待 omp 探测进程就绪超时".to_string());
        }

        let req = serde_json::json!({
            "id": "lp",
            "type": "get_login_providers",
        });
        let mut req_str = req.to_string();
        req_str.push('\n');
        stdin
            .write_all(req_str.as_bytes())
            .await
            .map_err(|e| format!("发送 get_login_providers 命令失败: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("刷新标准输入失败: {e}"))?;

        while let Ok(Ok(Some(line))) =
            tokio::time::timeout(Duration::from_secs(10), lines.next_line()).await
        {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let cmd = val.get("command").and_then(|v| v.as_str()).unwrap_or("");
                let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if msg_type == "response" && (cmd == "get_login_providers" || id == "lp") {
                    let success = val
                        .get("success")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if !success {
                        let err = val
                            .get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("获取登录提供方失败");
                        return Err(err.to_string());
                    }
                    if let Some(providers) =
                        val.pointer("/data/providers").and_then(|p| p.as_array())
                    {
                        return Ok(providers.clone());
                    }
                    return Ok(Vec::new());
                }
            }
        }
        Err("读取 get_login_providers 响应超时".to_string())
    };

    let res = run_probe.await;
    let _ = child.kill().await;
    res
}

/// Start an OAuth / account login flow for a provider.
pub async fn oauth_login_start(app: tauri::AppHandle, provider_id: String) -> Result<(), String> {
    let mut active_guard = ACTIVE.lock().await;
    if active_guard.is_some() {
        return Err("已有登录流程进行中".to_string());
    }

    let mut cmd = tokio::process::Command::new("omp");
    cmd.args([
        "--mode",
        "rpc",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-rules",
    ]);
    cmd.current_dir(std::env::temp_dir());
    cmd.env("PATH", crate::terminal::env::augmented_path());
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 omp 登录进程失败: {e}"))?;
    let stdin = child.stdin.take().ok_or("无法打开子进程标准输入")?;
    let stdout = child.stdout.take().ok_or("无法打开子进程标准输出")?;

    let started_ev = OauthUiEvent {
        kind: "started".to_string(),
        provider_id: provider_id.clone(),
        ..Default::default()
    };
    *LAST.lock().await = Some(started_ev.clone());
    let _ = app.emit("providers:oauth", &started_ev);

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let stdin_arc = Arc::new(Mutex::new(stdin));
    let child_arc = Arc::new(Mutex::new(child));

    *active_guard = Some(LoginProc {
        provider_id: provider_id.clone(),
        stdin: Arc::clone(&stdin_arc),
        child: Arc::clone(&child_arc),
        cancel_tx: Some(cancel_tx),
    });
    drop(active_guard);

    let pid_clone = provider_id.clone();
    tokio::spawn(async move {
        reader_task(app, pid_clone, stdout, stdin_arc, cancel_rx).await;
    });

    Ok(())
}

async fn reader_task(
    app: tauri::AppHandle,
    provider_id: String,
    stdout: tokio::process::ChildStdout,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    let mut lines = tokio::io::BufReader::new(stdout).lines();

    // Step A: Wait for ready frame
    let mut ready = false;
    let ready_timeout = tokio::time::timeout(Duration::from_secs(15), async {
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                if val.get("type").and_then(|v| v.as_str()) == Some("ready") {
                    return true;
                }
            }
        }
        false
    });

    if let Ok(true) = ready_timeout.await {
        ready = true;
    }

    if !ready {
        let ev = OauthUiEvent {
            kind: "completed".to_string(),
            provider_id: provider_id.clone(),
            ok: Some(false),
            error: Some("omp 登录服务就绪超时".to_string()),
            ..Default::default()
        };
        *LAST.lock().await = Some(ev.clone());
        let _ = app.emit("providers:oauth", &ev);
        cleanup_active(&provider_id).await;
        return;
    }

    // Step B: Send login command
    let login_cmd = serde_json::json!({
        "id": "login",
        "type": "login",
        "providerId": provider_id,
    });
    let mut stdin_guard = stdin.lock().await;
    let mut cmd_str = login_cmd.to_string();
    cmd_str.push('\n');
    let write_res = stdin_guard.write_all(cmd_str.as_bytes()).await;
    let flush_res = stdin_guard.flush().await;
    drop(stdin_guard);

    if write_res.is_err() || flush_res.is_err() {
        let ev = OauthUiEvent {
            kind: "completed".to_string(),
            provider_id: provider_id.clone(),
            ok: Some(false),
            error: Some("发送登录请求失败".to_string()),
            ..Default::default()
        };
        *LAST.lock().await = Some(ev.clone());
        let _ = app.emit("providers:oauth", &ev);
        cleanup_active(&provider_id).await;
        return;
    }

    // Step C: Frame loop
    let mut completed_emitted = false;
    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                completed_emitted = true;
                break;
            }
            line_res = lines.next_line() => {
                match line_res {
                    Ok(Some(line)) => {
                        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
                            continue;
                        };
                        if let Some(ev) = map_rpc_frame(&val, &provider_id) {
                            if ev.kind == "openUrl" {
                                if let Some(target) = ev.launch_url.as_deref().or(ev.url.as_deref()) {
                                    let _ = open_browser_url(target);
                                }
                            }
                            let is_completed = ev.kind == "completed";
                            *LAST.lock().await = Some(ev.clone());
                            let _ = app.emit("providers:oauth", &ev);
                            if is_completed {
                                completed_emitted = true;
                                break;
                            }
                        }
                    }
                    Ok(None) => {
                        // EOF
                        break;
                    }
                    Err(_) => {
                        break;
                    }
                }
            }
        }
    }

    if !completed_emitted {
        let ev = OauthUiEvent {
            kind: "completed".to_string(),
            provider_id: provider_id.clone(),
            ok: Some(false),
            error: Some("登录进程已退出".to_string()),
            ..Default::default()
        };
        *LAST.lock().await = Some(ev.clone());
        let _ = app.emit("providers:oauth", &ev);
    }

    cleanup_active(&provider_id).await;
}

/// Respond to an active OAuth/RPC prompt.
pub async fn oauth_login_respond(payload: serde_json::Value) -> Result<(), String> {
    let stdin_arc = {
        let guard = ACTIVE.lock().await;
        let Some(proc) = &*guard else {
            return Err("没有进行中的登录流程".to_string());
        };
        Arc::clone(&proc.stdin)
    };

    let mut stdin = stdin_arc.lock().await;
    let mut line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("写入响应失败: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("刷新输入失败: {e}"))?;
    Ok(())
}

/// Cancel the active OAuth login process.
pub async fn oauth_login_cancel(app: tauri::AppHandle) -> Result<(), String> {
    let mut guard = ACTIVE.lock().await;
    if let Some(mut proc) = guard.take() {
        if let Some(tx) = proc.cancel_tx.take() {
            let _ = tx.send(());
        }
        let mut child = proc.child.lock().await;
        let _ = child.kill().await;
        let provider_id = proc.provider_id.clone();
        drop(guard);

        let ev = OauthUiEvent {
            kind: "completed".to_string(),
            provider_id,
            ok: Some(false),
            error: Some("已取消".to_string()),
            ..Default::default()
        };
        *LAST.lock().await = Some(ev.clone());
        let _ = app.emit("providers:oauth", &ev);
    }
    Ok(())
}

/// Open a URL explicitly in the user's default browser (must be HTTP/HTTPS).
pub async fn oauth_login_open_url(url: String) -> Result<(), String> {
    open_browser_url(&url)
}

/// Retrieve the current login status snapshot.
/// Returns `{ active: bool, ...OauthUiEvent fields }` or `None` if never invoked.
pub async fn oauth_login_status() -> Result<Option<serde_json::Value>, String> {
    let is_active = ACTIVE.lock().await.is_some();
    let last = LAST.lock().await.clone();

    match &last {
        Some(ev) => {
            let mut val = serde_json::to_value(ev).map_err(|e| e.to_string())?;
            if let serde_json::Value::Object(map) = &mut val {
                map.insert("active".to_string(), serde_json::Value::Bool(is_active));
            }
            Ok(Some(val))
        }
        None => {
            if is_active {
                Ok(Some(serde_json::json!({ "active": true })))
            } else {
                Ok(None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_validation() {
        assert!(validate_url_scheme("https://auth.openai.com/oauth").is_ok());
        assert!(validate_url_scheme("http://localhost:1455/callback").is_ok());
        assert!(validate_url_scheme("javascript:alert(1)").is_err());
        assert!(validate_url_scheme("file:///etc/passwd").is_err());
        assert!(validate_url_scheme("data:text/html,...").is_err());
    }

    #[test]
    fn test_map_rpc_frames() {
        // open_url
        let open_url_frame = serde_json::json!({
            "type": "extension_ui_request",
            "id": "req-1",
            "method": "open_url",
            "url": "https://auth.openai.com/oauth",
            "instructions": "Log in with browser"
        });
        let ev = map_rpc_frame(&open_url_frame, "openai-codex").unwrap();
        assert_eq!(ev.kind, "openUrl");
        assert_eq!(ev.provider_id, "openai-codex");
        assert_eq!(ev.url.as_deref(), Some("https://auth.openai.com/oauth"));
        assert_eq!(ev.request_id.as_deref(), Some("req-1"));

        // input
        let input_frame = serde_json::json!({
            "type": "extension_ui_request",
            "id": "req-2",
            "method": "input",
            "title": "API Key",
            "placeholder": "sk-...",
            "timeout": 60000
        });
        let ev2 = map_rpc_frame(&input_frame, "zai").unwrap();
        assert_eq!(ev2.kind, "needsInput");
        assert_eq!(ev2.title.as_deref(), Some("API Key"));
        assert_eq!(ev2.placeholder.as_deref(), Some("sk-..."));
        assert_eq!(ev2.timeout_ms, Some(60000));

        // notify
        let notify_frame = serde_json::json!({
            "type": "extension_ui_request",
            "id": "req-3",
            "method": "notify",
            "message": "Waiting for auth..."
        });
        let ev3 = map_rpc_frame(&notify_frame, "openai-codex").unwrap();
        assert_eq!(ev3.kind, "notify");
        assert_eq!(ev3.message.as_deref(), Some("Waiting for auth..."));

        // cancel
        let cancel_frame = serde_json::json!({
            "type": "extension_ui_request",
            "id": "req-4",
            "method": "cancel"
        });
        let ev4 = map_rpc_frame(&cancel_frame, "openai-codex").unwrap();
        assert_eq!(ev4.kind, "cancelledRequest");

        // completed success
        let resp_success = serde_json::json!({
            "type": "response",
            "command": "login",
            "success": true
        });
        let ev5 = map_rpc_frame(&resp_success, "openai-codex").unwrap();
        assert_eq!(ev5.kind, "completed");
        assert_eq!(ev5.ok, Some(true));
        assert_eq!(ev5.error, None);

        // completed error
        let resp_fail = serde_json::json!({
            "type": "response",
            "command": "login",
            "success": false,
            "error": "Terminal UI required for secret input"
        });
        let ev6 = map_rpc_frame(&resp_fail, "zai").unwrap();
        assert_eq!(ev6.kind, "completed");
        assert_eq!(ev6.ok, Some(false));
        assert_eq!(
            ev6.error.as_deref(),
            Some("Terminal UI required for secret input")
        );
    }
}
