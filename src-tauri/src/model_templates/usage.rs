//! Quota report fetching and judgement for the quota switch rules.
//!
//! The report is the JSON of `omp usage --json` (served from the CLI cache; the poller never
//! invalidates it). One report entry is one *account* of one provider, so a provider with
//! several accounts appears several times under the same slug.
//!
//! Window percentages are read the way the quota dashboard reads them: `amount.unit ==
//! "percent"` carries the percentage directly (`used`, else `usedFraction * 100`), every other
//! unit is `used / limit * 100`. Limits without a usable amount are ignored instead of being
//! counted as 0 %.

use std::collections::BTreeMap;

use serde_json::Value;

use super::{ProviderStatus, WindowStatus};
use crate::providers::commands::run_usage_report;
use crate::state::AppState;

/// One quota window of one account.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LimitRow {
    pub window_key: String,
    pub label: String,
    pub used_pct: f64,
    pub resets_at: Option<i64>,
}

/// One account of one provider (a single `reports[]` entry).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct AccountLimits {
    pub limits: Vec<LimitRow>,
}

/// Parsed report: usage slug -> accounts.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct UsageSnapshot {
    pub fetched_at: i64,
    pub providers: BTreeMap<String, Vec<AccountLimits>>,
}

/// Aggregate state of one provider across all of its accounts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProviderState {
    Available,
    Exhausted,
    /// The provider has no usage report at all.
    Unmapped,
}

/// Reads the cached CLI quota report and projects it into [`UsageSnapshot`].
pub(crate) async fn fetch_usage(state: &AppState) -> Result<UsageSnapshot, String> {
    // Always the cached report: polling must not spend a provider round trip every interval.
    let value = run_usage_report(state, false).await?;
    Ok(parse_snapshot(&value))
}

/// Most-idle-account percentage of one window: the minimum `used_pct` across accounts.
/// `None` when the provider or the window is absent.
pub(crate) fn window_pct(snap: &UsageSnapshot, usage_slug: &str, window_key: &str) -> Option<f64> {
    window_row(snap, usage_slug, window_key).map(|row| row.used_pct)
}

/// `Exhausted` only when every account of the provider has at least one window and every
/// reported limit of that account is at or above 100 %. A provider without a report is
/// `Unmapped`; an account that reports no usable window can never prove exhaustion, so it
/// keeps the provider `Available`.
pub(crate) fn provider_state(snap: &UsageSnapshot, usage_slug: &str) -> ProviderState {
    let Some(accounts) = snap.providers.get(usage_slug) else {
        return ProviderState::Unmapped;
    };
    if accounts.is_empty() {
        return ProviderState::Unmapped;
    }
    if accounts.iter().all(account_exhausted) {
        ProviderState::Exhausted
    } else {
        ProviderState::Available
    }
}

/// One row per reported provider, ordered by slug, with every window aggregated across accounts.
pub(crate) fn provider_statuses(snap: &UsageSnapshot) -> Vec<ProviderStatus> {
    snap.providers
        .iter()
        .map(|(usage_slug, accounts)| {
            let model_provider =
                super::provider_map::model_provider_for_usage(usage_slug).map(str::to_string);
            let state = match provider_state(snap, usage_slug) {
                ProviderState::Exhausted => "exhausted",
                ProviderState::Available => "available",
                ProviderState::Unmapped => "unmapped",
            };
            let mut keys: Vec<&str> = Vec::new();
            for account in accounts {
                for row in &account.limits {
                    if !keys.contains(&row.window_key.as_str()) {
                        keys.push(&row.window_key);
                    }
                }
            }
            let windows = keys
                .into_iter()
                .filter_map(|key| {
                    let row = window_row(snap, usage_slug, key)?;
                    Some(WindowStatus {
                        key: key.to_string(),
                        label: row.label.clone(),
                        used_pct: row.used_pct,
                        resets_at: row.resets_at,
                    })
                })
                .collect();
            ProviderStatus {
                usage_slug: usage_slug.clone(),
                model_provider,
                state: state.to_string(),
                windows,
                accounts: accounts.len() as u32,
                exhausted_accounts: accounts
                    .iter()
                    .filter(|account| account_exhausted(account))
                    .count() as u32,
            }
        })
        .collect()
}

/// An account counts as exhausted only when it reports limits and every one of them is at
/// 100 % or more.
fn account_exhausted(account: &AccountLimits) -> bool {
    !account.limits.is_empty() && account.limits.iter().all(|row| row.used_pct >= 100.0)
}

/// One account's usage of one window. A window may carry several limits (google-antigravity
/// reports the Gemini and the third-party quota of the same 5 h window separately), and the
/// account is only as free as its tightest one, so the highest percentage wins.
fn account_window_row<'a>(account: &'a AccountLimits, window_key: &str) -> Option<&'a LimitRow> {
    account
        .limits
        .iter()
        .filter(|row| row.window_key == window_key)
        .max_by(|a, b| a.used_pct.total_cmp(&b.used_pct))
}

/// The binding row of one window: each account's tightest limit in that window, then the most
/// idle account among them (lowest percentage) — the contract's "same window -> min" rule.
fn window_row<'a>(
    snap: &'a UsageSnapshot,
    usage_slug: &str,
    window_key: &str,
) -> Option<&'a LimitRow> {
    snap.providers
        .get(usage_slug)?
        .iter()
        .filter_map(|account| account_window_row(account, window_key))
        .min_by(|a, b| a.used_pct.total_cmp(&b.used_pct))
}

// ---------- parsing ----------

fn parse_snapshot(value: &Value) -> UsageSnapshot {
    let fetched_at = value
        .get("generatedAt")
        .and_then(Value::as_i64)
        .unwrap_or_else(now_millis);
    let mut providers: BTreeMap<String, Vec<AccountLimits>> = BTreeMap::new();
    if let Some(reports) = value.get("reports").and_then(Value::as_array) {
        for report in reports {
            let Some(slug) = report
                .get("provider")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|slug| !slug.is_empty())
            else {
                continue;
            };
            let mut limits = Vec::new();
            if let Some(rows) = report.get("limits").and_then(Value::as_array) {
                limits.extend(rows.iter().filter_map(parse_limit));
            }
            providers
                .entry(slug.to_string())
                .or_default()
                .push(AccountLimits { limits });
        }
    }
    UsageSnapshot {
        fetched_at,
        providers,
    }
}

fn parse_limit(limit: &Value) -> Option<LimitRow> {
    let raw_key = limit
        .pointer("/scope/windowId")
        .and_then(Value::as_str)
        .or_else(|| limit.pointer("/window/id").and_then(Value::as_str))
        .or_else(|| limit.get("id").and_then(Value::as_str))?;
    let window_key = normalize_window_key(raw_key);
    if window_key.is_empty() {
        return None;
    }
    let label = limit
        .pointer("/window/label")
        .and_then(Value::as_str)
        .or_else(|| limit.get("label").and_then(Value::as_str))
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| window_key.clone());
    let used_pct = limit_pct(limit.get("amount")?)?;
    let resets_at = limit.pointer("/window/resetsAt").and_then(Value::as_i64);
    Some(LimitRow {
        window_key,
        label,
        used_pct,
        resets_at,
    })
}

/// Percentage used by one limit, or `None` when the amount carries no usable numbers.
fn limit_pct(amount: &Value) -> Option<f64> {
    let unit = amount
        .get("unit")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let pct = if unit == "percent" {
        amount.get("used").and_then(Value::as_f64).or_else(|| {
            amount
                .get("usedFraction")
                .and_then(Value::as_f64)
                .map(|fraction| fraction * 100.0)
        })?
    } else {
        let limit = amount
            .get("limit")
            .and_then(Value::as_f64)
            .filter(|limit| *limit > 0.0)?;
        let used = amount.get("used").and_then(Value::as_f64)?;
        used / limit * 100.0
    };
    Some(pct.clamp(0.0, 100.0))
}

/// Collapses the provider-specific window vocabulary onto the four shared keys; anything else
/// keeps its reported value.
fn normalize_window_key(raw: &str) -> String {
    let trimmed = raw.trim();
    match trimmed.to_lowercase().as_str() {
        "5-hour" | "5hour" => "5h".to_string(),
        "weekly" | "1w" | "week" => "7d".to_string(),
        "daily" | "24h" => "1d".to_string(),
        "monthly" | "1mo" => "30d".to_string(),
        _ => trimmed.to_string(),
    }
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snapshot() -> UsageSnapshot {
        parse_snapshot(&json!({
            "generatedAt": 1_700_000_000_000i64,
            "reports": [
                {"provider": "anthropic", "limits": [
                    {"id": "anthropic:5h", "label": "5 Hour",
                     "scope": {"windowId": "5-hour"},
                     "window": {"id": "5h", "label": "5 Hour", "resetsAt": 1_700_000_500_000i64},
                     "amount": {"unit": "percent", "used": 40, "limit": 100}},
                    {"id": "anthropic:7d",
                     "scope": {"windowId": "weekly"},
                     "window": {"id": "weekly", "label": "7 Day"},
                     "amount": {"unit": "percent", "usedFraction": 0.9}}
                ]},
                {"provider": "anthropic", "limits": [
                    {"id": "anthropic:5h", "scope": {"windowId": "5h"},
                     "window": {"id": "5h", "label": "5 Hour"},
                     "amount": {"unit": "percent", "used": 10}},
                    {"id": "anthropic:7d", "scope": {"windowId": "7d"},
                     "window": {"id": "7d", "label": "7 Day"},
                     "amount": {"unit": "percent", "used": 99}}
                ]},
                {"provider": "devin", "limits": [
                    {"id": "devin:credits:prompt", "label": "Prompt Credits",
                     "window": {"id": "monthly", "label": "Plan Period"},
                     "amount": {"unit": "unknown", "used": 25, "limit": 100}},
                    {"id": "devin:no-amount", "window": {"id": "daily"},
                     "amount": {"unit": "unknown"}}
                ]}
            ]
        }))
    }

    #[test]
    fn parses_accounts_and_normalizes_windows() {
        let snap = snapshot();
        assert_eq!(snap.fetched_at, 1_700_000_000_000);
        assert_eq!(snap.providers["anthropic"].len(), 2);
        // 5-hour -> 5h, weekly -> 7d, monthly -> 30d.
        assert!(snap.providers["anthropic"][0]
            .limits
            .iter()
            .any(|row| row.window_key == "5h"));
        assert!(snap.providers["anthropic"][0]
            .limits
            .iter()
            .any(|row| row.window_key == "7d"));
        // The amount-less limit is skipped instead of counting as 0 %.
        assert_eq!(snap.providers["devin"][0].limits.len(), 1);
        assert_eq!(snap.providers["devin"][0].limits[0].window_key, "30d");
        // Non-percent units use used / limit.
        assert_eq!(snap.providers["devin"][0].limits[0].used_pct, 25.0);
    }

    #[test]
    fn window_pct_takes_the_most_idle_account() {
        let snap = snapshot();
        assert_eq!(window_pct(&snap, "anthropic", "5h"), Some(10.0));
        assert_eq!(window_pct(&snap, "anthropic", "7d"), Some(90.0));
        assert_eq!(window_pct(&snap, "anthropic", "1d"), None);
        assert_eq!(window_pct(&snap, "unknown", "5h"), None);
    }

    #[test]
    fn provider_state_needs_every_account_exhausted() {
        let snap = snapshot();
        assert_eq!(provider_state(&snap, "anthropic"), ProviderState::Available);
        assert_eq!(provider_state(&snap, "devin"), ProviderState::Available);
        assert_eq!(provider_state(&snap, "nope"), ProviderState::Unmapped);
    }

    #[test]
    fn provider_state_detects_exhaustion() {
        let snap = parse_snapshot(&json!({
            "reports": [
                {"provider": "zai", "limits": [
                    {"window": {"id": "5h"}, "amount": {"unit": "percent", "used": 100}}
                ]},
                {"provider": "zai", "limits": [
                    {"window": {"id": "5h"}, "amount": {"unit": "percent", "used": 100}}
                ]}
            ]
        }));
        assert_eq!(provider_state(&snap, "zai"), ProviderState::Exhausted);
        let status = &provider_statuses(&snap)[0];
        assert_eq!(status.state, "exhausted");
        assert_eq!(status.accounts, 2);
        assert_eq!(status.exhausted_accounts, 2);
        assert_eq!(status.windows.len(), 1);
    }

    #[test]
    fn statuses_map_usage_slugs_to_model_providers() {
        let snap = parse_snapshot(&json!({
            "reports": [
                {"provider": "google-antigravity", "limits": [
                    {"window": {"id": "weekly", "label": "Weekly"},
                     "amount": {"unit": "percent", "used": 5}}
                ]},
                {"provider": "mystery", "limits": [
                    {"window": {"id": "5h"}, "amount": {"unit": "percent", "used": 5}}
                ]}
            ]
        }));
        let statuses = provider_statuses(&snap);
        assert_eq!(statuses.len(), 2);
        assert_eq!(statuses[0].usage_slug, "google-antigravity");
        assert_eq!(statuses[0].model_provider.as_deref(), Some("google"));
        assert_eq!(statuses[0].state, "available");
        assert_eq!(statuses[0].windows[0].key, "7d");
        // An unknown slug keeps its own name: no provider is ever guessed.
        assert_eq!(statuses[1].usage_slug, "mystery");
        assert_eq!(statuses[1].model_provider, None);
        assert_eq!(statuses[1].state, "available");
        assert_eq!(provider_state(&snap, "absent"), ProviderState::Unmapped);
    }
}
