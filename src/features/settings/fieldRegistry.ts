export interface FieldDefinition {
	id: string;
	sectionId: string;
	label: string;
	description: string;
	keywords: string[];
}

export const FIELD_REGISTRY: FieldDefinition[] = [
	// 常规
	{
		id: "capsuleVisible",
		sectionId: "general",
		label: "顶部胶囊 (Top Capsule)",
		description: "在窗口顶部显示轻量胶囊栏，提供全局状态、快捷切换与通知",
		keywords: ["capsule", "胶囊", "top capsule", "顶部胶囊", "状态栏"],
	},
	{
		id: "smartContextRouting",
		sectionId: "general",
		label: "智能上下文路由",
		description: "新会话自动检测关联项目并注入最近工作区上下文",
		keywords: ["smart context", "路由", "上下文路由", "工作区", "关联项目"],
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
		label: "轮次结束通知",
		description: "Agent 执行完一轮任务或等待用户输入时发送系统通知",
		keywords: ["turn", "轮次", "完成", "结束", "输入"],
	},
	{
		id: "notifyApproval",
		sectionId: "notifications",
		label: "审批与提问通知",
		description: "Agent 请求执行受限命令或需要您确认时发送通知",
		keywords: ["approval", "审批", "确认", "提问", "授权"],
	},
	{
		id: "notifyExit",
		sectionId: "notifications",
		label: "异常与中断通知",
		description: "进程异常退出、超限或执行出错时发送通知",
		keywords: ["error", "exit", "异常", "中断", "报错", "退出"],
	},
	{
		id: "notifySound",
		sectionId: "notifications",
		label: "通知提示音",
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
		description: "在指定时间段内静音所有应用通知",
		keywords: ["quiet", "免打扰", "安静时段", "时段", "静音", "夜间"],
	},
	{
		id: "notifyTest",
		sectionId: "notifications",
		label: "测试通知权限与提示音",
		description: "测试系统通知权限与提示音",
		keywords: ["test", "测试", "权限", "声音测试"],
	},

	// 会话 (含 对话检查点)
	{
		id: "defaultApprovalMode",
		sectionId: "sessions",
		label: "默认审批模式 (Approval Mode)",
		description: "新会话启动时使用的默认工具执行权限（always-ask / write / yolo）",
		keywords: ["approval", "always-ask", "write", "yolo", "审批模式", "权限", "模式"],
	},
	{
		id: "idleSuspendMinutes",
		sectionId: "sessions",
		label: "空闲挂起时长 (分钟)",
		description: "无交互持续达到该时长后自动挂起后台 RPC 进程以节省内存（0 为不挂起）",
		keywords: ["idle", "suspend", "空闲", "挂起", "内存", "时长", "后台"],
	},
	{
		id: "sessionTurnAutoRefresh",
		sectionId: "sessions",
		label: "自动刷新会话摘要",
		description: "每一轮对话完成后在后台自动提取最新摘要并更新列表标题",
		keywords: ["refresh", "summary", "摘要", "标题", "自动刷新", "总结"],
	},
	{
		id: "newSessionModel",
		sectionId: "sessions",
		label: "新会话默认模型",
		description: "每次新建会话时预选的模型标识，留空使用 OMP 内置默认或 default 角色",
		keywords: ["model", "默认模型", "新会话", "模型选择", "主力模型"],
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
		label: "系统待办检测",
		description: "监听错误、未处理异常与中断事件，自动生成待办项",
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
		label: "监工触发间隔 (分钟)",
		description: "状态变化后触发监工分析的去抖间隔，最短 5 分钟；0 表示仅手动刷新",
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
		label: "局域网直连 (LAN)",
		description: "局域网直连访问与端口配置，生成局域网配对二维码",
		keywords: ["lan", "port", "局域网", "端口", "直连", "配对码", "二维码"],
	},
	{
		id: "mobileTunnel",
		sectionId: "mobile",
		label: "Cloudflare Tunnel 公网隧道",
		description: "通过 Cloudflare 隧道公网访问，支持快速临时隧道或自建命名隧道",
		keywords: ["tunnel", "cloudflare", "公网", "隧道", "配对码", "远程"],
	},
	{
		id: "mobileDevices",
		sectionId: "mobile",
		label: "已配对设备与访问控制",
		description: "管理通过配对码连接的手机移动端凭据，一键撤销全部设备",
		keywords: ["devices", "pairing", "已配对", "设备", "撤销", "凭据", "解绑"],
	},

	// 高级
	{
		id: "quickCaptureShortcut",
		sectionId: "advanced",
		label: "全局快捷键 (快速捕获)",
		description: "在系统任意界面呼出快速记录面板的全局热键组合",
		keywords: ["shortcut", "快捷键", "快速捕获", "全局", "热键"],
	},
	{
		id: "ompBinary",
		sectionId: "advanced",
		label: "OMP 命令行程序 (omp binary)",
		description: "指定 omp 可执行文件路径，留空则自动从 PATH 中探测",
		keywords: ["binary", "omp", "path", "可执行", "路径", "命令行"],
	},
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
		label: "数据管理",
		description: "打开应用数据目录、导出或导入工作台设置、恢复默认偏好",
		keywords: ["data", "export", "import", "reset", "数据目录", "导出", "导入", "重置", "恢复默认"],
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
		description: "为每类任务指定主力模型与回退顺序",
		keywords: ["model", "role", "角色", "模型", "回退", "fallback", "default", "task"],
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
