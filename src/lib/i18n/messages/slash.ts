import { defineMessages } from "../define";

export default defineMessages({
	"zh-CN": {
		"group.session": "会话",
		"group.model": "模型",
		"group.status": "状态",
		"group.integration": "集成",
		"group.settings": "设置",
		"group.skill": "技能",
		"group.custom": "自定义命令",
		"group.extension": "扩展",
		"group.omp": "更多 OMP 命令",
		"group.subcommand": "子命令",
		"group.mcp": "MCP 服务器",
		"group.plugin": "插件",

		menuAriaLabel: "斜杠命令",
		noMatchingCommands: "无匹配命令",
		openSettings: "去设置",
		openSettingsFor: "去设置 {name}",
		menuFooterRun: "↑↓ 选择 · ↵ 执行 · Esc 关闭",
		menuFooterSelect: "↑↓ 选择 · ↵ 选择 · Esc 关闭",
		argHintSupplemental: "[补充说明]",
		subcommandHint: "<子命令>",
		subcommandDirectRun: "直接运行",
		subcommandDirectRunDesc: "直接运行：{desc}",
		enabled: "已启用",
		disabled: "已禁用",
		sourceScope: "来源: {scope}",
		nothingToCompact: "当前上下文无需再压缩",
		execFailed: "/{name} 失败: {error}",
		trackFailed: "/{command} 失败：{error}",

		outputRunning: "进行中",
		outputClose: "关闭",
		outputCloseAria: "关闭命令输出",
		outputCollapse: "收起",
		outputExpandAll: "展开全部",

		"statusCard.notSet": "未设置",
		"statusCard.on": "开启",
		"statusCard.off": "关闭",
		"statusCard.modelLabel": "模型",
		"statusCard.thinkingLabel": "思考等级",
		"statusCard.fastModeLabel": "快速模式",
		"statusCard.contextLabel": "上下文",
		"statusCard.usageLabel": "用量",
		"statusCard.messageCountLabel": "消息数",
		"statusCard.queuedMessageCountLabel": "排队消息",
		"statusCard.directoryLabel": "目录",
		"statusCard.sessionFileLabel": "会话文件",

		"cmd.new.title": "新会话",
		"cmd.new.desc": "在当前目录开始一个新会话",
		"cmd.new.abortNoCwd": "无法确定当前目录",
		"cmd.new.success": "已创建新会话",

		"cmd.fork.title": "分支",
		"cmd.fork.desc": "复制当前对话为新会话；可附带第一条消息",
		"cmd.fork.argHint": "[消息]",
		"cmd.fork.abortInFork": "已在分支草稿中，直接发送消息即可",

		"cmd.btw.title": "顺便问一句",
		"cmd.btw.desc": "开一个辅助对话提问，不打断当前会话",
		"cmd.btw.argHint": "[问题]",

		"cmd.rename.title": "重命名",
		"cmd.rename.desc": "修改当前会话的名称",
		"cmd.rename.argHint": "<名称>",
		"cmd.rename.usage": "用法: /rename <名称>",
		"cmd.rename.tracking": "正在重命名",
		"cmd.rename.result": "已重命名为「{name}」",

		"cmd.compact.title": "压缩上下文",
		"cmd.compact.desc": "压缩会话上下文，可附带自定义指令",
		"cmd.compact.argHint": "[指令]",

		"cmd.handoff.title": "交接",
		"cmd.handoff.desc": "总结当前会话为交接文档并压缩上下文",
		"cmd.handoff.saved": "交接文档已保存：{path}",

		"cmd.shake.title": "精简上下文",
		"cmd.shake.desc": "丢弃上下文中的大块内容（工具结果、大段代码块），不调用模型",

		"cmd.export.title": "导出 HTML",
		"cmd.export.desc": "导出当前会话为 HTML 并在访达中显示",
		"cmd.export.tracking": "正在导出 HTML",
		"cmd.export.result": "已导出 HTML：{path}",

		"cmd.copy.title": "复制回复",
		"cmd.copy.desc": "复制最近一条助手回复到剪贴板",
		"cmd.copy.tracking": "正在复制最近一条助手回复",
		"cmd.copy.empty": "暂无可复制的助手回复",
		"cmd.copy.result": "已复制最近一条助手回复",

		"cmd.retry.title": "重试",
		"cmd.retry.desc": "重试上一次失败的回合",

		"cmd.resume.title": "继续",
		"cmd.resume.desc": "恢复上一次被打断的回合",
		"cmd.resume.noTurn": "没有可恢复的回合",

		"cmd.plan.title": "规划模式",
		"cmd.plan.desc": "切换规划模式：先出计划再执行",
		"cmd.plan.on": "规划模式已开启：发送需求后生成计划",
		"cmd.plan.off": "规划模式已关闭",

		"cmd.goal.title": "目标",
		"cmd.goal.desc": "设置或更新持续追求的目标",
		"cmd.goal.argHint": "<目标描述 | pause | resume | off>",
		"cmd.goal.current": "当前目标：{goal}",
		"cmd.goal.noGoal": "当前没有目标",
		"cmd.goal.dropTracking": "正在清除目标",
		"cmd.goal.dropResult": "已清除目标",
		"cmd.goal.pauseTracking": "正在暂停目标",
		"cmd.goal.pauseResult": "已暂停目标",
		"cmd.goal.resumeTracking": "正在恢复目标",
		"cmd.goal.resumeResult": "已恢复目标",
		"cmd.goal.setTracking": "正在设置目标",
		"cmd.goal.setResult": "已设置目标：{goal}",

		"cmd.model.title": "切换模型",
		"cmd.model.desc": "打开模型选择器切换当前会话模型",

		"cmd.thinking.title": "思考等级",
		"cmd.thinking.desc": "打开思考等级选择器",

		"cmd.fast.title": "快速模式",
		"cmd.fast.desc": "切换快速服务档位",
		"cmd.fast.tracking": "正在切换快速模式",
		"cmd.fast.on": "已开启快速模式",
		"cmd.fast.off": "已关闭快速模式",

		"cmd.slow.title": "慢速模式",
		"cmd.slow.desc": "切换低优先级/经济服务档位",
		"cmd.slow.tracking": "正在切换慢速模式",
		"cmd.slow.on": "已开启慢速模式",
		"cmd.slow.off": "已关闭慢速模式",

		"cmd.advisor.title": "顾问模型",
		"cmd.advisor.desc": "切换顾问模型介入",

		"cmd.status.title": "会话状态",
		"cmd.status.desc": "查看模型、上下文、用量与队列概况",

		"cmd.context.title": "上下文占用",
		"cmd.context.desc": "查看上下文窗口的占用明细",

		"cmd.usage.title": "用量",
		"cmd.usage.desc": "查看供应商订阅与配额",

		"cmd.tools.title": "工具列表",
		"cmd.tools.desc": "列出当前对代理可见的工具",

		"cmd.jobs.title": "后台任务",
		"cmd.jobs.desc": "查看异步后台任务状态",

		"cmd.stats.title": "统计",
		"cmd.stats.desc": "查看会话统计数据",

		"cmd.mcp.title": "MCP 服务器",
		"cmd.mcp.desc": "管理 MCP 服务器",

		"cmd.plugins.title": "插件",
		"cmd.plugins.desc": "管理插件与扩展市场",

		"cmd.memory.title": "记忆",
		"cmd.memory.desc": "维护记忆后端",

		"cmd.browser.title": "浏览器",
		"cmd.browser.desc": "切换浏览器可见模式",

		"cmd.computer.title": "计算机操作",
		"cmd.computer.desc": "切换计算机操作能力",

		"cmd.extendedContext.title": "扩展上下文",
		"cmd.extendedContext.desc": "切换扩展上下文窗口",

		"cmd.agents.title": "子代理",
		"cmd.agents.desc": "配置子代理",

		"cmd.approvals.title": "审批",
		"cmd.approvals.desc": "配置工具审批规则",

		"cmd.login.title": "登录",
		"cmd.login.desc": "管理供应商登录",

		"cmd.settings.title": "设置",
		"cmd.settings.desc": "打开应用设置",

		"cmd.init.title": "初始化项目",
		"cmd.init.desc": "为当前项目生成 AGENTS.md 等配置",

		"cmd.share.title": "分享会话",
		"cmd.share.desc": "生成当前会话的分享链接",
		"cmd.share.confirmMessage": "将把本会话加密后上传到 OMP 分享服务。拿到链接的任何人都能查看内容，已知密钥会自动脱敏。继续？",
		"cmd.share.confirmTitle": "创建分享链接",
		"cmd.share.confirmOk": "创建并复制",
		"cmd.share.tracking": "正在生成分享链接",
		"cmd.share.result": "分享链接已复制：{url}",

		"cmd.review.title": "代码审查",
		"cmd.review.desc": "让代理审查当前改动",
		"cmd.review.argHint": "[说明]",

		"cmd.changelog.title": "更新日志",
		"cmd.changelog.desc": "查看 omp 版本更新内容",

		"cmd.security.title": "安全检查",
		"cmd.security.desc": "检查环境与权限配置",

		"cmd.visualize.title": "Visualize",
		"cmd.visualize.desc": "创建可视化和交互工具",
		"cmd.visualize.argHint": "<要可视化的内容>",
	},
	"en-US": {
		"group.session": "Session",
		"group.model": "Model",
		"group.status": "Status",
		"group.integration": "Integrations",
		"group.settings": "Settings",
		"group.skill": "Skills",
		"group.custom": "Custom Commands",
		"group.extension": "Extensions",
		"group.omp": "More OMP Commands",
		"group.subcommand": "Subcommands",
		"group.mcp": "MCP Servers",
		"group.plugin": "Plugins",

		menuAriaLabel: "Slash commands",
		noMatchingCommands: "No matching commands",
		openSettings: "Open Settings",
		openSettingsFor: "Open Settings for {name}",
		menuFooterRun: "↑↓ navigate · ↵ execute · Esc close",
		menuFooterSelect: "↑↓ navigate · ↵ select · Esc close",
		argHintSupplemental: "[arguments]",
		subcommandHint: "<subcommand>",
		subcommandDirectRun: "Run directly",
		subcommandDirectRunDesc: "Run directly: {desc}",
		enabled: "Enabled",
		disabled: "Disabled",
		sourceScope: "Source: {scope}",
		nothingToCompact: "Current context does not need further compaction",
		execFailed: "/{name} failed: {error}",
		trackFailed: "/{command} failed: {error}",

		outputRunning: "Running",
		outputClose: "Close",
		outputCloseAria: "Close command output",
		outputCollapse: "Collapse",
		outputExpandAll: "Expand all",

		"statusCard.notSet": "Not set",
		"statusCard.on": "On",
		"statusCard.off": "Off",
		"statusCard.modelLabel": "Model",
		"statusCard.thinkingLabel": "Thinking Level",
		"statusCard.fastModeLabel": "Fast Mode",
		"statusCard.contextLabel": "Context",
		"statusCard.usageLabel": "Usage",
		"statusCard.messageCountLabel": "Messages",
		"statusCard.queuedMessageCountLabel": "Queued Messages",
		"statusCard.directoryLabel": "Directory",
		"statusCard.sessionFileLabel": "Session File",

		"cmd.new.title": "New Session",
		"cmd.new.desc": "Start a new session in current directory",
		"cmd.new.abortNoCwd": "Cannot determine current directory",
		"cmd.new.success": "Created new session",

		"cmd.fork.title": "Fork",
		"cmd.fork.desc": "Fork current conversation into a new session; optionally with a first message",
		"cmd.fork.argHint": "[message]",
		"cmd.fork.abortInFork": "Already in fork draft, send a message directly",

		"cmd.btw.title": "By the way",
		"cmd.btw.desc": "Ask in a side chat without interrupting the current session",
		"cmd.btw.argHint": "[question]",

		"cmd.rename.title": "Rename",
		"cmd.rename.desc": "Rename the current session",
		"cmd.rename.argHint": "<name>",
		"cmd.rename.usage": "Usage: /rename <name>",
		"cmd.rename.tracking": "Renaming",
		"cmd.rename.result": "Renamed to \"{name}\"",

		"cmd.compact.title": "Compact Context",
		"cmd.compact.desc": "Compact session context, optionally with custom instructions",
		"cmd.compact.argHint": "[instructions]",

		"cmd.handoff.title": "Handoff",
		"cmd.handoff.desc": "Summarize session into a handoff document and compact context",
		"cmd.handoff.saved": "Handoff document saved: {path}",

		"cmd.shake.title": "Shake Context",
		"cmd.shake.desc": "Drop large chunks from context (tool results, big code blocks) without calling models",

		"cmd.export.title": "Export HTML",
		"cmd.export.desc": "Export current session as HTML and reveal in Finder",
		"cmd.export.tracking": "Exporting HTML",
		"cmd.export.result": "HTML exported: {path}",

		"cmd.copy.title": "Copy Reply",
		"cmd.copy.desc": "Copy latest assistant reply to clipboard",
		"cmd.copy.tracking": "Copying latest assistant reply",
		"cmd.copy.empty": "No assistant reply available to copy",
		"cmd.copy.result": "Copied latest assistant reply",

		"cmd.retry.title": "Retry",
		"cmd.retry.desc": "Retry the last failed turn",

		"cmd.resume.title": "Resume",
		"cmd.resume.desc": "Resume the last interrupted turn",
		"cmd.resume.noTurn": "No turn to resume",

		"cmd.plan.title": "Plan Mode",
		"cmd.plan.desc": "Toggle plan mode: generate a plan before executing",
		"cmd.plan.on": "Plan mode enabled: plans are generated upon prompt",
		"cmd.plan.off": "Plan mode disabled",

		"cmd.goal.title": "Goal",
		"cmd.goal.desc": "Set or update ongoing objective",
		"cmd.goal.argHint": "<objective | pause | resume | off>",
		"cmd.goal.current": "Current goal: {goal}",
		"cmd.goal.noGoal": "No active goal",
		"cmd.goal.dropTracking": "Clearing goal",
		"cmd.goal.dropResult": "Goal cleared",
		"cmd.goal.pauseTracking": "Pausing goal",
		"cmd.goal.pauseResult": "Goal paused",
		"cmd.goal.resumeTracking": "Resuming goal",
		"cmd.goal.resumeResult": "Goal resumed",
		"cmd.goal.setTracking": "Setting goal",
		"cmd.goal.setResult": "Goal set: {goal}",

		"cmd.model.title": "Switch Model",
		"cmd.model.desc": "Open model picker to switch model for current session",

		"cmd.thinking.title": "Thinking Level",
		"cmd.thinking.desc": "Open thinking level picker",

		"cmd.fast.title": "Fast Mode",
		"cmd.fast.desc": "Toggle fast service tier",
		"cmd.fast.tracking": "Toggling fast mode",
		"cmd.fast.on": "Fast mode enabled",
		"cmd.fast.off": "Fast mode disabled",

		"cmd.slow.title": "Slow Mode",
		"cmd.slow.desc": "Toggle low priority / economy service tier",
		"cmd.slow.tracking": "Toggling slow mode",
		"cmd.slow.on": "Slow mode enabled",
		"cmd.slow.off": "Slow mode disabled",

		"cmd.advisor.title": "Advisor Model",
		"cmd.advisor.desc": "Configure advisor model intervention",

		"cmd.status.title": "Session Status",
		"cmd.status.desc": "View overview of model, context, usage and queue",

		"cmd.context.title": "Context Usage",
		"cmd.context.desc": "View context window usage breakdown",

		"cmd.usage.title": "Usage",
		"cmd.usage.desc": "View provider subscriptions and quotas",

		"cmd.tools.title": "Tools",
		"cmd.tools.desc": "List tools currently available to the agent",

		"cmd.jobs.title": "Background Jobs",
		"cmd.jobs.desc": "View async background job statuses",

		"cmd.stats.title": "Statistics",
		"cmd.stats.desc": "View session statistics",

		"cmd.mcp.title": "MCP Servers",
		"cmd.mcp.desc": "Manage MCP servers",

		"cmd.plugins.title": "Plugins",
		"cmd.plugins.desc": "Manage plugins and extensions marketplace",

		"cmd.memory.title": "Memory",
		"cmd.memory.desc": "Manage memory backend",

		"cmd.browser.title": "Browser",
		"cmd.browser.desc": "Toggle visible browser mode",

		"cmd.computer.title": "Computer Use",
		"cmd.computer.desc": "Toggle computer use capabilities",

		"cmd.extendedContext.title": "Extended Context",
		"cmd.extendedContext.desc": "Toggle extended context window",

		"cmd.agents.title": "Sub-agents",
		"cmd.agents.desc": "Configure sub-agents",

		"cmd.approvals.title": "Approvals",
		"cmd.approvals.desc": "Configure tool approval rules",

		"cmd.login.title": "Log In",
		"cmd.login.desc": "Manage provider logins",

		"cmd.settings.title": "Settings",
		"cmd.settings.desc": "Open application settings",

		"cmd.init.title": "Initialize Project",
		"cmd.init.desc": "Generate AGENTS.md and configuration for current project",

		"cmd.share.title": "Share Session",
		"cmd.share.desc": "Generate share link for current session",
		"cmd.share.confirmMessage": "This session will be encrypted and uploaded to the OMP share service. Anyone with the link can view it; known secrets will be masked. Continue?",
		"cmd.share.confirmTitle": "Create Share Link",
		"cmd.share.confirmOk": "Create and Copy",
		"cmd.share.tracking": "Generating share link",
		"cmd.share.result": "Share link copied: {url}",

		"cmd.review.title": "Code Review",
		"cmd.review.desc": "Have the agent review current changes",
		"cmd.review.argHint": "[notes]",

		"cmd.changelog.title": "Changelog",
		"cmd.changelog.desc": "View OMP release changelog",

		"cmd.security.title": "Security Check",
		"cmd.security.desc": "Check environment and permission configurations",

		"cmd.visualize.title": "Visualize",
		"cmd.visualize.desc": "Create interactive tools and visualizations",
		"cmd.visualize.argHint": "<content to visualize>",
	},
});
