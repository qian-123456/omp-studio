//! Known provider presets — backend mirror of the frontend
//! `src/features/providers/presets.ts` (the frontend renders its own copy with
//! display colors). Kept for backend-side validation/lookup extensions.
//!
//! Env var names follow OMP's provider → variable map (see OMP docs/providers.md).

#![allow(dead_code)]

use crate::contracts::ProviderApi;

pub struct ProviderPreset {
    pub id: &'static str,
    pub name: &'static str,
    pub env_var: &'static str,
    pub base_url: &'static str,
    pub api: ProviderApi,
    /// Local engine — no API key needed.
    pub no_key: bool,
}

pub const PRESETS: &[ProviderPreset] = &[
    ProviderPreset {
        id: "openai",
        name: "OpenAI",
        env_var: "OPENAI_API_KEY",
        base_url: "https://api.openai.com/v1",
        api: ProviderApi::OpenaiCompletions,
        no_key: false,
    },
    ProviderPreset {
        id: "anthropic",
        name: "Anthropic",
        env_var: "ANTHROPIC_API_KEY",
        base_url: "https://api.anthropic.com",
        api: ProviderApi::Anthropic,
        no_key: false,
    },
    ProviderPreset {
        id: "google",
        name: "Google Gemini",
        env_var: "GEMINI_API_KEY",
        base_url: "https://generativelanguage.googleapis.com",
        api: ProviderApi::Gemini,
        no_key: false,
    },
    ProviderPreset {
        id: "deepseek",
        name: "DeepSeek",
        env_var: "DEEPSEEK_API_KEY",
        base_url: "https://api.deepseek.com",
        api: ProviderApi::OpenaiCompletions,
        no_key: false,
    },
    ProviderPreset {
        id: "moonshot",
        name: "Moonshot Kimi",
        env_var: "MOONSHOT_API_KEY",
        base_url: "https://api.moonshot.cn/v1",
        api: ProviderApi::OpenaiCompletions,
        no_key: false,
    },
    ProviderPreset {
        id: "openrouter",
        name: "OpenRouter",
        env_var: "OPENROUTER_API_KEY",
        base_url: "https://openrouter.ai/api/v1",
        api: ProviderApi::OpenaiCompletions,
        no_key: false,
    },
    ProviderPreset {
        id: "siliconflow",
        name: "SiliconFlow",
        env_var: "SILICONFLOW_API_KEY",
        base_url: "https://api.siliconflow.cn/v1",
        api: ProviderApi::OpenaiCompletions,
        no_key: false,
    },
    ProviderPreset {
        id: "groq",
        name: "Groq",
        env_var: "GROQ_API_KEY",
        base_url: "https://api.groq.com/openai/v1",
        api: ProviderApi::OpenaiCompletions,
        no_key: false,
    },
    ProviderPreset {
        id: "mistral",
        name: "Mistral",
        env_var: "MISTRAL_API_KEY",
        base_url: "https://api.mistral.ai/v1",
        api: ProviderApi::OpenaiCompletions,
        no_key: false,
    },
    ProviderPreset {
        id: "xai",
        name: "xAI",
        env_var: "XAI_API_KEY",
        base_url: "https://api.x.ai/v1",
        api: ProviderApi::OpenaiCompletions,
        no_key: false,
    },
    ProviderPreset {
        id: "ollama",
        name: "Ollama",
        env_var: "OLLAMA_API_KEY",
        base_url: "http://localhost:11434",
        api: ProviderApi::Ollama,
        no_key: true,
    },
];

pub fn find(id: &str) -> Option<&'static ProviderPreset> {
    PRESETS.iter().find(|p| p.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_ids_are_unique_and_findable() {
        let mut ids: Vec<&str> = PRESETS.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), before);
        assert_eq!(find("anthropic").unwrap().env_var, "ANTHROPIC_API_KEY");
        assert!(find("nope").is_none());
    }
}
