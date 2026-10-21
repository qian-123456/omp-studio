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
import type { OmpConfigEntry } from "../../lib/contracts";
import { FIELD_REGISTRY } from "./fieldRegistry";
import { BUILTIN_ROLES, asRecord, customRoles } from "./modelRoles";
import { ompConfigDescription, ompConfigTitle } from "./ompConfigMeta";
import { isDesktopRelevant, ompSearchTerms, ompSectionFor } from "./ompPlacement";

export interface NavItem {
	id: string;
	label: string;
	icon: LucideIcon;
	/** One-line page description shown under the page title. */
	lead: string;
}

export interface NavGroup {
	title: string;
	items: NavItem[];
}

/** Information architecture: grouped by what the user wants to change. */
export const NAV_GROUPS: NavGroup[] = [
	{
		title: "常规",
		items: [
			{ id: "general", label: "通用", icon: Sliders, lead: "新会话的默认设置、界面开关与快捷键" },
			{ id: "storage", label: "存储空间", icon: HardDrive, lead: "本应用和 omp 占用的磁盘空间，以及可以安全清理的内容" },
			{ id: "appearance", label: "外观", icon: Palette, lead: "主题、字号、界面密度和对话里显示哪些信息" },
			{ id: "notifications", label: "通知", icon: Bell, lead: "什么时候提醒你、怎么提醒，以及免打扰时段" },
			{ id: "privacy", label: "隐私", icon: Shield, lead: "隐私库里的敏感信息如何替换，以及 omp 的密钥脱敏和数据上报" },
			{ id: "about", label: "版本与更新", icon: Info, lead: "本应用和 omp 的版本，检查与安装更新" },
		],
	},
	{
		title: "模型",
		items: [
			{ id: "providers", label: "模型与供应商", icon: KeyRound, lead: "API 密钥、订阅额度，以及启用哪些模型和供应商" },
			{ id: "omp-roles", label: "模型角色", icon: Users, lead: "不同用途（主力、轻量、子代理…）分别用哪个模型" },
			{ id: "thinking", label: "思考与采样", icon: Brain, lead: "思考深度与预算、温度等采样参数、回复风格" },
			{ id: "helper-models", label: "辅助模型", icon: Cpu, lead: "顾问模型、预探、图片识别等会额外调用模型的功能" },
			{ id: "model-fallback", label: "备用模型与重试", icon: Route, lead: "模型出错或额度用完时：自动换备用模型、重试、超时与防死循环" },
			{ id: "context-window", label: "上下文窗口", icon: Ruler, lead: "每个模型的上下文大小，以及什么时候自动压缩对话" },
		],
	},
	{
		title: "会话",
		items: [
			{ id: "sessions", label: "会话", icon: Bot, lead: "会话挂起与摘要、消息排队、计划与目标模式等对话行为" },
			{ id: "inbox", label: "收件箱", icon: Sparkles, lead: "哪些会话进入收件箱、保留多久" },
			{ id: "doctor", label: "会话体检", icon: Stethoscope, lead: "在 Token 用量面板里体检会话，找出绕路、返工和上下文浪费" },
			{ id: "agents-md", label: "规则文件", icon: FileText, lead: "omp 每次对话都会带上的长期规则，以及输出时实时检查的规则" },
			{ id: "prompt-composition", label: "系统提示词构成", icon: Layers, lead: "每次请求的系统提示词由哪些内容组成、各占多少" },
		],
	},
	{
		title: "Agent 能力",
		items: [
			{ id: "tools", label: "工具", icon: Hammer, lead: "AI 能用哪些工具、哪些要先审批、输出多长" },
			{ id: "files", label: "文件读写", icon: FileCode, lead: "AI 读取和编辑文件的方式，以及代码诊断（LSP）" },
			{ id: "shell", label: "命令行", icon: Terminal, lead: "AI 执行 Shell 命令、运行 Python / JS 代码的方式" },
			{ id: "subagents", label: "子代理", icon: Network, lead: "子代理的并发、时长和深度限制，以及隔离运行方式" },
			{ id: "memory", label: "记忆", icon: Library, lead: "AI 跨会话记住什么、存在哪里" },
			{ id: "skills", label: "技能与命令", icon: BookOpen, lead: "从哪些目录加载技能和自定义命令" },
		],
	},
	{
		title: "连接",
		items: [
			{ id: "mobile", label: "手机访问", icon: Smartphone, lead: "用手机查看和回复会话" },
			{ id: "mcp", label: "MCP 服务器", icon: Server, lead: "给 AI 接入外部工具服务（MCP）" },
			{ id: "plugins", label: "插件", icon: Puzzle, lead: "已安装的插件与扩展" },
			{ id: "web", label: "联网搜索", icon: Globe, lead: "AI 联网搜索和抓取网页时用的服务" },
		],
	},
	{
		title: "高级",
		items: [{ id: "advanced", label: "高级", icon: Wrench, lead: "omp 程序位置、数据备份与恢复、问题自动上报" }],
	},
];

const NAV_ITEMS: ReadonlyMap<string, NavItem> = new Map(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i]));

/** Nav entry (label / lead) for a section id. */
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
	privacy: ["隐私", "隐私库", "privacy", "secret", "占位符", "placeholder", "密码", "脱敏", "默认显示真实值"],
	"model-fallback": ["fallback", "回退", "回退链", "切换顺序", "保存位置", "/model", "备用模型"],
};

/** Build the per-page search index (call once per omp entry list). */
export function buildSearchIndex(ompEntries: readonly OmpConfigEntry[]): SearchIndex {
	const index: SearchIndex = new Map();
	const add = (page: string, field: IndexedField) => {
		const list = index.get(page);
		if (list) list.push(field);
		else index.set(page, [field]);
	};

	for (const f of FIELD_REGISTRY) {
		add(f.sectionId, { name: f.label, top: lower([f.label]), mid: lower(f.keywords), low: lower([f.description]) });
	}

	for (const e of ompEntries) {
		const editorPage = editorPageOf(e.key);
		if (!editorPage && !isDesktopRelevant(e.key)) continue;
		const title = ompConfigTitle(e.key);
		const desc = ompConfigDescription(e.key, e.description);
		const mid = ompSearchTerms(e.key).filter((t) => t !== title && t !== desc);
		add(editorPage ?? ompSectionFor(e.key).page, {
			name: title,
			top: lower([title]),
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

/** Score one nav page for a lowercased query; names are readable matched settings. */
export function searchSection(index: SearchIndex, item: NavItem, q: string): SectionSearchResult {
	if (item.label.toLowerCase().includes(q)) return { score: SCORE_LABEL, names: [] };
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
