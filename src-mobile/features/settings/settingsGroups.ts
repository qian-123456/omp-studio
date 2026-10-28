import {
	Bell,
	BookOpen,
	Brain,
	Cpu,
	FileText,
	Gauge,
	Globe,
	Inbox,
	Info,
	KeyRound,
	Layers,
	Library,
	MessagesSquare,
	Network,
	Palette,
	Route,
	Ruler,
	Server,
	Shield,
	SlidersHorizontal,
	Smartphone,
	Sparkles,
	Stethoscope,
	Users,
	Wrench,
	type LucideIcon,
} from "lucide-react";

export type SheetId =
	| "general"
	| "appearance"
	| "notifications"
	| "privacy"
	| "thinking"
	| "helper-models"
	| "sessions"
	| "inbox"
	| "doctor"
	| "agents-md"
	| "prompt-composition"
	| "tools"
	| "subagents"
	| "memory"
	| "skills"
	| "connection"
	| "mcp"
	| "web"
	| "guide"
	| "about";

export type SettingsRoute = "settingsProviders" | "settingsRoles" | "settingsFallbacks" | "settingsContext" | "quota";

export interface SettingsItemDef {
	id: SheetId | "providers" | "roles" | "fallbacks" | "context" | "quota";
	label: string;
	icon: LucideIcon;
	/** Navigates to this route instead of opening a sheet. */
	navigateTo?: SettingsRoute;
}

export interface SettingsGroupDef {
	id: string;
	title: string;
	items: SettingsItemDef[];
}

/** Single-row group above the categories (Gemini puts 用量限额 first). */
export const QUOTA_ITEM: SettingsItemDef = { id: "quota", label: "订阅与配额", icon: Gauge, navigateTo: "quota" };

/** The six desktop categories with their original names (docs/MOBILE_PRD.md §4.7). */
export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
	{
		id: "general",
		title: "常规",
		items: [
			{ id: "general", label: "通用", icon: SlidersHorizontal },
			{ id: "appearance", label: "外观", icon: Palette },
			{ id: "notifications", label: "通知", icon: Bell },
			{ id: "privacy", label: "隐私", icon: Shield },
		],
	},
	{
		id: "models",
		title: "模型",
		items: [
			{ id: "providers", label: "模型与供应商", icon: KeyRound, navigateTo: "settingsProviders" },
			{ id: "roles", label: "模型角色", icon: Users, navigateTo: "settingsRoles" },
			{ id: "thinking", label: "思考与采样", icon: Brain },
			{ id: "helper-models", label: "辅助模型", icon: Cpu },
			{ id: "fallbacks", label: "备用模型与重试", icon: Route, navigateTo: "settingsFallbacks" },
			{ id: "context", label: "上下文窗口", icon: Ruler, navigateTo: "settingsContext" },
		],
	},
	{
		id: "sessions",
		title: "会话",
		items: [
			{ id: "sessions", label: "会话", icon: MessagesSquare },
			{ id: "inbox", label: "收件箱", icon: Inbox },
			{ id: "doctor", label: "会话体检", icon: Stethoscope },
			{ id: "agents-md", label: "规则文件", icon: FileText },
			{ id: "prompt-composition", label: "系统提示词", icon: Layers },
		],
	},
	{
		id: "agentCapabilities",
		title: "Agent 能力",
		items: [
			{ id: "tools", label: "工具", icon: Wrench },
			{ id: "subagents", label: "子代理", icon: Network },
			{ id: "memory", label: "记忆", icon: Library },
			{ id: "skills", label: "技能与命令", icon: Sparkles },
		],
	},
	{
		id: "connections",
		title: "连接",
		items: [
			{ id: "connection", label: "连接与设备", icon: Smartphone },
			{ id: "mcp", label: "MCP 服务器", icon: Server },
			{ id: "web", label: "联网搜索", icon: Globe },
		],
	},
	{
		id: "help",
		title: "帮助",
		items: [
			{ id: "guide", label: "使用教程", icon: BookOpen },
			{ id: "about", label: "版本与更新", icon: Info },
		],
	},
];
