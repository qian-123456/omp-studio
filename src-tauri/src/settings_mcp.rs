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

use serde::{Deserialize, Serialize};
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
    /// Project dir (verbatim, as passed to `mcp_catalog`) for project files.
    pub project: Option<String>,
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

/// One known project (main checkout) in the MCP catalog.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProjectInfo {
    /// Echoed exactly as passed in.
    pub path: String,
    /// `<path>/.omp/mcp.json`.
    pub config_path: String,
    /// Linked git worktrees (writes are mirrored into their `.omp/mcp.json`).
    pub worktrees: Vec<String>,
}

/// Where a server loads: every project (minus excluded), only some, or nowhere.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpScopeMode {
    All,
    Projects,
    #[default]
    Off,
}

/// One server (unique by name) across the user config and every known project.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    pub name: String,
    /// Canonical definition (secrets masked).
    pub definition: McpServerItem,
    pub mode: McpScopeMode,
    pub active_projects: Vec<String>,
    pub excluded_projects: Vec<String>,
    pub copy_projects: Vec<String>,
    pub custom_projects: Vec<String>,
    pub has_global: bool,
    pub denylisted: bool,
    /// Every config file (user + main project checkouts) that mentions the name.
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCatalog {
    pub global_path: String,
    pub projects: Vec<McpProjectInfo>,
    pub servers: Vec<McpServerView>,
    pub files: Vec<McpFileInfo>,
}

/// Requested placement for a server.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpScope {
    pub all_projects: bool,
    pub projects: Vec<String>,
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

// ---------- entry classification ----------

type Entry = Map<String, Value>;
/// An entry together with the file that holds it.
type Found = (PathBuf, Entry);

fn has_str(e: &Entry, key: &str) -> bool {
    e.get(key)
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty())
}

fn is_disabled(e: &Entry) -> bool {
    e.get("enabled").and_then(|v| v.as_bool()) == Some(false)
}

/// Off-marker: `enabled: false` without `command`/`url`. It hides a same-named
/// lower-priority server in this scope only.
fn is_marker(e: &Entry) -> bool {
    is_disabled(e) && !has_str(e, "command") && !has_str(e, "url")
}

fn without_enabled(e: &Entry) -> Entry {
    let mut c = e.clone();
    c.remove("enabled");
    c
}

fn identical(a: &Entry, b: &Entry) -> bool {
    without_enabled(a) == without_enabled(b)
}

fn marker() -> Entry {
    let mut m = Map::new();
    m.insert("enabled".to_string(), Value::Bool(false));
    m
}

fn with_enabled_false(e: &Entry) -> Entry {
    let mut c = e.clone();
    c.insert("enabled".to_string(), Value::Bool(false));
    c
}

fn not_exist(name: &str) -> String {
    format!("服务器「{name}」不存在")
}

fn server_entry<'a>(map: &'a Entry, name: &str) -> Option<&'a Entry> {
    map.get("mcpServers")?.as_object()?.get(name)?.as_object()
}

// ---------- item / file info builders ----------

#[allow(clippy::too_many_arguments)]
fn item_from_entry(
    name: &str,
    entry: &Entry,
    path: &Path,
    scope: &str,
    shadowed: bool,
    denylisted: bool,
    allowlisted: bool,
    enabled: bool,
) -> McpServerItem {
    McpServerItem {
        name: name.to_string(),
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
        source_file: path.to_string_lossy().to_string(),
        scope: scope.to_string(),
        error: validate_server_entry(name, entry),
    }
}

/// Read one candidate file into a listing row plus its parsed map.
fn file_info(c: &Candidate, project: Option<&str>) -> (McpFileInfo, Option<Entry>) {
    let (map, parse_error) = match read_json_map(&c.path) {
        Ok(m) => (m, None),
        Err(e) => (None, Some(e)),
    };
    let info = McpFileInfo {
        path: c.path.to_string_lossy().to_string(),
        scope: c.scope.to_string(),
        project: if c.scope == "project" {
            project.map(String::from)
        } else {
            None
        },
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
    (info, map)
}

// ---------- per-cwd snapshot ----------

fn build_snapshot(agent_dir: &Path, cwd: Option<&Path>) -> McpConfigSnapshot {
    let cwd_str = cwd.map(|c| c.to_string_lossy().to_string());
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
        let (info, map) = file_info(&c, cwd_str.as_deref());
        files.push(info);

        let Some(map) = map else { continue };
        let Some(servers_obj) = map.get("mcpServers").and_then(|v| v.as_object()) else {
            continue;
        };
        for (name, raw) in servers_obj {
            let Some(entry) = raw.as_object() else {
                continue;
            };
            // An off-marker claims the name (shadowing later definitions) but
            // is not a server of its own.
            let shadowed = !seen.insert(name.clone());
            if is_marker(entry) {
                continue;
            }
            let entry_enabled = !is_disabled(entry);
            let denylisted = user_denylist.iter().any(|n| n == name);
            let allowlisted = !entry_enabled && user_allowlist.iter().any(|n| n == name);
            let enabled = !shadowed && !denylisted && (entry_enabled || allowlisted);
            servers.push(item_from_entry(
                name,
                entry,
                &c.path,
                c.scope,
                shadowed,
                denylisted,
                allowlisted,
                enabled,
            ));
        }
    }

    servers.sort_by(|a, b| a.name.cmp(&b.name));
    McpConfigSnapshot {
        default_write_path: agent_dir.join("mcp.json").to_string_lossy().to_string(),
        files,
        servers,
    }
}

// ---------- patching ----------

/// Merge `patch` into `entry`: `null` deletes a key; `env`/`headers` objects
/// deep-merge per-key (`null` deletes one entry) so masked secrets never leave
/// the file. When there is no map yet only the non-null values are inserted.
fn apply_patch(entry: &mut Entry, patch: &Entry) {
    for (k, v) in patch {
        if v.is_null() {
            entry.remove(k);
            continue;
        }
        if matches!(k.as_str(), "env" | "headers") {
            if let Value::Object(patch_map) = v {
                if let Some(Value::Object(existing)) = entry.get_mut(k) {
                    for (ik, iv) in patch_map {
                        if iv.is_null() {
                            existing.remove(ik);
                        } else {
                            existing.insert(ik.clone(), iv.clone());
                        }
                    }
                } else {
                    let fresh: Entry = patch_map
                        .iter()
                        .filter(|(_, iv)| !iv.is_null())
                        .map(|(ik, iv)| (ik.clone(), iv.clone()))
                        .collect();
                    entry.insert(k.clone(), Value::Object(fresh));
                }
                continue;
            }
        }
        entry.insert(k.clone(), v.clone());
    }
}

fn servers_map_mut(map: &mut Entry) -> Result<&mut Entry, String> {
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

// ---------- in-memory workspace ----------

/// One mcp.json held in memory; flushed (atomically per file) only after the
/// whole operation succeeded, so precondition failures never leave a
/// half-applied state.
struct Doc {
    map: Entry,
    existed: bool,
    dirty: bool,
    err: Option<String>,
}

fn load_doc(path: &Path) -> Doc {
    match read_json_map(path) {
        Ok(Some(map)) => Doc {
            map,
            existed: true,
            dirty: false,
            err: None,
        },
        Ok(None) => Doc {
            map: Map::new(),
            existed: false,
            dirty: false,
            err: None,
        },
        Err(e) => Doc {
            map: Map::new(),
            existed: true,
            dirty: false,
            err: Some(e),
        },
    }
}

/// A known project (main checkout).
struct Proj {
    /// Verbatim string from the frontend.
    path: String,
    dir: PathBuf,
    worktrees: Vec<PathBuf>,
}

/// Linked worktrees of `dir`; empty unless `dir` is the main worktree of a repo.
fn linked_worktrees(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = crate::git::worktree::list_entries(dir) else {
        return Vec::new();
    };
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let Some(first) = entries.first() else {
        return Vec::new();
    };
    if first.bare || canon(Path::new(&first.path)) != canon(dir) {
        return Vec::new();
    }
    entries
        .iter()
        .skip(1)
        .filter(|e| !e.bare)
        .map(|e| PathBuf::from(&e.path))
        .filter(|p| p.is_dir())
        .collect()
}

/// Where a name is defined and how it resolves in every known project.
struct Analysis {
    global: Option<Found>,
    locals: Vec<Option<Found>>,
    fallbacks: Vec<Option<Found>>,
    /// Effective on/off per known project.
    on: Vec<bool>,
    mode: McpScopeMode,
    /// Full definition + whether it came from the user level.
    canonical: Option<(PathBuf, Entry, bool)>,
}

impl Analysis {
    /// A global entry that is a real definition (not an off-marker).
    fn global_full(&self) -> Option<&Found> {
        self.global.as_ref().filter(|(_, g)| !is_marker(g))
    }

    /// The project's own full definition: `.omp` first, else root fallback.
    fn copy(&self, i: usize) -> Option<&Found> {
        [&self.locals[i], &self.fallbacks[i]]
            .into_iter()
            .flatten()
            .find(|(_, e)| !is_marker(e))
    }
}

struct Ws {
    agent_dir: PathBuf,
    projects: Vec<Proj>,
    docs: std::collections::HashMap<PathBuf, Doc>,
    /// Read-only listing: parse errors never fail a read.
    lenient: bool,
}

impl Ws {
    fn open(agent_dir: &Path, projects: &[String], lenient: bool) -> Result<Ws, String> {
        let mut ps = Vec::with_capacity(projects.len());
        for p in projects {
            let dir = PathBuf::from(p);
            if !dir.is_absolute() {
                return Err(format!("项目路径无效（需为绝对路径）：{p}"));
            }
            // A workspace whose folder was moved or deleted has no config to read or
            // write; skip it so one stale entry never breaks the whole MCP page.
            if !dir.is_dir() {
                continue;
            }
            let worktrees = linked_worktrees(&dir);
            ps.push(Proj {
                path: p.clone(),
                dir,
                worktrees,
            });
        }
        Ok(Ws {
            agent_dir: agent_dir.to_path_buf(),
            projects: ps,
            docs: Default::default(),
            lenient,
        })
    }

    fn user_files(&self) -> [PathBuf; 2] {
        [
            self.agent_dir.join("mcp.json"),
            self.agent_dir.join(".mcp.json"),
        ]
    }

    fn local_paths(&self, i: usize) -> [PathBuf; 2] {
        let omp = self.projects[i].dir.join(".omp");
        [omp.join("mcp.json"), omp.join(".mcp.json")]
    }

    fn fallback_paths(&self, i: usize) -> [PathBuf; 2] {
        let dir = &self.projects[i].dir;
        [dir.join("mcp.json"), dir.join(".mcp.json")]
    }

    /// User files, then every project's four files (worktree mirrors optional).
    fn all_files(&self, with_worktrees: bool) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = self.user_files().into();
        for i in 0..self.projects.len() {
            out.extend(self.local_paths(i));
            out.extend(self.fallback_paths(i));
            if with_worktrees {
                for wt in &self.projects[i].worktrees {
                    out.push(wt.join(".omp").join("mcp.json"));
                    out.push(wt.join(".omp").join(".mcp.json"));
                }
            }
        }
        out
    }

    /// Shared root files (`<project>/mcp.json`) are read-only fallbacks: an
    /// unparseable one is ignored rather than blocking every operation.
    fn is_lenient(&self, path: &Path) -> bool {
        self.lenient
            || path.parent().is_some_and(|d| {
                d != self.agent_dir && d.file_name() != Some(std::ffi::OsStr::new(".omp"))
            })
    }

    fn doc(&mut self, path: &Path) -> &mut Doc {
        self.docs
            .entry(path.to_path_buf())
            .or_insert_with(|| load_doc(path))
    }

    fn writable(&mut self, path: &Path) -> Result<&mut Doc, String> {
        let d = self.doc(path);
        if let Some(e) = &d.err {
            return Err(format!("{}：{e}", path.display()));
        }
        Ok(d)
    }

    fn entry(&mut self, path: &Path, name: &str) -> Result<Option<Entry>, String> {
        let lenient = self.is_lenient(path);
        let d = self.doc(path);
        if let Some(e) = &d.err {
            return if lenient {
                Ok(None)
            } else {
                Err(format!("{}：{e}", path.display()))
            };
        }
        Ok(server_entry(&d.map, name).cloned())
    }

    fn first(&mut self, paths: &[PathBuf; 2], name: &str) -> Result<Option<Found>, String> {
        for p in paths {
            if let Some(e) = self.entry(p, name)? {
                return Ok(Some((p.clone(), e)));
            }
        }
        Ok(None)
    }

    fn set_entry(&mut self, path: &Path, name: &str, entry: Entry) -> Result<(), String> {
        let d = self.writable(path)?;
        if !d.existed && d.map.is_empty() {
            d.map.insert(
                "$schema".to_string(),
                Value::String(MCP_SCHEMA_URL.to_string()),
            );
        }
        let new = Value::Object(entry);
        let servers = servers_map_mut(&mut d.map)?;
        if servers.get(name) != Some(&new) {
            servers.insert(name.to_string(), new);
            d.dirty = true;
        }
        Ok(())
    }

    fn remove_entry(&mut self, path: &Path, name: &str) -> Result<bool, String> {
        let lenient = self.is_lenient(path);
        let d = self.doc(path);
        if !d.existed || (d.err.is_some() && lenient) {
            return Ok(false);
        }
        let d = self.writable(path)?;
        let removed = d
            .map
            .get_mut("mcpServers")
            .and_then(|v| v.as_object_mut())
            .is_some_and(|s| s.remove(name).is_some());
        d.dirty |= removed;
        Ok(removed)
    }

    /// Rename the key keeping its position in the file.
    fn rename_entry(&mut self, path: &Path, old: &str, new: &str) -> Result<(), String> {
        let d = self.writable(path)?;
        let Some(servers) = d.map.get_mut("mcpServers").and_then(|v| v.as_object_mut()) else {
            return Ok(());
        };
        if !servers.contains_key(old) {
            return Ok(());
        }
        let rebuilt: Entry = std::mem::take(servers)
            .into_iter()
            .map(|(k, v)| {
                if k == old {
                    (new.to_string(), v)
                } else {
                    (k, v)
                }
            })
            .collect();
        *servers = rebuilt;
        d.dirty = true;
        Ok(())
    }

    /// Drop `name` from the user-level `disabledServers` / `enabledServers`.
    fn sweep_lists(&mut self, name: &str, disabled: bool, enabled: bool) -> Result<bool, String> {
        let mut changed = false;
        for p in self.user_files() {
            if !self.doc(&p).existed {
                continue;
            }
            let d = self.writable(&p)?;
            let mut c = false;
            if disabled {
                c |= remove_from_list(&mut d.map, "disabledServers", name);
            }
            if enabled {
                c |= remove_from_list(&mut d.map, "enabledServers", name);
            }
            d.dirty |= c;
            changed |= c;
        }
        Ok(changed)
    }

    fn rename_in_lists(&mut self, old: &str, new: &str) -> Result<(), String> {
        for p in self.user_files() {
            if !self.doc(&p).existed {
                continue;
            }
            let d = self.writable(&p)?;
            for key in ["disabledServers", "enabledServers"] {
                if let Some(Value::Array(items)) = d.map.get_mut(key) {
                    for item in items.iter_mut() {
                        if item.as_str() == Some(old) {
                            *item = Value::String(new.to_string());
                            d.dirty = true;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn user_list(&mut self, key: &str) -> std::collections::HashSet<String> {
        let mut out = std::collections::HashSet::new();
        for p in self.user_files() {
            let d = self.doc(&p);
            if d.err.is_none() {
                out.extend(str_list(&d.map, key));
            }
        }
        out
    }

    /// Names with at least one full definition anywhere (marker-only names are skipped).
    fn all_names(&mut self) -> std::collections::BTreeSet<String> {
        let mut out = std::collections::BTreeSet::new();
        for p in self.all_files(false) {
            let d = self.doc(&p);
            if d.err.is_some() {
                continue;
            }
            if let Some(servers) = d.map.get("mcpServers").and_then(|v| v.as_object()) {
                for (n, v) in servers {
                    if v.as_object().is_some_and(|e| !is_marker(e)) {
                        out.insert(n.clone());
                    }
                }
            }
        }
        out
    }

    fn exists_anywhere(&mut self, name: &str) -> Result<bool, String> {
        for p in self.all_files(false) {
            if self.entry(&p, name)?.is_some() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn analyze(&mut self, name: &str) -> Result<Analysis, String> {
        let user = self.user_files();
        let global = self.first(&user, name)?;
        let n = self.projects.len();
        let mut locals = Vec::with_capacity(n);
        let mut fallbacks = Vec::with_capacity(n);
        let mut on = Vec::with_capacity(n);
        for i in 0..n {
            let lp = self.local_paths(i);
            let fp = self.fallback_paths(i);
            let local = self.first(&lp, name)?;
            let fallback = self.first(&fp, name)?;
            let is_on = if let Some((_, l)) = &local {
                !is_disabled(l)
            } else if let Some((_, g)) = &global {
                !is_disabled(g)
            } else if let Some((_, f)) = &fallback {
                !is_disabled(f)
            } else {
                false
            };
            locals.push(local);
            fallbacks.push(fallback);
            on.push(is_on);
        }
        let global_on = global.as_ref().is_some_and(|(_, g)| !is_disabled(g));
        let mode = if global_on {
            McpScopeMode::All
        } else if on.iter().any(|b| *b) {
            McpScopeMode::Projects
        } else {
            McpScopeMode::Off
        };
        let mut a = Analysis {
            global,
            locals,
            fallbacks,
            on,
            mode,
            canonical: None,
        };
        let canonical = if let Some((p, g)) = a.global_full() {
            Some((p.clone(), g.clone(), true))
        } else {
            (0..n)
                .find(|&i| a.on[i] && a.copy(i).is_some())
                .or_else(|| (0..n).find(|&i| a.copy(i).is_some()))
                .and_then(|i| a.copy(i))
                .map(|(p, e)| (p.clone(), e.clone(), false))
        };
        a.canonical = canonical;
        Ok(a)
    }

    /// Make each linked worktree of project `i` hold exactly the project's
    /// effective `.omp` entry for `name` (set, or removed when absent).
    fn mirror(&mut self, i: usize, name: &str) -> Result<(), String> {
        let lp = self.local_paths(i);
        let want = self.first(&lp, name)?.map(|(_, e)| e);
        for wt in self.projects[i].worktrees.clone() {
            let a = wt.join(".omp").join("mcp.json");
            let b = wt.join(".omp").join(".mcp.json");
            match &want {
                Some(e) => self.set_entry(&a, name, e.clone())?,
                None => {
                    self.remove_entry(&a, name)?;
                }
            }
            self.remove_entry(&b, name)?;
        }
        Ok(())
    }

    fn flush(self) -> Result<(), String> {
        let mut dirty: Vec<(PathBuf, Doc)> =
            self.docs.into_iter().filter(|(_, d)| d.dirty).collect();
        dirty.sort_by(|a, b| a.0.cmp(&b.0));
        for (path, doc) in dirty {
            write_json_map(&path, &doc.map)
                .map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
        }
        Ok(())
    }
}

// ---------- catalog ----------

fn view_of(
    ws: &mut Ws,
    name: &str,
    deny: &std::collections::HashSet<String>,
) -> Result<Option<McpServerView>, String> {
    let a = ws.analyze(name)?;
    let Some((cpath, canon, is_user)) = a.canonical.clone() else {
        return Ok(None);
    };
    let n = ws.projects.len();
    let mut view = McpServerView {
        name: name.to_string(),
        mode: a.mode,
        has_global: a.global_full().is_some(),
        denylisted: deny.contains(name),
        ..Default::default()
    };
    for i in 0..n {
        let path = ws.projects[i].path.clone();
        if a.on[i] {
            view.active_projects.push(path.clone());
        } else if matches!(a.mode, McpScopeMode::All) {
            view.excluded_projects.push(path.clone());
        }
        if let Some((_, copy)) = a.copy(i) {
            view.copy_projects.push(path.clone());
            if !identical(copy, &canon) {
                view.custom_projects.push(path);
            }
        }
    }
    for p in ws.all_files(false) {
        if ws.entry(&p, name)?.is_some() {
            view.files.push(p.to_string_lossy().to_string());
        }
    }
    view.definition = item_from_entry(
        name,
        &canon,
        &cpath,
        if is_user { "user" } else { "project" },
        false,
        view.denylisted,
        false,
        !matches!(a.mode, McpScopeMode::Off) && !view.denylisted,
    );
    Ok(Some(view))
}

fn catalog_impl(agent_dir: &Path, projects: &[String]) -> Result<McpCatalog, String> {
    let mut ws = Ws::open(agent_dir, projects, true)?;
    let deny = ws.user_list("disabledServers");
    let mut servers = Vec::new();
    for name in ws.all_names() {
        if let Some(v) = view_of(&mut ws, &name, &deny)? {
            servers.push(v);
        }
    }

    let mut files = Vec::new();
    for c in candidates(agent_dir, None) {
        if c.path.is_file() || c.primary {
            files.push(file_info(&c, None).0);
        }
    }
    let mut infos = Vec::new();
    for p in &ws.projects {
        for c in candidates(agent_dir, Some(&p.dir)) {
            if c.scope == "project" && (c.path.is_file() || c.primary) {
                files.push(file_info(&c, Some(&p.path)).0);
            }
        }
        infos.push(McpProjectInfo {
            path: p.path.clone(),
            config_path: p
                .dir
                .join(".omp")
                .join("mcp.json")
                .to_string_lossy()
                .to_string(),
            worktrees: p
                .worktrees
                .iter()
                .map(|w| w.to_string_lossy().to_string())
                .collect(),
        });
    }
    Ok(McpCatalog {
        global_path: agent_dir.join("mcp.json").to_string_lossy().to_string(),
        projects: infos,
        servers,
        files,
    })
}

// ---------- mutations ----------

/// Apply `f` to an in-memory workspace over the user files + known projects and
/// flush only when it succeeded.
fn mutate<F>(agent_dir: &Path, projects: &[String], f: F) -> Result<(), String>
where
    F: FnOnce(&mut Ws) -> Result<(), String>,
{
    let mut ws = Ws::open(agent_dir, projects, false)?;
    f(&mut ws)?;
    ws.flush()
}

fn set_scope_ws(ws: &mut Ws, name: &str, scope: &McpScope) -> Result<(), String> {
    let n = ws.projects.len();
    let mut in_scope = vec![false; n];
    for p in &scope.projects {
        let i = ws
            .projects
            .iter()
            .position(|q| &q.path == p)
            .ok_or_else(|| format!("项目不在已知项目列表中：{p}"))?;
        in_scope[i] = true;
    }
    if !scope.all_projects && !in_scope.iter().any(|b| *b) {
        return Err("至少选择一个项目".to_string());
    }
    let a = ws.analyze(name)?;
    let (_, canon, _) = a.canonical.clone().ok_or_else(|| not_exist(name))?;
    let raw = without_enabled(&canon);
    // Choosing a scope means "use it": clear stale user allow/deny overrides.
    ws.sweep_lists(name, true, true)?;
    let user = ws.user_files();

    if scope.all_projects {
        match a.global_full() {
            Some((gp, g)) => ws.set_entry(gp, name, without_enabled(g))?,
            None => {
                if let Some((gp, _)) = &a.global {
                    ws.remove_entry(gp, name)?;
                }
                ws.set_entry(&user[0], name, raw.clone())?;
            }
        }
    }

    for (i, &selected) in in_scope.iter().enumerate() {
        let locals = ws.local_paths(i);
        if selected {
            if scope.all_projects {
                for lp in &locals {
                    let Some(e) = ws.entry(lp, name)? else {
                        continue;
                    };
                    if is_marker(&e) || identical(&e, &canon) {
                        ws.remove_entry(lp, name)?;
                    } else if is_disabled(&e) {
                        ws.set_entry(lp, name, without_enabled(&e))?;
                    }
                }
            } else {
                let mut kept = false;
                for lp in &locals {
                    let Some(e) = ws.entry(lp, name)? else {
                        continue;
                    };
                    if is_marker(&e) {
                        ws.remove_entry(lp, name)?;
                    } else if !kept {
                        kept = true;
                        ws.set_entry(lp, name, without_enabled(&e))?;
                    }
                }
                if !kept {
                    ws.set_entry(&locals[0], name, raw.clone())?;
                }
            }
        } else {
            for lp in &locals {
                ws.remove_entry(lp, name)?;
            }
            let fallbacks = ws.fallback_paths(i);
            if scope.all_projects || ws.first(&fallbacks, name)?.is_some() {
                ws.set_entry(&locals[0], name, marker())?;
            }
        }
        ws.mirror(i, name)?;
    }

    if !scope.all_projects {
        for up in &user {
            ws.remove_entry(up, name)?;
        }
    }
    Ok(())
}

fn set_enabled_ws(ws: &mut Ws, name: &str, enabled: bool) -> Result<(), String> {
    let a = ws.analyze(name)?;
    if a.canonical.is_none() {
        return Err(not_exist(name));
    }
    let n = ws.projects.len();
    if !enabled {
        // A stale `enabledServers` entry would force-enable the paused copies.
        ws.sweep_lists(name, false, true)?;
        match a.mode {
            McpScopeMode::All => {
                if let Some((gp, g)) = &a.global {
                    ws.set_entry(gp, name, with_enabled_false(g))?;
                }
            }
            McpScopeMode::Projects => {
                for i in (0..n).filter(|&i| a.on[i]) {
                    match &a.locals[i] {
                        Some((lp, e)) => ws.set_entry(lp, name, with_enabled_false(e))?,
                        None => {
                            let lp = ws.local_paths(i);
                            ws.set_entry(&lp[0], name, marker())?;
                        }
                    }
                    ws.mirror(i, name)?;
                }
            }
            McpScopeMode::Off => {}
        }
    } else {
        ws.sweep_lists(name, true, false)?;
        if let Some((gp, g)) = a.global_full() {
            ws.set_entry(gp, name, without_enabled(g))?;
        } else {
            for i in 0..n {
                let mut changed = false;
                for lp in ws.local_paths(i) {
                    let Some(e) = ws.entry(&lp, name)? else {
                        continue;
                    };
                    if is_marker(&e) {
                        // A pause marker over a still-defined root fallback.
                        let revive = matches!(a.mode, McpScopeMode::Off)
                            && a.fallbacks[i]
                                .as_ref()
                                .is_some_and(|(_, f)| !is_disabled(f));
                        if revive {
                            ws.remove_entry(&lp, name)?;
                            changed = true;
                        }
                    } else if is_disabled(&e) {
                        ws.set_entry(&lp, name, without_enabled(&e))?;
                        changed = true;
                    }
                }
                if changed {
                    ws.mirror(i, name)?;
                }
            }
        }
    }
    Ok(())
}

fn delete_ws(ws: &mut Ws, name: &str) -> Result<(), String> {
    let mut removed = false;
    for p in ws.all_files(true) {
        removed |= ws.remove_entry(&p, name)?;
    }
    removed |= ws.sweep_lists(name, true, true)?;
    if !removed {
        return Err(not_exist(name));
    }
    Ok(())
}

fn save_ws(
    ws: &mut Ws,
    original: Option<&str>,
    name: &str,
    patch: &Entry,
    scope: Option<&McpScope>,
) -> Result<(), String> {
    validate_server_name(name)?;
    let Some(original) = original else {
        // Create.
        if ws.exists_anywhere(name)? {
            return Err(format!("已存在同名服务器「{name}」"));
        }
        let scope = scope.ok_or_else(|| "请选择服务器的启用范围".to_string())?;
        let mut entry = Map::new();
        apply_patch(&mut entry, patch);
        if let Some(err) = validate_server_entry(name, &entry) {
            return Err(err);
        }
        // Park the definition at user level, then let set_scope place it.
        let user = ws.user_files();
        ws.set_entry(&user[0], name, entry)?;
        return set_scope_ws(ws, name, scope);
    };

    let a = ws.analyze(original)?;
    let (_, canon, _) = a.canonical.ok_or_else(|| not_exist(original))?;
    let mut patched = canon;
    apply_patch(&mut patched, patch);
    if let Some(err) = validate_server_entry(name, &patched) {
        return Err(err);
    }
    if name != original && ws.exists_anywhere(name)? {
        return Err(format!("已存在同名服务器「{name}」"));
    }

    let files = ws.all_files(true);
    for f in &files {
        let Some(e) = ws.entry(f, original)? else {
            continue;
        };
        if is_marker(&e) {
            continue;
        }
        let mut p = e;
        apply_patch(&mut p, patch);
        if let Some(err) = validate_server_entry(name, &p) {
            return Err(format!("{}：{err}", f.display()));
        }
        ws.set_entry(f, original, p)?;
    }
    if name != original {
        for f in &files {
            if ws.entry(f, original)?.is_some() {
                ws.rename_entry(f, original, name)?;
            }
        }
        ws.rename_in_lists(original, name)?;
    }
    if let Some(scope) = scope {
        set_scope_ws(ws, name, scope)?;
    }
    Ok(())
}

// ---------- commands ----------

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// `mcp_config_list` (§7 D): per-cwd effective servers (used by `/mcp` completion).
#[tauri::command]
pub async fn mcp_config_list(cwd: Option<String>) -> Result<McpConfigSnapshot, String> {
    let agent_dir = crate::paths::agent_dir();
    let cwd_path = cwd.map(PathBuf::from);
    blocking(move || Ok(build_snapshot(&agent_dir, cwd_path.as_deref()))).await
}

/// `mcp_catalog`: every server by name across user + known projects.
#[tauri::command]
pub async fn mcp_catalog(projects: Vec<String>) -> Result<McpCatalog, String> {
    let agent_dir = crate::paths::agent_dir();
    blocking(move || catalog_impl(&agent_dir, &projects)).await
}

/// `mcp_server_save`: create or edit (patch + optional rename) a server, then
/// optionally apply `scope`. `patch` semantics: see [`apply_patch`].
#[tauri::command]
pub async fn mcp_server_save(
    projects: Vec<String>,
    original_name: Option<String>,
    name: String,
    patch: Map<String, Value>,
    scope: Option<McpScope>,
) -> Result<(), String> {
    let agent_dir = crate::paths::agent_dir();
    blocking(move || {
        mutate(&agent_dir, &projects, |ws| {
            save_ws(ws, original_name.as_deref(), &name, &patch, scope.as_ref())
        })
    })
    .await
}

/// `mcp_server_set_scope`: choose where a server loads.
#[tauri::command]
pub async fn mcp_server_set_scope(
    projects: Vec<String>,
    name: String,
    scope: McpScope,
) -> Result<(), String> {
    let agent_dir = crate::paths::agent_dir();
    blocking(move || mutate(&agent_dir, &projects, |ws| set_scope_ws(ws, &name, &scope))).await
}

/// `mcp_server_set_enabled`: pause / resume without forgetting placement.
#[tauri::command]
pub async fn mcp_server_set_enabled(
    projects: Vec<String>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    let agent_dir = crate::paths::agent_dir();
    blocking(move || {
        mutate(&agent_dir, &projects, |ws| {
            set_enabled_ws(ws, &name, enabled)
        })
    })
    .await
}

/// `mcp_server_delete`: remove the name everywhere (defs, markers, mirrors, lists).
#[tauri::command]
pub async fn mcp_server_delete(projects: Vec<String>, name: String) -> Result<(), String> {
    let agent_dir = crate::paths::agent_dir();
    blocking(move || mutate(&agent_dir, &projects, |ws| delete_ws(ws, &name))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    struct Fx {
        dir: PathBuf,
        agent: PathBuf,
        projs: Vec<String>,
    }

    impl Fx {
        fn new(tag: &str, n: usize) -> Fx {
            let dir =
                std::env::temp_dir().join(format!("ompws-mcp-{}-{}", std::process::id(), tag));
            let _ = std::fs::remove_dir_all(&dir);
            let agent = dir.join("agent");
            std::fs::create_dir_all(&agent).unwrap();
            let mut projs = Vec::new();
            for i in 0..n {
                let p = dir.join(format!("p{i}"));
                std::fs::create_dir_all(&p).unwrap();
                projs.push(p.to_string_lossy().to_string());
            }
            Fx { dir, agent, projs }
        }
        fn user(&self) -> PathBuf {
            self.agent.join("mcp.json")
        }
        fn omp(&self, i: usize) -> PathBuf {
            Path::new(&self.projs[i]).join(".omp").join("mcp.json")
        }
        fn root(&self, i: usize) -> PathBuf {
            Path::new(&self.projs[i]).join("mcp.json")
        }
        fn put(&self, path: &Path, v: Value) {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, serde_json::to_string_pretty(&v).unwrap()).unwrap();
        }
        fn get(&self, path: &Path) -> Value {
            std::fs::read_to_string(path)
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or(Value::Null)
        }
        /// `mcpServers[name]` of a file (Null when absent).
        fn srv(&self, path: &Path, name: &str) -> Value {
            self.get(path)["mcpServers"][name].clone()
        }
        fn catalog(&self) -> McpCatalog {
            catalog_impl(&self.agent, &self.projs).unwrap()
        }
        fn view(&self, name: &str) -> McpServerView {
            self.catalog()
                .servers
                .into_iter()
                .find(|s| s.name == name)
                .unwrap_or_else(|| panic!("server {name} not listed"))
        }
        fn scope(&self, name: &str, all: bool, idx: &[usize]) -> Result<(), String> {
            let scope = McpScope {
                all_projects: all,
                projects: idx.iter().map(|&i| self.projs[i].clone()).collect(),
            };
            mutate(&self.agent, &self.projs, |ws| {
                set_scope_ws(ws, name, &scope)
            })
        }
        fn enable(&self, name: &str, on: bool) -> Result<(), String> {
            mutate(&self.agent, &self.projs, |ws| set_enabled_ws(ws, name, on))
        }
        fn delete(&self, name: &str) -> Result<(), String> {
            mutate(&self.agent, &self.projs, |ws| delete_ws(ws, name))
        }
        fn save(
            &self,
            original: Option<&str>,
            name: &str,
            patch: Value,
            scope: Option<(bool, &[usize])>,
        ) -> Result<(), String> {
            let scope = scope.map(|(all, idx)| McpScope {
                all_projects: all,
                projects: idx.iter().map(|&i| self.projs[i].clone()).collect(),
            });
            let patch = patch.as_object().unwrap().clone();
            mutate(&self.agent, &self.projs, |ws| {
                save_ws(ws, original, name, &patch, scope.as_ref())
            })
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn svc() -> Value {
        json!({"command": "npx", "args": ["-y", "svc"], "env": {"API_TOKEN": "sekret-value-123"}})
    }

    fn mcp(name: &str, entry: Value) -> Value {
        json!({"mcpServers": {name: entry}})
    }

    #[test]
    fn catalog_modes_markers_custom_and_hidden_marker_only_names() {
        let fx = Fx::new("catalog", 3);
        // `g`: global, excluded in p0 by a marker.
        fx.put(
            &fx.user(),
            json!({"mcpServers": {"g": svc(), "paused": {"command": "x", "enabled": false}}, "disabledServers": ["dn"]}),
        );
        fx.put(&fx.omp(0), json!({"mcpServers": {"g": {"enabled": false}}}));
        // `pr`: no global; p0 copy, p1 custom copy.
        fx.put(
            &fx.omp(0),
            json!({"mcpServers": {"g": {"enabled": false}, "pr": svc()}}),
        );
        let mut custom = svc();
        custom["args"] = json!(["other"]);
        fx.put(&fx.omp(1), mcp("pr", custom));
        // `ghost`: marker only.
        fx.put(&fx.root(2), mcp("dn", json!({"command": "d"})));
        fx.put(&fx.omp(2), mcp("ghost", json!({"enabled": false})));

        let cat = fx.catalog();
        let names: Vec<_> = cat.servers.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            ["dn", "g", "paused", "pr"],
            "marker-only `ghost` hidden"
        );

        let g = fx.view("g");
        assert_eq!(g.mode, McpScopeMode::All);
        assert!(g.has_global);
        assert_eq!(g.excluded_projects, vec![fx.projs[0].clone()]);
        assert_eq!(
            g.active_projects,
            vec![fx.projs[1].clone(), fx.projs[2].clone()]
        );
        assert!(g.definition.env[0].masked, "secrets are masked for the UI");
        assert_eq!(g.definition.scope, "user");

        let pr = fx.view("pr");
        assert_eq!(pr.mode, McpScopeMode::Projects);
        assert!(!pr.has_global);
        assert_eq!(
            pr.active_projects,
            vec![fx.projs[0].clone(), fx.projs[1].clone()]
        );
        assert_eq!(pr.copy_projects, pr.active_projects);
        assert_eq!(pr.custom_projects, vec![fx.projs[1].clone()]);
        assert_eq!(
            pr.definition.args,
            ["-y", "svc"],
            "canonical = first active copy"
        );
        assert_eq!(pr.definition.scope, "project");

        let paused = fx.view("paused");
        assert_eq!(paused.mode, McpScopeMode::Off);
        assert!(paused.active_projects.is_empty());

        let dn = fx.view("dn");
        assert!(dn.denylisted);
        assert_eq!(
            dn.mode,
            McpScopeMode::Projects,
            "root fallback is active, denylist reported separately"
        );

        // Files: user primary + project primaries; project field is verbatim.
        let p0_file = cat
            .files
            .iter()
            .find(|f| f.path == fx.omp(0).to_string_lossy())
            .unwrap();
        assert_eq!(p0_file.project.as_deref(), Some(fx.projs[0].as_str()));
        assert!(cat
            .files
            .iter()
            .any(|f| f.scope == "user" && f.project.is_none()));
        assert!(cat
            .files
            .iter()
            .any(|f| f.path == fx.omp(1).to_string_lossy() && f.exists));
    }

    #[test]
    fn set_scope_global_to_selected_projects_copies_raw_and_removes_global() {
        let fx = Fx::new("scope-g2p", 3);
        fx.put(
            &fx.user(),
            json!({"mcpServers": {"s": svc()}, "disabledServers": ["s"], "enabledServers": ["s"]}),
        );
        fx.scope("s", false, &[0, 1]).unwrap();

        let want = svc();
        assert_eq!(fx.srv(&fx.omp(0), "s"), want, "raw copy incl. secret env");
        assert_eq!(fx.srv(&fx.omp(1), "s"), want);
        assert_eq!(fx.get(&fx.omp(0))["$schema"], MCP_SCHEMA_URL);
        assert!(fx.srv(&fx.user(), "s").is_null(), "global removed");
        assert!(!fx.omp(2).exists(), "unselected project untouched");
        let user = fx.get(&fx.user());
        assert_eq!(user["disabledServers"], json!([]));
        assert_eq!(user["enabledServers"], json!([]));
        let v = fx.view("s");
        assert_eq!(v.mode, McpScopeMode::Projects);
        assert_eq!(
            v.active_projects,
            vec![fx.projs[0].clone(), fx.projs[1].clone()]
        );
    }

    #[test]
    fn set_scope_projects_to_all_with_exclusion() {
        let fx = Fx::new("scope-p2a", 3);
        let mut custom = svc();
        custom["args"] = json!(["custom"]);
        fx.put(&fx.omp(0), mcp("s", svc()));
        fx.put(&fx.omp(1), mcp("s", svc()));
        fx.put(&fx.omp(2), mcp("s", custom.clone()));
        fx.put(&fx.user(), json!({"enabledServers": ["s"]}));

        // p1 is excluded, p0 (identical) and p2 (custom) stay selected.
        fx.scope("s", true, &[0, 2]).unwrap();

        assert_eq!(
            fx.srv(&fx.user(), "s"),
            svc(),
            "global written from canonical"
        );
        assert!(fx.srv(&fx.omp(0), "s").is_null(), "identical copy removed");
        assert_eq!(fx.srv(&fx.omp(1), "s"), json!({"enabled": false}), "marker");
        assert_eq!(fx.srv(&fx.omp(2), "s"), custom, "custom copy kept");
        assert_eq!(fx.get(&fx.user())["enabledServers"], json!([]));

        let v = fx.view("s");
        assert_eq!(v.mode, McpScopeMode::All);
        assert_eq!(v.excluded_projects, vec![fx.projs[1].clone()]);
        assert_eq!(v.custom_projects, vec![fx.projs[2].clone()]);
        assert_eq!(
            v.active_projects,
            vec![fx.projs[0].clone(), fx.projs[2].clone()]
        );
    }

    #[test]
    fn set_scope_rejects_bad_input_and_writes_nothing() {
        let fx = Fx::new("scope-bad", 2);
        fx.put(&fx.user(), mcp("s", svc()));
        let before = std::fs::read(fx.user()).unwrap();

        let err = fx.scope("s", false, &[]).unwrap_err();
        assert!(err.contains("至少选择一个项目"), "{err}");
        let stranger = McpScope {
            all_projects: false,
            projects: vec!["/not/known".into()],
        };
        assert!(mutate(&fx.agent, &fx.projs, |ws| set_scope_ws(ws, "s", &stranger)).is_err());
        assert!(fx.scope("nope", true, &[]).unwrap_err().contains("不存在"));
        assert_eq!(std::fs::read(fx.user()).unwrap(), before);
        assert!(!fx.omp(0).exists() && !fx.omp(1).exists());

        // Project paths must be absolute; folders that no longer exist are skipped.
        assert!(Ws::open(&fx.agent, &["relative/dir".to_string()], true).is_err());
        let missing = fx.dir.join("missing").to_string_lossy().to_string();
        let ws = Ws::open(&fx.agent, &[missing, fx.projs[0].clone()], true).unwrap();
        assert_eq!(
            ws.projects
                .iter()
                .map(|p| p.path.clone())
                .collect::<Vec<_>>(),
            vec![fx.projs[0].clone()]
        );

        // A broken file that must be touched blocks the whole operation.
        std::fs::create_dir_all(fx.omp(0).parent().unwrap()).unwrap();
        std::fs::write(fx.omp(0), "{ not json").unwrap();
        let err = fx.scope("s", false, &[0]).unwrap_err();
        assert!(err.contains("mcp.json"), "names the file: {err}");
        assert_eq!(std::fs::read(fx.user()).unwrap(), before);
    }

    #[test]
    fn save_create_collision_and_projects_mode() {
        let fx = Fx::new("save-create", 2);
        fx.put(&fx.user(), mcp("g", svc()));
        fx.put(&fx.omp(0), mcp("held", json!({"enabled": false})));

        let patch = json!({"command": "uvx", "args": ["tool"], "env": {"K": "v", "DROP": null}});
        let err = fx
            .save(None, "g", patch.clone(), Some((true, &[])))
            .unwrap_err();
        assert_eq!(err, "已存在同名服务器「g」");
        assert!(
            fx.save(None, "held", patch.clone(), Some((true, &[])))
                .is_err(),
            "markers claim names"
        );
        assert!(
            fx.save(None, "new", patch.clone(), None).is_err(),
            "scope required"
        );
        assert!(
            fx.save(None, "new", json!({"args": ["x"]}), Some((true, &[])))
                .is_err(),
            "invalid entry"
        );
        assert!(fx.srv(&fx.user(), "new").is_null());

        fx.save(None, "new", patch, Some((false, &[1]))).unwrap();
        assert_eq!(
            fx.srv(&fx.omp(1), "new"),
            json!({"command": "uvx", "args": ["tool"], "env": {"K": "v"}})
        );
        assert!(
            fx.srv(&fx.user(), "new").is_null(),
            "projects mode leaves no global"
        );
        assert!(fx.srv(&fx.omp(0), "new").is_null());
        let v = fx.view("new");
        assert_eq!(v.mode, McpScopeMode::Projects);
        assert_eq!(v.active_projects, vec![fx.projs[1].clone()]);

        // Global create.
        fx.save(
            None,
            "glob",
            json!({"url": "https://x.test/mcp", "type": "http"}),
            Some((true, &[0])),
        )
        .unwrap();
        assert!(!fx.srv(&fx.user(), "glob").is_null());
        assert_eq!(fx.srv(&fx.omp(1), "glob"), json!({"enabled": false}));
        assert_eq!(fx.get(&fx.omp(1))["$schema"], MCP_SCHEMA_URL);
    }

    #[test]
    fn save_edit_propagates_patch_to_every_copy_keeping_secrets() {
        let fx = Fx::new("save-edit", 3);
        let mut a = svc();
        a["env"] = json!({"API_TOKEN": "secret-A-0000000"});
        let mut b = svc();
        b["env"] = json!({"API_TOKEN": "secret-B-1111111"});
        b["unknownField"] = json!({"keep": true});
        fx.put(&fx.omp(0), mcp("s", a));
        fx.put(&fx.omp(1), mcp("s", b));
        fx.put(&fx.root(2), mcp("s", svc()));

        fx.save(
            Some("s"),
            "s",
            json!({"args": ["-y", "svc@2"], "env": {"EXTRA": "1"}, "timeout": 5000}),
            None,
        )
        .unwrap();

        for (i, token) in [(0, "secret-A-0000000"), (1, "secret-B-1111111")] {
            let e = fx.srv(&fx.omp(i), "s");
            assert_eq!(e["args"], json!(["-y", "svc@2"]));
            assert_eq!(e["env"]["API_TOKEN"], token, "per-copy secret kept");
            assert_eq!(e["env"]["EXTRA"], "1");
            assert_eq!(e["timeout"], 5000);
        }
        assert_eq!(
            fx.srv(&fx.omp(1), "s")["unknownField"],
            json!({"keep": true})
        );
        assert_eq!(fx.srv(&fx.root(2), "s")["args"], json!(["-y", "svc@2"]));

        // Patch that invalidates the entry is rejected before anything is written.
        let before = std::fs::read(fx.omp(0)).unwrap();
        assert!(fx
            .save(Some("s"), "s", json!({"command": null}), None)
            .is_err());
        assert_eq!(std::fs::read(fx.omp(0)).unwrap(), before);
        assert!(fx
            .save(Some("missing"), "missing", json!({"command": "x"}), None)
            .is_err());
    }

    #[test]
    fn apply_patch_without_existing_env_drops_null_values() {
        let mut e = Map::new();
        e.insert("command".into(), json!("x"));
        apply_patch(
            &mut e,
            json!({"env": {"A": "1", "B": null}, "headers": {"H": null}})
                .as_object()
                .unwrap(),
        );
        assert_eq!(e["env"], json!({"A": "1"}));
        assert_eq!(e["headers"], json!({}));
    }

    #[test]
    fn save_rename_updates_every_file_and_lists() {
        let fx = Fx::new("save-rename", 2);
        fx.put(
            &fx.user(),
            json!({"mcpServers": {"other": svc(), "old": svc()}, "disabledServers": ["old"], "enabledServers": ["old", "other"]}),
        );
        fx.put(
            &fx.omp(0),
            json!({"mcpServers": {"old": {"enabled": false}}}),
        );
        let mut custom = svc();
        custom["args"] = json!(["c"]);
        fx.put(&fx.omp(1), mcp("old", custom));
        fx.put(&fx.root(1), mcp("old", svc()));

        assert!(
            fx.save(Some("old"), "other", json!({}), None).is_err(),
            "target name taken"
        );
        fx.save(Some("old"), "new", json!({}), None).unwrap();

        for p in [fx.user(), fx.omp(0), fx.omp(1), fx.root(1)] {
            assert!(fx.srv(&p, "old").is_null(), "{p:?}");
            assert!(!fx.srv(&p, "new").is_null(), "{p:?}");
        }
        assert_eq!(fx.srv(&fx.omp(0), "new"), json!({"enabled": false}));
        assert_eq!(fx.srv(&fx.omp(1), "new")["args"], json!(["c"]));
        let user = fx.get(&fx.user());
        assert_eq!(user["disabledServers"], json!(["new"]));
        assert_eq!(user["enabledServers"], json!(["new", "other"]));
        let keys: Vec<_> = user["mcpServers"].as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 2);
    }

    #[test]
    fn pause_and_resume_in_all_mode_keeps_placement() {
        let fx = Fx::new("pause-all", 2);
        fx.put(
            &fx.user(),
            json!({"mcpServers": {"s": svc()}, "enabledServers": ["s"]}),
        );
        fx.put(&fx.omp(0), mcp("s", json!({"enabled": false})));

        fx.enable("s", false).unwrap();
        assert_eq!(fx.srv(&fx.user(), "s")["enabled"], false);
        assert_eq!(fx.get(&fx.user())["enabledServers"], json!([]));
        let v = fx.view("s");
        assert_eq!(v.mode, McpScopeMode::Off);
        assert!(v.has_global);
        assert_eq!(
            fx.srv(&fx.omp(0), "s"),
            json!({"enabled": false}),
            "marker kept"
        );

        fx.enable("s", true).unwrap();
        assert!(fx.srv(&fx.user(), "s").get("enabled").is_none());
        let v = fx.view("s");
        assert_eq!(v.mode, McpScopeMode::All);
        assert_eq!(v.excluded_projects, vec![fx.projs[0].clone()]);
        assert!(fx.enable("nope", true).is_err());
    }

    #[test]
    fn pause_and_resume_in_projects_mode_keeps_placement() {
        let fx = Fx::new("pause-proj", 3);
        fx.put(&fx.omp(0), mcp("s", svc()));
        fx.put(&fx.root(1), mcp("s", svc())); // active only via the shared root file

        fx.enable("s", false).unwrap();
        assert_eq!(fx.srv(&fx.omp(0), "s")["enabled"], false);
        assert_eq!(
            fx.srv(&fx.omp(1), "s"),
            json!({"enabled": false}),
            "marker over root file"
        );
        assert!(
            fx.srv(&fx.root(1), "s").get("enabled").is_none(),
            "root file untouched"
        );
        assert!(!fx.omp(2).exists());
        let v = fx.view("s");
        assert_eq!(v.mode, McpScopeMode::Off);
        assert_eq!(v.copy_projects.len(), 2, "placement remembered");

        fx.enable("s", true).unwrap();
        assert!(fx.srv(&fx.omp(0), "s").get("enabled").is_none());
        assert!(fx.srv(&fx.omp(1), "s").is_null(), "pause marker removed");
        let v = fx.view("s");
        assert_eq!(v.mode, McpScopeMode::Projects);
        assert_eq!(
            v.active_projects,
            vec![fx.projs[0].clone(), fx.projs[1].clone()]
        );
    }

    #[test]
    fn delete_removes_everywhere() {
        let fx = Fx::new("delete", 2);
        fx.put(
            &fx.user(),
            json!({"mcpServers": {"s": svc(), "keep": svc()}, "disabledServers": ["s"]}),
        );
        fx.put(&fx.omp(0), mcp("s", json!({"enabled": false})));
        fx.put(&fx.omp(1), mcp("s", svc()));
        fx.put(&fx.root(1), mcp("s", svc()));

        fx.delete("s").unwrap();
        for p in [fx.user(), fx.omp(0), fx.omp(1), fx.root(1)] {
            assert!(fx.srv(&p, "s").is_null(), "{p:?}");
        }
        assert!(!fx.srv(&fx.user(), "keep").is_null());
        assert_eq!(fx.get(&fx.user())["disabledServers"], json!([]));
        assert_eq!(fx.delete("s").unwrap_err(), "服务器「s」不存在");
    }

    fn git(dir: &Path, args: &[&str]) {
        crate::git::cmd::git_ok(dir, args).unwrap();
    }

    #[test]
    fn worktree_mirror_follows_project_entry() {
        let fx = Fx::new("mirror", 2);
        let repo = PathBuf::from(&fx.projs[0]);
        git(&repo, &["init", "-q"]);
        git(
            &repo,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "--allow-empty",
                "-q",
                "-m",
                "i",
            ],
        );
        let wt = repo.join(".worktrees").join("w1");
        git(
            &repo,
            &["worktree", "add", "-q", "-b", "w1", &wt.to_string_lossy()],
        );

        let cat = fx.catalog();
        assert_eq!(cat.projects[0].worktrees.len(), 1);
        assert!(Path::new(&cat.projects[0].worktrees[0]).ends_with("w1"));
        assert!(cat.projects[1].worktrees.is_empty());

        fx.put(&fx.user(), mcp("s", svc()));
        fx.scope("s", false, &[0]).unwrap();
        let wt_file = wt.join(".omp").join("mcp.json");
        assert_eq!(
            fx.srv(&wt_file, "s"),
            svc(),
            "copy mirrored into the worktree"
        );

        // Moving the server to another project removes it from the mirror.
        fx.scope("s", false, &[1]).unwrap();
        assert!(fx.srv(&fx.omp(0), "s").is_null());
        assert!(fx.srv(&wt_file, "s").is_null());

        // Excluding the main project in all-mode mirrors the marker.
        fx.scope("s", true, &[1]).unwrap();
        assert_eq!(fx.srv(&wt_file, "s"), json!({"enabled": false}));

        fx.delete("s").unwrap();
        assert!(fx.srv(&wt_file, "s").is_null());
    }

    #[test]
    fn config_list_treats_markers_as_claims_not_servers() {
        let fx = Fx::new("cfg-list", 1);
        fx.put(&fx.user(), mcp("g", svc()));
        fx.put(&fx.omp(0), json!({"mcpServers": {"g": {"enabled": false}}}));
        let cwd = PathBuf::from(&fx.projs[0]);
        let snap = build_snapshot(&fx.agent, Some(&cwd));
        assert_eq!(snap.servers.len(), 1, "marker is not listed");
        let g = &snap.servers[0];
        assert!(g.shadowed && !g.enabled);
        assert_eq!(g.scope, "user");
        let proj_file = snap.files.iter().find(|f| f.scope == "project").unwrap();
        assert_eq!(proj_file.project.as_deref(), Some(fx.projs[0].as_str()));
        assert!(snap
            .files
            .iter()
            .filter(|f| f.scope == "user")
            .all(|f| f.project.is_none()));
    }

    #[test]
    fn snapshot_masks_secrets_and_marks_shadowed() {
        let fx = Fx::new("snap", 1);
        fx.put(
            &fx.user(),
            mcp(
                "svc",
                json!({
                    "command": "npx",
                    "env": {
                        "API_TOKEN": "API_TOKEN",
                        "PASSWORD": "hunter2-hunter2",
                        "OTHER": "${OTHER_VAR}"
                    },
                    "headers": {"Authorization": "Bearer abcdefghijklmnop"}
                }),
            ),
        );
        // A project file shadows the user entry of the same name.
        fx.put(&fx.omp(0), mcp("svc", json!({"command": "deno"})));

        let cwd = PathBuf::from(&fx.projs[0]);
        let snap = build_snapshot(&fx.agent, Some(&cwd));
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
        let raw = std::fs::read_to_string(fx.user()).unwrap();
        assert!(raw.contains("hunter2-hunter2"));
    }

    #[test]
    fn name_validation() {
        for bad in ["", "a b", "a/b", "..", "x".repeat(101).as_str()] {
            assert!(validate_server_name(bad).is_err(), "should reject: {bad}");
        }
        for ok in ["fs", "a.b-c_d:e", &"x".repeat(100)] {
            assert!(validate_server_name(ok).is_ok(), "should accept: {ok}");
        }
    }
}
