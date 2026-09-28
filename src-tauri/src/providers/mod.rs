//! [providers] Graphical API provider manager + encrypted `.env` secret vault.
//! Module addition (not in docs/ARCHITECTURE.md §2 at scaffold time) — the
//! contract change is documented in the implementer report.
//!
//! Metadata: `~/.omp-workspace/providers.json` (non-secret).
//! Secrets: `~/.omp-workspace/env/keys.env` (AES-256-GCM values, master key in
//! the macOS Keychain). Child processes get decrypted keys via [`env_pairs`].

pub mod commands;
pub mod oauth;
pub mod omp_config;
pub mod presets;
pub mod store;
pub mod vault;
use tokio::sync::Mutex;

use crate::contracts::{ModelEntry, ProviderConfig};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProvider<'a> {
    name: &'a str,
    slug: &'a str,
    base_url: &'a str,
    api: crate::contracts::ProviderApi,
    env_var: &'a str,
    models: &'a [ModelEntry],
    #[serde(skip_serializing_if = "Option::is_none")]
    default_context_window: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_max_tokens: Option<u32>,
}

fn runtime_metadata(providers: &[ProviderConfig]) -> Result<String, String> {
    let routes: Vec<_> = providers
        .iter()
        .filter(|p| p.enabled && !p.models.is_empty())
        .map(|p| RuntimeProvider {
            name: &p.name,
            slug: &p.slug,
            base_url: &p.base_url,
            api: p.api,
            env_var: &p.env_var,
            models: &p.models,
            default_context_window: p.default_context_window,
            default_max_tokens: p.default_max_tokens,
        })
        .collect();
    serde_json::to_string(&routes).map_err(|e| e.to_string())
}

/// Serializes metadata-store and vault mutations across commands.
static MUTATION_LOCK: Mutex<()> = Mutex::const_new(());

/// Best-effort startup: create the vault directory with `chmod 700`.
pub fn init() {
    if let Err(e) = vault::ensure_dir() {
        tracing::warn!("providers: {e}");
    }
    if let Err(e) = extension_path() {
        tracing::warn!("providers: {e}");
    }
}

/// Install the private model-registration extension; never changes OMP's global config.
pub fn extension_path() -> Result<std::path::PathBuf, String> {
    let path = crate::paths::data_dir()
        .join("extension")
        .join("omp-workspace-providers.ts");
    let source = include_str!("extension.ts");
    if std::fs::read_to_string(&path).is_ok_and(|current| current == source) {
        return Ok(path);
    }
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("ts.tmp");
    std::fs::write(&tmp, source).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Best-effort extension path: on write or read error, logs a warning and returns `None`
/// so that child processes still run without the extension instead of hard-failing.
pub fn try_extension_path() -> Option<std::path::PathBuf> {
    match extension_path() {
        Ok(path) => Some(path),
        Err(e) => {
            tracing::warn!("providers: extension_path unavailable: {e}");
            None
        }
    }
}

/// Key material only (env var → decrypted key) for enabled, configured providers,
/// deduped by env var (first by `sort` wins). Best effort: on any failure the
/// error is logged WITHOUT key material and no pairs are returned.
///
/// NOTE: Injected into PTY shells. NEVER includes `OMP_WORKSPACE_PROVIDERS` metadata
/// so that interactive user shells remain clean.
pub fn env_pairs() -> Vec<(String, String)> {
    match env_pairs_inner() {
        Ok(pairs) => pairs,
        Err(e) => {
            tracing::warn!("providers: env_pairs unavailable: {e}");
            Vec::new()
        }
    }
}

/// Routing metadata env var (`OMP_WORKSPACE_PROVIDERS`) for OMP-spawning processes.
pub fn terminal_extra_env() -> Option<(String, String)> {
    let keys = env_pairs();
    let routable: Vec<_> = store::load()
        .into_iter()
        .filter(|p| {
            p.api == crate::contracts::ProviderApi::Ollama
                || keys.iter().any(|(name, _)| name == &p.env_var)
                || std::env::var_os(&p.env_var).is_some()
        })
        .collect();
    match runtime_metadata(&routable) {
        Ok(metadata) => Some(("OMP_WORKSPACE_PROVIDERS".into(), metadata)),
        Err(e) => {
            tracing::warn!("providers: runtime_metadata unavailable: {e}");
            None
        }
    }
}

/// Complete environment for spawning OMP processes: decrypted API keys plus
/// the `OMP_WORKSPACE_PROVIDERS` routing metadata.
pub fn omp_spawn_env() -> Vec<(String, String)> {
    let mut env = env_pairs();
    if let Some(extra) = terminal_extra_env() {
        env.push(extra);
    }
    env
}

fn env_pairs_inner() -> Result<Vec<(String, String)>, String> {
    let mut providers: Vec<ProviderConfig> = store::load();
    providers.retain(|p| p.enabled && vault::contains(&p.slug));
    providers.sort_by_key(|p| p.sort);
    if providers.is_empty() {
        return Ok(Vec::new());
    }
    let key = vault::master_key()?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for provider in providers {
        if seen.contains(&provider.env_var) {
            continue;
        }
        if let Some(value) = vault::read_entry_with(&key, &provider.slug)? {
            seen.insert(provider.env_var.clone());
            out.push((provider.env_var, value));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_pairs_is_safe_without_vault_content() {
        // No providers configured in a fresh checkout → empty, never panics.
        // (The store may exist on dev machines, so only assert no panic.)
        let pairs = env_pairs();
        // env_pairs MUST NOT contain metadata
        assert!(!pairs.iter().any(|(k, _)| k == "OMP_WORKSPACE_PROVIDERS"));
        let _ = omp_spawn_env();
    }

    #[test]
    fn runtime_metadata_excludes_private_fields() {
        let provider = ProviderConfig {
            name: "Local gateway".into(),
            slug: "gateway".into(),
            base_url: "http://localhost:9999/v1".into(),
            env_var: "GATEWAY_KEY".into(),
            models: vec!["custom-model".into()],
            enabled: true,
            notes: Some("private notes".into()),
            key_hint: Some("abcd".into()),
            ..Default::default()
        };
        let metadata = runtime_metadata(&[provider]).unwrap();
        assert!(metadata.contains("custom-model"));
        assert!(!metadata.contains("private notes"));
        assert!(!metadata.contains("abcd"));
    }

    #[test]
    fn disabled_and_model_less_providers_are_not_registered() {
        let provider = ProviderConfig {
            name: "Gateway".into(),
            slug: "gateway".into(),
            base_url: "http://localhost:9999/v1".into(),
            env_var: "GATEWAY_KEY".into(),
            models: vec!["custom-model".into()],
            ..Default::default()
        };
        assert_eq!(runtime_metadata(&[provider.clone()]).unwrap(), "[]");
        let no_models = ProviderConfig {
            enabled: true,
            models: Vec::new(),
            ..provider
        };
        assert_eq!(runtime_metadata(&[no_models]).unwrap(), "[]");
    }

    #[test]
    fn runtime_metadata_serializes_model_specs_and_defaults() {
        let provider = ProviderConfig {
            name: "Custom gateway".into(),
            slug: "cgateway".into(),
            base_url: "https://api.gateway.com/v1".into(),
            api: crate::contracts::ProviderApi::OpenaiResponses,
            env_var: "GATEWAY_KEY".into(),
            models: vec![
                ModelEntry::Id("model-1".into()),
                ModelEntry::Spec(crate::contracts::ModelSpec {
                    id: "model-2".into(),
                    name: Some("Model Two".into()),
                    context_window: Some(100_000),
                    max_tokens: Some(4096),
                }),
            ],
            default_context_window: Some(32000),
            default_max_tokens: Some(2048),
            enabled: true,
            ..Default::default()
        };
        let metadata = runtime_metadata(&[provider]).unwrap();
        assert!(metadata.contains("\"api\":\"openai_responses\""));
        assert!(metadata.contains("\"defaultContextWindow\":32000"));
        assert!(metadata.contains("\"defaultMaxTokens\":2048"));
        assert!(metadata.contains("\"model-1\""));
        assert!(metadata.contains("\"contextWindow\":100000"));
    }
}
