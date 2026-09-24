//! Settings persistence, serialization, and validation.
//!
//! Enforces thread-safe, serialized settings updates and pure validation
//! before persisting to SQLite and updating in-memory AppState.

use std::str::FromStr;
use tokio::sync::Mutex;

use crate::contracts::Settings;
use crate::db;
use crate::state::AppState;
use tauri_plugin_global_shortcut::Shortcut;

/// Process-local async lock serializing full validate -> persist -> memory-update cycles.
/// Avoids holding parking_lot synchronization guards across asynchronous await points.
static SAVE_LOCK: Mutex<()> = Mutex::const_new(());

/// Validates settings and persists them atomically to both the database and in-memory state.
///
/// Execution is serialized using a process-local async mutex. On validation or persistence failure,
/// the database and in-memory state remain unmutated.
pub async fn save(state: &AppState, settings: Settings) -> Result<Settings, String> {
    let _guard = SAVE_LOCK.lock().await;
    apply_locked(state, settings)
}

/// Atomically updates only the `mobile_enabled` setting using the shared `SAVE_LOCK`.
///
/// Clones the current in-memory settings under the lock, sets `mobile_enabled`,
/// and executes the serialized validate -> persist -> memory-update cycle.
pub async fn set_mobile_enabled(state: &AppState, enabled: bool) -> Result<(), String> {
    let _guard = SAVE_LOCK.lock().await;

    let mut settings = state.settings.read().clone();
    settings.mobile_enabled = enabled;
    apply_locked(state, settings)?;

    Ok(())
}

/// Validates, persists, and updates memory while the caller holds `SAVE_LOCK`.
/// Avoids holding parking_lot synchronization guards across asynchronous await points.
fn apply_locked(state: &AppState, settings: Settings) -> Result<Settings, String> {
    validate(&settings)?;

    // Persist to database; scoped to ensure parking_lot MutexGuard is dropped immediately.
    {
        let conn = state.db.lock();
        db::save_settings(&conn, &settings)?;
    }

    // Update in-memory state; scoped to ensure parking_lot RwLockWriteGuard is dropped immediately.
    {
        let mut mem = state.settings.write();
        *mem = settings.clone();
    }

    Ok(settings)
}

/// Pure validation of user settings.
///
/// Returns `Ok(())` if all invariants hold, or an actionable Chinese error description.
pub fn validate(settings: &Settings) -> Result<(), String> {
    // 1. Approval mode
    match settings.default_approval_mode.as_str() {
        "always-ask" | "write" | "yolo" => {}
        other => {
            return Err(format!(
                "不支持的默认审批模式 \"{other}\"，仅支持 always-ask、write 或 yolo"
            ));
        }
    }

    // 2. Tunnel mode
    match settings.tunnel_mode.as_str() {
        "off" | "quick" | "named" => {}
        other => {
            return Err(format!(
                "不支持的隧道模式 \"{other}\"，仅支持 off、quick 或 named"
            ));
        }
    }

    // 3. Mobile port
    if settings.mobile_port == 0 {
        return Err("移动端端口号不能为 0".to_string());
    }

    // 4. OMP binary & model non-blank
    let omp_bin = settings.omp_binary.trim();
    if omp_bin.is_empty() {
        return Err("OMP 可执行文件路径不能为空".to_string());
    }
    if has_nul_or_newline(&settings.omp_binary) {
        return Err("OMP 可执行文件路径不能包含空字符 (NUL) 或换行符".to_string());
    }

    let model = settings.supervisor_model.trim();
    if model.is_empty() {
        return Err("模型名称不能为空".to_string());
    }
    if has_nul_or_newline(&settings.supervisor_model) {
        return Err("模型名称不能包含空字符 (NUL) 或换行符".to_string());
    }

    // 5. Process arguments validation (tunnel_name)
    if let Some(name) = &settings.tunnel_name {
        if has_nul_or_newline(name) {
            return Err("隧道名称不能包含空字符 (NUL) 或换行符".to_string());
        }
        if name.trim().starts_with('-') {
            return Err("隧道名称不能以 '-' 开头（防止选项参数注入）".to_string());
        }
    }

    // 6. Named tunnel requirements
    if settings.tunnel_mode == "named" {
        let name_missing = settings
            .tunnel_name
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty();
        if name_missing {
            return Err("命名隧道模式下必须配置隧道名称 (tunnel_name)".to_string());
        }

        let host_missing = settings
            .tunnel_hostname
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty();
        if host_missing {
            return Err("命名隧道模式下必须配置公网域名 (tunnel_hostname)".to_string());
        }
    }

    // 7. Validate tunnel_hostname if provided
    if let Some(raw_host) = &settings.tunnel_hostname {
        let trimmed = raw_host.trim();
        if !trimmed.is_empty() {
            validate_hostname(trimmed)?;
        }
    }

    // 8. Global shortcut: allow empty string to disable; otherwise parse via Shortcut API
    let shortcut = settings.quick_capture_shortcut.trim();
    if !shortcut.is_empty() {
        Shortcut::from_str(shortcut)
            .map_err(|e| format!("快捷键格式无效 \"{shortcut}\": {e}"))?;
    }

    Ok(())
}

/// Checks whether a string contains NUL, LF, or CR characters.
fn has_nul_or_newline(s: &str) -> bool {
    s.bytes().any(|b| b == 0 || b == b'\n' || b == b'\r')
}

/// Validates that a hostname is a syntactically valid DNS hostname and not an arbitrary URL or CLI option.
fn validate_hostname(host: &str) -> Result<(), String> {
    if host.is_empty() {
        return Err("公网域名不能为空".to_string());
    }

    // Reject CLI options / command-line argument injection
    if host.starts_with('-') {
        return Err("公网域名不能以 '-' 开头（禁止选项参数注入）".to_string());
    }

    // Reject URLs with schemes
    if host.contains("://") {
        return Err("公网域名不能包含协议前缀 (如 https://)，请输入纯域名 (例如 tunnel.example.com)".to_string());
    }

    // Reject paths, ports, query params, fragments, userinfo
    if host.contains('/') {
        return Err("公网域名不能包含路径分隔符 '/'".to_string());
    }
    if host.contains(':') {
        return Err("公网域名不能包含端口号或冒号 ':'".to_string());
    }
    if host.contains('?') || host.contains('#') {
        return Err("公网域名不能包含查询参数 '?' 或锚点 '#'".to_string());
    }
    if host.contains('@') {
        return Err("公网域名不能包含 '@'".to_string());
    }
    if host.contains(char::is_whitespace) {
        return Err("公网域名不能包含空白字符".to_string());
    }
    if host.contains('\0') {
        return Err("公网域名不能包含空字符 (NUL)".to_string());
    }

    // RFC 1035 / RFC 1123 overall length limit
    if host.len() > 253 {
        return Err(format!(
            "公网域名长度不能超过 253 个字符 (当前长度 {})",
            host.len()
        ));
    }

    // Strip optional trailing dot for FQDN
    let clean = host.strip_suffix('.').unwrap_or(host);
    if clean.is_empty() {
        return Err("公网域名不能仅为点号 '.'".to_string());
    }

    // Validate each DNS label
    for label in clean.split('.') {
        if label.is_empty() {
            return Err("公网域名不能包含连续的点号 '.' 或以点号开头".to_string());
        }
        if label.len() > 63 {
            return Err(format!(
                "域名标签 \"{label}\" 长度不能超过 63 个字符 (当前长度 {})",
                label.len()
            ));
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Err(format!("域名标签 \"{label}\" 不能以连字符 '-' 开头或结尾"));
        }
        if !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(format!(
                "域名标签 \"{label}\" 包含非法字符，仅允许 ASCII 字母、数字和连字符 '-'"
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_default_settings() {
        let defaults = Settings::default();
        assert!(validate(&defaults).is_ok());
    }

    #[test]
    fn test_validate_approval_modes() {
        let mut settings = Settings::default();

        for valid_mode in ["always-ask", "write", "yolo"] {
            settings.default_approval_mode = valid_mode.to_string();
            assert!(validate(&settings).is_ok(), "Expected valid: {valid_mode}");
        }

        for invalid_mode in ["", "never", "prompt", "UNKNOWN"] {
            settings.default_approval_mode = invalid_mode.to_string();
            let err = validate(&settings).unwrap_err();
            assert!(err.contains("不支持的默认审批模式"));
        }
    }

    #[test]
    fn test_validate_tunnel_modes() {
        let mut settings = Settings::default();

        // "off" and "quick" valid with defaults
        settings.tunnel_mode = "off".to_string();
        assert!(validate(&settings).is_ok());

        settings.tunnel_mode = "quick".to_string();
        assert!(validate(&settings).is_ok());

        // Invalid tunnel mode
        settings.tunnel_mode = "direct".to_string();
        let err = validate(&settings).unwrap_err();
        assert!(err.contains("不支持的隧道模式"));
    }

    #[test]
    fn test_validate_mobile_port() {
        let mut settings = Settings::default();

        settings.mobile_port = 0;
        let err = validate(&settings).unwrap_err();
        assert!(err.contains("移动端端口号不能为 0"));

        settings.mobile_port = 8080;
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn test_validate_omp_binary_and_model_blank() {
        let mut settings = Settings::default();

        settings.omp_binary = "".to_string();
        assert!(validate(&settings).unwrap_err().contains("OMP 可执行文件路径不能为空"));

        settings.omp_binary = "   ".to_string();
        assert!(validate(&settings).unwrap_err().contains("OMP 可执行文件路径不能为空"));
        settings.omp_binary = "omp".to_string();

        settings.supervisor_model = "".to_string();
        assert!(validate(&settings).unwrap_err().contains("模型名称不能为空"));

        settings.supervisor_model = "  \t ".to_string();
        assert!(validate(&settings).unwrap_err().contains("模型名称不能为空"));
    }

    #[test]
    fn test_validate_process_args_nul_and_newlines() {
        let mut settings = Settings::default();

        settings.omp_binary = "omp\0test".to_string();
        assert!(validate(&settings).unwrap_err().contains("不能包含空字符 (NUL) 或换行符"));

        settings.omp_binary = "omp\narg".to_string();
        assert!(validate(&settings).unwrap_err().contains("不能包含空字符 (NUL) 或换行符"));

        settings.omp_binary = "omp\rarg".to_string();
        assert!(validate(&settings).unwrap_err().contains("不能包含空字符 (NUL) 或换行符"));
        settings.omp_binary = "omp".to_string();

        settings.supervisor_model = "smol\0".to_string();
        assert!(validate(&settings).unwrap_err().contains("不能包含空字符 (NUL) 或换行符"));

        settings.supervisor_model = "smol\n".to_string();
        assert!(validate(&settings).unwrap_err().contains("不能包含空字符 (NUL) 或换行符"));
        settings.supervisor_model = "smol".to_string();

        settings.tunnel_name = Some("my\0tunnel".to_string());
        assert!(validate(&settings).unwrap_err().contains("不能包含空字符 (NUL) 或换行符"));

        settings.tunnel_name = Some("my\ntunnel".to_string());
        assert!(validate(&settings).unwrap_err().contains("不能包含空字符 (NUL) 或换行符"));

        settings.tunnel_name = Some("-option-flag".to_string());
        assert!(validate(&settings).unwrap_err().contains("不能以 '-' 开头"));
    }

    #[test]
    fn test_validate_named_tunnel_requirements() {
        let mut settings = Settings::default();
        settings.tunnel_mode = "named".to_string();

        // Missing both
        settings.tunnel_name = None;
        settings.tunnel_hostname = None;
        assert!(validate(&settings).unwrap_err().contains("必须配置隧道名称"));

        // Name only
        settings.tunnel_name = Some("my-tunnel".to_string());
        assert!(validate(&settings).unwrap_err().contains("必须配置公网域名"));

        // Blank name
        settings.tunnel_name = Some("  ".to_string());
        settings.tunnel_hostname = Some("tunnel.example.com".to_string());
        assert!(validate(&settings).unwrap_err().contains("必须配置隧道名称"));

        // Valid named tunnel
        settings.tunnel_name = Some("my-tunnel".to_string());
        settings.tunnel_hostname = Some("tunnel.example.com".to_string());
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn test_validate_hostname_format() {
        let mut settings = Settings::default();

        // Valid hostnames
        for valid in [
            "example.com",
            "tunnel.example.com",
            "my-sub-domain.cf.org",
            "localhost",
            "192.168.1.1",
            "tunnel.example.com.",
        ] {
            settings.tunnel_hostname = Some(valid.to_string());
            assert!(validate(&settings).is_ok(), "Expected valid hostname: {valid}");
        }

        // Invalid hostname inputs: URL schemes, paths, options, special chars
        let invalid_cases = [
            ("-o", "不能以 '-' 开头"),
            ("--config", "不能以 '-' 开头"),
            ("https://example.com", "不能包含协议前缀"),
            ("http://tunnel.org", "不能包含协议前缀"),
            ("example.com/path", "不能包含路径分隔符"),
            ("example.com:8080", "不能包含端口号或冒号"),
            ("example.com?query=1", "不能包含查询参数"),
            ("example.com#hash", "不能包含查询参数"),
            ("user@example.com", "不能包含 '@'"),
            ("my domain.com", "不能包含空白字符"),
            ("example..com", "不能包含连续的点号"),
            ("-example.com", "不能以连字符 '-' 开头或结尾"),
            ("example-.com", "不能以连字符 '-' 开头或结尾"),
            ("exam_ple.com", "包含非法字符"),
        ];

        for (invalid_host, expected_err) in invalid_cases {
            settings.tunnel_hostname = Some(invalid_host.to_string());
            let err = validate(&settings).unwrap_err();
            assert!(
                err.contains(expected_err),
                "For input '{invalid_host}', expected error containing '{expected_err}', got '{err}'"
            );
        }
    }

    #[test]
    fn test_validate_quick_capture_shortcut() {
        let mut settings = Settings::default();

        // Empty string / whitespace opt-out
        settings.quick_capture_shortcut = "".to_string();
        assert!(validate(&settings).is_ok());

        settings.quick_capture_shortcut = "   ".to_string();
        assert!(validate(&settings).is_ok());

        // Valid shortcuts
        settings.quick_capture_shortcut = "CommandOrControl+Shift+I".to_string();
        assert!(validate(&settings).is_ok());

        settings.quick_capture_shortcut = "Ctrl+Shift+K".to_string();
        assert!(validate(&settings).is_ok());

        settings.quick_capture_shortcut = "Alt+Space".to_string();
        assert!(validate(&settings).is_ok());

        // Invalid shortcut formats
        settings.quick_capture_shortcut = "InvalidKeyComboThatCannotParse".to_string();
        assert!(validate(&settings).unwrap_err().contains("快捷键格式无效"));

        settings.quick_capture_shortcut = "Ctrl++".to_string();
        assert!(validate(&settings).unwrap_err().contains("快捷键格式无效"));
    }
}
