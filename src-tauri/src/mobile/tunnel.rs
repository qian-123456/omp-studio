//! cloudflared tunnel (quick: trycloudflare.com URL parsed from stderr; named: fixed hostname).

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use parking_lot::Mutex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;

use crate::terminal::env;

struct Active {
    gen: u64,
    url: String,
    kill: Option<oneshot::Sender<()>>,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);
static GEN: AtomicU64 = AtomicU64::new(0);

pub const MISSING_MSG: &str =
    "未找到 cloudflared。请先安装：brew install cloudflared（安装后重试）";

pub fn installed() -> bool {
    env::which("cloudflared").is_some()
}

pub const DEFAULT_TUNNEL_NAME: &str = "omp-mobile";

pub fn logged_in() -> bool {
    dirs::home_dir()
        .map(|h| h.join(".cloudflared").join("cert.pem").is_file())
        .unwrap_or(false)
}

/// Run `cloudflared tunnel login` (opens browser) and wait up to 120s for cert.pem.
pub async fn login() -> Result<bool, String> {
    if logged_in() {
        return Ok(true);
    }
    let bin = env::which("cloudflared").ok_or(MISSING_MSG)?;
    let mut child = tokio::process::Command::new(bin)
        .args(["tunnel", "login"])
        .env("PATH", env::augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("启动 cloudflared 失败: {e}"))?;
    for pipe in [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    {
        tokio::spawn(async move {
            let mut lines = BufReader::new(pipe).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
    while tokio::time::Instant::now() < deadline {
        if logged_in() {
            return Ok(true);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let _ = child.start_kill();
    Err("等待 Cloudflare 授权超时（120 秒），请重试".into())
}

/// Create the named tunnel (idempotent) and route `hostname` to it via DNS.
pub async fn ensure_tunnel_and_route(name: &str, hostname: &str) -> Result<(), String> {
    let bin = env::which("cloudflared").ok_or(MISSING_MSG)?;
    async fn run(bin: &std::path::Path, args: &[&str]) -> Result<std::process::Output, String> {
        tokio::process::Command::new(bin)
            .args(args)
            .env("PATH", env::augmented_path())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| format!("运行 cloudflared 失败: {e}"))
    }
    let out = run(&bin, &["tunnel", "create", name]).await?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if !err.contains("already exists") {
            return Err(format!("创建隧道失败：{}", err.trim()));
        }
    }
    let out = run(&bin, &["tunnel", "route", "dns", "-f", name, hostname]).await?;
    if !out.status.success() {
        return Err(format!(
            "配置 DNS 路由失败：{}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

pub fn url() -> Option<String> {
    ACTIVE.lock().as_ref().map(|a| a.url.clone())
}

/// Extract the first `https://<sub>.trycloudflare.com` URL from a log line.
pub fn parse_quick_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '|' || c == '"')
        .unwrap_or(rest.len());
    let candidate = &rest[..end];
    let host = candidate.strip_prefix("https://")?;
    (host.ends_with(".trycloudflare.com") && host != "api.trycloudflare.com")
        .then(|| candidate.to_string())
}

/// Build cloudflared argv (without the binary) for a mode.
pub fn args(mode: &str, port: u16, name: Option<&str>) -> Result<Vec<String>, String> {
    let origin = format!("http://localhost:{port}");
    match mode {
        "quick" => Ok(vec!["tunnel".into(), "--url".into(), origin]),
        "named" => {
            let name = name
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .unwrap_or(DEFAULT_TUNNEL_NAME);
            Ok(vec![
                "tunnel".into(),
                "run".into(),
                "--url".into(),
                origin,
                name.trim().into(),
            ])
        }
        _ => Err("请先在设置中选择隧道模式（临时隧道 / 命名隧道）".into()),
    }
}

/// Start (or return the running) tunnel. Returns the public URL.
pub async fn start(
    mode: &str,
    port: u16,
    name: Option<String>,
    hostname: Option<String>,
) -> Result<String, String> {
    if let Some(u) = url() {
        return Ok(u);
    }
    let name = if mode == "named" {
        Some(
            name.as_deref()
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .unwrap_or(DEFAULT_TUNNEL_NAME)
                .to_string(),
        )
    } else {
        name
    };
    let argv = args(mode, port, name.as_deref())?;
    let fixed_url = if mode == "named" {
        let host = hostname
            .map(|h| {
                h.trim()
                    .trim_start_matches("https://")
                    .trim_end_matches('/')
                    .to_string()
            })
            .filter(|h| !h.is_empty())
            .ok_or("命名隧道需要先填写公网域名（hostname）")?;
        ensure_tunnel_and_route(name.as_deref().unwrap_or(DEFAULT_TUNNEL_NAME), &host).await?;
        Some(format!("https://{host}"))
    } else {
        None
    };
    let bin = env::which("cloudflared").ok_or(MISSING_MSG)?;
    let mut child = tokio::process::Command::new(bin)
        .args(&argv)
        .env("PATH", env::augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("启动 cloudflared 失败: {e}"))?;

    // Drain stderr forever; report the first quick URL (or the log tail on exit).
    let stderr = child
        .stderr
        .take()
        .ok_or("cloudflared stderr unavailable")?;
    let (url_tx, url_rx) = oneshot::channel::<Result<String, String>>();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut url_tx = Some(url_tx);
        let mut tail: Vec<String> = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(u) = parse_quick_url(&line) {
                if let Some(tx) = url_tx.take() {
                    let _ = tx.send(Ok(u));
                }
            }
            tail.push(line);
            if tail.len() > 8 {
                tail.remove(0);
            }
        }
        if let Some(tx) = url_tx.take() {
            let _ = tx.send(Err(format!("cloudflared 已退出：{}", tail.join(" / "))));
        }
    });

    let public = match fixed_url {
        Some(u) => {
            // Named tunnels print no URL; just make sure it did not die on startup.
            tokio::time::sleep(Duration::from_secs(3)).await;
            if let Ok(Some(status)) = child.try_wait() {
                let detail = match tokio::time::timeout(Duration::from_secs(1), url_rx).await {
                    Ok(Ok(Err(e))) => e,
                    _ => String::new(),
                };
                return Err(format!("cloudflared 启动失败（{status}）{detail}"));
            }
            u
        }
        None => match tokio::time::timeout(Duration::from_secs(40), url_rx).await {
            Ok(Ok(Ok(u))) => u,
            Ok(Ok(Err(e))) => return Err(e),
            _ => {
                let _ = child.start_kill();
                return Err("等待临时隧道地址超时".into());
            }
        },
    };

    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    *ACTIVE.lock() = Some(Active {
        gen,
        url: public.clone(),
        kill: Some(kill_tx),
    });
    tokio::spawn(async move {
        tokio::select! {
            _ = child.wait() => {}
            _ = kill_rx => {
                let _ = child.kill().await;
                // Reap the child so it does not linger as a zombie.
                let _ = child.wait().await;
            }
        }
        let mut active = ACTIVE.lock();
        if active.as_ref().is_some_and(|a| a.gen == gen) {
            *active = None;
        }
    });
    Ok(public)
}

pub fn stop() {
    if let Some(mut a) = ACTIVE.lock().take() {
        if let Some(k) = a.kill.take() {
            let _ = k.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quick_url_from_banner() {
        let line = "2024-01-01T00:00:00Z INF |  https://brave-lion-12.trycloudflare.com                    |";
        assert_eq!(
            parse_quick_url(line).as_deref(),
            Some("https://brave-lion-12.trycloudflare.com")
        );
        assert!(
            parse_quick_url("INF Requesting new quick Tunnel on trycloudflare.com...").is_none()
        );
        assert!(parse_quick_url("see https://developers.cloudflare.com/foo").is_none());
        assert!(parse_quick_url("POST https://api.trycloudflare.com/tunnel").is_none());
    }

    #[test]
    fn builds_args_per_mode() {
        assert_eq!(
            args("quick", 7788, None).unwrap(),
            ["tunnel", "--url", "http://localhost:7788"]
        );
        assert_eq!(
            args("named", 7788, Some("ws")).unwrap(),
            ["tunnel", "run", "--url", "http://localhost:7788", "ws"]
        );
        assert_eq!(
            args("named", 7788, Some(" ")).unwrap().last().unwrap(),
            "omp-mobile"
        );
        assert!(args("off", 7788, None).is_err());
    }
}
