import { BottomSheet } from "../../../ui/BottomSheet";

interface PromptLayer {
	name: string;
	desc: string;
	tokens: number;
	pct: number;
	source: string;
	icon: string;
}

const LAYERS: PromptLayer[] = [
	{
		name: "基础人设与交互边界 (Base Persona)",
		desc: "定义 OMP 核心助理角色、极简工程标准、避免重复造轮子与中文交流指引。",
		tokens: 1240,
		pct: 25,
		source: "内置核心",
		icon: "🤖",
	},
	{
		name: "工作区与运行环境 (Environment)",
		desc: "动态注入当前工作区绝对路径、操作系统类型、CPU 架构与可用 Git 分支。",
		tokens: 780,
		pct: 16,
		source: "运行时检测",
		icon: "💻",
	},
	{
		name: "工具与审批约束 (Tools & Permissions)",
		desc: "暴露所有可用工具定义（bash, read, edit, write, find 等）及其严格类型规范与审批级别。",
		tokens: 2150,
		pct: 43,
		source: "工具协议",
		icon: "🔧",
	},
	{
		name: "规则文件与跨会话记忆 (Rules & Memories)",
		desc: "自动加载 AGENTS.md、RULES.md 以及跨会话持久化在 ~/.omp/agent/ 中的历史教训。",
		tokens: 790,
		pct: 16,
		source: "项目与全局",
		icon: "📚",
	},
];

export function PromptCompositionSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const totalTokens = LAYERS.reduce((s, l) => s + l.tokens, 0);

	return (
		<BottomSheet open={open} onClose={onClose} title="系统提示词构成 (只读)">
			<div className="space-y-4 px-4 pb-8">
				{/* Overview */}
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-m-xs font-semibold text-m-text">总提示词体积</span>
						<span className="font-m-mono text-m-sm font-bold text-m-accent">
							~{(totalTokens / 1000).toFixed(1)}k tokens
						</span>
					</div>
					{/* Stacked bar */}
					<div className="flex h-2 w-full overflow-hidden rounded-full bg-m-surface-2">
						{LAYERS.map((l, i) => {
							const colors = ["#3186FF", "#10A37F", "#F59E0B", "#8B5CF6"];
							return (
								<div
									key={l.name}
									style={{ width: `${l.pct}%`, backgroundColor: colors[i % colors.length] }}
									className="h-full"
								/>
							);
						})}
					</div>
					<p className="text-[11px] text-m-text-3">
						系统提示词按层级组合并在每个会话开启时注入，为只读构成预览。
					</p>
				</div>

				{/* Layer list */}
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="text-m-xs font-semibold text-m-text">分层明细</div>

					<div className="space-y-2.5">
						{LAYERS.map((layer) => (
							<div key={layer.name} className="rounded-m-md border border-m-border bg-m-surface/40 p-2.5 space-y-1.5">
								<div className="flex items-center justify-between text-m-xs">
									<span className="font-medium text-m-text flex items-center gap-1.5">
										<span>{layer.icon}</span>
										<span>{layer.name}</span>
									</span>
									<span className="font-m-mono text-m-text-3">
										~{layer.tokens} ({layer.pct}%)
									</span>
								</div>
								<p className="text-[11px] text-m-text-3 leading-relaxed">{layer.desc}</p>
								<div className="text-[10px] text-m-text-3">来源：{layer.source}</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</BottomSheet>
	);
}
