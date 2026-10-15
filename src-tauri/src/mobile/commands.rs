//! [E] Tauri commands: mobile + tunnel (docs/ARCHITECTURE.md §7).

use crate::contracts::{MobileStatus, PairingInfo, PairingTarget};
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
pub async fn mobile_status(state: tauri::State<'_, AppState>) -> Result<MobileStatus, String> {
    Ok(super::status(&state))
}

#[tauri::command]
pub async fn mobile_ipv6_start(state: tauri::State<'_, AppState>) -> Result<MobileStatus, String> {
    super::ipv6_start(&state).await
}

#[tauri::command]
pub async fn mobile_ipv6_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    super::ipv6_stop(&state).await;
    Ok(())
}

/// `target`: build the pairing link on the LAN, tunnel, or IPv6 direct URL.
#[tauri::command]
pub async fn mobile_create_pairing(
    state: tauri::State<'_, AppState>,
    target: Option<PairingTarget>,
) -> Result<PairingInfo, String> {
    super::create_pairing(&state, target.unwrap_or_default()).await
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
    Ok(super::status(&state))
}

#[tauri::command]
pub async fn tunnel_stop() -> Result<(), String> {
    super::tunnel::stop();
    Ok(())
}
