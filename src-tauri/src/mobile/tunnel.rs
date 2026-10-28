//! cloudflared tunnel (quick: trycloudflare.com URL parsed from stderr; named: fixed hostname).

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use parking_lot::Mutex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{oneshot, watch};

use crate::terminal::env;

struct Active {
    gen: u64,
    url: Option<String>,
    kill: Option<oneshot::Sender<()>>,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);
static GEN: AtomicU64 = AtomicU64::new(0);
static NEXT_OWNER: AtomicU64 = AtomicU64::new(0);
static START_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct StartLease(u64);

impl Drop for StartLease {
    fn drop(&mut self) {
        let mut active = ACTIVE.lock();
        if active.as_ref().is_some_and(|a| a.gen == self.0) {
            active.take();
        }
    }
}

fn publish(gen: u64, public: &str) -> bool {
    let mut active = ACTIVE.lock();
    let Some(entry) = active.as_mut().filter(|a| a.gen == gen) else {
        return false;
    };
    entry.url = Some(public.to_string());
    true
}

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
    ACTIVE.lock().as_ref().and_then(|a| a.url.clone())
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

/// Own startup before the first await so stop also cancels unready tunnels.
pub async fn start(
    mode: &str,
    port: u16,
    name: Option<String>,
    hostname: Option<String>,
    mut shutdown: watch::Receiver<bool>,
) -> Result<String, String> {
    let epoch = GEN.load(Ordering::SeqCst);
    let _serial = START_LOCK.lock().await;
    if *shutdown.borrow() || GEN.load(Ordering::SeqCst) != epoch {
        return Err("隧道启动已取消".into());
    }
    if let Some(u) = url() {
        return Ok(u);
    }
    let (kill_tx, mut kill_rx) = oneshot::channel();
    let gen = {
        let mut active = ACTIVE.lock();
        if GEN.load(Ordering::SeqCst) != epoch {
            return Err("隧道启动已取消".into());
        }
        let gen = NEXT_OWNER.fetch_add(1, Ordering::SeqCst) + 1;
        *active = Some(Active {
            gen,
            url: None,
            kill: Some(kill_tx),
        });
        gen
    };
    let lease = StartLease(gen);
    let (mut child, public) = tokio::select! {
        biased;
        _ = shutdown.changed() => return Err("手机服务已停止".into()),
        _ = &mut kill_rx => return Err("隧道启动已取消".into()),
        result = prepare(mode, port, name, hostname) => result?,
    };
    if *shutdown.borrow() || !publish(gen, &public) {
        return Err("隧道启动已取消".into());
    }
    tokio::spawn(async move {
        let _lease = lease;
        tokio::select! {
            _ = child.wait() => {}
            _ = shutdown.changed() => { let _ = child.kill().await; }
            _ = kill_rx => { let _ = child.kill().await; }
        }
        let _ = child.wait().await;
    });
    Ok(public)
}

async fn prepare(
    mode: &str,
    port: u16,
    name: Option<String>,
    hostname: Option<String>,
) -> Result<(tokio::process::Child, String), String> {
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

    Ok((child, public))
}

pub fn stop() {
    // Invalidate starts already queued behind START_LOCK as well.
    let mut active = ACTIVE.lock();
    GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(mut a) = active.take() {
        if let Some(k) = a.kill.take() {
            let _ = k.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[tokio::test]
    async fn stop_cancels_pending_owner_and_rejects_late_publication() {
        let _test = TEST_LOCK.lock().await;
        let _serial = START_LOCK.lock().await;
        let gen = NEXT_OWNER.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        *ACTIVE.lock() = Some(Active {
            gen,
            url: None,
            kill: Some(tx),
        });
        let lease = StartLease(gen);
        assert_eq!(url(), None);
        stop();
        assert!(rx.await.is_ok(), "pending startup receives cancellation");
        assert!(!publish(gen, "https://late.trycloudflare.com"));
        drop(lease);
        assert_eq!(url(), None);
    }

    #[tokio::test]
    async fn stale_owner_cannot_replace_or_clear_new_tunnel() {
        let _test = TEST_LOCK.lock().await;
        let _serial = START_LOCK.lock().await;
        let old = NEXT_OWNER.fetch_add(1, Ordering::SeqCst) + 1;
        let stale = StartLease(old);
        let gen = NEXT_OWNER.fetch_add(1, Ordering::SeqCst) + 1;
        *ACTIVE.lock() = Some(Active {
            gen,
            url: None,
            kill: None,
        });
        assert!(publish(gen, "https://new.trycloudflare.com"));
        assert!(!publish(old, "https://old.trycloudflare.com"));
        drop(stale);
        assert_eq!(url().as_deref(), Some("https://new.trycloudflare.com"));
        stop();
    }

    #[tokio::test]
    async fn stop_invalidates_start_waiting_for_the_start_lock() {
        let _test = TEST_LOCK.lock().await;
        let serial = START_LOCK.lock().await;
        let (_tx, rx) = watch::channel(false);
        let start = start("off", 1, None, None, rx);
        tokio::pin!(start);
        assert!(futures_util::poll!(&mut start).is_pending());
        stop();
        drop(serial);
        assert_eq!(start.await.unwrap_err(), "隧道启动已取消");
        assert!(url().is_none());
    }

    #[tokio::test]
    async fn concurrent_starts_return_the_same_owned_tunnel() {
        let _test = TEST_LOCK.lock().await;
        let serial = START_LOCK.lock().await;
        let gen = NEXT_OWNER.fetch_add(1, Ordering::SeqCst) + 1;
        *ACTIVE.lock() = Some(Active {
            gen,
            url: Some("https://one.trycloudflare.com".into()),
            kill: None,
        });
        let (_tx, rx) = watch::channel(false);
        let first = start("off", 1, None, None, rx.clone());
        let second = start("off", 1, None, None, rx);
        tokio::pin!(first, second);
        assert!(futures_util::poll!(&mut first).is_pending());
        assert!(futures_util::poll!(&mut second).is_pending());
        drop(serial);
        let (first, second) = tokio::join!(first, second);
        assert_eq!(first.unwrap(), "https://one.trycloudflare.com");
        assert_eq!(second.unwrap(), "https://one.trycloudflare.com");
        stop();
    }

    #[tokio::test]
    async fn stopped_origin_cannot_start_a_tunnel() {
        let _test = TEST_LOCK.lock().await;
        let (tx, rx) = watch::channel(false);
        tx.send(true).unwrap();
        // Invalid mode would produce a different error if prepare were reached.
        assert_eq!(
            start("off", 1, None, None, rx).await.unwrap_err(),
            "隧道启动已取消"
        );
    }

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
