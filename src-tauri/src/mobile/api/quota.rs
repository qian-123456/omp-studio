//! Unified quota endpoint (`GET /api/quota`).
//! Aggregates subscription and quota status across all configured providers
//! and accounts (ChatGPT, Claude, etc.), reusing `omp usage --json`.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::mobile::backend::Backend;
use crate::mobile::server::{ApiError, Ctx};

type ApiResult<T> = Result<Json<T>, ApiError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaLimit {
    pub name: String,
    pub used: f64,
    pub total: f64,
    pub unit: String,
    pub reset_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaAccount {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    pub limits: Vec<QuotaLimit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaProvider {
    pub id: String,
    pub name: String,
    pub accounts: Vec<QuotaAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaResponse {
    pub providers: Vec<QuotaProvider>,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct QuotaQuery {
    pub refresh: Option<bool>,
}

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new().route("/quota", get(quota_get::<B>))
}

async fn quota_get<B: Backend>(
    State(ctx): State<Arc<Ctx<B>>>,
    Query(query): Query<QuotaQuery>,
) -> ApiResult<QuotaResponse> {
    let refresh = query.refresh.unwrap_or(false);
    let state = ctx.backend.app_state();
    let raw = match state {
        Some(st) => crate::providers::commands::run_usage_report(st, refresh)
            .await
            .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?,
        None => Value::Null,
    };
    Ok(Json(parse_quota_report(&raw)))
}

pub fn parse_quota_report(raw: &Value) -> QuotaResponse {
    let updated_at = raw
        .get("generatedAt")
        .and_then(Value::as_i64)
        .or_else(|| raw.get("updatedAt").and_then(Value::as_i64))
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    let mut provider_accounts: BTreeMap<String, Vec<QuotaAccount>> = BTreeMap::new();

    if let Some(reports) = raw.get("reports").and_then(Value::as_array) {
        for (idx, report) in reports.iter().enumerate() {
            let Some(provider_slug) = report
                .get("provider")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                continue;
            };

            let metadata = report.get("metadata");
            let account_id = metadata
                .and_then(|m| m.get("accountId").or_else(|| m.get("id")))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{provider_slug}-{}", idx + 1));

            let email = metadata
                .and_then(|m| m.get("email"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);

            let plan = metadata
                .and_then(|m| m.get("planType").or_else(|| m.get("plan")))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);

            let mut limits = Vec::new();
            if let Some(limit_array) = report.get("limits").and_then(Value::as_array) {
                for lim in limit_array {
                    if let Some(parsed) = parse_single_limit(lim) {
                        limits.push(parsed);
                    }
                }
            }

            provider_accounts
                .entry(provider_slug.to_string())
                .or_default()
                .push(QuotaAccount {
                    id: account_id,
                    email,
                    plan,
                    limits,
                });
        }
    }

    let providers = provider_accounts
        .into_iter()
        .map(|(id, accounts)| {
            let name = provider_display_name(&id);
            QuotaProvider { id, name, accounts }
        })
        .collect();

    QuotaResponse {
        providers,
        updated_at,
    }
}

fn parse_single_limit(limit: &Value) -> Option<QuotaLimit> {
    let name = limit
        .pointer("/window/label")
        .and_then(Value::as_str)
        .or_else(|| limit.get("label").and_then(Value::as_str))
        .or_else(|| limit.pointer("/window/id").and_then(Value::as_str))
        .or_else(|| limit.get("id").and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    let amount = limit.get("amount");
    let unit = amount
        .and_then(|a| a.get("unit"))
        .and_then(Value::as_str)
        .unwrap_or("percent")
        .to_string();

    let (used, total) = if unit == "percent" {
        let u = amount
            .and_then(|a| a.get("used").and_then(Value::as_f64))
            .or_else(|| {
                amount
                    .and_then(|a| a.get("usedFraction").and_then(Value::as_f64))
                    .map(|f| f * 100.0)
            })
            .unwrap_or(0.0);
        let t = amount
            .and_then(|a| a.get("limit").and_then(Value::as_f64))
            .filter(|l| *l > 0.0)
            .unwrap_or(100.0);
        (u, t)
    } else {
        let u = amount
            .and_then(|a| a.get("used").and_then(Value::as_f64))
            .unwrap_or(0.0);
        let t = amount
            .and_then(|a| a.get("limit").and_then(Value::as_f64))
            .filter(|l| *l > 0.0)
            .unwrap_or(100.0);
        (u, t)
    };

    let reset_at = limit
        .pointer("/window/resetsAt")
        .and_then(Value::as_i64)
        .or_else(|| limit.get("resetsAt").and_then(Value::as_i64))
        .or_else(|| limit.get("resetAt").and_then(Value::as_i64));

    Some(QuotaLimit {
        name,
        used,
        total,
        unit,
        reset_at,
    })
}

fn provider_display_name(slug: &str) -> String {
    match slug.to_ascii_lowercase().as_str() {
        "anthropic" => "Anthropic (Claude)".to_string(),
        "openai" | "openai-codex" => "OpenAI (ChatGPT)".to_string(),
        "google" | "google-antigravity" => "Google (Gemini)".to_string(),
        "moonshot" | "kimi-code" => "Moonshot (Kimi)".to_string(),
        "zai" | "zhipu-coding-plan" => "Zhipu AI (GLM)".to_string(),
        "deepseek" => "DeepSeek".to_string(),
        "groq" => "Groq".to_string(),
        "devin" => "Devin".to_string(),
        "copilot" | "github-copilot" => "GitHub Copilot".to_string(),
        other => {
            let mut chars = other.chars();
            match chars.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_quota_report_multiple_providers_and_accounts() {
        let raw = json!({
            "generatedAt": 1700000000000i64,
            "reports": [
                {
                    "provider": "anthropic",
                    "metadata": {
                        "accountId": "acc-claude-1",
                        "email": "user@example.com",
                        "planType": "Pro"
                    },
                    "limits": [
                        {
                            "id": "anthropic:5h",
                            "label": "5 Hour",
                            "amount": { "unit": "percent", "used": 40.0, "limit": 100.0 },
                            "window": { "resetsAt": 1700000500000i64 }
                        },
                        {
                            "id": "anthropic:7d",
                            "label": "7 Day",
                            "amount": { "unit": "percent", "usedFraction": 0.85 },
                            "window": { "resetsAt": 1700001000000i64 }
                        }
                    ]
                },
                {
                    "provider": "anthropic",
                    "metadata": {
                        "accountId": "acc-claude-2",
                        "email": "work@company.com",
                        "planType": "Team"
                    },
                    "limits": [
                        {
                            "id": "anthropic:5h",
                            "label": "5 Hour",
                            "amount": { "unit": "percent", "used": 10.0 }
                        }
                    ]
                },
                {
                    "provider": "openai",
                    "metadata": {
                        "accountId": "acc-openai-1",
                        "planType": "Plus"
                    },
                    "limits": [
                        {
                            "id": "openai:credits",
                            "label": "Credits",
                            "amount": { "unit": "credits", "used": 15.5, "limit": 50.0 }
                        }
                    ]
                }
            ]
        });

        let resp = parse_quota_report(&raw);
        assert_eq!(resp.updated_at, 1700000000000);
        assert_eq!(resp.providers.len(), 2);

        // Anthropic provider
        let anthropic = &resp.providers[0];
        assert_eq!(anthropic.id, "anthropic");
        assert_eq!(anthropic.name, "Anthropic (Claude)");
        assert_eq!(anthropic.accounts.len(), 2);

        let acc1 = &anthropic.accounts[0];
        assert_eq!(acc1.id, "acc-claude-1");
        assert_eq!(acc1.email.as_deref(), Some("user@example.com"));
        assert_eq!(acc1.plan.as_deref(), Some("Pro"));
        assert_eq!(acc1.limits.len(), 2);
        assert_eq!(acc1.limits[0].name, "5 Hour");
        assert_eq!(acc1.limits[0].used, 40.0);
        assert_eq!(acc1.limits[0].total, 100.0);
        assert_eq!(acc1.limits[0].unit, "percent");
        assert_eq!(acc1.limits[0].reset_at, Some(1700000500000));

        assert_eq!(acc1.limits[1].name, "7 Day");
        assert_eq!(acc1.limits[1].used, 85.0);
        assert_eq!(acc1.limits[1].total, 100.0);
        assert_eq!(acc1.limits[1].unit, "percent");

        let acc2 = &anthropic.accounts[1];
        assert_eq!(acc2.id, "acc-claude-2");
        assert_eq!(acc2.email.as_deref(), Some("work@company.com"));
        assert_eq!(acc2.plan.as_deref(), Some("Team"));
        assert_eq!(acc2.limits[0].used, 10.0);

        // OpenAI provider
        let openai = &resp.providers[1];
        assert_eq!(openai.id, "openai");
        assert_eq!(openai.name, "OpenAI (ChatGPT)");
        assert_eq!(openai.accounts.len(), 1);
        let oacc = &openai.accounts[0];
        assert_eq!(oacc.id, "acc-openai-1");
        assert_eq!(oacc.email, None);
        assert_eq!(oacc.plan.as_deref(), Some("Plus"));
        assert_eq!(oacc.limits[0].unit, "credits");
        assert_eq!(oacc.limits[0].used, 15.5);
        assert_eq!(oacc.limits[0].total, 50.0);
    }

    #[test]
    fn parses_empty_report() {
        let resp = parse_quota_report(&json!({}));
        assert_eq!(resp.providers.len(), 0);
        assert!(resp.updated_at > 0);
    }
}
