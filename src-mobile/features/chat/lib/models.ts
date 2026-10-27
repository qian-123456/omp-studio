export interface ModelOpt {
	provider: string;
	id: string;
	name?: string;
	thinking?: string[];
	contextWindow?: number;
}

export interface ModelFacts {
	current: { provider?: string; id: string } | null;
	thinkingLevel: string | null;
	liveThinking: string[];
}

export interface ModelsResponse extends ModelFacts {
	models: ModelOpt[];
	live?: boolean;
}

export const THINK_DESC: Record<string, string> = {
	auto: "跟随模型的默认力度",
	off: "不启用深度推理思考",
	minimal: "轻度推理，适合简单问答",
	low: "较少推理步骤，响应较快",
	medium: "均衡推理与响应速度",
	high: "完整多步推理，适合复杂分析",
	xhigh: "高强度推理，适合复杂推演",
	max: "无限制深度推理，耗费最多预算",
};

export interface ProviderGroup {
	provider: string;
	models: ModelOpt[];
}

/** Providers sorted alphabetically; models keep catalog order inside each provider. */
export function groupByProvider(models: ModelOpt[]): ProviderGroup[] {
	const by = new Map<string, ModelOpt[]>();
	for (const m of models) {
		const list = by.get(m.provider);
		if (list) list.push(m);
		else by.set(m.provider, [m]);
	}
	return [...by.keys()]
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		.map((provider) => ({ provider, models: by.get(provider) ?? [] }));
}

/** Every whitespace-separated token must match provider, id or name (case-insensitive). */
export function filterModels(models: ModelOpt[], query: string): ModelOpt[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return models;
	return models.filter((m) => {
		const hay = `${m.provider}/${m.id} ${m.name ?? ""}`.toLowerCase();
		return terms.every((t) => hay.includes(t));
	});
}

export function isCurrentModel(m: ModelOpt, current: ModelFacts["current"]): boolean {
	return !!current && current.id === m.id && (!current.provider || current.provider === m.provider);
}

export function currentModelOpt(models: ModelOpt[], current: ModelFacts["current"]): ModelOpt | null {
	if (!current) return null;
	return models.find((m) => isCurrentModel(m, current)) ?? models.find((m) => m.id === current.id) ?? null;
}

/** Live levels else catalog; `auto` first, `off` last, current level kept even if unlisted. */
export function resolveThinkingLevels(
	opt: ModelOpt | null | undefined,
	liveThinking: string[] | null | undefined,
	currentLevel: string | null | undefined,
): string[] {
	const sup = liveThinking && liveThinking.length ? liveThinking : (opt?.thinking ?? []);
	const cur = currentLevel || "";
	if (!sup.length) return cur ? [cur] : [];
	const levels = ["auto", ...sup.filter((l) => l !== "auto" && l !== "off")];
	levels.push("off");
	if (cur && !levels.includes(cur)) levels.push(cur);
	return levels;
}

/** Display name: the catalog name when it adds information, else the id. */
export function modelLabel(m: ModelOpt): string {
	return m.name && m.name !== m.id && m.name !== `${m.provider}/${m.id}` ? m.name : m.id;
}

/** "provider/model" -> "model" (last path segment is the model). */
export function shortModel(text: string): string {
	const i = text.lastIndexOf("/");
	return i >= 0 ? text.slice(i + 1) : text;
}
