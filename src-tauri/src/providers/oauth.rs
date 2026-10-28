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
    reader: tokio::task::JoinHandle<()>,
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
        // No shell: the URL is passed as a single argv entry (cmd's `start` would split on `&`).
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
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
    // Register the reader while holding ACTIVE so cancel cannot miss a reader
    // that would otherwise start after its process was already cancelled.
    let reader_stdin = Arc::clone(&stdin_arc);
    let pid_clone = provider_id.clone();
    let reader = tokio::spawn(async move {
        reader_task(app, pid_clone, stdout, reader_stdin, cancel_rx).await;
    });

    *active_guard = Some(LoginProc {
        provider_id: provider_id.clone(),
        stdin: Arc::clone(&stdin_arc),
        child: Arc::clone(&child_arc),
        cancel_tx: Some(cancel_tx),
        reader,
    });
    drop(active_guard);

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

/// Kill before releasing ownership. A failed kill remains retryable and must not
/// report cancellation success or drop the only process handle.
async fn cancel_active(active: &Mutex<Option<LoginProc>>) -> Result<Option<String>, String> {
    let mut guard = active.lock().await;
    let Some(proc) = guard.as_mut() else {
        return Ok(None);
    };
    proc.child
        .lock()
        .await
        .kill()
        .await
        .map_err(|e| format!("取消登录进程失败: {e}"))?;
    if let Some(tx) = proc.cancel_tx.take() {
        let _ = tx.send(());
    }
    // The reader may still be waiting for ready, not yet selecting cancel_rx.
    // Abort it before another flow can reuse the same provider ID.
    proc.reader.abort();
    let _ = (&mut proc.reader).await;
    let proc = guard.take().expect("active process is still owned");
    Ok(Some(proc.provider_id))
}

/// Cancel the active OAuth login process.
pub async fn oauth_login_cancel(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(provider_id) = cancel_active(&ACTIVE).await? {
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

/// Soft-disable stored credentials for one identified account, or all accounts when explicitly requested.
pub fn logout_credentials_conn(
    conn: &mut rusqlite::Connection,
    provider_id: &str,
    email: Option<&str>,
    account_id: Option<&str>,
    logout_all: bool,
) -> Result<u32, String> {
    let email = email.map(str::trim).filter(|s| !s.is_empty());
    let account_id = account_id.map(str::trim).filter(|s| !s.is_empty());
    let rows: Vec<(i64, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, identity_key, data FROM auth_credentials \
                 WHERE provider = ?1 AND disabled_cause IS NULL",
            )
            .map_err(|e| format!("读取凭据失败: {e}"))?;
        let mapped = stmt
            .query_map([provider_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| format!("读取凭据失败: {e}"))?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取凭据失败: {e}"))?
    };

    let mut matched: Vec<i64> = Vec::new();
    let mut identities: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (id, key, data) in &rows {
        let json: serde_json::Value = serde_json::from_str(data).unwrap_or(serde_json::Value::Null);
        let d_email = json.get("email").and_then(|v| v.as_str());
        let d_acct = json.get("accountId").and_then(|v| v.as_str());
        let ident = if !key.is_empty() {
            key.clone()
        } else if let Some(e) = d_email {
            format!("email:{e}")
        } else if let Some(a) = d_acct {
            format!("account:{a}")
        } else {
            "unnamed".to_string()
        };
        identities.insert(ident);
        let email_hit = email.is_some_and(|e| {
            key.contains(&format!("email:{e}"))
                || d_email.is_some_and(|x| x.eq_ignore_ascii_case(e))
        });
        let acct_hit =
            account_id.is_some_and(|a| key.contains(&format!("account:{a}")) || d_acct == Some(a));
        if email_hit || acct_hit {
            matched.push(*id);
        }
    }

    if logout_all {
        matched = rows.iter().map(|(id, _, _)| *id).collect();
    } else if matched.is_empty() {
        if email.is_some() || account_id.is_some() {
            return Err("未找到匹配的授权账号；若无法精确识别，请使用清除全部授权".to_string());
        }
        if identities.len() > 1 || identities.contains("unnamed") {
            return Err(
                "无法唯一识别授权账号；若要清除该供应商的所有授权，请使用清除全部授权".to_string(),
            );
        }
        matched = rows.iter().map(|(id, _, _)| *id).collect();
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("退出登录失败: {e}"))?;
    let mut count = 0u32;
    for id in &matched {
        let n = tx
            .execute(
                "UPDATE auth_credentials SET disabled_cause = 'deleted by user', \
                 updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?1",
                [id],
            )
            .map_err(|e| format!("退出登录失败: {e}"))?;
        count += n as u32;
    }
    tx.commit().map_err(|e| format!("退出登录失败: {e}"))?;
    Ok(count)
}

/// Log out of a provider account: stop any running login, disable credentials, drop usage cache.
pub async fn oauth_logout(
    state: &crate::state::AppState,
    provider_id: &str,
    email: Option<&str>,
    account_id: Option<&str>,
    logout_all: bool,
) -> Result<u32, String> {
    cleanup_active(provider_id).await;
    let db_path = super::omp_config::home_agent_dir().join("agent.db");
    let (pid, em, ac) = (
        provider_id.to_string(),
        email.map(str::to_string),
        account_id.map(str::to_string),
    );
    let count = tokio::task::spawn_blocking(move || {
        let mut conn =
            rusqlite::Connection::open(&db_path).map_err(|e| format!("打开 agent.db 失败: {e}"))?;
        let _ = conn.busy_timeout(Duration::from_secs(5));
        logout_credentials_conn(&mut conn, &pid, em.as_deref(), ac.as_deref(), logout_all)
    })
    .await
    .map_err(|e| format!("退出登录失败: {e}"))??;

    let path = crate::terminal::env::augmented_path();
    let bin_setting = state.settings.read().omp_binary.clone();
    let bin = if !bin_setting.trim().is_empty() {
        bin_setting
    } else {
        crate::terminal::env::which("omp")
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "omp".to_string())
    };
    let _ = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new(&bin)
            .args(["usage", "invalidate"])
            .env("PATH", &path)
            .current_dir(std::env::temp_dir())
            .output(),
    )
    .await;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_reaps_child_and_stops_reader_before_releasing_slot() {
        // Synthetic local pipe process only: no OMP, provider, credentials or network.
        let mut child = tokio::process::Command::new("sh")
            .args(["-c", "read value"])
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        let child = Arc::new(Mutex::new(child));
        let reader = tokio::spawn(std::future::pending::<()>());
        let reader_abort = reader.abort_handle();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let active = Mutex::new(Some(LoginProc {
            provider_id: "synthetic".to_string(),
            stdin,
            child: Arc::clone(&child),
            cancel_tx: Some(cancel_tx),
            reader,
        }));
        assert_eq!(
            cancel_active(&active).await.unwrap().as_deref(),
            Some("synthetic")
        );
        assert!(active.lock().await.is_none());
        assert!(child.lock().await.try_wait().unwrap().is_some());
        cancel_rx.await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while !reader_abort.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(cancel_active(&active).await.unwrap().is_none());
    }

    fn logout_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, \
             credential_type TEXT, identity_key TEXT, data TEXT, disabled_cause TEXT, \
             updated_at INTEGER);",
        )
        .unwrap();
        conn
    }

    fn add_cred(conn: &rusqlite::Connection, provider: &str, key: &str, data: &str) {
        conn.execute(
            "INSERT INTO auth_credentials (provider, credential_type, identity_key, data) \
             VALUES (?1, 'oauth', ?2, ?3)",
            [provider, key, data],
        )
        .unwrap();
    }

    fn active(conn: &rusqlite::Connection) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM auth_credentials WHERE disabled_cause IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn logout_single_account() {
        let mut conn = logout_db();
        add_cred(&conn, "devin", "email:a@x.com", r#"{"email":"a@x.com"}"#);
        assert_eq!(
            logout_credentials_conn(&mut conn, "devin", None, None, false),
            Ok(1)
        );
        assert_eq!(active(&conn), 0);
    }

    #[test]
    fn logout_one_of_many_by_email() {
        let mut conn = logout_db();
        add_cred(&conn, "p", "email:a@x.com", r#"{"email":"a@x.com"}"#);
        add_cred(&conn, "p", "email:b@x.com", r#"{"email":"b@x.com"}"#);
        add_cred(&conn, "q", "email:a@x.com", r#"{"email":"a@x.com"}"#);
        assert_eq!(
            logout_credentials_conn(&mut conn, "p", Some("a@x.com"), None, false),
            Ok(1)
        );
        assert_eq!(active(&conn), 2);
    }

    #[test]
    fn logout_many_without_match_fails() {
        let mut conn = logout_db();
        add_cred(&conn, "p", "email:a@x.com", r#"{"email":"a@x.com"}"#);
        add_cred(&conn, "p", "email:b@x.com", r#"{"email":"b@x.com"}"#);
        assert!(logout_credentials_conn(&mut conn, "p", Some("c@x.com"), None, false).is_err());
        assert!(logout_credentials_conn(&mut conn, "p", None, None, false).is_err());
        assert_eq!(active(&conn), 2);
    }

    #[test]
    fn anonymous_credentials_require_explicit_provider_wide_logout() {
        let mut conn = logout_db();
        add_cred(&conn, "devin", "", r#"{"access":"x"}"#);
        add_cred(&conn, "devin", "", r#"{"access":"another-account"}"#);
        add_cred(
            &conn,
            "other",
            "email:keep@x.com",
            r#"{"email":"keep@x.com"}"#,
        );
        conn.execute(
            "INSERT INTO auth_credentials (provider, credential_type, identity_key, data) \
             VALUES ('devin', 'api_key', NULL, '{\"key\":\"y\"}')",
            [],
        )
        .unwrap();
        assert!(logout_credentials_conn(
            &mut conn,
            "devin",
            Some("u@x.com"),
            Some("user-1"),
            false
        )
        .is_err());
        assert_eq!(active(&conn), 4);
        assert_eq!(
            logout_credentials_conn(&mut conn, "devin", None, None, true),
            Ok(3)
        );
        assert_eq!(active(&conn), 1);
    }

    /// Stale external identity hints never disable another stored account.
    #[test]
    fn logout_explicit_unmatched_filter_never_falls_back() {
        let mut conn = logout_db();
        add_cred(
            &conn,
            "p",
            "email:alice@x.com",
            r#"{"email":"alice@x.com"}"#,
        );
        let err =
            logout_credentials_conn(&mut conn, "p", Some("bob@x.com"), None, false).unwrap_err();
        assert!(err.contains("未找到匹配的授权账号"), "{err}");
        assert_eq!(active(&conn), 1);
        let err =
            logout_credentials_conn(&mut conn, "p", None, Some("acct-bob"), false).unwrap_err();
        assert!(err.contains("未找到匹配的授权账号"), "{err}");
        assert_eq!(active(&conn), 1);
        assert_eq!(
            logout_credentials_conn(&mut conn, "p", Some("alice@x.com"), None, false),
            Ok(1)
        );
        assert_eq!(active(&conn), 0);
    }

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
