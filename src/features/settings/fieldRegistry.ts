import { t as translate, type Locale } from "../../lib/i18n";
import { useLanguageStore } from "../../stores/language";
import { REQUEST_STAT_FIELDS } from "../chat/requestStats";
import { REQUEST_STAT_FIELD_IDS, type RequestStatField } from "../../stores/displayPrefs";

/** `data-field-id` (and registry id) of each per-field stats switch row. */
export const REQUEST_STAT_FIELD_ROW_IDS = Object.fromEntries(
	REQUEST_STAT_FIELD_IDS.map((f) => [f, `requestStats:${f}`]),
) as Record<RequestStatField, string>;

const currentLocale = (): Locale => useLanguageStore.getState().locale;

export interface FieldDefinition {
	id: string;
	sectionId: string;
	keywords: string[];
	/** Live (current-locale) text for generated rows whose copy lives in another namespace. */
	live?: { readonly label: string; readonly description: string };
}

export const FIELD_REGISTRY: FieldDefinition[] = [
	// 通用
	{
		id: "ompBinary",
		sectionId: "advanced",
		keywords: ["binary", "omp", "path", "可执行", "路径", "命令行", "版本", "version"],
	},
	{
		id: "ompConfigFiles",
		sectionId: "advanced",
		keywords: ["config.yml", "配置文件", "agent", "目录", "重新读取", "刷新", "reload"],
	},
	{
		id: "newSessionModel",
		sectionId: "general",
		keywords: ["model", "默认模型", "全局模型", "主力模型", "模型选择", "default"],
	},
	{
		id: "sideChatModel",
		sectionId: "omp-roles",
		keywords: ["side chat", "侧聊", "fork", "模型", "sidechat", "默认模型"],
	},
	{
		id: "defaultApprovalMode",
		sectionId: "general",
		keywords: ["approval", "always-ask", "write", "yolo", "审批模式", "权限", "模式"],
	},
	{
		id: "gitDeliveryMode",
		sectionId: "general",
		keywords: ["git", "delivery", "pr", "pull request", "merge", "main", "主干", "交付", "推送"],
	},
	{
		id: "capsuleVisible",
		sectionId: "general",
		keywords: ["capsule", "胶囊", "top capsule", "顶部胶囊", "子代理", "子任务", "subagent", "subagents", "状态栏"],
	},
	{
		id: "windowWorktreeTitle",
		sectionId: "general",
		keywords: ["window title", "窗口标题", "分支", "branch", "worktree", "工作树", "标题"],
	},
	{
		id: "smartContextRouting",
		sectionId: "general",
		keywords: ["smart context", "路由", "上下文路由", "智能上下文", "工作区", "关联项目"],
	},
	{
		id: "quickCaptureShortcut",
		sectionId: "shortcuts",
		keywords: ["shortcut", "快捷键", "快速捕获", "快速记录", "全局", "热键"],
	},
	{
		id: "agentsMdShortcut",
		sectionId: "general",
		keywords: ["agents.md", "agents", "规则", "指令", "rules"],
	},

	{
		id: "language",
		sectionId: "general",
		keywords: ["language", "语言", "i18n", "locale", "英文", "中文", "english", "chinese"],
	},
	// 外观
	{
		id: "theme",
		sectionId: "appearance",
		keywords: ["theme", "深色", "浅色", "系统", "配色", "暗色", "明亮"],
	},
	{
		id: "fontSize",
		sectionId: "appearance",
		keywords: ["font", "字号", "字体", "紧凑", "标准", "宽松", "超大", "正文"],
	},
	{
		id: "uiDensity",
		sectionId: "appearance",
		keywords: ["density", "密度", "间距", "紧凑", "宽松", "标准"],
	},
	{
		id: "uiScale",
		sectionId: "appearance",
		keywords: ["zoom", "缩放", "放大", "缩小", "比例", "视图"],
	},
	{
		id: "requestStats",
		sectionId: "appearance",
		keywords: ["请求统计", "request stats", "统计", "token", "用量", "开关", "显示", "缓存", "速度", "首字", "延迟", "耗时", "费用", "价格"],
	},
	...REQUEST_STAT_FIELD_IDS.map<FieldDefinition>((f) => ({
		id: REQUEST_STAT_FIELD_ROW_IDS[f],
		sectionId: "appearance",
		live: REQUEST_STAT_FIELDS[f],
		keywords: ["请求统计", `requestStats:${f}`, f, "token", "统计"],
	})),
	{
		id: "bottomBar",
		sectionId: "appearance",
		keywords: ["底栏", "状态栏", "bottom", "bar", "statusbar", "隐藏", "显示"],
	},
	{
		id: "thinkingPreview",
		sectionId: "appearance",
		keywords: ["thinking", "思考", "预览", "推理", "thinkingPreview", "思考内容"],
	},
	{
		id: "sideChatHandback",
		sectionId: "appearance",
		keywords: ["回传", "辅助对话", "侧聊", "父会话", "结论", "手动选择", "sideChatHandback"],
	},

	// 通知
	{
		id: "notifyTurnEnd",
		sectionId: "notifications",
		keywords: ["turn", "轮次", "完成", "结束", "输入", "回复"],
	},
	{
		id: "notifyApproval",
		sectionId: "notifications",
		keywords: ["approval", "审批", "确认", "提问", "授权"],
	},
	{
		id: "notifyExit",
		sectionId: "notifications",
		keywords: ["error", "exit", "异常", "中断", "报错", "退出"],
	},
	{
		id: "notifySound",
		sectionId: "notifications",
		keywords: ["sound", "声音", "提示音", "静音"],
	},
	{
		id: "dockBadgeEnabled",
		sectionId: "notifications",
		keywords: ["dock", "badge", "角标", "未读", "图标", "计数"],
	},
	{
		id: "notifyQuiet",
		sectionId: "notifications",
		keywords: ["quiet", "免打扰", "安静时段", "时段", "静音", "夜间"],
	},
	{
		id: "notifyTest",
		sectionId: "notifications",
		keywords: ["test", "测试", "权限", "声音测试", "收不到通知"],
	},

	// 会话 (含 对话检查点)
	{
		id: "idleSuspendMinutes",
		sectionId: "sessions",
		keywords: ["idle", "suspend", "空闲", "闲置", "挂起", "休眠", "内存", "时长", "后台"],
	},
	{
		id: "sessionTurnAutoRefresh",
		sectionId: "sessions",
		keywords: ["refresh", "summary", "摘要", "标题", "自动刷新", "总结"],
	},
	{
		id: "sessionGroupByWorktree",
		sectionId: "sessions",
		keywords: ["worktree", "branch", "group", "工作树", "分支", "分组", "平铺", "项目", "会话"],
	},
	{
		id: "turnCheckpoints",
		sectionId: "sessions",
		keywords: ["checkpoint", "检查点", "撤回", "版本", "自动存档", "git", "现场"],
	},
	{
		id: "queueAutoSend",
		sectionId: "sessions",
		keywords: ["queue", "排队", "自动发送", "follow-up", "消息"],
	},
	{
		id: "sendShortcut",
		sectionId: "shortcuts",
		keywords: ["send", "enter", "shortcut", "快捷键", "发送", "换行", "command", "cmd", "⌘"],
	},
	{
		id: "followUpBehavior",
		sectionId: "sessions",
		keywords: ["follow-up", "steer", "queue", "interrupt", "引导", "排队", "打断", "进行中", "发送", "回合"],
	},
	{
		id: "visualizeEnabled",
		sectionId: "sessions",
		keywords: ["visualize", "可视化", "图表", "chart", "diagram", "示意图", "模拟", "simulation", "sandbox", "沙箱"],
	},


	// 收件箱 (inbox, renamed from todos)
	{
		id: "systemDetection",
		sectionId: "inbox",
		keywords: ["system", "detection", "系统待办", "待办检测", "错误", "监听"],
	},
	{
		id: "inboxWindowHours",
		sectionId: "inbox",
		keywords: ["window", "expire", "过期", "移出", "小时", "收件箱"],
	},
	{
		id: "ompCheckIntervalHours",
		sectionId: "about",
		keywords: ["check interval", "检查间隔", "自动检查", "小时", "omp", "更新"],
	},
	{
		id: "doctorModel",
		sectionId: "doctor",
		keywords: ["doctor", "diagnose", "会话体检", "使用模型", "体检", "会诊", "诊断", "token", "用量"],
	},
	{
		id: "doctorAutoMode",
		sectionId: "doctor",
		keywords: ["doctor", "auto", "自动体检", "会话体检", "体检", "闲置", "定时", "每日", "会诊"],
	},

	// 手机访问
	{
		id: "mobileLan",
		sectionId: "mobile",
		keywords: ["lan", "port", "局域网", "端口", "直连", "配对码", "二维码", "启动", "停止"],
	},
	{
		id: "mobileTunnel",
		sectionId: "mobile",
		keywords: ["tunnel", "cloudflare", "公网", "隧道", "配对码", "远程"],
	},
	{
		id: "mobileDevices",
		sectionId: "mobile",
		keywords: ["devices", "pairing", "已配对", "设备", "撤销", "凭据", "解绑"],
	},

	// 高级
	{
		id: "installStatusExtension",
		sectionId: "advanced",
		keywords: ["extension", "扩展", "状态扩展", "安装", "全局"],
	},
	{
		id: "dataManagement",
		sectionId: "advanced",
		keywords: ["data", "export", "import", "数据目录", "导出", "导入", "备份"],
	},
	{
		id: "resetSettings",
		sectionId: "advanced",
		keywords: ["reset", "重置", "恢复默认", "默认值"],
	},

	// Deep-link anchors used by settingsTargets.ts (mcp / plugins / providers / roles)
	{
		id: "providerList",
		sectionId: "providers",
		keywords: ["provider", "api", "key", "密钥", "供应商", "凭证", "oauth"],
	},
	{
		id: "modelRolesPanel",
		sectionId: "omp-roles",
		keywords: ["model", "role", "角色", "模型", "主力模型", "default", "task", "agent", "子代理", "代理", "点名", "override", "项目", "project", "全局"],
	},
	{
		id: "fallbackChainsPanel",
		sectionId: "model-fallback",
		keywords: ["fallback", "回退", "回退链", "chain", "切换顺序", "cycleOrder", "保存位置", "modelRoleStorage", "/model"],
	},
	{
		id: "mcpServerList",
		sectionId: "mcp",
		keywords: ["mcp", "server", "服务器", "stdio", "http", "工具服务", "项目", "全局", "导入", "分配"],
	},
	{
		id: "mcpRuntimeOptions",
		sectionId: "mcp",
		keywords: ["mcp", "timeout", "超时", "startupTimeout", "notification", "通知"],
	},
	{
		id: "pluginList",
		sectionId: "plugins",
		keywords: ["plugin", "插件", "npm", "marketplace", "安装"],
	},
	{
		id: "extensionList",
		sectionId: "plugins",
		keywords: ["extension", "扩展", "脚本", "模块"],
	},
	{
		id: "extensionsConfig",
		sectionId: "plugins",
		keywords: ["extensions", "disabledExtensions", "路径", "配置"],
	},

	// 规则文件
	{
		id: "agentsMdScope",
		sectionId: "agents-md",
		keywords: ["rules.md", "append_system", "rules", "agents.md", "agents", "规则", "规则文件", "指令", "上下文文件", "context file", "全局", "项目"],
	},
	{
		id: "agentsMdProjectFile",
		sectionId: "agents-md",
		keywords: [".omp", "native", "位置", "覆盖"],
	},
	{
		id: "agentsMdEditor",
		sectionId: "agents-md",
		keywords: ["编辑", "保存", "预览", "markdown", "instructions", "长期说明", "约定"],
	},
	// 系统提示词
	{
		id: "promptCompositionOverview",
		sectionId: "prompt-composition",
		keywords: ["系统提示词", "system prompt", "prompt", "token", "占用", "上下文", "规则文件", "skills", "工具说明", "mcp", "精简", "优化", "让 AI 帮我优化"],
	},
];

/** Localized field name (messages `settingsCore.field.<id>.label`). */
export function fieldLabel(field: FieldDefinition, locale: Locale = currentLocale()): string {
	return field.live?.label ?? translate(`settingsCore.field.${field.id}.label`, undefined, locale);
}

/** Localized field description (messages `settingsCore.field.<id>.description`). */
export function fieldDescription(field: FieldDefinition, locale: Locale = currentLocale()): string {
	return field.live?.description ?? translate(`settingsCore.field.${field.id}.description`, undefined, locale);
}

/** Find the first field matching the search query within a section. */
export function findMatchingField(
	sectionId: string,
	query: string,
	locale?: Locale,
): FieldDefinition | undefined {
	const q = query.trim().toLowerCase();
	if (!q) return undefined;
	// Match the active locale plus both source languages so either can be searched.
	const locales: Locale[] = [...new Set<Locale>([locale ?? currentLocale(), "zh-CN", "en-US"])];
	return FIELD_REGISTRY.find(
		(f) =>
			f.sectionId === sectionId &&
			(locales.some(
				(l) => fieldLabel(f, l).toLowerCase().includes(q) || fieldDescription(f, l).toLowerCase().includes(q),
			) ||
				f.keywords.some((k) => k.toLowerCase().includes(q))),
	);
}
