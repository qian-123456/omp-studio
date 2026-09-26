//! Non-secret provider metadata store: `~/.omp-workspace/providers.json`.
//! `{ "version": 1, "providers": [ProviderConfig] }` — never contains key
//! material (`hasKey`/`keyHint` only). Atomic tmp+rename writes.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::contracts::ProviderConfig;
use crate::paths;

#[derive(Debug, Serialize, Deserialize)]
struct ProviderStore {
    version: u32,
    providers: Vec<ProviderConfig>,
}

/// `~/.omp-workspace/providers.json`
pub fn path() -> PathBuf {
    paths::data_dir().join("providers.json")
}

/// Load all providers (empty when the store does not exist or is corrupt).
pub fn load() -> Vec<ProviderConfig> {
    load_from(&path())
}

/// Persist all providers atomically (tmp + rename).
pub fn save(providers: &[ProviderConfig]) -> Result<(), String> {
    save_to(&path(), providers)
}

fn load_from(path: &Path) -> Vec<ProviderConfig> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<ProviderStore>(&text) {
        Ok(store) => store.providers,
        Err(e) => {
            tracing::warn!("providers.json parse failed: {e}");
            Vec::new()
        }
    }
}

fn save_to(path: &Path, providers: &[ProviderConfig]) -> Result<(), String> {
    let store = ProviderStore {
        version: 1,
        providers: providers.to_vec(),
    };
    let text = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("写入 providers.json 失败: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换 providers.json 失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::ProviderApi;

    fn sample(slug: &str, sort: i64) -> ProviderConfig {
        ProviderConfig {
            id: format!("id-{slug}"),
            name: slug.to_string(),
            slug: slug.to_string(),
            preset_id: None,
            base_url: "https://api.example.com/v1".to_string(),
            api: ProviderApi::OpenaiCompletions,
            env_var: format!("{}_API_KEY", slug.to_ascii_uppercase()),
            models: vec!["m1".to_string()],
            default_model: None,
            enabled: true,
            sort,
            has_key: false,
            key_hint: None,
            notes: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn roundtrip_preserves_fields_and_order() {
        let path =
            std::env::temp_dir().join(format!("omp-providers-test-{}.json", uuid::Uuid::new_v4()));
        let providers = vec![sample("b", 2), sample("a", 1)];
        save_to(&path, &providers).unwrap();
        assert_eq!(load_from(&path), providers);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_or_corrupt_store_loads_empty() {
        let missing = std::env::temp_dir().join(format!(
            "omp-providers-missing-{}.json",
            uuid::Uuid::new_v4()
        ));
        assert!(load_from(&missing).is_empty());

        let corrupt = std::env::temp_dir().join(format!(
            "omp-providers-corrupt-{}.json",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&corrupt, "{ not json").unwrap();
        assert!(load_from(&corrupt).is_empty());
        std::fs::remove_file(&corrupt).ok();
    }
}
