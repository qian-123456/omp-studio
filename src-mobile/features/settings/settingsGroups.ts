import {
	Bell,
	Bot,
	Brain,
	Cpu,
	FileText,
	Globe,
	Hammer,
	Info,
	KeyRound,
	Layers,
	Library,
	Network,
	Palette,
	Route,
	Ruler,
	Server,
	Shield,
	Sliders,
	Smartphone,
	Sparkles,
	Stethoscope,
	Users,
	BookOpen,
	CreditCard,
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

export interface SettingsItemDef {
	id: SheetId | "providers" | "roles" | "fallbacks" | "context" | "quota";
	label: string;
	desc: string;
	icon: LucideIcon;
	badge?: string;
	/** If set, clicking navigates to this named route or path instead of opening a bottom sheet */
	navigateTo?: "settingsProviders" | "settingsRoles" | "settingsFallbacks" | "settingsContext" | "quota";
}

export interface SettingsGroupDef {
	id: string;
	title: string;
	items: SettingsItemDef[];
}

export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
	{
		id: "general",
		title: "常规",
		items: [
			{
				id: "general",
				label: "通用",
				desc: "新会话默认模型、审批模式",
				icon: Sliders,
			},
			{
				id: "appearance",
				label: "外观",
				desc: "主题皮肤、配色方案、消息字号与展示",
				icon: Palette,
			},
			{
				id: "notifications",
				label: "通知",
				desc: "回答完成、等待审批与后台推送通知",
				icon: Bell,
			},
			{
				id: "privacy",
				label: "隐私",
				desc: "脱敏标记与敏感数据上游保护",
				icon: Shield,
			},
		],
	},
	{
		id: "models",
		title: "模型",
		items: [
			{
				id: "providers",
				label: "模型与供应商",
				desc: "配置 API Key、BaseUrl 并即时测试连通性",
				icon: KeyRound,
				navigateTo: "settingsProviders",
			},
			{
				id: "roles",
				label: "模型角色",
				desc: "分角色指定主力模型，支持批量替换",
				icon: Users,
				badge: "含批量替换",
				navigateTo: "settingsRoles",
			},
			{
				id: "thinking",
				label: "思考与采样",
				desc: "思考深度、预算上限与采样温度控制",
				icon: Brain,
			},
			{
				id: "helper-models",
				label: "辅助模型",
				desc: "配置顾问模型、快速探针与图片分析模型",
				icon: Cpu,
			},
			{
				id: "fallbacks",
				label: "备用模型与重试",
				desc: "主模型失败时的自动回退链与重试策略",
				icon: Route,
				navigateTo: "settingsFallbacks",
			},
			{
				id: "context",
				label: "上下文窗口",
				desc: "各模型上下文 token 额度上限管理",
				icon: Ruler,
				navigateTo: "settingsContext",
			},
			{
				id: "quota",
				label: "订阅与配额",
				desc: "各供应商 5h/7d 滚动限额、用量百分比与重置倒计时",
				icon: CreditCard,
				badge: "/quota",
				navigateTo: "quota",
			},
		],
	},
	{
		id: "sessions",
		title: "会话",
		items: [
			{
				id: "sessions",
				label: "会话",
				desc: "自动上下文压缩、消息追加与打断执行策略",
				icon: Bot,
			},
			{
				id: "inbox",
				label: "收件箱",
				desc: "多会话汇总整理与待办提醒",
				icon: Sparkles,
			},
			{
				id: "doctor",
				label: "会话体检",
				desc: "常见共性问题 Top 3、提问优化与健康指标（只读）",
				icon: Stethoscope,
				badge: "只读",
			},
			{
				id: "agents-md",
				label: "规则文件",
				desc: "查看并编辑 AGENTS.md、RULES.md 等指导规则",
				icon: FileText,
				badge: "查看并编辑",
			},
			{
				id: "prompt-composition",
				label: "系统提示词",
				desc: "完整系统提示词分层与 token 占比构成（只读）",
				icon: Layers,
				badge: "只读",
			},
		],
	},
	{
		id: "agentCapabilities",
		title: "Agent 能力",
		items: [
			{
				id: "tools",
				label: "工具",
				desc: "提问模式、审批时限与长命令自动转后台",
				icon: Hammer,
			},
			{
				id: "subagents",
				label: "子代理",
				desc: "查看/编辑已有子代理，支持新建与「让 AI 帮我写」",
				icon: Network,
				badge: "新建+AI写+编辑",
			},
			{
				id: "memory",
				label: "记忆",
				desc: "跨会话记忆笔记查看与编辑（不删除技能）",
				icon: Library,
				badge: "可编辑记忆",
			},
			{
				id: "skills",
				label: "技能与命令",
				desc: "已加载技能与自定义斜杠命令一览",
				icon: BookOpen,
			},
		],
	},
	{
		id: "connections",
		title: "连接",
		items: [
			{
				id: "connection",
				label: "连接与设备",
				desc: "服务状态、端口、当前/局域网/隧道/IPv6 地址与配对",
				icon: Smartphone,
			},
			{
				id: "mcp",
				label: "MCP 服务器",
				desc: "管理 MCP 扩展服务（查看、添加与编辑）",
				icon: Server,
				badge: "查看+添加+编辑",
			},
			{
				id: "web",
				label: "联网搜索",
				desc: "SearXNG、Perplexity、Tavily 等联网搜索与网页抓取",
				icon: Globe,
			},
		],
	},
	{
		id: "help",
		title: "帮助",
		items: [
			{
				id: "guide",
				label: "使用教程",
				desc: "移动端手势操作、功能概览与技巧指引",
				icon: BookOpen,
			},
			{
				id: "about",
				label: "版本与更新",
				desc: "应用版本号、OMP 核心状态与系统信息（只读）",
				icon: Info,
				badge: "只读",
			},
		],
	},
] as const;
