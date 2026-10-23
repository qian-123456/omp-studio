//! One-time migration of the retired workbench provider store.
//!
//! Before the in-place redesign the app kept provider copies in
//! `~/.omp-workspace/providers.json` and fed OMP through an extension plus
//! injected env vars. Now OMP's own `models.yml` is the source of truth, so:
//!
//! 1. a models.yml provider whose `apiKey` is the env-var name a record injected
//!    (and whose key is in the vault) gets the command reference instead;
//! 2. a workbench-only record that is neither a built-in nor already present is
//!    appended to models.yml as a custom provider with a command reference;
//! 3. `providers.json` is renamed to `providers.json.migrated-<ts>`.
//!
//! Vault entries are kept. Idempotent: without `providers.json` nothing happens.
//! `models.yml` is backed up by `models_yml_providers::edit_file`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::contracts::{ModelEntry, ModelSpec, ProviderApi};

use super::commands::sanitize_slug;
use super::models_yml_providers::{self as yml, edit_file, BlockSpec};
use super::ops::KeyStore;
use super::{config_yml, key_ref};

/// One record of the retired `providers.json` (only what migration needs).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Legacy {
    name: String,
    slug: String,
    base_url: String,
    api: ProviderApi,
    #[serde(default)]
    env_var: String,
    #[serde(default)]
    models: Vec<ModelEntry>,
    #[serde(default)]
    default_context_window: Option<u32>,
    #[serde(default)]
    default_max_tokens: Option<u32>,
    #[serde(default = "yes")]
    enabled: bool,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
struct LegacyStore {
    providers: Vec<Legacy>,
}

pub struct Migration<'a> {
    pub legacy: &'a Path,
    pub models_yml: &'a Path,
    pub config_yml: &'a Path,
    pub shim: &'a Path,
    pub store: &'a dyn KeyStore,
    /// OMP knows this provider id on its own (preset, stored login, model cache).
    pub is_builtin: &'a dyn Fn(&str) -> bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Summary {
    pub encrypted: usize,
    pub appended: usize,
    pub skipped: usize,
}

/// OMP `api` string and `baseUrl` of a record (mirrors the retired extension).
fn omp_endpoint(r: &Legacy) -> (&'static str, String) {
    let base = r.base_url.trim();
    let trimmed = base.trim_end_matches('/');
    match r.api {
        ProviderApi::Anthropic => ("anthropic-messages", base.to_string()),
        ProviderApi::Gemini => {
            let versioned = trimmed.ends_with("/v1") || trimmed.ends_with("/v1beta");
            let url = if versioned {
                base.to_string()
            } else {
                format!("{trimmed}/v1beta")
            };
            ("google-generative-ai", url)
        }
        ProviderApi::OpenaiResponses => ("openai-responses", base.to_string()),
        ProviderApi::Ollama => ("openai-completions", format!("{trimmed}/v1")),
        ProviderApi::OpenaiCompletions => ("openai-completions", base.to_string()),
    }
}

/// OMP id of a workbench-only record: its name when that keeps the vault entry
/// name stable, else the slug.
fn omp_id(r: &Legacy) -> String {
    let name = r.name.trim();
    if !name.is_empty() && sanitize_slug(name) == r.slug {
        name.to_string()
    } else {
        r.slug.clone()
    }
}

fn models_of(r: &Legacy) -> Vec<ModelEntry> {
    r.models
        .iter()
        .map(|m| {
            let spec = match m {
                ModelEntry::Id(id) => ModelSpec {
                    id: id.clone(),
                    ..ModelSpec::default()
                },
                ModelEntry::Spec(s) => s.clone(),
            };
            let spec = ModelSpec {
                context_window: spec.context_window.or(r.default_context_window),
                max_tokens: spec.max_tokens.or(r.default_max_tokens),
                ..spec
            };
            if spec.name.is_none() && spec.context_window.is_none() && spec.max_tokens.is_none() {
                ModelEntry::Id(spec.id)
            } else {
                ModelEntry::Spec(spec)
            }
        })
        .collect()
}

/// The key a models.yml provider currently resolves to without env lookups.
fn yml_key(m: &Migration, p: &yml::YmlProvider) -> Option<String> {
    let v = p.api_key.as_deref()?;
    if key_ref::is_ref_for(v, m.shim, &p.id) {
        m.store.get(&key_ref::vault_slug(&p.id)).ok().flatten()
    } else if v.starts_with('!') || super::rows::is_env_name(v) {
        None
    } else {
        Some(v.to_string())
    }
}

fn same_url(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

/// Pure over `text`: returns the migrated text, the counts and the ids to
/// disable. Vault reads happen here; vault writes are returned as `copies`.
struct Plan {
    text: String,
    summary: Summary,
    disable: Vec<String>,
    copies: Vec<(String, String)>,
    appended: Vec<String>,
}

fn plan(m: &Migration, records: &[Legacy], original: &str) -> Result<Plan, String> {
    let mut text = original.to_string();
    let mut summary = Summary::default();

    // 1. env-name refs fed by injection → command reference.
    let existing = yml::parse_providers(&text)?;
    let mut matched: HashSet<usize> = HashSet::new();
    for p in &existing {
        let slug = sanitize_slug(&p.id);
        let Some((i, r)) = records.iter().enumerate().find(|(_, r)| r.slug == slug) else {
            continue;
        };
        matched.insert(i);
        let injected = !r.env_var.is_empty() && p.api_key.as_deref() == Some(r.env_var.as_str());
        if injected && m.store.has(&r.slug) {
            text = yml::set_field(
                &text,
                &p.id,
                "apiKey",
                Some(&key_ref::command_ref_yaml(m.shim, &p.id)),
            )?;
            summary.encrypted += 1;
        }
    }

    // 2. workbench-only records → custom providers.
    let mut disable = Vec::new();
    let mut copies = Vec::new();
    let mut appended = Vec::new();
    for (i, r) in records.iter().enumerate() {
        if matched.contains(&i) {
            continue;
        }
        let id = omp_id(r);
        let current = yml::parse_providers(&text)?;
        if current.iter().any(|p| p.id == id) || (m.is_builtin)(&id) || (m.is_builtin)(&r.slug) {
            summary.skipped += 1;
            continue;
        }
        let (api, base_url) = omp_endpoint(r);
        let key = m.store.get(&r.slug).ok().flatten();
        let duplicate = current.iter().any(|p| {
            p.base_url
                .as_deref()
                .is_some_and(|b| same_url(b, &base_url))
                && p.api.as_deref() == Some(api)
                && key.is_some()
                && yml_key(m, p) == key
        });
        if duplicate {
            summary.skipped += 1;
            continue;
        }
        let local = r.api == ProviderApi::Ollama;
        let spec = BlockSpec {
            id: id.clone(),
            name: (r.name.trim() != id && !r.name.trim().is_empty())
                .then(|| r.name.trim().to_string()),
            base_url,
            api: api.to_string(),
            models: models_of(r),
            auth_none: local && key.is_none(),
        };
        text = yml::upsert_block_text(&text, &spec)?;
        if let Some(k) = &key {
            text = yml::set_field(
                &text,
                &id,
                "apiKey",
                Some(&key_ref::command_ref_yaml(m.shim, &id)),
            )?;
            let new_slug = key_ref::vault_slug(&id);
            if new_slug != r.slug {
                copies.push((new_slug, k.clone()));
            }
        }
        if !r.enabled {
            disable.push(id.clone());
        }
        appended.push(id);
        summary.appended += 1;
    }
    Ok(Plan {
        text,
        summary,
        disable,
        copies,
        appended,
    })
}

fn archive_path(legacy: &Path) -> PathBuf {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let name = legacy.file_name().map_or_else(
        || "providers.json".into(),
        |n| n.to_string_lossy().into_owned(),
    );
    legacy.with_file_name(format!("{name}.migrated-{ts}"))
}

/// Run the migration. `Ok(None)` when there is no legacy store.
pub fn run(m: &Migration) -> Result<Option<Summary>, String> {
    let text = match std::fs::read_to_string(m.legacy) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读取旧版供应商配置失败: {}", e.kind())),
    };
    let records = serde_json::from_str::<LegacyStore>(&text)
        .map_err(|_| "旧版供应商配置 providers.json 无法解析，已跳过迁移".to_string())?
        .providers;

    let original = std::fs::read_to_string(m.models_yml).unwrap_or_default();
    let planned = plan(m, &records, &original)?;
    for (slug, key) in &planned.copies {
        m.store.put(slug, key)?;
    }
    let appended = planned.appended.clone();
    let new_text = planned.text.clone();
    edit_file(m.models_yml, &|_| Ok(new_text.clone()), &|written| {
        let ids = yml::ids_in(written);
        if appended.iter().all(|id| ids.contains(id)) {
            Ok(())
        } else {
            Err("迁移后校验失败".to_string())
        }
    })?;
    for id in &planned.disable {
        config_yml::set_disabled_at(m.config_yml, id, true)?;
    }
    std::fs::rename(m.legacy, archive_path(m.legacy))
        .map_err(|e| format!("归档旧版供应商配置失败: {}", e.kind()))?;
    Ok(Some(planned.summary))
}

/// Startup entry: runs against the real files, logs a secret-free summary.
pub fn run_startup() {
    let legacy = crate::paths::data_dir().join("providers.json");
    let models = yml::models_yml_path();
    let config = config_yml::config_path();
    let shim = key_ref::shim_path();
    let agent_dir = super::omp_config::home_agent_dir();
    let creds = super::omp_config::scan_agent_db(&agent_dir.join("agent.db"));
    let cache_db = agent_dir.join("models.db");
    let is_builtin = |id: &str| {
        super::presets::find(id).is_some()
            || creds.contains_key(id)
            || super::omp_config::read_model_cache_endpoint(&cache_db, id).is_some()
    };
    let m = Migration {
        legacy: &legacy,
        models_yml: &models,
        config_yml: &config,
        shim: &shim,
        store: &super::ops::VaultStore,
        is_builtin: &is_builtin,
    };
    match run(&m) {
        Ok(None) => {}
        Ok(Some(s)) => tracing::info!(
            "providers: migrated providers.json — {} key(s) encrypted, {} provider(s) appended, {} skipped",
            s.encrypted,
            s.appended,
            s.skipped
        ),
        Err(e) => tracing::warn!("providers: migration failed: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ops::tests::MemStore;
    use std::path::Path;

    const SHIM: &str = "/d/bin/ompws-key";

    struct Fx {
        dir: PathBuf,
        legacy: PathBuf,
        models: PathBuf,
        config: PathBuf,
        store: MemStore,
    }

    impl Fx {
        fn new(models: &str, legacy: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("ompws-mig-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let fx = Fx {
                legacy: dir.join("providers.json"),
                models: dir.join("models.yml"),
                config: dir.join("config.yml"),
                dir,
                store: MemStore::default(),
            };
            std::fs::write(&fx.models, models).unwrap();
            std::fs::write(&fx.legacy, legacy).unwrap();
            fx
        }
        fn run(&self) -> Option<Summary> {
            let builtin = |id: &str| id == "openrouter";
            run(&Migration {
                legacy: &self.legacy,
                models_yml: &self.models,
                config_yml: &self.config,
                shim: Path::new(SHIM),
                store: &self.store,
                is_builtin: &builtin,
            })
            .unwrap()
        }
        fn provider(&self, id: &str) -> Option<yml::YmlProvider> {
            yml::read_providers(&self.models)
                .unwrap()
                .into_iter()
                .find(|p| p.id == id)
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn rec(name: &str, slug: &str, base: &str, api: &str, env: &str, enabled: bool) -> String {
        format!(
            r#"{{"id":"u-{slug}","name":"{name}","slug":"{slug}","baseUrl":"{base}","api":"{api}","envVar":"{env}","models":["m1",{{"id":"m2","contextWindow":64000}}],"defaultMaxTokens":2048,"enabled":{enabled},"sort":0,"hasKey":true,"createdAt":"","updatedAt":""}}"#
        )
    }

    const MODELS: &str = "providers:\n  yiyuan:\n    baseUrl: https://y.example/v1\n    api: openai-completions\n    apiKey: YIYUAN_CODEX\n  lit:\n    baseUrl: https://l.example\n    apiKey: sk-literal\n  CodexCN-pro_copy:\n    baseUrl: https://dup.example/v1\n    api: openai-completions\n    apiKey: sk-dup\n";

    fn legacy_json() -> String {
        let recs = [
            rec(
                "yiyuan",
                "yiyuan",
                "https://y.example/v1",
                "openai_completions",
                "YIYUAN_CODEX",
                true,
            ),
            rec(
                "lit",
                "lit",
                "https://l.example",
                "openai_completions",
                "LIT_KEY",
                true,
            ),
            rec(
                "swift-domestic-model",
                "swift-domestic-model",
                "https://s.example",
                "gemini",
                "S_KEY",
                false,
            ),
            rec(
                "openrouter",
                "openrouter",
                "https://openrouter.ai/api/v1",
                "openai_completions",
                "OR_KEY",
                true,
            ),
            rec(
                "CodexCN-pro",
                "CodexCN-pro",
                "https://dup.example/v1",
                "openai_completions",
                "CX",
                true,
            ),
            rec(
                "local-llm",
                "local-llm",
                "http://localhost:11434",
                "ollama",
                "",
                true,
            ),
        ];
        format!(r#"{{"version":1,"providers":[{}]}}"#, recs.join(","))
    }

    #[test]
    fn migration_rules_and_idempotence() {
        let fx = Fx::new(MODELS, &legacy_json());
        for (slug, key) in [
            ("yiyuan", "k-yiyuan"),
            ("lit", "k-lit"),
            ("swift-domestic-model", "k-swift"),
            ("openrouter", "k-or"),
            ("CodexCN-pro", "sk-dup"),
        ] {
            fx.store.put(slug, key).unwrap();
        }
        let s = fx.run().expect("legacy store present");
        assert_eq!(
            s,
            Summary {
                encrypted: 1,
                appended: 2,
                skipped: 2
            }
        );

        // env-name ref -> encrypted
        let y = fx.provider("yiyuan").unwrap();
        assert!(key_ref::is_ref_for(
            y.api_key.as_deref().unwrap(),
            Path::new(SHIM),
            "yiyuan"
        ));
        // literal untouched even though the record has a vault key
        assert_eq!(
            fx.provider("lit").unwrap().api_key.as_deref(),
            Some("sk-literal")
        );
        // workbench-only custom appended with ref, endpoint mapping and model defaults
        let sw = fx.provider("swift-domestic-model").unwrap();
        assert_eq!(sw.api.as_deref(), Some("google-generative-ai"));
        assert_eq!(sw.base_url.as_deref(), Some("https://s.example/v1beta"));
        assert!(key_ref::is_ref_for(
            sw.api_key.as_deref().unwrap(),
            Path::new(SHIM),
            "swift-domestic-model"
        ));
        assert_eq!(sw.models.len(), 2);
        let ModelEntry::Spec(m1) = &sw.models[0] else {
            panic!("m1 should carry the default max tokens")
        };
        assert_eq!(m1.max_tokens, Some(2048));
        // ollama (no vault key) -> auth none at /v1
        let ol = fx.provider("local-llm").unwrap();
        assert_eq!(ol.base_url.as_deref(), Some("http://localhost:11434/v1"));
        assert!(ol.auth_none && ol.api_key.is_none());
        // built-in and stale duplicate skipped
        assert!(fx.provider("openrouter").is_none());
        assert!(fx.provider("CodexCN-pro").is_none());
        // disabled record carried over; legacy archived; vault untouched
        assert!(
            config_yml::disabled_ids(&std::fs::read_to_string(&fx.config).unwrap())
                .unwrap()
                .contains("swift-domestic-model")
        );
        assert!(!fx.legacy.exists());
        assert!(std::fs::read_dir(&fx.dir).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("providers.json.migrated-")));
        assert!(fx.store.has("lit") && fx.store.has("openrouter"));
        assert!(std::fs::read_dir(&fx.dir).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("models.yml.bak-")));

        // second run: nothing to do, files unchanged
        let after = std::fs::read_to_string(&fx.models).unwrap();
        assert!(fx.run().is_none());
        assert_eq!(std::fs::read_to_string(&fx.models).unwrap(), after);
    }

    #[test]
    fn injected_env_without_vault_key_is_left_alone_and_bad_store_is_reported() {
        let fx = Fx::new(MODELS, &legacy_json());
        let s = fx.run().unwrap();
        assert_eq!(s.encrypted, 0);
        assert_eq!(
            fx.provider("yiyuan").unwrap().api_key.as_deref(),
            Some("YIYUAN_CODEX")
        );

        let bad = Fx::new(MODELS, "not json");
        let builtin = |_: &str| false;
        let r = run(&Migration {
            legacy: &bad.legacy,
            models_yml: &bad.models,
            config_yml: &bad.config,
            shim: Path::new(SHIM),
            store: &bad.store,
            is_builtin: &builtin,
        });
        assert!(r.is_err());
        assert!(
            bad.legacy.exists(),
            "unparseable store is kept for the user"
        );
    }
}
