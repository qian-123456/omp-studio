//! [D] MCP server configuration bridge for the Settings UI.
//!
//! Reads and writes OMP-native `mcp.json` files only (project `.omp/mcp.json`
//! and `.omp/.mcp.json`, user `<agent-dir>/mcp.json` and `.mcp.json`, and the
//! project-root `mcp.json`/`.mcp.json` fallbacks). Foreign-tool configs
//! (`.claude/`, `.cursor/`, Codex TOML, …) stay read-only in omp and are
//! intentionally not touched here.
//!
//! Safety: values are edited in a `serde_json::Value` map so unknown fields are
//! preserved; writes go through tmp+rename; `env`/`header` values that look
//! secret are masked before reaching the UI (`"********"` never shown in
//! plaintext — masked entries carry `value: null`).

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

const MCP_SCHEMA_URL: &str =
	"https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpKv {
    pub key: String,
    /// `None` when the value was masked as a likely secret.
    pub value: Option<String>,
    pub masked: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerItem {
    pub name: String,
    /// `stdio` (default), `http`, or `sse`.
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub cwd: Option<String>,
    pub timeout_ms: Option<f64>,
    /// Whether the server entry sets `instructions: false` is surfaced via
    /// `instructions` (default true).
    pub instructions: bool,
    /// Effective state after the entry's `enabled` flag, first-definition-wins
    /// shadowing, and the user-level allow/deny lists.
    pub enabled: bool,
    /// Later files define a server of the same name; this entry is ignored.
    pub shadowed: bool,
    /// Hidden by the active profile's user `disabledServers` list.
    pub denylisted: bool,
    /// Force-enabled by the active profile's user `enabledServers` list.
    pub allowlisted: bool,
    pub env: Vec<McpKv>,
    pub headers: Vec<McpKv>,
    pub has_auth: bool,
    pub has_oauth: bool,
    pub source_file: String,
    /// `user` | `project`.
    pub scope: String,
    /// Structural validation problem (mirrors omp's `validateServerConfig`).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpFileInfo {
    pub path: String,
    /// `user` | `project`.
    pub scope: String,
    pub exists: bool,
    /// JSON parse failure; the file is listed but contributes no servers.
    pub parse_error: Option<String>,
    pub disabled_servers: Vec<String>,
    pub enabled_servers: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigSnapshot {
    /// Where "add server" writes by default (user-level `mcp.json`).
    pub default_write_path: String,
    pub files: Vec<McpFileInfo>,
    pub servers: Vec<McpServerItem>,
}

// ---------- path resolution ----------

/// One candidate mcp.json file in omp discovery order.
struct Candidate {
    path: PathBuf,
    scope: &'static str,
    /// Always shown (the user write target); others only when they exist.
    primary: bool,
}

fn candidates(agent_dir: &Path, cwd: Option<&Path>) -> Vec<Candidate> {
    let mut out = Vec::new();
    if let Some(cwd) = cwd {
        let omp_dir = cwd.join(".omp");
        out.push(Candidate {
            path: omp_dir.join("mcp.json"),
            scope: "project",
            primary: true,
        });
        out.push(Candidate {
            path: omp_dir.join(".mcp.json"),
            scope: "project",
            primary: false,
        });
    }
    out.push(Candidate {
        path: agent_dir.join("mcp.json"),
        scope: "user",
        primary: true,
    });
    out.push(Candidate {
        path: agent_dir.join(".mcp.json"),
        scope: "user",
        primary: false,
    });
    if let Some(cwd) = cwd {
        out.push(Candidate {
            path: cwd.join("mcp.json"),
            scope: "project",
            primary: false,
        });
        out.push(Candidate {
            path: cwd.join(".mcp.json"),
            scope: "project",
            primary: false,
        });
    }
    out
}

// ---------- json io ----------

fn read_json_map(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读取 {} 失败: {e}", path.display())),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => Ok(Some(m)),
        Ok(_) => Err("顶层必须是 JSON 对象".to_string()),
        Err(e) => Err(format!("JSON 解析失败: {e}")),
    }
}

/// Atomic write via tmp+rename (same convention as services::files).
fn write_json_map(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录 {} 失败: {e}", parent.display()))?;
    }
    let mut text = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| format!("序列化失败: {e}"))?;
    text.push('\n');
    let name = path
        .file_name()
        .ok_or_else(|| "无效的 mcp.json 路径".to_string())?
        .to_string_lossy();
    let tmp = path.with_file_name(format!(".{name}.ompws-{}.tmp", std::process::id()));
    std::fs::write(&tmp, text).map_err(|e| format!("写入失败: {e}"))?;
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("写入失败: {e}")
    })
}

/// Canonical comparison tolerant of missing files.
fn normalize_path(path: &Path) -> PathBuf {
    if let Ok(p) = std::fs::canonicalize(path) {
        return p;
    }
    if let Some(parent) = path.parent() {
        if let Ok(parent_canon) = std::fs::canonicalize(parent) {
            if let Some(file_name) = path.file_name() {
                return parent_canon.join(file_name);
            }
        }
    }
    path.to_path_buf()
}

fn is_allowed_path(path: &Path, agent_dir: &Path, cwd: Option<&Path>) -> bool {
    let want = normalize_path(path);
    candidates(agent_dir, cwd)
        .iter()
        .any(|c| normalize_path(&c.path) == want)
}

// ---------- masking ----------

fn looks_like_env_ref(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn key_is_secret_like(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "passwd",
        "apikey",
        "api_key",
        "authorization",
        "cookie",
        "credential",
        "bearer",
    ]
    .iter()
    .any(|p| k.contains(p))
}

/// omp resolves `${VAR}` placeholders and bare env-var names at connect time,
/// so neither is itself a secret. `!command` indirections may embed secrets and
/// are masked. Long literal blobs are masked too.
fn is_secret(key: &str, value: &str) -> bool {
    if value.is_empty() || value.contains("${") {
        return false;
    }
    if value.starts_with('!') {
        return true;
    }
    if looks_like_env_ref(value) {
        return false;
    }
    if key_is_secret_like(key) {
        return true;
    }
    value.len() >= 12 && !value.contains(char::is_whitespace)
}

fn mask_map(obj: Option<&Value>) -> Vec<McpKv> {
    let mut out: Vec<McpKv> = obj
        .and_then(|v| v.as_object())
        .map(|m| {
            m.iter()
                .map(|(k, v)| {
                    let raw = v.as_str().unwrap_or("");
                    let masked = is_secret(k, raw);
                    McpKv {
                        key: k.clone(),
                        value: if masked { None } else { Some(raw.to_string()) },
                        masked,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.key.cmp(&b.key));
    out
}

// ---------- validation ----------

/// Server names accepted by omp's config writer: ≤100 chars of
/// `[A-Za-z0-9_.:-]` (the schema omits `:`; the runtime accepts it).
fn validate_server_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.chars().count() > 100 {
        return Err("服务器名称需为 1-100 个字符".to_string());
    }
    // Reject bare dot segments — they'd confuse file bookkeeping.
    if name == "." || name == ".." {
        return Err("服务器名称不能为 \".\" 或 \"..\"".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'))
    {
        return Err("服务器名称只能包含字母、数字、_ - . :".to_string());
    }
    Ok(())
}

/// Mirrors `validateServerConfig()`: stdio needs `command`, http/sse need
/// `url`, and a server cannot set both.
fn validate_server_entry(name: &str, entry: &Map<String, Value>) -> Option<String> {
    let ty = entry
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("stdio");
    if !matches!(ty, "stdio" | "http" | "sse") {
        return Some(format!("服务器 \"{name}\": 未知 type \"{ty}\""));
    }
    let has_command = entry
        .get("command")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty());
    let has_url = entry
        .get("url")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty());
    match (ty, has_command, has_url) {
        ("stdio", false, _) => Some(format!("服务器 \"{name}\": stdio 服务器需要 command 字段")),
        ("http" | "sse", _, false) => Some(format!("服务器 \"{name}\": {ty} 服务器需要 url 字段")),
        (_, true, true) => Some(format!("服务器 \"{name}\": command 与 url 只能设置一个")),
        _ => None,
    }
}

fn str_list(map: &Map<String, Value>, key: &str) -> Vec<String> {
    map.get(key)
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn remove_from_list(map: &mut Map<String, Value>, key: &str, name: &str) -> bool {
    let mut changed = false;
    if let Some(Value::Array(items)) = map.get_mut(key) {
        let before = items.len();
        items.retain(|v| v.as_str() != Some(name));
        changed = items.len() != before;
    }
    changed
}

// ---------- snapshot ----------

fn build_snapshot(agent_dir: &Path, cwd: Option<&Path>) -> McpConfigSnapshot {
    let mut files = Vec::new();
    let mut servers = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut user_denylist: Vec<String> = Vec::new();
    let mut user_allowlist: Vec<String> = Vec::new();

    // Collect allow/deny lists first: they live in the user-level file.
    for c in candidates(agent_dir, cwd) {
        if c.scope != "user" {
            continue;
        }
        if let Ok(Some(map)) = read_json_map(&c.path) {
            user_denylist.extend(str_list(&map, "disabledServers"));
            user_allowlist.extend(str_list(&map, "enabledServers"));
        }
    }

    for c in candidates(agent_dir, cwd) {
        if !c.path.is_file() && !c.primary {
            continue;
        }
        let parsed = read_json_map(&c.path);
        let (map, parse_error) = match parsed {
            Ok(m) => (m, None),
            Err(e) => (None, Some(e)),
        };
        let info = McpFileInfo {
            path: c.path.to_string_lossy().to_string(),
            scope: c.scope.to_string(),
            exists: c.path.is_file(),
            parse_error,
            disabled_servers: map
                .as_ref()
                .map(|m| str_list(m, "disabledServers"))
                .unwrap_or_default(),
            enabled_servers: map
                .as_ref()
                .map(|m| str_list(m, "enabledServers"))
                .unwrap_or_default(),
        };
        files.push(info);

        let Some(map) = map else { continue };
        let Some(servers_obj) = map.get("mcpServers").and_then(|v| v.as_object()) else {
            continue;
        };
        for (name, raw) in servers_obj {
            let entry = match raw.as_object() {
                Some(e) => e,
                None => continue,
            };
            let entry_enabled = entry
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let shadowed = !seen.insert(name.clone());
            let denylisted = user_denylist.iter().any(|n| n == name);
            let allowlisted = !entry_enabled && user_allowlist.iter().any(|n| n == name);
            let enabled = !shadowed && !denylisted && (entry_enabled || allowlisted);
            servers.push(McpServerItem {
                name: name.clone(),
                transport: entry
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("stdio")
                    .to_string(),
                command: entry
                    .get("command")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                args: str_list(entry, "args"),
                url: entry.get("url").and_then(|v| v.as_str()).map(String::from),
                cwd: entry.get("cwd").and_then(|v| v.as_str()).map(String::from),
                timeout_ms: entry.get("timeout").and_then(|v| v.as_f64()),
                instructions: entry
                    .get("instructions")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
                enabled,
                shadowed,
                denylisted,
                allowlisted,
                env: mask_map(entry.get("env")),
                headers: mask_map(entry.get("headers")),
                has_auth: entry.get("auth").is_some_and(|v| v.is_object()),
                has_oauth: entry.get("oauth").is_some_and(|v| v.is_object()),
                source_file: c.path.to_string_lossy().to_string(),
                scope: c.scope.to_string(),
                error: validate_server_entry(name, entry),
            });
        }
    }

    servers.sort_by(|a, b| a.name.cmp(&b.name));
    McpConfigSnapshot {
        default_write_path: agent_dir.join("mcp.json").to_string_lossy().to_string(),
        files,
        servers,
    }
}

/// Merge `patch` into `entry`: `null` deletes a key; `env`/`headers` objects
/// deep-merge per-key (`null` deletes one entry) so masked secrets never leave
/// the file.
fn apply_patch(entry: &mut Map<String, Value>, patch: &Map<String, Value>) {
    for (k, v) in patch {
        if v.is_null() {
            entry.remove(k);
            continue;
        }
        if matches!(k.as_str(), "env" | "headers") {
            if let (Some(Value::Object(existing)), Value::Object(patch_map)) = (entry.get_mut(k), v)
            {
                for (ik, iv) in patch_map {
                    if iv.is_null() {
                        existing.remove(ik);
                    } else {
                        existing.insert(ik.clone(), iv.clone());
                    }
                }
                continue;
            }
        }
        entry.insert(k.clone(), v.clone());
    }
}

fn servers_map_mut(map: &mut Map<String, Value>) -> Result<&mut Map<String, Value>, String> {
    match map.get_mut("mcpServers") {
        None => {
            map.insert("mcpServers".to_string(), Value::Object(Map::new()));
        }
        Some(Value::Object(_)) => {}
        Some(_) => return Err("mcpServers 字段不是对象".to_string()),
    }
    map.get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| "mcpServers 字段不可用".to_string())
}

fn upsert_impl(path: &Path, name: &str, patch: &Map<String, Value>) -> Result<(), String> {
    validate_server_name(name)?;
    let mut map = read_json_map(path)?.unwrap_or_else(|| {
        let mut m = Map::new();
        m.insert(
            "$schema".to_string(),
            Value::String(MCP_SCHEMA_URL.to_string()),
        );
        m
    });
    let merged = {
        let servers = servers_map_mut(&mut map)?;
        let mut entry = servers
            .get(name)
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        apply_patch(&mut entry, patch);
        if let Some(err) = validate_server_entry(name, &entry) {
            return Err(err);
        }
        entry
    };
    servers_map_mut(&mut map)?.insert(name.to_string(), Value::Object(merged));
    write_json_map(path, &map)
}

fn remove_impl(path: &Path, name: &str) -> Result<bool, String> {
    let Some(mut map) = read_json_map(path)? else {
        return Ok(false);
    };
    let mut changed = false;
    if let Some(servers) = map.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        changed = servers.remove(name).is_some();
    }
    changed |= remove_from_list(&mut map, "disabledServers", name);
    changed |= remove_from_list(&mut map, "enabledServers", name);
    if changed {
        write_json_map(path, &map)?;
    }
    Ok(changed)
}

fn move_impl(
    agent_dir: &Path,
    cwd: Option<&Path>,
    from_path: &Path,
    to_path: &Path,
    name: &str,
) -> Result<(), String> {
    if !is_allowed_path(from_path, agent_dir, cwd) {
        return Err(format!("不允许读取该路径: {}", from_path.display()));
    }
    if !is_allowed_path(to_path, agent_dir, cwd) {
        return Err(format!("不允许写入该路径: {}", to_path.display()));
    }
    if normalize_path(from_path) == normalize_path(to_path) {
        return Err("源路径与目标路径相同".to_string());
    }
    validate_server_name(name)?;

    let mut from_map = read_json_map(from_path)?
        .ok_or_else(|| format!("源文件 {} 不存在", from_path.display()))?;
    let entry = {
        let servers = servers_map_mut(&mut from_map)?;
        servers
            .remove(name)
            .ok_or_else(|| format!("源文件中未找到服务器 \"{name}\""))?
    };

    let mut to_map = read_json_map(to_path)?.unwrap_or_else(|| {
        let mut m = Map::new();
        m.insert(
            "$schema".to_string(),
            Value::String(MCP_SCHEMA_URL.to_string()),
        );
        m
    });
    servers_map_mut(&mut to_map)?.insert(name.to_string(), entry);

    // Write target first, then clean source
    write_json_map(to_path, &to_map)?;
    remove_from_list(&mut from_map, "disabledServers", name);
    remove_from_list(&mut from_map, "enabledServers", name);
    write_json_map(from_path, &from_map)?;

    Ok(())
}

/// Toggle the `enabled` flag on the file that defines `name`; enabling also
/// clears it from the user file's `disabledServers`, disabling clears
/// `enabledServers` (stale user overrides would otherwise re-flip the switch).
fn set_enabled_impl(
    agent_dir: &Path,
    cwd: Option<&Path>,
    name: &str,
    enabled: bool,
) -> Result<(), String> {
    let mut defining: Option<PathBuf> = None;
    for c in candidates(agent_dir, cwd) {
        if let Ok(Some(map)) = read_json_map(&c.path) {
            if map
                .get("mcpServers")
                .and_then(|v| v.as_object())
                .is_some_and(|s| s.contains_key(name))
            {
                defining = Some(c.path.clone());
                break;
            }
        }
    }
    let path = defining.ok_or_else(|| format!("服务器 \"{name}\" 不存在"))?;
    let user_path = agent_dir.join("mcp.json");
    let same_file = normalize_path(&user_path) == normalize_path(&path);
    {
        let mut map = read_json_map(&path)?.ok_or("无法读取 mcp.json")?;
        let servers = servers_map_mut(&mut map)?;
        let entry = servers
            .get_mut(name)
            .and_then(|v| v.as_object_mut())
            .ok_or_else(|| format!("服务器 \"{name}\" 不存在"))?;
        entry.insert("enabled".to_string(), Value::Bool(enabled));
        if same_file {
            // The defining file already holds the user override lists.
            remove_from_list(
                &mut map,
                if enabled {
                    "disabledServers"
                } else {
                    "enabledServers"
                },
                name,
            );
        }
        write_json_map(&path, &map)?;
    }
    if !same_file {
        // Sweep stale user-list overrides so the toggle actually sticks.
        if let Ok(Some(mut map)) = read_json_map(&user_path) {
            let key = if enabled {
                "disabledServers"
            } else {
                "enabledServers"
            };
            if remove_from_list(&mut map, key, name) {
                write_json_map(&user_path, &map)?;
            }
        }
    }
    Ok(())
}

// ---------- commands ----------

/// `mcp_config_list` (§7 D): OMP-managed mcp.json files + their servers.
#[tauri::command]
pub async fn mcp_config_list(cwd: Option<String>) -> Result<McpConfigSnapshot, String> {
    let agent_dir = crate::paths::agent_dir();
    let cwd_path = cwd.map(PathBuf::from);
    Ok(build_snapshot(&agent_dir, cwd_path.as_deref()))
}

/// `mcp_server_upsert` (§7 D): add/update a server in an allowed mcp.json.
/// `patch` is merged into the existing entry (`null` deletes; `env`/`headers`
/// merge per key) so masked values and unknown fields survive round-trips.
#[tauri::command]
pub async fn mcp_server_upsert(
    cwd: Option<String>,
    path: String,
    name: String,
    patch: serde_json::Map<String, Value>,
) -> Result<(), String> {
    let agent_dir = crate::paths::agent_dir();
    let cwd_path = cwd.as_deref().map(Path::new);
    let target = PathBuf::from(&path);
    if !is_allowed_path(&target, &agent_dir, cwd_path) {
        return Err(format!("不允许写入该路径: {path}"));
    }
    upsert_impl(&target, &name, &patch)
}

/// `mcp_server_remove` (§7 D): delete a server entry from its mcp.json.
#[tauri::command]
pub async fn mcp_server_remove(
    cwd: Option<String>,
    path: String,
    name: String,
) -> Result<(), String> {
    let agent_dir = crate::paths::agent_dir();
    let cwd_path = cwd.as_deref().map(Path::new);
    let target = PathBuf::from(&path);
    if !is_allowed_path(&target, &agent_dir, cwd_path) {
        return Err(format!("不允许写入该路径: {path}"));
    }
    if !remove_impl(&target, &name)? {
        return Err(format!("服务器 \"{name}\" 不存在"));
    }
    Ok(())
}

/// `mcp_server_set_enabled` (§7 D): toggle one server (writes `enabled` in the
/// defining file and sweeps stale user allow/deny list entries).
#[tauri::command]
pub async fn mcp_server_set_enabled(
    cwd: Option<String>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    let agent_dir = crate::paths::agent_dir();
    let cwd_path = cwd.as_deref().map(Path::new);
    set_enabled_impl(&agent_dir, cwd_path, &name, enabled)
}

/// `mcp_server_move` (§7 D): move a server definition from one mcp.json file to another
/// atomically without losing masked secrets or raw fields.
#[tauri::command]
pub async fn mcp_server_move(
    cwd: Option<String>,
    from_path: String,
    to_path: String,
    name: String,
) -> Result<(), String> {
    let agent_dir = crate::paths::agent_dir();
    let cwd_path = cwd.map(PathBuf::from);
    let from = PathBuf::from(from_path);
    let to = PathBuf::from(to_path);
    tokio::task::spawn_blocking(move || {
        move_impl(&agent_dir, cwd_path.as_deref(), &from, &to, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ompws-mcp-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn patch(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    fn patch_json(v: Value) -> Map<String, Value> {
        match v {
            Value::Object(m) => m,
            _ => panic!("patch must be an object"),
        }
    }

    #[test]
    fn move_server_transfers_entry_without_loss_and_cleans_source() {
        let dir = temp_dir("move");
        let agent = dir.join("agent");
        let proj = dir.join("proj");
        std::fs::create_dir_all(&agent).unwrap();
        std::fs::create_dir_all(proj.join(".omp")).unwrap();

        let src_file = agent.join("mcp.json");
        let dst_file = proj.join(".omp").join("mcp.json");

        upsert_impl(
            &src_file,
            "rea",
            &patch_json(serde_json::json!({
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "rea-agents@6.5.0", "mcp"],
                "env": {
                    "SECRET_TOKEN": "my-secret"
                }
            })),
        )
        .unwrap();

        move_impl(&agent, Some(&proj), &src_file, &dst_file, "rea").unwrap();

        // Source no longer contains "rea"
        let src_map = read_json_map(&src_file).unwrap().unwrap();
        assert!(!src_map["mcpServers"]
            .as_object()
            .unwrap()
            .contains_key("rea"));

        // Destination contains "rea" with full secrets preserved
        let dst_map = read_json_map(&dst_file).unwrap().unwrap();
        let rea_entry = &dst_map["mcpServers"]["rea"];
        assert_eq!(rea_entry["command"], "npx");
        assert_eq!(rea_entry["env"]["SECRET_TOKEN"], "my-secret");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_creates_file_with_schema_and_validates() {
        let dir = temp_dir("upsert");
        let path = dir.join("mcp.json");

        // Missing command on stdio is rejected.
        let err = upsert_impl(&path, "bad", &patch(&[])).unwrap_err();
        assert!(err.contains("command"));

        // command+url conflict is rejected.
        let err = upsert_impl(
            &path,
            "bad2",
            &patch(&[
                ("command", Value::String("npx".into())),
                ("url", Value::String("https://x".into())),
            ]),
        )
        .unwrap_err();
        assert!(err.contains("只能设置一个"));

        upsert_impl(
            &path,
            "github",
            &patch(&[
                ("type", Value::String("http".into())),
                (
                    "url",
                    Value::String("https://api.githubcopilot.com/mcp/".into()),
                ),
            ]),
        )
        .unwrap();
        upsert_impl(
            &path,
            "fs",
            &patch(&[
                ("command", Value::String("npx".into())),
                (
                    "args",
                    Value::Array(vec![
                        "-y".into(),
                        "@modelcontextprotocol/server-filesystem".into(),
                        "/tmp".into(),
                    ]),
                ),
            ]),
        )
        .unwrap();

        let map = read_json_map(&path).unwrap().unwrap();
        assert_eq!(map.get("$schema").unwrap(), MCP_SCHEMA_URL);
        let servers = map.get("mcpServers").unwrap().as_object().unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(
            servers["fs"]["args"].as_array().unwrap().len(),
            3,
            "args array must be written verbatim"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_preserves_unknown_fields_and_patches_env() {
        let dir = temp_dir("merge");
        let path = dir.join("mcp.json");
        upsert_impl(
            &path,
            "svc",
            &patch_json(serde_json::json!({
                "command": "node",
                "timeout": 120000,
                "env": {
                    "SECRET_KEY": "real-secret-value",
                    "PLAIN": "plain"
                },
                // Unknown forward-compat field survives untouched.
                "x-future": true
            })),
        )
        .unwrap();

        // env patch: overwrite one key, delete another, keep a third untouched
        // by adding a pre-existing key first via second patch.
        upsert_impl(
            &path,
            "svc",
            &patch_json(serde_json::json!({
                "env": {
                    "PLAIN": null,
                    "NEW": "v"
                }
            })),
        )
        .unwrap();

        let map = read_json_map(&path).unwrap().unwrap();
        let entry = &map["mcpServers"]["svc"];
        assert_eq!(entry["x-future"], true);
        assert_eq!(entry["timeout"], 120000);
        let env = entry["env"].as_object().unwrap();
        assert_eq!(env["SECRET_KEY"], "real-secret-value");
        assert!(env.get("PLAIN").is_none());
        assert_eq!(env["NEW"], "v");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_enabled_roundtrip_and_removal() {
        let dir = temp_dir("toggle");
        let agent = dir.join("agent");
        std::fs::create_dir_all(&agent).unwrap();
        let path = agent.join("mcp.json");
        upsert_impl(
            &path,
            "svc",
            &patch(&[("command", Value::String("npx".into()))]),
        )
        .unwrap();

        set_enabled_impl(&agent, None, "svc", false).unwrap();
        let map = read_json_map(&path).unwrap().unwrap();
        assert_eq!(map["mcpServers"]["svc"]["enabled"], false);

        // Enabling sweeps the user denylist.
        let mut map = read_json_map(&path).unwrap().unwrap();
        map.insert(
            "disabledServers".to_string(),
            Value::Array(vec!["svc".into()]),
        );
        write_json_map(&path, &map).unwrap();
        set_enabled_impl(&agent, None, "svc", true).unwrap();
        let map = read_json_map(&path).unwrap().unwrap();
        assert_eq!(map["mcpServers"]["svc"]["enabled"], true);
        assert!(map["disabledServers"].as_array().unwrap().is_empty());

        remove_impl(&path, "svc").unwrap();
        assert!(!remove_impl(&path, "svc").unwrap());
        let map = read_json_map(&path).unwrap().unwrap();
        assert!(map["mcpServers"].as_object().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_masks_secrets_and_marks_shadowed() {
        let dir = temp_dir("snap");
        let agent = dir.join("agent");
        let proj = dir.join("proj");
        std::fs::create_dir_all(agent.join("..")).unwrap();
        std::fs::create_dir_all(proj.join(".omp")).unwrap();

        upsert_impl(
            &agent.join("mcp.json"),
            "svc",
            &patch(&[
                ("command", Value::String("npx".into())),
                (
                    "env",
                    Value::Object(
                        [
                            // env-ref indirection: not secret
                            ("API_TOKEN".to_string(), Value::String("API_TOKEN".into())),
                            // literal secret-ish blob: masked
                            (
                                "PASSWORD".to_string(),
                                Value::String("hunter2-hunter2".into()),
                            ),
                            // placeholder: not secret
                            ("OTHER".to_string(), Value::String("${OTHER_VAR}".into())),
                        ]
                        .into_iter()
                        .collect(),
                    ),
                ),
                (
                    "headers",
                    Value::Object(
                        [(
                            "Authorization".to_string(),
                            Value::String("Bearer sk-live-abcdef123456".into()),
                        )]
                        .into_iter()
                        .collect(),
                    ),
                ),
            ]),
        )
        .unwrap();

        // A project file shadows the user entry of the same name.
        upsert_impl(
            &proj.join(".omp").join("mcp.json"),
            "svc",
            &patch(&[("command", Value::String("deno".into()))]),
        )
        .unwrap();

        let snap = build_snapshot(&agent, Some(&proj));
        let svc_proj = snap.servers.iter().find(|s| s.scope == "project").unwrap();
        let svc_user = snap.servers.iter().find(|s| s.scope == "user").unwrap();
        assert!(!svc_proj.shadowed);
        assert!(svc_user.shadowed);
        assert!(!svc_user.enabled);

        let env: BTreeMap<&str, _> = svc_user.env.iter().map(|k| (k.key.as_str(), k)).collect();
        assert_eq!(env["API_TOKEN"].value.as_deref(), Some("API_TOKEN"));
        assert!(env["PASSWORD"].masked && env["PASSWORD"].value.is_none());
        assert_eq!(env["OTHER"].value.as_deref(), Some("${OTHER_VAR}"));
        assert!(svc_user.headers[0].masked && svc_user.headers[0].value.is_none());
        // The raw file still holds the real values — masking is display-only.
        let raw = std::fs::read_to_string(agent.join("mcp.json")).unwrap();
        assert!(raw.contains("real-secret") || raw.contains("hunter2-hunter2"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn name_and_path_validation() {
        for bad in ["", "a b", "a/b", "..", "x".repeat(101).as_str()] {
            assert!(validate_server_name(bad).is_err(), "should reject: {bad}");
        }
        for ok in ["fs", "a.b-c_d:e", &"x".repeat(100)] {
            assert!(validate_server_name(ok).is_ok(), "should accept: {ok}");
        }

        let dir = temp_dir("pathcheck");
        let agent = dir.join("agent");
        assert!(is_allowed_path(&agent.join("mcp.json"), &agent, None));
        assert!(!is_allowed_path(&dir.join("evil.json"), &agent, None));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
