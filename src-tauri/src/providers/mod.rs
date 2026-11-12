//! [providers] OMP's own providers: list, enable, key and block editing.
//!
//! Source of truth is OMP itself — `~/.omp/agent/models.yml` (blocks + `apiKey`,
//! plaintext), `config.yml` (`disabledProviders`) and `agent.db` (logins,
//! read-only). The workbench keeps no provider state of its own. The AES-GCM
//! [`vault`] (`<data_dir>/env/keys.env`) now only holds non-provider secrets
//! (the Cloudflare DDNS token). Provider keys that older versions put there are
//! moved back into models.yml at startup by [`legacy_keys`].

pub mod commands;
pub mod config_yml;
pub mod key_ref;
pub mod legacy_keys;
pub mod migration;
pub mod models_yml_providers;
pub mod models_yml_write;
pub mod oauth;
pub mod omp_config;
pub mod ops;
pub mod presets;
pub mod rows;
pub mod service_config;
pub mod vault;

use tokio::sync::Mutex;

/// Serializes models.yml / config.yml mutations across commands.
static MUTATION_LOCK: Mutex<()> = Mutex::const_new(());

/// Best-effort startup, before anything reads providers: vault directory
/// (`chmod 700`, for the DDNS token), the one-time migration of the retired
/// `providers.json`, then the move of leftover vault-backed provider keys into
/// models.yml (after the former, so references it produced are converted too).
pub fn init() {
    if let Err(e) = vault::ensure_dir() {
        tracing::warn!("providers: {e}");
    }
    migration::run_startup();
    legacy_keys::migrate_vault_keys_to_plaintext();
}
