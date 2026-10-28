//! [C] Pasteboard file paths (macOS) + pasted-bytes cache writes.
//! WKWebView `clipboardData` File objects carry no filesystem path, so a
//! Finder copy needs the real URLs read from NSPasteboard natively.

use base64::Engine as _;
use tauri::Manager as _;

/// JXA that resolves POSIX paths from the pasteboard: the legacy
/// `NSFilenamesPboardType` (what Finder writes on ⌘C) first, then per-item
/// `public.file-url` URLs (ForkLift/other apps). Prints a JSON array.
#[cfg(target_os = "macos")]
const PB_FILE_PATHS_JXA: &str = r#"ObjC.import("AppKit");
var out = [];
var pb = $.NSPasteboard.generalPasteboard;
var names = ObjC.deepUnwrap(pb.propertyListForType($("NSFilenamesPboardType")));
if (Array.isArray(names) && names.length) {
	out = names;
} else {
	var items = pb.pasteboardItems;
	if (items) {
		for (var i = 0; i < items.count; i++) {
			var it = items.objectAtIndex(i);
			var s = it.stringForType($("public.file-url"));
			if (s && s.js) {
				var url = $.NSURL.URLWithString($(s.js));
				if (url && url.isFileURL) {
					var p = url.path;
					if (p && p.js) out.push(p.js);
				}
			}
		}
	}
}
JSON.stringify(out)"#;

/// `clipboard_file_paths` — absolute POSIX paths of files on the macOS
/// pasteboard; `[]` when the clipboard holds none or the read fails.
#[tauri::command]
pub async fn clipboard_file_paths() -> Result<Vec<String>, String> {
    clipboard_file_paths_impl().await
}

#[cfg(target_os = "macos")]
async fn clipboard_file_paths_impl() -> Result<Vec<String>, String> {
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new("osascript")
            .args(["-l", "JavaScript", "-e", PB_FILE_PATHS_JXA])
            .output(),
    )
    .await
    .map_err(|_| "读取剪贴板文件路径超时".to_string())?
    .map_err(|e| format!("osascript 启动失败: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "osascript 失败 ({}): {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(parse_clipboard_paths(&stdout))
}

#[cfg(not(target_os = "macos"))]
async fn clipboard_file_paths_impl() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// JXA that replaces the pasteboard contents with a string item followed by
/// one `public.file-url` item per path. argv[0] is `{"text": str, "paths": [str]}`.
#[cfg(target_os = "macos")]
const PB_WRITE_JXA: &str = r#"ObjC.import("AppKit");
function run(argv) {
	var a = JSON.parse(argv[0]);
	var pb = $.NSPasteboard.generalPasteboard;
	pb.clearContents;
	var objs = [];
	if (a.text) objs.push($(a.text));
	a.paths.forEach(function (p) { objs.push($.NSURL.fileURLWithPath($(p))); });
	if (!pb.writeObjects($(objs))) throw new Error("writeObjects failed");
	return "ok";
}"#;

/// `clipboard_write_message` — put a message's text plus its image files on the
/// macOS pasteboard (text item + one file-URL item per image) so a paste
/// target takes whichever it understands.
#[tauri::command]
pub async fn clipboard_write_message(text: String, paths: Vec<String>) -> Result<(), String> {
    clipboard_write_message_impl(text, paths).await
}

#[cfg(target_os = "macos")]
async fn clipboard_write_message_impl(text: String, paths: Vec<String>) -> Result<(), String> {
    let payload = serde_json::json!({ "text": text, "paths": paths }).to_string();
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new("osascript")
            .args(["-l", "JavaScript", "-e", PB_WRITE_JXA, &payload])
            .output(),
    )
    .await
    .map_err(|_| "写入剪贴板超时".to_string())?
    .map_err(|e| format!("osascript 启动失败: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "写入剪贴板失败: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn clipboard_write_message_impl(_text: String, _paths: Vec<String>) -> Result<(), String> {
    Err("当前系统不支持复制图片".to_string())
}

/// JXA that prints the plain text of pasteboard items that carry no
/// `public.file-url` (the text item `clipboard_write_message` writes next to
/// its files). A Finder copy keeps the filename text inside the file item, so
/// it yields nothing here and the filename is never pasted as text.
#[cfg(target_os = "macos")]
const PB_TEXT_BESIDE_FILES_JXA: &str = r#"ObjC.import("AppKit");
var out = "";
var items = $.NSPasteboard.generalPasteboard.pasteboardItems;
if (items) {
	for (var i = 0; i < items.count; i++) {
		var it = items.objectAtIndex(i);
		if (it.stringForType($("public.file-url")).js !== undefined) continue;
		var s = it.stringForType($("public.utf8-plain-text"));
		if (s.js !== undefined) out += s.js;
	}
}
out"#;

/// `clipboard_text_beside_files` — message text that travels with files on the
/// pasteboard; empty when there is none or the read fails.
#[tauri::command]
pub async fn clipboard_text_beside_files() -> Result<String, String> {
    clipboard_text_beside_files_impl().await
}

#[cfg(target_os = "macos")]
async fn clipboard_text_beside_files_impl() -> Result<String, String> {
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new("osascript")
            .args(["-l", "JavaScript", "-e", PB_TEXT_BESIDE_FILES_JXA])
            .output(),
    )
    .await
    .map_err(|_| "读取剪贴板文字超时".to_string())?
    .map_err(|e| format!("osascript 启动失败: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "读取剪贴板文字失败: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let s = String::from_utf8_lossy(&out.stdout);
    // osascript appends one trailing newline to the printed result.
    Ok(s.strip_suffix('\n').unwrap_or(&s).to_string())
}

#[cfg(not(target_os = "macos"))]
async fn clipboard_text_beside_files_impl() -> Result<String, String> {
    Ok(String::new())
}

/// Parse the JXA JSON output into absolute, existing paths.
/// Exported for tests; treats non-array/garbage output as "no files".
fn parse_clipboard_paths(stdout: &str) -> Vec<String> {
    let v: serde_json::Value = match serde_json::from_str(stdout.trim()) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(arr) = v.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|s| s.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter(|s| s.starts_with('/'))
        .filter(|s| std::path::Path::new(s).exists())
        .map(|s| s.to_string())
        .collect()
}

/// Filename safe for a cache-dir write: basename only, control chars stripped,
/// length capped. Falls back to `pasted-file`.
fn sanitize_file_name(file_name: &str) -> String {
    let base = file_name.rsplit('/').next().unwrap_or(file_name);
    let base = base.rsplit('\\').next().unwrap_or(base);
    let clean: String = base
        .chars()
        .filter(|c| !c.is_control() && *c != '\0')
        .take(100)
        .collect();
    let trimmed = clean.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "pasted-file".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn save_clipboard_file_internal(
    cache_dir: &std::path::Path,
    base64_data: &str,
    file_name: Option<&str>,
) -> Result<String, String> {
    let clip_dir = cache_dir.join("ompws-clip-files");
    std::fs::create_dir_all(&clip_dir).map_err(|e| format!("创建剪贴板文件缓存目录失败：{e}"))?;

    let clean_b64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        base64_data
    };
    let clean_b64: String = clean_b64.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&clean_b64)
        .map_err(|e| format!("Base64 解码失败：{e}"))?;

    let name = sanitize_file_name(file_name.unwrap_or("pasted-file"));
    let file_path = clip_dir.join(format!("{}-{name}", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file_path)
        .map_err(|e| format!("保存文件失败：{e}"))?;
    if let Err(e) = std::io::Write::write_all(&mut file, &bytes) {
        drop(file);
        let _ = std::fs::remove_file(&file_path);
        return Err(format!("保存文件失败：{e}"));
    }
    Ok(file_path.to_string_lossy().into_owned())
}

/// `save_clipboard_file` — persist pasted/dropped bytes that have no real
/// filesystem path (WKWebView File) under the app cache dir; returns the path
/// used as the 📎 attachment reference.
#[tauri::command]
pub async fn save_clipboard_file(
    app: tauri::AppHandle,
    base64_data: String,
    file_name: Option<String>,
) -> Result<String, String> {
    let cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| {
        dirs::cache_dir()
            .map(|d| d.join("omp-workspace"))
            .unwrap_or_else(std::env::temp_dir)
    });
    tokio::task::spawn_blocking(move || {
        save_clipboard_file_internal(&cache_dir, &base64_data, file_name.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_clipboard_paths_filters_garbage() {
        assert_eq!(parse_clipboard_paths("[]"), Vec::<String>::new());
        assert_eq!(parse_clipboard_paths("not json"), Vec::<String>::new());
        assert_eq!(parse_clipboard_paths("{\"a\":1}"), Vec::<String>::new());
        // Relative/non-existent entries are dropped, absolute real ones kept.
        assert_eq!(
            parse_clipboard_paths("[\"relative/x.txt\", \"/definitely/missing-ompws-xyz\"]"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn sanitize_file_name_strips_path_and_controls() {
        assert_eq!(sanitize_file_name("报告.docx"), "报告.docx");
        assert_eq!(sanitize_file_name("/tmp/a/b.txt"), "b.txt");
        assert_eq!(sanitize_file_name("a\\b.txt"), "b.txt");
        assert_eq!(sanitize_file_name(".."), "pasted-file");
        assert_eq!(sanitize_file_name(""), "pasted-file");
        assert_eq!(sanitize_file_name("a\u{0}b.txt"), "ab.txt");
    }

    #[test]
    fn same_name_concurrent_attachments_retain_independent_bytes() {
        let dir = std::env::temp_dir().join(format!("ompws-clip-{}", uuid::Uuid::new_v4()));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(16));
        let threads: Vec<_> = (0..16)
            .map(|n| {
                let dir = dir.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let bytes = format!("attachment-{n}").into_bytes();
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    barrier.wait();
                    let path = save_clipboard_file_internal(&dir, &b64, Some("same.txt")).unwrap();
                    (path, bytes)
                })
            })
            .collect();
        let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        let paths: std::collections::HashSet<_> = results.iter().map(|(p, _)| p).collect();
        assert_eq!(paths.len(), results.len());
        for (path, bytes) in results {
            assert_eq!(std::fs::read(path).unwrap(), bytes);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_clipboard_file_roundtrip() {
        let dir = std::env::temp_dir().join(format!("ompws-clip-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"hello");
        let p = save_clipboard_file_internal(&dir, &b64, Some("中 文.txt")).unwrap();
        assert!(p.contains("ompws-clip-files"));
        assert!(p.ends_with("-中 文.txt"));
        assert_eq!(std::fs::read(&p).unwrap(), b"hello");
        // data: URL prefix is tolerated like save_clipboard_image.
        let p2 = save_clipboard_file_internal(
            &dir,
            &format!("data:application/octet-stream;base64,{b64}"),
            None,
        )
        .unwrap();
        assert_eq!(std::fs::read(&p2).unwrap(), b"hello");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
