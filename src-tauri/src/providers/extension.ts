interface Provider {
	name: string;
	slug: string;
	baseUrl: string;
	api: string;
	envVar: string;
	models: string[];
}

export default function (pi: any) {
	const providers: Provider[] = JSON.parse(process.env.OMP_WORKSPACE_PROVIDERS ?? "[]");
	for (const provider of providers) {
		if (provider.models.length === 0) continue;
		const local = provider.api === "ollama";
		const api = provider.api === "anthropic" ? "anthropic-messages"
			: provider.api === "gemini" ? "google-generative-ai" : "openai-completions";
		const baseUrl = local ? `${provider.baseUrl.replace(/\/+$/, "")}/v1`
			: provider.api === "gemini" && !/\/v1(beta)?\/?$/.test(provider.baseUrl)
				? `${provider.baseUrl.replace(/\/+$/, "")}/v1beta` : provider.baseUrl;
		// Namespacing preserves the user's own OMP provider registrations.
		pi.registerProvider(`ompws-${provider.slug}`, {
			baseUrl,
			api,
			apiKey: local ? "omp-workspace-local" : provider.envVar,
			models: [...new Set(provider.models)].map((id) => ({
				id,
				name: `${provider.name} · ${id}`,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 32768,
				maxTokens: 4096,
			})),
		});
	}
}
