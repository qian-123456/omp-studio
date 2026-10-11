//! [D] Agent discovery for the model-role bridge. Mirrors omp `task/discovery.ts`.
//!
//! Precedence, highest first; the first definition of a name wins:
//!   1. project `.omp/agents`, from the nearest ancestor of the project directory
//!   2. user `<agent_dir>/agents`
//!   3. extension package roots, when `omp-plugins` is enabled: the configured `extensions` entries,
//!      then enabled npm and linked packages from `settings_plugins::scan_plugins`, user packages
//!      before project packages, each group ordered by name
//!   4. Claude marketplace plugins, when `claude-plugins` is enabled: project-scope roots before
//!      user-scope roots, drawn from Claude's registry, omp's registry, and the project registry
//!   5. built-in agents
//!
//! Config is read narrowly. From the user and project config, only `extensions`, `enabledProviders`,
//! and `disabledProviders`; from Claude's settings files, only the boolean `enabledPlugins` flags.
//! Every other key is skipped while parsing and never kept. These values only choose which roots are
//! active. They are never returned, logged, or written.
//!
//! Gates, as omp applies them: disabling `omp-plugins` drops the whole extension lane, and disabling
//! `claude-plugins` drops the marketplace lane. User-level Claude roots need opt-in. Those of
//! `claude-plugins` open on `enabledProviders` naming `claude-plugins`, `claude`, `*`, or `all`; those
//! of `claude` open on `enabledProviders` naming `claude`, `*`, or `all`, or when `CLAUDE_CONFIG_DIR`
//! is set. A relative `extensions` entry resolves against the project directory, so without one it is
//! skipped. CLI-only roots (`--extension`, `--plugin-dir`) do not exist in this process.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde::de::{Deserializer, IgnoredAny, MapAccess, Visitor};
use serde::Deserialize;
use serde_json::{Map as JsonMap, Value as JsonValue};
use serde_yaml_ng::Value as YamlValue;

use super::AgentSource;
use crate::settings_plugins::PluginItem;

const AGENT_PLUGIN_MANIFEST_SCHEMA: &str =
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const BUILTIN_ORIGIN: &str = "内置代理";

/// Built-in agents: omp `EMBEDDED_AGENT_DEFS`, as name and declared `model:` selectors. Mirrors the
/// frontmatter of `prompts/agents/{scout,reviewer,security-reviewer}.md` and of the `task` and
/// `sonic` definitions in `task/agents.ts`. Update together with those.
const BUILTIN_AGENTS: [(&str, &[&str]); 5] = [
    ("scout", &["@smol"]),
    ("reviewer", &["@slow"]),
    ("security-reviewer", &[]),
    ("task", &["@task"]),
    ("sonic", &["@smol"]),
];

/// Inputs to discovery, as the model-role snapshot has them.
#[derive(Debug, Clone)]
pub struct DiscoveryCtx {
    /// User home: locates Claude's config directory and the marketplace registries.
    pub home: PathBuf,
    /// omp agent directory; user agents live in `<agent_dir>/agents`.
    pub agent_dir: PathBuf,
    /// Active project directory. `None` limits discovery to global sources.
    pub project_dir: Option<PathBuf>,
}

/// One agent definition, reduced to what model-role resolution reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredAgent {
    pub name: String,
    pub source: AgentSource,
    /// Declared `model:` selectors, in order. Empty when absent, or dropped for a Claude-dialect plugin.
    pub declared: Vec<String>,
    /// Where the definition lives: the file path, or the built-in label.
    pub origin: String,
}

/// Discovers every agent visible from `ctx`, in omp's precedence, one entry per name.
/// Never fails: unreadable config, registries, and files are logged or skipped, as omp does.
pub fn discover_agents(ctx: &DiscoveryCtx) -> Vec<DiscoveredAgent> {
    let cwd = ctx.project_dir.as_deref();
    let mut config = ConfigFiles::read(&ctx.agent_dir, cwd);
    let disabled = provider_ids(config.pick(ConfigKey::DisabledProviders), cwd, &ctx.home);
    let enabled = provider_ids(config.pick(ConfigKey::EnabledProviders), cwd, &ctx.home);
    let extensions = config.pick(ConfigKey::Extensions);

    let catalog =
        crate::settings_plugins::scan_plugins(&crate::settings_plugins::user_plugins_root(), cwd);
    let omp_plugins_root = catalog
        .roots
        .iter()
        .find(|root| root.scope == "user")
        .map(|root| PathBuf::from(&root.dir));
    let marketplace = marketplace_roots(&ctx.home, cwd, omp_plugins_root.as_deref());
    let marketplace_real: HashSet<PathBuf> = marketplace
        .iter()
        .map(|root| real_or_self(&root.path))
        .collect();

    let mut sources = Vec::new();
    if let Some(dir) = cwd.and_then(nearest_project_agents_dir) {
        sources.push(AgentDir {
            dir,
            source: AgentSource::Project,
            ignore_model: false,
        });
    }
    sources.push(AgentDir {
        dir: ctx.agent_dir.join("agents"),
        source: AgentSource::User,
        ignore_model: false,
    });

    if !disabled.contains("omp-plugins") {
        let mut candidates: Vec<(PathBuf, AgentSource)> = Vec::new();
        if let Some((project, items)) = extensions {
            for entry in extension_entries(items) {
                if let Some(path) = resolve_extension(&entry, &ctx.home, cwd) {
                    candidates.push((path, scope_source(project)));
                }
            }
        }
        for package in installed_packages(&catalog.plugins) {
            // A marketplace install is discovered in the marketplace lane, never as a package.
            if marketplace_real.contains(&real_or_self(&package.dir)) {
                continue;
            }
            candidates.push((package.dir, package.source));
        }
        let mut seen_dirs = HashSet::new();
        for (dir, source) in candidates {
            if seen_dirs.insert(dir.clone()) && dir.is_dir() {
                sources.push(AgentDir {
                    dir: dir.join("agents"),
                    source,
                    ignore_model: false,
                });
            }
        }
    }

    if !disabled.contains("claude-plugins") {
        let claude_user = claude_user_enabled(&enabled, &disabled);
        let mut plugin_roots: Vec<MarketRoot> = marketplace
            .into_iter()
            .filter(|root| root.project || claude_user || root.origin != RootOrigin::Claude)
            .collect();
        plugin_roots.sort_by_key(|root| !root.project);
        for root in plugin_roots {
            let ignore_model =
                root.origin == RootOrigin::Claude || claude_model_dialect(&root.path);
            sources.push(AgentDir {
                dir: root.path.join("agents"),
                source: scope_source(root.project),
                ignore_model,
            });
        }
    }

    let mut seen = HashSet::new();
    let mut agents = Vec::new();
    for source in &sources {
        for agent in load_agents(source) {
            if seen.insert(agent.name.clone()) {
                agents.push(agent);
            }
        }
    }
    for (name, declared) in BUILTIN_AGENTS {
        if seen.insert(name.to_string()) {
            agents.push(DiscoveredAgent {
                name: name.to_string(),
                source: AgentSource::Builtin,
                declared: declared.iter().map(|model| model.to_string()).collect(),
                origin: BUILTIN_ORIGIN.to_string(),
            });
        }
    }
    agents
}

/// One directory of agent markdown, in precedence order.
struct AgentDir {
    dir: PathBuf,
    source: AgentSource,
    /// Set for Claude-dialect plugin roots, whose `model:` aliases are not omp selectors.
    ignore_model: bool,
}

/// An enabled npm or linked extension package.
struct Package {
    dir: PathBuf,
    source: AgentSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootOrigin {
    Claude,
    Omp,
}

/// A plugin root from a marketplace registry (omp `ClaudePluginRoot`).
#[derive(Debug, Clone)]
struct MarketRoot {
    /// `name@marketplace`. omp's registry replaces Claude's entries that share this id.
    id: String,
    path: PathBuf,
    /// Project scope: a Claude `local`/`project` entry, or any entry of the project registry.
    project: bool,
    origin: RootOrigin,
}

struct ParsedAgent {
    name: String,
    model: Vec<String>,
}

/// Global config file names, in omp's precedence: `config.yml` first, then `config.yaml`.
const GLOBAL_CONFIG_NAMES: [&str; 2] = ["config.yml", "config.yaml"];
/// Project config file, read from `.omp/`.
const PROJECT_CONFIG_NAME: &str = "config.yml";

/// One config value omp reads as a list. Any other value is ignored, as omp ignores it.
#[allow(dead_code)] // `Other` is a catch-all; its payload is never read.
#[derive(Deserialize)]
#[serde(untagged)]
enum Lenient<T> {
    Value(T),
    Other(IgnoredAny),
}

/// One item of a config list: a string, or a path-scoped object in a provider list. Other items are ignored.
#[allow(dead_code)] // `Other` is a catch-all; its payload is never read.
#[derive(Deserialize)]
#[serde(untagged)]
enum Item {
    Text(String),
    Scope(Scope),
    Other(IgnoredAny),
}

/// omp `stringArrayFromUnknown` input: one string, or a list whose string items count.
#[allow(dead_code)] // `Other` is a catch-all; its payload is never read.
#[derive(Deserialize)]
#[serde(untagged)]
enum OneOrMany {
    One(String),
    Many(Vec<Item>),
    Other(IgnoredAny),
}

/// A path-scoped provider entry (omp `resolvePathScopedStringArray`). It contributes its values only
/// when one of its path prefixes contains the project directory.
#[derive(Deserialize, Default)]
#[serde(default)]
struct Scope {
    path: Option<OneOrMany>,
    paths: Option<OneOrMany>,
    #[serde(rename = "pathPrefix")]
    path_prefix: Option<OneOrMany>,
    #[serde(rename = "pathPrefixes")]
    path_prefixes: Option<OneOrMany>,
    values: Option<OneOrMany>,
    items: Option<OneOrMany>,
    providers: Option<OneOrMany>,
}

/// The keys discovery reads from one config file. Every other key is skipped while parsing.
#[derive(Deserialize, Default)]
#[serde(default)]
struct ConfigKeys {
    extensions: Option<Lenient<Vec<Item>>>,
    #[serde(rename = "enabledProviders")]
    enabled_providers: Option<Lenient<Vec<Item>>>,
    #[serde(rename = "disabledProviders")]
    disabled_providers: Option<Lenient<Vec<Item>>>,
}

#[derive(Clone, Copy)]
enum ConfigKey {
    Extensions,
    EnabledProviders,
    DisabledProviders,
}

impl ConfigKeys {
    /// Takes the list for `key` when this file holds one. Other keys are left in place.
    fn pick(&mut self, key: ConfigKey) -> Option<Vec<Item>> {
        let value = match key {
            ConfigKey::Extensions => self.extensions.take(),
            ConfigKey::EnabledProviders => self.enabled_providers.take(),
            ConfigKey::DisabledProviders => self.disabled_providers.take(),
        }?;
        match value {
            Lenient::Value(items) => Some(items),
            Lenient::Other(_) => None,
        }
    }
}

/// The persisted config files discovery reads, each parsed narrowly. A file that cannot be parsed is
/// logged by path and contributes nothing.
struct ConfigFiles {
    project_yaml: Option<ConfigKeys>,
    user_yaml: Option<ConfigKeys>,
}

impl ConfigFiles {
    fn read(agent_dir: &Path, project_dir: Option<&Path>) -> Self {
        let project_yaml = project_dir
            .map(|dir| dir.join(".omp"))
            .and_then(|dir| first_file(&dir, &[PROJECT_CONFIG_NAME]))
            .and_then(|(path, text)| parse_yaml(&path, &text));
        let user_yaml = first_file(agent_dir, &GLOBAL_CONFIG_NAMES)
            .and_then(|(path, text)| parse_yaml(&path, &text));
        ConfigFiles {
            project_yaml,
            user_yaml,
        }
    }

    /// omp's array-replacement precedence for one key: the project `config.yml` first, then the user
    /// config file. The first file that holds the key supplies the whole list. The flag is true when
    /// the project supplied it.
    fn pick(&mut self, key: ConfigKey) -> Option<(bool, Vec<Item>)> {
        if let Some(items) = self.project_yaml.as_mut().and_then(|keys| keys.pick(key)) {
            return Some((true, items));
        }
        self.user_yaml
            .as_mut()
            .and_then(|keys| keys.pick(key))
            .map(|items| (false, items))
    }
}

/// The first readable file among `names` in `dir`, with its path and text.
fn first_file(dir: &Path, names: &[&str]) -> Option<(PathBuf, String)> {
    names.iter().find_map(|name| {
        let path = dir.join(name);
        read_text(&path).map(|text| (path, text))
    })
}

/// Keys of a YAML config file. A file that does not parse is logged by path and yields nothing.
fn parse_yaml(path: &Path, text: &str) -> Option<ConfigKeys> {
    match serde_yaml_ng::from_str::<ConfigKeys>(text) {
        Ok(keys) => Some(keys),
        Err(_) => {
            tracing::warn!("无法解析 {}", path.display());
            None
        }
    }
}

/// Non-empty string entries of an `extensions` list, as omp's `readExtensionsArray` keeps them.
fn extension_entries(items: Vec<Item>) -> Vec<String> {
    items
        .into_iter()
        .filter_map(|item| match item {
            Item::Text(text) if !text.is_empty() => Some(text),
            _ => None,
        })
        .collect()
}

/// Provider ids from a `disabledProviders` or `enabledProviders` list. Strings always count. A
/// path-scoped object counts when one of its prefixes contains the project directory.
fn provider_ids(
    picked: Option<(bool, Vec<Item>)>,
    project: Option<&Path>,
    home: &Path,
) -> HashSet<String> {
    let Some((_, items)) = picked else {
        return HashSet::new();
    };
    let mut ids = HashSet::new();
    for item in items {
        match item {
            Item::Text(id) => {
                ids.insert(id);
            }
            Item::Scope(scope) => {
                let Some(cwd) = project else {
                    continue;
                };
                let prefixes: Vec<String> = vec![
                    scope.path,
                    scope.paths,
                    scope.path_prefix,
                    scope.path_prefixes,
                ]
                .into_iter()
                .flat_map(texts)
                .collect();
                if prefixes
                    .iter()
                    .any(|prefix| path_matches_prefix(cwd, prefix, home))
                {
                    ids.extend(texts(scope.values));
                    ids.extend(texts(scope.items));
                    ids.extend(texts(scope.providers));
                }
            }
            Item::Other(_) => {}
        }
    }
    ids
}

/// omp `stringArrayFromUnknown`: one string, or the string items of a list. Anything else is empty.
fn texts(value: Option<OneOrMany>) -> Vec<String> {
    match value {
        Some(OneOrMany::One(text)) => vec![text],
        Some(OneOrMany::Many(items)) => items
            .into_iter()
            .filter_map(|item| match item {
                Item::Text(text) => Some(text),
                _ => None,
            })
            .collect(),
        Some(OneOrMany::Other(_)) | None => Vec::new(),
    }
}

/// omp `pathMatchesPrefix`: the project directory is the prefix or lies below it, and the first step
/// below the prefix does not start with `..`. The prefix expands `~`; a relative prefix resolves
/// against the process directory.
fn path_matches_prefix(cwd: &Path, prefix: &str, home: &Path) -> bool {
    let expanded = expand_tilde(prefix, home);
    let anchored = if expanded.is_absolute() {
        expanded
    } else {
        match std::env::current_dir() {
            Ok(dir) => dir.join(expanded),
            Err(_) => return false,
        }
    };
    let prefix = normalize(&anchored);
    let cwd = normalize(cwd);
    match cwd.strip_prefix(&prefix) {
        Ok(rest) => {
            rest.as_os_str().is_empty()
                || !rest
                    .components()
                    .next()
                    .is_some_and(|step| step.as_os_str().to_string_lossy().starts_with(".."))
        }
        Err(_) => false,
    }
}

/// omp `expandTilde`: `~`, and a leading `~/` or `~\`, name the home directory.
fn expand_tilde(raw: &str, home: &Path) -> PathBuf {
    if raw == "~" {
        return home.to_path_buf();
    }
    match raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        Some(rest) => home.join(rest),
        None => PathBuf::from(raw),
    }
}

/// Lexical `path.resolve`: `.` steps dropped and `..` steps folded, without touching the disk.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// omp `resolveAgainst`: `~` expands against the home directory, and a relative entry resolves against
/// the project directory. Without a project directory a relative entry has no base, so it is skipped.
fn resolve_extension(raw: &str, home: &Path, project: Option<&Path>) -> Option<PathBuf> {
    let expanded = expand_tilde(raw, home);
    if expanded.is_absolute() {
        return Some(normalize(&expanded));
    }
    project.map(|dir| normalize(&dir.join(expanded)))
}

/// omp `isUserSourceEnabled("claude-plugins") || isUserSourceEnabled("claude")`, without a context. A
/// disabled source stays off. `claude-plugins` opens on `enabledProviders` naming itself, `claude`, `*`,
/// or `all`. `claude` opens on `enabledProviders` naming `claude`, `*`, or `all`, or when
/// `CLAUDE_CONFIG_DIR` is set.
fn claude_user_enabled(enabled: &HashSet<String>, disabled: &HashSet<String>) -> bool {
    let wildcard = enabled.contains("*") || enabled.contains("all");
    let plugins = !disabled.contains("claude-plugins")
        && (wildcard || enabled.contains("claude-plugins") || enabled.contains("claude"));
    let claude = !disabled.contains("claude")
        && (wildcard || enabled.contains("claude") || env_is_set("CLAUDE_CONFIG_DIR"));
    plugins || claude
}

/// The agent source of a project-scoped or user-scoped root.
fn scope_source(project: bool) -> AgentSource {
    if project {
        AgentSource::Project
    } else {
        AgentSource::User
    }
}

/// Nearest `.omp/agents` directory at or above `cwd` (omp `findAllNearestProjectConfigDirs`).
fn nearest_project_agents_dir(cwd: &Path) -> Option<PathBuf> {
    cwd.ancestors()
        .map(|dir| dir.join(".omp").join("agents"))
        .find(|candidate| candidate.is_dir())
}

/// Enabled npm and linked packages: user packages first, then project packages, each group by name.
fn installed_packages(plugins: &[PluginItem]) -> Vec<Package> {
    let mut packages: Vec<(bool, String, PathBuf)> = plugins
        .iter()
        .filter(|plugin| plugin.enabled && matches!(plugin.kind.as_str(), "npm" | "link"))
        .filter_map(|plugin| {
            let dir = plugin.dir.as_ref()?;
            Some((
                plugin.scope == "project",
                plugin.name.clone(),
                PathBuf::from(dir),
            ))
        })
        .collect();
    packages.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    packages
        .into_iter()
        .map(|(project, _, dir)| Package {
            dir,
            source: if project {
                AgentSource::Project
            } else {
                AgentSource::User
            },
        })
        .collect()
}

/// omp `listClaudePluginRoots`. Claude's registry comes first. omp's registry then replaces Claude's
/// entries for the same plugin id. The project registry comes last and shadows the user entries.
fn marketplace_roots(
    home: &Path,
    cwd: Option<&Path>,
    omp_plugins_root: Option<&Path>,
) -> Vec<MarketRoot> {
    let claude_dir = claude_config_dir(home);
    let anchor = cwd.and_then(|dir| project_anchor(dir, home));
    // Claude's project scope is matched against the registry's project root, else the cwd.
    let active_project = match &anchor {
        Some(anchor) => canonical(anchor),
        None => cwd.and_then(canonical),
    };
    let canonical_cwd = cwd.and_then(canonical);
    let mut settings_dirs: Vec<PathBuf> = Vec::new();
    for dir in active_project.iter().chain(canonical_cwd.iter()) {
        if !settings_dirs.contains(dir) {
            settings_dirs.push(dir.clone());
        }
    }
    let overrides = claude_enabled_overrides(&claude_dir, &settings_dirs);

    let mut roots: Vec<MarketRoot> = Vec::new();
    if let Some(plugins) = read_registry(&claude_dir.join("plugins").join("installed_plugins.json"))
    {
        for (id, value) in plugins {
            let Some(entries) = registry_entries(&id, &value) else {
                continue;
            };
            for entry in entries {
                let Some(install) = install_path(entry) else {
                    continue;
                };
                if !entry_enabled(entry) {
                    continue;
                }
                let flag = overrides.get(&id).copied();
                if flag == Some(false) {
                    continue;
                }
                let project = is_project_scope(entry);
                if project && flag != Some(true) {
                    let project_path = entry
                        .get("projectPath")
                        .and_then(JsonValue::as_str)
                        .filter(|path| !path.is_empty());
                    let belongs_here = match (project_path, active_project.as_ref()) {
                        (Some(path), Some(active)) => {
                            canonical(Path::new(path)).as_ref() == Some(active)
                        }
                        _ => false,
                    };
                    if !belongs_here {
                        continue;
                    }
                }
                roots.push(MarketRoot {
                    id: id.clone(),
                    path: PathBuf::from(install),
                    project,
                    origin: RootOrigin::Claude,
                });
            }
        }
    }

    if let Some(plugins) = omp_plugins_root.map(|root| root.join("installed_plugins.json")) {
        if let Some(plugins) = read_registry(&plugins) {
            for (id, value) in plugins {
                let Some(entries) = registry_entries(&id, &value) else {
                    continue;
                };
                roots.retain(|root| root.id != id);
                for entry in entries {
                    let Some(install) = install_path(entry) else {
                        continue;
                    };
                    if !entry_enabled(entry) {
                        continue;
                    }
                    let duplicate = roots
                        .iter()
                        .any(|root| root.id == id && root.path.as_path() == Path::new(install));
                    if duplicate {
                        continue;
                    }
                    roots.push(MarketRoot {
                        id: id.clone(),
                        path: PathBuf::from(install),
                        project: is_project_scope(entry),
                        origin: RootOrigin::Omp,
                    });
                }
            }
        }
    }

    let mut project_roots: Vec<MarketRoot> = Vec::new();
    if let Some(anchor) = &anchor {
        let registry = anchor
            .join(".omp")
            .join("plugins")
            .join("installed_plugins.json");
        if let Some(plugins) = read_registry(&registry) {
            for (id, value) in plugins {
                let Some(entries) = registry_entries(&id, &value) else {
                    continue;
                };
                for entry in entries {
                    let Some(install) = install_path(entry) else {
                        continue;
                    };
                    if !entry_enabled(entry) {
                        continue;
                    }
                    project_roots.push(MarketRoot {
                        id: id.clone(),
                        path: PathBuf::from(install),
                        project: true,
                        origin: RootOrigin::Omp,
                    });
                }
            }
        }
    }
    if project_roots.is_empty() {
        return roots;
    }
    let shadowed: HashSet<String> = project_roots.iter().map(|root| root.id.clone()).collect();
    project_roots.extend(
        roots
            .into_iter()
            .filter(|root| !shadowed.contains(&root.id)),
    );
    project_roots
}

/// omp `resolveActiveProjectRegistryPath`: the nearest ancestor of `cwd` holding `.omp/`, else the
/// nearest holding `.git`. The walk stops before the home directory, which is never a project.
fn project_anchor(cwd: &Path, home: &Path) -> Option<PathBuf> {
    let walk = || cwd.ancestors().take_while(|dir| *dir != home);
    walk()
        .find(|dir| dir.join(".omp").is_dir())
        .or_else(|| walk().find(|dir| dir.join(".git").exists()))
        .map(Path::to_path_buf)
}

/// Claude Code's config directory: `CLAUDE_CONFIG_DIR` when set, else `<home>/.claude`.
fn claude_config_dir(home: &Path) -> PathBuf {
    match std::env::var("CLAUDE_CONFIG_DIR") {
        Ok(value) if !value.trim().is_empty() => absolute(PathBuf::from(value.trim())),
        _ => home.join(".claude"),
    }
}

fn absolute(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }
    match std::env::current_dir() {
        Ok(cwd) => cwd.join(path),
        Err(_) => path,
    }
}

fn env_is_set(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| !value.trim().is_empty())
}

/// The narrow read of a Claude settings file: `enabledPlugins` only. Its boolean entries are kept;
/// other values, and the file's other keys such as `env`, are skipped and never kept.
#[derive(Deserialize, Default)]
#[serde(default)]
struct ClaudeSettingsKeys {
    #[serde(rename = "enabledPlugins")]
    enabled_plugins: Option<Lenient<HashMap<String, Lenient<bool>>>>,
}

/// Claude's `enabledPlugins` flags. Later files win: `<claude>/settings.json`, then each project's
/// `.claude/settings.json` and `.claude/settings.local.json`.
fn claude_enabled_overrides(claude_dir: &Path, project_dirs: &[PathBuf]) -> HashMap<String, bool> {
    let mut files = vec![claude_dir.join("settings.json")];
    for dir in project_dirs {
        files.push(dir.join(".claude").join("settings.json"));
        files.push(dir.join(".claude").join("settings.local.json"));
    }
    let mut flags = HashMap::new();
    for file in files {
        flags.extend(claude_flags(&file));
    }
    flags
}

/// The boolean `enabledPlugins` entries of one Claude settings file. A file that cannot be parsed is
/// logged by path and contributes nothing.
fn claude_flags(path: &Path) -> HashMap<String, bool> {
    let Some(text) = read_text(path) else {
        return HashMap::new();
    };
    match serde_json::from_str::<ClaudeSettingsKeys>(&text) {
        Ok(keys) => match keys.enabled_plugins {
            Some(Lenient::Value(entries)) => entries
                .into_iter()
                .filter_map(|(id, flag)| match flag {
                    Lenient::Value(flag) => Some((id, flag)),
                    Lenient::Other(_) => None,
                })
                .collect(),
            _ => HashMap::new(),
        },
        Err(_) => {
            tracing::warn!("无法解析 {}", path.display());
            HashMap::new()
        }
    }
}

/// Installed-plugin registry shape: `version` must be a number and `plugins` an object.
#[derive(Deserialize)]
struct RegistryDoc {
    version: JsonValue,
    plugins: OrderedObject,
}

/// A JSON object's entries in file order. omp iterates `Object.entries`, which keeps insertion
/// order, while serde_json's `Map` sorts keys unless its `preserve_order` feature is on.
struct OrderedObject(Vec<(String, JsonValue)>);

impl<'de> Deserialize<'de> for OrderedObject {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct EntriesVisitor;

        impl<'de> Visitor<'de> for EntriesVisitor {
            type Value = OrderedObject;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry::<String, JsonValue>()? {
                    entries.push(entry);
                }
                Ok(OrderedObject(entries))
            }
        }

        deserializer.deserialize_map(EntriesVisitor)
    }
}

/// `plugins` entries of an installed-plugins registry, in file order. `None` when the file is
/// missing or not a valid registry.
fn read_registry(path: &Path) -> Option<Vec<(String, JsonValue)>> {
    let registry: RegistryDoc = serde_json::from_str(&read_text(path)?).ok()?;
    registry.version.is_number().then_some(registry.plugins.0)
}

/// The entries of one registry plugin id. omp skips ids without `@marketplace` and empty lists.
fn registry_entries<'a>(id: &str, value: &'a JsonValue) -> Option<&'a Vec<JsonValue>> {
    let entries = value.as_array()?;
    (!entries.is_empty() && id.contains('@')).then_some(entries)
}

fn install_path(entry: &JsonValue) -> Option<&str> {
    entry
        .get("installPath")?
        .as_str()
        .filter(|path| !path.is_empty())
}

/// Only an explicit `enabled: false` disables an entry, as in omp.
fn entry_enabled(entry: &JsonValue) -> bool {
    entry.get("enabled") != Some(&JsonValue::Bool(false))
}

/// Claude `local` and `project` scopes are bound to one project; anything else counts as user.
fn is_project_scope(entry: &JsonValue) -> bool {
    matches!(
        entry.get("scope").and_then(JsonValue::as_str),
        Some("local" | "project")
    )
}

/// Agent definitions in one directory: `*.md` files in name order, symlinks followed. A missing
/// directory is empty. An unreadable or invalid file is logged and skipped.
fn load_agents(source: &AgentDir) -> Vec<DiscoveredAgent> {
    let Ok(entries) = fs::read_dir(&source.dir) else {
        return Vec::new();
    };
    let mut files: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|kind| kind.is_file() || kind.is_symlink())
        })
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            name.ends_with(".md").then_some((name, entry.path()))
        })
        .collect();
    files.sort_by(|a, b| locale_order(&a.0, &b.0));
    files
        .into_iter()
        .filter_map(|(_, path)| {
            let Some(text) = read_text(&path) else {
                tracing::warn!(path = %path.display(), "agent file unreadable; skipped");
                return None;
            };
            let Some(parsed) = parse_agent(&text) else {
                tracing::warn!(
                    path = %path.display(),
                    "agent file skipped: frontmatter needs a non-empty name and description, and the name cannot be main or sub"
                );
                return None;
            };
            Some(DiscoveredAgent {
                name: parsed.name,
                source: source.source,
                declared: if source.ignore_model {
                    Vec::new()
                } else {
                    parsed.model
                },
                origin: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

/// Approximates JavaScript `localeCompare`: case-insensitive first, exact order as the tie-break.
fn locale_order(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase()
        .cmp(&b.to_lowercase())
        .then_with(|| a.cmp(b))
}

/// omp `parseAgent` with `parseAgentFields`: a definition needs a non-empty `name` and
/// `description`, and its name may not be the reserved session names `main` or `sub`.
fn parse_agent(content: &str) -> Option<ParsedAgent> {
    let frontmatter = read_frontmatter(content);
    let name = non_empty_string(frontmatter.get("name"))?;
    non_empty_string(frontmatter.get("description"))?;
    let normalized = name.trim().to_lowercase();
    if normalized == "main" || normalized == "sub" {
        return None;
    }
    Some(ParsedAgent {
        name: name.to_string(),
        model: model_list(frontmatter.get("model")),
    })
}

fn non_empty_string(value: Option<&YamlValue>) -> Option<&str> {
    match value {
        Some(YamlValue::String(text)) if !text.is_empty() => Some(text.as_str()),
        _ => None,
    }
}

/// omp `parseModelList`: a comma-separated string, or a YAML list of strings. Items are trimmed and
/// empty ones dropped.
fn model_list(value: Option<&YamlValue>) -> Vec<String> {
    let raw: Vec<&str> = match value {
        Some(YamlValue::String(text)) => text.split(',').collect(),
        Some(YamlValue::Sequence(items)) => items
            .iter()
            .filter_map(|item| match item {
                YamlValue::String(text) => Some(text.as_str()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    raw.into_iter()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

/// omp `parseFrontmatter` with its default repairs: CRLF to LF, HTML comments stripped, and a
/// `---` block read as YAML. A YAML error falls back to quoting ambiguous scalars, then to a
/// line-based read. A missing block yields an empty record.
fn read_frontmatter(content: &str) -> HashMap<String, YamlValue> {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let text = html_comment().replace_all(&normalized, "");
    if !text.starts_with("---") {
        return HashMap::new();
    }
    let Some(end) = text[3..].find("\n---").map(|offset| offset + 3) else {
        return HashMap::new();
    };
    let metadata = text.get(4..end).unwrap_or("");
    match yaml_record(metadata) {
        Some(record) => record,
        None => quote_ambiguous_plain_scalars(metadata)
            .and_then(|quoted| yaml_record(&quoted))
            .unwrap_or_else(|| line_fallback(metadata)),
    }
}

/// omp `parseYamlRecord`: `None` on a YAML syntax error. An empty document or one that is not a
/// mapping yields an empty record, since omp merges nothing from it. Tabs read as two spaces.
fn yaml_record(text: &str) -> Option<HashMap<String, YamlValue>> {
    let repaired = text.replace('\t', "  ");
    match serde_yaml_ng::from_str::<YamlValue>(&repaired) {
        Err(_) => None,
        Ok(YamlValue::Mapping(mapping)) => Some(
            mapping
                .into_iter()
                .filter_map(|(key, value)| key.as_str().map(|key| (key.to_string(), value)))
                .collect(),
        ),
        Ok(_) => Some(HashMap::new()),
    }
}

/// omp `quoteAmbiguousPlainScalars`: a `key: value` line whose value contains `": "` gets its value
/// JSON-quoted, so YAML reads it as text. `None` when no line changes.
fn quote_ambiguous_plain_scalars(metadata: &str) -> Option<String> {
    let mut changed = false;
    let lines: Vec<String> = metadata
        .split('\n')
        .map(|line| {
            let Some(caps) = plain_scalar_line().captures(line) else {
                return line.to_string();
            };
            let value = &caps[2];
            let explicit_start =
                value.starts_with(['"', '\'', '[', '{', '|', '>', '!', '&', '*', '#']);
            if !value.contains(": ") || explicit_start {
                return line.to_string();
            }
            changed = true;
            format!(
                "{}{}{}",
                &caps[1],
                JsonValue::String(value.to_string()),
                &caps[3]
            )
        })
        .collect();
    changed.then(|| lines.join("\n"))
}

/// omp's fallback after a YAML error: each `key: value` line on its own. A value that parses as a
/// scalar or a list keeps that type. Anything else stays the trimmed raw text.
fn line_fallback(metadata: &str) -> HashMap<String, YamlValue> {
    let mut record = HashMap::new();
    for line in metadata.split('\n') {
        let Some(caps) = key_line().captures(line) else {
            continue;
        };
        let raw = caps[2].trim();
        let value = match serde_yaml_ng::from_str::<YamlValue>(raw) {
            Ok(
                parsed @ (YamlValue::Bool(_)
                | YamlValue::Number(_)
                | YamlValue::String(_)
                | YamlValue::Sequence(_)),
            ) => parsed,
            _ => YamlValue::String(raw.to_string()),
        };
        record.insert(caps[1].to_string(), value);
    }
    record
}

fn html_comment() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<!--.*?-->").expect("static regex compiles"))
}

fn plain_scalar_line() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(\s*[A-Za-z_][A-Za-z0-9_-]*:\s+)(\S.*?)(\s*)$")
            .expect("static regex compiles")
    })
}

fn key_line() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^([A-Za-z0-9_-]+):\s*(.*)$").expect("static regex compiles"))
}

/// omp `pluginUsesClaudeModelDialect`. An OMP-native or Agent Plugins root keeps its `model:`
/// selectors. Otherwise a `.claude-plugin` manifest marks Claude aliases, which are dropped.
fn claude_model_dialect(root: &Path) -> bool {
    if root.join(".omp-plugin").join("plugin.json").is_file() || is_standard_plugin_root(root) {
        return false;
    }
    root.join(".claude-plugin").join("plugin.json").is_file()
}

/// omp `classifyAgentPluginRoot(root).kind === "standard"`: a `plugin.json` that resolves inside the
/// root and passes the manifest checks.
fn is_standard_plugin_root(root: &Path) -> bool {
    let Some(real_root) = canonical(root) else {
        return false;
    };
    let Some(manifest) = canonical(&real_root.join("plugin.json")) else {
        return false;
    };
    if !manifest.starts_with(&real_root) {
        return false;
    }
    matches!(read_json(&manifest), Some(JsonValue::Object(doc)) if agent_plugin_manifest_is_valid(&doc))
}

/// The outcome of omp `parseAgentPluginManifest` that matters here: `valid`. Unknown fields and a
/// non-object `extensions` are only warnings there, so they pass here too.
fn agent_plugin_manifest_is_valid(doc: &JsonMap<String, JsonValue>) -> bool {
    if doc.get("$schema").and_then(JsonValue::as_str) != Some(AGENT_PLUGIN_MANIFEST_SCHEMA) {
        return false;
    }
    let name_ok = doc
        .get("name")
        .and_then(JsonValue::as_str)
        .is_some_and(is_valid_plugin_name);
    let text_fields_ok = [
        "version",
        "description",
        "homepage",
        "repository",
        "license",
    ]
    .iter()
    .all(|field| doc.get(*field).map_or(true, JsonValue::is_string));
    let keywords_ok = match doc.get("keywords") {
        None => true,
        Some(JsonValue::Array(items)) => items.iter().all(JsonValue::is_string),
        Some(_) => false,
    };
    let author_ok = match doc.get("author") {
        None => true,
        Some(JsonValue::Object(author)) => author.iter().all(|(key, value)| {
            matches!(key.as_str(), "name" | "email" | "url") && value.is_string()
        }),
        Some(_) => false,
    };
    name_ok && text_fields_ok && keywords_ok && author_ok
}

/// omp `isValidAgentPluginName`: 1 to 64 characters from `[a-z0-9.-]`, alphanumeric at both ends,
/// with no `--` and no `..`.
fn is_valid_plugin_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    let alnum = |c: u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    !bytes.is_empty()
        && bytes.len() <= 64
        && alnum(bytes[0])
        && alnum(bytes[bytes.len() - 1])
        && bytes.iter().all(|&c| alnum(c) || c == b'.' || c == b'-')
        && !name.contains("--")
        && !name.contains("..")
}

/// File text as omp reads it: UTF-8 with invalid bytes replaced. `None` when unreadable.
fn read_text(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn read_json(path: &Path) -> Option<JsonValue> {
    serde_json::from_str(&read_text(path)?).ok()
}

fn canonical(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok()
}

/// The real path when it resolves, else the path as given (omp `realpathOrResolved`).
fn real_or_self(path: &Path) -> PathBuf {
    canonical(path).unwrap_or_else(|| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    const AGENT_NAME: &str = "sentinel-keeper";

    /// A temp home, agent dir, and project that owns one `extensions` root holding one agent. The
    /// project `.omp/config.yml` is `extensions:` plus `extra_config`, which carries the gate line.
    /// Everything lives under one temp root and is removed on drop; no env or global state changes.
    struct Fixture {
        root: PathBuf,
        ctx: DiscoveryCtx,
        agent_file: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn extension_fixture(extra_config: &str) -> Fixture {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|span| span.as_nanos())
            .unwrap_or_default();
        let root =
            std::env::temp_dir().join(format!("omp-discovery-test-{}-{nanos}", std::process::id()));
        let home = root.join("home");
        let agent_dir = root.join("agent");
        let project = root.join("proj");
        let agents = project.join("ext-one").join("agents");
        for dir in [&home, &agent_dir, &project.join(".omp"), &agents] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(
            project.join(".omp").join(PROJECT_CONFIG_NAME),
            format!("extensions:\n  - ./ext-one\n{extra_config}"),
        )
        .unwrap();
        let agent_file = agents.join("sentinel-keeper.md");
        fs::write(
            &agent_file,
            "---\nname: sentinel-keeper\ndescription: extension fixture agent\nmodel: g/fast\n---\nBody.\n",
        )
        .unwrap();
        Fixture {
            root,
            ctx: DiscoveryCtx {
                home,
                agent_dir,
                project_dir: Some(project),
            },
            agent_file,
        }
    }

    #[test]
    fn project_extensions_entry_discovers_its_agents() {
        let fixture = extension_fixture("");
        let agents = discover_agents(&fixture.ctx);
        let agent = agents
            .iter()
            .find(|agent| agent.name == AGENT_NAME)
            .expect("an extensions root contributes its agents");
        assert_eq!(agent.source, AgentSource::Project);
        assert_eq!(agent.declared, [String::from("g/fast")]);
        assert_eq!(agent.origin, fixture.agent_file.to_string_lossy());
    }

    #[test]
    fn disabled_omp_plugins_drops_extension_agents() {
        let fixture = extension_fixture("disabledProviders:\n  - omp-plugins\n");
        let agents = discover_agents(&fixture.ctx);
        assert!(!agents.iter().any(|agent| agent.name == AGENT_NAME));
    }
}
