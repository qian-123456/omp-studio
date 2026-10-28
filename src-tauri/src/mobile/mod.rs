//! [E] LAN HTTP server, pairing, QR, SSE, cloudflared tunnel, IPv6 HTTPS.

pub mod api;
pub mod assets;
pub mod auth;
pub mod backend;
pub mod commands;
pub mod ddns;
pub mod ipv6;
pub mod last;
pub mod push;
pub mod server;
pub mod tls;
pub mod tunnel;

use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::watch;

use crate::contracts::{MobileStatus, PairingInfo, PairingTarget};
use crate::state::AppState;

struct Running {
    port: u16,
    shutdown: watch::Sender<bool>,
}

struct Ipv6Running {
    port: u16,
    shutdown: watch::Sender<bool>,
    /// Fingerprint of the certificate this listener is actually serving.
    cert_sha256: String,
    /// Hostname covered when this listener's certificate was loaded.
    cert_hostname: Option<String>,
}

static SERVER: Mutex<Option<Running>> = Mutex::new(None);
static IPV6_SERVER: Mutex<Option<Ipv6Running>> = Mutex::new(None);
static LIFECYCLE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) fn tunnel_origin() -> Result<(u16, watch::Receiver<bool>), String> {
    SERVER
        .lock()
        .as_ref()
        .map(|r| (r.port, r.shutdown.subscribe()))
        .ok_or_else(|| "手机服务已停止".into())
}

fn covered_ddns_host<'a>(advertised: Option<&'a str>, served: Option<&str>) -> Option<&'a str> {
    advertised.filter(|host| {
        served.is_some_and(|cert_host| cert_host.trim().eq_ignore_ascii_case(host.trim()))
    })
}

/// Autostart when settings.mobile_enabled (and settings.mobile_ipv6_enabled).
pub fn init(state: AppState) {
    ddns::init(state.clone());

    let (mobile_enabled, ipv6_enabled) = {
        let s = state.settings.read();
        (s.mobile_enabled, s.mobile_ipv6_enabled)
    };

    if !mobile_enabled {
        return;
    }

    let state_clone = state.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = start(&state_clone).await {
            tracing::warn!("mobile autostart failed: {e}");
            return;
        }
        if ipv6_enabled {
            if let Err(e) = ipv6_start(&state_clone).await {
                tracing::warn!("mobile ipv6 autostart failed: {e}");
            }
        }
    });
}

fn lan_ip() -> String {
    match local_ip_address::local_ip() {
        Ok(ip) if ip.is_ipv4() => ip.to_string(),
        _ => "127.0.0.1".to_string(),
    }
}

pub fn status(state: &AppState) -> MobileStatus {
    let port = SERVER.lock().as_ref().map(|r| r.port);
    let (ipv6_running, ipv6_port, cert_sha256, cert_hostname) = {
        let ipv6 = IPV6_SERVER.lock();
        (
            ipv6.is_some(),
            ipv6.as_ref()
                .map(|r| r.port)
                .unwrap_or_else(|| state.settings.read().mobile_ipv6_port),
            // Fingerprint of the cert being served; never regenerated here
            // (that only happens in ipv6_start).
            ipv6.as_ref().map(|r| r.cert_sha256.clone()),
            ipv6.as_ref().and_then(|r| r.cert_hostname.clone()),
        )
    };
    let current_v6 = ipv6::current_address();
    let ddns_st = ddns::status(state);

    let ipv6_url = if ipv6_running {
        current_v6.map(|addr| {
            let addr_str = addr.to_string();
            let ddns_synced = ddns_st.enabled
                && ddns_st.last_ip.as_deref() == Some(&addr_str)
                && covered_ddns_host(ddns_st.hostname.as_deref(), cert_hostname.as_deref())
                    .is_some();
            if ddns_synced {
                let host = ddns_st.hostname.as_deref().unwrap_or(&addr_str);
                format!("https://{host}:{ipv6_port}")
            } else {
                format!("https://[{addr_str}]:{ipv6_port}")
            }
        })
    } else {
        None
    };

    MobileStatus {
        running: port.is_some(),
        port: port.unwrap_or(0),
        lan_url: port.map(|p| format!("http://{}:{p}", lan_ip())),
        tunnel_url: tunnel::url(),
        cloudflared_installed: tunnel::installed(),
        cloudflared_logged_in: tunnel::logged_in(),
        ipv6_running,
        ipv6_port,
        ipv6_address: current_v6.map(|a| a.to_string()),
        ipv6_url,
        cert_sha256,
        ddns: ddns_st,
    }
}

/// Persist the autostart flag through the shared settings writer (no lock held
/// across the await; errors are logged, never fatal to server start/stop).
async fn persist_enabled(state: &AppState, enabled: bool) {
    if state.settings.read().mobile_enabled == enabled {
        return;
    }
    if let Err(e) = crate::settings::set_mobile_enabled(state, enabled).await {
        tracing::warn!("persist mobile_enabled={enabled}: {e}");
    }
}

async fn persist_ipv6_enabled(state: &AppState, enabled: bool) {
    if state.settings.read().mobile_ipv6_enabled == enabled {
        return;
    }
    if let Err(e) = crate::settings::set_mobile_ipv6_enabled(state, enabled).await {
        tracing::warn!("persist mobile_ipv6_enabled={enabled}: {e}");
    }
}

async fn start_internal(state: &AppState) -> Result<(), String> {
    if SERVER.lock().is_some() {
        return Ok(());
    }
    let port = state.settings.read().mobile_port;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("无法监听端口 {port}（可能被占用）: {e}"))?;
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    let (tx, rx) = watch::channel(false);
    *SERVER.lock() = Some(Running { port, shutdown: tx });
    let ctx = Arc::new(server::Ctx {
        backend: backend::AppBackend(state.clone()),
        db: state.db.clone(),
        shutdown: rx,
    });
    let push_shutdown = ctx.shutdown.clone();
    tokio::spawn(server::serve(listener, ctx));
    tokio::spawn(push::run(state.clone(), push_shutdown));
    persist_enabled(state, true).await;
    Ok(())
}

pub async fn start(state: &AppState) -> Result<MobileStatus, String> {
    let _guard = LIFECYCLE_LOCK.lock().await;
    if SERVER.lock().is_none() {
        start_internal(state).await?;
    }
    Ok(status(state))
}

pub async fn stop(state: &AppState) {
    let _guard = LIFECYCLE_LOCK.lock().await;
    tunnel::stop();
    if let Some(r) = IPV6_SERVER.lock().take() {
        let _ = r.shutdown.send(true);
    }
    if let Some(r) = SERVER.lock().take() {
        let _ = r.shutdown.send(true);
    }
    persist_enabled(state, false).await;
    persist_ipv6_enabled(state, false).await;
}

pub async fn ipv6_start(state: &AppState) -> Result<MobileStatus, String> {
    let _guard = LIFECYCLE_LOCK.lock().await;

    // Ensures the main mobile server is running
    if SERVER.lock().is_none() {
        start_internal(state).await?;
    }

    if IPV6_SERVER.lock().is_some() {
        persist_ipv6_enabled(state, true).await;
        return Ok(status(state));
    }

    let port = state.settings.read().mobile_ipv6_port;

    // Bind [::]:<port> with IPV6_V6ONLY=true
    let domain = socket2::Domain::IPV6;
    let socket = socket2::Socket::new(domain, socket2::Type::STREAM, Some(socket2::Protocol::TCP))
        .map_err(|e| format!("创建 IPv6 套接字失败: {e}"))?;
    socket
        .set_only_v6(true)
        .map_err(|e| format!("设置 IPV6_V6ONLY 失败: {e}"))?;
    socket.set_reuse_address(true).ok();
    socket
        .set_nonblocking(true)
        .map_err(|e| format!("设置非阻塞失败: {e}"))?;

    let addr: std::net::SocketAddr = (std::net::Ipv6Addr::UNSPECIFIED, port).into();
    socket
        .bind(&addr.into())
        .map_err(|e| format!("无法监听端口 {port}（可能被占用）: {e}"))?;
    socket
        .listen(1024)
        .map_err(|e| format!("无法监听端口 {port}（可能被占用）: {e}"))?;

    let std_listener: std::net::TcpListener = socket.into();
    let listener = tokio::net::TcpListener::from_std(std_listener)
        .map_err(|e| format!("无法监听端口 {port}（可能被占用）: {e}"))?;
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(port);

    let ddns_host = state.settings.read().ddns_hostname.clone();
    let ident = tls::ensure_tls_identity(ddns_host.as_deref())?;
    let acceptor = tokio_rustls::TlsAcceptor::from(ident.server_config);
    let cert_sha256 = ident.cert_sha256.clone();

    let (tx, rx) = watch::channel(false);
    *IPV6_SERVER.lock() = Some(Ipv6Running {
        port,
        shutdown: tx,
        cert_sha256,
        cert_hostname: ddns_host,
    });

    let ctx = Arc::new(server::Ctx {
        backend: backend::AppBackend(state.clone()),
        db: state.db.clone(),
        shutdown: rx,
    });
    tokio::spawn(server::serve_tls(listener, acceptor, ctx));

    persist_ipv6_enabled(state, true).await;
    Ok(status(state))
}

pub async fn ipv6_stop(state: &AppState) {
    let _guard = LIFECYCLE_LOCK.lock().await;
    if let Some(r) = IPV6_SERVER.lock().take() {
        let _ = r.shutdown.send(true);
    }
    persist_ipv6_enabled(state, false).await;
}

/// SVG QR code for `text` (light background so phones scan it reliably).
pub fn qr_svg(text: &str) -> Result<String, String> {
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| format!("生成二维码失败: {e}"))?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .dark_color(qrcode::render::svg::Color("#000000"))
        .light_color(qrcode::render::svg::Color("#ffffff"))
        .build())
}

/// New one-time pairing link for the selected target (`lan`, `tunnel`, or `ipv6`).
pub async fn create_pairing(
    state: &AppState,
    target: PairingTarget,
) -> Result<PairingInfo, String> {
    let st = start(state).await?;
    let base = match target {
        PairingTarget::Lan => st.lan_url.ok_or("服务未启动")?,
        PairingTarget::Tunnel => st.tunnel_url.ok_or("隧道未启动")?,
        PairingTarget::Ipv6 => {
            let s = status(state);
            s.ipv6_url
                .ok_or_else(|| "IPv6 直连不可用（未启动或无公网 IPv6 地址）".to_string())?
        }
    };
    let (code, expires_at) = auth::create_pairing(&state.db.lock(), chrono::Utc::now())
        .map_err(|e| format!("创建配对码失败: {e}"))?;
    let url = format!("{}/pair?code={code}", base.trim_end_matches('/'));
    Ok(PairingInfo {
        qr_svg: qr_svg(&url)?,
        url,
        expires_at,
    })
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod infra_tests {
    use super::*;

    #[test]
    fn changed_ddns_hostname_is_not_advertised_under_old_certificate() {
        assert_eq!(
            covered_ddns_host(Some("old.example"), Some("old.example")),
            Some("old.example")
        );
        assert_eq!(
            covered_ddns_host(Some("new.example"), Some("old.example")),
            None
        );
        assert_eq!(covered_ddns_host(Some("new.example"), None), None);
        // Only a new listener with the new certificate may advertise this name.
        assert_eq!(
            covered_ddns_host(Some("new.example"), Some("new.example")),
            Some("new.example")
        );
        assert_eq!(
            covered_ddns_host(Some("OLD.example"), Some(" old.example ")),
            Some("OLD.example")
        );
    }
}
