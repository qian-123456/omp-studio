/** Settings navigation: grouped nav entries and the search index per section. */
import {
	Bell,
	Bot,
	Brain,
	FileText,
	Globe,
	Hammer,
	Info,
	KeyRound,
	Library,
	ListTree,
	Network,
	Palette,
	Puzzle,
	Ruler,
	RefreshCw,
	Route,
	Server,
	Settings2,
	Shield,
	Sliders,
	Smartphone,
	Sparkles,
	Stethoscope,
	Users,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import type { OmpConfigEntry } from "../../lib/contracts";
import { registryKeywordsForSection } from "./fieldRegistry";
import { BUILTIN_ROLES, asRecord, customRoles } from "./modelRoles";
import { ompConfigDescription, ompConfigTitle } from "./ompConfigMeta";
import { isDesktopRelevant, ompDesktopCategoryFor } from "./ompDesktopCategories";

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
	"extendedContext",
	"上下文提升",
	"contextPromotion",
	"models.yml",
];

export interface NavItem {
	id: string;
	label: string;
	icon: LucideIcon;
}

export interface NavGroup {
	title: string;
	items: NavItem[];
}

/** Information architecture: grouped navigation ordered by frequency of use. */
export const NAV_GROUPS: NavGroup[] = [
	{
		title: "常规",
		items: [
			{ id: "general", label: "通用", icon: Sliders },
			{ id: "appearance", label: "外观", icon: Palette },
			{ id: "notifications", label: "通知", icon: Bell },
			{ id: "privacy", label: "隐私库", icon: Shield },
			{ id: "about", label: "版本与更新", icon: Info },
		],
	},
	{
		title: "模型",
		items: [
			{ id: "providers", label: "模型与供应商", icon: KeyRound },
			{ id: "context-window", label: "上下文窗口", icon: Ruler },
			{ id: "omp-roles", label: "模型角色", icon: Users },
			{ id: "model-fallback", label: "回退链与切换", icon: Route },
			{ id: "omp-model", label: "模型与目录", icon: ListTree },
			{ id: "omp-thinking", label: "思考与采样", icon: Brain },
			{ id: "omp-retry", label: "重试与回退", icon: RefreshCw },
		],
	},
	{
		title: "Agent",
		items: [
			{ id: "sessions", label: "会话", icon: Bot },
			{ id: "inbox", label: "收件箱", icon: Sparkles },
			{ id: "doctor", label: "AI 会诊", icon: Stethoscope },
			{ id: "omp-context", label: "记忆与对话", icon: Library },
			{ id: "agents-md", label: "规则文件 AGENTS.md", icon: FileText },
			{ id: "omp-tools", label: "工具与审批", icon: Hammer },
			{ id: "omp-tasks", label: "任务与子代理", icon: Network },
		],
	},
	{
		title: "连接",
		items: [
			{ id: "mobile", label: "手机访问", icon: Smartphone },
			{ id: "omp-providers", label: "网络与扩展", icon: Globe },
			{ id: "mcp", label: "MCP 服务器", icon: Server },
			{ id: "plugins", label: "插件", icon: Puzzle },
		],
	},
	{
		title: "高级",
		items: [
			{ id: "advanced", label: "高级", icon: Wrench },
			{ id: "omp-advanced", label: "其他 OMP 配置", icon: Settings2 },
		],
	},
];

/** OMP config category rendered by OmpConfigSection for a nav id, or null. */
export function ompCategoryOf(sectionId: string): string | null {
	return sectionId.startsWith("omp-") && sectionId !== "omp-roles" ? sectionId.slice("omp-".length) : null;
}

/** Nav id for an OMP config category id ("tools" → "omp-tools"; already-prefixed ids pass through). */
export function ompSectionId(category: string): string {
	return category.startsWith("omp-") ? category : `omp-${category}`;
}

const ompEntryTerms = (e: OmpConfigEntry) => [e.key, ompConfigTitle(e.key), ompConfigDescription(e.key, e.description)];

/** Searchable terms for a nav section (registry keywords, OMP keys, roles…). */
export function sectionSearchTerms(id: string, ompEntries: OmpConfigEntry[]): string[] {
	if (id === "omp-roles") {
		const cust = customRoles(asRecord(ompEntries.find((e) => e.key === "modelRoles")?.value));
		return [
			...BUILTIN_ROLES.flatMap((r) => [r.id, r.zhLabel, r.description]),
			...cust,
			"modelroles",
			"角色",
			"代理",
			"子代理",
			"agent",
			"task",
			"点名",
			"agentModelOverrides",
			"批量替换",
			"替换模型",
			"批量替换模型",
			"批量改模型",
			"换模型",
		];
	}
	if (id === "model-fallback") {
		const cust = customRoles(asRecord(ompEntries.find((e) => e.key === "modelRoles")?.value));
		return [
			...BUILTIN_ROLES.flatMap((r) => [r.id, r.zhLabel]),
			...cust,
			"fallback",
			"fallbackChains",
			"回退",
			"回退链",
			"retry.fallbackChains",
			"cycleOrder",
			"切换顺序",
			"modelRoleStorage",
			"保存位置",
			"/model",
			...registryKeywordsForSection(id),
		];
	}
	const cat = ompCategoryOf(id);
	if (cat) {
		return ompEntries.filter((e) => isDesktopRelevant(e.key) && ompDesktopCategoryFor(e.key).id === cat).flatMap(ompEntryTerms);
	}
	if (id === "mcp") {
		// MCP runtime keys (mcp.*) render inside this section too.
		return [
			...registryKeywordsForSection(id),
			...ompEntries.filter((e) => e.key.startsWith("mcp.")).flatMap(ompEntryTerms),
		];
	}
	if (id === "context-window") {
		return [
			...CONTEXT_WINDOW_SEARCH_TERMS,
			...ompEntries
				.filter((e) => e.key === "extendedContext" || e.key.startsWith("compaction.") || e.key.startsWith("contextPromotion."))
				.flatMap(ompEntryTerms),
		];
	}
	if (id === "quota" || id === "providers") {
		return [
			"API", "密钥", "key", "provider", "anthropic", "openai", "凭证", "oauth", "keychain", "供应商",
			"quota", "额度", "订阅", "subscription", "用量", "限额", "速率", "rate limit", "claude pro", "copilot", "重置",
		];
	}
	if (id === "appearance") {
		return [
			...registryKeywordsForSection(id),
			"请求统计", "token", "tokens", "速度", "首字", "首字延迟", "缓存", "费用", "耗时", "总耗时",
			"思考", "预览", "思考预览", "ttft", "tps",
		];
	}
	if (id === "about") {
		return ["关于", "版本", "更新", "升级", "自动更新", "会话切换", "旧版本", "立即切换", "重新检查", "version", "update", "upgrade", "auto update", "about", "omp update", "检查更新", "检查间隔", "check interval"];
	}
	if (id === "privacy") {
		return ["隐私", "隐私库", "privacy", "secret", "占位符", "placeholder", "密码", "脱敏", "默认显示真实值"];
	}
	return registryKeywordsForSection(id);
}
