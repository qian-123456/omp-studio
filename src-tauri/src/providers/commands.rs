//! [providers] Tauri commands: provider CRUD + encrypted vault + probe.
//! API keys arrive as command arguments, are encrypted into the vault and are
//! never persisted anywhere else, logged, or returned to the frontend.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use crate::contracts::{
    ModelEntry, OmpImportIssue, OmpImportPlanItem, OmpImportResult, ProviderApi, ProviderConfig,
    ProviderTestResult,
};

use super::omp_config::{self, RawParsedProvider};
use super::{presets, store, vault};

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Last 4 chars of a key, stored in metadata for display.
fn key_hint(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    let start = chars.len().saturating_sub(4);
    chars[start..].iter().collect()
}

fn is_reserved_env_var(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    if upper.starts_with("DYLD_") || upper.starts_with("LD_") || upper.starts_with("OMP_") {
        return true;
    }
    matches!(
        upper.as_str(),
        "PATH"
            | "HOME"
            | "SHELL"
            | "USER"
            | "LOGNAME"
            | "TMPDIR"
            | "NODE_OPTIONS"
            | "HTTP_PROXY"
            | "HTTPS_PROXY"
            | "ALL_PROXY"
            | "NO_PROXY"
    )
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
    if url.host_str().is_none() {
        return Err("Base URL 必须是有效的 http:// 或 https:// 地址".to_string());
    }
    if !matches!(url.scheme(), "http" | "https") {
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
    if is_reserved_env_var(env_var) {
        return Err(format!("环境变量名 \"{env_var}\" 是系统保留名称，不可使用"));
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
    if let Some(w) = config.default_context_window {
        if w > 2_000_000 {
            return Err("默认上下文窗口大小不能超过 2,000,000".to_string());
        }
    }
    if let Some(t) = config.default_max_tokens {
        if t > 2_000_000 {
            return Err("默认最大输出 Token 数不能超过 2,000,000".to_string());
        }
    }
    for model in &config.models {
        let id = model.id().trim();
        if id.is_empty() {
            return Err("模型 ID 不能为空".to_string());
        }
        if id.contains('\0') || id.contains('\n') || id.contains('\r') {
            return Err("模型 ID 不能包含换行或空字符".to_string());
        }
        if let ModelEntry::Spec(spec) = model {
            if let Some(w) = spec.context_window {
                if w > 2_000_000 {
                    return Err(format!("模型 \"{id}\" 的上下文窗口大小不能超过 2,000,000"));
                }
            }
            if let Some(t) = spec.max_tokens {
                if t > 2_000_000 {
                    return Err(format!(
                        "模型 \"{id}\" 的最大输出 Token 数不能超过 2,000,000"
                    ));
                }
            }
            if let Some(name) = &spec.name {
                if name.contains('\0') || name.contains('\n') || name.contains('\r') {
                    return Err(format!("模型 \"{id}\" 的名称不能包含换行或空字符"));
                }
            }
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
    let mut providers = store::try_load()?;
    for provider in &mut providers {
        provider.has_key = vault::contains(&provider.slug);
    }
    // models.yml is the source of truth for providers OMP itself defines.
    super::models_yml_providers::overlay_models(
        &super::models_yml_providers::models_yml_path(),
        &mut providers,
    );
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

    let mut providers = store::try_load()?;
    validate_unique(&config, &providers)?;
    // OMP reads `providers.<slug>.models` from models.yml itself: write there first so
    // a failure leaves the app store untouched. No-op for app-only providers.
    super::models_yml_providers::write_models(
        &super::models_yml_providers::models_yml_path(),
        &config.slug,
        &config.models,
    )?;
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
                    providers.push(config.clone());
                    if let Err(e) = store::save(&providers) {
                        // Rollback newly written vault entry on store save failure
                        let _ = vault::remove_entry(&config.slug);
                        return Err(e);
                    }
                }
                None => {
                    // If a stale vault entry already exists under this slug (e.g. from
                    // an uninstalled provider or prior failed operation) and the user did
                    // not supply a key for the new provider, purge the stale entry so it
                    // is not silently adopted.
                    if vault::contains(&config.slug) {
                        vault::remove_entry(&config.slug)?;
                    }
                    config.has_key = false;
                    config.key_hint = None;
                    providers.push(config.clone());
                    store::save(&providers)?;
                }
            }
        }
        Some(idx) => {
            let prev = providers[idx].clone();
            config.id = prev.id.clone();
            config.created_at = prev.created_at.clone();
            config.sort = prev.sort;
            config.updated_at = now;

            let is_rename = vault::line_key(&prev.slug) != vault::line_key(&config.slug);
            // Save backup of old key in case rollback is needed on store save failure
            let prev_key = if is_rename || new_key.is_some() {
                vault::read_entry(&prev.slug).unwrap_or(None)
            } else {
                None
            };

            match new_key {
                Some(key) => {
                    vault::write_entry(&config.slug, key)?;
                    if is_rename {
                        if let Err(e) = vault::remove_entry(&prev.slug) {
                            // Rollback newly written entry
                            let _ = vault::remove_entry(&config.slug);
                            return Err(format!("清理旧密钥失败: {e}"));
                        }
                    }
                    config.has_key = true;
                    config.key_hint = Some(key_hint(key));
                }
                None => {
                    if is_rename {
                        if vault::contains(&prev.slug) {
                            if let Some(value) = &prev_key {
                                vault::write_entry(&config.slug, value)?;
                            }
                            if let Err(e) = vault::remove_entry(&prev.slug) {
                                let _ = vault::remove_entry(&config.slug);
                                return Err(format!("清理旧密钥失败: {e}"));
                            }
                        } else if vault::contains(&config.slug) {
                            // Target slug has a stale entry, but old slug had none: purge stale
                            vault::remove_entry(&config.slug)?;
                        }
                    }
                    config.has_key = vault::contains(&config.slug);
                    if !config.has_key {
                        config.key_hint = None;
                    }
                }
            }

            providers[idx] = config.clone();

            if let Err(e) = store::save(&providers) {
                // Rollback vault mutations if store save fails
                if is_rename {
                    let _ = vault::remove_entry(&config.slug);
                    if let Some(val) = &prev_key {
                        let _ = vault::write_entry(&prev.slug, val);
                    }
                } else if new_key.is_some() {
                    match &prev_key {
                        Some(val) => {
                            let _ = vault::write_entry(&config.slug, val);
                        }
                        None => {
                            let _ = vault::remove_entry(&config.slug);
                        }
                    }
                }
                return Err(e);
            }
        }
    }

    Ok(config)
}

/// Remove metadata and the provider's vault entry.
#[tauri::command]
pub async fn provider_delete(id: String) -> Result<(), String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let mut providers = store::try_load()?;
    if let Some(idx) = providers.iter().position(|p| p.id == id) {
        let slug = providers[idx].slug.clone();
        // Remove vault entry first; remove_entry is idempotent so if store::save
        // fails afterward, the provider remains visible and the user can safely
        // retry delete without leaving an orphaned secret in keys.env.
        vault::remove_entry(&slug)?;
        providers.remove(idx);
        store::save(&providers)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn provider_set_enabled(id: String, enabled: bool) -> Result<(), String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let mut providers = store::try_load()?;
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
    let mut providers = store::try_load()?;
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
    let config = store::try_load()?
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
        ProviderApi::OpenaiCompletions | ProviderApi::OpenaiResponses => {
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
        ProviderApi::Gemini | ProviderApi::Ollama => value.get("models")?,
        ProviderApi::OpenaiCompletions | ProviderApi::OpenaiResponses | ProviderApi::Anthropic => {
            value.get("data")?
        }
    };
    list.as_array().map(|a| a.len())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub name: Option<String>,
}

/// Fetches available models directly from the provider's API endpoint (without CORS restrictions).
#[tauri::command]
pub async fn provider_fetch_models(
    base_url: String,
    api_key: Option<String>,
    api: ProviderApi,
    provider_id: Option<String>,
) -> Result<Vec<DiscoveredModel>, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }

    let mut key = api_key.and_then(|k| {
        let trimmed = k.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    if key.is_none() {
        if let Some(pid) = provider_id {
            if let Some(config) = store::load().into_iter().find(|p| p.id == pid) {
                if vault::contains(&config.slug) {
                    if let Ok(Some(k)) = vault::read_entry(&config.slug) {
                        key = Some(k);
                    }
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let response = match api {
        ProviderApi::OpenaiCompletions | ProviderApi::OpenaiResponses => {
            let mut req = client.get(format!("{base}/models"));
            if let Some(k) = &key {
                req = req.bearer_auth(k);
            }
            req.send().await
        }
        ProviderApi::Anthropic => {
            let mut req = client
                .get(format!("{base}/v1/models"))
                .header("anthropic-version", "2023-06-01");
            if let Some(k) = &key {
                req = req.header("x-api-key", k);
            }
            req.send().await
        }
        ProviderApi::Gemini => {
            let mut req = client.get(format!("{base}/v1beta/models"));
            if let Some(k) = &key {
                req = req.header("x-goog-api-key", k);
            }
            req.send().await
        }
        ProviderApi::Ollama => client.get(format!("{base}/api/tags")).send().await,
    };

    let response = response.map_err(|e| format!("请求失败: {}", e.without_url()))?;
    let status = response.status();
    if !status.is_success() {
        let detail = match status.as_u16() {
            401 | 403 => "鉴权失败：密钥无效或无权限".to_string(),
            404 => "接口不存在：请检查 Base URL 是否正确".to_string(),
            429 => "请求过于频繁或额度受限".to_string(),
            code => format!("HTTP {code}"),
        };
        return Err(format!("获取模型失败 ({detail})"));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("响应非有效 JSON: {e}"))?;

    let mut models = Vec::new();
    let mut seen = HashSet::new();

    match api {
        ProviderApi::Gemini => {
            if let Some(list) = value.get("models").and_then(|v| v.as_array()) {
                for item in list {
                    if let Some(name) = item.get("name").and_then(|s| s.as_str()) {
                        let id = name.strip_prefix("models/").unwrap_or(name).to_string();
                        let display_name = item
                            .get("displayName")
                            .and_then(|s| s.as_str())
                            .map(|s| s.to_string());
                        if seen.insert(id.clone()) {
                            models.push(DiscoveredModel {
                                id,
                                name: display_name,
                            });
                        }
                    }
                }
            }
        }
        ProviderApi::Ollama => {
            if let Some(list) = value.get("models").and_then(|v| v.as_array()) {
                for item in list {
                    if let Some(name) = item.get("name").and_then(|s| s.as_str()) {
                        let id = name.to_string();
                        if seen.insert(id.clone()) {
                            models.push(DiscoveredModel { id, name: None });
                        }
                    }
                }
            }
        }
        ProviderApi::OpenaiCompletions | ProviderApi::OpenaiResponses | ProviderApi::Anthropic => {
            let list = value
                .get("data")
                .or_else(|| value.get("models"))
                .and_then(|v| v.as_array())
                .or_else(|| value.as_array());

            if let Some(items) = list {
                for item in items {
                    let id_opt = item
                        .get("id")
                        .or_else(|| item.get("name"))
                        .and_then(|s| s.as_str());
                    if let Some(raw_id) = id_opt {
                        let id = raw_id.to_string();
                        let display = item
                            .get("display_name")
                            .or_else(|| item.get("name"))
                            .and_then(|s| s.as_str())
                            .filter(|d| *d != raw_id)
                            .map(|s| s.to_string());
                        if seen.insert(id.clone()) {
                            models.push(DiscoveredModel { id, name: display });
                        }
                    }
                }
            }
        }
    }

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

/// In-memory decrypt + real HTTP probe for a specific model (30s timeout).
/// Returns a concise Chinese detail; key material never appears in errors or results.
#[tauri::command]
pub async fn provider_test_model(
    id: String,
    model_id: String,
) -> Result<ProviderTestResult, String> {
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return Err("模型 ID 不能为空".to_string());
    }
    let config = store::try_load()?
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let req = model_probe_request(
        &client,
        config.api,
        &config.base_url,
        model_id,
        key.as_deref(),
    );

    let started = Instant::now();
    let response = req.send().await;
    let latency_ms = started.elapsed().as_millis() as u64;

    let response = match response {
        Ok(res) => res,
        Err(e) => {
            let mut err_msg = format!("连接失败: {}", e.without_url());
            if let Some(k) = key.as_deref() {
                let trimmed_k = k.trim();
                if !trimmed_k.is_empty() {
                    err_msg = err_msg.replace(trimmed_k, "[REDACTED]");
                }
            }
            return Ok(ProviderTestResult {
                ok: false,
                latency_ms,
                detail: err_msg,
            });
        }
    };

    let status = response.status();
    if status.is_success() {
        Ok(ProviderTestResult {
            ok: true,
            latency_ms,
            detail: format!("模型可用 · {status}"),
        })
    } else {
        let raw_body = response.text().await.unwrap_or_default();
        let detail = sanitize_error_detail(status, &raw_body, key.as_deref());
        Ok(ProviderTestResult {
            ok: false,
            latency_ms,
            detail,
        })
    }
}

pub(crate) fn sanitize_error_detail(
    status: reqwest::StatusCode,
    raw_body: &str,
    key: Option<&str>,
) -> String {
    let mut body = raw_body.to_string();
    if let Some(k) = key {
        let trimmed_k = k.trim();
        if !trimmed_k.is_empty() {
            body = body.replace(trimmed_k, "[REDACTED]");
        }
    }
    let trimmed = body.trim();
    let first_200: String = trimmed.chars().take(200).collect();
    if first_200.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {first_200}")
    }
}

pub(crate) fn model_probe_request(
    client: &reqwest::Client,
    api: ProviderApi,
    base_url: &str,
    model: &str,
    key: Option<&str>,
) -> reqwest::RequestBuilder {
    let base = base_url.trim_end_matches('/');
    match api {
        ProviderApi::OpenaiCompletions => {
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "hi"}]
            });
            let mut req = client.post(format!("{base}/chat/completions")).json(&body);
            if let Some(k) = key {
                req = req.bearer_auth(k);
            }
            req
        }
        ProviderApi::OpenaiResponses => {
            let body = serde_json::json!({
                "model": model,
                "input": "hi",
                "max_output_tokens": 16
            });
            let mut req = client.post(format!("{base}/responses")).json(&body);
            if let Some(k) = key {
                req = req.bearer_auth(k);
            }
            req
        }
        ProviderApi::Anthropic => {
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "hi"}]
            });
            let url = if let Some(b) = base.strip_suffix("/v1") {
                format!("{b}/v1/messages")
            } else {
                format!("{base}/v1/messages")
            };
            let mut req = client
                .post(url)
                .header("anthropic-version", "2023-06-01")
                .json(&body);
            if let Some(k) = key {
                req = req.header("x-api-key", k);
            }
            req
        }
        ProviderApi::Gemini => {
            let body = serde_json::json!({
                "contents": [{"parts": [{"text": "hi"}]}]
            });
            let model_path = if model.starts_with("models/") {
                model.to_string()
            } else {
                format!("models/{model}")
            };
            let url = if base.ends_with("/v1beta") {
                format!("{base}/{model_path}:generateContent")
            } else {
                format!("{base}/v1beta/{model_path}:generateContent")
            };
            let mut req = client.post(url).json(&body);
            if let Some(k) = key {
                req = req.header("x-goog-api-key", k);
            }
            req
        }
        ProviderApi::Ollama => {
            let body = serde_json::json!({
                "model": model,
                "prompt": "hi",
                "stream": false,
                "options": {
                    "num_predict": 8
                }
            });
            let base_api = if let Some(b) = base.strip_suffix("/api") {
                format!("{b}/api/generate")
            } else {
                format!("{base}/api/generate")
            };
            client.post(base_api).json(&body)
        }
    }
}

/// Plaintext `.env` TEXT for the explicit "复制 .env" button (clipboard only —
/// the app itself never writes this to disk). Caller order wins when `ids`
/// is given, otherwise sort order. Only providers with keys are included.
#[tauri::command]
pub async fn provider_export_env_text(ids: Option<Vec<String>>) -> Result<String, String> {
    let providers = store::try_load()?;
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

/// Query available login providers via probe RPC process.
#[tauri::command]
pub async fn oauth_login_providers() -> Result<Vec<serde_json::Value>, String> {
    super::oauth::oauth_login_providers().await
}

/// Start an OAuth / account login flow for a provider.
#[tauri::command]
pub async fn oauth_login_start(app: tauri::AppHandle, provider_id: String) -> Result<(), String> {
    super::oauth::oauth_login_start(app, provider_id).await
}

/// Respond to an active OAuth/RPC prompt.
#[tauri::command]
pub async fn oauth_login_respond(payload: serde_json::Value) -> Result<(), String> {
    super::oauth::oauth_login_respond(payload).await
}

/// Cancel the active OAuth login process.
#[tauri::command]
pub async fn oauth_login_cancel(app: tauri::AppHandle) -> Result<(), String> {
    super::oauth::oauth_login_cancel(app).await
}

/// Open a URL explicitly in the user's default browser (must be HTTP/HTTPS).
#[tauri::command]
pub async fn oauth_login_open_url(url: String) -> Result<(), String> {
    super::oauth::oauth_login_open_url(url).await
}

/// Retrieve the current login status snapshot.
#[tauri::command]
pub async fn oauth_login_status() -> Result<Option<serde_json::Value>, String> {
    super::oauth::oauth_login_status().await
}

/// Discover providers already configured in OMP's global configs (`~/.omp/agent/`).
#[tauri::command]
pub async fn omp_providers_list() -> Result<Vec<crate::contracts::OmpProviderInfo>, String> {
    Ok(super::omp_config::scan())
}

/// Query live subscription quota and coding plans via `omp usage --json`.
#[tauri::command]
pub async fn omp_usage_report(
    state: tauri::State<'_, crate::state::AppState>,
    refresh: Option<bool>,
) -> Result<serde_json::Value, String> {
    run_usage_report(state.inner(), refresh.unwrap_or(false)).await
}

/// Core of [`omp_usage_report`], shared with the quota switch poller
/// (`model_templates::usage::fetch_usage`), which always reads the CLI cache (`refresh=false`).
pub(crate) async fn run_usage_report(
    state: &crate::state::AppState,
    refresh: bool,
) -> Result<serde_json::Value, String> {
    let path = crate::terminal::env::augmented_path();
    let bin_setting = state.settings.read().omp_binary.clone();
    let bin = if !bin_setting.trim().is_empty() {
        bin_setting
    } else {
        crate::terminal::env::which("omp")
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "omp".to_string())
    };

    if refresh {
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::process::Command::new(&bin)
                .args(["usage", "invalidate"])
                .env("PATH", &path)
                .current_dir(std::env::temp_dir())
                .output(),
        )
        .await;
    }

    let output = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new(&bin)
            .args(["usage", "--json"])
            .env("PATH", &path)
            .current_dir(std::env::temp_dir())
            .output(),
    )
    .await
    .map_err(|_| "获取 OMP 配额超时".to_string())?
    .map_err(|e| format!("执行 omp usage 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("omp usage 退出异常 ({}): {stderr}", output.status));
    }

    let val: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("解析 omp usage 输出失败: {e}"))?;

    Ok(val)
}

fn normalize_identifier(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

pub fn match_preset(provider_id: &str) -> Option<&'static presets::ProviderPreset> {
    if let Some(p) = presets::PRESETS.iter().find(|p| p.id == provider_id) {
        return Some(p);
    }
    let norm_id = normalize_identifier(provider_id);
    if norm_id.is_empty() {
        return None;
    }
    presets::PRESETS
        .iter()
        .find(|p| normalize_identifier(p.id) == norm_id)
}

/// Map an OMP `api` string to a workbench protocol. `None` = not a protocol
/// the workbench can talk to (OMP-proprietary such as `typesafe`/`devin`).
pub fn map_provider_api(api_str: &str) -> Option<ProviderApi> {
    let s = api_str.trim();
    let is = |names: &[&str]| names.iter().any(|n| s.eq_ignore_ascii_case(n));
    if is(&[
        "openai-completions",
        "openai_completions",
        "chat-completions",
    ]) {
        Some(ProviderApi::OpenaiCompletions)
    } else if is(&["openai-responses", "openai_responses", "responses"]) {
        Some(ProviderApi::OpenaiResponses)
    } else if is(&["anthropic", "anthropic-messages", "anthropic_messages"]) {
        Some(ProviderApi::Anthropic)
    } else if is(&["gemini", "google-generative-ai", "google_generative_ai"]) {
        Some(ProviderApi::Gemini)
    } else if is(&["ollama"]) {
        Some(ProviderApi::Ollama)
    } else {
        None
    }
}

/// Slug rule shared with the frontend (`sanitizeSlug` in `envparse.ts`): an id
/// made only of `[A-Za-z0-9_-]` (no leading/trailing `-`) is kept as is.
/// Otherwise every run of other chars becomes one `-`, edges are trimmed (empty →
/// `provider`) and `-<8-hex FNV-1a 32 of the UTF-8 id>` is appended, so two ids
/// that sanitize alike (`聪明 AI-散户` / `别的 AI`) never share a workbench record.
pub fn sanitize_slug(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    let mut in_bad_run = false;
    for c in id.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            out.push(c);
            in_bad_run = false;
        } else if !in_bad_run {
            out.push('-');
            in_bad_run = true;
        }
    }
    let trimmed = out.trim_matches('-');
    if !trimmed.is_empty() && trimmed == id {
        return id.to_string();
    }
    let base = if trimmed.is_empty() {
        "provider"
    } else {
        trimmed
    };
    let hash = id.bytes().fold(0x811c_9dc5_u32, |h, b| {
        (h ^ u32::from(b)).wrapping_mul(0x0100_0193)
    });
    format!("{base}-{hash:08x}")
}

pub fn generate_import_env_var(slug: &str, api_key_env: Option<&str>) -> String {
    if let Some(var) = api_key_env {
        let trimmed = var.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let sanitized: String = slug
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    format!("OMPWS_{sanitized}_API_KEY")
}

/// A reason an OMP provider cannot be imported, with a user-facing message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportFailure {
    pub issue: OmpImportIssue,
    pub message: String,
}

fn non_empty(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}

/// Resolve baseUrl/api (override > yaml > OMP model cache > preset) and build
/// the workbench config. Pure over its inputs.
pub fn build_import_config(
    id: &str,
    raw: Option<&RawParsedProvider>,
    cache: Option<&omp_config::CachedEndpoint>,
    base_url_override: Option<&str>,
) -> Result<ProviderConfig, ImportFailure> {
    let preset = match_preset(id);
    let name = preset
        .map(|p| p.name.to_string())
        .unwrap_or_else(|| id.to_string());
    let preset_id = preset.map(|p| p.id.to_string());

    // API first: an unsupported protocol cannot be fixed by a URL.
    let api = match non_empty(raw.and_then(|r| r.api.as_deref()))
        .or_else(|| non_empty(cache.and_then(|c| c.api.as_deref())))
    {
        Some(s) => map_provider_api(s).ok_or_else(|| ImportFailure {
            issue: OmpImportIssue::UnsupportedApi,
            message: format!(
                "该供应商使用 OMP 专有协议 {s}，工作台暂不能托管它的密钥；它在 OMP 里仍可直接使用"
            ),
        })?,
        None => preset
            .map(|p| p.api)
            .unwrap_or(ProviderApi::OpenaiCompletions),
    };

    let base_url = non_empty(base_url_override)
        .or_else(|| non_empty(raw.and_then(|r| r.base_url.as_deref())))
        .or_else(|| non_empty(cache.and_then(|c| c.base_url.as_deref())))
        .map(ToString::to_string)
        .or_else(|| preset.map(|p| p.base_url.to_string()))
        .ok_or_else(|| ImportFailure {
            issue: OmpImportIssue::MissingBaseUrl,
            message: "OMP 配置里没有它的服务地址，请填写地址后导入".to_string(),
        })?;

    let slug = sanitize_slug(id);
    let env_var = generate_import_env_var(&slug, raw.and_then(|r| r.api_key_env.as_deref()));

    let models = raw
        .map(|r| r.model_ids.iter().cloned().map(ModelEntry::Id).collect())
        .unwrap_or_default();

    Ok(ProviderConfig {
        id: String::new(),
        name,
        slug,
        preset_id,
        base_url,
        api,
        env_var,
        models,
        default_model: None,
        default_context_window: None,
        default_max_tokens: None,
        enabled: true,
        sort: 0,
        has_key: false,
        key_hint: None,
        notes: Some("从 OMP 配置导入".to_string()),
        created_at: String::new(),
        updated_at: String::new(),
    })
}

/// What `plan_item` resolved for an importable provider. Holds key material:
/// never serialize, never return to the frontend.
pub struct ImportPrepared {
    pub config: ProviderConfig,
    pub key: Option<String>,
    pub unset_env_var: Option<String>,
}

fn api_label(api: ProviderApi) -> String {
    serde_json::to_value(api)
        .ok()
        .and_then(|v| v.as_str().map(ToString::to_string))
        .unwrap_or_default()
}

/// Shared by dry run and import: resolve one provider. The key is resolved
/// (yaml literal > env var via `env` > agent.db) but only returned in the
/// second tuple slot; the plan item itself carries none.
pub fn plan_item(
    id: &str,
    raw: Option<&RawParsedProvider>,
    cache: Option<&omp_config::CachedEndpoint>,
    base_url_override: Option<&str>,
    existing_slugs: &[String],
    agent_db_path: Option<&std::path::Path>,
    env: &dyn Fn(&str) -> Option<String>,
) -> (OmpImportPlanItem, Option<ImportPrepared>) {
    let slug = sanitize_slug(id);
    let action = if existing_slugs
        .iter()
        .any(|s| vault::line_key(s) == vault::line_key(&slug))
    {
        "update"
    } else {
        "create"
    };
    let mut item = OmpImportPlanItem {
        id: id.to_string(),
        slug,
        base_url: None,
        api: None,
        action: action.to_string(),
        ok: false,
        issue: None,
        error: None,
    };

    let mut config = match build_import_config(id, raw, cache, base_url_override) {
        Ok(c) => c,
        Err(f) => {
            // Surface whatever was resolved so the UI can prefill.
            item.base_url = non_empty(base_url_override)
                .or_else(|| non_empty(raw.and_then(|r| r.base_url.as_deref())))
                .or_else(|| non_empty(cache.and_then(|c| c.base_url.as_deref())))
                .map(ToString::to_string);
            item.api = non_empty(raw.and_then(|r| r.api.as_deref()))
                .or_else(|| non_empty(cache.and_then(|c| c.api.as_deref())))
                .map(ToString::to_string);
            item.issue = Some(f.issue);
            item.error = Some(f.message);
            return (item, None);
        }
    };
    item.base_url = Some(config.base_url.clone());
    item.api = Some(api_label(config.api));

    let mut key = non_empty(raw.and_then(|r| r.api_key_value.as_deref())).map(ToString::to_string);
    let mut unset_env_var = None;
    if key.is_none() {
        if let Some(var) = non_empty(raw.and_then(|r| r.api_key_env.as_deref())) {
            match env(var)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
            {
                Some(v) => key = Some(v),
                None => unset_env_var = Some(var.to_string()),
            }
        }
    }
    if key.is_none() {
        if let Some(k) = agent_db_path
            .and_then(|p| omp_config::read_agent_api_key(p, id))
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
        {
            key = Some(k);
            unset_env_var = None;
        }
    }

    match (&key, &unset_env_var) {
        (Some(_), _) => item.ok = true,
        (None, Some(var)) => {
            item.ok = true;
            item.issue = Some(OmpImportIssue::EnvVarUnset);
            item.error = Some(format!(
                "环境变量 {var} 当前无值，只能导入元数据，密钥不会入库"
            ));
        }
        (None, None) => {
            item.issue = Some(OmpImportIssue::NoKey);
            item.error = Some("该供应商没有可导入的 API 密钥（OAuth 凭据由 OMP 托管）".to_string());
        }
    }
    config.slug = item.slug.clone();
    (
        item,
        Some(ImportPrepared {
            config,
            key,
            unset_env_var,
        }),
    )
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// Read-only dry run of `provider_import_omp`. Never returns key material.
#[tauri::command]
pub async fn provider_import_omp_plan(ids: Vec<String>) -> Result<Vec<OmpImportPlanItem>, String> {
    let scanned = omp_config::scan_for_import();
    let agent_dir = omp_config::home_agent_dir();
    let agent_db = agent_dir.join("agent.db");
    let cache_db = agent_dir.join("models.db");
    let existing: Vec<String> = store::try_load()?.into_iter().map(|p| p.slug).collect();
    Ok(ids
        .iter()
        .map(|id| {
            let cache = omp_config::read_model_cache_endpoint(&cache_db, id);
            plan_item(
                id,
                scanned.get(id),
                cache.as_ref(),
                None,
                &existing,
                Some(&agent_db),
                &process_env,
            )
            .0
        })
        .collect())
}

/// Batch-import API keys and provider configurations from OMP global configs.
/// `base_url_overrides` (OMP id → URL) wins over every other baseUrl source.
#[tauri::command]
pub async fn provider_import_omp(
    ids: Vec<String>,
    base_url_overrides: Option<HashMap<String, String>>,
) -> Result<Vec<OmpImportResult>, String> {
    let scanned = omp_config::scan_for_import();
    let agent_dir = omp_config::home_agent_dir();
    let agent_db = agent_dir.join("agent.db");
    let cache_db = agent_dir.join("models.db");
    let overrides = base_url_overrides.unwrap_or_default();

    let mut results = Vec::with_capacity(ids.len());
    for id in ids {
        let cache = omp_config::read_model_cache_endpoint(&cache_db, &id);
        // Re-read per item so re-import within one batch stays idempotent.
        let existing_all = store::try_load()?;
        let existing: Vec<String> = existing_all.iter().map(|p| p.slug.clone()).collect();
        let (item, prepared) = plan_item(
            &id,
            scanned.get(&id),
            cache.as_ref(),
            overrides.get(&id).map(String::as_str),
            &existing,
            Some(&agent_db),
            &process_env,
        );
        let Some(ImportPrepared {
            mut config,
            key,
            unset_env_var,
        }) = prepared
        else {
            results.push(OmpImportResult {
                id,
                ok: false,
                error: item.error,
                issue: item.issue,
            });
            continue;
        };
        if let Some(prev) = existing_all
            .iter()
            .find(|p| vault::line_key(&p.slug) == vault::line_key(&config.slug))
        {
            merge_reimport(prev, &mut config);
        }
        if key.is_none() && unset_env_var.is_none() {
            results.push(OmpImportResult {
                id,
                ok: false,
                error: item.error,
                issue: item.issue,
            });
            continue;
        }
        match provider_save(config, key).await {
            Ok(_) => results.push(OmpImportResult {
                id,
                ok: true,
                error: item.error,
                issue: item.issue,
            }),
            Err(err) => results.push(OmpImportResult {
                id,
                ok: false,
                error: Some(err),
                issue: None,
            }),
        }
    }
    Ok(results)
}

/// Re-import keeps everything the user may have edited in the workbench; only
/// baseUrl/api/env var/slug come from the fresh OMP config. Models: existing
/// per-model specs survive; an empty OMP list keeps the previous models.
fn merge_reimport(prev: &ProviderConfig, config: &mut ProviderConfig) {
    config.id = prev.id.clone();
    config.enabled = prev.enabled;
    config.name = prev.name.clone();
    config.notes = prev.notes.clone();
    config.default_model = prev.default_model.clone();
    config.default_context_window = prev.default_context_window;
    config.default_max_tokens = prev.default_max_tokens;
    config.sort = prev.sort;
    config.created_at = prev.created_at.clone();
    if config.models.is_empty() {
        config.models = prev.models.clone();
    } else {
        for m in &mut config.models {
            if let Some(old) = prev.models.iter().find(|o| o.id() == m.id()) {
                *m = old.clone();
            }
        }
    }
}

const MAX_ENV_FILE_BYTES: u64 = 256 * 1024;

/// Read a user-chosen `.env` file for the import dialog. Content is never logged.
#[tauri::command]
pub fn provider_read_env_file(path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("请输入文件路径".to_string());
    }
    let expanded = if trimmed == "~" || trimmed.starts_with("~/") {
        let home = dirs::home_dir().ok_or_else(|| "无法确定用户主目录".to_string())?;
        home.join(trimmed.trim_start_matches('~').trim_start_matches('/'))
    } else {
        std::path::PathBuf::from(trimmed)
    };
    let meta = std::fs::metadata(&expanded)
        .map_err(|e| format!("无法读取 {}：{e}", expanded.display()))?;
    if !meta.is_file() {
        return Err(format!("{} 不是普通文件", expanded.display()));
    }
    if meta.len() > MAX_ENV_FILE_BYTES {
        return Err(format!(
            "文件过大（{} 字节），上限为 {} KiB",
            meta.len(),
            MAX_ENV_FILE_BYTES / 1024
        ));
    }
    let bytes =
        std::fs::read(&expanded).map_err(|e| format!("无法读取 {}：{e}", expanded.display()))?;
    String::from_utf8(bytes).map_err(|_| "文件不是有效的 UTF-8 文本".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::ModelSpec;

    #[test]
    fn reimport_preserves_user_edits_and_model_specs() {
        let mut prev = config("Mine", "dk", "https://old.dev", "DK_KEY");
        prev.id = "id-1".to_string();
        prev.enabled = false;
        prev.notes = Some("my notes".to_string());
        prev.sort = 7;
        prev.created_at = "2026-01-01T00:00:00Z".to_string();
        prev.default_model = Some("m1".to_string());
        prev.models = vec![ModelEntry::Spec(ModelSpec {
            id: "m1".to_string(),
            context_window: Some(123_000),
            ..Default::default()
        })];

        let mut fresh = config("DK", "dk", "https://new.dev", "DK_KEY");
        fresh.models = vec![
            ModelEntry::Id("m1".to_string()),
            ModelEntry::Id("m2".to_string()),
        ];
        merge_reimport(&prev, &mut fresh);
        assert_eq!(fresh.base_url, "https://new.dev");
        assert_eq!(fresh.id, "id-1");
        assert!(!fresh.enabled);
        assert_eq!(fresh.name, "Mine");
        assert_eq!(fresh.notes.as_deref(), Some("my notes"));
        assert_eq!(fresh.sort, 7);
        assert_eq!(fresh.default_model.as_deref(), Some("m1"));
        assert_eq!(fresh.models.len(), 2);
        assert_eq!(fresh.models[0], prev.models[0]);

        let mut empty = config("DK", "dk", "https://new.dev", "DK_KEY");
        merge_reimport(&prev, &mut empty);
        assert_eq!(empty.models, prev.models);
    }

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
            default_context_window: None,
            default_max_tokens: None,
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

    #[test]
    fn validate_rejects_reserved_env_vars() {
        for reserved in [
            "PATH",
            "HOME",
            "SHELL",
            "USER",
            "LOGNAME",
            "TMPDIR",
            "NODE_OPTIONS",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "OMP_WORKSPACE_PROVIDERS",
            "OMP_CUSTOM_VAR",
            "DYLD_LIBRARY_PATH",
            "DYLD_INSERT_LIBRARIES",
            "LD_PRELOAD",
            "LD_LIBRARY_PATH",
        ] {
            let c = config("Name", "slug", "https://x.dev", reserved);
            assert!(
                validate(&c).unwrap_err().contains("保留名称"),
                "expected {reserved} to be rejected"
            );
        }
    }

    #[test]
    fn validate_allows_http_on_any_host() {
        // Valid HTTPS
        assert!(validate(&config("Name", "slug", "https://api.openai.com/v1", "KEY")).is_ok());

        // Valid HTTP loopback & private networks
        assert!(validate(&config("Name", "slug", "http://localhost:11434", "KEY")).is_ok());
        assert!(validate(&config("Name", "slug", "http://sub.localhost:8080", "KEY")).is_ok());
        assert!(validate(&config("Name", "slug", "http://127.0.0.1:8080/v1", "KEY")).is_ok());
        assert!(validate(&config("Name", "slug", "http://10.0.1.5:8000/v1", "KEY")).is_ok());
        assert!(validate(&config("Name", "slug", "http://172.16.0.1:8000/v1", "KEY")).is_ok());
        assert!(validate(&config(
            "Name",
            "slug",
            "http://192.168.1.100:8000/v1",
            "KEY"
        ))
        .is_ok());
        assert!(validate(&config("Name", "slug", "http://[::1]:8000/v1", "KEY")).is_ok());

        // Public-internet plain HTTP is allowed (the UI shows a warning instead).
        assert!(validate(&config("Name", "slug", "http://api.openai.com/v1", "KEY")).is_ok());
        assert!(validate(&config("Name", "slug", "http://8.8.8.8:8000/v1", "KEY")).is_ok());
    }

    #[test]
    fn test_generate_import_env_var() {
        assert_eq!(
            generate_import_env_var("yiyuan-codex", None),
            "OMPWS_YIYUAN_CODEX_API_KEY"
        );
        assert_eq!(
            generate_import_env_var("deepseek", None),
            "OMPWS_DEEPSEEK_API_KEY"
        );
        assert_eq!(
            generate_import_env_var("my-prov", Some("CUSTOM_ENV_VAR")),
            "CUSTOM_ENV_VAR"
        );
        assert_eq!(
            generate_import_env_var("provider.with.dots-and_underscores", None),
            "OMPWS_PROVIDER_WITH_DOTS_AND_UNDERSCORES_API_KEY"
        );
    }

    #[test]
    fn test_map_provider_api_table() {
        use ProviderApi::*;
        for (s, want) in [
            ("openai-completions", OpenaiCompletions),
            ("openai_completions", OpenaiCompletions),
            ("chat-completions", OpenaiCompletions),
            ("openai-responses", OpenaiResponses),
            ("openai_responses", OpenaiResponses),
            ("responses", OpenaiResponses),
            ("anthropic", Anthropic),
            ("anthropic-messages", Anthropic),
            ("gemini", Gemini),
            ("google-generative-ai", Gemini),
            ("ollama", Ollama),
        ] {
            assert_eq!(map_provider_api(s), Some(want), "{s}");
        }
        assert_eq!(map_provider_api("unknown-custom-api"), None);
        assert_eq!(map_provider_api("typesafe"), None);
    }

    #[test]
    fn test_match_preset() {
        let p_exact = match_preset("openai").unwrap();
        assert_eq!(p_exact.id, "openai");

        let p_norm1 = match_preset("DeepSeek").unwrap();
        assert_eq!(p_norm1.id, "deepseek");

        let p_norm2 = match_preset("deep-seek").unwrap();
        assert_eq!(p_norm2.id, "deepseek");

        assert!(match_preset("nonexistent-custom-provider").is_none());
    }

    #[test]
    fn test_build_import_config_precedence_and_validation() {
        // Preset match fills missing baseUrl and api
        let cfg = build_import_config("openai", None, None, None).unwrap();
        assert_eq!(cfg.name, "OpenAI");
        assert_eq!(cfg.base_url, "https://api.openai.com/v1");
        assert_eq!(cfg.api, ProviderApi::OpenaiCompletions);
        assert_eq!(cfg.env_var, "OMPWS_OPENAI_API_KEY");
        assert_eq!(cfg.notes.as_deref(), Some("从 OMP 配置导入"));

        // Raw YAML overrides preset
        let raw = RawParsedProvider {
            id: "openai".to_string(),
            base_url: Some("https://custom-openai.proxy.com/v1".to_string()),
            api: Some("anthropic".to_string()),
            api_key_env: Some("MY_OPENAI_KEY".to_string()),
            model_ids: vec!["gpt-4o-custom".to_string()],
            ..Default::default()
        };
        let cfg2 = build_import_config("openai", Some(&raw), None, None).unwrap();
        assert_eq!(cfg2.base_url, "https://custom-openai.proxy.com/v1");
        assert_eq!(cfg2.api, ProviderApi::Anthropic);
        assert_eq!(cfg2.env_var, "MY_OPENAI_KEY");
        assert_eq!(
            cfg2.models,
            vec![ModelEntry::Id("gpt-4o-custom".to_string())]
        );

        // Missing baseUrl in both raw and preset -> error
        let err = build_import_config("unknown-provider", None, None, None).unwrap_err();
        assert_eq!(err.issue, OmpImportIssue::MissingBaseUrl);
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    fn plan_for(
        id: &str,
        raw: Option<&RawParsedProvider>,
        cache: Option<&omp_config::CachedEndpoint>,
        over: Option<&str>,
    ) -> OmpImportPlanItem {
        plan_item(id, raw, cache, over, &[], None, &no_env).0
    }

    #[test]
    fn sanitize_slug_rule() {
        assert_eq!(sanitize_slug("zhipu-coding-plan"), "zhipu-coding-plan");
        assert_eq!(sanitize_slug("a__b"), "a__b");
        // Same vectors as `sanitizeSlug` in envparse.test.ts.
        assert_eq!(sanitize_slug("CTAI-luna+plus"), "CTAI-luna-plus-cb5cc89e");
        assert_eq!(sanitize_slug("a  +  b"), "a-b-a1a5485d");
        assert_eq!(sanitize_slug("聪明 AI-散户"), "AI-5d1cd3b8");
        assert_eq!(sanitize_slug("别的 AI"), "AI-6910b992");
        assert_eq!(sanitize_slug("聪明"), "provider-1d828678");
        assert_eq!(sanitize_slug(""), "provider-811c9dc5");
    }

    #[test]
    fn import_config_uses_sanitized_slug_and_original_name() {
        let raw = RawParsedProvider {
            id: "CTAI-luna+plus".to_string(),
            base_url: Some("https://x.dev/v1".to_string()),
            ..Default::default()
        };
        let cfg = build_import_config("CTAI-luna+plus", Some(&raw), None, None).unwrap();
        assert_eq!(cfg.slug, "CTAI-luna-plus-cb5cc89e");
        assert_eq!(cfg.name, "CTAI-luna+plus");
        assert_eq!(cfg.env_var, "OMPWS_CTAI_LUNA_PLUS_CB5CC89E_API_KEY");
        assert!(validate(&cfg).is_ok());
    }

    #[test]
    fn cache_fills_missing_base_url_and_override_wins() {
        let cache = omp_config::CachedEndpoint {
            base_url: Some("https://open.bigmodel.cn/api/coding/paas/v4".to_string()),
            api: Some("openai-completions".to_string()),
        };
        let p = plan_for("zhipu-coding-plan", None, Some(&cache), None);
        assert_eq!(
            p.base_url.as_deref(),
            Some("https://open.bigmodel.cn/api/coding/paas/v4")
        );
        assert_ne!(p.issue, Some(OmpImportIssue::MissingBaseUrl));

        // yaml beats cache
        let raw = RawParsedProvider {
            id: "zhipu-coding-plan".to_string(),
            base_url: Some("https://yaml.example/v1".to_string()),
            ..Default::default()
        };
        let p = plan_for("zhipu-coding-plan", Some(&raw), Some(&cache), None);
        assert_eq!(p.base_url.as_deref(), Some("https://yaml.example/v1"));

        // override beats everything
        let p = plan_for(
            "zhipu-coding-plan",
            Some(&raw),
            Some(&cache),
            Some(" https://override.example/v1 "),
        );
        assert_eq!(p.base_url.as_deref(), Some("https://override.example/v1"));

        // nothing anywhere
        let p = plan_for("unknown-missing-base", None, None, None);
        assert!(!p.ok);
        assert_eq!(p.issue, Some(OmpImportIssue::MissingBaseUrl));
        assert!(p.error.as_deref().unwrap().contains("服务地址"));
    }

    #[test]
    fn unknown_api_is_unsupported() {
        let cache = omp_config::CachedEndpoint {
            base_url: Some("https://api.typesafe.ai".to_string()),
            api: Some("typesafe".to_string()),
        };
        let p = plan_for("typesafe", None, Some(&cache), None);
        assert!(!p.ok);
        assert_eq!(p.issue, Some(OmpImportIssue::UnsupportedApi));
        assert!(p.error.as_deref().unwrap().contains("typesafe"));
        // an override does not make an unsupported protocol supported
        let p = plan_for("typesafe", None, Some(&cache), Some("https://x.dev"));
        assert_eq!(p.issue, Some(OmpImportIssue::UnsupportedApi));
    }

    #[test]
    fn plan_reports_key_state_without_key_material() {
        let raw = RawParsedProvider {
            id: "p".to_string(),
            base_url: Some("https://x.dev/v1".to_string()),
            api_key_value: Some("sk-SECRET-LITERAL".to_string()),
            ..Default::default()
        };
        let p = plan_for("p", Some(&raw), None, None);
        assert!(p.ok);
        assert_eq!(p.action, "create");
        let json = serde_json::to_string(&p).unwrap();
        assert!(!json.contains("SECRET"), "{json}");

        let raw_env = RawParsedProvider {
            id: "p".to_string(),
            base_url: Some("https://x.dev/v1".to_string()),
            api_key_env: Some("MY_UNSET_VAR".to_string()),
            ..Default::default()
        };
        let p = plan_for("p", Some(&raw_env), None, None);
        assert_eq!(p.issue, Some(OmpImportIssue::EnvVarUnset));
        assert!(p.error.as_deref().unwrap().contains("MY_UNSET_VAR"));

        let raw_none = RawParsedProvider {
            id: "p".to_string(),
            base_url: Some("https://x.dev/v1".to_string()),
            ..Default::default()
        };
        let p = plan_for("p", Some(&raw_none), None, None);
        assert!(!p.ok);
        assert_eq!(p.issue, Some(OmpImportIssue::NoKey));

        // existing slug -> update
        let existing = vec!["p".to_string()];
        let (p, _) = plan_item("p", Some(&raw), None, None, &existing, None, &no_env);
        assert_eq!(p.action, "update");
    }

    #[test]
    fn read_env_file_validates() {
        let dir = std::env::temp_dir().join(format!("ompws-envfile-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.env");
        std::fs::write(&f, "A=1\n").unwrap();
        assert_eq!(
            provider_read_env_file(f.to_string_lossy().to_string()).unwrap(),
            "A=1\n"
        );
        assert!(provider_read_env_file(dir.to_string_lossy().to_string()).is_err());
        assert!(provider_read_env_file(dir.join("nope").to_string_lossy().to_string()).is_err());
        let big = dir.join("big.env");
        std::fs::write(&big, vec![b'a'; 256 * 1024 + 1]).unwrap();
        assert!(provider_read_env_file(big.to_string_lossy().to_string()).is_err());
        let bin = dir.join("bin.env");
        std::fs::write(&bin, [0xff, 0xfe]).unwrap();
        assert!(provider_read_env_file(bin.to_string_lossy().to_string()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn test_validate_model_specs_and_bounds() {
        let mut c = config("Provider", "slug", "https://api.openai.com/v1", "KEY");

        // Empty model id is rejected
        c.models = vec![ModelEntry::Id("   ".to_string())];
        assert_eq!(validate(&c).unwrap_err(), "模型 ID 不能为空");

        // Model id with newline or null is rejected
        c.models = vec![ModelEntry::Id("model\n1".to_string())];
        assert_eq!(validate(&c).unwrap_err(), "模型 ID 不能包含换行或空字符");
        c.models = vec![ModelEntry::Id("model\x001".to_string())];
        assert_eq!(validate(&c).unwrap_err(), "模型 ID 不能包含换行或空字符");

        // ModelSpec bounds > 2_000_000
        c.models = vec![ModelEntry::Spec(ModelSpec {
            id: "m1".to_string(),
            context_window: Some(2_000_001),
            ..Default::default()
        })];
        assert!(validate(&c).unwrap_err().contains("不能超过 2,000,000"));

        c.models = vec![ModelEntry::Spec(ModelSpec {
            id: "m1".to_string(),
            max_tokens: Some(2_000_001),
            ..Default::default()
        })];
        assert!(validate(&c).unwrap_err().contains("不能超过 2,000,000"));

        // ModelSpec name containing null/newline
        c.models = vec![ModelEntry::Spec(ModelSpec {
            id: "m1".to_string(),
            name: Some("Name\nBad".to_string()),
            ..Default::default()
        })];
        assert!(validate(&c)
            .unwrap_err()
            .contains("模型 \"m1\" 的名称不能包含换行或空字符"));

        // Provider defaults > 2_000_000
        c.models = vec![ModelEntry::Id("m1".to_string())];
        c.default_context_window = Some(2_000_001);
        assert_eq!(
            validate(&c).unwrap_err(),
            "默认上下文窗口大小不能超过 2,000,000"
        );

        c.default_context_window = Some(128_000);
        c.default_max_tokens = Some(2_000_001);
        assert_eq!(
            validate(&c).unwrap_err(),
            "默认最大输出 Token 数不能超过 2,000,000"
        );

        // Valid bounds pass
        c.default_max_tokens = Some(4096);
        c.models = vec![
            ModelEntry::Id("m1".to_string()),
            ModelEntry::Spec(ModelSpec {
                id: "m2".to_string(),
                name: Some("Model 2".to_string()),
                context_window: Some(200_000),
                max_tokens: Some(8192),
            }),
        ];
        assert!(validate(&c).is_ok());
    }

    #[test]
    fn test_model_probe_request_construction() {
        let client = reqwest::Client::builder().build().unwrap();

        // OpenaiCompletions
        let req = model_probe_request(
            &client,
            ProviderApi::OpenaiCompletions,
            "https://api.openai.com/v1",
            "gpt-4o",
            Some("sk-openai-secret"),
        )
        .build()
        .unwrap();
        assert_eq!(
            req.url().as_str(),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(req.method(), reqwest::Method::POST);
        assert_eq!(
            req.headers()
                .get("authorization")
                .unwrap()
                .to_str()
                .unwrap(),
            "Bearer sk-openai-secret"
        );
        let body: serde_json::Value =
            serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["max_tokens"], 1);
        assert_eq!(body["messages"][0]["content"], "hi");

        // OpenaiResponses
        let req = model_probe_request(
            &client,
            ProviderApi::OpenaiResponses,
            "https://api.openai.com/v1",
            "gpt-4o",
            Some("sk-resp-secret"),
        )
        .build()
        .unwrap();
        assert_eq!(req.url().as_str(), "https://api.openai.com/v1/responses");
        assert_eq!(
            req.headers()
                .get("authorization")
                .unwrap()
                .to_str()
                .unwrap(),
            "Bearer sk-resp-secret"
        );
        let body: serde_json::Value =
            serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["input"], "hi");
        assert_eq!(body["max_output_tokens"], 16);

        // Anthropic
        let req = model_probe_request(
            &client,
            ProviderApi::Anthropic,
            "https://api.anthropic.com",
            "claude-3-5-sonnet",
            Some("sk-ant-secret"),
        )
        .build()
        .unwrap();
        assert_eq!(req.url().as_str(), "https://api.anthropic.com/v1/messages");
        assert_eq!(
            req.headers().get("x-api-key").unwrap().to_str().unwrap(),
            "sk-ant-secret"
        );
        assert_eq!(
            req.headers()
                .get("anthropic-version")
                .unwrap()
                .to_str()
                .unwrap(),
            "2023-06-01"
        );
        let body: serde_json::Value =
            serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["model"], "claude-3-5-sonnet");
        assert_eq!(body["max_tokens"], 1);

        // Gemini
        let req = model_probe_request(
            &client,
            ProviderApi::Gemini,
            "https://generativelanguage.googleapis.com",
            "gemini-1.5-flash",
            Some("gemini-secret-key"),
        )
        .build()
        .unwrap();
        assert_eq!(
            req.url().as_str(),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
        );
        assert_eq!(
            req.headers()
                .get("x-goog-api-key")
                .unwrap()
                .to_str()
                .unwrap(),
            "gemini-secret-key"
        );
        let body: serde_json::Value =
            serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["contents"][0]["parts"][0]["text"], "hi");

        // Ollama
        let req = model_probe_request(
            &client,
            ProviderApi::Ollama,
            "http://localhost:11434",
            "llama3.2",
            None,
        )
        .build()
        .unwrap();
        assert_eq!(req.url().as_str(), "http://localhost:11434/api/generate");
        let body: serde_json::Value =
            serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["model"], "llama3.2");
        assert_eq!(body["prompt"], "hi");
        assert_eq!(body["stream"], false);
        assert_eq!(body["options"]["num_predict"], 8);
    }

    #[test]
    fn test_sanitize_error_detail() {
        let status = reqwest::StatusCode::UNAUTHORIZED;
        let secret = "super-secret-key-12345";
        let raw = format!("Error: invalid key '{secret}' was provided by client");
        let sanitized = sanitize_error_detail(status, &raw, Some(secret));
        assert!(!sanitized.contains(secret));
        assert!(sanitized.contains("[REDACTED]"));
        assert!(sanitized.starts_with("HTTP 401 Unauthorized"));

        // Limit first 200 chars
        let long_body = "x".repeat(500);
        let detail = sanitize_error_detail(reqwest::StatusCode::BAD_REQUEST, &long_body, None);
        assert!(detail.len() <= 230); // "HTTP 400 Bad Request: " + 200 chars
    }
}
