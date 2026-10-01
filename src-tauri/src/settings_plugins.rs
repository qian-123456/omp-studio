//! [D] Installed-plugin listing and enable/disable for the Settings UI.
//!
//! Mirrors omp's plugin-manager on-disk model
//! (docs `plugin-manager-installer-plumbing`):
//!
//! - user root: `~/.omp/plugins` (or `$XDG_DATA_HOME/omp/plugins` when the XDG
//!   root exists)
//! - project root: `<anchor>/.omp/plugins` where `<anchor>` is the nearest
//!   ancestor of cwd containing `.omp/` or `.git/`
//!
//! Plugins are discovered from each root's `package.json` dependencies plus
//! `omp-plugins.lock.json` entries (npm installs and `plugin link` symlinks)
//! and `installed_plugins.json` (marketplace installs). Enable/disable writes
//! `plugins.<name>.enabled` in that scope's lockfile, preserving every other
//! field. Writes are atomic (tmp + rename).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginItem {
    pub name: String,
    /// npm dependency spec as declared in the root's package.json.
    pub spec: Option<String>,
    pub version: Option<String>,
    /// One-line description from package.json when present.
    pub description: Option<String>,
    /// Whether the package declares an `omp`/`pi` manifest (runtime loads it).
    pub has_manifest: bool,
    /// `npm` | `link` | `marketplace` | `unknown`.
    pub kind: String,
    /// `user` | `project`.
    pub scope: String,
    /// Effective enablement: lockfile `enabled` AND not project-disabled.
    pub enabled: bool,
    /// Project `plugin-overrides.json` lists the plugin in `disabled`.
    pub project_disabled: bool,
    /// Feature set chosen at install time; null means "default features".
    pub enabled_features: Option<Vec<String>>,
    pub dir: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRootInfo {
    pub dir: String,
    pub scope: String,
    pub lock_path: String,
    pub lock_exists: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalog {
    pub roots: Vec<PluginRootInfo>,
    pub plugins: Vec<PluginItem>,
}

// ---------- path resolution ----------

/// `~/.omp/plugins`, honoring `$XDG_DATA_HOME/omp/plugins` once created (same
/// rule omp uses after `omp config init-xdg`).
fn user_plugins_root() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.trim().is_empty() {
            let p = PathBuf::from(xdg).join("omp").join("plugins");
            if p.exists() {
                return p;
            }
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".omp")
        .join("plugins")
}

/// Nearest ancestor of `cwd` containing `.omp/` or `.git/` (the omp project
/// anchor rule). Returns the anchor's `.omp/plugins` dir when present.
fn project_plugins_root(cwd: &Path) -> Option<PathBuf> {
    let mut cur = Some(cwd);
    while let Some(dir) = cur {
        if dir.join(".omp").is_dir() || dir.join(".git").exists() {
            let plugins = dir.join(".omp").join("plugins");
            return Some(plugins);
        }
        cur = dir.parent();
    }
    None
}

// ---------- json io ----------

fn read_json(path: &Path) -> Result<Value, String> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 {} 失败: {e}", path.display()))
}

fn read_json_or_empty(path: &Path) -> Value {
    read_json(path).unwrap_or(Value::Null)
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录 {} 失败: {e}", parent.display()))?;
    }
    let mut text = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {e}"))?;
    text.push('\n');
    let name = path
        .file_name()
        .ok_or_else(|| "无效的锁文件路径".to_string())?
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

// ---------- scanning ----------

struct RawRoot {
    dir: PathBuf,
    scope: &'static str,
    lock: Map<String, Value>,
    deps: HashMap<String, String>,
    marketplace_names: HashMap<String, Option<String>>,
    project_disabled: HashSet<String>,
}

fn string_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn features_of(v: Option<&Value>) -> Option<Vec<String>> {
    match v {
        None => None,
        Some(Value::Null) => None,
        Some(a) => Some(string_list(a)),
    }
}

/// Tolerantly read marketplace install names out of `installed_plugins.json`
/// (accepts `{plugins:[{name}]}`/`{installed:[…]}` or a `{name: meta}` map).
fn marketplace_installs(v: &Value) -> HashMap<String, Option<String>> {
    let mut out = HashMap::new();
    if let Some(arr) = v
        .get("plugins")
        .or_else(|| v.get("installed"))
        .and_then(|x| x.as_array())
        .or_else(|| v.as_array())
    {
        for item in arr {
            if let Some(name) = item.get("name").and_then(|x| x.as_str()) {
                out.insert(
                    name.to_string(),
                    item.get("version")
                        .and_then(|x| x.as_str())
                        .map(String::from),
                );
            }
        }
    } else if let Some(obj) = v.as_object() {
        for (name, meta) in obj {
            if name == "version" {
                continue;
            }
            out.insert(
                name.clone(),
                meta.get("version")
                    .and_then(|x| x.as_str())
                    .map(String::from),
            );
        }
    }
    out
}

fn scan_root(dir: PathBuf, scope: &'static str, project_override_path: Option<PathBuf>) -> RawRoot {
    let deps = read_json_or_empty(&dir.join("package.json"))
        .get("dependencies")
        .and_then(|d| d.as_object())
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();

    let lock = match std::fs::read_to_string(dir.join("omp-plugins.lock.json")) {
        Ok(text) => serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default(),
        Err(_) => Map::new(),
    };

    let marketplace_names =
        marketplace_installs(&read_json_or_empty(&dir.join("installed_plugins.json")));

    let mut project_disabled = HashSet::new();
    if let Some(p) = project_override_path {
        let overrides = read_json_or_empty(&p);
        for name in string_list(overrides.get("disabled").unwrap_or(&Value::Null)) {
            project_disabled.insert(name);
        }
    }

    RawRoot {
        dir,
        scope,
        lock,
        deps,
        marketplace_names,
        project_disabled,
    }
}

fn lock_plugins(root: &RawRoot) -> Option<&Map<String, Value>> {
    root.lock.get("plugins").and_then(|v| v.as_object())
}

fn read_pkg_meta(dir: &Path) -> (Option<String>, Option<String>, bool) {
    let Ok(v) = read_json(&dir.join("package.json")) else {
        return (None, None, false);
    };
    (
        v.get("version").and_then(|x| x.as_str()).map(String::from),
        v.get("description")
            .and_then(|x| x.as_str())
            .map(String::from),
        v.get("omp").is_some() || v.get("pi").is_some(),
    )
}

fn scan_plugins(user_root: &Path, cwd: Option<&Path>) -> PluginCatalog {
    let mut roots = Vec::new();
    let mut plugins: Vec<PluginItem> = Vec::new();
    // name seen at user level (project entries shadow, not duplicate)
    let mut seen: HashMap<String, usize> = HashMap::new();

    let project_override = cwd.map(|c| c.join(".omp").join("plugin-overrides.json"));
    let mut raws = vec![scan_root(
        user_root.to_path_buf(),
        "user",
        project_override.clone(),
    )];
    if let Some(cwd) = cwd {
        if let Some(dir) = project_plugins_root(cwd) {
            // The anchor's own `.omp/plugin-overrides.json` also masks
            // project-root plugins.
            let override_path = dir
                .parent()
                .map(|p| p.join("plugin-overrides.json"))
                .or_else(|| project_override.clone());
            raws.push(scan_root(dir, "project", override_path));
        }
    }

    for root in &raws {
        roots.push(PluginRootInfo {
            dir: root.dir.to_string_lossy().to_string(),
            scope: root.scope.to_string(),
            lock_path: root
                .dir
                .join("omp-plugins.lock.json")
                .to_string_lossy()
                .to_string(),
            lock_exists: root.dir.join("omp-plugins.lock.json").is_file(),
        });

        // Union of: package.json deps (npm), lock entries (deps + links +
        // marketplace), installed_plugins.json (marketplace).
        let mut names: HashMap<String, String> = HashMap::new(); // name -> kind
        for name in root.deps.keys() {
            names.insert(name.clone(), "npm".to_string());
        }
        for name in lock_plugins(root).map(|m| m.keys()).into_iter().flatten() {
            names.entry(name.clone()).or_insert_with(|| "link".into());
        }
        for name in root.marketplace_names.keys() {
            names.insert(name.clone(), "marketplace".to_string());
        }

        for name in names.keys() {
            let node_dir = root.dir.join("node_modules").join(name);
            let (pkg_version, description, has_manifest) = read_pkg_meta(&node_dir);
            let lock_entry = lock_plugins(root).and_then(|m| m.get(name));
            let lock_enabled = lock_entry
                .and_then(|e| e.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let project_disabled = root.project_disabled.contains(name);
            let enabled = lock_enabled && !project_disabled;
            let version = lock_entry
                .and_then(|e| e.get("version"))
                .and_then(|v| v.as_str())
                .map(String::from)
                .or_else(|| root.marketplace_names.get(name).and_then(|v| v.clone()))
                .or(pkg_version);
            let kind = if names[name] == "link" && !node_dir.is_symlink() {
                // Lock entry without a dependency and without a symlink is stale;
                // still listed so the user sees leftover state.
                "unknown".to_string()
            } else {
                names[name].clone()
            };

            let item = PluginItem {
                name: name.clone(),
                spec: root.deps.get(name).cloned(),
                version,
                description,
                has_manifest,
                kind,
                scope: root.scope.to_string(),
                enabled,
                project_disabled,
                enabled_features: lock_entry
                    .map(|e| features_of(e.get("enabledFeatures")))
                    .unwrap_or(None),
                dir: node_dir
                    .exists()
                    .then(|| node_dir.to_string_lossy().to_string()),
            };

            if let Some(&idx) = seen.get(name) {
                // Enabled project install shadows the same-named user install.
                if root.scope == "project" && enabled {
                    plugins[idx] = item;
                }
            } else {
                seen.insert(name.clone(), plugins.len());
                plugins.push(item);
            }
        }
    }

    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    PluginCatalog { roots, plugins }
}

/// npm package names: `[@scope/]name` from `a-z0-9._-~`, max 214 chars.
fn validate_plugin_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.chars().count() > 214 {
        return Err("插件名称需为 1-214 个字符".to_string());
    }
    let body = name.strip_prefix('@').unwrap_or(name);
    let mut parts = body.split('/');
    if name.starts_with('@') && parts.next().map(str::is_empty) != Some(false) {
        return Err("插件名称的 scope 不能为空".to_string());
    }
    for part in parts {
        if part.is_empty()
            || !part.chars().all(|c| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-' | '~')
            })
        {
            return Err(format!("非法插件名称 \"{name}\""));
        }
    }
    Ok(())
}

/// Lockfile path for `scope`: user always the user root; project resolves the
/// anchor's `.omp/plugins` and must already hold the plugin.
fn lock_path_for(scope: &str, user_root: &Path, cwd: Option<&Path>) -> Result<PathBuf, String> {
    match scope {
        "user" => Ok(user_root.join("omp-plugins.lock.json")),
        "project" => cwd
            .and_then(project_plugins_root)
            .map(|d| d.join("omp-plugins.lock.json"))
            .ok_or_else(|| "当前项目没有插件目录".to_string()),
        _ => Err("未知作用域".to_string()),
    }
}

fn set_enabled_impl(
    user_root: &Path,
    cwd: Option<&Path>,
    name: &str,
    enabled: bool,
) -> Result<(), String> {
    // The plugin's scope follows where it is defined; user scope wins when the
    // same name exists in both (project toggle goes to the project root).
    let catalog = scan_plugins(user_root, cwd);
    let item = catalog
        .plugins
        .iter()
        .find(|p| p.name == name)
        .ok_or_else(|| format!("插件 \"{name}\" 未安装"))?;
    let lock_path = lock_path_for(&item.scope, user_root, cwd)?;

    let mut root_map = match std::fs::read_to_string(&lock_path) {
        Ok(text) => serde_json::from_str::<Value>(&text)
            .map_err(|e| format!("解析 {} 失败: {e}", lock_path.display()))?
            .as_object()
            .cloned()
            .ok_or_else(|| "锁文件顶层必须是对象".to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(e) => return Err(format!("读取 {} 失败: {e}", lock_path.display())),
    };
    if !matches!(root_map.get("plugins"), Some(Value::Object(_))) {
        root_map.insert("plugins".to_string(), Value::Object(Map::new()));
    }
    let plugins = root_map
        .get_mut("plugins")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| "锁文件 plugins 字段不可用".to_string())?;
    let entry = match plugins.get_mut(name).and_then(|v| v.as_object_mut()) {
        Some(e) => e,
        None => {
            plugins.insert(name.to_string(), Value::Object(Map::new()));
            plugins
                .get_mut(name)
                .and_then(|v| v.as_object_mut())
                .ok_or_else(|| "无法创建锁文件条目".to_string())?
        }
    };
    entry.insert("enabled".to_string(), Value::Bool(enabled));
    write_json_atomic(&lock_path, &Value::Object(root_map))
}

// ---------- commands ----------

/// `plugins_list` (§7 D): installed npm/link/marketplace plugins + root paths.
#[tauri::command]
pub async fn plugins_list(cwd: Option<String>) -> Result<PluginCatalog, String> {
    let user_root = user_plugins_root();
    let cwd_path = cwd.map(PathBuf::from);
    Ok(scan_plugins(&user_root, cwd_path.as_deref()))
}

/// `plugin_set_enabled` (§7 D): toggle `plugins.<name>.enabled` in the scope's
/// `omp-plugins.lock.json`, preserving all other fields.
#[tauri::command]
pub async fn plugin_set_enabled(
    cwd: Option<String>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    validate_plugin_name(&name)?;
    let user_root = user_plugins_root();
    let cwd_path = cwd.as_deref().map(Path::new);
    set_enabled_impl(&user_root, cwd_path, &name, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ompws-plugins-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn lists_npm_and_lock_only_plugins() {
        let dir = temp_dir("list");
        let user = dir.join("plugins");
        write(
            &user.join("package.json"),
            r#"{"name":"omp-plugins","dependencies":{"acme-tools":"^1.2.3"}}"#,
        );
        write(
            &user.join("omp-plugins.lock.json"),
            r#"{"plugins":{"acme-tools":{"version":"1.2.3","enabled":true},
"local-dev":{"enabled":false,"enabledFeatures":["a"]},"ghost":{"version":"0.1"}},"settings":{"acme-tools":{"k":"v"}}}"#,
        );
        write(
            &user.join("node_modules/acme-tools/package.json"),
            r#"{"name":"acme-tools","version":"1.2.3","description":"Tools","omp":{"extensions":["./x.ts"]}}"#,
        );

        let cat = scan_plugins(&user, None);
        assert_eq!(cat.roots.len(), 1);
        assert_eq!(cat.plugins.len(), 3);
        let acme = &cat.plugins.iter().find(|p| p.name == "acme-tools").unwrap();
        assert!(acme.enabled && acme.has_manifest && acme.kind == "npm");
        assert_eq!(acme.spec.as_deref(), Some("^1.2.3"));
        assert_eq!(acme.version.as_deref(), Some("1.2.3"));
        assert_eq!(acme.description.as_deref(), Some("Tools"));
        let dev = &cat.plugins.iter().find(|p| p.name == "local-dev").unwrap();
        assert!(!dev.enabled);
        assert_eq!(
            dev.enabled_features.as_deref(),
            Some(&["a".to_string()][..])
        );
        let ghost = &cat.plugins.iter().find(|p| p.name == "ghost").unwrap();
        assert_eq!(ghost.kind, "unknown"); // lock entry w/o dep or symlink

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_shadows_user_and_overrides_disable() {
        let dir = temp_dir("shadow");
        let user = dir.join("plugins");
        let proj = dir.join("proj");
        write(
            &user.join("omp-plugins.lock.json"),
            r#"{"plugins":{"p":{"enabled":true},"shadow-me":{"enabled":true}}}"#,
        );
        write(
            &proj.join(".omp").join("plugins/omp-plugins.lock.json"),
            r#"{"plugins":{"p":{"enabled":true},"shadow-me":{"enabled":true}}}"#,
        );
        write(
            &proj.join(".omp").join("plugin-overrides.json"),
            r#"{"disabled":["p"]}"#,
        );
        std::fs::create_dir_all(proj.join(".git")).unwrap();

        let cat = scan_plugins(&user, Some(&proj));
        // `p` is project-disabled → the project install does NOT shadow; the
        // surviving entry is the user one, marked project_disabled.
        let p = cat.plugins.iter().find(|p| p.name == "p").unwrap();
        assert_eq!(p.scope, "user");
        assert!(!p.enabled && p.project_disabled);
        // `shadow-me` is enabled at project scope → it shadows the user entry.
        let shadowed = cat.plugins.iter().find(|p| p.name == "shadow-me").unwrap();
        assert_eq!(shadowed.scope, "project");
        assert!(shadowed.enabled);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_enabled_writes_lockfile_preserving_fields() {
        let dir = temp_dir("toggle");
        let user = dir.join("plugins");
        write(
            &user.join("package.json"),
            r#"{"dependencies":{"acme":"^1"}}"#,
        );
        write(
            &user.join("omp-plugins.lock.json"),
            r#"{"plugins":{"acme":{"version":"1.0.0","enabled":true,"enabledFeatures":null}},"settings":{"acme":{"color":"red"}}}"#,
        );

        set_enabled_impl(&user, None, "acme", false).unwrap();

        let lock = read_json(&user.join("omp-plugins.lock.json")).unwrap();
        assert_eq!(lock["plugins"]["acme"]["enabled"], false);
        // Other fields untouched.
        assert_eq!(lock["plugins"]["acme"]["version"], "1.0.0");
        assert!(lock["plugins"]["acme"]["enabledFeatures"].is_null());
        assert_eq!(lock["settings"]["acme"]["color"], "red");

        set_enabled_impl(&user, None, "acme", true).unwrap();
        let lock = read_json(&user.join("omp-plugins.lock.json")).unwrap();
        assert_eq!(lock["plugins"]["acme"]["enabled"], true);

        assert!(set_enabled_impl(&user, None, "missing", true).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn marketplace_entries_listed() {
        let dir = temp_dir("market");
        let user = dir.join("plugins");
        write(
            &user.join("installed_plugins.json"),
            r#"{"version":2,"plugins":[{"name":"cloudflare","marketplace":"awesome","version":"2.0"}]}"#,
        );
        write(
            &user.join("omp-plugins.lock.json"),
            r#"{"plugins":{"cloudflare":{"enabled":false}}}"#,
        );

        let cat = scan_plugins(&user, None);
        let cf = cat.plugins.iter().find(|p| p.name == "cloudflare").unwrap();
        assert_eq!(cf.kind, "marketplace");
        assert!(!cf.enabled);
        assert_eq!(cf.version.as_deref(), Some("2.0"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn name_validation() {
        for ok in ["acme", "@scope/pkg", "a.b-c_d~e"] {
            assert!(validate_plugin_name(ok).is_ok(), "accept {ok}");
        }
        for bad in ["", "a b", "a;b", "a//b", "@/x", "@scope/"] {
            assert!(validate_plugin_name(bad).is_err(), "reject {bad}");
        }
    }
}
