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

/// Lenient load for runtime paths (session spawn): empty when the store is
/// missing or unparseable (the parse failure is logged).
pub fn load() -> Vec<ProviderConfig> {
    match try_load() {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("{e}");
            Vec::new()
        }
    }
}

/// Strict load: a missing file is an empty list, an unparseable one is an error.
pub fn try_load() -> Result<Vec<ProviderConfig>, String> {
    load_from(&path())
}

/// Persist all providers atomically (tmp + rename). An unparseable existing
/// file is copied to `providers.json.corrupt-<ts>` before being replaced.
pub fn save(providers: &[ProviderConfig]) -> Result<(), String> {
    save_to(&path(), providers)
}

fn load_from(path: &Path) -> Result<Vec<ProviderConfig>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("无法读取供应商配置文件 {}：{e}", path.display())),
    };
    serde_json::from_str::<ProviderStore>(&text)
        .map(|s| s.providers)
        .map_err(|e| {
            format!(
                "供应商配置文件无法解析：{}（{e}）。请修复或删除该文件后重试",
                path.display()
            )
        })
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
    if path.exists() && load_from(path).is_err() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let backup = path.with_extension(format!("json.corrupt-{ts}"));
        std::fs::copy(path, &backup).map_err(|e| {
            format!(
                "供应商配置文件无法解析，且备份到 {} 失败：{e}",
                backup.display()
            )
        })?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("写入 providers.json 失败: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换 providers.json 失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{ModelEntry, ProviderApi};

    fn sample(slug: &str, sort: i64) -> ProviderConfig {
        ProviderConfig {
            id: format!("id-{slug}"),
            name: slug.to_string(),
            slug: slug.to_string(),
            preset_id: None,
            base_url: "https://api.example.com/v1".to_string(),
            api: ProviderApi::OpenaiCompletions,
            env_var: format!("{}_API_KEY", slug.to_ascii_uppercase()),
            models: vec![ModelEntry::Id("m1".to_string())],
            default_model: None,
            default_context_window: None,
            default_max_tokens: None,
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
        assert_eq!(load_from(&path).unwrap(), providers);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_is_empty_corrupt_is_error_and_save_backs_up() {
        let missing = std::env::temp_dir().join(format!(
            "omp-providers-missing-{}.json",
            uuid::Uuid::new_v4()
        ));
        assert!(load_from(&missing).unwrap().is_empty());

        let corrupt = std::env::temp_dir().join(format!(
            "omp-providers-corrupt-{}.json",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&corrupt, "{ not json").unwrap();
        let err = load_from(&corrupt).unwrap_err();
        assert!(err.contains("无法解析") && err.contains(&corrupt.display().to_string()));

        save_to(&corrupt, &[sample("a", 1)]).unwrap();
        let dir = corrupt.parent().unwrap();
        let stem = corrupt.file_stem().unwrap().to_string_lossy().to_string();
        let backups: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.starts_with(&stem) && n.contains(".corrupt-")
            })
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            std::fs::read_to_string(backups[0].path()).unwrap(),
            "{ not json"
        );
        std::fs::remove_file(backups[0].path()).ok();
        std::fs::remove_file(&corrupt).ok();
    }
}
