/** Settings navigation: grouped nav entries and the search index per section. */
import {
	Bell,
	Bot,
	Brain,
	FileText,
	Globe,
	Hammer,
	KeyRound,
	Library,
	ListTree,
	Network,
	Palette,
	Puzzle,
	RefreshCw,
	Server,
	Settings2,
	Sliders,
	Smartphone,
	Sparkles,
	Users,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import type { OmpConfigEntry } from "../../lib/contracts";
import { registryKeywordsForSection } from "./fieldRegistry";
import { BUILTIN_ROLES, asRecord, customRoles } from "./modelRoles";
import { ompConfigDescription, ompConfigTitle } from "./ompConfigMeta";
import { ompDesktopCategoryFor } from "./ompDesktopCategories";

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
		],
	},
	{
		title: "模型",
		items: [
			{ id: "providers", label: "API 供应商", icon: KeyRound },
			{ id: "omp-roles", label: "模型角色", icon: Users },
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
			{ id: "omp-context", label: "上下文与记忆", icon: Library },
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
			"fallback",
			"回退",
			"角色",
		];
	}
	const cat = ompCategoryOf(id);
	if (cat) return ompEntries.filter((e) => ompDesktopCategoryFor(e.key).id === cat).flatMap(ompEntryTerms);
	if (id === "mcp") {
		// MCP runtime keys (mcp.*) render inside this section too.
		return [
			...registryKeywordsForSection(id),
			...ompEntries.filter((e) => e.key.startsWith("mcp.")).flatMap(ompEntryTerms),
		];
	}
	if (id === "providers") {
		return ["API", "密钥", "key", "provider", "anthropic", "openai", "凭证", "oauth", "keychain", "供应商"];
	}
	return registryKeywordsForSection(id);
}
