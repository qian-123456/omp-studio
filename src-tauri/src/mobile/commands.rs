//! [E] Tauri commands: mobile + tunnel (docs/ARCHITECTURE.md §7).

use crate::contracts::{MobileDevice, MobileDeviceWork, MobileStatus, PairingInfo, PairingTarget};
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
    let devices = {
        let db = state.db.lock();
        let devices = super::auth::list_devices(&db).map_err(|e| format!("撤销失败: {e}"))?;
        for device in devices {
            super::work::device_revoked(&device.id);
        }
        super::auth::revoke_all_devices(&db).map_err(|e| format!("撤销失败: {e}"))?
    };
    for (_, hash) in devices {
        super::auth::notify_revoked(&hash);
    }
    Ok(())
}

#[tauri::command]
pub async fn mobile_list_devices(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MobileDevice>, String> {
    super::auth::list_devices(&state.db.lock()).map_err(|e| format!("读取设备失败: {e}"))
}

#[tauri::command]
pub async fn mobile_rename_device(
    state: tauri::State<'_, AppState>,
    device_id: String,
    name: String,
) -> Result<(), String> {
    match super::auth::rename_device(&state.db.lock(), &device_id, &name) {
        Ok(true) => Ok(()),
        Ok(false) => Err("设备不存在".into()),
        Err(e) => Err(format!("重命名失败: {e}")),
    }
}

#[tauri::command]
pub async fn mobile_device_work(
    state: tauri::State<'_, AppState>,
    device_id: String,
) -> Result<Vec<MobileDeviceWork>, String> {
    Ok(super::work::list(&state, &device_id).await)
}

#[tauri::command]
pub async fn mobile_revoke_device(
    state: tauri::State<'_, AppState>,
    device_id: String,
    stop_work_ids: Vec<String>,
) -> Result<(), String> {
    super::work::cancel(&state, &device_id, &stop_work_ids).await?;
    super::work::device_revoked(&device_id);
    let hash = super::auth::revoke_device(&state.db.lock(), &device_id)
        .map_err(|e| format!("撤销失败: {e}"))?
        .ok_or_else(|| "设备不存在".to_string())?;
    super::auth::notify_revoked(&hash);
    Ok(())
}

#[tauri::command]
pub async fn tunnel_start(state: tauri::State<'_, AppState>) -> Result<MobileStatus, String> {
    super::start(&state).await?;
    let (mode, name, host) = {
        let s = state.settings.read();
        (
            s.tunnel_mode.clone(),
            s.tunnel_name.clone(),
            s.tunnel_hostname.clone(),
        )
    };
    let (port, shutdown) = super::tunnel_origin()?;
    super::tunnel::start(&mode, port, name, host, shutdown).await?;
    Ok(super::status(&state))
}

#[tauri::command]
pub async fn tunnel_stop() -> Result<(), String> {
    super::tunnel::stop();
    Ok(())
}

#[tauri::command]
pub async fn tunnel_cloudflared_login() -> Result<bool, String> {
    super::tunnel::login().await
}
