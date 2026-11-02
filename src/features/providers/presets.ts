import { tNow } from "../../stores/language";

/** Display preset mirroring the backend `providers/presets.rs` table. */
export interface ProviderPreset {
	id: string;
	name: string;
	/** Row dot / chip color. */
	color: string;
	baseUrl: string;
	api: string;
	envVar: string;
	models: string[];
	defaultModel?: string;
	/** Local engine — no API key needed. */
	noKey?: boolean;
}

/** Dedicated account protocols cannot be configured by substituting an ordinary API key. */
export const OAUTH_ONLY_SUPPLIERS: Readonly<Record<string, true>> = {
	"google-antigravity": true, "google-gemini-cli": true, "openai-codex": true,
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		id: "openai",
		name: "OpenAI",
		color: "#10a37f",
		baseUrl: "https://api.openai.com/v1",
		api: "openai-completions",
		envVar: "OPENAI_API_KEY",
		models: ["gpt-4o", "gpt-4.1", "o3"],
		defaultModel: "gpt-4o",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		color: "#d97757",
		baseUrl: "https://api.anthropic.com",
		api: "anthropic-messages",
		envVar: "ANTHROPIC_API_KEY",
		models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
		defaultModel: "claude-sonnet-4-5",
	},
	{
		id: "google",
		name: "Google Gemini",
		color: "#4285f4",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		api: "google-generative-ai",
		envVar: "GEMINI_API_KEY",
		models: ["gemini-2.5-pro", "gemini-2.5-flash"],
		defaultModel: "gemini-2.5-pro",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		color: "#4d6bfe",
		baseUrl: "https://api.deepseek.com",
		api: "openai-completions",
		envVar: "DEEPSEEK_API_KEY",
		models: ["deepseek-chat", "deepseek-reasoner"],
		defaultModel: "deepseek-chat",
	},
	{
		id: "moonshot",
		name: "Moonshot Kimi",
		color: "#16b0a1",
		baseUrl: "https://api.moonshot.cn/v1",
		api: "openai-completions",
		envVar: "MOONSHOT_API_KEY",
		models: ["kimi-k2-turbo-preview", "kimi-k2-0905-preview"],
		defaultModel: "kimi-k2-turbo-preview",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		color: "#8b5cf6",
		baseUrl: "https://openrouter.ai/api/v1",
		api: "openai-completions",
		envVar: "OPENROUTER_API_KEY",
		models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o", "google/gemini-2.5-pro"],
		defaultModel: "anthropic/claude-sonnet-4.5",
	},
	{
		id: "siliconflow",
		name: "SiliconFlow",
		color: "#7c3aed",
		baseUrl: "https://api.siliconflow.cn/v1",
		api: "openai-completions",
		envVar: "SILICONFLOW_API_KEY",
		models: ["deepseek-ai/DeepSeek-V3.1", "Qwen/Qwen3-235B-A22B-Instruct"],
		defaultModel: "deepseek-ai/DeepSeek-V3.1",
	},
	{
		id: "groq",
		name: "Groq",
		color: "#f55036",
		baseUrl: "https://api.groq.com/openai/v1",
		api: "openai-completions",
		envVar: "GROQ_API_KEY",
		models: ["llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct"],
		defaultModel: "llama-3.3-70b-versatile",
	},
	{
		id: "mistral",
		name: "Mistral",
		color: "#ff7000",
		baseUrl: "https://api.mistral.ai/v1",
		api: "openai-completions",
		envVar: "MISTRAL_API_KEY",
		models: ["mistral-large-latest", "mistral-small-latest"],
		defaultModel: "mistral-large-latest",
	},
	{
		id: "xai",
		name: "xAI",
		color: "#e4e4e7",
		baseUrl: "https://api.x.ai/v1",
		api: "openai-completions",
		envVar: "XAI_API_KEY",
		models: ["grok-4", "grok-3-mini"],
		defaultModel: "grok-4",
	},
	{
		id: "ollama",
		name: "Ollama",
		color: "#6b7280",
		baseUrl: "http://localhost:11434/v1",
		api: "openai-completions",
		envVar: "OLLAMA_API_KEY",
		models: [],
		noKey: true,
	},
	{
		id: "custom",
		get name() {
			return tNow("providers.presetCustom");
		},
		color: "#f59e0b",
		baseUrl: "",
		api: "openai-completions",
		envVar: "",
		models: [],
	},
];
export function presetById(id: string | null | undefined): ProviderPreset | undefined {
	if (!id) return undefined;
	return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** Match an env var (from .env import) back to a preset. */
export function matchPresetByEnvVar(envVar: string): ProviderPreset | undefined {
	return PROVIDER_PRESETS.find((p) => p.envVar !== "" && p.envVar === envVar);
}

/** Protocols offered in the provider form; any other OMP api string is entered as free text. */
export const KNOWN_APIS: { value: string; readonly label: string }[] = [
	{
		value: "openai-completions",
		get label() {
			return tNow("providers.apiOpenaiCompletions");
		},
	},
	{
		value: "openai-responses",
		get label() {
			return tNow("providers.apiOpenaiResponses");
		},
	},
	{
		value: "anthropic-messages",
		get label() {
			return tNow("providers.apiAnthropicMessages");
		},
	},
	{
		value: "google-generative-ai",
		get label() {
			return tNow("providers.apiGoogleGenerativeAi");
		},
	},
];

/** Per-model protocols verified against the installed consumer; provider defaults use the narrower chat API schema. */
export const SERVICE_PURPOSES: readonly { kind: string; key: "providers.purposeImage" | "providers.purposeStt" | "providers.purposeTts" | "providers.purposeEmbedding" | "providers.purposeRerank" | "providers.purposeVideo" | "providers.purposeJudge"; apis: readonly string[] }[] = [
	{ kind: "image", key: "providers.purposeImage", apis: ["openai-images", "openrouter-images", "openai-responses", "google-generative-ai"] },
	{ kind: "stt", key: "providers.purposeStt", apis: ["openai-transcriptions"] },
	{ kind: "tts", key: "providers.purposeTts", apis: ["openai-speech", "xai-tts"] },
	{ kind: "embedding", key: "providers.purposeEmbedding", apis: ["openai-embeddings"] },
	{ kind: "rerank", key: "providers.purposeRerank", apis: ["openrouter-rerank"] },
	{ kind: "video", key: "providers.purposeVideo", apis: ["openrouter-video"] },
	{ kind: "judge", key: "providers.purposeJudge", apis: ["typesafe", "openrouter-decisions", "openai-decisions"] },
];

/** Internal runner protocols cannot be used as the provider-level API. */
export const INVALID_PROVIDER_APIS: Record<string, true> = {
	"openai-images": true, "openrouter-images": true, "openai-transcriptions": true,
	"openai-speech": true, "xai-tts": true, "openai-embeddings": true,
	"openrouter-rerank": true, "openrouter-video": true, "web-search": true,
	"local-inference": true, "factory-droid-agent": true,
};

export const SERVICE_API_LABELS: Record<string, string> = {
	"openai-images": "OpenAI Images", "openrouter-images": "OpenRouter Images",
	"openai-responses": "OpenAI Responses", "openai-codex-responses": "OpenAI Codex Responses",
	"google-generative-ai": "Google Gemini", "google-gemini-cli": "Google Gemini CLI",
	"factory-droid-agent": "Factory Droid", "openai-transcriptions": "OpenAI Transcriptions",
	"openai-speech": "OpenAI Speech", "xai-tts": "xAI Speech", "openai-embeddings": "OpenAI Embeddings",
	"openrouter-rerank": "OpenRouter Rerank", "openrouter-video": "OpenRouter Video",
	typesafe: "Typesafe", "openrouter-decisions": "OpenRouter Decisions",
	"openai-decisions": "OpenAI Decisions", "workers-ai-systemone": "Cloudflare Workers AI System One",
};

export function isExplicitServiceModel(model: { kind?: string | null; api?: string | null }): boolean {
	return Boolean((model.kind && model.kind !== "chat" && model.kind !== "tiny") ||
		["openai-images", "openrouter-images", "openai-speech", "xai-tts", "openai-transcriptions",
			"openai-embeddings", "openrouter-rerank", "openrouter-video", "typesafe",
			"openrouter-decisions", "openai-decisions", "workers-ai-systemone"].includes(model.api ?? ""));
}

/** Unknown upstream extensions are retained, not guessed from model names. */
export function serviceApiSupportsKind(kind: string, api: string): boolean | null {
	if (["web-search", "local-inference", "factory-droid-agent"].includes(api)) return false;
	const purpose = SERVICE_PURPOSES.find((p) => p.kind === kind);
	// These upstream protocols support the kind but need dedicated authentication/configuration.
	if (kind === "image" && ["openai-codex-responses", "google-gemini-cli"].includes(api)) return true;
	if (kind === "judge" && api === "workers-ai-systemone") return true;
	if ((kind === "chat" || kind === "tiny") && isExplicitServiceModel({ api })) return false;
	if (!purpose || (!Object.prototype.hasOwnProperty.call(SERVICE_API_LABELS, api) && !KNOWN_APIS.some((entry) => entry.value === api))) return null;
	return purpose.apis.some((value) => value === api);
}
