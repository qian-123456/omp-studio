//! [C] Tauri commands: services + text file IO (docs/ARCHITECTURE.md §7).

use base64::Engine as _;
use tauri::Manager as _;

use super::files;
use crate::contracts::{DirEntry, PathCheck, ServiceInfo};
use crate::state::AppState;
#[tauri::command]
pub async fn services_list(
    _state: tauri::State<'_, AppState>,
    all: bool,
) -> Result<Vec<ServiceInfo>, String> {
    Ok(crate::services::list(all).await)
}

#[tauri::command]
pub async fn services_stop(_state: tauri::State<'_, AppState>, pid: u32) -> Result<(), String> {
    crate::services::stop(pid).await
}

/// For the md editor; must reject paths > 5 MB.
#[tauri::command]
pub async fn read_text_file(
    _state: tauri::State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let p = files::resolve(&path)?;
    tokio::task::spawn_blocking(move || files::read_text(&p))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_text_file(
    _state: tauri::State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let p = files::resolve(&path)?;
    tokio::task::spawn_blocking(move || files::write_text(&p, &content))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_read_dir(
    _state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    let p = files::resolve(&path)?;
    tokio::task::spawn_blocking(move || {
        let entries = match std::fs::read_dir(&p) {
            Ok(e) => e,
            Err(e) => return Err(format!("读取目录失败: {e}")),
        };
        let mut list: Vec<DirEntry> = Vec::new();
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            // Skip noisy macOS metadata
            if file_name == ".DS_Store" || file_name == "Thumbs.db" {
                continue;
            }
            let child_path = entry.path();
            let is_symlink = entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false);
            let md = entry
                .metadata()
                .or_else(|_| std::fs::symlink_metadata(&child_path));
            let (is_dir, size, readonly) = match md {
                Ok(m) => (m.is_dir(), m.len(), m.permissions().readonly()),
                Err(_) => (false, 0, false),
            };
            list.push(DirEntry {
                name: file_name,
                path: child_path.to_string_lossy().into_owned(),
                is_dir,
                is_symlink,
                size,
                readonly,
            });
        }
        // Sort: directories first, then case-insensitive alphabetical
        list.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn validate_path_internal(path: &str) -> PathCheck {
    let p = if let Some(rest) = path.strip_prefix("~/") {
        dirs::home_dir()
            .map(|h| h.join(rest))
            .unwrap_or_else(|| std::path::PathBuf::from(path))
    } else if path == "~" {
        dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(path))
    } else {
        std::path::PathBuf::from(path)
    };
    match std::fs::metadata(&p) {
        Ok(m) => PathCheck {
            exists: true,
            is_dir: m.is_dir(),
        },
        Err(_) => PathCheck {
            exists: false,
            is_dir: false,
        },
    }
}

pub fn save_clipboard_image_internal(
    cache_dir: &std::path::Path,
    base64_png: &str,
) -> Result<String, String> {
    let clip_dir = cache_dir.join("ompws-clip");
    std::fs::create_dir_all(&clip_dir).map_err(|e| format!("创建剪贴板图片缓存目录失败：{e}"))?;

    let clean_b64 = if let Some(idx) = base64_png.find(',') {
        &base64_png[idx + 1..]
    } else {
        base64_png
    };
    let clean_b64: String = clean_b64.chars().filter(|c| !c.is_whitespace()).collect();

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&clean_b64)
        .map_err(|e| format!("Base64 解码失败：{e}"))?;

    let ts = chrono::Utc::now().timestamp_millis();
    let file_path = clip_dir.join(format!("{ts}.png"));
    std::fs::write(&file_path, bytes).map_err(|e| format!("保存图片失败：{e}"))?;

    Ok(file_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn validate_path(path: String) -> Result<PathCheck, String> {
    Ok(validate_path_internal(&path))
}

#[tauri::command]
pub async fn save_clipboard_image(
    app: tauri::AppHandle,
    base64_png: String,
) -> Result<String, String> {
    let cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| {
        dirs::cache_dir()
            .map(|d| d.join("omp-workspace"))
            .unwrap_or_else(std::env::temp_dir)
    });
    save_clipboard_image_internal(&cache_dir, &base64_png)
}
#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn get_resident_memory_bytes() -> u64 {
    use std::mem::MaybeUninit;
    let mut task_info = MaybeUninit::<libc::mach_task_basic_info>::uninit();
    let mut count = (std::mem::size_of::<libc::mach_task_basic_info>()
        / std::mem::size_of::<libc::natural_t>())
        as libc::mach_msg_type_number_t;
    let kerr = unsafe {
        libc::task_info(
            libc::mach_task_self(),
            libc::MACH_TASK_BASIC_INFO,
            task_info.as_mut_ptr() as libc::task_info_t,
            &mut count,
        )
    };
    if kerr == libc::KERN_SUCCESS {
        let task_info = unsafe { task_info.assume_init() };
        task_info.resident_size
    } else {
        0
    }
}

#[cfg(target_os = "linux")]
fn get_resident_memory_bytes() -> u64 {
    if let Ok(status) = std::fs::read_to_string("/proc/self/statm") {
        if let Some(pages) = status
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u64>().ok())
        {
            let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
            if page_size > 0 {
                return pages * page_size as u64;
            }
        }
    }
    0
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn get_resident_memory_bytes() -> u64 {
    0
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryInfo {
    pub resident_mb: f64,
    pub formatted: String,
}

#[tauri::command]
pub async fn app_memory_usage() -> Result<ProcessMemoryInfo, String> {
    let bytes = get_resident_memory_bytes();
    let mb = (bytes as f64) / (1024.0 * 1024.0);
    let formatted = if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{:.0} MB", mb)
    };
    Ok(ProcessMemoryInfo {
        resident_mb: mb,
        formatted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_path() {
        let check_tmp = validate_path_internal("/tmp");
        assert!(check_tmp.exists);
        assert!(check_tmp.is_dir);

        let check_home = validate_path_internal("~");
        assert!(check_home.exists);
        assert!(check_home.is_dir);

        let check_nonexistent = validate_path_internal("/nonexistent_path_xyz_12345");
        assert!(!check_nonexistent.exists);
        assert!(!check_nonexistent.is_dir);
    }

    #[test]
    fn test_save_clipboard_image() {
        let temp_dir = std::env::temp_dir().join(format!("ompws-test-clip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_dir);

        // Minimal base64 data URL
        let raw_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        let data_url = format!("data:image/png;base64,{raw_b64}");

        let path_str = save_clipboard_image_internal(&temp_dir, &data_url).unwrap();
        let path = std::path::Path::new(&path_str);
        assert!(path.exists());
        assert!(path.is_file());
        assert!(path_str.ends_with(".png"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_app_memory_usage() {
        let mem = app_memory_usage().await.unwrap();
        assert!(mem.formatted.contains("MB") || mem.formatted.contains("GB"));
        #[cfg(target_os = "macos")]
        assert!(mem.resident_mb > 0.0);
    }
}
