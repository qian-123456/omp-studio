export interface ModelOption {
	provider: string;
	id: string;
	name: string;
	/** Thinking levels this model supports (omp `thinking` array). Empty when unknown/unsupported. */
	thinking?: string[];
}

export interface CurrentModelSelection {
	/** Canonical select value: e.g. "anthropic/claude-sonnet-4-5" or "claude-sonnet-4-5" or "" */
	value: string;
	provider?: string;
	id?: string;
	label: string;
}

export interface SetModelPayload {
	type: "set_model";
	provider: string;
	modelId: string;
}

export function toModelKey(provider: string, id: string): string {
	return `${provider}/${id}`;
}

/** Normalize omp's `thinking` field into a flat list of effort levels.
 * Accepts both shapes observed in the wild:
 *  - `omp models --json`: `["medium","high","max"]`
 *  - `get_state` / models.db cache: `{mode, efforts:[…], defaultLevel, …}`
 * Unknown/absent input → `[]`. */
export function extractThinkingLevels(thinking: unknown): string[] {
	if (Array.isArray(thinking)) {
		return thinking.filter((t): t is string => typeof t === "string");
	}
	if (thinking && typeof thinking === "object") {
		const efforts = (thinking as Record<string, unknown>).efforts;
		if (Array.isArray(efforts)) {
			return efforts.filter((t): t is string => typeof t === "string");
		}
	}
	return [];
}

/** Resolve selectable thinking levels from live capabilities, then the model catalog.
 * Keep the current RPC value visible even when it is absent from known capabilities. */
export function resolveThinkingLevels(
	liveThinking: unknown,
	catalogLevels?: readonly string[] | null,
	currentLevel?: string | null,
): string[] {
	const liveLevels = extractThinkingLevels(liveThinking);
	const supported =
		liveLevels.length > 0
			? liveLevels
			: (catalogLevels?.filter((level) => typeof level === "string") ?? []);
	const current = currentLevel || undefined;
	if (supported.length === 0) return current ? [current] : [];

	const levels = ["auto", ...supported.filter((level) => level !== "auto")];
	if (!levels.includes("off")) levels.push("off");
	if (current && !levels.includes(current)) levels.push(current);
	return levels;
}
export function parseModels(data: unknown): ModelOption[] {
	if (!data) return [];
	const d = data as Record<string, unknown>;
	const list = Array.isArray(d)
		? d
		: Array.isArray(d.models)
		? d.models
		: Array.isArray((d.data as Record<string, unknown>)?.models)
		? (d.data as Record<string, unknown>).models
		: Array.isArray(d.data)
		? d.data
		: [];
	const out: ModelOption[] = [];
	const seen = new Set<string>();
	for (const m of Array.isArray(list) ? list : []) {
		if (!m || typeof m !== "object") continue;
		const o = m as Record<string, unknown>;
		const id = (o.id ?? o.modelId ?? o.model) as string | undefined;
		const provider = (o.provider ?? o.providerId) as string | undefined;
		if (id && provider) {
			const cleanId = String(id).trim();
			const cleanProvider = String(provider).trim();
			if (!cleanId || !cleanProvider) continue;
			const key = toModelKey(cleanProvider, cleanId);
			if (!seen.has(key)) {
				seen.add(key);
				const thinking =
					o.thinking === undefined
						? undefined
						: extractThinkingLevels(o.thinking);
				out.push({
					provider: cleanProvider,
					id: cleanId,
					name: (typeof o.name === "string" && o.name.trim()) || key,
					thinking,
				});
			}
		}
	}
	return out;
}

export function resolveCurrentModel(
	modelState: unknown,
	availableModels?: ModelOption[] | null,
): CurrentModelSelection {
	if (!modelState) {
		return { value: "", label: "模型…" };
	}

	if (typeof modelState === "string") {
		const trimmed = modelState.trim();
		if (!trimmed) {
			return { value: "", label: "模型…" };
		}
		const slashIndex = trimmed.indexOf("/");
		if (slashIndex > 0) {
			const provider = trimmed.slice(0, slashIndex).trim();
			const id = trimmed.slice(slashIndex + 1).trim();
			const key = toModelKey(provider, id);
			const matched = availableModels?.find(
				(m) => m.provider === provider && m.id === id,
			);
			return {
				value: key,
				provider,
				id,
				label: matched?.name ?? key,
			};
		}
		// id only (no slash)
		const id = trimmed;
		const matched = availableModels?.find((m) => m.id === id);
		if (matched) {
			const key = toModelKey(matched.provider, matched.id);
			return {
				value: key,
				provider: matched.provider,
				id: matched.id,
				label: matched.name,
			};
		}
		return {
			value: id,
			id,
			label: id,
		};
	}

	if (typeof modelState === "object") {
		const o = modelState as Record<string, unknown>;
		const rawId = (o.id ?? o.modelId ?? o.model) as string | undefined;
		const rawProvider = (o.provider ?? o.providerId) as string | undefined;
		const id = typeof rawId === "string" ? rawId.trim() : undefined;
		let provider = typeof rawProvider === "string" ? rawProvider.trim() : undefined;
		const rawName = typeof o.name === "string" ? o.name.trim() : undefined;

		if (!id && !provider) {
			return { value: "", label: "模型…" };
		}

		// If provider missing, resolve from availableModels by id
		if (id && !provider && availableModels) {
			const matched = availableModels.find((m) => m.id === id);
			if (matched) {
				provider = matched.provider;
			}
		}

		// If id contains a slash (e.g. "anthropic/claude-sonnet-4-5")
		if (id && !provider && id.includes("/")) {
			const slashIndex = id.indexOf("/");
			provider = id.slice(0, slashIndex).trim();
			const cleanId = id.slice(slashIndex + 1).trim();
			const key = toModelKey(provider, cleanId);
			const matched = availableModels?.find(
				(m) => m.provider === provider && m.id === cleanId,
			);
			return {
				value: key,
				provider,
				id: cleanId,
				label: rawName || matched?.name || key,
			};
		}

		if (provider && id) {
			const key = toModelKey(provider, id);
			const matched = availableModels?.find(
				(m) => m.provider === provider && m.id === id,
			);
			return {
				value: key,
				provider,
				id,
				label: rawName || matched?.name || key,
			};
		}

		if (id) {
			return {
				value: id,
				id,
				label: rawName || id,
			};
		}

		if (provider) {
			return {
				value: provider,
				provider,
				label: rawName || provider,
			};
		}
	}

	return { value: "", label: "模型…" };
}

export function buildSetModelPayload(
	selectedValue: string,
	availableModels?: ModelOption[] | null,
): SetModelPayload | null {
	const trimmed = selectedValue.trim();
	if (!trimmed) return null;

	const matched = availableModels?.find(
		(x) => toModelKey(x.provider, x.id) === trimmed,
	);
	if (matched) {
		return {
			type: "set_model",
			provider: matched.provider,
			modelId: matched.id,
		};
	}

	const slashIndex = trimmed.indexOf("/");
	if (slashIndex > 0) {
		const provider = trimmed.slice(0, slashIndex).trim();
		const modelId = trimmed.slice(slashIndex + 1).trim();
		if (provider && modelId) {
			return {
				type: "set_model",
				provider,
				modelId,
			};
		}
	}

	return null;
}
