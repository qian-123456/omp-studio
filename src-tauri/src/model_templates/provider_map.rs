//! Usage slug ↔ model provider mapping for the quota switch rules.
//!
//! A quota report is keyed by the *usage* slug (`google-antigravity`, `kimi-code`, …) while a
//! model selector is keyed by the *model* provider (`google`, `moonshot`, …). The two
//! vocabularies overlap but are not identical, so every cross-vocabulary comparison goes
//! through this table. An unknown slug maps to `None`: guessing would attach a rule to the
//! wrong provider, which is worse than "no quota report".

/// Model provider for a usage slug, when the two vocabularies are known to agree.
///
/// Unknown slugs return `None` — never a guess.
pub(crate) fn model_provider_for_usage(usage_slug: &str) -> Option<&'static str> {
    Some(match usage_slug.trim() {
        "anthropic" => "anthropic",
        "openai" => "openai",
        "openai-codex" => "openai",
        "google" => "google",
        "google-antigravity" => "google",
        "kimi-code" => "moonshot",
        "zai" => "zai",
        "zai-coding-plan" => "zai",
        "zhipu-coding-plan" => "zai",
        "deepseek" => "deepseek",
        "github-copilot" => "github-copilot",
        "cursor" => "cursor",
        "devin" => "devin",
        "minimax-code" => "minimax",
        "alibaba-token-plan" => "alibaba",
        "alibaba-coding-plan" => "alibaba",
        "opencode-go" => "opencode",
        "codegeex" => "codegeex",
        "openrouter" => "openrouter",
        _ => return None,
    })
}

/// Whether a usage slug and a model provider name the same vendor: equal after mapping, or
/// equal verbatim (an unmapped slug whose vendor uses the same name on both sides).
pub(crate) fn provider_matches(usage_slug: &str, model_provider: &str) -> bool {
    let model_provider = model_provider.trim();
    if model_provider.is_empty() {
        return false;
    }
    model_provider_for_usage(usage_slug) == Some(model_provider)
        || usage_slug.trim() == model_provider
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_usage_slugs() {
        assert_eq!(
            model_provider_for_usage("google-antigravity"),
            Some("google")
        );
        assert_eq!(model_provider_for_usage("kimi-code"), Some("moonshot"));
        assert_eq!(model_provider_for_usage("zhipu-coding-plan"), Some("zai"));
        assert_eq!(model_provider_for_usage("anthropic"), Some("anthropic"));
    }

    #[test]
    fn unknown_slug_is_not_guessed() {
        assert_eq!(model_provider_for_usage("some-new-vendor"), None);
        assert!(!provider_matches("some-new-vendor", "some-new-vendor-2"));
    }

    #[test]
    fn matches_mapped_or_verbatim() {
        assert!(provider_matches("google-antigravity", "google"));
        assert!(provider_matches("anthropic", "anthropic"));
        // Same name on both sides, no mapping needed.
        assert!(provider_matches("openrouter", "openrouter"));
        assert!(!provider_matches("anthropic", "openai"));
        assert!(!provider_matches("anthropic", ""));
    }
}
