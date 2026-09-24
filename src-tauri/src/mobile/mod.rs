//! [E] LAN HTTP server, pairing, QR, SSE, cloudflared tunnel.

pub mod auth;
pub mod backend;
pub mod commands;
pub mod last;
pub mod server;
pub mod tunnel;

use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::watch;

use crate::contracts::{MobileStatus, PairingInfo};
use crate::state::AppState;

struct Running {
    port: u16,
    shutdown: watch::Sender<bool>,
}

static SERVER: Mutex<Option<Running>> = Mutex::new(None);
static LIFECYCLE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Autostart when settings.mobile_enabled.
pub fn init(state: AppState) {
    if !state.settings.read().mobile_enabled {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(e) = start(&state).await {
            tracing::warn!("mobile autostart failed: {e}");
        }
    });
}

fn lan_ip() -> String {
    match local_ip_address::local_ip() {
        Ok(ip) if ip.is_ipv4() => ip.to_string(),
        _ => "127.0.0.1".to_string(),
    }
}

pub fn status() -> MobileStatus {
    let port = SERVER.lock().as_ref().map(|r| r.port);
    MobileStatus {
        running: port.is_some(),
        port: port.unwrap_or(0),
        lan_url: port.map(|p| format!("http://{}:{p}", lan_ip())),
        tunnel_url: tunnel::url(),
        cloudflared_installed: tunnel::installed(),
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

pub async fn start(state: &AppState) -> Result<MobileStatus, String> {
    let _guard = LIFECYCLE_LOCK.lock().await;
    if SERVER.lock().is_some() {
        return Ok(status());
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
    tokio::spawn(server::serve(listener, ctx));
    persist_enabled(state, true).await;
    Ok(status())
}

pub async fn stop(state: &AppState) {
    let _guard = LIFECYCLE_LOCK.lock().await;
    tunnel::stop();
    if let Some(r) = SERVER.lock().take() {
        let _ = r.shutdown.send(true);
    }
    persist_enabled(state, false).await;
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

/// New one-time pairing link for the LAN URL (or the tunnel URL when `via_tunnel`).
pub async fn create_pairing(state: &AppState, via_tunnel: bool) -> Result<PairingInfo, String> {
    let st = start(state).await?;
    let base = if via_tunnel {
        st.tunnel_url.ok_or("隧道未启动")?
    } else {
        st.lan_url.ok_or("服务未启动")?
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
