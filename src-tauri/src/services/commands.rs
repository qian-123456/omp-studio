//! [C] Tauri commands: services + text file IO (docs/ARCHITECTURE.md §7).

use base64::Engine as _;
use tauri::Manager as _;

use super::files;
use crate::contracts::{DirEntry, PathCheck, ServiceInfo};
pub use crate::contracts::{PerfBreakdown, ProcessMemoryInfo};
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
    files::ensure_not_protected(&p)?;
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
    files::ensure_not_protected(&p)?;
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
    files::ensure_not_protected(&p)?;
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
            size: if m.is_file() { m.len() } else { 0 },
        },
        Err(_) => PathCheck {
            exists: false,
            is_dir: false,
            size: 0,
        },
    }
}

/// Write a pasted image into `images_dir` (`paths::images_dir()`, durable).
pub fn save_clipboard_image_internal(
    images_dir: &std::path::Path,
    base64_png: &str,
) -> Result<String, String> {
    std::fs::create_dir_all(images_dir).map_err(|e| format!("创建图片目录失败：{e}"))?;

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
    let mut n = 0u32;
    let file_path = loop {
        let name = if n == 0 {
            format!("{ts}.png")
        } else {
            format!("{ts}-{n}.png")
        };
        let candidate = images_dir.join(name);
        if !candidate.exists() {
            break candidate;
        }
        n += 1;
    };
    std::fs::write(&file_path, bytes).map_err(|e| format!("保存图片失败：{e}"))?;

    Ok(file_path.to_string_lossy().into_owned())
}

/// Copy an existing image file into the durable images dir so its thumbnail
/// loads and the file outlives the source (Finder temp screenshots, files
/// outside the asset scope). Returns the copy's path; an image already inside
/// `images_dir` or the legacy `<cache>/ompws-clip` dir is returned as is.
pub fn import_image_file_internal(
    cache_dir: &std::path::Path,
    images_dir: &std::path::Path,
    src: &str,
) -> Result<String, String> {
    let src_path = std::path::Path::new(src);
    let meta = std::fs::metadata(src_path).map_err(|e| format!("读取图片失败：{e}"))?;
    if !meta.is_file() {
        return Err(format!("不是文件：{src}"));
    }
    let legacy_dir = cache_dir.join("ompws-clip");
    if src_path.parent() == Some(images_dir) || src_path.parent() == Some(legacy_dir.as_path()) {
        return Ok(src.to_string());
    }
    let clip_dir = images_dir;
    std::fs::create_dir_all(clip_dir).map_err(|e| format!("创建图片目录失败：{e}"))?;
    let ext = src_path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| "png".to_string());
    let ts = chrono::Utc::now().timestamp_millis();
    let mut n = 0u32;
    let dest = loop {
        let name = if n == 0 {
            format!("{ts}.{ext}")
        } else {
            format!("{ts}-{n}.{ext}")
        };
        let candidate = clip_dir.join(name);
        if !candidate.exists() {
            break candidate;
        }
        n += 1;
    };
    std::fs::copy(src_path, &dest).map_err(|e| format!("复制图片失败：{e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Decode a base64 (optionally `data:`-prefixed) PNG and write it to a
/// caller-chosen absolute `.png` path. Parent dirs are never created.
pub fn save_share_image_internal(base64_png: &str, path: &str) -> Result<(), String> {
    let file_path = std::path::Path::new(path);
    if !file_path.is_absolute() {
        return Err(format!("需要绝对路径：{path}"));
    }
    let is_png = file_path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"));
    if !is_png {
        return Err(format!("仅支持 .png 文件：{path}"));
    }

    let clean_b64 = if let Some(idx) = base64_png.find(',') {
        &base64_png[idx + 1..]
    } else {
        base64_png
    };
    let clean_b64: String = clean_b64.chars().filter(|c| !c.is_whitespace()).collect();

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&clean_b64)
        .map_err(|e| format!("Base64 解码失败：{e}"))?;
    std::fs::write(file_path, bytes).map_err(|e| format!("保存图片失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn validate_path(path: String) -> Result<PathCheck, String> {
    Ok(validate_path_internal(&path))
}

#[tauri::command]
pub async fn save_clipboard_image(base64_png: String) -> Result<String, String> {
    save_clipboard_image_internal(&crate::paths::images_dir(), &base64_png)
}

#[tauri::command]
pub async fn import_image_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| {
        dirs::cache_dir()
            .map(|d| d.join("omp-workspace"))
            .unwrap_or_else(std::env::temp_dir)
    });
    let images_dir = crate::paths::images_dir();
    tokio::task::spawn_blocking(move || import_image_file_internal(&cache_dir, &images_dir, &path))
        .await
        .map_err(|e| e.to_string())?
}

/// Chat share-as-image export: write the rendered PNG to the path the user
/// picked via the save dialog (which must already be absolute + `.png`).
#[tauri::command]
pub async fn save_share_image(base64_png: String, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || save_share_image_internal(&base64_png, &path))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
mod macos_mem {
    use super::{MemSnapshot, PerfMember};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    // RUSAGE_INFO_V5 is flavor 5 for proc_pid_rusage (sys/resource.h).
    // Not exposed as a constant in libc crate 0.2.
    const RUSAGE_INFO_V5: libc::c_int = 5;

    #[repr(C)]
    #[derive(Default, Copy, Clone)]
    pub struct rusage_info_v5 {
        pub ri_uuid: [u8; 16],
        pub ri_user_time: u64,
        pub ri_system_time: u64,
        pub ri_pkg_idle_wkups: u64,
        pub ri_interrupt_wkups: u64,
        pub ri_pageins: u64,
        pub ri_wired_size: u64,
        pub ri_resident_size: u64,
        pub ri_phys_footprint: u64,
        pub ri_proc_start_abstime: u64,
        pub ri_proc_exit_abstime: u64,
        pub ri_child_user_time: u64,
        pub ri_child_system_time: u64,
        pub ri_child_pkg_idle_wkups: u64,
        pub ri_child_interrupt_wkups: u64,
        pub ri_child_pageins: u64,
        pub ri_child_elapsed_abstime: u64,
        pub ri_diskio_bytesread: u64,
        pub ri_diskio_byteswritten: u64,
        pub ri_cpu_time_qos_default: u64,
        pub ri_cpu_time_qos_maintenance: u64,
        pub ri_cpu_time_qos_background: u64,
        pub ri_cpu_time_qos_utility: u64,
        pub ri_cpu_time_qos_legacy: u64,
        pub ri_cpu_time_qos_user_initiated: u64,
        pub ri_cpu_time_qos_user_interactive: u64,
        pub ri_billed_system_time: u64,
        pub ri_serviced_system_time: u64,
        pub ri_logical_writes: u64,
        pub ri_lifetime_max_phys_footprint: u64,
        pub ri_instructions: u64,
        pub ri_cycles: u64,
        pub ri_billed_energy: u64,
        pub ri_serviced_energy: u64,
        pub ri_interval_max_phys_footprint: u64,
        pub ri_runnable_time: u64,
        pub ri_flags: u64,
    }

    extern "C" {
        // macOS libproc APIs (provided by libSystem.B.dylib)
        fn proc_listallpids(buffer: *mut libc::c_void, buffersize: libc::c_int) -> libc::c_int;
        fn proc_pid_rusage(
            pid: libc::c_int,
            flavor: libc::c_int,
            buffer: *mut libc::c_void,
        ) -> libc::c_int;
        // Returns the responsible PID for attribution (aligned with macOS Activity Monitor)
        fn responsibility_get_pid_responsible_for_pid(pid: libc::c_int) -> libc::c_int;
    }

    /// Cached snapshot: attributed footprint + per-pid footprints of the
    /// processes macOS attributes to this app (self + responsible children).
    static CACHE: Mutex<Option<(Instant, MemSnapshot)>> = Mutex::new(None);
    const CACHE_TTL: Duration = Duration::from_millis(2500);

    pub fn get_attributed_snapshot() -> MemSnapshot {
        if let Ok(guard) = CACHE.lock() {
            if let Some((cached_at, snap)) = &*guard {
                if cached_at.elapsed() < CACHE_TTL {
                    return snap.clone();
                }
            }
        }

        let snap = compute_snapshot();

        if let Ok(mut guard) = CACHE.lock() {
            *guard = Some((Instant::now(), snap.clone()));
        }

        snap
    }

    /// Pids whose memory is attributed to this app (responsibility + self).
    /// Shared with `perf` so classification uses the same tree.
    pub fn app_responsible_pids() -> Vec<u32> {
        get_attributed_snapshot()
            .members
            .iter()
            .map(|m| m.pid)
            .collect()
    }

    fn compute_snapshot() -> MemSnapshot {
        let self_pid = std::process::id();

        // Query total running PIDs
        let needed = unsafe { proc_listallpids(std::ptr::null_mut(), 0) };
        let capacity = if needed > 0 {
            (needed as usize) + 64
        } else {
            1024
        };
        let mut pids = vec![0i32; capacity];

        let num_pids = unsafe {
            proc_listallpids(
                pids.as_mut_ptr() as *mut libc::c_void,
                (pids.len() * std::mem::size_of::<libc::c_int>()) as libc::c_int,
            )
        };

        let mut members: Vec<PerfMember> = Vec::new();

        if num_pids > 0 {
            let count = (num_pids as usize).min(pids.len());
            for &pid in &pids[..count] {
                if pid <= 0 {
                    continue;
                }
                let is_self = pid == self_pid as libc::c_int;
                let is_responsible = if !is_self {
                    let resp = unsafe { responsibility_get_pid_responsible_for_pid(pid) };
                    resp == self_pid as libc::c_int
                } else {
                    true
                };

                if is_responsible {
                    let mut ri = rusage_info_v5::default();
                    let ret = unsafe {
                        proc_pid_rusage(pid, RUSAGE_INFO_V5, &mut ri as *mut _ as *mut libc::c_void)
                    };
                    if ret == 0 {
                        members.push(PerfMember {
                            pid: pid as u32,
                            footprint_bytes: ri.ri_phys_footprint,
                        });
                    }
                }
            }
        }

        // Fallback: if process enumeration didn't find even self, query self directly
        if members.is_empty() {
            let mut ri = rusage_info_v5::default();
            let ret = unsafe {
                proc_pid_rusage(
                    self_pid as libc::c_int,
                    RUSAGE_INFO_V5,
                    &mut ri as *mut _ as *mut libc::c_void,
                )
            };
            if ret == 0 {
                members.push(PerfMember {
                    pid: self_pid,
                    footprint_bytes: ri.ri_phys_footprint,
                });
            } else {
                // Ultimate fallback to mach_task_basic_info
                let resident = get_mach_resident_size();
                if resident > 0 {
                    members.push(PerfMember {
                        pid: self_pid,
                        footprint_bytes: resident,
                    });
                }
            }
        }

        MemSnapshot::from_members(members)
    }

    /// Physical RAM (total, used) via `sysctl hw.memsize` + `host_statistics64`.
    /// `used` approximates Activity Monitor's used memory:
    /// (internal - purgeable + wired + compressor) pages.
    #[allow(deprecated)]
    pub fn system_memory() -> (Option<u64>, Option<u64>) {
        let total = {
            let mut size: u64 = 0;
            let mut len = std::mem::size_of::<u64>();
            let ok = unsafe {
                libc::sysctlbyname(
                    c"hw.memsize".as_ptr(),
                    &mut size as *mut u64 as *mut libc::c_void,
                    &mut len,
                    std::ptr::null_mut(),
                    0,
                )
            };
            (ok == 0 && size > 0).then_some(size)
        };

        let used = {
            let mut info = std::mem::MaybeUninit::<libc::vm_statistics64>::zeroed();
            let mut count = libc::HOST_VM_INFO64_COUNT;
            let host = unsafe { libc::mach_host_self() };
            let kr = unsafe {
                libc::host_statistics64(
                    host,
                    libc::HOST_VM_INFO64,
                    info.as_mut_ptr() as libc::host_info64_t,
                    &mut count,
                )
            };
            if kr == libc::KERN_SUCCESS {
                let info = unsafe { info.assume_init() };
                let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as u64;
                if page_size == 0 {
                    None
                } else {
                    let used_pages = (info.internal_page_count as u64)
                        .saturating_sub(info.purgeable_count as u64)
                        .saturating_add(info.wire_count as u64)
                        .saturating_add(info.compressor_page_count as u64);
                    Some(used_pages.saturating_mul(page_size))
                }
            } else {
                None
            }
        };

        (total, used)
    }

    #[allow(deprecated)]
    fn get_mach_resident_size() -> u64 {
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
}

/// Shared snapshot of this app's memory: total bytes attributed to the
/// process tree plus the member pids (used by `perf` for bucket overlap).
#[derive(Clone, Default)]
pub(crate) struct MemSnapshot {
    pub bytes: u64,
    pub processes: u32,
    /// Per-pid footprint in bytes; empty on non-macOS platforms.
    pub members: Vec<PerfMember>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PerfMember {
    pub pid: u32,
    pub footprint_bytes: u64,
}

impl MemSnapshot {
    fn from_members(members: Vec<PerfMember>) -> Self {
        Self {
            bytes: members.iter().map(|m| m.footprint_bytes).sum(),
            processes: members.len() as u32,
            members,
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn app_memory_snapshot() -> MemSnapshot {
    macos_mem::get_attributed_snapshot()
}

#[cfg(target_os = "macos")]
pub(crate) fn system_memory() -> (Option<u64>, Option<u64>) {
    macos_mem::system_memory()
}

#[cfg(target_os = "linux")]
pub(crate) fn app_memory_snapshot() -> MemSnapshot {
    if let Ok(status) = std::fs::read_to_string("/proc/self/statm") {
        if let Some(pages) = status
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u64>().ok())
        {
            let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
            if page_size > 0 {
                return MemSnapshot::from_members(vec![PerfMember {
                    pid: std::process::id(),
                    footprint_bytes: pages * page_size as u64,
                }]);
            }
        }
    }
    MemSnapshot::default()
}

/// `/proc/meminfo` MemTotal / (MemTotal - MemAvailable).
#[cfg(target_os = "linux")]
pub(crate) fn system_memory() -> (Option<u64>, Option<u64>) {
    let Ok(text) = std::fs::read_to_string("/proc/meminfo") else {
        return (None, None);
    };
    let mut total_kb = None;
    let mut avail_kb = None;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            total_kb = rest.split_whitespace().next().and_then(|s| s.parse().ok());
        } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
            avail_kb = rest.split_whitespace().next().and_then(|s| s.parse().ok());
        }
    }
    let total = total_kb.map(|kb| kb * 1024);
    let used = match (total_kb, avail_kb) {
        (Some(t), Some(a)) => Some(t.saturating_sub(a) * 1024),
        _ => None,
    };
    (total, used)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn app_memory_snapshot() -> MemSnapshot {
    MemSnapshot::default()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn system_memory() -> (Option<u64>, Option<u64>) {
    (None, None)
}

/// Pids counted inside `app_memory_usage`'s total (macOS responsibility set;
/// just self elsewhere). Used by `perf` to seed the app process tree.
#[cfg(target_os = "macos")]
pub(crate) fn app_tree_pids() -> Vec<u32> {
    macos_mem::app_responsible_pids()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn app_tree_pids() -> Vec<u32> {
    vec![std::process::id()]
}

#[tauri::command]
pub async fn app_memory_usage() -> Result<ProcessMemoryInfo, String> {
    // The macOS snapshot walks every system pid via syscalls; keep it off the
    // async runtime workers.
    let snap = tokio::task::spawn_blocking(app_memory_snapshot)
        .await
        .map_err(|e| e.to_string())?;
    let mb = (snap.bytes as f64) / (1024.0 * 1024.0);
    let formatted = if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{:.0} MB", mb)
    };
    Ok(ProcessMemoryInfo {
        resident_mb: mb,
        formatted,
        processes: snap.processes,
    })
}

/// `perf_breakdown` — system memory split (this app tree / omp spawned by app /
/// external omp / other / free) + running omp-workspace instances. Shells out
/// to `ps`/`lsof`/`git`; runs off the async runtime and is cached ~3 s.
#[tauri::command]
pub async fn perf_breakdown() -> Result<PerfBreakdown, String> {
    Ok(super::perf::breakdown().await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_image_file_copies_into_images_dir() {
        let base = std::env::temp_dir().join(format!("ompws-import-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let src = base.join("Shot.PNG");
        std::fs::write(&src, b"img").unwrap();
        let cache = base.join("cache");
        let images = base.join("images");
        let copied = import_image_file_internal(&cache, &images, src.to_str().unwrap()).unwrap();
        assert!(copied.starts_with(images.to_str().unwrap()));
        assert!(copied.ends_with(".png"));
        assert_eq!(std::fs::read(&copied).unwrap(), b"img");
        // Already inside the images dir: returned unchanged.
        assert_eq!(
            import_image_file_internal(&cache, &images, &copied).unwrap(),
            copied
        );
        // A legacy clip-dir file stays where it is.
        let legacy = cache.join("ompws-clip");
        std::fs::create_dir_all(&legacy).unwrap();
        let legacy_file = legacy.join("1.png");
        std::fs::write(&legacy_file, b"old").unwrap();
        let legacy_s = legacy_file.to_str().unwrap();
        assert_eq!(
            import_image_file_internal(&cache, &images, legacy_s).unwrap(),
            legacy_s
        );
        assert!(import_image_file_internal(&cache, &images, base.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

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
        assert!(path_str.starts_with(temp_dir.to_str().unwrap()));
        let path = std::path::Path::new(&path_str);
        assert!(path.exists());
        assert!(path.is_file());
        assert!(path_str.ends_with(".png"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_save_share_image() {
        let temp_dir =
            std::env::temp_dir().join(format!("ompws-test-share-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // Minimal base64 data URL
        let raw_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        let data_url = format!("data:image/png;base64,{raw_b64}");

        // Valid write into an existing dir; uppercase extension counts as .png.
        let target = temp_dir.join("share.PNG");
        save_share_image_internal(&data_url, target.to_str().unwrap()).unwrap();
        assert!(target.is_file());

        // Rejects a relative path.
        assert!(save_share_image_internal(&data_url, "share.png").is_err());

        // Rejects a non-png extension.
        let jpg = temp_dir.join("share.jpg");
        assert!(save_share_image_internal(&data_url, jpg.to_str().unwrap()).is_err());

        // Rejects bad base64.
        let bad = temp_dir.join("bad.png");
        assert!(save_share_image_internal("!!!", bad.to_str().unwrap()).is_err());

        // Does not create missing parent dirs.
        let nested = temp_dir.join("missing/share.png");
        assert!(save_share_image_internal(&data_url, nested.to_str().unwrap()).is_err());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_app_memory_usage() {
        let mem = app_memory_usage().await.unwrap();
        assert!(mem.formatted.contains("MB") || mem.formatted.contains("GB"));
        assert!(mem.processes >= 1);
        #[cfg(target_os = "macos")]
        assert!(mem.resident_mb > 0.0);
    }
}
