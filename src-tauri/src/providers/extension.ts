interface ModelSpec {
	id: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
}

type ModelEntry = string | ModelSpec;

interface Provider {
	name: string;
	slug: string;
	baseUrl: string;
	api: string;
	envVar: string;
	models: ModelEntry[];
	defaultContextWindow?: number;
	defaultMaxTokens?: number;
}

interface ExtensionContext {
	registerProvider: (id: string, provider: unknown) => void;
}

export default function (pi: ExtensionContext) {
	const providers: Provider[] = JSON.parse(process.env.OMP_WORKSPACE_PROVIDERS ?? "[]");
	for (const provider of providers) {
		if (!provider.models || provider.models.length === 0) continue;
		const local = provider.api === "ollama";
		const api = provider.api === "anthropic" ? "anthropic-messages"
			: provider.api === "gemini" ? "google-generative-ai"
			: (provider.api === "openai_responses" || provider.api === "openai-responses") ? "openai-responses"
			: "openai-completions";
		const baseUrl = local ? `${provider.baseUrl.replace(/\/+$/, "")}/v1`
			: provider.api === "gemini" && !/\/v1(beta)?\/?$/.test(provider.baseUrl)
				? `${provider.baseUrl.replace(/\/+$/, "")}/v1beta` : provider.baseUrl;
		// Namespacing preserves the user's own OMP provider registrations.
		// CONTRACT NOTE (P1 apiKey env-name semantics):
		// `apiKey` is explicitly passed as `provider.envVar` (the env var NAME, e.g. "ANTHROPIC_API_KEY",
		// not the secret key value). OMP resolves the env var name from the process environment
		// (which was injected by `omp_spawn_env`), falling back to literal use if unset.
		// Never pass the decrypted key here to avoid leaking secrets into extension payloads or logs.
		//
		// CONTRACT NOTE (P2 capabilities):
		// Model capabilities resolve with precedence: per-model `ModelSpec` fields ->
		// provider-level defaults (`defaultContextWindow` / `defaultMaxTokens`) ->
		// fallback defaults (`contextWindow: 32768`, `maxTokens: 4096`).
		const specs: ModelSpec[] = provider.models.map((entry) =>
			typeof entry === "string" ? { id: entry } : entry
		);
		const seen = new Set<string>();
		const deduped: ModelSpec[] = [];
		for (const spec of specs) {
			if (!spec || !spec.id || seen.has(spec.id)) continue;
			seen.add(spec.id);
			deduped.push(spec);
		}
		if (deduped.length === 0) continue;

		pi.registerProvider(`ompws-${provider.slug}`, {
			baseUrl,
			api,
			apiKey: local ? "omp-workspace-local" : provider.envVar,
			models: deduped.map((spec) => ({
				id: spec.id,
				name: spec.name ?? `${provider.name} · ${spec.id}`,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: spec.contextWindow ?? provider.defaultContextWindow ?? 32768,
				maxTokens: spec.maxTokens ?? provider.defaultMaxTokens ?? 4096,
			})),
		});
	}
}
