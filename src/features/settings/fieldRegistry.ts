export interface FieldDefinition {
	id: string;
	sectionId: string;
	label: string;
	description: string;
	keywords: string[];
}

export const FIELD_REGISTRY: FieldDefinition[] = [
	// 通用
	{
		id: "ompBinary",
		sectionId: "advanced",
		label: "omp 程序位置",
		description: "本应用启动 AI 会话所用的 omp 命令或完整路径，并显示是否找到及版本",
		keywords: ["binary", "omp", "path", "可执行", "路径", "命令行", "版本", "version"],
	},
	{
		id: "ompConfigFiles",
		sectionId: "advanced",
		label: "omp 配置文件",
		description: "在访达中显示 ~/.omp/agent/config.yml 与 omp 数据目录，重新读取 OMP 配置",
		keywords: ["config.yml", "配置文件", "agent", "目录", "重新读取", "刷新", "reload"],
	},
	{
		id: "newSessionModel",
		sectionId: "general",
		label: "全局默认模型 (主力模型)",
		description: "新对话与常规问答默认使用的主力模型（对应 OMP 全局角色 default）",
		keywords: ["model", "默认模型", "全局模型", "主力模型", "模型选择", "default"],
	},
	{
		id: "newSessionThinkingLevel",
		sectionId: "general",
		label: "思考深度 (Thinking Level)",
		description: "支持思考的模型在回答前推理多久（omp defaultThinkingLevel）",
		keywords: ["thinking", "思考", "推理", "深度", "defaultThinkingLevel"],
	},
	{
		id: "defaultApprovalMode",
		sectionId: "general",
		label: "默认审批模式 (Approval Mode)",
		description: "AI 改文件或执行命令前是否先征得你同意（每步都问 / 改动前问 / 全自动）",
		keywords: ["approval", "always-ask", "write", "yolo", "审批模式", "权限", "模式"],
	},
	{
		id: "capsuleVisible",
		sectionId: "general",
		label: "顶部子任务胶囊",
		description: "对话产生并发子任务（Subagent）时，在窗口顶部显示胶囊指示条与进度",
		keywords: ["capsule", "胶囊", "top capsule", "顶部胶囊", "子任务", "subagent", "状态栏"],
	},
	{
		id: "smartContextRouting",
		sectionId: "general",
		label: "自动关联项目",
		description: "新开对话时自动识别所在项目，并把最近的相关工作告诉 AI",
		keywords: ["smart context", "路由", "上下文路由", "智能上下文", "工作区", "关联项目"],
	},
	{
		id: "quickCaptureShortcut",
		sectionId: "general",
		label: "快速记录快捷键",
		description: "在任何应用里按下即可弹出快速记录窗口的全局快捷键",
		keywords: ["shortcut", "快捷键", "快速捕获", "快速记录", "全局", "热键"],
	},
	{
		id: "agentsMdShortcut",
		sectionId: "general",
		label: "AGENTS.md（给 AI 的长期指令）",
		description: "编辑 AI 每次都会遵守的规则文件",
		keywords: ["agents.md", "agents", "规则", "指令", "rules"],
	},

	// 外观
	{
		id: "theme",
		sectionId: "appearance",
		label: "主题",
		description: "选择应用界面配色方案（跟随系统、深色或浅色）",
		keywords: ["theme", "深色", "浅色", "系统", "配色", "暗色", "明亮"],
	},
	{
		id: "fontSize",
		sectionId: "appearance",
		label: "聊天字号",
		description: "控制会话消息正文与代码块的正文字号",
		keywords: ["font", "字号", "字体", "紧凑", "标准", "宽松", "超大", "正文"],
	},
	{
		id: "uiDensity",
		sectionId: "appearance",
		label: "界面密度",
		description: "整体界面的缩放与间距程度",
		keywords: ["density", "密度", "间距", "紧凑", "宽松", "标准"],
	},
	{
		id: "uiScale",
		sectionId: "appearance",
		label: "界面缩放",
		description: "调节窗口视图比例（快捷键：Cmd/Ctrl +/-，重置：Cmd/Ctrl 0）",
		keywords: ["zoom", "缩放", "放大", "缩小", "比例", "视图"],
	},

	// 通知
	{
		id: "notifyTurnEnd",
		sectionId: "notifications",
		label: "完成一轮回复",
		description: "Agent 做完一轮工作、等你查看结果时发送系统通知",
		keywords: ["turn", "轮次", "完成", "结束", "输入", "回复"],
	},
	{
		id: "notifyApproval",
		sectionId: "notifications",
		label: "需要你批准或回答",
		description: "Agent 请求执行受限命令或需要您确认时发送通知",
		keywords: ["approval", "审批", "确认", "提问", "授权"],
	},
	{
		id: "notifyExit",
		sectionId: "notifications",
		label: "出错或意外中断",
		description: "进程异常退出、超限或执行出错时发送通知",
		keywords: ["error", "exit", "异常", "中断", "报错", "退出"],
	},
	{
		id: "notifySound",
		sectionId: "notifications",
		label: "提示音",
		description: "发送通知时播放系统提示声音",
		keywords: ["sound", "声音", "提示音", "静音"],
	},
	{
		id: "dockBadgeEnabled",
		sectionId: "notifications",
		label: "Dock 角标",
		description: "应用图标显示未读待办与运行中任务计数",
		keywords: ["dock", "badge", "角标", "未读", "图标", "计数"],
	},
	{
		id: "notifyQuiet",
		sectionId: "notifications",
		label: "免打扰时段",
		description: "在指定时间段内不弹系统通知，可跨夜（如 22:00–08:00）",
		keywords: ["quiet", "免打扰", "安静时段", "时段", "静音", "夜间"],
	},
	{
		id: "notifyTest",
		sectionId: "notifications",
		label: "发送一条测试通知",
		description: "确认系统通知和提示音是否正常；收不到时附带系统设置指引",
		keywords: ["test", "测试", "权限", "声音测试", "收不到通知"],
	},

	// 会话 (含 对话检查点)
	{
		id: "idleSuspendMinutes",
		sectionId: "sessions",
		label: "闲置多久后休眠（分钟）",
		description: "对话闲置达到该时长后暂停后台进程以省内存，发消息时自动恢复（0 为永不休眠）",
		keywords: ["idle", "suspend", "空闲", "闲置", "挂起", "休眠", "内存", "时长", "后台"],
	},
	{
		id: "sessionTurnAutoRefresh",
		sectionId: "sessions",
		label: "自动更新对话标题与摘要",
		description: "每轮回答结束后在后台重新总结对话，保持列表标题贴切",
		keywords: ["refresh", "summary", "摘要", "标题", "自动刷新", "总结"],
	},
	{
		id: "turnCheckpoints",
		sectionId: "sessions",
		label: "对话检查点",
		description: "每一轮对话自动保存现场，可随时撤回；Agent 同时遵守自动存档规则",
		keywords: ["checkpoint", "检查点", "撤回", "版本", "自动存档", "git", "现场"],
	},

	// 收件箱 (inbox, renamed from todos)
	{
		id: "systemDetection",
		sectionId: "inbox",
		label: "自动收集待办",
		description: "审批请求、提问、报错、中断或等你验收时自动加入收件箱",
		keywords: ["system", "detection", "系统待办", "待办检测", "错误", "监听"],
	},
	{
		id: "supervisorEnabled",
		sectionId: "inbox",
		label: "后台监工建议 (Supervisor)",
		description: "后台定期分析长会话进展并提供非阻塞优化建议",
		keywords: ["supervisor", "监工", "后台监工", "巡检", "建议", "优化"],
	},
	{
		id: "supervisorModel",
		sectionId: "inbox",
		label: "监工模型",
		description: "监工调用 omp -p 时指定的轻量模型，建议保持快速或低成本模型",
		keywords: ["supervisor model", "监工模型", "建议模型", "轻量模型", "smol"],
	},
	{
		id: "supervisorIntervalMinutes",
		sectionId: "inbox",
		label: "分析间隔（分钟）",
		description: "会话状态变化后至少隔多久再分析一次；0 表示只手动刷新",
		keywords: ["interval", "触发间隔", "巡检间隔", "频率", "去抖", "分钟"],
	},
	{
		id: "homeShowCompletedTodos",
		sectionId: "inbox",
		label: "默认展开已处理待办",
		description: "首页待办卡片默认展示历史已归档的条目",
		keywords: ["completed", "已处理", "已归档", "已完成", "展开", "待办"],
	},

	// 手机访问
	{
		id: "mobileLan",
		sectionId: "mobile",
		label: "手机访问服务",
		description: "启动/停止手机访问、修改端口、生成局域网配对二维码",
		keywords: ["lan", "port", "局域网", "端口", "直连", "配对码", "二维码", "启动", "停止"],
	},
	{
		id: "mobileTunnel",
		sectionId: "mobile",
		label: "公网隧道（不在同一网络时访问）",
		description: "通过 Cloudflare 隧道公网访问，支持快速临时隧道或自建命名隧道",
		keywords: ["tunnel", "cloudflare", "公网", "隧道", "配对码", "远程"],
	},
	{
		id: "mobileDevices",
		sectionId: "mobile",
		label: "已配对的手机",
		description: "撤销所有已配对手机的访问权限，需重新扫码",
		keywords: ["devices", "pairing", "已配对", "设备", "撤销", "凭据", "解绑"],
	},

	// 高级
	{
		id: "installStatusExtension",
		sectionId: "advanced",
		label: "安装全局状态扩展",
		description: "将 workbench 的状态扩展写入 omp 全局目录，使所有会话向工作台汇报",
		keywords: ["extension", "扩展", "状态扩展", "安装", "全局"],
	},
	{
		id: "dataManagement",
		sectionId: "advanced",
		label: "本应用的设置与数据",
		description: "打开数据目录、导出或导入设置备份",
		keywords: ["data", "export", "import", "数据目录", "导出", "导入", "备份"],
	},
	{
		id: "resetSettings",
		sectionId: "advanced",
		label: "恢复默认设置",
		description: "把本应用的所有设置恢复成刚安装时的样子（无法撤销）",
		keywords: ["reset", "重置", "恢复默认", "默认值"],
	},

	// Deep-link anchors used by settingsTargets.ts (mcp / plugins / providers / roles)
	{
		id: "providerList",
		sectionId: "providers",
		label: "供应商列表",
		description: "API 供应商与密钥管理",
		keywords: ["provider", "api", "key", "密钥", "供应商", "凭证", "oauth"],
	},
	{
		id: "modelRolesPanel",
		sectionId: "omp-roles",
		label: "模型角色与回退链",
		description: "为每类任务指定主力模型与回退顺序，可按项目覆盖",
		keywords: ["model", "role", "角色", "模型", "回退", "fallback", "default", "task", "项目", "project", "全局"],
	},
	{
		id: "mcpServerList",
		sectionId: "mcp",
		label: "MCP 服务器列表",
		description: "已配置的 MCP 服务器及其来源文件",
		keywords: ["mcp", "server", "服务器", "stdio", "http", "工具服务"],
	},
	{
		id: "mcpRuntimeOptions",
		sectionId: "mcp",
		label: "MCP 运行时选项",
		description: "启动超时、通知与结果渲染等 mcp.* 设置",
		keywords: ["mcp", "timeout", "超时", "startupTimeout", "notification", "通知"],
	},
	{
		id: "pluginList",
		sectionId: "plugins",
		label: "已安装插件",
		description: "npm/link/marketplace 安装的 OMP 插件，可启用或停用",
		keywords: ["plugin", "插件", "npm", "marketplace", "安装"],
	},
	{
		id: "extensionList",
		sectionId: "plugins",
		label: "扩展模块",
		description: "OMP 扩展脚本（extensions 目录中的 .ts/.js），可启用或停用",
		keywords: ["extension", "扩展", "脚本", "模块"],
	},
	{
		id: "extensionsConfig",
		sectionId: "plugins",
		label: "显式加载的扩展路径",
		description: "omp config 的 extensions / disabledExtensions 列表",
		keywords: ["extensions", "disabledExtensions", "路径", "配置"],
	},

	// 规则文件 AGENTS.md
	{
		id: "agentsMdScope",
		sectionId: "agents-md",
		label: "AGENTS.md 范围（全局 / 当前项目）",
		description: "选择编辑全局 ~/.omp/agent/AGENTS.md 还是当前项目的 AGENTS.md",
		keywords: ["agents.md", "agents", "规则", "规则文件", "指令", "上下文文件", "context file", "全局", "项目"],
	},
	{
		id: "agentsMdProjectFile",
		sectionId: "agents-md",
		label: "项目文件位置",
		description: "项目根目录 AGENTS.md 或 .omp/AGENTS.md；两者都有内容时 omp 只读后者",
		keywords: [".omp", "native", "位置", "覆盖"],
	},
	{
		id: "agentsMdEditor",
		sectionId: "agents-md",
		label: "编辑 AGENTS.md",
		description: "查看、编辑并保存 agent 的长期说明，新会话生效",
		keywords: ["编辑", "保存", "预览", "markdown", "instructions", "长期说明", "约定"],
	},
];

/** Extract all searchable keywords for a native section. */
export function registryKeywordsForSection(sectionId: string): string[] {
	return FIELD_REGISTRY.filter((f) => f.sectionId === sectionId).flatMap((f) => [
		f.label,
		f.description,
		...f.keywords,
	]);
}

/** Find the first field matching the search query within a section. */
export function findMatchingField(
	sectionId: string,
	query: string,
): FieldDefinition | undefined {
	const q = query.trim().toLowerCase();
	if (!q) return undefined;
	return FIELD_REGISTRY.find(
		(f) =>
			f.sectionId === sectionId &&
			(f.label.toLowerCase().includes(q) ||
				f.description.toLowerCase().includes(q) ||
				f.keywords.some((k) => k.toLowerCase().includes(q))),
	);
}
