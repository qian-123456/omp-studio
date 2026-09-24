//! [E] Tauri commands: mobile + tunnel (docs/ARCHITECTURE.md §7).

use crate::contracts::{MobileStatus, PairingInfo};
use crate::state::AppState;

#[tauri::command]
pub async fn mobile_start(state: tauri::State<'_, AppState>) -> Result<MobileStatus, String> {
    super::start(&state).await
}

#[tauri::command]
pub async fn mobile_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    super::stop(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn mobile_status() -> Result<MobileStatus, String> {
    Ok(super::status())
}

/// `via_tunnel`: build the pairing link on the public tunnel URL instead of the LAN URL.
#[tauri::command]
pub async fn mobile_create_pairing(
    state: tauri::State<'_, AppState>,
    via_tunnel: Option<bool>,
) -> Result<PairingInfo, String> {
    super::create_pairing(&state, via_tunnel.unwrap_or(false)).await
}

#[tauri::command]
pub async fn mobile_revoke_all(state: tauri::State<'_, AppState>) -> Result<(), String> {
    super::auth::revoke_all(&state.db.lock()).map_err(|e| format!("撤销失败: {e}"))
}

#[tauri::command]
pub async fn tunnel_start(state: tauri::State<'_, AppState>) -> Result<MobileStatus, String> {
    let st = super::start(&state).await?;
    let (mode, name, host) = {
        let s = state.settings.read();
        (
            s.tunnel_mode.clone(),
            s.tunnel_name.clone(),
            s.tunnel_hostname.clone(),
        )
    };
    super::tunnel::start(&mode, st.port, name, host).await?;
    Ok(super::status())
}

#[tauri::command]
pub async fn tunnel_stop() -> Result<(), String> {
    super::tunnel::stop();
    Ok(())
}
