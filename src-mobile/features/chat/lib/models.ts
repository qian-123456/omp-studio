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
	catalogSource?: "cli";
	catalogCompleteness?: "unverified";
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

/** Short Chinese name of a thinking level for the top bar and the level picker. */
export const THINK_LABEL: Record<string, string> = {
	auto: "自动",
	off: "关闭",
	minimal: "极简",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "超高",
	max: "最高",
};

export function thinkLabel(level: string | null | undefined): string {
	const l = level || "auto";
	return THINK_LABEL[l] ?? l;
}

/** Desktop-canonical English thinking level name (High, Low, Medium, X-High, Max, Auto, Off). */
export function desktopThinkingLabel(level: string | null | undefined): string {
	const l = (level || "").trim().toLowerCase();
	switch (l) {
		case "xhigh":
			return "X-High";
		case "max":
			return "Max";
		case "high":
			return "High";
		case "medium":
			return "Medium";
		case "low":
			return "Low";
		case "minimal":
			return "Minimal";
		case "auto":
			return "Auto";
		case "off":
			return "Off";
		default:
			return level ? level.charAt(0).toUpperCase() + level.slice(1) : "Auto";
	}
}

/**
 * Split a settings model reference (`provider/id[:level]`, e.g. `google/gemini-3-flash:high`)
 * into the catalog key and the optional thinking suffix.
 */
export function parseModelRef(ref: string | null | undefined): { provider?: string; id: string; thinking: string | null } | null {
	const raw = (ref ?? "").trim();
	if (!raw) return null;
	const colon = raw.lastIndexOf(":");
	const level = colon > 0 ? raw.slice(colon + 1) : "";
	const known = level in THINK_LABEL;
	const body = known ? raw.slice(0, colon) : raw;
	const slash = body.indexOf("/");
	return slash > 0
		? { provider: body.slice(0, slash), id: body.slice(slash + 1), thinking: known ? level : null }
		: { id: body, thinking: known ? level : null };
}

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

/**
 * Extract clean model identifier from "provider/model" or snapshot names.
 * Drops organization prefix and trailing date/timestamp snapshots (e.g. -20250219).
 */
export function shortModel(text: string): string {
	if (!text) return "";
	const slash = text.lastIndexOf("/");
	let s = slash >= 0 ? text.slice(slash + 1) : text;
	// Strip trailing release/snapshot dates like -20250219 or -2024-08-06
	s = s.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
	return s;
}
