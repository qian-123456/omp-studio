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

/// Serializes metadata-store and vault mutations across commands.
static MUTATION_LOCK: Mutex<()> = Mutex::const_new(());

/// Best-effort startup: create the vault directory with `chmod 700`.
pub fn init() {
    if let Err(e) = vault::ensure_dir() {
        tracing::warn!("providers: {e}");
    }
}

/// Env pairs (env var → decrypted key) for enabled, configured providers,
/// deduped by env var (first by `sort` wins). Best effort: on any failure the
/// error is logged WITHOUT key material and no pairs are returned.
pub fn env_pairs() -> Vec<(String, String)> {
    match env_pairs_inner() {
        Ok(pairs) => pairs,
        Err(e) => {
            tracing::warn!("providers: env_pairs unavailable: {e}");
            Vec::new()
        }
    }
}

fn env_pairs_inner() -> Result<Vec<(String, String)>, String> {
    let mut providers: Vec<ProviderConfig> = store::load();
    providers.retain(|p| p.enabled);
    providers.sort_by_key(|p| p.sort);
    if providers.is_empty() {
        return Ok(Vec::new());
    }
    let key = vault::master_key()?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for provider in providers {
        if !seen.insert(provider.env_var.clone()) {
            continue;
        }
        if let Some(value) = vault::read_entry_with(&key, &provider.slug)? {
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
}
