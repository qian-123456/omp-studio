//! [providers] Tauri commands: provider CRUD + encrypted vault + probe.
//! API keys arrive as command arguments, are encrypted into the vault and are
//! never persisted anywhere else, logged, or returned to the frontend.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use crate::contracts::{ProviderApi, ProviderConfig, ProviderTestResult};

use super::{store, vault};

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Last 4 chars of a key, stored in metadata for display.
fn key_hint(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    let start = chars.len().saturating_sub(4);
    chars[start..].iter().collect()
}

/// Validate user-editable fields. Key values are never part of the config.
pub(crate) fn validate(config: &ProviderConfig) -> Result<(), String> {
    let name = config.name.trim();
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let slug = config.slug.trim();
    if slug.is_empty() {
        return Err("标识符 (slug) 不能为空".to_string());
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("标识符只能包含字母、数字、下划线和连字符".to_string());
    }
    let base_url = config.base_url.trim();
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err("Base URL 必须以 http:// 或 https:// 开头".to_string());
    }
    let env_var = config.env_var.trim();
    if env_var.is_empty() {
        return Err("环境变量名不能为空".to_string());
    }
    if !env_var
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    {
        return Err("环境变量名只能包含大写字母、数字和下划线".to_string());
    }
    for (label, value) in [
        ("名称", name),
        ("Base URL", base_url),
        ("环境变量名", env_var),
    ] {
        if value.contains('\0') || value.contains('\n') || value.contains('\r') {
            return Err(format!("{label}不能包含换行或空字符"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn provider_list() -> Result<Vec<ProviderConfig>, String> {
    let mut providers = store::load();
    for provider in &mut providers {
        provider.has_key = vault::contains(&provider.slug);
    }
    providers.sort_by_key(|p| p.sort);
    Ok(providers)
}

/// Upsert metadata. `api_key` Some(non-empty) → encrypt into the vault;
/// Some(empty)/None → keep the existing key. Returns the saved config.
#[tauri::command]
pub async fn provider_save(
    mut config: ProviderConfig,
    api_key: Option<String>,
) -> Result<ProviderConfig, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    validate(&config)?;
    config.name = config.name.trim().to_string();
    config.slug = config.slug.trim().to_string();
    config.base_url = config.base_url.trim().to_string();
    config.env_var = config.env_var.trim().to_string();

    let mut providers = store::load();
    let now = now_iso();
    let new_key = api_key.as_deref().map(str::trim).filter(|k| !k.is_empty());

    match providers.iter().position(|p| p.id == config.id) {
        None => {
            if config.id.is_empty() {
                config.id = uuid::Uuid::new_v4().to_string();
            }
            config.created_at = now.clone();
            config.sort = providers.iter().map(|p| p.sort).max().unwrap_or(0) + 1;
            config.updated_at = now;
            match new_key {
                Some(key) => {
                    vault::write_entry(&config.slug, key)?;
                    config.has_key = true;
                    config.key_hint = Some(key_hint(key));
                }
                None => {
                    config.has_key = false;
                    config.key_hint = None;
                }
            }
            providers.push(config.clone());
        }
        Some(idx) => {
            let prev = providers[idx].clone();
            config.id = prev.id.clone();
            config.created_at = prev.created_at.clone();
            config.sort = prev.sort;
            config.updated_at = now;
            match new_key {
                Some(key) => {
                    vault::write_entry(&config.slug, key)?;
                    config.has_key = true;
                    config.key_hint = Some(key_hint(key));
                }
                None => {
                    // Slug changed: migrate the stored key so it is not orphaned.
                    if prev.slug != config.slug && vault::contains(&prev.slug) {
                        if let Some(value) = vault::read_entry(&prev.slug)? {
                            vault::write_entry(&config.slug, &value)?;
                        }
                        vault::remove_entry(&prev.slug)?;
                    }
                    config.has_key = vault::contains(&config.slug);
                    if !config.has_key {
                        config.key_hint = None;
                    }
                }
            }
            providers[idx] = config.clone();
        }
    }

    store::save(&providers)?;
    Ok(config)
}

/// Remove metadata and the provider's vault entry.
#[tauri::command]
pub async fn provider_delete(id: String) -> Result<(), String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let mut providers = store::load();
    if let Some(idx) = providers.iter().position(|p| p.id == id) {
        let slug = providers.remove(idx).slug;
        vault::remove_entry(&slug)?;
        store::save(&providers)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn provider_set_enabled(id: String, enabled: bool) -> Result<(), String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let mut providers = store::load();
    let provider = providers
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "供应商不存在".to_string())?;
    provider.enabled = enabled;
    provider.updated_at = now_iso();
    store::save(&providers)?;
    Ok(())
}

/// Assign `sort` = index for the given id order.
#[tauri::command]
pub async fn provider_reorder(ids: Vec<String>) -> Result<(), String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let mut providers = store::load();
    let now = now_iso();
    for (index, id) in ids.iter().enumerate() {
        if let Some(provider) = providers.iter_mut().find(|p| p.id == *id) {
            provider.sort = index as i64;
            provider.updated_at = now.clone();
        }
    }
    store::save(&providers)?;
    Ok(())
}

/// In-memory decrypt + real HTTP probe (10s timeout). Returns a concise
/// Chinese detail; key material never appears in errors or results.
#[tauri::command]
pub async fn provider_test(id: String) -> Result<ProviderTestResult, String> {
    let config = store::load()
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "供应商不存在".to_string())?;
    let has_key = vault::contains(&config.slug);
    if !has_key && config.api != ProviderApi::Ollama {
        return Ok(ProviderTestResult {
            ok: false,
            latency_ms: 0,
            detail: "尚未配置 API 密钥".to_string(),
        });
    }
    let key = if has_key {
        Some(vault::read_entry(&config.slug)?.ok_or_else(|| "读取密钥失败".to_string())?)
    } else {
        None
    };
    test_provider(&config, key.as_deref()).await
}

async fn test_provider(
    config: &ProviderConfig,
    key: Option<&str>,
) -> Result<ProviderTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let base = config.base_url.trim_end_matches('/');

    let started = Instant::now();
    let response = match config.api {
        ProviderApi::OpenaiCompletions => {
            let mut req = client.get(format!("{base}/models"));
            if let Some(k) = key {
                req = req.bearer_auth(k);
            }
            req.send().await
        }
        ProviderApi::Anthropic => {
            let mut req = client
                .get(format!("{base}/v1/models"))
                .header("anthropic-version", "2023-06-01");
            if let Some(k) = key {
                req = req.header("x-api-key", k);
            }
            req.send().await
        }
        ProviderApi::Gemini => {
            let mut url = format!("{base}/v1beta/models");
            if let Some(k) = key {
                url = format!("{url}?key={k}");
            }
            client.get(url).send().await
        }
        ProviderApi::Ollama => client.get(format!("{base}/api/tags")).send().await,
    };
    let latency_ms = started.elapsed().as_millis() as u64;

    let response = match response {
        Ok(response) => response,
        Err(e) => {
            return Ok(ProviderTestResult {
                ok: false,
                latency_ms,
                detail: format!("连接失败: {e}"),
            });
        }
    };
    let status = response.status();
    if !status.is_success() {
        let detail = match status.as_u16() {
            401 | 403 => "鉴权失败：密钥无效或无权限".to_string(),
            404 => "接口不存在：请检查 Base URL".to_string(),
            429 => "请求过于频繁或额度受限".to_string(),
            _ => format!("HTTP {status}"),
        };
        return Ok(ProviderTestResult {
            ok: false,
            latency_ms,
            detail,
        });
    }
    let body = response.text().await.unwrap_or_default();
    let detail = match count_models(&body, config.api) {
        Some(n) => format!("连接成功，发现 {n} 个模型"),
        None => "连接成功".to_string(),
    };
    Ok(ProviderTestResult {
        ok: true,
        latency_ms,
        detail,
    })
}

/// Best-effort model count from a `{data|models: [...]}` JSON body.
fn count_models(body: &str, api: ProviderApi) -> Option<usize> {
    let value = serde_json::from_str::<serde_json::Value>(body).ok()?;
    let list = match api {
        ProviderApi::Gemini => value.get("models")?,
        ProviderApi::OpenaiCompletions | ProviderApi::Anthropic => value.get("data")?,
        ProviderApi::Ollama => value.get("models")?,
    };
    list.as_array().map(|a| a.len())
}

/// Plaintext `.env` TEXT for the explicit "复制 .env" button (clipboard only —
/// the app itself never writes this to disk). Caller order wins when `ids`
/// is given, otherwise sort order. Only providers with keys are included.
#[tauri::command]
pub async fn provider_export_env_text(ids: Option<Vec<String>>) -> Result<String, String> {
    let providers = store::load();
    let mut selected: Vec<ProviderConfig> = match &ids {
        Some(ids) => ids
            .iter()
            .filter_map(|id| providers.iter().find(|p| &p.id == id))
            .cloned()
            .collect(),
        None => {
            let mut all = providers;
            all.sort_by_key(|p| p.sort);
            all
        }
    };
    let mut seen = HashSet::new();
    selected.retain(|p| seen.insert(p.env_var.clone()));

    let mut out = String::new();
    for provider in selected {
        let Some(value) = vault::read_entry(&provider.slug)? else {
            continue;
        };
        out.push_str(&format!("{}={}\n", provider.env_var, value));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(name: &str, slug: &str, base: &str, env: &str) -> ProviderConfig {
        ProviderConfig {
            id: String::new(),
            name: name.to_string(),
            slug: slug.to_string(),
            preset_id: None,
            base_url: base.to_string(),
            api: ProviderApi::OpenaiCompletions,
            env_var: env.to_string(),
            models: Vec::new(),
            default_model: None,
            enabled: true,
            sort: 0,
            has_key: false,
            key_hint: None,
            notes: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn validate_accepts_wellformed_and_rejects_bad_fields() {
        assert!(validate(&config("My", "my-slug_1", "https://x.dev/v1", "MY_KEY")).is_ok());

        let mut c = config("", "slug", "https://x.dev", "KEY");
        assert_eq!(validate(&c).unwrap_err(), "名称不能为空");

        c = config("n", "", "https://x.dev", "KEY");
        assert_eq!(validate(&c).unwrap_err(), "标识符 (slug) 不能为空");

        c = config("n", "bad slug!", "https://x.dev", "KEY");
        assert!(validate(&c).unwrap_err().contains("标识符"));

        c = config("n", "slug", "ftp://x.dev", "KEY");
        assert!(validate(&c).unwrap_err().contains("Base URL"));

        c = config("n", "slug", "https://x.dev", "");
        assert_eq!(validate(&c).unwrap_err(), "环境变量名不能为空");

        c = config("n", "slug", "https://x.dev", "lower-key");
        assert!(validate(&c).unwrap_err().contains("环境变量名"));

        c = config("n\nline", "slug", "https://x.dev", "KEY");
        assert!(validate(&c).unwrap_err().contains("名称"));

        c = config("n", "slug", "https://x.dev\0", "KEY");
        assert!(validate(&c).unwrap_err().contains("Base URL"));
    }

    #[test]
    fn key_hint_shows_last_four_chars() {
        assert_eq!(key_hint("sk-1234567890"), "7890");
        assert_eq!(key_hint("abc"), "abc");
        assert_eq!(key_hint("密钥abcd"), "abcd");
    }

    #[test]
    fn count_models_reads_data_and_models_arrays() {
        assert_eq!(
            count_models(
                r#"{"data":[{"id":"a"},{"id":"b"}]}"#,
                ProviderApi::OpenaiCompletions
            ),
            Some(2)
        );
        assert_eq!(
            count_models(r#"{"models":[{"name":"m"}]}"#, ProviderApi::Ollama),
            Some(1)
        );
        assert_eq!(count_models("not json", ProviderApi::Gemini), None);
    }
}
