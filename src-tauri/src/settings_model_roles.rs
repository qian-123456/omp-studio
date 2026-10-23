//! [D] Model-role settings bridge: `omp_model_roles_read` / `omp_model_roles_set`.
//!
//! Scope is exactly two omp config keys, `modelRoles` and `task.agentModelOverrides`, in the
//! user config (`config.yml`, or `config.yaml` when only that exists) and the project
//! `.omp/config.yml`. Only those keys are projected to the UI. Other keys are compared
//! internally to prove an edit did not touch them; they are never returned or logged.
//!
//! Edits are byte splices. The lossless syntax tree (yaml-edit) gives the byte range of the
//! target entry, and only those ranges change, so every other byte, including all comments,
//! stays as written. A result is written only if it re-parses, keeps the same comment
//! sequence, and differs from the original only at the target path. Writes are atomic
//! (temp file + rename), follow symlinks, keep permissions, and fail if the file changed
//! since it was read.
//!
//! Agent discovery lives in `settings_model_roles/discovery.rs`: bundled agents, user and project
//! `.omp/agents`, extension and plugin agent roots. It reads agent markdown, the plugin lock state
//! (`omp-plugins.lock.json`), and a narrow projection of `extensions`, `enabledProviders`,
//! `disabledProviders` and Claude `enabledPlugins` that only decides which roots are active. Those
//! values are never returned over IPC, logged, or written.

mod chains;
mod discovery;

pub(crate) use chains::{edit_chains, read_chains, ChainStep};

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_yaml_ng::Value;
use yaml_edit::{AsYaml, Mapping, YamlFile, YamlNode};

const OMP_DIR: &str = ".omp";
const GLOBAL_CONFIG_NAMES: [&str; 2] = ["config.yml", "config.yaml"];
const PROJECT_CONFIG_NAME: &str = "config.yml";
const LEGACY_SETTINGS_NAME: &str = "settings.json";
const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 128;
const MAX_VALUE_CHARS: usize = 256;
const GLOBAL_LABEL: &str = "全局配置";
const PROJECT_LABEL: &str = "项目配置";
/// Separator for flattened semantic paths. Validated names never contain it.
const PATH_SEP: &str = "\u{1f}";
/// Built-in role ids: the keys of omp `MODEL_ROLES` (src/config/model-roles.ts).
const BUILTIN_ROLES: [&str; 14] = [
    "default", "smol", "slow", "vision", "plan", "commit", "tiny", "memory", "task", "advisor",
    "image", "web", "speech", "judge",
];
/// One read-modify-write at a time inside this process.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

// ---------- IPC types (mirrored in src/lib/contracts.ts) ----------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoleLayer {
    pub path: String,
    pub exists: bool,
    pub model_roles: BTreeMap<String, String>,
    pub agent_model_overrides: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentSource {
    Builtin,
    User,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EffectiveSource {
    Override,
    Global,
    Project,
    Agent,
    Session,
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelAssignment {
    pub name: String,
    pub source: AgentSource,
    pub declared_model: Option<String>,
    pub effective_model: Option<String>,
    pub effective_source: EffectiveSource,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoleSnapshot {
    pub global: ModelRoleLayer,
    pub project: Option<ModelRoleLayer>,
    pub agents: Vec<AgentModelAssignment>,
}

// ---------- internal model ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scope {
    Global,
    Project,
}

impl Scope {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "global" => Ok(Self::Global),
            "project" => Ok(Self::Project),
            _ => Err("scope 只能是 global 或 project".to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Layer {
    Global,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Table {
    ModelRoles,
    AgentModelOverrides,
}

impl Table {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "modelRoles" => Ok(Self::ModelRoles),
            "agentModelOverrides" => Ok(Self::AgentModelOverrides),
            _ => Err("table 只能是 modelRoles 或 agentModelOverrides".to_string()),
        }
    }

    /// Key path of the table from the document root.
    fn path(self) -> &'static [&'static str] {
        match self {
            Self::ModelRoles => &["modelRoles"],
            Self::AgentModelOverrides => &["task", "agentModelOverrides"],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum EditOp {
    Set {
        table: Table,
        name: String,
        value: String,
    },
    Remove {
        table: Table,
        name: String,
    },
}

#[derive(Debug, Clone)]
struct Ctx {
    home: PathBuf,
    agent_dir: PathBuf,
    project_dir: Option<PathBuf>,
}

impl Ctx {
    fn resolve(cwd: Option<&str>) -> Result<Self, String> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        let project_dir = match cwd.map(str::trim).filter(|raw| !raw.is_empty()) {
            None => None,
            Some(raw) => {
                let dir = PathBuf::from(raw);
                if !dir.is_absolute() || !dir.is_dir() {
                    return Err(format!("项目目录不存在或不是绝对路径：{raw}"));
                }
                Some(dir)
            }
        };
        Ok(Self {
            agent_dir: crate::paths::agent_dir(),
            home,
            project_dir,
        })
    }
}

fn global_config_path(ctx: &Ctx) -> PathBuf {
    GLOBAL_CONFIG_NAMES
        .iter()
        .map(|name| ctx.agent_dir.join(name))
        .find(|path| is_file(path))
        .unwrap_or_else(|| ctx.agent_dir.join(GLOBAL_CONFIG_NAMES[0]))
}

fn project_config_path(ctx: &Ctx) -> Option<PathBuf> {
    ctx.project_dir.as_deref().map(project_config_file)
}

fn is_file(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_file())
        .unwrap_or(false)
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

// ---------- reading (projection of the two allowed keys only) ----------

#[derive(Debug, Default)]
struct LayerValues {
    model_roles: BTreeMap<String, String>,
    overrides: BTreeMap<String, String>,
}

struct ConfigFile {
    exists: bool,
    bytes: Vec<u8>,
    text: String,
}

fn read_config(path: &Path, label: &str) -> Result<ConfigFile, String> {
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ConfigFile {
                exists: false,
                bytes: Vec::new(),
                text: String::new(),
            });
        }
        Err(error) => return Err(format!("无法读取{label}：{error}")),
    };
    if !meta.is_file() {
        return Err(format!("{label}不是普通文件"));
    }
    if meta.len() > MAX_CONFIG_BYTES {
        return Err(format!("{label}超过 4 MiB，拒绝处理"));
    }
    let bytes = fs::read(path).map_err(|error| format!("无法读取{label}：{error}"))?;
    let text = String::from_utf8(bytes.clone()).map_err(|_| format!("{label}不是 UTF-8 文本"))?;
    Ok(ConfigFile {
        exists: true,
        bytes,
        text,
    })
}

/// Parses a config document. Errors carry no content.
fn parse_yaml(text: &str, label: &str) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_yaml_ng::from_str::<Value>(text).map_err(|_| format!("{label}无法解析，拒绝处理"))
}

/// Projects `modelRoles` and `task.agentModelOverrides`; every other key is ignored.
fn project_layer(root: &Value) -> LayerValues {
    let Value::Mapping(map) = root else {
        return LayerValues::default();
    };
    let model_roles = map.get("modelRoles").map(selectors).unwrap_or_default();
    let overrides = match map.get("task") {
        Some(Value::Mapping(task)) => task
            .get("agentModelOverrides")
            .map(selectors)
            .unwrap_or_default(),
        _ => BTreeMap::new(),
    };
    LayerValues {
        model_roles,
        overrides,
    }
}

fn selectors(node: &Value) -> BTreeMap<String, String> {
    let Value::Mapping(map) = node else {
        return BTreeMap::new();
    };
    map.iter()
        .filter_map(|(key, value)| match (key, selector_text(value)) {
            (Value::String(name), Some(text)) => Some((name.clone(), text)),
            _ => None,
        })
        .collect()
}

/// omp joins string arrays with `,` (`modelRoleValueFromUnknown`).
fn selector_text(value: &Value) -> Option<String> {
    let raw = match value {
        Value::String(text) => text.trim().to_string(),
        Value::Sequence(items) => {
            let parts: Option<Vec<&str>> = items
                .iter()
                .map(|item| match item {
                    Value::String(text) => Some(text.trim()),
                    _ => None,
                })
                .collect();
            parts?.join(",")
        }
        _ => return None,
    };
    (!raw.is_empty()).then_some(raw)
}

// ---------- snapshot ----------

fn build_snapshot(ctx: &Ctx, session: Option<&str>) -> Result<ModelRoleSnapshot, String> {
    let global_path = global_config_path(ctx);
    let global_file = read_config(&global_path, GLOBAL_LABEL)?;
    let global = project_layer(&parse_yaml(&global_file.text, GLOBAL_LABEL)?);
    let project = match project_config_path(ctx) {
        Some(path) => {
            let file = read_config(&path, PROJECT_LABEL)?;
            let values = project_layer(&parse_yaml(&file.text, PROJECT_LABEL)?);
            Some((path, file.exists, values))
        }
        None => None,
    };
    let roles = Layered {
        global: &global.model_roles,
        project: project.as_ref().map(|(_, _, values)| &values.model_roles),
    };
    let overrides = Layered {
        global: &global.overrides,
        project: project.as_ref().map(|(_, _, values)| &values.overrides),
    };
    let discovered = discovery::discover_agents(&discovery::DiscoveryCtx {
        agent_dir: ctx.agent_dir.clone(),
        home: ctx.home.clone(),
        project_dir: ctx.project_dir.clone(),
    });
    let agents: Vec<AgentModelAssignment> = discovered
        .iter()
        .map(|agent| resolve_agent(agent, &roles, &overrides, session))
        .collect();
    Ok(ModelRoleSnapshot {
        global: ModelRoleLayer {
            path: path_text(&global_path),
            exists: global_file.exists,
            model_roles: global.model_roles.clone(),
            agent_model_overrides: global.overrides.clone(),
        },
        project: project
            .as_ref()
            .map(|(path, exists, values)| ModelRoleLayer {
                path: path_text(path),
                exists: *exists,
                model_roles: values.model_roles.clone(),
                agent_model_overrides: values.overrides.clone(),
            }),
        agents,
    })
}

// ---------- selector resolution (omp model-resolver semantics) ----------

/// One scope's values with the omp layering rules applied.
#[derive(Clone, Copy)]
struct Layered<'a> {
    global: &'a BTreeMap<String, String>,
    project: Option<&'a BTreeMap<String, String>>,
}

impl<'a> Layered<'a> {
    /// `modelRoles`: a project entry wins per key; otherwise the global entry is inherited.
    fn role(&self, name: &str) -> Option<(&'a str, Layer)> {
        if let Some(value) = self.project.and_then(|map| map.get(name)) {
            return Some((value.as_str(), Layer::Project));
        }
        self.global
            .get(name)
            .map(|value| (value.as_str(), Layer::Global))
    }

    /// `task.agentModelOverrides`: a global pin ignores the project; a project pin only applies
    /// to agents the global layer does not name.
    fn pin(&self, name: &str) -> Option<(&'a str, Layer)> {
        if let Some(value) = self.global.get(name) {
            return Some((value.as_str(), Layer::Global));
        }
        self.project
            .and_then(|map| map.get(name))
            .map(|value| (value.as_str(), Layer::Project))
    }
}

/// Outcome of resolving a selector. `via` lists the roles traversed, in order.
#[derive(Debug, Clone)]
enum Resolution {
    /// `layer` is the layer of the final role value; `None` for a literal model.
    Model {
        model: String,
        layer: Option<Layer>,
        via: Vec<String>,
    },
    /// A built-in role with nothing configured: the chain moves on.
    Unset,
    /// The alias names no known role.
    Unknown { via: Vec<String> },
    /// The alias loops back onto a role already being resolved.
    Cycle { via: Vec<String> },
}

fn split_level(reference: &str) -> (&str, Option<&str>) {
    match reference.split_once(':') {
        Some((name, level)) => (name, Some(level)),
        None => (reference, None),
    }
}

fn is_known_role(roles: &Layered<'_>, name: &str) -> bool {
    BUILTIN_ROLES.contains(&name) || roles.role(name).is_some()
}

/// `@role[:level]`, legacy `pi/role[:level]` (known roles only), and `*` / `*:level` for default.
fn alias_target<'s>(roles: &Layered<'_>, selector: &'s str) -> Option<(&'s str, Option<&'s str>)> {
    if selector == "*" {
        return Some(("default", None));
    }
    if let Some(level) = selector.strip_prefix("*:") {
        return Some(("default", Some(level)));
    }
    if let Some(reference) = selector.strip_prefix('@') {
        return Some(split_level(reference));
    }
    if let Some(reference) = selector.strip_prefix("pi/") {
        let (name, level) = split_level(reference);
        return is_known_role(roles, name).then_some((name, level));
    }
    None
}

fn resolve_selector(roles: &Layered<'_>, selector: &str, trail: &mut Vec<String>) -> Resolution {
    match alias_target(roles, selector) {
        Some((name, level)) => resolve_role(roles, name, level, trail),
        None => Resolution::Model {
            model: selector.to_string(),
            layer: None,
            via: trail.clone(),
        },
    }
}

/// A configured value may list fallbacks separated by `,`; the first candidate that resolves
/// to a model wins. Unset roles move on; unknown aliases and cycles are reported.
fn resolve_candidates(roles: &Layered<'_>, raw: &str, trail: &mut Vec<String>) -> Resolution {
    for candidate in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        match resolve_selector(roles, candidate, trail) {
            Resolution::Unset => continue,
            other => return other,
        }
    }
    Resolution::Unset
}

fn resolve_role(
    roles: &Layered<'_>,
    name: &str,
    level: Option<&str>,
    trail: &mut Vec<String>,
) -> Resolution {
    if trail.iter().any(|seen| seen == name) {
        let mut via = trail.clone();
        via.push(name.to_string());
        return Resolution::Cycle { via };
    }
    trail.push(name.to_string());
    let outcome = match roles.role(name) {
        Some((value, layer)) => match resolve_candidates(roles, value, trail) {
            Resolution::Model {
                model,
                layer: inner,
                via,
            } => Resolution::Model {
                model,
                layer: inner.or(Some(layer)),
                via,
            },
            other => other,
        },
        None if BUILTIN_ROLES.contains(&name) => Resolution::Unset,
        None => Resolution::Unknown { via: trail.clone() },
    };
    trail.pop();
    match (outcome, level) {
        (Resolution::Model { model, layer, via }, Some(level)) => Resolution::Model {
            model: format!("{model}:{level}"),
            layer,
            via,
        },
        (other, _) => other,
    }
}

fn route(via: &[String]) -> String {
    via.iter()
        .map(|name| format!("@{name}"))
        .collect::<Vec<_>>()
        .join(" → ")
}

fn via_text(via: &[String]) -> String {
    if via.is_empty() {
        String::new()
    } else {
        format!("（经 {}）", route(via))
    }
}

fn layer_label(layer: Layer) -> &'static str {
    match layer {
        Layer::Global => "全局",
        Layer::Project => "项目",
    }
}

fn effective_for(layer: Layer) -> EffectiveSource {
    match layer {
        Layer::Global => EffectiveSource::Global,
        Layer::Project => EffectiveSource::Project,
    }
}

/// Precedence: named override > the agent's declared model > `modelRoles.task` > session model.
fn resolve_agent(
    agent: &discovery::DiscoveredAgent,
    roles: &Layered<'_>,
    overrides: &Layered<'_>,
    session: Option<&str>,
) -> AgentModelAssignment {
    let declared_text = agent.declared.join(", ");
    let declared = (!agent.declared.is_empty()).then(|| declared_text.clone());
    let mut steps = vec![format!("定义于{}", agent.origin)];

    match overrides.pin(&agent.name) {
        None => steps.push("点名覆盖：未设置".to_string()),
        Some((raw, layer)) => {
            let label = format!("点名覆盖（{}）{raw}", layer_label(layer));
            match resolve_candidates(roles, raw, &mut Vec::new()) {
                Resolution::Model {
                    model,
                    layer: role_layer,
                    via,
                } => {
                    steps.push(format!("{label}{} → {model}", via_text(&via)));
                    let source = role_layer.map_or(EffectiveSource::Override, effective_for);
                    return finish(agent, declared, steps, Some(model), source);
                }
                Resolution::Unset => steps.push(format!("{label}：角色未配置，继续")),
                broken => return unresolved(agent, declared, steps, &label, &broken),
            }
        }
    }

    if agent.declared.is_empty() {
        steps.push("代理声明：无 model".to_string());
    } else {
        let label = format!("代理声明 {declared_text}");
        match resolve_candidates(roles, &agent.declared.join(","), &mut Vec::new()) {
            Resolution::Model {
                model,
                layer: role_layer,
                via,
            } => {
                steps.push(format!("{label}{} → {model}", via_text(&via)));
                let source = role_layer.map_or(EffectiveSource::Agent, effective_for);
                return finish(agent, declared, steps, Some(model), source);
            }
            Resolution::Unset => steps.push(format!("{label}：角色未配置，继续")),
            broken => return unresolved(agent, declared, steps, &label, &broken),
        }
    }

    match resolve_role(roles, "task", None, &mut Vec::new()) {
        Resolution::Model { model, layer, via } => {
            let layer = layer.unwrap_or(Layer::Global);
            steps.push(format!(
                "modelRoles.task{} → {model}（{}）",
                via_text(&via),
                layer_label(layer)
            ));
            return finish(agent, declared, steps, Some(model), effective_for(layer));
        }
        Resolution::Unset => steps.push("modelRoles.task 未配置，继续".to_string()),
        broken => return unresolved(agent, declared, steps, "modelRoles.task", &broken),
    }

    match session {
        Some(model) => {
            steps.push(format!("会话模型 {model}"));
            finish(
                agent,
                declared,
                steps,
                Some(model.to_string()),
                EffectiveSource::Session,
            )
        }
        None => {
            steps.push("未选择会话，无会话模型；以上来源均未提供模型".to_string());
            finish(agent, declared, steps, None, EffectiveSource::Unresolved)
        }
    }
}

fn finish(
    agent: &discovery::DiscoveredAgent,
    declared: Option<String>,
    steps: Vec<String>,
    model: Option<String>,
    source: EffectiveSource,
) -> AgentModelAssignment {
    AgentModelAssignment {
        name: agent.name.clone(),
        source: agent.source,
        declared_model: declared,
        effective_model: model,
        effective_source: source,
        reason: steps.join("；"),
    }
}

/// Explicit unresolved result for an unknown alias or a cycle.
fn unresolved(
    agent: &discovery::DiscoveredAgent,
    declared: Option<String>,
    mut steps: Vec<String>,
    label: &str,
    resolution: &Resolution,
) -> AgentModelAssignment {
    let problem = match resolution {
        Resolution::Unknown { via } => format!("未知角色别名 {}", route(via)),
        Resolution::Cycle { via } => format!("循环引用 {}", route(via)),
        Resolution::Model { .. } | Resolution::Unset => "无可解析模型".to_string(),
    };
    steps.push(format!("{label}：{problem}"));
    finish(agent, declared, steps, None, EffectiveSource::Unresolved)
}

// ---------- editing: byte splices located by the lossless syntax tree ----------

/// One replacement of the byte range `start..end` in the original text.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Splice {
    start: usize,
    end: usize,
    text: String,
}

/// A block mapping's entry, or a table key whose value is absent or empty.
enum Slot {
    Absent,
    Null { key_start: usize },
    Block { map: Mapping, key_start: usize },
}

struct EntryParts {
    key_start: usize,
    colon_end: usize,
    /// Byte range of a non-empty scalar value.
    value: Option<(usize, usize)>,
    /// The value is a sequence (`[a, b]` or a block list), which a write replaces
    /// with the equivalent comma-joined scalar.
    sequence: bool,
}

struct EntryExtent {
    splice: Splice,
    /// Position just after the entry's last line (including its newline).
    line_end: usize,
}

/// Plans and verifies one edit. `Ok(None)` means the file would not change.
fn plan_edit(original: &str, op: &EditOp, label: &str) -> Result<Option<String>, String> {
    if original.starts_with('\u{feff}') {
        return Err(format!("{label}带有 BOM，拒绝写入"));
    }
    let root_value = parse_yaml(original, label)?;
    if !matches!(root_value, Value::Mapping(_) | Value::Null) {
        return Err(format!("{label}根节点不是映射，拒绝写入"));
    }
    let file = YamlFile::from_str(original).map_err(|_| format!("{label}无法解析，拒绝写入"))?;
    if file.documents().count() > 1 {
        return Err(format!("{label}包含多个文档，拒绝写入"));
    }
    let eol = if original.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let splices = match file.document().and_then(|document| document.as_mapping()) {
        Some(root) => {
            if root.is_flow_style() {
                return Err(format!("{label}根映射为 flow 样式，拒绝写入"));
            }
            match op {
                EditOp::Set { table, name, value } => {
                    plan_set(original, &root, *table, name, value, eol, label)?
                }
                EditOp::Remove { table, name } => {
                    plan_remove(original, &root, *table, name, label)?
                }
            }
        }
        None => {
            if !is_comment_only(original) {
                return Err(format!("{label}根节点不是映射，拒绝写入"));
            }
            match op {
                EditOp::Set { table, name, value } => vec![insertion(
                    original,
                    original.len(),
                    eol,
                    &fresh_block(*table, name, value, eol),
                )],
                EditOp::Remove { .. } => Vec::new(),
            }
        }
    };
    if splices.is_empty() {
        return Ok(None);
    }
    let next = apply_splices(original, splices, label)?;
    if next == original {
        return Ok(None);
    }
    verify(original, &next, op, label)?;
    Ok(Some(next))
}

fn plan_set(
    text: &str,
    root: &Mapping,
    table: Table,
    name: &str,
    value: &str,
    eol: &str,
    label: &str,
) -> Result<Vec<Splice>, String> {
    match table {
        Table::ModelRoles => match slot(text, root, "modelRoles", label)? {
            Slot::Absent => Ok(vec![insertion(
                text,
                text.len(),
                eol,
                &fresh_block(table, name, value, eol),
            )]),
            Slot::Null { key_start } => {
                let indent = column(text, key_start) + 2;
                let block = row(eol, indent, &entry_text(name, value));
                Ok(vec![insert_after_line(text, key_start, eol, &block)])
            }
            Slot::Block { map, .. } => set_in_block(text, &map, name, value, eol, label),
        },
        Table::AgentModelOverrides => match slot(text, root, "task", label)? {
            Slot::Absent => Ok(vec![insertion(
                text,
                text.len(),
                eol,
                &fresh_block(table, name, value, eol),
            )]),
            Slot::Null { key_start } => {
                let indent = column(text, key_start) + 2;
                let block = [
                    row(eol, indent, "agentModelOverrides:"),
                    row(eol, indent + 2, &entry_text(name, value)),
                ]
                .concat();
                Ok(vec![insert_after_line(text, key_start, eol, &block)])
            }
            Slot::Block { map: task, .. } => {
                let indent = first_key_column(text, &task, label)?;
                match slot(text, &task, "agentModelOverrides", label)? {
                    Slot::Absent => {
                        let block = [
                            row(eol, indent, "agentModelOverrides:"),
                            row(eol, indent + 2, &entry_text(name, value)),
                        ]
                        .concat();
                        Ok(vec![insert_after_last(text, &task, eol, &block, label)?])
                    }
                    Slot::Null { key_start } => {
                        let inner = column(text, key_start) + 2;
                        let block = row(eol, inner, &entry_text(name, value));
                        Ok(vec![insert_after_line(text, key_start, eol, &block)])
                    }
                    Slot::Block { map: overrides, .. } => {
                        set_in_block(text, &overrides, name, value, eol, label)
                    }
                }
            }
        },
    }
}

/// Replaces the value of an existing entry, or appends a new entry after the last one.
fn set_in_block(
    text: &str,
    map: &Mapping,
    name: &str,
    value: &str,
    eol: &str,
    label: &str,
) -> Result<Vec<Splice>, String> {
    if let Some(parts) = entry_parts(text, map, name, label)? {
        return Ok(vec![value_splice(text, &parts, value)]);
    }
    let indent = first_key_column(text, map, label)?;
    let block = row(eol, indent, &entry_text(name, value));
    Ok(vec![insert_after_last(text, map, eol, &block, label)?])
}

fn value_splice(text: &str, parts: &EntryParts, value: &str) -> Splice {
    let quoted = format!("\"{value}\"");
    // A block sequence's span may end past the last item's newline; trimming the
    // trailing whitespace keeps that newline so the next entry stays on its line.
    let sequence_end = parts
        .value
        .map_or(parts.colon_end, |(_, end)| trim_end(text, end));
    match parts.value {
        // A sequence may span several lines; replacing from just after the colon
        // rewrites the whole list as one inline scalar instead of leaving the
        // value on the first item's line. A block list's own span stops at its
        // last item, so the separator that follows is consumed too (a trailing
        // comment stays and keeps its line).
        Some((_, _)) if parts.sequence => Splice {
            start: parts.colon_end,
            end: sequence_end,
            text: format!(" {quoted}"),
        },
        Some((start, end)) => Splice {
            start,
            end,
            text: quoted,
        },
        None => Splice {
            start: parts.colon_end,
            end: parts.colon_end,
            text: format!(" {quoted}"),
        },
    }
}

fn plan_remove(
    text: &str,
    root: &Mapping,
    table: Table,
    name: &str,
    label: &str,
) -> Result<Vec<Splice>, String> {
    // Containers outermost first: (header key position, entry count before the removal).
    let mut chain: Vec<(usize, usize)> = Vec::new();
    let target = match table {
        Table::ModelRoles => match slot(text, root, "modelRoles", label)? {
            Slot::Block { map, key_start } => {
                chain.push((key_start, map.len()));
                map
            }
            _ => return Ok(Vec::new()),
        },
        Table::AgentModelOverrides => {
            let (task, task_start) = match slot(text, root, "task", label)? {
                Slot::Block { map, key_start } => (map, key_start),
                _ => return Ok(Vec::new()),
            };
            let (overrides, overrides_start) =
                match slot(text, &task, "agentModelOverrides", label)? {
                    Slot::Block { map, key_start } => (map, key_start),
                    _ => return Ok(Vec::new()),
                };
            chain.push((task_start, task.len()));
            chain.push((overrides_start, overrides.len()));
            overrides
        }
    };
    let Some(parts) = entry_parts(text, &target, name, label)? else {
        return Ok(Vec::new());
    };
    let extent = entry_extent(text, &parts, label)?;
    let mut splices = vec![extent.splice];
    // A container that this removal empties loses its header line, unless a comment sits in
    // its span: comments are never deleted. Innermost first.
    for &(header_start, count) in chain.iter().rev() {
        if count != 1 {
            break;
        }
        let header_line = line_start(text, header_start);
        check_indent(text, header_line, header_start, label)?;
        if text[header_line..extent.line_end].contains('#') {
            break;
        }
        splices.push(delete_line(text, header_line, header_start));
    }
    Ok(splices)
}

/// A removed entry keeps its comment: the entry text is replaced by the comment alone, on the
/// same line, so comment bytes are unchanged. Entries without a comment lose their line.
fn entry_extent(text: &str, parts: &EntryParts, label: &str) -> Result<EntryExtent, String> {
    let content_end = match parts.value {
        // A block sequence's span reaches past its last item; trimming trailing
        // whitespace leaves the item's own end, and `item_extent` removes the
        // whole multi-line entry from there.
        Some((_, end)) if parts.sequence => trim_end(text, end),
        Some((_, end)) => end,
        None => parts.colon_end,
    };
    item_extent(text, parts.key_start, content_end, label)
}

/// Removal of the line-leading token at `start` (a key or a `-` marker) whose content ends at
/// `content_end`: a trailing comment is kept on its own line, otherwise the line is deleted.
fn item_extent(
    text: &str,
    start: usize,
    content_end: usize,
    label: &str,
) -> Result<EntryExtent, String> {
    let line = line_start(text, start);
    check_indent(text, line, start, label)?;
    let break_at = line_break(text, content_end);
    let tail = &text[content_end..break_at];
    let body = tail
        .trim_start_matches(is_inline_space)
        .trim_end_matches('\r');
    let line_end = line_end_incl(text, content_end);
    // A value that spans several lines (a block sequence) owns all of them: the
    // removal runs from the key's line through the value's last line, and what
    // follows on that last line belongs to the value, not to a sibling entry.
    if break_at > line_break(text, start) {
        let indent = &text[line..start];
        let splice = if body.is_empty() {
            Splice {
                start: line,
                end: line_end,
                text: String::new(),
            }
        } else if body.starts_with('#') {
            Splice {
                start: line,
                end: break_at,
                text: format!("{indent}{}", tail.trim_start_matches(is_inline_space)),
            }
        } else {
            return Err(format!("{label}条目行尾含有未知内容，拒绝写入"));
        };
        return Ok(EntryExtent { splice, line_end });
    }
    if body.is_empty() {
        return Ok(EntryExtent {
            splice: delete_line(text, line, start),
            line_end,
        });
    }
    if body.starts_with('#') {
        let indent = &text[line..start];
        let comment = tail.trim_start_matches(is_inline_space);
        return Ok(EntryExtent {
            splice: Splice {
                start: line,
                end: break_at,
                text: format!("{indent}{comment}"),
            },
            line_end,
        });
    }
    Err(format!("{label}条目行尾含有未知内容，拒绝写入"))
}

/// Looks up `key` in a block mapping. A table whose value is empty counts as `Null`.
fn slot(text: &str, parent: &Mapping, key: &str, label: &str) -> Result<Slot, String> {
    let Some(entry) = parent.find_entry_by_key(key) else {
        return Ok(Slot::Absent);
    };
    let key_node = entry
        .key_node()
        .ok_or_else(|| format!("{label}存在无法定位的键，拒绝写入"))?;
    let (key_start, _) = scalar_span(text, &key_node, label)?;
    match entry.value_node() {
        None => Ok(Slot::Null { key_start }),
        Some(YamlNode::Scalar(scalar)) if scalar.value().trim().is_empty() => {
            Ok(Slot::Null { key_start })
        }
        Some(YamlNode::Mapping(map)) if !map.is_flow_style() => Ok(Slot::Block { map, key_start }),
        Some(_) => Err(format!("{label}中的 {key} 不是块状映射，拒绝写入")),
    }
}

fn entry_parts(
    text: &str,
    map: &Mapping,
    key: &str,
    label: &str,
) -> Result<Option<EntryParts>, String> {
    let Some(entry) = map.find_entry_by_key(key) else {
        return Ok(None);
    };
    let key_node = entry
        .key_node()
        .ok_or_else(|| format!("{label}存在无法定位的键，拒绝写入"))?;
    let (key_start, key_end) = scalar_span(text, &key_node, label)?;
    let rest = &text[key_end..];
    let colon = rest
        .find(':')
        .ok_or_else(|| format!("{label}条目缺少冒号，拒绝写入"))?;
    if rest[..colon].chars().any(|c| !is_inline_space(c)) {
        return Err(format!("{label}键与冒号之间含有未知内容，拒绝写入"));
    }
    let colon_end = key_end + colon + 1;
    let mut sequence = false;
    let value = match entry.value_node() {
        None => None,
        Some(YamlNode::Scalar(scalar)) if scalar.value().trim().is_empty() => None,
        Some(node @ YamlNode::Scalar(_)) => Some(scalar_span(text, &node, label)?),
        // omp accepts a role as a list (`[a, b]` or a block sequence) and joins
        // it with commas when it reads the value back, so such an entry must be
        // editable too: the whole sequence is one span that a write replaces
        // with the equivalent comma-joined scalar.
        Some(node @ YamlNode::Sequence(_)) => {
            sequence = true;
            Some(node_span(text, &node, label)?)
        }
        Some(_) => return Err(format!("{label}条目的值不是标量或序列，拒绝写入")),
    };
    Ok(Some(EntryParts {
        key_start,
        colon_end,
        value,
        sequence,
    }))
}

// ---------- positions and line helpers (all offsets are byte offsets into `text`) ----------

fn node_span(text: &str, node: &YamlNode, label: &str) -> Result<(usize, usize), String> {
    let range = node
        .as_node()
        .ok_or_else(|| format!("{label}节点缺少位置信息，拒绝写入"))?
        .text_range();
    let start = u32::from(range.start()) as usize;
    let end = u32::from(range.end()) as usize;
    if start > end
        || end > text.len()
        || !text.is_char_boundary(start)
        || !text.is_char_boundary(end)
    {
        return Err(format!("{label}节点位置异常，拒绝写入"));
    }
    Ok((start, end))
}

/// Span of a scalar token whose source text is exactly its value. Anything that would make the
/// splice ambiguous (comments, line breaks) is refused.
fn scalar_span(text: &str, node: &YamlNode, label: &str) -> Result<(usize, usize), String> {
    let YamlNode::Scalar(scalar) = node else {
        return Err(format!("{label}键或值不是标量，拒绝写入"));
    };
    let (start, end) = node_span(text, node, label)?;
    let raw = scalar.value();
    if text.get(start..end) != Some(raw.as_str())
        || raw.contains('#')
        || raw.contains('\n')
        || raw.contains('\r')
    {
        return Err(format!("{label}无法安全定位条目，拒绝写入"));
    }
    Ok((start, end))
}

fn first_key_column(text: &str, map: &Mapping, label: &str) -> Result<usize, String> {
    let (key, _) = map
        .iter()
        .next()
        .ok_or_else(|| format!("{label}映射为空，拒绝写入"))?;
    let (start, _) = node_span(text, &key, label)?;
    Ok(column(text, start))
}

/// Byte offset just past the last non-blank byte of the mapping's entries.
fn last_content_end(text: &str, map: &Mapping, label: &str) -> Result<usize, String> {
    let mut last: Option<usize> = None;
    for (key, value) in map.iter() {
        let (_, key_end) = node_span(text, &key, label)?;
        let mut end = key_end;
        if let Ok((_, value_end)) = node_span(text, &value, label) {
            end = end.max(trim_end(text, value_end));
        }
        last = Some(last.map_or(end, |current| current.max(end)));
    }
    last.ok_or_else(|| format!("{label}映射为空，拒绝写入"))
}

fn trim_end(text: &str, mut end: usize) -> usize {
    while end > 0 && matches!(text.as_bytes()[end - 1], b' ' | b'\t' | b'\r' | b'\n') {
        end -= 1;
    }
    end
}

fn line_start(text: &str, pos: usize) -> usize {
    text[..pos].rfind('\n').map_or(0, |index| index + 1)
}

/// Index of the newline that ends the line holding `pos`, or the text length.
fn line_break(text: &str, pos: usize) -> usize {
    text[pos..]
        .find('\n')
        .map_or(text.len(), |index| pos + index)
}

/// Position just after the newline that ends the line holding `pos` (or the text length).
fn line_end_incl(text: &str, pos: usize) -> usize {
    let brk = line_break(text, pos);
    if brk < text.len() {
        brk + 1
    } else {
        text.len()
    }
}

fn column(text: &str, pos: usize) -> usize {
    pos - line_start(text, pos)
}

fn check_indent(text: &str, line: usize, pos: usize, label: &str) -> Result<(), String> {
    if text[line..pos].bytes().all(|byte| byte == b' ') {
        Ok(())
    } else {
        Err(format!("{label}条目不在独立行，拒绝写入"))
    }
}

fn is_inline_space(c: char) -> bool {
    c == ' ' || c == '\t'
}

/// Deletes the whole line that starts at `line` and holds `pos`.
fn delete_line(text: &str, line: usize, pos: usize) -> Splice {
    let brk = line_break(text, pos);
    if brk < text.len() {
        return Splice {
            start: line,
            end: brk + 1,
            text: String::new(),
        };
    }
    if line == 0 {
        return Splice {
            start: 0,
            end: text.len(),
            text: String::new(),
        };
    }
    // Last line without a newline: also drop the separator before it, so the file keeps its
    // ending (`\r\n` counts as one separator).
    let mut start = line - 1;
    if start > 0 && text.as_bytes()[start - 1] == b'\r' {
        start -= 1;
    }
    Splice {
        start,
        end: text.len(),
        text: String::new(),
    }
}

/// Inserts `block` at `pos`. A file that lacks a final newline gets the separator first and
/// keeps lacking one at the end.
fn insertion(text: &str, pos: usize, eol: &str, block: &str) -> Splice {
    if pos == text.len() && !text.is_empty() && !text.ends_with('\n') {
        let body = block.strip_suffix(eol).unwrap_or(block);
        return Splice {
            start: pos,
            end: pos,
            text: format!("{eol}{body}"),
        };
    }
    Splice {
        start: pos,
        end: pos,
        text: block.to_string(),
    }
}

fn insert_after_line(text: &str, pos: usize, eol: &str, block: &str) -> Splice {
    insertion(text, line_end_incl(text, pos), eol, block)
}

fn insert_after_last(
    text: &str,
    map: &Mapping,
    eol: &str,
    block: &str,
    label: &str,
) -> Result<Splice, String> {
    let end = last_content_end(text, map, label)?;
    Ok(insertion(text, line_end_incl(text, end), eol, block))
}

/// One indented line, terminated by `eol`.
fn row(eol: &str, indent: usize, text: &str) -> String {
    format!("{}{}{eol}", " ".repeat(indent), text)
}

fn is_plain_key(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && !matches!(
            name.to_ascii_lowercase().as_str(),
            "true" | "false" | "yes" | "no" | "on" | "off" | "null" | "y" | "n"
        )
}

fn key_text(name: &str) -> String {
    if is_plain_key(name) {
        name.to_string()
    } else {
        format!("\"{name}\"")
    }
}

fn entry_text(name: &str, value: &str) -> String {
    format!("{}: \"{}\"", key_text(name), value)
}

/// Block for a table that does not exist yet, appended at the end of the file.
fn fresh_block(table: Table, name: &str, value: &str, eol: &str) -> String {
    match table {
        Table::ModelRoles => [
            row(eol, 0, "modelRoles:"),
            row(eol, 2, &entry_text(name, value)),
        ]
        .concat(),
        Table::AgentModelOverrides => [
            row(eol, 0, "task:"),
            row(eol, 2, "agentModelOverrides:"),
            row(eol, 4, &entry_text(name, value)),
        ]
        .concat(),
    }
}

fn is_comment_only(text: &str) -> bool {
    text.lines().all(|line| {
        let trimmed = line.trim();
        trimmed.is_empty() || trimmed.starts_with('#')
    })
}

/// Applies non-overlapping splices to the original text, in order.
fn apply_splices(text: &str, mut splices: Vec<Splice>, label: &str) -> Result<String, String> {
    splices.sort_by_key(|splice| (splice.start, splice.end));
    let mut out = String::with_capacity(text.len() + 128);
    let mut cursor = 0usize;
    for splice in &splices {
        let valid = splice.start >= cursor
            && splice.end >= splice.start
            && splice.end <= text.len()
            && text.is_char_boundary(splice.start)
            && text.is_char_boundary(splice.end);
        if !valid {
            return Err(format!("{label}编辑范围冲突，拒绝写入"));
        }
        out.push_str(&text[cursor..splice.start]);
        out.push_str(&splice.text);
        cursor = splice.end;
    }
    out.push_str(&text[cursor..]);
    Ok(out)
}

// ---------- verification ----------

/// Accepts a spliced result only if it re-parses, keeps the exact comment sequence, and differs
/// from the original only at the target path (checked on the semantic values).
fn verify(original: &str, next: &str, op: &EditOp, label: &str) -> Result<(), String> {
    let refused = || format!("保格式校验失败（{label}），已拒绝写入，文件未修改");
    let before_cst = YamlFile::from_str(original).map_err(|_| refused())?;
    let after_cst = YamlFile::from_str(next).map_err(|_| refused())?;
    let before_comments: Vec<String> = before_cst
        .comments()
        .map(|comment| comment.text().to_string())
        .collect();
    let after_comments: Vec<String> = after_cst
        .comments()
        .map(|comment| comment.text().to_string())
        .collect();
    if before_comments != after_comments {
        return Err(refused());
    }
    let before = parse_yaml(original, label)?;
    let after = parse_yaml(next, label).map_err(|_| refused())?;

    let target = target_path(op);
    let mut expected = BTreeMap::new();
    leaves(&before, &mut Vec::new(), &mut expected);
    let prefix = format!("{target}{PATH_SEP}");
    expected.retain(|key, _| key != &target && !key.starts_with(&prefix));
    if let EditOp::Set { value, .. } = op {
        expected.insert(target.clone(), leaf_text(value));
    }
    let mut actual = BTreeMap::new();
    leaves(&after, &mut Vec::new(), &mut actual);
    if expected == actual {
        Ok(())
    } else {
        Err(refused())
    }
}

fn target_path(op: &EditOp) -> String {
    let (table, name) = match op {
        EditOp::Set { table, name, .. } | EditOp::Remove { table, name } => (*table, name.as_str()),
    };
    let mut segments: Vec<&str> = table.path().to_vec();
    segments.push(name);
    segments.join(PATH_SEP)
}

/// Flattens scalar leaves to `path -> debug text`. Null values count as absent, so an emptied
/// table that keeps its header compares equal to a removed one.
fn leaves(value: &Value, path: &mut Vec<String>, out: &mut BTreeMap<String, String>) {
    match value {
        Value::Null => {}
        Value::Mapping(map) => {
            for (key, child) in map.iter() {
                let segment = match key {
                    Value::String(text) => text.clone(),
                    other => format!("{other:?}"),
                };
                path.push(segment);
                leaves(child, path, out);
                path.pop();
            }
        }
        Value::Sequence(items) => {
            for (index, child) in items.iter().enumerate() {
                path.push(format!("[{index}]"));
                leaves(child, path, out);
                path.pop();
            }
        }
        leaf => {
            out.insert(path.join(PATH_SEP), format!("{leaf:?}"));
        }
    }
}

fn leaf_text(value: &str) -> String {
    format!("{:?}", Value::String(value.to_string()))
}

// ---------- writing ----------

fn write_edit(ctx: &Ctx, scope: Scope, op: &EditOp) -> Result<(), String> {
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (path, label) = match scope {
        Scope::Global => (global_config_path(ctx), GLOBAL_LABEL),
        Scope::Project => (
            project_config_path(ctx).ok_or_else(|| "未选择项目目录，无法写入项目层".to_string())?,
            PROJECT_LABEL,
        ),
    };
    // Fresh read under the lock: never edit a cached copy.
    let current = read_config(&path, label)?;
    if scope == Scope::Global
        && !current.exists
        && is_file(&ctx.agent_dir.join(LEGACY_SETTINGS_NAME))
    {
        return Err(
            "检测到旧版 settings.json；请先让 omp 迁移为 config.yml 后再设置模型角色，文件未修改"
                .to_string(),
        );
    }
    let Some(next) = plan_edit(&current.text, op, label)? else {
        return Ok(());
    };
    write_guarded(
        &path,
        current.exists.then_some(current.bytes.as_slice()),
        &next,
    )
}

/// Atomic replace. `expected` is the byte content the edit was computed from (`None` for a
/// missing file); a mismatch means another writer changed the file, so nothing is written.
fn write_guarded(path: &Path, expected: Option<&[u8]>, text: &str) -> Result<(), String> {
    let target = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            fs::canonicalize(path).map_err(|error| format!("无法解析符号链接：{error}"))?
        }
        _ => path.to_path_buf(),
    };
    let parent = target.parent().ok_or_else(|| "配置路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
    let current = match fs::read(&target) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("无法读取配置：{error}")),
    };
    if current.as_deref() != expected {
        return Err("配置文件已被其他进程修改，请重新读取后再试，文件未修改".to_string());
    }
    let permissions = fs::metadata(&target).ok().map(|meta| meta.permissions());
    let file_name = target.file_name().map_or_else(
        || PROJECT_CONFIG_NAME.to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let tmp = parent.join(format!(
        ".{file_name}.omp-roles-{}-{nonce}.tmp",
        std::process::id()
    ));
    if let Err(error) = write_then_rename(&tmp, &target, text, permissions) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("写入配置失败：{error}"));
    }
    Ok(())
}

fn write_then_rename(
    tmp: &Path,
    target: &Path,
    text: &str,
    permissions: Option<fs::Permissions>,
) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    drop(file);
    if let Some(permissions) = permissions {
        fs::set_permissions(tmp, permissions)?;
    }
    fs::rename(tmp, target)
}

// ---------- validation ----------

fn validate_name(raw: &str) -> Result<String, String> {
    let valid = !raw.is_empty()
        && raw == raw.trim()
        && raw.chars().count() <= MAX_NAME_CHARS
        && raw
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if valid {
        Ok(raw.to_string())
    } else {
        Err("名称只允许字母、数字与 - _ .，且不超过 128 字符".to_string())
    }
}

/// The `:level` suffix of an `@role:level` reference: one non-empty token in the name charset.
fn valid_level(level: &str) -> bool {
    !level.is_empty()
        && level
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn validate_value(raw: &str) -> Result<String, String> {
    const INVALID: &str =
        "模型值只允许 @角色名[:层级] 或 provider/model[:thinking]，不含空白、引号与逗号";
    if raw.is_empty() || raw != raw.trim() || raw.chars().count() > MAX_VALUE_CHARS {
        return Err(INVALID.to_string());
    }
    if let Some(reference) = raw.strip_prefix('@') {
        // `@role[:level]`: the role is everything before the first colon, as `split_level` reads it.
        let (role, level) = split_level(reference);
        let level_ok = match level {
            Some(level) => valid_level(level),
            None => true,
        };
        return match validate_name(role) {
            Ok(_) if level_ok => Ok(raw.to_string()),
            _ => Err(INVALID.to_string()),
        };
    }
    let Some((provider, model)) = raw.split_once('/') else {
        return Err(INVALID.to_string());
    };
    let provider_ok = !provider.is_empty()
        && provider
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'));
    let model_ok = !model.is_empty()
        && model
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '+'));
    if provider_ok && model_ok {
        Ok(raw.to_string())
    } else {
        Err(INVALID.to_string())
    }
}

fn parse_op(table: &str, name: &str, value: Option<String>) -> Result<EditOp, String> {
    let table = Table::parse(table)?;
    let name = validate_name(name)?;
    Ok(match value {
        Some(raw) => EditOp::Set {
            table,
            name,
            value: validate_value(&raw)?,
        },
        None => EditOp::Remove { table, name },
    })
}

/// Validates one stored selector value: either a single selector, or a comma list of selectors
/// (`selector_text` joins omp's string arrays with `,`). Whitespace is refused outright: the
/// stored projection never contains any.
pub(crate) fn validate_value_list(raw: &str) -> Result<String, String> {
    if raw.is_empty() {
        return Err("模型值不能为空".to_string());
    }
    if raw.chars().any(char::is_whitespace) {
        return Err("模型值不能包含空白；逗号列表请用半角逗号紧邻连接".to_string());
    }
    let parts: Vec<&str> = raw.split(',').collect();
    if parts.iter().any(|part| part.is_empty()) {
        return Err("模型值列表不能包含空项".to_string());
    }
    for part in parts {
        validate_value(part)?;
    }
    Ok(raw.to_string())
}

// ---------- bulk model replace (model_replace.rs) ----------

/// `modelRoles` / `task.agentModelOverrides` of one config file, read for the
/// bulk-replace scan. Values are the comma-joined selector projection.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LayerRefs {
    pub(crate) model_roles: BTreeMap<String, String>,
    pub(crate) overrides: BTreeMap<String, String>,
}

/// Global omp config file (`config.yml`, or `config.yaml` when only that exists).
pub(crate) fn global_config_file() -> Result<PathBuf, String> {
    let ctx = Ctx::resolve(None)?;
    Ok(global_config_path(&ctx))
}

/// Reads the two model tables of one config file. A missing file is not an error.
pub(crate) fn layer_refs(path: &Path, label: &str) -> Result<LayerRefs, String> {
    let file = read_config(path, label)?;
    let root = parse_yaml(&file.text, label)?;
    let values = project_layer(&root);
    Ok(LayerRefs {
        model_roles: values.model_roles,
        overrides: values.overrides,
    })
}

/// Outcome of [`replace_value`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReplaceOutcome {
    /// The entry no longer holds the expected value; nothing was written.
    Stale,
    /// The entry was already the requested value; nothing was written.
    Unchanged,
    /// The file was written.
    Written,
}

/// Guarded single-entry edit for the bulk model replace flow.
///
/// One read-modify-write of one `modelRoles` / `task.agentModelOverrides` entry under
/// [`WRITE_LOCK`], reusing the lossless planner ([`plan_edit`]) and the guarded atomic writer
/// ([`write_guarded`]). The edit is refused as [`ReplaceOutcome::Stale`] when the entry no
/// longer projects to `before`, so a concurrent change is never overwritten. A YAML sequence
/// value is written back as its comma-joined scalar equivalent.
pub(crate) fn replace_value(
    cwd: Option<&str>,
    scope: &str,
    table: &str,
    name: &str,
    before: &str,
    after: &str,
) -> Result<ReplaceOutcome, String> {
    edit_value(cwd, scope, table, name, before, after, true)
}

/// [`replace_value`] for undo: restores a value that was already stored in the file, so the
/// new-value syntax check is skipped (an older file may legitimately hold a list with spaces,
/// e.g. `"p/a, p/a"`, which the forward editor would reject). The `before` guard and the YAML
/// fidelity check still apply.
pub(crate) fn restore_value(
    cwd: Option<&str>,
    scope: &str,
    table: &str,
    name: &str,
    before: &str,
    after: &str,
) -> Result<ReplaceOutcome, String> {
    edit_value(cwd, scope, table, name, before, after, false)
}

fn edit_value(
    cwd: Option<&str>,
    scope: &str,
    table: &str,
    name: &str,
    before: &str,
    after: &str,
    validate: bool,
) -> Result<ReplaceOutcome, String> {
    let scope = Scope::parse(scope)?;
    let table = Table::parse(table)?;
    let name = validate_name(name)?;
    let after = if validate {
        validate_value_list(after)?
    } else {
        after.to_string()
    };
    let ctx = Ctx::resolve(cwd)?;
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (path, label) = match scope {
        Scope::Global => (global_config_path(&ctx), GLOBAL_LABEL),
        Scope::Project => (
            project_config_path(&ctx)
                .ok_or_else(|| "未选择项目目录，无法写入项目层".to_string())?,
            PROJECT_LABEL,
        ),
    };
    // Fresh read under the lock: never edit a cached copy.
    let current = read_config(&path, label)?;
    if scope == Scope::Global
        && !current.exists
        && is_file(&ctx.agent_dir.join(LEGACY_SETTINGS_NAME))
    {
        return Err(
            "检测到旧版 settings.json；请先让 omp 迁移为 config.yml 后再设置模型角色，文件未修改"
                .to_string(),
        );
    }
    let values = project_layer(&parse_yaml(&current.text, label)?);
    let stored = match table {
        Table::ModelRoles => values.model_roles.get(&name),
        Table::AgentModelOverrides => values.overrides.get(&name),
    };
    if stored.map(String::as_str) != Some(before) {
        return Ok(ReplaceOutcome::Stale);
    }
    let op = EditOp::Set {
        table,
        name,
        value: after,
    };
    let Some(next) = plan_edit(&current.text, &op, label)? else {
        return Ok(ReplaceOutcome::Unchanged);
    };
    write_guarded(
        &path,
        current.exists.then_some(current.bytes.as_slice()),
        &next,
    )?;
    Ok(ReplaceOutcome::Written)
}

/// Project config file (`<project>/.omp/config.yml`); it may not exist yet.
pub(crate) fn project_config_file(project: &Path) -> PathBuf {
    project.join(OMP_DIR).join(PROJECT_CONFIG_NAME)
}

/// Guarded multi-entry edit for the model-template apply flow.
///
/// One read-modify-write of several `modelRoles` entries under [`WRITE_LOCK`]: the target
/// layer's config (global when `project` is `None`, else `<project>/.omp/config.yml`) is read
/// once, every op is planned in memory with [`plan_edit`] against the previous plan's output, and
/// the final document is written once with [`write_guarded`] using the bytes that were read as
/// the guard (`None` for a missing file). Any op that fails to plan aborts the whole batch
/// before anything is written, so a template is applied completely or not at all.
///
/// A missing project file is created (with its `.omp/` directory) only when at least one op sets
/// a value; a failed write removes the directory it just created, so no half-made project
/// config is ever left behind.
pub(crate) fn write_role_batch(
    project: Option<&Path>,
    ops: &[(String, Option<String>)],
) -> Result<(), String> {
    if ops.is_empty() {
        return Ok(());
    }
    let project_text = project.map(path_text);
    let ctx = Ctx::resolve(project_text.as_deref())?;
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (path, label) = match project_config_path(&ctx) {
        Some(path) => (path, PROJECT_LABEL),
        None => (global_config_path(&ctx), GLOBAL_LABEL),
    };
    // Fresh read under the lock: never edit a cached copy.
    let current = read_config(&path, label)?;
    if project.is_none() && !current.exists && is_file(&ctx.agent_dir.join(LEGACY_SETTINGS_NAME)) {
        return Err(
            "检测到旧版 settings.json；请先让 omp 迁移为 config.yml 后再设置模型角色，文件未修改"
                .to_string(),
        );
    }
    // `None` = nothing planned yet, so the read document is still the source.
    let mut planned: Option<String> = None;
    for (name, value) in ops {
        let name = validate_name(name)?;
        // A captured template may hold omp's comma-joined selector list, so list values are
        // accepted here even though a single role edit only ever writes one selector.
        let op = match value {
            Some(raw) => EditOp::Set {
                table: Table::ModelRoles,
                name,
                value: validate_value_list(raw)?,
            },
            None => EditOp::Remove {
                table: Table::ModelRoles,
                name,
            },
        };
        let source = planned.as_deref().unwrap_or(&current.text);
        if let Some(next) = plan_edit(source, &op, label)? {
            planned = Some(next);
        }
    }
    // Every op was already satisfied, or no op had anything to change.
    let Some(next) = planned else {
        return Ok(());
    };
    let created_dir = if current.exists {
        None
    } else {
        path.parent().filter(|dir| !dir.exists())
    };
    let written = write_guarded(
        &path,
        current.exists.then_some(current.bytes.as_slice()),
        &next,
    );
    if written.is_err() {
        if let Some(dir) = created_dir {
            // Only removes an empty directory, so anything else in there is left alone.
            let _ = fs::remove_dir(dir);
        }
    }
    written
}

fn normalize_session(raw: Option<String>) -> Option<String> {
    raw.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

// ---------- commands ----------

/// Reads both layers and every discovered agent. `cwd` null = global layer only.
#[tauri::command]
pub async fn omp_model_roles_read(
    cwd: Option<String>,
    session_model: Option<String>,
) -> Result<ModelRoleSnapshot, String> {
    run_blocking(move || read_snapshot(cwd, session_model)).await
}

/// Sets (`value` = Some) or removes (`value` = None) one entry in one scope, then returns the
/// re-read snapshot.
#[tauri::command]
pub async fn omp_model_roles_set(
    cwd: Option<String>,
    scope: String,
    table: String,
    name: String,
    value: Option<String>,
    session_model: Option<String>,
) -> Result<ModelRoleSnapshot, String> {
    run_blocking(move || set_entry(cwd, scope, table, name, value, session_model)).await
}

/// Sync core of `omp_model_roles_read`.
fn read_snapshot(
    cwd: Option<String>,
    session_model: Option<String>,
) -> Result<ModelRoleSnapshot, String> {
    let ctx = Ctx::resolve(cwd.as_deref())?;
    let session = normalize_session(session_model);
    build_snapshot(&ctx, session.as_deref())
}

/// Sync core of `omp_model_roles_set`.
fn set_entry(
    cwd: Option<String>,
    scope: String,
    table: String,
    name: String,
    value: Option<String>,
    session_model: Option<String>,
) -> Result<ModelRoleSnapshot, String> {
    let scope = Scope::parse(&scope)?;
    let op = parse_op(&table, &name, value)?;
    let ctx = Ctx::resolve(cwd.as_deref())?;
    let session = normalize_session(session_model);
    write_edit(&ctx, scope, &op)?;
    build_snapshot(&ctx, session.as_deref())
}

async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| format!("后台任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(lines: &[&str]) -> String {
        let mut text = lines.join("\n");
        text.push('\n');
        text
    }

    fn set(table: Table, name: &str, value: &str) -> EditOp {
        EditOp::Set {
            table,
            name: name.to_string(),
            value: value.to_string(),
        }
    }

    fn remove(table: Table, name: &str) -> EditOp {
        EditOp::Remove {
            table,
            name: name.to_string(),
        }
    }

    fn plan(original: &str, op: &EditOp) -> Result<Option<String>, String> {
        plan_edit(original, op, "测试")
    }

    /// Synthetic fixture: the placeholder is not a credential; flow values and a block scalar
    /// are unknown keys that must survive every edit byte for byte.
    fn fixture() -> String {
        doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # inline theme",
            "providers:",
            "  demo:",
            "    apiKey: \"SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL\" # placeholder inline",
            "    models: [alpha, beta] # unknown flow sequence",
            "    limits: {rpm: 60, burst: [1, 2]} # unknown flow mapping",
            "    description: |",
            "      multi line",
            "      other field",
            "# before modelRoles",
            "modelRoles:",
            "  # before smol",
            "  smol: \"g/fast\" # inline smol",
            "  task: \"g/task\"",
            "task:",
            "  spawns: \"*\" # keep spawns",
            "  agentModelOverrides:",
            "    scout: \"g/scout\" # inline scout",
            "# tail comment",
        ])
    }

    #[test]
    fn update_role_keeps_inline_comment_and_every_other_byte() {
        let expected = doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # inline theme",
            "providers:",
            "  demo:",
            "    apiKey: \"SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL\" # placeholder inline",
            "    models: [alpha, beta] # unknown flow sequence",
            "    limits: {rpm: 60, burst: [1, 2]} # unknown flow mapping",
            "    description: |",
            "      multi line",
            "      other field",
            "# before modelRoles",
            "modelRoles:",
            "  # before smol",
            "  smol: \"p/fast\" # inline smol",
            "  task: \"g/task\"",
            "task:",
            "  spawns: \"*\" # keep spawns",
            "  agentModelOverrides:",
            "    scout: \"g/scout\" # inline scout",
            "# tail comment",
        ]);
        assert_eq!(
            plan(&fixture(), &set(Table::ModelRoles, "smol", "p/fast")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn update_override_in_task_table_keeps_siblings() {
        let expected = doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # inline theme",
            "providers:",
            "  demo:",
            "    apiKey: \"SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL\" # placeholder inline",
            "    models: [alpha, beta] # unknown flow sequence",
            "    limits: {rpm: 60, burst: [1, 2]} # unknown flow mapping",
            "    description: |",
            "      multi line",
            "      other field",
            "# before modelRoles",
            "modelRoles:",
            "  # before smol",
            "  smol: \"g/fast\" # inline smol",
            "  task: \"g/task\"",
            "task:",
            "  spawns: \"*\" # keep spawns",
            "  agentModelOverrides:",
            "    scout: \"@smol\" # inline scout",
            "# tail comment",
        ]);
        assert_eq!(
            plan(
                &fixture(),
                &set(Table::AgentModelOverrides, "scout", "@smol")
            ),
            Ok(Some(expected))
        );
    }

    #[test]
    fn add_role_goes_after_last_entry_and_keeps_following_comment_in_place() {
        let expected = doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # inline theme",
            "providers:",
            "  demo:",
            "    apiKey: \"SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL\" # placeholder inline",
            "    models: [alpha, beta] # unknown flow sequence",
            "    limits: {rpm: 60, burst: [1, 2]} # unknown flow mapping",
            "    description: |",
            "      multi line",
            "      other field",
            "# before modelRoles",
            "modelRoles:",
            "  # before smol",
            "  smol: \"g/fast\" # inline smol",
            "  task: \"g/task\"",
            "  default: \"@smol\"",
            "task:",
            "  spawns: \"*\" # keep spawns",
            "  agentModelOverrides:",
            "    scout: \"g/scout\" # inline scout",
            "# tail comment",
        ]);
        assert_eq!(
            plan(&fixture(), &set(Table::ModelRoles, "default", "@smol")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn add_override_goes_after_last_override() {
        let expected = doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # inline theme",
            "providers:",
            "  demo:",
            "    apiKey: \"SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL\" # placeholder inline",
            "    models: [alpha, beta] # unknown flow sequence",
            "    limits: {rpm: 60, burst: [1, 2]} # unknown flow mapping",
            "    description: |",
            "      multi line",
            "      other field",
            "# before modelRoles",
            "modelRoles:",
            "  # before smol",
            "  smol: \"g/fast\" # inline smol",
            "  task: \"g/task\"",
            "task:",
            "  spawns: \"*\" # keep spawns",
            "  agentModelOverrides:",
            "    scout: \"g/scout\" # inline scout",
            "    reviewer: \"@slow\"",
            "# tail comment",
        ]);
        assert_eq!(
            plan(
                &fixture(),
                &set(Table::AgentModelOverrides, "reviewer", "@slow")
            ),
            Ok(Some(expected))
        );
    }

    #[test]
    fn delete_role_with_comment_keeps_the_comment_line() {
        let expected = doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # inline theme",
            "providers:",
            "  demo:",
            "    apiKey: \"SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL\" # placeholder inline",
            "    models: [alpha, beta] # unknown flow sequence",
            "    limits: {rpm: 60, burst: [1, 2]} # unknown flow mapping",
            "    description: |",
            "      multi line",
            "      other field",
            "# before modelRoles",
            "modelRoles:",
            "  # before smol",
            "  # inline smol",
            "  task: \"g/task\"",
            "task:",
            "  spawns: \"*\" # keep spawns",
            "  agentModelOverrides:",
            "    scout: \"g/scout\" # inline scout",
            "# tail comment",
        ]);
        assert_eq!(
            plan(&fixture(), &remove(Table::ModelRoles, "smol")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn delete_role_without_comment_removes_its_line_only() {
        let expected = doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # inline theme",
            "providers:",
            "  demo:",
            "    apiKey: \"SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL\" # placeholder inline",
            "    models: [alpha, beta] # unknown flow sequence",
            "    limits: {rpm: 60, burst: [1, 2]} # unknown flow mapping",
            "    description: |",
            "      multi line",
            "      other field",
            "# before modelRoles",
            "modelRoles:",
            "  # before smol",
            "  smol: \"g/fast\" # inline smol",
            "task:",
            "  spawns: \"*\" # keep spawns",
            "  agentModelOverrides:",
            "    scout: \"g/scout\" # inline scout",
            "# tail comment",
        ]);
        assert_eq!(
            plan(&fixture(), &remove(Table::ModelRoles, "task")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn delete_override_with_comment_keeps_comment_and_header() {
        let expected = doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # inline theme",
            "providers:",
            "  demo:",
            "    apiKey: \"SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL\" # placeholder inline",
            "    models: [alpha, beta] # unknown flow sequence",
            "    limits: {rpm: 60, burst: [1, 2]} # unknown flow mapping",
            "    description: |",
            "      multi line",
            "      other field",
            "# before modelRoles",
            "modelRoles:",
            "  # before smol",
            "  smol: \"g/fast\" # inline smol",
            "  task: \"g/task\"",
            "task:",
            "  spawns: \"*\" # keep spawns",
            "  agentModelOverrides:",
            "    # inline scout",
            "# tail comment",
        ]);
        assert_eq!(
            plan(&fixture(), &remove(Table::AgentModelOverrides, "scout")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn delete_last_role_keeps_attached_comments_and_header() {
        let original = doc(&[
            "modelRoles:",
            "  # before only",
            "  only: \"g/only\" # inline only",
        ]);
        let expected = doc(&["modelRoles:", "  # before only", "  # inline only"]);
        assert_eq!(
            plan(&original, &remove(Table::ModelRoles, "only")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn delete_last_role_without_comments_removes_header_too() {
        let original = doc(&[
            "theme: dark",
            "modelRoles:",
            "  only: \"g/only\"",
            "tail: 1",
        ]);
        let expected = doc(&["theme: dark", "tail: 1"]);
        assert_eq!(
            plan(&original, &remove(Table::ModelRoles, "only")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn delete_last_override_without_comment_removes_its_header_and_keeps_task() {
        let original = doc(&[
            "task:",
            "  spawns: \"*\"",
            "  agentModelOverrides:",
            "    scout: \"g/scout\"",
        ]);
        let expected = doc(&["task:", "  spawns: \"*\""]);
        assert_eq!(
            plan(&original, &remove(Table::AgentModelOverrides, "scout")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn null_table_gets_its_first_entry_after_the_header_line() {
        let original = doc(&[
            "modelRoles: # header comment",
            "# root comment",
            "theme: dark",
        ]);
        let expected = doc(&[
            "modelRoles: # header comment",
            "  smol: \"x\"",
            "# root comment",
            "theme: dark",
        ]);
        assert_eq!(
            plan(&original, &set(Table::ModelRoles, "smol", "x")),
            Ok(Some(expected))
        );
    }

    #[test]
    fn absent_table_is_appended_and_missing_final_newline_stays_missing() {
        let with_newline = doc(&["theme: dark # keep"]);
        assert_eq!(
            plan(&with_newline, &set(Table::ModelRoles, "smol", "x")),
            Ok(Some(doc(&[
                "theme: dark # keep",
                "modelRoles:",
                "  smol: \"x\""
            ])))
        );
        assert_eq!(
            plan("theme: dark", &set(Table::ModelRoles, "smol", "x")),
            Ok(Some("theme: dark\nmodelRoles:\n  smol: \"x\"".to_string()))
        );
    }

    #[test]
    fn override_creates_task_when_absent() {
        let original = doc(&["theme: dark"]);
        let expected = doc(&[
            "theme: dark",
            "task:",
            "  agentModelOverrides:",
            "    scout: \"@smol\"",
        ]);
        assert_eq!(
            plan(
                &original,
                &set(Table::AgentModelOverrides, "scout", "@smol")
            ),
            Ok(Some(expected))
        );
    }

    #[test]
    fn override_table_is_added_under_existing_task() {
        let original = doc(&["task:", "  spawns: \"*\" # keep", "  maxConcurrency: 2"]);
        let expected = doc(&[
            "task:",
            "  spawns: \"*\" # keep",
            "  maxConcurrency: 2",
            "  agentModelOverrides:",
            "    scout: \"@smol\"",
        ]);
        assert_eq!(
            plan(
                &original,
                &set(Table::AgentModelOverrides, "scout", "@smol")
            ),
            Ok(Some(expected))
        );
    }

    #[test]
    fn flow_tables_and_multiline_targets_are_refused() {
        assert!(plan(
            "modelRoles: {smol: a}\n",
            &set(Table::ModelRoles, "smol", "b")
        )
        .is_err());
        assert!(plan(
            "task:\n  agentModelOverrides: {scout: a}\n",
            &set(Table::AgentModelOverrides, "scout", "b"),
        )
        .is_err());
        assert!(plan(
            "modelRoles:\n  smol: |\n    a\n    b\n",
            &set(Table::ModelRoles, "smol", "b"),
        )
        .is_err());
    }

    #[test]
    fn crlf_files_keep_crlf_and_every_byte() {
        assert_eq!(
            plan(
                "modelRoles:\r\n  smol: \"g/fast\" # c\r\n",
                &set(Table::ModelRoles, "smol", "p/fast"),
            ),
            Ok(Some(
                "modelRoles:\r\n  smol: \"p/fast\" # c\r\n".to_string()
            ))
        );
        assert_eq!(
            plan(
                "modelRoles:\r\n  smol: \"g/fast\"\r\n",
                &set(Table::ModelRoles, "task", "x"),
            ),
            Ok(Some(
                "modelRoles:\r\n  smol: \"g/fast\"\r\n  task: \"x\"\r\n".to_string()
            ))
        );
    }

    #[test]
    fn comment_only_and_empty_files_get_one_block() {
        assert_eq!(
            plan("# only comment\n", &set(Table::ModelRoles, "smol", "x")),
            Ok(Some(
                "# only comment\nmodelRoles:\n  smol: \"x\"\n".to_string()
            ))
        );
        assert_eq!(
            plan("", &set(Table::ModelRoles, "smol", "x")),
            Ok(Some("modelRoles:\n  smol: \"x\"\n".to_string()))
        );
    }

    #[test]
    fn bom_and_invalid_yaml_are_refused() {
        assert!(plan(
            "\u{feff}modelRoles:\n  a: \"b\"\n",
            &set(Table::ModelRoles, "a", "c")
        )
        .is_err());
        assert!(plan("modelRoles: [\n", &set(Table::ModelRoles, "a", "c")).is_err());
    }

    #[test]
    fn missing_entry_and_unchanged_value_are_noops() {
        assert_eq!(
            plan(&fixture(), &remove(Table::ModelRoles, "absent")),
            Ok(None)
        );
        assert_eq!(
            plan(&fixture(), &set(Table::ModelRoles, "smol", "g/fast")),
            Ok(None)
        );
    }

    #[test]
    fn resolution_follows_project_over_global_and_detects_cycles() {
        let mut global = BTreeMap::new();
        global.insert("smol".to_string(), "g/fast".to_string());
        global.insert("a".to_string(), "@b".to_string());
        global.insert("b".to_string(), "@a".to_string());
        let mut project = BTreeMap::new();
        project.insert("smol".to_string(), "p/fast".to_string());
        let roles = Layered {
            global: &global,
            project: Some(&project),
        };
        match resolve_selector(&roles, "@smol", &mut Vec::new()) {
            Resolution::Model { model, layer, .. } => {
                assert_eq!(model, "p/fast");
                assert_eq!(layer, Some(Layer::Project));
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(matches!(
            resolve_selector(&roles, "@a", &mut Vec::new()),
            Resolution::Cycle { .. }
        ));
        assert!(matches!(
            resolve_selector(&roles, "@nope", &mut Vec::new()),
            Resolution::Unknown { .. }
        ));
    }

    #[test]
    fn validation_rejects_unsafe_names_and_values() {
        assert!(validate_name("a b").is_err());
        assert!(validate_name("security-reviewer").is_ok());
        assert!(validate_value("@").is_err());
        assert!(validate_value("@smol:high").is_ok());
        assert!(validate_value("anthropic/claude-sonnet-4-5:high").is_ok());
        assert!(validate_value("x y").is_err());
        assert!(validate_value("a@b").is_err());
    }

    /// omp reads a role as either a scalar or a list (joined with `,`), so a
    /// sequence-valued entry must be editable: the whole sequence is replaced by
    /// the equivalent quoted scalar, and the value verifies.
    #[test]
    fn sequence_role_value_is_editable_and_verifies() {
        let original =
            "modelRoles:\n  default:\n    - \"p/a\"\n    - \"p/b\"\n  smol: \"g/fast\"\n";
        let next = plan(original, &set(Table::ModelRoles, "default", "p/c,p/d"))
            .expect("plan")
            .expect("changed");
        assert_eq!(
            next,
            "modelRoles:\n  default: \"p/c,p/d\"\n  smol: \"g/fast\"\n"
        );
        // Flow style is one span too.
        let flow = "modelRoles:\n  default: [\"p/a\", \"p/b\"]\n";
        let next = plan(flow, &set(Table::ModelRoles, "default", "p/c"))
            .expect("plan")
            .expect("changed");
        assert_eq!(next, "modelRoles:\n  default: \"p/c\"\n");
        // Removal deletes the whole sequence entry, keeping siblings.
        let next = plan(original, &remove(Table::ModelRoles, "default"))
            .expect("plan")
            .expect("changed");
        assert_eq!(next, "modelRoles:\n  smol: \"g/fast\"\n");
    }

    /// Undo restores a value that was already in the file; the forward-only
    /// syntax check must not reject it (an older value may contain spaces).
    #[test]
    fn restore_accepts_legacy_spaced_value_that_forward_edit_rejects() {
        assert!(validate_value_list("p/a, p/a").is_err());
        let project = batch_project_dir("restore");
        fs::create_dir_all(project.join(OMP_DIR)).expect("project dir");
        let config = project_config_file(&project);
        fs::write(&config, "modelRoles:\n  default: \"p/b,p/b\"\n").expect("fixture");

        // Forward edit to the legacy spaced value is refused.
        let err = replace_value(
            Some(project.to_str().unwrap()),
            "project",
            "modelRoles",
            "default",
            "p/b,p/b",
            "p/a, p/a",
        )
        .unwrap_err();
        assert!(err.contains("不能包含空白"), "{err}");
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            "modelRoles:\n  default: \"p/b,p/b\"\n"
        );

        // Undo writes it back.
        assert_eq!(
            restore_value(
                Some(project.to_str().unwrap()),
                "project",
                "modelRoles",
                "default",
                "p/b,p/b",
                "p/a, p/a",
            )
            .unwrap(),
            ReplaceOutcome::Written
        );
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            "modelRoles:\n  default: \"p/a, p/a\"\n"
        );
        let _ = fs::remove_dir_all(&project);
    }

    /// Bridge smoke: the same code path as the Tauri commands, on fixtures under `.cache`.
    #[test]
    fn smoke_bridge_writes_exact_bytes_and_projects_contract_shape() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/model-roles-smoke")
            .join(format!("{}-bridge", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let home = root.join("home");
        let agent_dir = home.join(".omp/agent");
        let project = root.join("repo");
        fs::create_dir_all(&agent_dir).expect("agent dir");
        fs::create_dir_all(project.join(".omp/agents")).expect("project agents dir");
        let global_before = "theme: dark\nmodelRoles:\n  smol: \"g/fast\" # keep\n";
        fs::write(agent_dir.join("config.yml"), global_before).expect("global fixture");
        fs::write(
            project.join(".omp/agents/proj.md"),
            "---\nname: proj\ndescription: project agent\nmodel: \"@smol\"\n---\nbody\n",
        )
        .expect("project agent fixture");
        let ctx = Ctx {
            home,
            agent_dir: agent_dir.clone(),
            project_dir: Some(project.clone()),
        };

        write_edit(
            &ctx,
            Scope::Project,
            &set(Table::ModelRoles, "smol", "p/fast"),
        )
        .expect("project set");
        assert_eq!(
            fs::read_to_string(project.join(".omp/config.yml")).expect("project file"),
            "modelRoles:\n  smol: \"p/fast\"\n"
        );
        assert_eq!(
            fs::read_to_string(agent_dir.join("config.yml")).expect("global file"),
            global_before
        );

        let snapshot = build_snapshot(&ctx, Some("anthropic/session")).expect("snapshot");
        let json = serde_json::to_value(&snapshot).expect("json");
        assert_eq!(json["global"]["modelRoles"]["smol"], "g/fast");
        assert_eq!(json["project"]["modelRoles"]["smol"], "p/fast");
        let agents = json["agents"].as_array().expect("agents array");
        let proj = agents
            .iter()
            .find(|agent| agent["name"] == "proj")
            .expect("project agent discovered");
        assert_eq!(proj["source"], "project");
        assert_eq!(proj["declaredModel"], "@smol");
        assert_eq!(proj["effectiveModel"], "p/fast");
        assert_eq!(proj["effectiveSource"], "project");
        let scout = agents
            .iter()
            .find(|agent| agent["name"] == "scout")
            .expect("bundled scout discovered");
        assert_eq!(scout["source"], "builtin");
    }

    fn batch_project_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ompws-roles-batch-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("project dir");
        dir
    }

    fn ops(items: &[(&str, Option<&str>)]) -> Vec<(String, Option<String>)> {
        items
            .iter()
            .map(|(name, value)| (name.to_string(), value.map(str::to_string)))
            .collect()
    }

    #[test]
    fn project_batch_creates_missing_file_with_only_model_roles() {
        let project = batch_project_dir("create");
        write_role_batch(
            Some(&project),
            &ops(&[("default", Some("a/b")), ("smol", Some("c/d:high"))]),
        )
        .expect("batch");
        let file = project_config_file(&project);
        let text = fs::read_to_string(&file).expect("created file");
        assert!(text.starts_with("modelRoles:"), "{text}");
        let refs = layer_refs(&file, PROJECT_LABEL).expect("refs");
        assert_eq!(
            refs.model_roles.get("default").map(String::as_str),
            Some("a/b")
        );
        assert_eq!(
            refs.model_roles.get("smol").map(String::as_str),
            Some("c/d:high")
        );
        assert_eq!(refs.model_roles.len(), 2);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn project_batch_updates_existing_file_losslessly() {
        let project = batch_project_dir("lossless");
        let file = project_config_file(&project);
        fs::create_dir_all(file.parent().expect("parent")).expect(".omp dir");
        fs::write(
            &file,
            "# top note\ntheme: dark\nmodelRoles:\n  smol: \"g/fast\" # keep me\n  slow: \"g/slow\"\n",
        )
        .expect("fixture");
        write_role_batch(
            Some(&project),
            &ops(&[("default", Some("a/b")), ("slow", None)]),
        )
        .expect("batch");
        let text = fs::read_to_string(&file).expect("file");
        assert!(text.starts_with("# top note\ntheme: dark\n"), "{text}");
        assert!(text.contains("# keep me"), "{text}");
        let refs = layer_refs(&file, PROJECT_LABEL).expect("refs");
        assert_eq!(
            refs.model_roles.get("default").map(String::as_str),
            Some("a/b")
        );
        assert_eq!(
            refs.model_roles.get("smol").map(String::as_str),
            Some("g/fast")
        );
        assert!(!refs.model_roles.contains_key("slow"));
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn failed_project_batch_leaves_no_file_or_directory() {
        let project = batch_project_dir("atomic");
        // The second op is invalid, so planning aborts before anything is written.
        let error = write_role_batch(
            Some(&project),
            &ops(&[("default", Some("a/b")), ("bad name", Some("c/d"))]),
        )
        .expect_err("invalid op");
        assert!(!error.is_empty());
        assert!(!project.join(OMP_DIR).exists());
        // Removing keys from a project that has no file is a no-op and creates nothing.
        write_role_batch(Some(&project), &ops(&[("default", None)])).expect("noop");
        assert!(!project.join(OMP_DIR).exists());
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn project_batch_rejects_missing_or_relative_directories() {
        let project = batch_project_dir("gone");
        let _ = fs::remove_dir_all(&project);
        assert!(write_role_batch(Some(&project), &ops(&[("default", Some("a/b"))])).is_err());
        assert!(!project.exists());
        assert!(write_role_batch(
            Some(Path::new("relative/dir")),
            &ops(&[("default", Some("a/b"))])
        )
        .is_err());
    }
}
