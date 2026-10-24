/** Settings navigation: grouped nav entries and the ranked search index. */
import {
	Bell,
	BookOpen,
	Bot,
	Brain,
	Cpu,
	FileCode,
	FileText,
	Globe,
	Hammer,
	Info,
	Keyboard,
	KeyRound,
	Layers,
	Library,
	Network,
	Palette,
	Puzzle,
	Route,
	Ruler,
	Server,
	Shield,
	HardDrive,
	Sliders,
	Smartphone,
	Sparkles,
	Stethoscope,
	Terminal,
	Users,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import { t as translate, type Locale } from "../../lib/i18n";
import { useLanguageStore } from "../../stores/language";
import type { OmpConfigEntry } from "../../lib/contracts";
import { FIELD_REGISTRY, fieldDescription, fieldLabel } from "./fieldRegistry";
import { BUILTIN_ROLES, asRecord, customRoles } from "./modelRoles";
import { ompConfigDescription, ompConfigTitle } from "./ompConfigMeta";
import { isDesktopRelevant, ompSearchTerms, ompSectionFor } from "./ompPlacement";

export interface NavItem {
	id: string;
	icon: LucideIcon;
}

export interface NavGroup {
	id: string;
	items: NavItem[];
}

/** Information architecture: grouped by what the user wants to change. */
export const NAV_GROUPS: NavGroup[] = [
	{
		id: "general",
		items: [
			{ id: "general", icon: Sliders },
			{ id: "shortcuts", icon: Keyboard },
			{ id: "storage", icon: HardDrive },
			{ id: "appearance", icon: Palette },
			{ id: "notifications", icon: Bell },
			{ id: "privacy", icon: Shield },
		],
	},
	{
		id: "models",
		items: [
			{ id: "providers", icon: KeyRound },
			{ id: "omp-roles", icon: Users },
			{ id: "thinking", icon: Brain },
			{ id: "helper-models", icon: Cpu },
			{ id: "model-fallback", icon: Route },
			{ id: "context-window", icon: Ruler },
		],
	},
	{
		id: "sessions",
		items: [
			{ id: "sessions", icon: Bot },
			{ id: "inbox", icon: Sparkles },
			{ id: "doctor", icon: Stethoscope },
			{ id: "agents-md", icon: FileText },
			{ id: "prompt-composition", icon: Layers },
		],
	},
	{
		id: "agentCapabilities",
		items: [
			{ id: "tools", icon: Hammer },
			{ id: "files", icon: FileCode },
			{ id: "shell", icon: Terminal },
			{ id: "subagents", icon: Network },
			{ id: "memory", icon: Library },
			{ id: "skills", icon: BookOpen },
		],
	},
	{
		id: "connections",
		items: [
			{ id: "mobile", icon: Smartphone },
			{ id: "mcp", icon: Server },
			{ id: "plugins", icon: Puzzle },
			{ id: "web", icon: Globe },
		],
	},
	{
		id: "advanced",
		items: [{ id: "advanced", icon: Wrench }],
	},
	{
		id: "help",
		items: [
			{ id: "guide", icon: BookOpen },
			{ id: "about", icon: Info },
		],
	},
];

const NAV_ITEMS: ReadonlyMap<string, NavItem> = new Map(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i]));

type Translate = (key: string) => string;

const GROUP_KEY_BY_ID: Record<string, string> = {
	general: "generalGroup",
	models: "modelsGroup",
	sessions: "sessionsGroup",
	agentCapabilities: "agentCapabilitiesGroup",
	connections: "connectionsGroup",
	advanced: "advancedGroup",
	help: "helpGroup",
};

/** Nav item id → message key under `settings.nav` (defaults to the id itself). */
const ITEM_KEYS: Record<string, string> = {
	"omp-roles": "models",
	"helper-models": "helperModels",
	"model-fallback": "modelFallback",
	"context-window": "contextWindow",
	"agents-md": "agentsMd",
	"prompt-composition": "promptComposition",
};

const itemMessageKey = (item: Pick<NavItem, "id">) => `settings.nav.${ITEM_KEYS[item.id] ?? item.id}`;

/** Localized group title. */
export function navGroupTitle(t: Translate, group: Pick<NavGroup, "id">): string {
	return t(`settings.nav.${GROUP_KEY_BY_ID[group.id]}`);
}

/** Localized nav label for an item. */
export function navItemLabel(t: Translate, item: Pick<NavItem, "id">): string {
	return t(itemMessageKey(item));
}

/** Nav entry for a section id. */
export function navItem(id: string): NavItem | undefined {
	return NAV_ITEMS.get(id);
}

// ── Search ───────────────────────────────────────────────────────────

interface IndexedField {
	/** Readable setting name shown as the nav hint (null for pure keyword bundles). */
	name: string | null;
	/** Lowercased: title/label hit (strongest). */
	top: string[];
	/** Lowercased: keyword / English label / key hit. */
	mid: string[];
	/** Lowercased: description hit (weakest). */
	low: string[];
}

export interface SectionSearchResult {
	/** 0 = no match; higher ranks first. */
	score: number;
	/** Up to two readable setting names that matched (never raw keys). */
	names: string[];
}

export type SearchIndex = Map<string, IndexedField[]>;

const SCORE_LABEL = 100;
const SCORE_TOP = 90;
const SCORE_MID = 60;
const SCORE_LOW = 30;

/** Keys edited by dedicated editors (not rendered by generic omp rows) and the page that hosts them. */
const EDITOR_KEY_PAGES: Record<string, string> = {
	modelRoles: "omp-roles",
	"task.agentModelOverrides": "omp-roles",
	"retry.fallbackChains": "model-fallback",
	"retry.modelFallback": "model-fallback",
	"retry.fallbackOn": "model-fallback",
	"retry.fallbackRevertPolicy": "model-fallback",
	"retry.usageAwareFallback": "model-fallback",
	"retry.usageReservePct": "model-fallback",
	"retry.usageReservePolicy": "model-fallback",
	cycleOrder: "model-fallback",
	modelRoleStorage: "model-fallback",
	extendedContext: "context-window",
};

function editorPageOf(key: string): string | null {
	const exact = EDITOR_KEY_PAGES[key];
	if (exact) return exact;
	return key.startsWith("compaction.") || key.startsWith("contextPromotion.") ? "context-window" : null;
}

const lower = (terms: readonly (string | undefined | null)[]) =>
	terms.filter((t): t is string => typeof t === "string" && t.length > 0).map((t) => t.toLowerCase());

const CONTEXT_WINDOW_SEARCH_TERMS = [
	"context window",
	"contextWindow",
	"上下文窗口",
	"窗口",
	"模型上下文",
	"规则",
	"压缩",
	"自动压缩",
	"compaction",
	"阈值",
	"扩展上下文",
	"上下文提升",
	"models.yml",
];

const EXTRA_TERMS: Record<string, string[]> = {
	"context-window": CONTEXT_WINDOW_SEARCH_TERMS,
	providers: [
		"API", "密钥", "key", "provider", "anthropic", "openai", "凭证", "oauth", "keychain", "供应商",
		"quota", "额度", "订阅", "subscription", "用量", "限额", "速率", "rate limit", "claude pro", "copilot", "重置",
	],
	appearance: [
		"请求统计", "token", "tokens", "速度", "首字", "首字延迟", "缓存", "费用", "耗时", "总耗时",
		"思考", "预览", "思考预览", "ttft", "tps",
	],
	about: [
		"关于", "版本", "更新", "升级", "自动更新", "会话切换", "旧版本", "立即切换", "重新检查", "version", "update",
		"upgrade", "auto update", "about", "omp update", "检查更新", "检查间隔", "check interval",
	],
	guide: ["使用教程", "使用说明", "产品说明", "帮助", "教程", "文档", "指南", "手册", "help", "guide", "docs", "manual", "tutorial", "工作树", "子代理"],
	shortcuts: ["快捷键", "shortcut", "shortcuts", "热键", "键盘", "keyboard", "hotkey", "按键", "组合键", "cmd", "command", "ctrl", "⌘", "快捷", "绑定", "冲突"],
	privacy: ["隐私", "隐私库", "privacy", "secret", "占位符", "placeholder", "密码", "脱敏", "默认显示真实值"],
	"model-fallback": ["fallback", "回退", "回退链", "切换顺序", "保存位置", "/model", "备用模型"],
};

/** Build the per-page search index (call once per omp entry list). */
export function buildSearchIndex(ompEntries: readonly OmpConfigEntry[], locale?: Locale): SearchIndex {
	const index: SearchIndex = new Map();
	const add = (page: string, field: IndexedField) => {
		const list = index.get(page);
		if (list) list.push(field);
		else index.set(page, [field]);
	};

	for (const f of FIELD_REGISTRY) {
		const label = fieldLabel(f, locale);
		const desc = fieldDescription(f, locale);
		add(f.sectionId, {
			name: label,
			top: lower([label, fieldLabel(f, "zh-CN"), fieldLabel(f, "en-US")]),
			mid: lower(f.keywords),
			low: lower([desc, fieldDescription(f, "zh-CN"), fieldDescription(f, "en-US")]),
		});
	}

	for (const e of ompEntries) {
		const editorPage = editorPageOf(e.key);
		if (!editorPage && !isDesktopRelevant(e.key)) continue;
		const title = ompConfigTitle(e.key, locale);
		const titleZh = ompConfigTitle(e.key, "zh-CN");
		const titleEn = ompConfigTitle(e.key, "en-US");
		const desc = ompConfigDescription(e.key, e.description, locale);
		const mid = ompSearchTerms(e.key, locale).filter((t) => t !== title && t !== desc);
		add(editorPage ?? ompSectionFor(e.key).page, {
			name: title,
			top: lower([title, titleZh, titleEn]),
			mid: lower(mid),
			low: lower([desc]),
		});
	}

	const roles = customRoles(asRecord(ompEntries.find((e) => e.key === "modelRoles")?.value));
	add("omp-roles", {
		name: null,
		top: [],
		mid: lower([
			...BUILTIN_ROLES.flatMap((r) => [r.id, r.zhLabel, r.description]),
			...roles,
			"modelroles", "角色", "代理", "子代理", "agent", "task", "点名", "批量替换", "替换模型", "批量替换模型", "批量改模型", "换模型",
		]),
		low: [],
	});
	for (const [page, terms] of Object.entries(EXTRA_TERMS)) {
		add(page, { name: null, top: [], mid: lower(terms), low: [] });
	}
	if (roles.length > 0 || BUILTIN_ROLES.length > 0) {
		add("model-fallback", { name: null, top: [], mid: lower([...BUILTIN_ROLES.flatMap((r) => [r.id, r.zhLabel]), ...roles]), low: [] });
	}
	return index;
}

const NAV_LOCALES = (): Locale[] => [...new Set<Locale>([useLanguageStore.getState().locale, "zh-CN", "en-US"])];

/** Score one nav page for a lowercased query; names are readable matched settings. */
export function searchSection(index: SearchIndex, item: NavItem, q: string): SectionSearchResult {
	// The page label matches in the active locale and both source languages.
	if (NAV_LOCALES().some((l) => translate(itemMessageKey(item), undefined, l).toLowerCase().includes(q))) {
		return { score: SCORE_LABEL, names: [] };
	}
	let best = 0;
	const hits: { score: number; name: string }[] = [];
	for (const f of index.get(item.id) ?? []) {
		const score = f.top.some((t) => t.includes(q))
			? SCORE_TOP
			: f.mid.some((t) => t.includes(q))
				? SCORE_MID
				: f.low.some((t) => t.includes(q))
					? SCORE_LOW
					: 0;
		if (score === 0) continue;
		best = Math.max(best, score);
		if (f.name) hits.push({ score, name: f.name });
	}
	hits.sort((a, b) => b.score - a.score);
	const names = [...new Set(hits.map((h) => h.name))].slice(0, 2);
	return { score: best, names };
}
