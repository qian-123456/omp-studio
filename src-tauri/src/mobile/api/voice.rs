//! Audio transcription endpoint (`POST /api/voice/transcribe`).
//! Accepts multipart/form-data or raw audio bytes (webm, mp4, wav, ogg).
//! Resolves configured dictation / speech model role from OMP config.
//! Calls provider STT endpoint and returns `{ text: "transcribed text" }`.

use std::sync::Arc;
use std::time::Duration;

use axum::body::{to_bytes, Bytes};
use axum::extract::{DefaultBodyLimit, FromRequest, Multipart, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::mobile::backend::Backend;
use crate::mobile::server::Ctx;

/// Maximum audio file size: 25MB.
pub const MAX_AUDIO_SIZE: usize = 25 * 1024 * 1024;
/// Timeout for speech-to-text API calls: 60s.
pub const STT_TIMEOUT: Duration = Duration::from_secs(60);

type VoiceResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new().route(
        "/voice/transcribe",
        post(transcribe::<B>).route_layer(DefaultBodyLimit::max(MAX_AUDIO_SIZE)),
    )
}

struct AudioPayload {
    bytes: Bytes,
    filename: String,
    content_type: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ModelRoleTarget {
    pub provider: String,
    pub model: String,
}

fn structured_error(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({
            "error": {
                "code": code,
                "message": message.into(),
            }
        })),
    )
}

async fn extract_multipart(mp: &mut Multipart) -> Result<AudioPayload, (StatusCode, Json<Value>)> {
    let mut candidate_bytes: Option<Bytes> = None;
    let mut candidate_filename: Option<String> = None;
    let mut candidate_ct: Option<String> = None;

    while let Ok(Some(field)) = mp.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();
        let fname = field.file_name().map(str::to_string);
        let ftype = field.content_type().map(|c| c.to_string());
        let Ok(data) = field.bytes().await else {
            continue;
        };

        if data.is_empty() {
            continue;
        }

        let is_target = field_name == "file" || field_name == "audio" || fname.is_some();
        if is_target || candidate_bytes.is_none() {
            candidate_bytes = Some(data);
            candidate_filename = fname;
            candidate_ct = ftype;
            if is_target {
                break;
            }
        }
    }

    let bytes = candidate_bytes.ok_or_else(|| {
        structured_error(StatusCode::BAD_REQUEST, "empty_audio", "未找到音频文件数据")
    })?;

    let filename = candidate_filename.unwrap_or_else(|| "audio.webm".to_string());
    let content_type = candidate_ct.unwrap_or_else(|| mime_from_filename(&filename).to_string());

    Ok(AudioPayload {
        bytes,
        filename,
        content_type,
    })
}

fn extract_raw(
    headers: &HeaderMap,
    body: Bytes,
) -> Result<AudioPayload, (StatusCode, Json<Value>)> {
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let (filename, content_type) = if !ct.is_empty() && ct != "application/octet-stream" {
        let ext = ext_from_mime(ct);
        (format!("audio.{ext}"), ct.to_string())
    } else {
        let detected = detect_audio_mime(&body);
        let ext = ext_from_mime(detected);
        (format!("audio.{ext}"), detected.to_string())
    };

    Ok(AudioPayload {
        bytes: body,
        filename,
        content_type,
    })
}

fn ext_from_mime(mime: &str) -> &'static str {
    let lower = mime.to_ascii_lowercase();
    if lower.contains("webm") {
        "webm"
    } else if lower.contains("mp4") || lower.contains("m4a") {
        "mp4"
    } else if lower.contains("wav") {
        "wav"
    } else if lower.contains("ogg") {
        "ogg"
    } else if lower.contains("mpeg") || lower.contains("mp3") {
        "mp3"
    } else {
        "webm"
    }
}

fn mime_from_filename(filename: &str) -> &'static str {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".mp4") || lower.ends_with(".m4a") {
        "audio/mp4"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else {
        "audio/webm"
    }
}

fn detect_audio_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"RIFF") && bytes.len() >= 12 && &bytes[8..12] == b"WAVE" {
        "audio/wav"
    } else if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        "audio/webm"
    } else if bytes.starts_with(b"OggS") {
        "audio/ogg"
    } else if bytes.len() >= 8 && &bytes[4..8] == b"ftyp" {
        "audio/mp4"
    } else if bytes.starts_with(b"ID3")
        || (bytes.len() >= 2 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0)
    {
        "audio/mpeg"
    } else {
        "audio/webm"
    }
}

/// Strip thinking suffix (e.g. `openai/whisper-1:off` -> `openai/whisper-1`).
pub fn strip_thinking_suffix(selector: &str) -> &str {
    let trimmed = selector.trim();
    if let Some((base, suffix)) = trimmed.rsplit_once(':') {
        let s = suffix.trim().to_ascii_lowercase();
        if matches!(
            s.as_str(),
            "off"
                | "low"
                | "medium"
                | "high"
                | "xhigh"
                | "max"
                | "auto"
                | "inherit"
                | "minimal"
                | "none"
        ) {
            return base.trim();
        }
    }
    trimmed
}

/// Parse selector into `(provider_id, model_name)`.
pub fn parse_model_selector(selector: &str) -> ModelRoleTarget {
    let clean = strip_thinking_suffix(selector);
    if let Some((provider, model)) = clean.split_once('/') {
        ModelRoleTarget {
            provider: provider.trim().to_string(),
            model: model.trim().to_string(),
        }
    } else {
        ModelRoleTarget {
            provider: "openai".to_string(),
            model: clean.to_string(),
        }
    }
}

/// Read dictation or speech role from a config YAML string.
pub fn parse_dictation_role(yaml_text: &str) -> Option<String> {
    let root: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml_text).ok()?;
    let roles = root.get("modelRoles")?;

    for key in ["dictation", "speech"] {
        if let Some(val) = roles.get(key) {
            match val {
                serde_yaml_ng::Value::String(s) if !s.trim().is_empty() => {
                    return Some(s.trim().to_string());
                }
                serde_yaml_ng::Value::Sequence(seq) => {
                    for item in seq {
                        if let serde_yaml_ng::Value::String(s) = item {
                            if !s.trim().is_empty() {
                                return Some(s.trim().to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Locate and read configured dictation/speech model role from OMP config.
pub fn resolve_dictation_role() -> Option<ModelRoleTarget> {
    // 1. Try global config file via settings_model_roles
    let candidates = [
        crate::settings_model_roles::global_config_file().ok(),
        Some(crate::paths::agent_dir().join("config.yml")),
        Some(crate::paths::agent_dir().join("config.yaml")),
    ];

    for path_opt in candidates.into_iter().flatten() {
        if let Ok(text) = std::fs::read_to_string(&path_opt) {
            if let Some(role) = parse_dictation_role(&text) {
                return Some(parse_model_selector(&role));
            }
        }
    }

    // 2. Check environment variable override
    if let Ok(env_role) =
        std::env::var("OMP_DICTATION_MODEL").or_else(|_| std::env::var("OMP_SPEECH_MODEL"))
    {
        let trimmed = env_role.trim();
        if !trimmed.is_empty() {
            return Some(parse_model_selector(trimmed));
        }
    }

    None
}

/// Resolve Base URL and API key for a provider.
pub fn resolve_provider_credentials(provider_id: &str) -> (String, Option<String>) {
    let rows = crate::providers::rows::load_rows().unwrap_or_default();
    let row = rows.into_iter().find(|r| {
        r.id.eq_ignore_ascii_case(provider_id)
            || r.slug.eq_ignore_ascii_case(provider_id)
            || (provider_id.eq_ignore_ascii_case("openai")
                && (r.id == "openai" || r.id == "openai-codex"))
    });

    let base_url = row
        .as_ref()
        .and_then(|r| r.base_url.clone().or_else(|| r.default_base_url.clone()))
        .unwrap_or_else(|| match provider_id.to_ascii_lowercase().as_str() {
            "openai" | "openai-codex" => "https://api.openai.com/v1".to_string(),
            "groq" => "https://api.groq.com/openai/v1".to_string(),
            "mistral" => "https://api.mistral.ai/v1".to_string(),
            _ => "https://api.openai.com/v1".to_string(),
        });

    let mut key: Option<String> = None;

    if let Some(r) = &row {
        key = match r.key.kind {
            crate::contracts::ProviderKeyKind::LoginStored => {
                crate::providers::omp_config::read_agent_api_key(
                    &crate::providers::omp_config::home_agent_dir().join("agent.db"),
                    &r.id,
                )
            }
            crate::contracts::ProviderKeyKind::Encrypted => {
                crate::providers::vault::read_entry(&crate::providers::key_ref::vault_slug(&r.id))
                    .ok()
                    .flatten()
            }
            _ => None,
        };
    }

    // Fallback: check models.yml
    if key.is_none() {
        if let Ok(text) =
            std::fs::read_to_string(crate::providers::models_yml_providers::models_yml_path())
        {
            if let Ok(providers) = crate::providers::models_yml_providers::parse_providers(&text) {
                if let Some(p) = providers
                    .into_iter()
                    .find(|p| p.id.eq_ignore_ascii_case(provider_id))
                {
                    if let Some(raw_k) = p.api_key {
                        let k = raw_k.trim();
                        if k.starts_with('!') {
                            key = crate::providers::vault::read_entry(
                                &crate::providers::key_ref::vault_slug(provider_id),
                            )
                            .ok()
                            .flatten();
                        } else if crate::providers::rows::is_env_name(k) {
                            key = std::env::var(k).ok();
                        } else if !k.is_empty() {
                            key = Some(k.to_string());
                        }
                    }
                }
            }
        }
    }

    // Fallback: environment variables
    if key.is_none() {
        let env_candidates = [
            format!(
                "{}_API_KEY",
                provider_id.to_ascii_uppercase().replace('-', "_")
            ),
            format!("{}_KEY", provider_id.to_ascii_uppercase().replace('-', "_")),
        ];
        for var in env_candidates {
            if let Ok(val) = std::env::var(&var) {
                let trimmed = val.trim();
                if !trimmed.is_empty() {
                    key = Some(trimmed.to_string());
                    break;
                }
            }
        }
        if key.is_none() && provider_id.eq_ignore_ascii_case("openai") {
            key = std::env::var("OPENAI_API_KEY").ok();
        } else if key.is_none() && provider_id.eq_ignore_ascii_case("groq") {
            key = std::env::var("GROQ_API_KEY").ok();
        }
    }

    // Fallback: agent.db
    if key.is_none() {
        let db_path = crate::providers::omp_config::home_agent_dir().join("agent.db");
        key = crate::providers::omp_config::read_agent_api_key(&db_path, provider_id);
    }

    (base_url, key)
}

fn sanitize_stt_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/audio/transcriptions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/audio/transcriptions")
    }
}

async fn transcribe<B: Backend>(State(_ctx): State<Arc<Ctx<B>>>, req: Request) -> VoiceResult {
    let (parts, body) = req.into_parts();
    let ct = parts
        .headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let audio = if ct.starts_with("multipart/form-data") {
        let mp_req = Request::from_parts(parts, body);
        let mut mp = Multipart::from_request(mp_req, &()).await.map_err(|e| {
            structured_error(
                StatusCode::BAD_REQUEST,
                "invalid_multipart",
                format!("无法解析 multipart 表单: {e}"),
            )
        })?;
        extract_multipart(&mut mp).await?
    } else {
        let bytes = to_bytes(body, MAX_AUDIO_SIZE).await.map_err(|_| {
            structured_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "音频文件大小超出 25MB 限制",
            )
        })?;
        extract_raw(&parts.headers, bytes)?
    };

    if audio.bytes.is_empty() {
        return Err(structured_error(
            StatusCode::BAD_REQUEST,
            "empty_audio",
            "音频数据为空",
        ));
    }

    if audio.bytes.len() > MAX_AUDIO_SIZE {
        return Err(structured_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
            "音频文件大小超出 25MB 限制",
        ));
    }

    let target = resolve_dictation_role().ok_or_else(|| {
        structured_error(
            StatusCode::BAD_REQUEST,
            "unconfigured",
            "未配置语音转写模型角色 (dictation 或 speech)",
        )
    })?;

    let (base_url, api_key) = resolve_provider_credentials(&target.provider);
    let url = sanitize_stt_url(&base_url);

    let part_file = reqwest::multipart::Part::bytes(audio.bytes.to_vec())
        .file_name(audio.filename.clone())
        .mime_str(&audio.content_type)
        .unwrap_or_else(|_| {
            reqwest::multipart::Part::bytes(audio.bytes.to_vec()).file_name(audio.filename)
        });

    let form = reqwest::multipart::Form::new()
        .part("file", part_file)
        .text("model", target.model.clone());

    let client = reqwest::Client::builder()
        .timeout(STT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| {
            structured_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "client_error",
                format!("创建 HTTP 客户端失败: {e}"),
            )
        })?;

    let mut req = client.post(&url).multipart(form);
    if let Some(k) = &api_key {
        req = req.bearer_auth(k);
    }

    let response = req.send().await.map_err(|e| {
        if e.is_timeout() {
            structured_error(
                StatusCode::GATEWAY_TIMEOUT,
                "transcription_timeout",
                "语音转写请求超时 (60s)",
            )
        } else {
            // Note: without_url() prevents logging any secret query params
            structured_error(
                StatusCode::BAD_GATEWAY,
                "connection_error",
                format!("连接转写服务失败: {}", e.without_url()),
            )
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        let detail = match status.as_u16() {
            401 | 403 => "供应商认证失败：API 密钥无效或未授权".to_string(),
            404 => "转写接口不存在：请确认供应商支持 Whisper 转写接口".to_string(),
            413 => "文件大小超出供应商限制".to_string(),
            429 => "供应商调用额度耗尽或请求过于频繁".to_string(),
            code => format!("HTTP {code}"),
        };
        tracing::warn!("audio transcription failed with HTTP {status}");
        return Err(structured_error(
            StatusCode::BAD_GATEWAY,
            "transcription_failed",
            format!("转写失败 ({detail})"),
        ));
    }

    let res_json: Value = response.json().await.map_err(|_| {
        structured_error(
            StatusCode::BAD_GATEWAY,
            "invalid_response",
            "无法解析转写服务返回的 JSON 数据",
        )
    })?;

    let text = res_json
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    Ok(Json(json!({ "text": text })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dictation_role_from_yaml() {
        let yaml1 = r#"
modelRoles:
  dictation: "openai/whisper-1"
  default: "anthropic/claude-3-5-sonnet"
"#;
        assert_eq!(parse_dictation_role(yaml1), Some("openai/whisper-1".into()));

        let yaml2 = r#"
modelRoles:
  speech: "groq/whisper-large-v3:off"
"#;
        assert_eq!(
            parse_dictation_role(yaml2),
            Some("groq/whisper-large-v3:off".into())
        );

        let yaml_empty = r#"
modelRoles:
  default: "openai/gpt-4"
"#;
        assert_eq!(parse_dictation_role(yaml_empty), None);
    }

    #[test]
    fn strips_thinking_suffixes() {
        assert_eq!(
            strip_thinking_suffix("openai/whisper-1:off"),
            "openai/whisper-1"
        );
        assert_eq!(
            strip_thinking_suffix("openai/whisper-1:high"),
            "openai/whisper-1"
        );
        assert_eq!(
            strip_thinking_suffix("openai/whisper-1"),
            "openai/whisper-1"
        );
        assert_eq!(strip_thinking_suffix("whisper-1:auto"), "whisper-1");
    }

    #[test]
    fn parses_model_selectors() {
        assert_eq!(
            parse_model_selector("openai/whisper-1"),
            ModelRoleTarget {
                provider: "openai".into(),
                model: "whisper-1".into()
            }
        );
        assert_eq!(
            parse_model_selector("groq/whisper-large-v3:off"),
            ModelRoleTarget {
                provider: "groq".into(),
                model: "whisper-large-v3".into()
            }
        );
        assert_eq!(
            parse_model_selector("whisper-1"),
            ModelRoleTarget {
                provider: "openai".into(),
                model: "whisper-1".into()
            }
        );
    }

    #[test]
    fn detects_audio_mime_types() {
        assert_eq!(
            detect_audio_mime(b"RIFF\x00\x00\x00\x00WAVEfmt "),
            "audio/wav"
        );
        assert_eq!(
            detect_audio_mime(&[0x1a, 0x45, 0xdf, 0xa3, 0x01]),
            "audio/webm"
        );
        assert_eq!(detect_audio_mime(b"OggS\x00\x02"), "audio/ogg");
        assert_eq!(detect_audio_mime(b"\x00\x00\x00\x18ftypmp42"), "audio/mp4");
        assert_eq!(detect_audio_mime(b"ID3\x03\x00\x00"), "audio/mpeg");
    }

    #[test]
    fn sanitizes_stt_urls() {
        assert_eq!(
            sanitize_stt_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/audio/transcriptions"
        );
        assert_eq!(
            sanitize_stt_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/audio/transcriptions"
        );
        assert_eq!(
            sanitize_stt_url("https://custom.endpoint/audio/transcriptions"),
            "https://custom.endpoint/audio/transcriptions"
        );
    }
}
