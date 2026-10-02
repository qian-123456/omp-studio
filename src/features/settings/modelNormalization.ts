/**
 * Cross-provider model name normalization, Three-Tier context hierarchy
 * (同品牌 / 同档位 / 同模型), and per-model context window updates.
 * Never touches provider-wide defaults.
 */
import type { ModelEntry, ProviderConfig } from "../../lib/contracts";
import type {
	CanonicalModelGroup,
	ContextUpdate,
	ModelFamily,
	ModelSource,
	ModelTierId,
	ResolvedContext,
	ThreeTierConfig,
	TierDefinition,
} from "./modelContextTypes";

// ── Cleaning ─────────────────────────────────────────────────────────

const DATE_SUFFIX =
	/(?:[-_@](?:\d{8}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d{4})|[-_](?:latest)|:(?:free|beta|extended|nitro|thinking|online))$/;

/** Lowercase, drop channel/vendor prefixes (`openai/`, `azure/`…) and date/variant suffixes. */
export function cleanModelId(raw: string): string {
	let s = raw.trim().toLowerCase();
	const slash = s.lastIndexOf("/");
	if (slash >= 0) s = s.slice(slash + 1);
	for (let prev = ""; prev !== s; ) {
		prev = s;
		s = s.replace(DATE_SUFFIX, "");
	}
	return s;
}

/** Fallback cluster key: cleaned id with delimiters collapsed to `-`. */
export function fallbackKey(raw: string): string {
	return cleanModelId(raw)
		.replace(/[\s_.:]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

// ── Canonical rules & Tiers ──────────────────────────────────────────

const D = "[-_ .]*"; // optional delimiter run
const V = "[-_ .]"; // version separator (5.5 / 5-5 / 5_5)

interface CanonicalRule {
	re: RegExp;
	name: (m: RegExpMatchArray) => string;
	family: ModelFamily;
	tier: ModelTierId;
}

export const TIER_NAMES: Record<ModelTierId, string> = {
	"claude-opus": "Claude Opus 旗舰系列",
	"claude-sonnet": "Claude Sonnet 主力系列",
	"claude-haiku": "Claude Haiku 极速系列",
	"gpt-flagship": "GPT 旗舰与推理系列 (o1/o3/Astra)",
	"gpt-balanced": "GPT 主力全能系列 (GPT-4o/5)",
	"gpt-mini": "GPT Mini 轻量系列",
	"gemini-flash": "Gemini Flash 极速长文",
	"gemini-pro": "Gemini Pro 旗舰多模态",
	"deepseek-r1": "DeepSeek R1 深度推理",
	"deepseek-v3": "DeepSeek V3 高效主力",
	"qwen-coder": "通义千问 Qwen 系列",
	other: "其他通用型号",
};

export const PRESET_TIERS: TierDefinition[] = [
	{
		id: "claude-opus",
		name: "Claude Opus 旗舰系列",
		family: "Claude",
		description: "最高智力与长文深度推演",
		defaultContextWindow: 300_000,
	},
	{
		id: "claude-sonnet",
		name: "Claude Sonnet 主力系列",
		family: "Claude",
		description: "日常编程主力与深度思考",
		defaultContextWindow: 250_000,
	},
	{
		id: "claude-haiku",
		name: "Claude Haiku 极速系列",
		family: "Claude",
		description: "高并发轻量快速响应",
		defaultContextWindow: 200_000,
	},
	{
		id: "gpt-flagship",
		name: "GPT 旗舰与深度推理 (o1/o3/Astra)",
		family: "GPT",
		description: "Astra / o1 / o3 深度思考推理",
		defaultContextWindow: 272_000,
	},
	{
		id: "gpt-balanced",
		name: "GPT 主力全能 (GPT-4o/GPT-5)",
		family: "GPT",
		description: "通用生产力旗舰模型",
		defaultContextWindow: 272_000,
	},
	{
		id: "gpt-mini",
		name: "GPT Mini 轻量系列",
		family: "GPT",
		description: "低延迟极速响应",
		defaultContextWindow: 128_000,
	},
	{
		id: "gemini-flash",
		name: "Gemini Flash 极速长文",
		family: "Gemini",
		description: "超长上下文极速处理",
		defaultContextWindow: 500_000,
	},
	{
		id: "gemini-pro",
		name: "Gemini Pro 旗舰多模态",
		family: "Gemini",
		description: "百万 Token 深度多模态大模型",
		defaultContextWindow: 1_000_000,
	},
	{
		id: "deepseek-r1",
		name: "DeepSeek R1 深度推理",
		family: "DeepSeek",
		description: "开源强化学习深度推理",
		defaultContextWindow: 128_000,
	},
	{
		id: "deepseek-v3",
		name: "DeepSeek V3 高效主力",
		family: "DeepSeek",
		description: "高性价比通用主力",
		defaultContextWindow: 128_000,
	},
];

export const PRESET_BRANDS: { family: ModelFamily; name: string; defaultContextWindow: number }[] = [
	{ family: "Claude", name: "Anthropic Claude", defaultContextWindow: 200_000 },
	{ family: "GPT", name: "OpenAI GPT / o 系列", defaultContextWindow: 272_000 },
	{ family: "Gemini", name: "Google Gemini", defaultContextWindow: 500_000 },
	{ family: "DeepSeek", name: "DeepSeek 深度求索", defaultContextWindow: 128_000 },
	{ family: "Qwen", name: "阿里通义千问 Qwen", defaultContextWindow: 128_000 },
];

const CANONICAL_RULES: CanonicalRule[] = [
	{
		re: new RegExp(`^(?:claude${D})?(?:opus|oops)?${D}5${V}5$`),
		name: () => "Claude Opus 5.5",
		family: "Claude",
		tier: "claude-opus",
	},
	{
		re: new RegExp(`claude${D}3${V}7${D}sonnet|sonnet${D}3${V}7`),
		name: () => "Claude 3.7 Sonnet",
		family: "Claude",
		tier: "claude-sonnet",
	},
	{
		re: new RegExp(`claude${D}3${V}5${D}sonnet|sonnet${D}3${V}5`),
		name: () => "Claude 3.5 Sonnet",
		family: "Claude",
		tier: "claude-sonnet",
	},
	{
		re: new RegExp(`claude${D}3${V}5${D}haiku|haiku${D}3${V}5`),
		name: () => "Claude 3.5 Haiku",
		family: "Claude",
		tier: "claude-haiku",
	},
	{
		re: new RegExp(`claude${D}3${D}opus|opus${D}3(?![\\d.])`),
		name: () => "Claude 3 Opus",
		family: "Claude",
		tier: "claude-opus",
	},
	{
		re: new RegExp(`opus${D}([45])(?![\\d.])`),
		name: (m) => `Claude Opus ${m[1]}`,
		family: "Claude",
		tier: "claude-opus",
	},
	{
		re: new RegExp(`gpt${D}6${D}astra|astra${D}6`),
		name: () => "GPT-6 Astra",
		family: "GPT",
		tier: "gpt-flagship",
	},
	{
		re: new RegExp(`gpt${D}4o${D}mini`),
		name: () => "GPT-4o mini",
		family: "GPT",
		tier: "gpt-mini",
	},
	{
		re: new RegExp(`gpt${D}4o`),
		name: () => "GPT-4o",
		family: "GPT",
		tier: "gpt-balanced",
	},
	{
		re: new RegExp(`gpt${D}5(?![\\d.])`),
		name: () => "GPT-5 系列",
		family: "GPT",
		tier: "gpt-balanced",
	},
	{
		re: /^o1(?:[-_ .]mini)/,
		name: () => "OpenAI o1-mini",
		family: "GPT",
		tier: "gpt-mini",
	},
	{
		re: /^o1(?:[-_ .]|$)/,
		name: () => "OpenAI o1",
		family: "GPT",
		tier: "gpt-flagship",
	},
	{
		re: new RegExp(`^o3${D}mini`),
		name: () => "OpenAI o3-mini",
		family: "GPT",
		tier: "gpt-mini",
	},
	{
		re: /^o3(?:[-_ .]|$)/,
		name: () => "OpenAI o3",
		family: "GPT",
		tier: "gpt-flagship",
	},
	{
		re: new RegExp(`gemini${D}3${V}8${D}flash|gemini${D}flash${D}3${V}8`),
		name: () => "Gemini 3.8 Flash",
		family: "Gemini",
		tier: "gemini-flash",
	},
	{
		re: new RegExp(`gemini${D}(\\d)${V}(\\d)${D}(pro|flash)`),
		name: (m) => `Gemini ${m[1]}.${m[2]} ${m[3] === "pro" ? "Pro" : "Flash"}`,
		family: "Gemini",
		tier: "gemini-flash",
	},
	{
		re: new RegExp(`deepseek${D}(?:v3|chat)`),
		name: () => "DeepSeek V3 / Chat",
		family: "DeepSeek",
		tier: "deepseek-v3",
	},
	{
		re: new RegExp(`deepseek${D}(?:r1|reasoner)`),
		name: () => "DeepSeek R1",
		family: "DeepSeek",
		tier: "deepseek-r1",
	},
	{
		re: new RegExp(`qwen${D}(?:coder|2\\.5-coder)`),
		name: () => "Qwen 2.5 Coder",
		family: "Qwen",
		tier: "qwen-coder",
	},
];

function familyOf(cleaned: string): ModelFamily {
	if (/claude|opus|sonnet|haiku/.test(cleaned)) return "Claude";
	if (/gpt|^o\d/.test(cleaned)) return "GPT";
	if (/gemini/.test(cleaned)) return "Gemini";
	if (/deepseek/.test(cleaned)) return "DeepSeek";
	if (/qwen|qwq/.test(cleaned)) return "Qwen";
	return "其他";
}

function fallbackTierOf(cleaned: string, family: ModelFamily): ModelTierId {
	if (family === "Claude") {
		if (/opus/.test(cleaned)) return "claude-opus";
		if (/sonnet/.test(cleaned)) return "claude-sonnet";
		if (/haiku/.test(cleaned)) return "claude-haiku";
	}
	if (family === "GPT") {
		if (/mini/.test(cleaned)) return "gpt-mini";
		if (/o\d|astra/.test(cleaned)) return "gpt-flagship";
		if (/gpt/.test(cleaned)) return "gpt-balanced";
	}
	if (family === "Gemini") {
		if (/flash/.test(cleaned)) return "gemini-flash";
		if (/pro/.test(cleaned)) return "gemini-pro";
	}
	if (family === "DeepSeek") {
		if (/r1|reasoner/.test(cleaned)) return "deepseek-r1";
		return "deepseek-v3";
	}
	if (family === "Qwen") {
		return "qwen-coder";
	}
	return "other";
}

/** Canonical identity for a raw model id: display name, family, tier, and cluster key. */
export function normalizeModelName(raw: string): {
	key: string;
	name: string;
	family: ModelFamily;
	tier: ModelTierId;
	tierName: string;
} {
	const cleaned = cleanModelId(raw);
	for (const rule of CANONICAL_RULES) {
		const m = cleaned.match(rule.re);
		if (m) {
			const name = rule.name(m);
			let tier = rule.tier;
			if (rule.re.source.includes("gemini") && rule.re.source.includes("pro")) {
				tier = m[3] === "pro" ? "gemini-pro" : "gemini-flash";
			}
			return {
				key: name.toLowerCase(),
				name,
				family: rule.family,
				tier,
				tierName: TIER_NAMES[tier] ?? "其他档位",
			};
		}
	}
	const key = fallbackKey(raw);
	const family = familyOf(cleaned);
	const tier = fallbackTierOf(cleaned, family);
	return {
		key,
		name: key,
		family,
		tier,
		tierName: TIER_NAMES[tier] ?? "其他档位",
	};
}

// ── Extraction / grouping ────────────────────────────────────────────

const entryId = (e: ModelEntry) => (typeof e === "string" ? e : e.id);
const entryCtx = (e: ModelEntry) => (typeof e === "string" ? null : (e.contextWindow ?? null));

/** Flatten every configured model across providers. */
export function extractModelSources(providers: ProviderConfig[]): ModelSource[] {
	return providers.flatMap((p) =>
		p.models.map((e) => ({
			providerId: p.id,
			providerName: p.name,
			modelId: entryId(e),
			contextWindow: entryCtx(e),
		})),
	);
}

/** Cluster sources by canonical model, sorted by family then name. */
export function groupModels(providers: ProviderConfig[]): CanonicalModelGroup[] {
	const map = new Map<string, CanonicalModelGroup>();
	for (const s of extractModelSources(providers)) {
		const n = normalizeModelName(s.modelId);
		let g = map.get(n.key);
		if (!g) {
			g = {
				key: n.key,
				name: n.name,
				family: n.family,
				tier: n.tier,
				tierName: n.tierName,
				sources: [],
				unified: false,
			};
			map.set(n.key, g);
		}
		g.sources.push(s);
	}
	const groups = [...map.values()];
	for (const g of groups) {
		const first = g.sources[0]?.contextWindow ?? null;
		g.unified = first != null && g.sources.every((s) => s.contextWindow === first);
	}
	return groups.sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
}

// ── Primary vs Secondary Model Filter ────────────────────────────────

export const MAINSTREAM_MODEL_KEYS = new Set([
	"claude opus 5.5",
	"claude opus 5",
	"claude opus 4",
	"claude 3.7 sonnet",
	"claude 3.5 sonnet",
	"claude 3.5 haiku",
	"claude 3 opus",
	"gpt-6 astra",
	"gpt-5 系列",
	"gpt-4o",
	"gpt-4o mini",
	"openai o1",
	"openai o3",
	"openai o3-mini",
	"gemini 3.8 flash",
	"gemini 2.5 pro",
	"gemini 2.5 flash",
	"gemini 1.5 pro",
	"gemini 1.5 flash",
	"deepseek v3 / chat",
	"deepseek r1",
	"qwen 2.5 coder",
]);

/**
 * Distinguishes core / frequently used models from secondary / legacy relay models.
 * Used to keep the default view clean and focused while secondary models
 * automatically inherit brand & tier context limits.
 */
export function isPrimaryModel(
	group: CanonicalModelGroup,
	options?: {
		activeSessionModels?: Set<string>;
		roleModels?: Set<string>;
		hasCustomConfig?: boolean;
	},
): boolean {
	if (options?.hasCustomConfig) return true;
	if (MAINSTREAM_MODEL_KEYS.has(group.key.toLowerCase())) return true;
	if (group.tier !== "other") return true;
	if (options?.activeSessionModels) {
		for (const s of group.sources) {
			if (options.activeSessionModels.has(s.modelId) || options.activeSessionModels.has(group.name)) {
				return true;
			}
		}
	}
	if (options?.roleModels) {
		for (const s of group.sources) {
			if (options.roleModels.has(s.modelId) || options.roleModels.has(group.name)) {
				return true;
			}
		}
	}
	if (group.sources.some((s) => s.contextWindow != null)) return true;
	return false;
}

// ── Context input parsing ────────────────────────────────────────────

/** Parse `300k`, `30万`, `1M`, `1.5m`, `250,000` into a token count; null when invalid. */
export function parseContextInput(input: string): number | null {
	const m = input
		.trim()
		.replace(/[,，_\s]/g, "")
		.match(/^(\d+(?:\.\d+)?)(k|m|万|w)?$/i);
	if (!m) return null;
	const mult = { k: 1e3, m: 1e6, 万: 1e4, w: 1e4 }[(m[2] ?? "").toLowerCase() as "k"] ?? 1;
	const n = Math.round(Number(m[1]) * mult);
	return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Three-Tier Resolution (同品牌 / 同档位 / 同模型) ────────────────

export const THREE_TIER_STORAGE_KEY = "ompws:three-tier-context-config";

export function loadThreeTierConfig(): ThreeTierConfig {
	try {
		const raw = globalThis.localStorage?.getItem(THREE_TIER_STORAGE_KEY);
		if (!raw) return { brands: {}, tiers: {}, models: {} };
		const parsed = JSON.parse(raw);
		return {
			brands: typeof parsed.brands === "object" && parsed.brands ? parsed.brands : {},
			tiers: typeof parsed.tiers === "object" && parsed.tiers ? parsed.tiers : {},
			models: typeof parsed.models === "object" && parsed.models ? parsed.models : {},
		};
	} catch {
		return { brands: {}, tiers: {}, models: {} };
	}
}

export function saveThreeTierConfig(config: ThreeTierConfig): void {
	globalThis.localStorage?.setItem(THREE_TIER_STORAGE_KEY, JSON.stringify(config));
}

/**
 * Resolves context window for a model group across the Three Tiers:
 * Specific Model (同模型) > Tier default (同档位) > Brand default (同品牌) > Existing provider value.
 */
export function resolveGroupContext(
	group: CanonicalModelGroup,
	config: ThreeTierConfig,
): ResolvedContext {
	// 1. Model-level override
	if (config.models[group.key] != null) {
		return {
			value: config.models[group.key],
			source: "model",
			sourceLabel: "同模型独立设置",
		};
	}
	// 2. Tier-level override
	if (group.tier !== "other" && config.tiers[group.tier] != null) {
		return {
			value: config.tiers[group.tier]!,
			source: "tier",
			sourceLabel: `继承档位：${group.tierName}`,
		};
	}
	// 3. Brand-level override
	if (config.brands[group.family] != null) {
		return {
			value: config.brands[group.family]!,
			source: "brand",
			sourceLabel: `继承品牌：${group.family}`,
		};
	}
	// 4. Provider-existing setting
	const existing = group.sources.find((s) => s.contextWindow != null)?.contextWindow;
	if (existing != null) {
		return {
			value: existing,
			source: "provider",
			sourceLabel: "中转站既有设置",
		};
	}
	return {
		value: null,
		source: "none",
		sourceLabel: "未配置（使用默认 32K）",
	};
}

/**
 * Computes context updates across all providers based on the three-tier config.
 * Only targets models where a brand, tier, or model setting has resolved a value.
 */
export function computeThreeTierUpdates(
	_providers: ProviderConfig[],
	groups: CanonicalModelGroup[],
	config: ThreeTierConfig,
	excludedSources: Record<string, true> = {},
): ContextUpdate[] {
	const updates: ContextUpdate[] = [];
	for (const group of groups) {
		const resolved = resolveGroupContext(group, config);
		if (resolved.value == null) continue;
		for (const source of group.sources) {
			const key = `${source.providerId}::${source.modelId}`;
			if (excludedSources[key]) continue;
			if (source.contextWindow !== resolved.value) {
				updates.push({
					providerId: source.providerId,
					modelId: source.modelId,
					contextWindow: resolved.value,
				});
			}
		}
	}
	return updates;
}

// ── Applying updates to ProviderConfig ─────────────────────────────────

/**
 * Apply per-model context updates. Returns only providers that changed.
 * String entries become `ModelSpec`s; `defaultContextWindow` is never touched.
 */
export function applyContextUpdates(providers: ProviderConfig[], updates: ContextUpdate[]): ProviderConfig[] {
	const byProvider = new Map<string, Map<string, number>>();
	for (const u of updates) {
		let m = byProvider.get(u.providerId);
		if (!m) byProvider.set(u.providerId, (m = new Map()));
		m.set(u.modelId, u.contextWindow);
	}
	const changed: ProviderConfig[] = [];
	for (const p of providers) {
		const m = byProvider.get(p.id);
		if (!m) continue;
		let dirty = false;
		const models = p.models.map((e): ModelEntry => {
			const target = m.get(entryId(e));
			if (target == null || entryCtx(e) === target) return e;
			dirty = true;
			return typeof e === "string" ? { id: e, contextWindow: target } : { ...e, contextWindow: target };
		});
		if (dirty) changed.push({ ...p, models });
	}
	return changed;
}
