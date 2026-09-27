//! [providers] Graphical API provider manager + encrypted `.env` secret vault.
//! Module addition (not in docs/ARCHITECTURE.md §2 at scaffold time) — the
//! contract change is documented in the implementer report.
//!
//! Metadata: `~/.omp-workspace/providers.json` (non-secret).
//! Secrets: `~/.omp-workspace/env/keys.env` (AES-256-GCM values, master key in
//! the macOS Keychain). Child processes get decrypted keys via [`env_pairs`].

pub mod commands;
pub mod presets;
pub mod store;
pub mod vault;

use tokio::sync::Mutex;

use crate::contracts::ProviderConfig;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProvider<'a> {
    name: &'a str,
    slug: &'a str,
    base_url: &'a str,
    api: crate::contracts::ProviderApi,
    env_var: &'a str,
    models: &'a [String],
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

/// Env pairs (env var → decrypted key) for enabled, configured providers,
/// deduped by env var (first by `sort` wins). Best effort: on any failure the
/// error is logged WITHOUT key material and no pairs are returned.
pub fn env_pairs() -> Vec<(String, String)> {
    let mut pairs = match env_pairs_inner() {
        Ok(pairs) => pairs,
        Err(e) => {
            tracing::warn!("providers: env_pairs unavailable: {e}");
            Vec::new()
        }
    };
    // Only non-secret routing metadata is serialized; keys remain in individual env vars.
    let routable: Vec<_> = store::load()
        .into_iter()
        .filter(|p| {
            p.api == crate::contracts::ProviderApi::Ollama
                || pairs.iter().any(|(name, _)| name == &p.env_var)
                || std::env::var_os(&p.env_var).is_some()
        })
        .collect();
    if let Ok(metadata) = runtime_metadata(&routable) {
        pairs.push(("OMP_WORKSPACE_PROVIDERS".into(), metadata));
    }
    pairs
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
        let _ = env_pairs();
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
}
