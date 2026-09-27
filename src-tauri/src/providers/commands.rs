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
    let url = reqwest::Url::parse(base_url)
        .map_err(|_| "Base URL 必须是有效的 http:// 或 https:// 地址".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err("Base URL 必须是有效的 http:// 或 https:// 地址".to_string());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Base URL 不能包含用户名、密码、查询参数或片段".to_string());
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

fn validate_unique(config: &ProviderConfig, providers: &[ProviderConfig]) -> Result<(), String> {
    for existing in providers.iter().filter(|p| p.id != config.id) {
        if vault::line_key(&existing.slug) == vault::line_key(&config.slug) {
            return Err("标识符已被其他供应商使用".to_string());
        }
        if existing.env_var == config.env_var {
            return Err("环境变量名已被其他供应商使用".to_string());
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
    validate_unique(&config, &providers)?;
    let now = now_iso();
    let new_key = api_key.as_deref().map(str::trim).filter(|k| !k.is_empty());
    let mut old_slug = None;

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
                    if vault::line_key(&prev.slug) != vault::line_key(&config.slug) {
                        old_slug = Some(prev.slug.clone());
                    }
                    config.has_key = true;
                    config.key_hint = Some(key_hint(key));
                }
                None => {
                    // Slug changed: migrate the stored key so it is not orphaned.
                    if vault::line_key(&prev.slug) != vault::line_key(&config.slug)
                        && vault::contains(&prev.slug)
                    {
                        if let Some(value) = vault::read_entry(&prev.slug)? {
                            vault::write_entry(&config.slug, &value)?;
                        }
                        old_slug = Some(prev.slug.clone());
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
    if let Some(slug) = old_slug {
        vault::remove_entry(&slug)?;
    }
    Ok(config)
}

/// Remove metadata and the provider's vault entry.
#[tauri::command]
pub async fn provider_delete(id: String) -> Result<(), String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let mut providers = store::load();
    if let Some(idx) = providers.iter().position(|p| p.id == id) {
        let slug = providers.remove(idx).slug;
        store::save(&providers)?;
        vault::remove_entry(&slug)?;
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
        .redirect(reqwest::redirect::Policy::none())
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
            let mut req = client.get(format!("{base}/v1beta/models"));
            if let Some(k) = key {
                req = req.header("x-goog-api-key", k);
            }
            req.send().await
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
                detail: format!("连接失败: {}", e.without_url()),
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
    let selected: Vec<ProviderConfig> = match &ids {
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
    let mut out = String::new();
    for provider in selected {
        if seen.contains(&provider.env_var) {
            continue;
        }
        let Some(value) = vault::read_entry(&provider.slug)? else {
            continue;
        };
        seen.insert(provider.env_var.clone());
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

        c = config("n", "slug", "https://user:secret@x.dev/v1", "KEY");
        assert!(validate(&c).unwrap_err().contains("Base URL"));

        c = config("n", "slug", "https://x.dev/v1?key=secret", "KEY");
        assert!(validate(&c).unwrap_err().contains("Base URL"));
    }

    #[test]
    fn duplicate_provider_identity_is_rejected_except_for_self() {
        let mut existing = config("First", "first", "https://x.dev", "FIRST_KEY");
        existing.id = "id-1".to_string();
        let mut edited = existing.clone();
        edited.name = "Renamed".to_string();
        assert!(validate_unique(&edited, &[existing.clone()]).is_ok());

        let duplicate_slug = config("Second", "first", "https://x.dev", "SECOND_KEY");
        assert!(validate_unique(&duplicate_slug, &[existing.clone()])
            .unwrap_err()
            .contains("标识符"));
        let case_alias = config("Second", "FIRST", "https://x.dev", "SECOND_KEY");
        assert!(validate_unique(&case_alias, &[existing.clone()])
            .unwrap_err()
            .contains("标识符"));
        let duplicate_env = config("Second", "second", "https://x.dev", "FIRST_KEY");
        assert!(validate_unique(&duplicate_env, &[existing])
            .unwrap_err()
            .contains("环境变量"));
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

    #[tokio::test]
    async fn probe_does_not_follow_redirects_with_credentials() {
        use axum::{response::Redirect, routing::get, Router};
        use std::future::IntoFuture;
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let hits = Arc::new(AtomicUsize::new(0));
        let target_hits = hits.clone();
        let target = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let location = format!("http://{}/models", target.local_addr().unwrap());
        let target_task = tokio::spawn(
            axum::serve(
                target,
                Router::new().route(
                    "/models",
                    get(move || async move {
                        target_hits.fetch_add(1, Ordering::SeqCst);
                        "{}"
                    }),
                ),
            )
            .into_future(),
        );
        let source = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", source.local_addr().unwrap());
        let source_task = tokio::spawn(
            axum::serve(
                source,
                Router::new().route(
                    "/v1beta/models",
                    get(move || async move { Redirect::temporary(&location) }),
                ),
            )
            .into_future(),
        );
        let mut provider = config("Test", "test", &base, "TEST_KEY");
        provider.api = ProviderApi::Gemini;
        let result = test_provider(&provider, Some("secret-test-key"))
            .await
            .unwrap();
        target_task.abort();
        source_task.abort();
        assert!(!result.ok);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        assert!(!result.detail.contains("secret-test-key"));
    }
}
