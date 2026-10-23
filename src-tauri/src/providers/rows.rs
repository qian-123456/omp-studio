//! `ProviderRow` assembly: OMP's own state (models.yml, config.yml, agent.db,
//! models.db) plus the app's vault, merged into what the settings page lists.
//! Read-only; never carries key material.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::contracts::{
    ModelEntry, ProviderApi, ProviderKeyKind, ProviderKeyState, ProviderOrigin, ProviderRow,
};

use super::commands::{map_provider_api, sanitize_slug};
use super::models_yml_providers::YmlProvider;
use super::omp_config::CachedEndpoint;
use super::{config_yml, key_ref, models_yml_providers, omp_config, presets, vault};

/// Environment lookups key detection depends on (injected for tests).
pub struct KeyEnv<'a> {
    pub shim: &'a Path,
    pub vault_has: &'a dyn Fn(&str) -> bool,
    pub env_set: &'a dyn Fn(&str) -> bool,
}

/// `^[A-Z_][A-Z0-9_]*$`
pub fn is_env_name(s: &str) -> bool {
    let mut chars = s.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_uppercase() || c == '_')
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Key state of provider `id` from its models.yml `apiKey` (if any), `auth: none`
/// and the active agent.db credential types.
pub fn detect_key(
    id: &str,
    api_key: Option<&str>,
    auth_none: bool,
    cred_types: &[String],
    env: &KeyEnv,
) -> ProviderKeyState {
    let state = |kind, env_var: Option<String>, env_set| ProviderKeyState {
        kind,
        env_var,
        env_set,
    };
    match api_key.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) if v.starts_with('!') => {
            if key_ref::is_ref_for(v, env.shim, id) {
                let kind = if (env.vault_has)(&key_ref::vault_slug(id)) {
                    ProviderKeyKind::Encrypted
                } else {
                    ProviderKeyKind::VaultMissing
                };
                state(kind, None, None)
            } else {
                state(ProviderKeyKind::Command, None, None)
            }
        }
        Some(v) if is_env_name(v) => state(
            ProviderKeyKind::EnvVar,
            Some(v.to_string()),
            Some((env.env_set)(v)),
        ),
        Some(_) => state(ProviderKeyKind::Plaintext, None, None),
        None => {
            let has = |t: &str| cred_types.iter().any(|c| c == t);
            let kind = if auth_none {
                ProviderKeyKind::None
            } else if has("oauth") {
                ProviderKeyKind::Oauth
            } else if has("api_key") {
                ProviderKeyKind::LoginStored
            } else {
                ProviderKeyKind::Missing
            };
            state(kind, None, None)
        }
    }
}

/// OMP api string for a workbench protocol.
fn api_string(api: ProviderApi) -> &'static str {
    match api {
        ProviderApi::OpenaiCompletions => "openai-completions",
        ProviderApi::OpenaiResponses => "openai-responses",
        ProviderApi::Anthropic => "anthropic-messages",
        ProviderApi::Gemini => "google-generative-ai",
        ProviderApi::Ollama => "ollama",
    }
}

fn key_resolvable(key: &ProviderKeyState) -> bool {
    match key.kind {
        ProviderKeyKind::Encrypted
        | ProviderKeyKind::Plaintext
        | ProviderKeyKind::LoginStored
        | ProviderKeyKind::None => true,
        ProviderKeyKind::EnvVar => key.env_set == Some(true),
        _ => false,
    }
}

pub struct Inputs<'a> {
    pub yml: &'a [YmlProvider],
    pub disabled: &'a HashSet<String>,
    pub creds: &'a HashMap<String, (Vec<String>, Vec<String>)>,
    pub cache: &'a dyn Fn(&str) -> Option<CachedEndpoint>,
    pub env: &'a KeyEnv<'a>,
}

pub fn build_rows(inp: &Inputs) -> Vec<ProviderRow> {
    let mut ids: Vec<String> = inp.yml.iter().map(|p| p.id.clone()).collect();
    let mut seen: HashSet<String> = ids.iter().cloned().collect();
    let mut extra: Vec<&String> = inp.creds.keys().chain(inp.disabled.iter()).collect();
    extra.sort();
    for id in extra {
        if seen.insert(id.clone()) {
            ids.push(id.clone());
        }
    }

    ids.into_iter()
        .map(|id| {
            let yml = inp.yml.iter().find(|p| p.id == id);
            let cache = (inp.cache)(&id);
            let preset = presets::find(&id);
            let creds = inp.creds.get(&id);
            let cred_types: &[String] = creds.map_or(&[], |(t, _)| t.as_slice());

            let mut sources = Vec::new();
            if yml.is_some() {
                sources.push("models.yml".to_string());
            }
            if inp.disabled.contains(&id) {
                sources.push("config.yml".to_string());
            }
            if creds.is_some() {
                sources.push("agent.db".to_string());
            }
            if cache.is_some() {
                sources.push("models.db".to_string());
            }
            if preset.is_some() {
                sources.push("built-in".to_string());
            }

            let origin = match yml {
                Some(p) if p.base_url.is_some() => ProviderOrigin::Custom,
                Some(_) => ProviderOrigin::Override,
                None => ProviderOrigin::Builtin,
            };
            let base_url = yml
                .and_then(|p| p.base_url.clone())
                .or_else(|| cache.as_ref().and_then(|c| c.base_url.clone()))
                .or_else(|| preset.map(|p| p.base_url.to_string()));
            let api = yml
                .and_then(|p| p.api.clone())
                .or_else(|| cache.as_ref().and_then(|c| c.api.clone()))
                .or_else(|| preset.map(|p| api_string(p.api).to_string()));
            let models: Vec<ModelEntry> = match yml {
                Some(p) if origin == ProviderOrigin::Custom => p.models.clone(),
                _ => cache
                    .as_ref()
                    .map(|c| c.model_ids.iter().cloned().map(ModelEntry::Id).collect())
                    .unwrap_or_default(),
            };
            let key = detect_key(
                &id,
                yml.and_then(|p| p.api_key.as_deref()),
                yml.is_some_and(|p| p.auth_none),
                cred_types,
                inp.env,
            );
            let testable = base_url.is_some()
                && api.as_deref().and_then(map_provider_api).is_some_and(|a| {
                    matches!(
                        a,
                        ProviderApi::OpenaiCompletions
                            | ProviderApi::OpenaiResponses
                            | ProviderApi::Anthropic
                            | ProviderApi::Gemini
                    )
                })
                && key_resolvable(&key);
            ProviderRow {
                slug: sanitize_slug(&id),
                display_name: yml.and_then(|p| p.name.clone()),
                origin,
                sources,
                base_url,
                api,
                models,
                key,
                enabled: !inp.disabled.contains(&id),
                testable,
                id,
            }
        })
        .collect()
}

/// All rows from the real OMP state. Errors only when models.yml is unparseable.
pub fn load_rows() -> Result<Vec<ProviderRow>, String> {
    let yml = models_yml_providers::read_providers(&models_yml_providers::models_yml_path())?;
    let disabled = config_yml::read_disabled();
    let agent_dir = omp_config::home_agent_dir();
    let creds = omp_config::scan_agent_db(&agent_dir.join("agent.db"));
    let cache_db = agent_dir.join("models.db");
    let cache = |id: &str| omp_config::read_model_cache_endpoint(&cache_db, id);
    let shim = key_ref::shim_path();
    let vault_has = |slug: &str| vault::contains(slug);
    let env_set = |name: &str| std::env::var_os(name).is_some_and(|v| !v.is_empty());
    let env = KeyEnv {
        shim: &shim,
        vault_has: &vault_has,
        env_set: &env_set,
    };
    Ok(build_rows(&Inputs {
        yml: &yml,
        disabled: &disabled,
        creds: &creds,
        cache: &cache,
        env: &env,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn kind(
        id: &str,
        key: Option<&str>,
        auth_none: bool,
        creds: &[&str],
        vault: bool,
        env: bool,
    ) -> ProviderKeyState {
        let shim = PathBuf::from("/d/bin/ompws-key");
        let vault_has = move |_: &str| vault;
        let env_set = move |_: &str| env;
        let creds: Vec<String> = creds.iter().map(|s| s.to_string()).collect();
        detect_key(
            id,
            key,
            auth_none,
            &creds,
            &KeyEnv {
                shim: &shim,
                vault_has: &vault_has,
                env_set: &env_set,
            },
        )
    }

    #[test]
    fn key_state_table() {
        use ProviderKeyKind::*;
        let own = key_ref::command_ref(Path::new("/d/bin/ompws-key"), "my id");
        let other_id = key_ref::command_ref(Path::new("/d/bin/ompws-key"), "someone");
        let other_shim = key_ref::command_ref(Path::new("/x/ompws-key"), "my id");
        let cases: Vec<(Option<&str>, bool, Vec<&str>, bool, bool, ProviderKeyKind)> = vec![
            (Some(&own), false, vec![], true, false, Encrypted),
            (Some(&own), false, vec![], false, false, VaultMissing),
            (Some(&other_id), false, vec![], true, false, Command),
            (Some(&other_shim), false, vec![], true, false, Command),
            (Some("!pass show x"), false, vec![], true, false, Command),
            (Some("MY_KEY_1"), false, vec![], false, false, EnvVar),
            (Some("sk-abc"), false, vec![], false, false, Plaintext),
            (Some("lower_case"), false, vec![], false, false, Plaintext),
            (Some("  "), true, vec![], false, false, None),
            (Option::None, true, vec!["oauth"], false, false, None),
            (
                Option::None,
                false,
                vec!["api_key", "oauth"],
                false,
                false,
                Oauth,
            ),
            (
                Option::None,
                false,
                vec!["api_key"],
                false,
                false,
                LoginStored,
            ),
            (Option::None, false, vec![], false, false, Missing),
            (Some("sk-abc"), true, vec!["oauth"], false, false, Plaintext),
        ];
        for (key, auth_none, creds, vault, env, want) in cases {
            let got = kind("my id", key, auth_none, &creds, vault, env);
            assert_eq!(got.kind, want, "{key:?} {creds:?}");
        }
        let s = kind("p", Some("MY_KEY"), false, &[], false, true);
        assert_eq!(
            (s.env_var.as_deref(), s.env_set),
            (Some("MY_KEY"), Some(true))
        );
        let s = kind("p", Some("MY_KEY"), false, &[], false, false);
        assert_eq!(s.env_set, Some(false));
    }

    fn yp(id: &str, base: Option<&str>, key: Option<&str>) -> YmlProvider {
        YmlProvider {
            id: id.into(),
            name: None,
            base_url: base.map(str::to_string),
            api: base.map(|_| "openai-completions".to_string()),
            api_key: key.map(str::to_string),
            auth_none: false,
            models: vec![ModelEntry::Id("m".into())],
        }
    }

    #[test]
    fn rows_merge_sources_and_origins() {
        let yml = vec![
            yp("custom", Some("https://c.example/v1"), Some("sk-1")),
            yp("openai", None, Some("OPENAI_API_KEY")),
        ];
        let disabled = HashSet::from(["custom".to_string(), "ghost".to_string()]);
        let mut creds = HashMap::new();
        creds.insert(
            "openrouter".to_string(),
            (vec!["api_key".to_string()], vec![]),
        );
        let cache = |id: &str| {
            (id == "openrouter").then(|| CachedEndpoint {
                base_url: Some("https://openrouter.ai/api/v1".into()),
                api: Some("openai-completions".into()),
                model_ids: vec!["x/y".into()],
            })
        };
        let shim = PathBuf::from("/d/bin/ompws-key");
        let t = |_: &str| true;
        let env = KeyEnv {
            shim: &shim,
            vault_has: &t,
            env_set: &t,
        };
        let rows = build_rows(&Inputs {
            yml: &yml,
            disabled: &disabled,
            creds: &creds,
            cache: &cache,
            env: &env,
        });
        let ids: Vec<_> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["custom", "openai", "ghost", "openrouter"]);
        assert_eq!(rows[0].origin, ProviderOrigin::Custom);
        assert!(!rows[0].enabled);
        assert!(rows[0].testable);
        assert_eq!(rows[0].sources, ["models.yml", "config.yml"]);
        assert_eq!(rows[1].origin, ProviderOrigin::Override);
        assert_eq!(
            rows[1].base_url.as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(rows[1].key.kind, ProviderKeyKind::EnvVar);
        assert!(rows[1].models.is_empty());
        assert_eq!(rows[2].origin, ProviderOrigin::Builtin);
        assert_eq!(rows[2].key.kind, ProviderKeyKind::Missing);
        assert!(!rows[2].testable);
        assert_eq!(rows[3].key.kind, ProviderKeyKind::LoginStored);
        assert_eq!(rows[3].models, vec![ModelEntry::Id("x/y".into())]);
        assert_eq!(rows[3].sources, ["agent.db", "models.db", "built-in"]);
        assert!(rows[3].testable && rows[3].enabled);
    }
}
