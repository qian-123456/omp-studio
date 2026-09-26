//! Settings persistence, serialization, and validation.
//!
//! Enforces thread-safe, serialized settings updates and pure validation
//! before persisting to SQLite and updating in-memory AppState.

use std::str::FromStr;
use std::time::Duration;
use tokio::sync::Mutex;

use serde::Serialize;

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
        Shortcut::from_str(shortcut).map_err(|e| format!("快捷键格式无效 \"{shortcut}\": {e}"))?;
    }

    // 9. Supervisor interval: sanity cap at one week; 0 = manual only.
    if settings.supervisor_interval_minutes > 7 * 24 * 60 {
        return Err("监工触发间隔不能超过 10080 分钟 (7 天)".to_string());
    }

    // 10. Notification quiet hours: "HH:MM", both bounds set together.
    match (&settings.notify_quiet_from, &settings.notify_quiet_to) {
        (Some(from), Some(to)) => {
            validate_hhmm(from).map_err(|e| format!("免打扰开始时间无效：{e}"))?;
            validate_hhmm(to).map_err(|e| format!("免打扰结束时间无效：{e}"))?;
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err("免打扰时段需要同时设置开始与结束时间".to_string());
        }
        (None, None) => {}
    }

    // 11. Default model for new sessions (eventually passed as --model).
    if let Some(model) = &settings.new_session_model {
        let trimmed = model.trim();
        if has_nul_or_newline(model) {
            return Err("新会话默认模型不能包含空字符 (NUL) 或换行符".to_string());
        }
        if !trimmed.is_empty() && trimmed.starts_with('-') {
            return Err("新会话默认模型不能以 '-' 开头（防止选项参数注入）".to_string());
        }
    }

    Ok(())
}

/// Checks whether a string contains NUL, LF, or CR characters.
fn has_nul_or_newline(s: &str) -> bool {
    s.bytes().any(|b| b == 0 || b == b'\n' || b == b'\r')
}

/// Validates a "HH:MM" 24-hour clock time string.
fn validate_hhmm(s: &str) -> Result<(), String> {
    let bad = || format!("需要 HH:MM 格式的 24 小时制时间 (当前 \"{s}\")");
    let mut parts = s.split(':');
    let (Some(h), Some(m), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(bad());
    };
    if h.len() != 2 || m.len() != 2 {
        return Err(bad());
    }
    let (Ok(hh), Ok(mm)) = (h.parse::<u32>(), m.parse::<u32>()) else {
        return Err(bad());
    };
    if hh > 23 || mm > 59 {
        return Err(bad());
    }
    Ok(())
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
        return Err(
            "公网域名不能包含协议前缀 (如 https://)，请输入纯域名 (例如 tunnel.example.com)"
                .to_string(),
        );
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

// ---- OMP config bridge (`omp config list/set/reset`, §7 D) ----

/// Timeout for one `omp config` invocation.
const OMP_CONFIG_TIMEOUT: Duration = Duration::from_secs(20);

/// One `omp config list --json` entry, parsed defensively.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpConfigEntry {
    pub key: String,
    /// Current effective value; None when unset. Omitted by omp for credentials.
    pub value: Option<serde_json::Value>,
    /// "boolean" | "number" | "string" | "enum" | "array" | "record".
    pub value_type: String,
    pub description: String,
    /// Credential field: omp masks the value; the UI renders a write-only input.
    pub redacted: bool,
}

/// Result of `omp config list --json`; `found: false` means the omp binary
/// was missing or the command failed (`error` carries the reason).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpConfigListResult {
    pub found: bool,
    pub entries: Vec<OmpConfigEntry>,
    pub error: Option<String>,
}

/// Raw JSON shape of one `omp config list --json` entry.
#[derive(Debug, Default, serde::Deserialize)]
struct RawOmpConfigEntry {
    #[serde(default)]
    value: Option<serde_json::Value>,
    #[serde(default, rename = "type")]
    value_type: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    redacted: bool,
}

/// Parses `omp config list --json` output: `{ key: { value, type, description, redacted } }`.
/// Skips entries that are not objects; missing fields fall back to sensible defaults.
fn parse_omp_config_list(json: &str) -> Vec<OmpConfigEntry> {
    let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(json) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for (key, raw) in map {
        let Ok(entry) = serde_json::from_value::<RawOmpConfigEntry>(raw) else {
            continue;
        };
        entries.push(OmpConfigEntry {
            key,
            value: entry.value,
            value_type: entry
                .value_type
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| "string".to_string()),
            description: entry.description.unwrap_or_default(),
            redacted: entry.redacted,
        });
    }
    entries.sort_by(|a, b| a.key.cmp(&b.key));
    entries
}

/// Validates a config key: schema paths are dot-separated identifiers.
fn validate_config_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("配置键不能为空".to_string());
    }
    if has_nul_or_newline(key) {
        return Err("配置键不能包含空字符 (NUL) 或换行符".to_string());
    }
    if key.starts_with('-') {
        return Err("配置键不能以 '-' 开头（防止选项参数注入）".to_string());
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err("配置键只能包含字母、数字、点号、连字符或下划线".to_string());
    }
    Ok(())
}

/// Validates a config value before handing it to `omp config set`.
fn validate_config_value(key: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err("值不能为空，如需恢复默认请使用重置".to_string());
    }
    if has_nul_or_newline(value) {
        return Err(format!("配置 {key} 的值不能包含空字符 (NUL) 或换行符"));
    }
    if value.starts_with('-') {
        return Err(format!(
            "配置 {key} 的值不能以 '-' 开头（防止选项参数注入）"
        ));
    }
    Ok(())
}

/// Resolves the configured omp binary against the augmented PATH.
fn omp_exe(state: &AppState) -> (std::path::PathBuf, String) {
    let bin = state.settings.read().omp_binary.clone();
    let path = crate::todos::omp::augmented_path();
    let exe = crate::todos::omp::resolve_binary(&bin, &path);
    (exe, path)
}

/// Runs `omp config <args...>` without a shell and returns trimmed stdout.
async fn run_omp_config(
    exe: &std::path::Path,
    path_env: &str,
    args: &[&str],
) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(["config"])
        .args(args)
        .env("PATH", path_env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 {}：{e}", exe.display()))?;
    let out = tokio::time::timeout(OMP_CONFIG_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "omp config 超时".to_string())?
        .map_err(|e| format!("omp config 执行失败：{e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: String = stderr
            .chars()
            .rev()
            .take(400)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return Err(format!("omp config 失败 ({}): {}", out.status, tail.trim()));
    }
    Ok(stdout)
}

/// `omp_config_list` (§7 D): snapshot of OMP's own settings schema + current values.
#[tauri::command]
pub async fn omp_config_list(
    state: tauri::State<'_, AppState>,
) -> Result<OmpConfigListResult, String> {
    let (exe, path) = omp_exe(&state);
    if !exe.is_file() {
        return Ok(OmpConfigListResult {
            found: false,
            entries: Vec::new(),
            error: Some(format!(
                "未找到 OMP 命令行程序 \"{}\"",
                state.settings.read().omp_binary
            )),
        });
    }
    match run_omp_config(&exe, &path, &["list", "--json"]).await {
        Ok(stdout) => Ok(OmpConfigListResult {
            found: true,
            entries: parse_omp_config_list(&stdout),
            error: None,
        }),
        Err(e) => Ok(OmpConfigListResult {
            found: false,
            entries: Vec::new(),
            error: Some(e),
        }),
    }
}

/// `omp_config_set` (§7 D): writes one key to OMP's global config via `omp config set`.
#[tauri::command]
pub async fn omp_config_set(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    validate_config_key(&key)?;
    validate_config_value(&key, &value)?;
    let (exe, path) = omp_exe(&state);
    if !exe.is_file() {
        return Err(format!(
            "未找到 OMP 命令行程序 \"{}\"",
            state.settings.read().omp_binary
        ));
    }
    run_omp_config(&exe, &path, &["set", &key, &value]).await?;
    Ok(())
}

/// `omp_config_reset` (§7 D): restores one key's schema default via `omp config reset`.
#[tauri::command]
pub async fn omp_config_reset(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    validate_config_key(&key)?;
    let (exe, path) = omp_exe(&state);
    if !exe.is_file() {
        return Err(format!(
            "未找到 OMP 命令行程序 \"{}\"",
            state.settings.read().omp_binary
        ));
    }
    run_omp_config(&exe, &path, &["reset", &key]).await?;
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
        let mut settings = Settings {
            tunnel_mode: "off".to_string(),
            ..Default::default()
        };

        // "off" and "quick" valid with defaults
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
        let mut settings = Settings {
            mobile_port: 0,
            ..Default::default()
        };

        let err = validate(&settings).unwrap_err();
        assert!(err.contains("移动端端口号不能为 0"));

        settings.mobile_port = 8080;
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn test_validate_omp_binary_and_model_blank() {
        let mut settings = Settings {
            omp_binary: "".to_string(),
            ..Default::default()
        };

        assert!(validate(&settings)
            .unwrap_err()
            .contains("OMP 可执行文件路径不能为空"));

        settings.omp_binary = "   ".to_string();
        assert!(validate(&settings)
            .unwrap_err()
            .contains("OMP 可执行文件路径不能为空"));
        settings.omp_binary = "omp".to_string();

        settings.supervisor_model = "".to_string();
        assert!(validate(&settings)
            .unwrap_err()
            .contains("模型名称不能为空"));

        settings.supervisor_model = "  \t ".to_string();
        assert!(validate(&settings)
            .unwrap_err()
            .contains("模型名称不能为空"));
    }

    #[test]
    fn test_validate_process_args_nul_and_newlines() {
        let mut settings = Settings {
            omp_binary: "omp\0test".to_string(),
            ..Default::default()
        };

        assert!(validate(&settings)
            .unwrap_err()
            .contains("不能包含空字符 (NUL) 或换行符"));

        settings.omp_binary = "omp\narg".to_string();
        assert!(validate(&settings)
            .unwrap_err()
            .contains("不能包含空字符 (NUL) 或换行符"));

        settings.omp_binary = "omp\rarg".to_string();
        assert!(validate(&settings)
            .unwrap_err()
            .contains("不能包含空字符 (NUL) 或换行符"));
        settings.omp_binary = "omp".to_string();

        settings.supervisor_model = "smol\0".to_string();
        assert!(validate(&settings)
            .unwrap_err()
            .contains("不能包含空字符 (NUL) 或换行符"));

        settings.supervisor_model = "smol\n".to_string();
        assert!(validate(&settings)
            .unwrap_err()
            .contains("不能包含空字符 (NUL) 或换行符"));
        settings.supervisor_model = "smol".to_string();

        settings.tunnel_name = Some("my\0tunnel".to_string());
        assert!(validate(&settings)
            .unwrap_err()
            .contains("不能包含空字符 (NUL) 或换行符"));

        settings.tunnel_name = Some("my\ntunnel".to_string());
        assert!(validate(&settings)
            .unwrap_err()
            .contains("不能包含空字符 (NUL) 或换行符"));

        settings.tunnel_name = Some("-option-flag".to_string());
        assert!(validate(&settings).unwrap_err().contains("不能以 '-' 开头"));
    }

    #[test]
    fn test_validate_named_tunnel_requirements() {
        let mut settings = Settings {
            tunnel_mode: "named".to_string(),
            ..Default::default()
        };

        // Missing both
        settings.tunnel_name = None;
        settings.tunnel_hostname = None;
        assert!(validate(&settings)
            .unwrap_err()
            .contains("必须配置隧道名称"));

        // Name only
        settings.tunnel_name = Some("my-tunnel".to_string());
        assert!(validate(&settings)
            .unwrap_err()
            .contains("必须配置公网域名"));

        // Blank name
        settings.tunnel_name = Some("  ".to_string());
        settings.tunnel_hostname = Some("tunnel.example.com".to_string());
        assert!(validate(&settings)
            .unwrap_err()
            .contains("必须配置隧道名称"));

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
            assert!(
                validate(&settings).is_ok(),
                "Expected valid hostname: {valid}"
            );
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
            ("-example.com", "不能以 '-' 开头"),
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
        let mut settings = Settings {
            quick_capture_shortcut: "".to_string(),
            ..Default::default()
        };

        // Empty string / whitespace opt-out
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

    #[test]
    fn test_validate_supervisor_interval_cap() {
        let mut settings = Settings {
            supervisor_interval_minutes: 30,
            ..Default::default()
        };
        assert!(validate(&settings).is_ok());

        settings.supervisor_interval_minutes = 0; // manual only
        assert!(validate(&settings).is_ok());

        settings.supervisor_interval_minutes = 7 * 24 * 60;
        assert!(validate(&settings).is_ok());

        settings.supervisor_interval_minutes = 7 * 24 * 60 + 1;
        assert!(validate(&settings)
            .unwrap_err()
            .contains("不能超过 10080 分钟"));
    }

    #[test]
    fn test_validate_quiet_hours() {
        let mut settings = Settings::default();
        assert!(validate(&settings).is_ok());

        settings.notify_quiet_from = Some("23:00".to_string());
        settings.notify_quiet_to = Some("07:30".to_string());
        assert!(validate(&settings).is_ok());

        // Both None is fine, but only one set is rejected.
        settings.notify_quiet_to = None;
        assert!(validate(&settings)
            .unwrap_err()
            .contains("同时设置开始与结束时间"));

        settings.notify_quiet_to = Some("7:30".to_string());
        settings.notify_quiet_from = None;
        assert!(validate(&settings)
            .unwrap_err()
            .contains("同时设置开始与结束时间"));

        // Format errors
        settings.notify_quiet_from = Some("24:00".to_string());
        settings.notify_quiet_to = Some("07:30".to_string());
        assert!(validate(&settings)
            .unwrap_err()
            .contains("免打扰开始时间无效"));

        settings.notify_quiet_from = Some("ab:cd".to_string());
        assert!(validate(&settings)
            .unwrap_err()
            .contains("免打扰开始时间无效"));

        settings.notify_quiet_from = Some("23:00".to_string());
        settings.notify_quiet_to = Some("07:60".to_string());
        assert!(validate(&settings)
            .unwrap_err()
            .contains("免打扰结束时间无效"));
    }

    #[test]
    fn test_validate_new_session_model() {
        let mut settings = Settings::default();
        assert!(validate(&settings).is_ok());

        settings.new_session_model = Some("gpt-5.6-sol".to_string());
        assert!(validate(&settings).is_ok());

        settings.new_session_model = Some("".to_string());
        assert!(validate(&settings).is_ok());

        settings.new_session_model = Some("bad\nmodel".to_string());
        assert!(validate(&settings).unwrap_err().contains("新会话默认模型"));

        settings.new_session_model = Some("--yolo".to_string());
        assert!(validate(&settings).unwrap_err().contains("不能以 '-' 开头"));
    }

    #[test]
    fn test_parse_omp_config_list_fixture() {
        let fixture = r#"{
            "setupVersion": { "value": 2, "type": "number", "description": "" },
            "autoResume": { "value": false, "type": "boolean",
                "description": "Automatically resume the most recent session" },
            "shellPath": { "type": "string", "description": "" },
            "power.sleepPrevention": { "value": "idle", "type": "enum",
                "description": "Prevent the system sleeping." },
            "extensions": { "value": [], "type": "array", "description": "" },
            "auth.broker.token": { "type": "string", "description": "", "redacted": true },
            "modelRoles": { "value": { "smol": "m1" }, "type": "record", "description": "" },
            "broken": "not-an-object",
            "untyped": { "value": "x" }
        }"#;
        let entries = parse_omp_config_list(fixture);
        assert_eq!(entries.len(), 8);
        let get = |k: &str| entries.iter().find(|e| e.key == k).unwrap();

        let v = get("setupVersion");
        assert_eq!(v.value_type, "number");
        assert_eq!(v.value.as_ref().and_then(|x| x.as_i64()), Some(2));
        assert!(!v.redacted);

        // Unset entry: no value, still listed.
        let shell = get("shellPath");
        assert_eq!(shell.value_type, "string");
        assert!(shell.value.is_none());

        // Credential entry: value omitted by omp, redacted flag set.
        let token = get("auth.broker.token");
        assert!(token.redacted);
        assert!(token.value.is_none());

        // Missing/blank type falls back to "string"; non-object entries skipped.
        assert_eq!(get("untyped").value_type, "string");
        assert!(get("modelRoles").value.is_some());
        assert!(entries.iter().all(|e| e.key != "broken"));

        // Sorted output.
        let sorted = entries.iter().map(|e| e.key.as_str()).collect::<Vec<_>>();
        let mut expected = sorted.clone();
        expected.sort_unstable();
        assert_eq!(sorted, expected);
    }

    #[test]
    fn test_parse_omp_config_list_garbage() {
        assert!(parse_omp_config_list("").is_empty());
        assert!(parse_omp_config_list("not json at all").is_empty());
        assert!(parse_omp_config_list("[]").is_empty());
    }

    #[test]
    fn test_validate_config_key() {
        assert!(validate_config_key("autoResume").is_ok());
        assert!(validate_config_key("power.sleepPrevention").is_ok());
        assert!(validate_config_key("providers.openai-codex.codeMode").is_ok());

        assert!(validate_config_key("").is_err());
        assert!(validate_config_key("bad\nkey").is_err());
        assert!(validate_config_key("-flag").is_err());
        assert!(validate_config_key("key with space").is_err());
        assert!(validate_config_key("key;rm -rf").is_err());
        assert!(validate_config_key("键").is_err());
    }

    #[test]
    fn test_validate_config_value() {
        assert!(validate_config_value("k", "hello world").is_ok());
        assert!(validate_config_value("k", "true").is_ok());
        assert!(validate_config_value("k", "{\"a\":1}").is_ok());

        assert!(validate_config_value("k", "").is_err());
        assert!(validate_config_value("k", "line\nbreak").is_err());
        assert!(validate_config_value("k", "nul\0byte").is_err());
        assert!(validate_config_value("k", "-x").is_err());
    }

    #[test]
    fn test_validate_hhmm() {
        for ok in ["00:00", "23:59", "07:30"] {
            assert!(validate_hhmm(ok).is_ok(), "expected valid: {ok}");
        }
        for bad in ["", "7:30", "07:30:00", "24:00", "23:60", "ab:cd", "07-30"] {
            assert!(validate_hhmm(bad).is_err(), "expected invalid: {bad}");
        }
    }
}
