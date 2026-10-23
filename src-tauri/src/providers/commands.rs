//! [providers] Tauri commands over OMP's own provider state: rows, enable
//! toggle, encrypt / decrypt, upsert, delete, probes and the `.env` export.
//! Keys arrive as command arguments, go to `models.yml` or the encrypted vault
//! and are never logged or returned to the frontend (except the explicit
//! clipboard export).

use std::collections::HashSet;
use std::time::{Duration, Instant};

use crate::contracts::{
    BuiltinOverride, KeyMode, ProviderApi, ProviderBulkResult, ProviderKeyKind, ProviderRow,
    ProviderTestResult, ProviderUpsert,
};

use super::ops::{self, Env, VaultStore};
use super::{config_yml, key_ref, models_yml_providers, omp_config, rows};

fn with_env<T>(f: impl FnOnce(&Env) -> Result<T, String>) -> Result<T, String> {
    let shim = key_ref::shim_path();
    let models_yml = models_yml_providers::models_yml_path();
    f(&Env {
        models_yml: &models_yml,
        shim: &shim,
        store: &VaultStore,
    })
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn row_of(id: &str) -> Result<ProviderRow, String> {
    rows::load_rows()?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "供应商不存在".to_string())
}

#[tauri::command]
pub async fn provider_rows() -> Result<Vec<ProviderRow>, String> {
    rows::load_rows()
}

/// Hide / show a provider in new OMP sessions (`disabledProviders` in config.yml).
#[tauri::command]
pub async fn provider_set_enabled(id: String, enabled: bool) -> Result<(), String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    config_yml::set_disabled(&id, !enabled)
}

/// Move a plaintext key into the vault and reference it from models.yml.
#[tauri::command]
pub async fn provider_encrypt(id: String) -> Result<ProviderRow, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    with_env(|env| ops::encrypt(env, &id))?;
    row_of(&id)
}

/// Write the vault key back into models.yml as plaintext.
#[tauri::command]
pub async fn provider_decrypt(id: String) -> Result<ProviderRow, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    with_env(|env| ops::decrypt(env, &id))?;
    row_of(&id)
}

/// Encrypt every plaintext-key provider; one result per provider.
#[tauri::command]
pub async fn provider_encrypt_all() -> Result<Vec<ProviderBulkResult>, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let ids: Vec<String> = rows::load_rows()?
        .into_iter()
        .filter(|r| r.key.kind == ProviderKeyKind::Plaintext)
        .map(|r| r.id)
        .collect();
    Ok(ids
        .into_iter()
        .map(|id| {
            let result = with_env(|env| ops::encrypt(env, &id));
            ProviderBulkResult {
                ok: result.is_ok(),
                error: result.err(),
                id,
            }
        })
        .collect())
}

/// Create / edit a custom provider block. `api_key` None keeps the current key.
#[tauri::command]
pub async fn provider_upsert(
    input: ProviderUpsert,
    api_key: Option<String>,
    key_mode: KeyMode,
) -> Result<ProviderRow, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let id = with_env(|env| ops::upsert(env, &input, api_key.as_deref(), key_mode))?;
    if let Some(old) = input.original_id.as_deref().map(str::trim) {
        if old != id && config_yml::read_disabled().contains(old) {
            config_yml::set_disabled(old, false)?;
            config_yml::set_disabled(&id, true)?;
        }
    }
    row_of(&id)
}

/// Set the key of any row; a built-in gets an override-only models.yml block.
#[tauri::command]
pub async fn provider_set_key(
    id: String,
    api_key: String,
    key_mode: KeyMode,
) -> Result<ProviderRow, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    with_env(|env| ops::apply_key(env, &id, &api_key, key_mode))?;
    row_of(&id)
}

/// Create / update / drop the override block of a built-in provider.
/// `api_key` None keeps the current key.
#[tauri::command]
pub async fn provider_save_builtin(
    input: BuiltinOverride,
    api_key: Option<String>,
    key_mode: KeyMode,
) -> Result<ProviderRow, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let id = input.id.trim().to_string();
    let default_base_url = rows::load_rows()?
        .into_iter()
        .find(|r| r.id == id)
        .and_then(|r| r.default_base_url);
    with_env(|env| {
        ops::save_builtin(
            env,
            &input,
            default_base_url.as_deref(),
            api_key.as_deref(),
            key_mode,
        )
    })?;
    row_of(&id)
}

/// Delete the models.yml block (custom / override) and the vault entry.
#[tauri::command]
pub async fn provider_delete(id: String) -> Result<(), String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    with_env(|env| ops::delete(env, &id))?;
    config_yml::set_disabled(&id, false)
}

/// What a probe talks to, or the finished result when it cannot run.
struct Target {
    base_url: String,
    api: ProviderApi,
    key: Option<String>,
}

fn blocked(detail: &str) -> ProviderTestResult {
    ProviderTestResult {
        ok: false,
        latency_ms: 0,
        detail: detail.to_string(),
    }
}

fn probe_target(id: &str) -> Result<Result<Target, ProviderTestResult>, String> {
    let row = row_of(id)?;
    let Some(base_url) = row.base_url.clone() else {
        return Ok(Err(blocked("缺少 Base URL，无法测试")));
    };
    let Some(api) = row.api.as_deref().and_then(map_provider_api) else {
        return Ok(Err(blocked("该供应商的协议暂不支持测试")));
    };
    let key = match row.key.kind {
        ProviderKeyKind::Encrypted | ProviderKeyKind::Plaintext | ProviderKeyKind::EnvVar => {
            with_env(|env| ops::resolve_key(env, id, &process_env))?
        }
        ProviderKeyKind::LoginStored => {
            omp_config::read_agent_api_key(&omp_config::home_agent_dir().join("agent.db"), id)
        }
        _ => None,
    };
    if key.is_none() && api != ProviderApi::Ollama {
        let detail = match row.key.kind {
            ProviderKeyKind::None => None,
            ProviderKeyKind::Command => Some("密钥由命令获取，暂无法测试"),
            ProviderKeyKind::Oauth => Some("该供应商使用账号登录，暂无法测试连接"),
            _ => Some("尚未配置 API 密钥"),
        };
        if let Some(detail) = detail {
            return Ok(Err(blocked(detail)));
        }
    }
    Ok(Ok(Target { base_url, api, key }))
}

/// `GET` request listing a provider's models.
fn list_models_request(
    client: &reqwest::Client,
    base: &str,
    api: ProviderApi,
    key: Option<&str>,
) -> reqwest::RequestBuilder {
    let base = base.trim().trim_end_matches('/');
    match api {
        ProviderApi::OpenaiCompletions | ProviderApi::OpenaiResponses => {
            let mut req = client.get(format!("{base}/models"));
            if let Some(k) = key {
                req = req.bearer_auth(k);
            }
            req
        }
        ProviderApi::Anthropic => {
            let root = base.strip_suffix("/v1").unwrap_or(base);
            let mut req = client
                .get(format!("{root}/v1/models"))
                .header("anthropic-version", "2023-06-01");
            if let Some(k) = key {
                req = req.header("x-api-key", k);
            }
            req
        }
        ProviderApi::Gemini => {
            let url = if base.ends_with("/v1beta") || base.ends_with("/v1") {
                format!("{base}/models")
            } else {
                format!("{base}/v1beta/models")
            };
            let mut req = client.get(url);
            if let Some(k) = key {
                req = req.header("x-goog-api-key", k);
            }
            req
        }
        ProviderApi::Ollama => client.get(format!("{base}/api/tags")),
    }
}

/// Real HTTP probe (10s timeout). Returns a concise Chinese detail; key
/// material never appears in errors or results.
#[tauri::command]
pub async fn provider_test(id: String) -> Result<ProviderTestResult, String> {
    let target = match probe_target(&id)? {
        Ok(t) => t,
        Err(done) => return Ok(done),
    };
    test_endpoint(&target.base_url, target.api, target.key.as_deref()).await
}

async fn test_endpoint(
    base_url: &str,
    api: ProviderApi,
    key: Option<&str>,
) -> Result<ProviderTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let started = Instant::now();
    let response = list_models_request(&client, base_url, api, key)
        .send()
        .await;
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
    let detail = match count_models(&body, api) {
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
/// Without `api_key` the key of provider `id` is used.
#[tauri::command]
pub async fn provider_fetch_models(
    base_url: String,
    api: String,
    api_key: Option<String>,
    id: Option<String>,
) -> Result<Vec<DiscoveredModel>, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    let api = map_provider_api(&api).ok_or_else(|| "该协议暂不支持获取模型列表".to_string())?;

    let mut key = api_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty());
    if key.is_none() {
        if let Some(id) = id.as_deref() {
            if let Ok(Ok(target)) = probe_target(id) {
                key = target.key;
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let response = list_models_request(&client, base, api, key.as_deref())
        .send()
        .await;

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

/// Real HTTP probe for a specific model (30s timeout).
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
    let target = match probe_target(&id)? {
        Ok(t) => t,
        Err(done) => return Ok(done),
    };
    let (api, base_url, key) = (target.api, target.base_url, target.key);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let req = model_probe_request(&client, api, &base_url, model_id, key.as_deref());

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
            let url = if base.ends_with("/v1beta") || base.ends_with("/v1") {
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

/// `<SLUG_UPPER>_API_KEY=<key>` lines for the explicit "复制 .env" button
/// (clipboard only — the app never writes this to disk). `ids` fixes selection
/// and order; otherwise every models.yml provider with a resolvable key.
#[tauri::command]
pub async fn provider_export_env_text(ids: Option<Vec<String>>) -> Result<String, String> {
    with_env(|env| ops::export_env_text(env, ids.as_deref(), &process_env))
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
        let result = test_endpoint(&base, ProviderApi::Gemini, Some("secret-test-key"))
            .await
            .unwrap();
        target_task.abort();
        source_task.abort();
        assert!(!result.ok);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        assert!(!result.detail.contains("secret-test-key"));
    }

    #[test]
    fn list_models_url_per_protocol() {
        let client = reqwest::Client::new();
        let url = |base: &str, api| {
            list_models_request(&client, base, api, None)
                .build()
                .unwrap()
                .url()
                .to_string()
        };
        use ProviderApi::*;
        assert_eq!(
            url("https://a.dev/v1/", OpenaiCompletions),
            "https://a.dev/v1/models"
        );
        assert_eq!(url("https://a.dev", Anthropic), "https://a.dev/v1/models");
        assert_eq!(
            url("https://a.dev/v1", Anthropic),
            "https://a.dev/v1/models"
        );
        assert_eq!(url("https://g.dev", Gemini), "https://g.dev/v1beta/models");
        assert_eq!(
            url("https://g.dev/v1beta", Gemini),
            "https://g.dev/v1beta/models"
        );
        assert_eq!(url("http://l:11434", Ollama), "http://l:11434/api/tags");
    }
}
