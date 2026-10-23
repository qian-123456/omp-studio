import { AgentDefsPanel } from "./AgentDefsPanel";
import { MemoryFilesPanel } from "./MemoryFilesPanel";
import { OmpSettingsPage } from "../OmpSettingsList";

export function ThinkingSection() {
	return <OmpSettingsPage page="thinking" title="思考与采样" description="思考深度与预算、温度等采样参数、回复风格" />;
}

export function HelperModelsSection() {
	return <OmpSettingsPage page="helper-models" title="辅助模型" description="顾问模型、预探、图片识别等会额外调用模型的功能" />;
}

export function ToolsSection() {
	return <OmpSettingsPage page="tools" title="工具" description="AI 能用哪些工具、哪些要先审批、输出多长" />;
}

export function FilesSection() {
	return <OmpSettingsPage page="files" title="文件读写" description="AI 读取和编辑文件的方式，以及代码诊断（LSP）" />;
}

export function ShellSection() {
	return <OmpSettingsPage page="shell" title="命令行" description="AI 执行 Shell 命令、运行 Python / JS 代码的方式" />;
}

export function SubagentsSection() {
	return (
		<OmpSettingsPage
			page="subagents"
			title="子代理"
			description="子代理的提示词与定义，以及并发、时长和深度限制和隔离运行方式"
			lead={<AgentDefsPanel />}
		/>
	);
}

export function MemorySection() {
	return (
		<div className="space-y-6">
			<OmpSettingsPage page="memory" title="记忆" description="AI 跨会话记住什么、存在哪里" />
			<MemoryFilesPanel />
		</div>
	);
}

export function SkillsSection() {
	return <OmpSettingsPage page="skills" title="技能与命令" description="从哪些目录加载技能和自定义命令" />;
}

export function WebSection() {
	return <OmpSettingsPage page="web" title="联网搜索" description="AI 联网搜索和抓取网页时用的服务" />;
}
