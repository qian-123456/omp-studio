import { presetById } from "./presets";
export type ServiceMethod = "key" | "keyless" | "optional-key" | "settings" | "local" | "advanced";
export interface ServiceCapability { supplier: string; method: ServiceMethod; target?: string; }
const KEYLESS: Record<string, true> = { duckduckgo: true, startpage: true, google: true, ecosia: true, mojeek: true };
const OPTIONAL: Record<string, true> = { exa: true, parallel: true, firecrawl: true };
const KEYED: Record<string, true> = { brave: true, tavily: true, deepseek: true };
export const SEARCH_CREDENTIAL_PROVIDERS: Record<string, true> = { brave: true, tavily: true, exa: true, parallel: true, firecrawl: true };
/** Registry selectors remain untouched; only connection identity is resolved here. */
export function serviceCapability(entry: { selector: string; provider: string; kind: string }): ServiceCapability {
	if (entry.provider === "web" && entry.selector.startsWith("web/")) {
		const engine = entry.selector.slice(4);
		if (KEYLESS[engine]) return { supplier: engine === "google" ? "web/google" : engine, method: "keyless" };
		if (OPTIONAL[engine]) return { supplier: engine, method: "optional-key" };
		if (KEYED[engine]) return { supplier: engine, method: "key" };
		if (engine === "searxng") return { supplier: engine, method: "settings", target: "searxng" };
		// Kimi search explicitly rejects ordinary Moonshot open-platform credentials.
		return { supplier: engine, method: "advanced" };
	}
	if (entry.provider === "local") return entry.kind === "tts" || entry.kind === "stt" ? { supplier: entry.provider, method: "local", target: entry.kind } : { supplier: entry.provider, method: "advanced" };
	if (["ollama", "llama.cpp", "lm-studio", "apple"].includes(entry.provider)) return { supplier: entry.provider, method: "keyless" };
	const knownSupplier = Boolean(presetById(entry.provider)) || ["typesafe", "cloudflare", "workers-ai", "elevenlabs", "azure", "bedrock", "huggingface"].includes(entry.provider);
	return { supplier: entry.provider, method: knownSupplier && ["search", "judge", "image", "tts", "stt", "embedding", "rerank", "video"].includes(entry.kind) ? "key" : "advanced" };
}
