//! [providers] Read-only scanner for OMP global configurations.
//! Discovers providers and models configured across `models.yml`, `models-snippet.yml`,
//! `config.yml`, and `agent.db` under `~/.omp/agent/`.
//!
//! Zero-exposure invariant: Secret key values are NEVER read, stored, printed,
//! or returned. Only presence (`has_api_key`) or env var reference (`api_key_env`)
//! is recorded.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::contracts::OmpProviderInfo;

#[derive(Debug, Default, Clone)]
pub struct RawParsedProvider {
    pub id: String,
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub has_api_key: bool,
    pub api_key_env: Option<String>,
    pub model_ids: Vec<String>,
    pub has_provider_markers: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum SubSection {
    Models,
    ModelOverrides,
}

/// Parse provider blocks from a YAML text (`models.yml` or `config.yml` format).
/// Indentation-based line scan matching OMP's machine-written config structures.
pub fn parse_yaml_providers(text: &str, require_markers: bool) -> Vec<RawParsedProvider> {
    let mut providers: Vec<RawParsedProvider> = Vec::new();
    let mut in_providers = false;
    let mut base_indent = 0;
    let mut child_indent: Option<usize> = None;

    let mut current_provider: Option<RawParsedProvider> = None;
    let mut current_section: Option<SubSection> = None;
    let mut section_indent = 0;
    let mut section_child_indent: Option<usize> = None;

    let flush_current = |current: &mut Option<RawParsedProvider>,
                         providers: &mut Vec<RawParsedProvider>| {
        if let Some(p) = current.take() {
            if !require_markers || p.has_provider_markers {
                providers.push(p);
            }
        }
    };

    for raw in text.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();

        if !in_providers {
            if trimmed == "providers:" {
                in_providers = true;
                base_indent = indent;
                child_indent = None;
            }
            continue;
        }

        // Check if we exited the top-level providers: block
        if indent <= base_indent {
            flush_current(&mut current_provider, &mut providers);
            if trimmed == "providers:" {
                base_indent = indent;
                child_indent = None;
            } else {
                in_providers = false;
            }
            continue;
        }

        // Establish child indentation level under providers:
        match child_indent {
            None => {
                child_indent = Some(indent);
            }
            Some(ci) => {
                if indent < ci {
                    flush_current(&mut current_provider, &mut providers);
                    in_providers = false;
                    continue;
                }
            }
        }

        let ci = child_indent.unwrap();
        if indent == ci {
            // New provider child key under providers:
            flush_current(&mut current_provider, &mut providers);
            current_section = None;
            section_child_indent = None;

            if let Some((k, _)) = trimmed.split_once(':') {
                let id = k.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
                if !id.is_empty() {
                    current_provider = Some(RawParsedProvider {
                        id,
                        ..Default::default()
                    });
                }
            }
            continue;
        }

        // We are inside a provider's subtree (indent > ci)
        let Some(prov) = &mut current_provider else {
            continue;
        };

        // Check sub-sections (models / modelOverrides)
        if let Some(sec) = &current_section {
            if indent > section_indent {
                match sec {
                    SubSection::Models => match section_child_indent {
                        None => section_child_indent = Some(indent),
                        Some(sc_indent) if indent < sc_indent => {
                            current_section = None;
                        }
                        _ => {}
                    },
                    SubSection::ModelOverrides => {
                        match section_child_indent {
                            None => section_child_indent = Some(indent),
                            Some(sc_indent) if indent != sc_indent => {
                                // Deeper nested fields inside a model override (e.g. compactionModel)
                                continue;
                            }
                            _ => {}
                        }
                    }
                }
            } else {
                // Exited sub-section
                current_section = None;
                section_child_indent = None;
            }
        }

        if let Some(sec) = &current_section {
            match sec {
                SubSection::Models => {
                    if let Some(rest) = trimmed.strip_prefix("- ") {
                        let item = rest.trim();
                        let model_id = if let Some((k, v)) = item.split_once(':') {
                            if k.trim() == "id" {
                                v.trim().trim_matches(|c| c == '"' || c == '\'')
                            } else {
                                ""
                            }
                        } else {
                            item.trim_matches(|c| c == '"' || c == '\'')
                        };
                        if !model_id.is_empty() && !prov.model_ids.iter().any(|m| m == model_id) {
                            prov.model_ids.push(model_id.to_string());
                        }
                    } else if let Some((k, _)) = trimmed.split_once(':') {
                        let k = k.trim().trim_matches(|c| c == '"' || c == '\'');
                        if !k.is_empty() && k != "id" && !prov.model_ids.iter().any(|m| m == k) {
                            prov.model_ids.push(k.to_string());
                        }
                    }
                    continue;
                }
                SubSection::ModelOverrides => {
                    if let Some((k, _)) = trimmed.split_once(':') {
                        let k = k.trim().trim_matches(|c| c == '"' || c == '\'');
                        if !k.is_empty() && !prov.model_ids.iter().any(|m| m == k) {
                            prov.model_ids.push(k.to_string());
                        }
                    }
                    continue;
                }
            }
        }

        // Subtree property lines (baseUrl, api, apiKey, models, modelOverrides, etc.)
        if let Some((k, v)) = trimmed.split_once(':') {
            let key = k.trim().trim_matches(|c| c == '"' || c == '\'');
            let mut val = v.trim();
            if let Some((before_comment, _)) = val.split_once('#') {
                val = before_comment.trim();
            }
            let val = val.trim_matches(|c| c == '"' || c == '\'');

            if key.eq_ignore_ascii_case("baseUrl") || key == "base_url" {
                prov.has_provider_markers = true;
                if !val.is_empty() {
                    prov.base_url = Some(val.to_string());
                }
            } else if key.eq_ignore_ascii_case("api") {
                prov.has_provider_markers = true;
                if !val.is_empty() {
                    prov.api = Some(val.to_string());
                }
            } else if key.eq_ignore_ascii_case("apiKey") || key == "api_key" {
                prov.has_provider_markers = true;
                if val.starts_with('$') {
                    let env_name = val
                        .trim_start_matches('$')
                        .trim_start_matches('{')
                        .trim_end_matches('}')
                        .trim();
                    if !env_name.is_empty() {
                        prov.api_key_env = Some(env_name.to_string());
                    }
                } else if !val.is_empty() {
                    // Non-empty literal secret key: mark presence ONLY.
                    // NEVER store or copy secret value!
                    prov.has_api_key = true;
                }
            } else if key == "models" {
                prov.has_provider_markers = true;
                // Check if inline array e.g. models: [a, b]
                if val.starts_with('[') && val.ends_with(']') {
                    let inner = &val[1..val.len() - 1];
                    for item in inner.split(',') {
                        let m = item.trim().trim_matches(|c| c == '"' || c == '\'');
                        if !m.is_empty() && !prov.model_ids.iter().any(|x| x == m) {
                            prov.model_ids.push(m.to_string());
                        }
                    }
                } else {
                    current_section = Some(SubSection::Models);
                    section_indent = indent;
                    section_child_indent = None;
                }
            } else if key.eq_ignore_ascii_case("modelOverrides") || key == "model_overrides" {
                prov.has_provider_markers = true;
                current_section = Some(SubSection::ModelOverrides);
                section_indent = indent;
                section_child_indent = None;
            }
        }
    }

    flush_current(&mut current_provider, &mut providers);
    providers
}

/// Scan all lines of config.yml for scalar values formatted as `providerId/model`
/// or `providerId/model:effort` and return `(role_key, provider_id)`.
pub fn scan_roles_in_config(config_text: &str) -> Vec<(String, String)> {
    let mut roles = Vec::new();
    for raw in config_text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let role_key = k.trim().trim_matches(|c| c == '"' || c == '\'');
            let mut val = v.trim();
            if let Some((before_comment, _)) = val.split_once('#') {
                val = before_comment.trim();
            }
            let val = val.trim_matches(|c| c == '"' || c == '\'');

            if let Some((prov, _model_part)) = val.split_once('/') {
                let prov = prov.trim();
                if !prov.is_empty() && !role_key.is_empty() {
                    roles.push((role_key.to_string(), prov.to_string()));
                }
            }
        }
    }
    roles
}

/// Query `agent.db` for authenticated credentials without selecting secrets.
/// Returns mapping of `provider -> (sorted_credential_types, accounts)`.
pub fn scan_agent_db(db_path: &Path) -> HashMap<String, (Vec<String>, Vec<String>)> {
    let mut map: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return map;
    };

    let Ok(mut stmt) = conn.prepare(
        "SELECT provider, credential_type, identity_key FROM auth_credentials WHERE disabled_cause IS NULL",
    ) else {
        return map;
    };

    let Ok(rows) = stmt.query_map([], |row| {
        let provider: String = row.get(0)?;
        let credential_type: Option<String> = row.get(1)?;
        let identity_key: Option<String> = row.get(2)?;
        Ok((provider, credential_type, identity_key))
    }) else {
        return map;
    };

    for (prov, cred_type, ident) in rows.flatten() {
        let entry = map.entry(prov).or_default();
        if let Some(ct) = cred_type {
            let ct = ct.trim().to_string();
            if !ct.is_empty() && !entry.0.contains(&ct) {
                entry.0.push(ct);
            }
        }
        if let Some(ik) = ident {
            let ik = ik.trim().to_string();
            if !ik.is_empty() && !entry.1.contains(&ik) {
                entry.1.push(ik);
            }
        }
    }

    for (cts, _accs) in map.values_mut() {
        cts.sort();
    }

    map
}

/// Pure merge of parsed YAML files, config roles, and agent.db data into `Vec<OmpProviderInfo>`.
pub fn merge_scanned(
    models_yaml: Option<&str>,
    snippet_yaml: Option<&str>,
    config_yaml: Option<&str>,
    db_credentials: HashMap<String, (Vec<String>, Vec<String>)>,
) -> Vec<OmpProviderInfo> {
    let mut map: HashMap<String, OmpProviderInfo> = HashMap::new();
    let mut source_order: Vec<String> = Vec::new();

    let mut add_parsed = |parsed: Vec<RawParsedProvider>, source_name: &str| {
        for p in parsed {
            if !source_order.contains(&p.id) {
                source_order.push(p.id.clone());
            }
            let info = map.entry(p.id.clone()).or_insert_with(|| OmpProviderInfo {
                id: p.id,
                ..Default::default()
            });
            if !info.sources.iter().any(|s| s == source_name) {
                info.sources.push(source_name.to_string());
            }
            if info.base_url.is_none() {
                info.base_url = p.base_url;
            }
            if info.api.is_none() {
                info.api = p.api;
            }
            if p.has_api_key {
                info.has_api_key = true;
            }
            if info.api_key_env.is_none() {
                info.api_key_env = p.api_key_env;
            }
            for m in p.model_ids {
                if !info.model_ids.contains(&m) {
                    info.model_ids.push(m);
                }
            }
        }
    };

    if let Some(text) = models_yaml {
        add_parsed(parse_yaml_providers(text, false), "models.yml");
    }
    if let Some(text) = snippet_yaml {
        add_parsed(parse_yaml_providers(text, false), "models-snippet.yml");
    }
    if let Some(text) = config_yaml {
        add_parsed(parse_yaml_providers(text, true), "config.yml");
    }

    // Merge agent.db credentials
    for (prov_id, (cred_types, accounts)) in db_credentials {
        if !source_order.contains(&prov_id) {
            source_order.push(prov_id.clone());
        }
        let info = map
            .entry(prov_id.clone())
            .or_insert_with(|| OmpProviderInfo {
                id: prov_id,
                ..Default::default()
            });
        if !info.sources.iter().any(|s| s == "agent.db") {
            info.sources.push("agent.db".to_string());
        }
        for ct in cred_types {
            if !info.credential_types.contains(&ct) {
                info.credential_types.push(ct);
            }
        }
        info.credential_types.sort();
        for acc in accounts {
            if !info.accounts.contains(&acc) {
                info.accounts.push(acc);
            }
        }
    }

    // Extract roles from config.yml if available
    if let Some(cfg) = config_yaml {
        let discovered_ids: HashSet<String> = map.keys().cloned().collect();
        let role_entries = scan_roles_in_config(cfg);
        for (role_key, prov_id) in role_entries {
            if discovered_ids.contains(&prov_id) {
                if let Some(info) = map.get_mut(&prov_id) {
                    if !info.used_in_roles.contains(&role_key) {
                        info.used_in_roles.push(role_key);
                    }
                }
            }
        }
    }

    let mut result: Vec<OmpProviderInfo> = map.into_values().collect();
    for item in &mut result {
        item.used_in_roles.sort();
    }
    result.sort_by(|a, b| a.id.cmp(&b.id));
    result
}

fn home_agent_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".omp")
        .join("agent")
}

/// Scan host's OMP global configs (`~/.omp/agent/`) and return list of providers.
pub fn scan() -> Vec<OmpProviderInfo> {
    let agent_dir = home_agent_dir();
    let models_yml = std::fs::read_to_string(agent_dir.join("models.yml")).ok();
    let snippet_yml = std::fs::read_to_string(agent_dir.join("models-snippet.yml")).ok();
    let config_yml = std::fs::read_to_string(agent_dir.join("config.yml")).ok();
    let db_path = agent_dir.join("agent.db");
    let db_credentials = scan_agent_db(&db_path);

    merge_scanned(
        models_yml.as_deref(),
        snippet_yml.as_deref(),
        config_yml.as_deref(),
        db_credentials,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_models_yaml_multi_provider_and_secret_zero_exposure() {
        let yaml = r#"
providers:
  yiyuan-cc-kiro-cheapest:
    baseUrl: https://api.example.com/v1
    apiKey: sk-super-secret-key-1234567890
    api: openai-completions
    authHeader: true
    modelOverrides:
      claude-haiku-4-5:
        compactionModel: claude-3-haiku
      gpt-4o: {}
    models:
      - id: custom-model-1
      - custom-model-2
  openrouter:
    baseUrl: https://openrouter.ai/api/v1
    apiKey: $OPENROUTER_API_KEY
    api: openai-completions
"#;
        let list = parse_yaml_providers(yaml, false);
        assert_eq!(list.len(), 2);

        let p1 = &list[0];
        assert_eq!(p1.id, "yiyuan-cc-kiro-cheapest");
        assert_eq!(p1.base_url.as_deref(), Some("https://api.example.com/v1"));
        assert_eq!(p1.api.as_deref(), Some("openai-completions"));
        assert!(p1.has_api_key);
        assert_eq!(p1.api_key_env, None);
        assert_eq!(
            p1.model_ids,
            vec![
                "claude-haiku-4-5",
                "gpt-4o",
                "custom-model-1",
                "custom-model-2"
            ]
        );

        // Verify zero exposure: serialized JSON must NOT contain the secret key string
        let merged = merge_scanned(Some(yaml), None, None, HashMap::new());
        let serialized = serde_json::to_string(&merged).unwrap();
        assert!(!serialized.contains("sk-super-secret-key-1234567890"));
        assert!(!serialized.contains("sk-"));
        assert!(serialized.contains("\"hasApiKey\":true"));

        let p2 = &list[1];
        assert_eq!(p2.id, "openrouter");
        assert_eq!(p2.api_key_env.as_deref(), Some("OPENROUTER_API_KEY"));
        assert!(!p2.has_api_key);
    }

    #[test]
    fn test_api_key_env_variants() {
        let yaml = r#"
providers:
  p1:
    apiKey: $FOO
  p2:
    apiKey: ${BAR}
  p3:
    apiKey: "${BAZ}"
  p4:
    apiKey: ""
"#;
        let list = parse_yaml_providers(yaml, false);
        assert_eq!(list.len(), 4);
        assert_eq!(list[0].api_key_env.as_deref(), Some("FOO"));
        assert!(!list[0].has_api_key);

        assert_eq!(list[1].api_key_env.as_deref(), Some("BAR"));
        assert!(!list[1].has_api_key);

        assert_eq!(list[2].api_key_env.as_deref(), Some("BAZ"));
        assert!(!list[2].has_api_key);

        assert_eq!(list[3].api_key_env, None);
        assert!(!list[3].has_api_key);
    }

    #[test]
    fn test_config_yml_rejects_non_provider_subtrees() {
        let config_yaml = r#"
providers:
  antigravityEndpoint: production
  anotherNonProviderSetting: true
  valid-custom:
    baseUrl: https://custom.ai/v1
    api: openai-completions
default: valid-custom/fast-model:high
"#;
        let parsed = parse_yaml_providers(config_yaml, true);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "valid-custom");

        let merged = merge_scanned(None, None, Some(config_yaml), HashMap::new());
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, "valid-custom");
        assert_eq!(merged[0].used_in_roles, vec!["default"]);
    }

    #[test]
    fn test_role_extraction() {
        let config = r#"
default: devin/swe-2:high
reviewer: openai/gpt-4o
other: devin/fast
unrelated: false
"#;
        let roles = scan_roles_in_config(config);
        assert_eq!(
            roles,
            vec![
                ("default".to_string(), "devin".to_string()),
                ("reviewer".to_string(), "openai".to_string()),
                ("other".to_string(), "devin".to_string()),
            ]
        );
    }

    #[test]
    fn test_empty_and_missing_inputs() {
        let merged = merge_scanned(None, None, None, HashMap::new());
        assert!(merged.is_empty());

        let empty_str = "";
        let merged2 = merge_scanned(
            Some(empty_str),
            Some(empty_str),
            Some(empty_str),
            HashMap::new(),
        );
        assert!(merged2.is_empty());
    }
}
