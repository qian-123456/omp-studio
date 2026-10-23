import { REQUEST_STAT_FIELDS } from "../chat/requestStats";
import { REQUEST_STAT_FIELD_IDS, type RequestStatField } from "../../stores/displayPrefs";

/** `data-field-id` (and registry id) of each per-field stats switch row. */
export const REQUEST_STAT_FIELD_ROW_IDS = Object.fromEntries(
	REQUEST_STAT_FIELD_IDS.map((f) => [f, `requestStats:${f}`]),
) as Record<RequestStatField, string>;

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
		label: "全局默认模型",
		description: "新对话与常规问答默认使用的主力模型（对应 OMP 全局角色 default）",
		keywords: ["model", "默认模型", "全局模型", "主力模型", "模型选择", "default"],
	},
	{
		id: "sideChatModel",
		sectionId: "omp-roles",
		label: "侧边对话专用模型",
		description: "开启后新建侧边对话使用专用模型；关闭则继承主对话的模型与 thinking level",
		keywords: ["side chat", "侧聊", "fork", "模型", "sidechat", "默认模型"],
	},
	{
		id: "defaultApprovalMode",
		sectionId: "general",
		label: "审批模式",
		description: "AI 改文件或执行命令前是否先征得你同意（每步都问 / 改动前问 / 全自动）",
		keywords: ["approval", "always-ask", "write", "yolo", "审批模式", "权限", "模式"],
	},
	{
		id: "gitDeliveryMode",
		sectionId: "general",
		label: "主干交付模式",
		description: "从功能分支交付到 main 主干时的默认行为方式（GitHub Pull Request / 本地直接合并并推送到 main）",
		keywords: ["git", "delivery", "pr", "pull request", "merge", "main", "主干", "交付", "推送"],
	},
	{
		id: "capsuleVisible",
		sectionId: "general",
		label: "顶部子代理胶囊",
		description: "对话派生并发子代理（Subagents）时，在窗口顶部显示胶囊指示条与进度",
		keywords: ["capsule", "胶囊", "top capsule", "顶部胶囊", "子代理", "子任务", "subagent", "subagents", "状态栏"],
	},
	{
		id: "windowWorktreeTitle",
		sectionId: "general",
		label: "窗口标题显示分支名",
		description: "在系统窗口标题中附加当前工作树的 Git 分支，便于区分同时打开的多个实例",
		keywords: ["window title", "窗口标题", "分支", "branch", "worktree", "工作树", "标题"],
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
	{
		id: "requestStats",
		sectionId: "appearance",
		label: "显示请求统计",
		description: "每次模型请求下方显示开始时间、输入输出、缓存、首字延迟和速度",
		keywords: ["请求统计", "request stats", "统计", "token", "用量", "开关", "显示", "缓存", "速度", "首字", "延迟", "耗时", "费用", "价格"],
	},
	...REQUEST_STAT_FIELD_IDS.map<FieldDefinition>((f) => ({
		id: REQUEST_STAT_FIELD_ROW_IDS[f],
		sectionId: "appearance",
		label: REQUEST_STAT_FIELDS[f].label,
		description: REQUEST_STAT_FIELDS[f].description,
		keywords: [
			"请求统计",
			`requestStats:${f}`,
			f,
			REQUEST_STAT_FIELDS[f].label,
			"token",
			"统计",
		],
	})),
	{
		id: "bottomBar",
		sectionId: "appearance",
		label: "显示底栏",
		description: "窗口底部的状态栏（会话统计、性能、omp 版本、缩放）；关闭后隐藏，缩放快捷键仍可用",
		keywords: ["底栏", "状态栏", "bottom", "bar", "statusbar", "隐藏", "显示"],
	},
	{
		id: "thinkingPreview",
		sectionId: "appearance",
		label: "思考时显示最新两行",
		description: "模型思考时在「正在思考」下面滚动显示最新两行；思考结束后折叠成一行，点一下可展开全文",
		keywords: ["thinking", "思考", "预览", "推理", "thinkingPreview", "思考内容"],
	},
	{
		id: "sideChatHandback",
		sectionId: "appearance",
		label: "回传给父会话的方式",
		description: "辅助对话的结果怎样放回主对话：整理成结论，或手动选择文字",
		keywords: ["回传", "辅助对话", "侧聊", "父会话", "结论", "手动选择", "sideChatHandback"],
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
		id: "sessionGroupByWorktree",
		sectionId: "sessions",
		label: "按工作树区分会话",
		description: "开启：会话按 Git 工作树 / 分支分组；关闭：每个项目一个平铺列表",
		keywords: ["worktree", "branch", "group", "工作树", "分支", "分组", "平铺", "项目", "会话"],
	},
	{
		id: "turnCheckpoints",
		sectionId: "sessions",
		label: "对话检查点",
		description: "每一轮对话自动保存现场，可随时撤回；Agent 同时遵守自动存档规则",
		keywords: ["checkpoint", "检查点", "撤回", "版本", "自动存档", "git", "现场"],
	},
	{
		id: "queueAutoSend",
		sectionId: "sessions",
		label: "排队消息自动发送",
		description: "流式回合中排队的消息在回合结束后自动逐条发送",
		keywords: ["queue", "排队", "自动发送", "follow-up", "消息"],
	},
	{
		id: "sendShortcut",
		sectionId: "sessions",
		label: "发送快捷键",
		description: "Enter 发送，或 ⌘ Enter 发送（此时 Enter 换行）",
		keywords: ["send", "enter", "shortcut", "快捷键", "发送", "换行", "command", "cmd", "⌘"],
	},
	{
		id: "followUpBehavior",
		sectionId: "sessions",
		label: "任务进行中发送新消息",
		description: "回合进行中发送的消息：引导（插入当前回合）、排队（回合结束后发送）或打断后发送",
		keywords: ["follow-up", "steer", "queue", "interrupt", "引导", "排队", "打断", "进行中", "发送", "回合"],
	},
	{
		id: "visualizeEnabled",
		sectionId: "sessions",
		label: "启用可视化",
		description: "让 Agent 在回答里生成可交互的图表、示意图和模拟，渲染在沙箱中。",
		keywords: ["visualize", "可视化", "图表", "chart", "diagram", "示意图", "模拟", "simulation", "sandbox", "沙箱"],
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
		id: "inboxWindowHours",
		sectionId: "inbox",
		label: "自动移出时间（小时）",
		description: "非审批/提问的事项超过这么久没有新动态就从收件箱移出",
		keywords: ["window", "expire", "过期", "移出", "小时", "收件箱"],
	},
	{
		id: "ompCheckIntervalHours",
		sectionId: "about",
		label: "自动检查间隔",
		description: "应用运行期间，每隔这么久检查一次 omp 新版本",
		keywords: ["check interval", "检查间隔", "自动检查", "小时", "omp", "更新"],
	},
	{
		id: "doctorModel",
		sectionId: "doctor",
		label: "使用模型（会话体检）",
		description: "Token 用量面板「会话体检」调用 omp -p 时使用的模型",
		keywords: ["doctor", "diagnose", "会话体检", "使用模型", "体检", "会诊", "诊断", "token", "用量"],
	},
	{
		id: "doctorAutoMode",
		sectionId: "doctor",
		label: "自动体检",
		description: "手动按需 / 会话闲置后 / 每日定时；自动模式会消耗所选模型的 Token",
		keywords: ["doctor", "auto", "自动体检", "会话体检", "体检", "闲置", "定时", "每日", "会诊"],
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
		label: "模型角色",
		description: "为各角色与子代理指定实际使用的模型，可全局设置或按项目覆盖",
		keywords: ["model", "role", "角色", "模型", "主力模型", "default", "task", "agent", "子代理", "代理", "点名", "override", "项目", "project", "全局"],
	},
	{
		id: "fallbackChainsPanel",
		sectionId: "model-fallback",
		label: "回退链与切换顺序",
		description: "角色失败后依次尝试的备选模型，以及会话内切换顺序与终端 /model 的保存位置",
		keywords: ["fallback", "回退", "回退链", "chain", "切换顺序", "cycleOrder", "保存位置", "modelRoleStorage", "/model"],
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

	// 规则文件
	{
		id: "agentsMdScope",
		sectionId: "agents-md",
		label: "规则文件范围（全局 / 当前项目）",
		description: "选择查看全局还是当前项目的规则文件",
		keywords: ["rules.md", "append_system", "rules", "agents.md", "agents", "规则", "规则文件", "指令", "上下文文件", "context file", "全局", "项目"],
	},
	{
		id: "agentsMdProjectFile",
		sectionId: "agents-md",
		label: "规则文件列表",
		description: "AGENTS.md、RULES.md、rules/*.md、APPEND_SYSTEM.md 的存在状态；点开一行就在该行下面查看和编辑，未创建的有一键创建；项目里 AGENTS.md 两个位置都有内容时 omp 只读 .omp/AGENTS.md",
		keywords: [".omp", "native", "位置", "覆盖"],
	},
	{
		id: "agentsMdEditor",
		sectionId: "agents-md",
		label: "编辑规则文件",
		description: "点开规则文件那一行，就在该行下面查看、编辑并保存内容，新会话生效",
		keywords: ["编辑", "保存", "预览", "markdown", "instructions", "长期说明", "约定"],
	},
	// 系统提示词
	{
		id: "promptCompositionOverview",
		sectionId: "prompt-composition",
		label: "系统提示词",
		description: "新会话一开始带多少内容：系统提示词、规则文件、Skills、工具说明、MCP 工具，按类别看 token 占比",
		keywords: ["系统提示词", "system prompt", "prompt", "token", "占用", "上下文", "规则文件", "skills", "工具说明", "mcp", "精简", "优化", "让 AI 帮我优化"],
	},
];

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
