//! Settings persistence, serialization, and validation.
//!
//! Enforces thread-safe, serialized settings updates and pure validation
//! before persisting to SQLite and updating in-memory AppState.

use std::path::Path;
use std::str::FromStr;
use std::time::Duration;
use tokio::sync::Mutex;

use serde::Serialize;

use crate::contracts::Settings;
use crate::db;
use crate::state::AppState;
use tauri::Manager as _;
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

/// Atomically updates only the `mobile_ipv6_enabled` setting using the shared `SAVE_LOCK`.
pub async fn set_mobile_ipv6_enabled(state: &AppState, enabled: bool) -> Result<(), String> {
    let _guard = SAVE_LOCK.lock().await;

    let mut settings = state.settings.read().clone();
    settings.mobile_ipv6_enabled = enabled;
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
    if settings.mobile_ipv6_port < 1024 {
        return Err("移动端 IPv6 端口号必须在 1024 到 65535 之间".to_string());
    }
    if settings.mobile_ipv6_port == settings.mobile_port {
        return Err("移动端 IPv6 端口号不能与 IPv4 端口号相同".to_string());
    }

    // 4. OMP binary & model non-blank
    let omp_bin = settings.omp_binary.trim();
    if omp_bin.is_empty() {
        return Err("OMP 可执行文件路径不能为空".to_string());
    }
    if has_nul_or_newline(&settings.omp_binary) {
        return Err("OMP 可执行文件路径不能包含空字符 (NUL) 或换行符".to_string());
    }

    if has_nul_or_newline(&settings.doctor_model) {
        return Err("诊断模型名称不能包含空字符 (NUL) 或换行符".to_string());
    }
    if settings.doctor_model.trim().starts_with('-') {
        return Err("诊断模型名称不能以 '-' 开头".to_string());
    }
    if !matches!(
        settings.doctor_auto_mode.as_str(),
        "manual" | "idle" | "scheduled"
    ) {
        return Err("自动体检模式必须为 manual、idle 或 scheduled".to_string());
    }
    if !(1..=10080).contains(&settings.doctor_idle_minutes) {
        return Err("体检闲置分钟必须在 1–10080 之间".to_string());
    }
    let valid_hhmm = settings
        .doctor_schedule_time
        .split_once(':')
        .is_some_and(|(h, m)| {
            h.len() == 2
                && m.len() == 2
                && h.parse::<u8>().is_ok_and(|h| h < 24)
                && m.parse::<u8>().is_ok_and(|m| m < 60)
        });
    if !valid_hhmm {
        return Err("每日体检时间需要 HH:MM 格式".to_string());
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

    // Validate ddns_hostname if provided
    if let Some(raw_host) = &settings.ddns_hostname {
        let trimmed = raw_host.trim();
        if trimmed.is_empty() {
            return Err("Cloudflare DDNS 域名不能为空".to_string());
        }
        validate_hostname(trimmed)?;
    }

    // Validate ddns_zone_id if provided (must be 32 lowercase hex characters)
    if let Some(raw_zone) = &settings.ddns_zone_id {
        let trimmed = raw_zone.trim();
        let is_32_lower_hex = trimmed.len() == 32
            && trimmed
                .chars()
                .all(|c| c.is_ascii_digit() || matches!(c, 'a'..='f'));
        if !is_32_lower_hex {
            return Err("Cloudflare Zone ID 必须为 32 位小写十六进制字符串".to_string());
        }
    }

    // 8. Global shortcut: allow empty string to disable; otherwise parse via Shortcut API
    let shortcut = settings.quick_capture_shortcut.trim();
    if !shortcut.is_empty() {
        Shortcut::from_str(shortcut).map_err(|e| format!("快捷键格式无效 \"{shortcut}\": {e}"))?;
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

    // 12. Side-chat dedicated model (passed as --model to the fork).
    if let Some(model) = &settings.side_chat_model {
        let trimmed = model.trim();
        if has_nul_or_newline(model) {
            return Err("侧聊专属模型不能包含空字符 (NUL) 或换行符".to_string());
        }
        if !trimmed.is_empty() && trimmed.starts_with('-') {
            return Err("侧聊专属模型不能以 '-' 开头（防止选项参数注入）".to_string());
        }
    }

    // 13. Composer send shortcut and follow-up behavior. Validated on save so invalid
    // values never reach the frontend.
    match settings.send_shortcut.as_str() {
        "enter" | "mod-enter" => {}
        other => {
            return Err(format!(
                "不支持的发送快捷键 \"{other}\"，仅支持 enter 或 mod-enter"
            ));
        }
    }
    match settings.follow_up_behavior.as_str() {
        "steer" | "queue" | "interrupt" => {}
        other => {
            return Err(format!(
                "不支持的任务进行中发送方式 \"{other}\"，仅支持 steer、queue 或 interrupt"
            ));
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

// ---- OS window title (§9 D helper; called from lib.rs setup + save_settings) ----

/// Applies `settings.window_worktree_title` to the main window's OS title.
///
/// Enabled: `<configured title> · <name>` where `<name>` is the git branch of the
/// repository the process was launched from (HEAD's symbolic ref; the worktree's
/// own directory name when HEAD is detached). The identity is resolved from the
/// process cwd, which under `tauri dev` is `src-tauri/` inside the worktree.
/// Disabled, no git repository reachable, or no main window: the original
/// `tauri.conf.json` title is restored or kept — the lookup never errors out.
pub fn apply_window_title(state: &AppState) {
    let enabled = state.settings.read().window_worktree_title;
    let identity = enabled.then(|| {
        let cwd = std::env::current_dir().ok()?;
        worktree_identity(&cwd)
    });
    let Some(identity) = identity.flatten() else {
        return;
    };
    if let Some(window) = state.app.get_webview_window("main") {
        let base = default_window_title(state);
        if !base.is_empty() {
            let _ = window.set_title(&window_title(&base, &identity));
        }
    }
}

/// The configured main-window title ("title" in tauri.conf.json, falling back to
/// productName exactly like the initial window title does).
fn default_window_title(state: &AppState) -> String {
    let config = state.app.config();
    config
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .map(|w| w.title.clone())
        .filter(|t| !t.is_empty())
        .or_else(|| config.product_name.clone())
        .unwrap_or_default()
}

/// `<base> · <identity>`; `identity` empty or equal to `base` yields `base`.
fn window_title(base: &str, identity: &str) -> String {
    if identity.is_empty() || identity == base {
        base.to_string()
    } else {
        format!("{base} · {identity}")
    }
}

/// Name identifying the worktree containing `dir`: the current branch, or the
/// worktree's top-level directory name when HEAD is detached. `None` outside a
/// work tree or when git is unavailable.
fn worktree_identity(dir: &Path) -> Option<String> {
    // symbolic-ref exits non-zero on a detached HEAD — that is the signal to
    // fall back to the worktree's own directory name, not a lookup failure.
    let branch = git_stdout(dir, &["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if let Some(branch) = branch.filter(|b| !b.is_empty()) {
        return Some(branch);
    }
    git_stdout(dir, &["rev-parse", "--show-toplevel"]).and_then(|top| worktree_dir_name(&top))
}

/// Runs `git -C <dir> <args>` and returns trimmed stdout on a zero exit code.
fn git_stdout(dir: &Path, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then_some(output.stdout)
        .map(|b| String::from_utf8_lossy(&b).trim().to_string())
}

/// Last path component of a worktree root; `None` for root or empty paths.
fn worktree_dir_name(toplevel: &str) -> Option<String> {
    Path::new(toplevel)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
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
    /// Official settings tab from `omp config list` human output
    /// (appearance/context/…); keys missing there fall back to "internal".
    pub tab: String,
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
/// `tabs` maps a key to its official settings tab (from `parse_omp_config_tabs`).
fn parse_omp_config_list(
    json: &str,
    tabs: &std::collections::HashMap<String, String>,
) -> Vec<OmpConfigEntry> {
    let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(json) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for (key, raw) in map {
        let Ok(entry) = serde_json::from_value::<RawOmpConfigEntry>(raw) else {
            continue;
        };
        entries.push(OmpConfigEntry {
            tab: tabs
                .get(&key)
                .cloned()
                .unwrap_or_else(|| "internal".to_string()),
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

/// Parses `omp config list` (human) output into a key → tab map.
/// Format: `[tabname]` headers at column 0, entries indented exactly two spaces
/// as `key = value (type)`. Later duplicates keep their first tab; lines that do
/// not look like a schema key are ignored.
fn parse_omp_config_tabs(human: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut current: Option<String> = None;
    for line in human.lines() {
        let line = line.trim_end();
        if let Some(tab) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            if !tab.is_empty() {
                current = Some(tab.to_string());
            }
            continue;
        }
        let (Some(tab), true) = (&current, line.starts_with("  ") && !line.starts_with("   "))
        else {
            continue;
        };
        let Some((key, _)) = line.trim_start().split_once(" = ") else {
            continue;
        };
        let key = key.trim();
        let looks_like_key = !key.is_empty()
            && key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
        if looks_like_key && !map.contains_key(key) {
            map.insert(key.to_string(), tab.clone());
        }
    }
    map
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
        let is_numeric = value.parse::<f64>().map(|v| v.is_finite()).unwrap_or(false);
        if !is_numeric {
            return Err(format!(
                "配置 {key} 的值不能以 '-' 开头（防止选项参数注入）"
            ));
        }
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
    cmd.current_dir(neutral_cwd()?);
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
    // Official tab grouping lives only in the human listing; values come from --json.
    let (json_res, human_res) = tokio::join!(
        run_omp_config(&exe, &path, &["list", "--json"]),
        run_omp_config(&exe, &path, &["list"]),
    );
    match json_res {
        Ok(stdout) => {
            let tabs = human_res
                .map(|human| parse_omp_config_tabs(&human))
                .unwrap_or_default();
            Ok(OmpConfigListResult {
                found: true,
                entries: parse_omp_config_list(&stdout, &tabs),
                error: None,
            })
        }
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
    set_omp_config_value(&state, &key, &value).await
}

/// Writes one whole config value through `omp config set <key> <value>`.
///
/// Record-typed keys (`retry.fallbackChains`) are rewritten as a whole: the caller reads
/// the current value, edits it, and passes the serialized result here.
pub(crate) async fn set_omp_config_value(
    state: &AppState,
    key: &str,
    value: &str,
) -> Result<(), String> {
    validate_config_key(key)?;
    validate_config_value(key, value)?;
    let (exe, path) = omp_exe(state);
    if !exe.is_file() {
        return Err(format!(
            "未找到 OMP 命令行程序 \"{}\"",
            state.settings.read().omp_binary
        ));
    }
    let args: Vec<&str> = if value.starts_with('-') {
        vec!["set", key, "--", value]
    } else {
        vec!["set", key, value]
    };
    run_omp_config(&exe, &path, &args).await?;
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

/// Dedicated empty working directory for `omp config` so omp's project layer
/// (`<cwd>/.omp/config.yml`) never merges in: results reflect global settings only.
fn neutral_cwd() -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("ompws-omp-config-cwd");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建中立工作目录：{e}"))?;
    let stray = dir.join(".omp");
    if stray.exists() {
        let _ = std::fs::remove_dir_all(&stray);
    }
    Ok(dir)
}

/// Raw contents of a project-level omp config (`<cwd>/.omp/config.yml`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OmpProjectConfigFile {
    pub path: String,
    pub exists: bool,
    pub content: String,
}

/// Validates `cwd` (absolute, existing directory) and returns `<cwd>/.omp/config.yml`.
fn project_config_path(cwd: &str) -> Result<std::path::PathBuf, String> {
    let dir = crate::services::files::resolve(cwd.trim())?;
    if !dir.is_dir() {
        return Err(format!("项目目录不存在：{}", dir.display()));
    }
    Ok(dir.join(".omp").join("config.yml"))
}

fn project_config_read_blocking(cwd: &str) -> Result<OmpProjectConfigFile, String> {
    let path = project_config_path(cwd)?;
    let display = path.to_string_lossy().into_owned();
    if !path.exists() {
        return Ok(OmpProjectConfigFile {
            path: display,
            exists: false,
            content: String::new(),
        });
    }
    let content = crate::services::files::read_text(&path)?;
    Ok(OmpProjectConfigFile {
        path: display,
        exists: true,
        content,
    })
}

/// `omp_project_config_read` (§7 D): reads `<cwd>/.omp/config.yml`; missing → `exists: false`.
#[tauri::command]
pub async fn omp_project_config_read(cwd: String) -> Result<OmpProjectConfigFile, String> {
    tokio::task::spawn_blocking(move || project_config_read_blocking(&cwd))
        .await
        .map_err(|e| format!("读取项目配置失败：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_test_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::path::PathBuf::from(format!("/tmp/ompws-test-d/{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_project_config_read_missing() {
        let dir = project_test_dir("read-missing");
        let r = project_config_read_blocking(dir.to_str().unwrap()).unwrap();
        assert!(!r.exists);
        assert!(r.content.is_empty());
        assert!(r.path.ends_with(".omp/config.yml"));
    }

    #[test]
    fn test_validate_default_settings() {
        let defaults = Settings::default();
        assert!(validate(&defaults).is_ok());
    }

    #[test]
    fn test_validate_send_shortcut_and_follow_up_behavior() {
        let mut settings = Settings::default();

        for shortcut in ["enter", "mod-enter"] {
            settings.send_shortcut = shortcut.to_string();
            for behavior in ["steer", "queue", "interrupt"] {
                settings.follow_up_behavior = behavior.to_string();
                assert!(
                    validate(&settings).is_ok(),
                    "Expected valid: {shortcut}/{behavior}"
                );
            }
        }

        settings.follow_up_behavior = "steer".to_string();
        for invalid in ["", "Enter", "mod_enter", "cmd-enter"] {
            settings.send_shortcut = invalid.to_string();
            let err = validate(&settings).unwrap_err();
            assert!(err.contains("不支持的发送快捷键"), "{err}");
        }

        settings.send_shortcut = "enter".to_string();
        for invalid in ["", "append", "STEER"] {
            settings.follow_up_behavior = invalid.to_string();
            let err = validate(&settings).unwrap_err();
            assert!(err.contains("不支持的任务进行中发送方式"), "{err}");
        }
    }

    #[test]
    fn test_send_shortcut_and_follow_up_behavior_serde_defaults() {
        // Stored settings JSON predating these keys must deserialize to the defaults.
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        let map = value.as_object_mut().unwrap();
        map.remove("sendShortcut");
        map.remove("followUpBehavior");
        let parsed: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(parsed.send_shortcut, "enter");
        assert_eq!(parsed.follow_up_behavior, "steer");
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
    fn test_validate_mobile_ipv6_port() {
        let mut settings = Settings {
            mobile_port: 7788,
            mobile_ipv6_port: 7788,
            ..Settings::default()
        };
        let err = validate(&settings).unwrap_err();
        assert!(err.contains("不能与 IPv4 端口号相同"));

        settings.mobile_ipv6_port = 1023;
        let err = validate(&settings).unwrap_err();
        assert!(err.contains("必须在 1024 到 65535 之间"));

        settings.mobile_ipv6_port = 7789;
        assert!(validate(&settings).is_ok());
    }

    #[test]
    fn test_validate_ddns_settings() {
        // Empty ddns_hostname rejected
        let mut settings = Settings {
            ddns_hostname: Some("   ".to_string()),
            ..Settings::default()
        };
        let err = validate(&settings).unwrap_err();
        assert!(err.contains("Cloudflare DDNS 域名不能为空"));

        // Invalid hostname format rejected
        settings.ddns_hostname = Some("-invalid.example.com".to_string());
        assert!(validate(&settings).is_err());

        // Valid hostname accepted
        settings.ddns_hostname = Some("ddns.example.com".to_string());
        assert!(validate(&settings).is_ok());

        // Invalid ddns_zone_id: length not 32
        settings.ddns_zone_id = Some("abc123".to_string());
        let err = validate(&settings).unwrap_err();
        assert!(err.contains("32 位小写十六进制"));

        // Invalid ddns_zone_id: uppercase hex rejected
        settings.ddns_zone_id = Some("0123456789abcdef0123456789ABCDEF".to_string());
        let err = validate(&settings).unwrap_err();
        assert!(err.contains("32 位小写十六进制"));

        // Valid ddns_zone_id accepted
        settings.ddns_zone_id = Some("0123456789abcdef0123456789abcdef".to_string());
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

        // Formats produced by the settings key recorder (ShortcutRecorder.tsx).
        for s in [
            "CommandOrControl+Shift+Space",
            "CommandOrControl+Control+Alt+Shift+K",
            "Super+Alt+7",
            "CommandOrControl+BracketLeft",
            "CommandOrControl+ArrowUp",
            "F5",
        ] {
            settings.quick_capture_shortcut = s.to_string();
            assert!(validate(&settings).is_ok(), "{s}");
        }

        // Invalid shortcut formats
        settings.quick_capture_shortcut = "InvalidKeyComboThatCannotParse".to_string();
        assert!(validate(&settings).unwrap_err().contains("快捷键格式无效"));

        settings.quick_capture_shortcut = "Ctrl++".to_string();
        assert!(validate(&settings).unwrap_err().contains("快捷键格式无效"));
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
        let mut tabs = std::collections::HashMap::new();
        tabs.insert("power.sleepPrevention".to_string(), "internal".to_string());
        let entries = parse_omp_config_list(fixture, &tabs);
        assert_eq!(entries.len(), 8);
        let get = |k: &str| entries.iter().find(|e| e.key == k).unwrap();

        let v = get("setupVersion");
        assert_eq!(v.value_type, "number");
        assert_eq!(v.value.as_ref().and_then(|x| x.as_i64()), Some(2));
        assert!(!v.redacted);

        // Tab comes from the human listing; keys missing there fall back to "internal".
        assert_eq!(get("power.sleepPrevention").tab, "internal");
        assert_eq!(get("setupVersion").tab, "internal");

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
        let no_tabs = std::collections::HashMap::new();
        assert!(parse_omp_config_list("", &no_tabs).is_empty());
        assert!(parse_omp_config_list("not json at all", &no_tabs).is_empty());
        assert!(parse_omp_config_list("[]", &no_tabs).is_empty());
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

        // Negative numeric values are allowed (e.g. presencePenalty = -0.5 or -1)
        assert!(validate_config_value("presencePenalty", "-0.5").is_ok());
        assert!(validate_config_value("presencePenalty", "-1").is_ok());
        assert!(validate_config_value("presencePenalty", "-100.25").is_ok());

        assert!(validate_config_value("k", "").is_err());
        assert!(validate_config_value("k", "line\nbreak").is_err());
        assert!(validate_config_value("k", "nul\0byte").is_err());
        assert!(validate_config_value("k", "-x").is_err());
        assert!(validate_config_value("k", "--help").is_err());
        assert!(validate_config_value("k", "-").is_err());
        assert!(validate_config_value("k", "-inf").is_err());
        assert!(validate_config_value("k", "--version").is_err());
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

    #[test]
    fn test_parse_omp_config_tabs() {
        let human = "Settings:\n\n[appearance]\n  theme.dark = dark (string)\n  symbolPreset = unicode (unicode|nerd|ascii)\n\n[model]\n  temperature = 1.0 (number)\n  very.deep.key = x (string)\n\n[providers]\n  providers.anthropic.apiKey = ******** (string)\n";
        let tabs = parse_omp_config_tabs(human);
        assert_eq!(
            tabs.get("theme.dark").map(String::as_str),
            Some("appearance")
        );
        assert_eq!(
            tabs.get("symbolPreset").map(String::as_str),
            Some("appearance")
        );
        assert_eq!(tabs.get("temperature").map(String::as_str), Some("model"));
        assert_eq!(tabs.get("very.deep.key").map(String::as_str), Some("model"));
        // Redacted credentials still carry their tab.
        assert_eq!(
            tabs.get("providers.anthropic.apiKey").map(String::as_str),
            Some("providers")
        );
        assert_eq!(tabs.len(), 5);
    }

    #[test]
    fn test_parse_omp_config_tabs_garbage_lines() {
        // Deeper-indented continuation lines and column-0 noise must not become keys.
        let human = "[model]\n  temperature = 1.0 (number)\n      wrapped continuation\nSettings: noise\n  not a schema key = 1\n  key-without-value\n";
        let tabs = parse_omp_config_tabs(human);
        assert_eq!(tabs.len(), 1);
        assert!(tabs.contains_key("temperature"));
    }
}

/// Return value of `omp_info`: where omp lives and which version answers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpInfo {
    /// The resolved binary exists on disk.
    pub found: bool,
    /// Resolved absolute path (or the raw setting when unresolved).
    pub resolved_path: String,
    /// First line of `omp --version`; None when not found or the call failed.
    pub version: Option<String>,
    /// omp agent dir (`~/.omp/agent`, honoring PI_CODING_AGENT_DIR / profiles).
    pub agent_dir: String,
    /// Global config file `<agentDir>/config.yml`.
    pub config_path: String,
    pub config_exists: bool,
}

/// `omp_info` (§7): resolves the configured omp binary and probes `omp --version`.
#[tauri::command]
pub async fn omp_info(state: tauri::State<'_, AppState>) -> Result<OmpInfo, String> {
    let (exe, path) = omp_exe(&state);
    let agent_dir = crate::settings_mcp::agent_dir();
    let config = agent_dir.join("config.yml");
    let found = exe.is_file();
    let version = if found {
        let mut cmd = tokio::process::Command::new(&exe);
        cmd.current_dir(neutral_cwd()?)
            .arg("--version")
            .env("PATH", &path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        match cmd.spawn() {
            Ok(child) => {
                match tokio::time::timeout(OMP_CONFIG_TIMEOUT, child.wait_with_output()).await {
                    Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout)
                        .lines()
                        .map(str::trim)
                        .find(|l| !l.is_empty())
                        .map(str::to_string),
                    _ => None,
                }
            }
            Err(_) => None,
        }
    } else {
        None
    };
    Ok(OmpInfo {
        found,
        resolved_path: exe.to_string_lossy().to_string(),
        version,
        agent_dir: agent_dir.to_string_lossy().to_string(),
        config_exists: config.is_file(),
        config_path: config.to_string_lossy().to_string(),
    })
}

const OMP_UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// `omp update` downloads the ~200 MB standalone binary; at ~0.6 MB/s (typical
/// without a fast GitHub route) that already takes ~5 min, so keep generous headroom.
const OMP_UPDATE_RUN_TIMEOUT: Duration = Duration::from_secs(1800);

/// Return value of `omp_update_check`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OmpUpdateStatus {
    pub current: Option<String>,
    pub latest: Option<String>,
    pub update_available: bool,
    /// ANSI-stripped combined stdout+stderr.
    pub output: String,
}

/// Return value of `omp_update_run`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpUpdateResult {
    pub success: bool,
    pub output: String,
    /// First line of `omp --version` after the update.
    pub version_after: Option<String>,
}

fn value_after<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    let idx = line.find(prefix)?;
    let v = line[idx + prefix.len()..].trim();
    let v = v.split_whitespace().next()?;
    Some(v.trim_start_matches('v'))
}

/// Parses `omp update --check` output (already ANSI-stripped).
fn parse_update_check(output: &str) -> OmpUpdateStatus {
    let mut current = None;
    let mut latest = None;
    let mut up_to_date = false;
    for line in output.lines() {
        if let Some(v) = value_after(line, "Current version:") {
            current = Some(v.to_string());
        } else if let Some(v) = value_after(line, "New version available:") {
            latest = Some(v.to_string());
        } else if line.contains("Already up to date") {
            up_to_date = true;
        }
    }
    let update_available = latest.is_some() && latest != current;
    if latest.is_none() && up_to_date {
        latest = current.clone();
    }
    OmpUpdateStatus {
        current,
        latest,
        update_available,
        output: output.trim().to_string(),
    }
}

/// Builds the error message for a failed omp update invocation.
fn update_error(output: &str) -> String {
    let trimmed = output.trim();
    let lower = trimmed.to_lowercase();
    let mut msg = if trimmed.is_empty() {
        "omp update 执行失败".to_string()
    } else {
        trimmed.to_string()
    };
    if lower.contains("rate limit") {
        msg.push_str("\n（GitHub API 速率限制，请稍后再试）");
    }
    msg
}

/// Runs omp with `args`; returns (exit success, ANSI-stripped stdout+stderr).
async fn run_omp_capture(
    state: &AppState,
    args: &[&str],
    timeout: Duration,
) -> Result<(bool, String), String> {
    let (exe, path) = omp_exe(state);
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.current_dir(neutral_cwd()?)
        .args(args)
        .env("PATH", &path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 {}：{e}", exe.display()))?;
    let out = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| format!("omp {} 超时", args.join(" ")))?
        .map_err(|e| format!("omp {} 失败：{e}", args.join(" ")))?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&err);
    }
    Ok((out.status.success(), crate::git::tm::strip_ansi(&text)))
}

/// `omp_update_check` (§7): runs `omp update --check` and parses current/latest versions.
#[tauri::command]
pub async fn omp_update_check(
    state: tauri::State<'_, AppState>,
) -> Result<OmpUpdateStatus, String> {
    let (ok, output) =
        run_omp_capture(&state, &["update", "--check"], OMP_UPDATE_CHECK_TIMEOUT).await?;
    if !ok {
        return Err(update_error(&output));
    }
    Ok(parse_update_check(&output))
}

/// `omp_update_run` (§7): runs `omp update`, then re-probes `omp --version`.
#[tauri::command]
pub async fn omp_update_run(state: tauri::State<'_, AppState>) -> Result<OmpUpdateResult, String> {
    let (success, output) = run_omp_capture(&state, &["update"], OMP_UPDATE_RUN_TIMEOUT).await?;
    let version_after = match run_omp_capture(&state, &["--version"], OMP_CONFIG_TIMEOUT).await {
        Ok((true, v)) => v
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(str::to_string),
        _ => None,
    };
    Ok(OmpUpdateResult {
        success,
        output: if success {
            output.trim().to_string()
        } else {
            update_error(&output)
        },
        version_after,
    })
}

#[cfg(test)]
mod update_tests {
    use super::*;

    #[test]
    fn parse_up_to_date() {
        let s = parse_update_check("Current version: 18.8.5\n✔ Already up to date\n");
        assert_eq!(s.current.as_deref(), Some("18.8.5"));
        assert_eq!(s.latest.as_deref(), Some("18.8.5"));
        assert!(!s.update_available);
    }

    #[test]
    fn parse_update_available() {
        let s = parse_update_check("Current version: 18.8.5\nNew version available: 18.9.0\n");
        assert_eq!(s.current.as_deref(), Some("18.8.5"));
        assert_eq!(s.latest.as_deref(), Some("18.9.0"));
        assert!(s.update_available);
    }

    #[test]
    fn rate_limit_hint() {
        assert!(update_error("API rate limit exceeded").contains("速率限制"));
    }
}

#[cfg(test)]
mod window_title_tests {
    use super::*;

    #[test]
    fn window_title_appends_identity() {
        assert_eq!(
            window_title("omp-workspace", "bug-fix"),
            "omp-workspace · bug-fix"
        );
        assert_eq!(
            window_title("omp-workspace", "main"),
            "omp-workspace · main"
        );
        assert_eq!(window_title("omp-workspace", ""), "omp-workspace");
        assert_eq!(
            window_title("omp-workspace", "omp-workspace"),
            "omp-workspace"
        );
    }

    #[test]
    fn worktree_dir_name_takes_basename() {
        assert_eq!(
            worktree_dir_name("/repo/.worktrees/bug-fix").as_deref(),
            Some("bug-fix")
        );
        assert_eq!(worktree_dir_name("/repo").as_deref(), Some("repo"));
        assert_eq!(worktree_dir_name("/"), None);
        assert_eq!(worktree_dir_name(""), None);
    }

    #[test]
    fn worktree_identity_outside_repo_is_none() {
        assert_eq!(
            worktree_identity(Path::new("/nonexistent-ompws-path")),
            None
        );
    }

    /// `git -C <dir>` shorthand; skips (passes) when git is not installed.
    fn git(dir: &Path, args: &[&str]) -> bool {
        std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn worktree_identity_branch_and_detached_fallback() {
        // Unique empty dir under TMPDIR; basename doubles as the detached fallback.
        let dir = std::env::temp_dir().join(format!("ompws-wt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        if !git(&dir, &["init", "--quiet", "--initial-branch", "wt-test"]) {
            let _ = std::fs::remove_dir_all(&dir);
            return; // git unavailable: nothing else to verify
        }

        // Unborn branch still reports its name.
        assert_eq!(worktree_identity(&dir).as_deref(), Some("wt-test"));
        // Branch name, not the toplevel directory name.
        assert!(git(&dir, &["checkout", "--quiet", "-b", "feat-1"]));
        assert_eq!(worktree_identity(&dir).as_deref(), Some("feat-1"));

        // Detached HEAD falls back to the worktree directory name.
        assert!(git(&dir, &["config", "user.email", "t@t"]));
        assert!(git(&dir, &["config", "user.name", "t"]));
        assert!(git(
            &dir,
            &["commit", "--quiet", "--allow-empty", "-m", "init"]
        ));
        assert!(git(&dir, &["checkout", "--quiet", "--detach", "HEAD"]));
        let want = dir.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(worktree_identity(&dir).as_deref(), Some(want.as_str()));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
