//! [providers] OMP's own providers: list, enable, per-provider key encryption.
//!
//! Source of truth is OMP itself — `~/.omp/agent/models.yml` (blocks + `apiKey`),
//! `config.yml` (`disabledProviders`) and `agent.db` (logins, read-only). The
//! only workbench state is the AES-GCM vault (`~/.omp-workspace/env/keys.env`,
//! master key `~/.omp-workspace/env/.master.key`) holding keys that were
//! encrypted; models.yml then carries a command reference (see [`key_ref`]) that
//! OMP itself runs through `<data_dir>/bin/ompws-key`.

pub mod commands;
pub mod config_yml;
pub mod key_ref;
pub mod migration;
pub mod models_yml_providers;
pub mod models_yml_write;
pub mod oauth;
pub mod omp_config;
pub mod ops;
pub mod presets;
pub mod rows;
pub mod vault;

use tokio::sync::Mutex;

/// Serializes models.yml / config.yml / vault mutations across commands.
static MUTATION_LOCK: Mutex<()> = Mutex::const_new(());

/// Best-effort startup, before anything reads providers: vault directory
/// (`chmod 700`), key shim for the running executable, then the one-time
/// migration of the retired `providers.json`.
pub fn init() {
    if let Err(e) = vault::ensure_dir() {
        tracing::warn!("providers: {e}");
    }
    if let Err(e) = key_ref::install_shim() {
        tracing::warn!("providers: {e}");
    }
    migration::run_startup();
}
