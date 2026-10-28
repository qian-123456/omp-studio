import { BookOpen, Bot, Monitor, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Chip, ListGroup } from "../../../ui";
import { GroupBlock, SettingRow, SettingsSheet } from "../rows";

interface PromptLayer {
	name: string;
	desc: string;
	tokens: number;
	pct: number;
	source: string;
	icon: ReactNode;
}

const ICON = { size: 22, strokeWidth: 1.75 } as const;

const LAYERS: PromptLayer[] = [
	{
		name: "基础人设与交互边界",
		desc: "定义 OMP 助理的角色、工程标准和中文交流方式。",
		tokens: 1240,
		pct: 25,
		source: "内置核心",
		icon: <Bot {...ICON} />,
	},
	{
		name: "工作区与运行环境",
		desc: "注入当前工作区路径、操作系统、CPU 架构和 Git 分支。",
		tokens: 780,
		pct: 16,
		source: "运行时检测",
		icon: <Monitor {...ICON} />,
	},
	{
		name: "工具与审批约束",
		desc: "列出全部可用工具（bash、read、edit、write、find 等）的定义和审批级别。",
		tokens: 2150,
		pct: 43,
		source: "工具协议",
		icon: <Wrench {...ICON} />,
	},
	{
		name: "规则文件与跨会话记忆",
		desc: "自动加载 AGENTS.md、RULES.md 和 ~/.omp/agent/ 里保存的历史经验。",
		tokens: 790,
		pct: 16,
		source: "项目与全局",
		icon: <BookOpen {...ICON} />,
	},
];

/** Rounded share bar: accent fill on a surface-2 track. */
function ShareBar({ pct, label }: { pct: number; label: string }) {
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={pct}
			className="h-2 w-full overflow-hidden rounded-m-pill bg-m-surface-2"
		>
			<div className="h-full rounded-m-pill bg-m-accent" style={{ width: `${pct}%` }} />
		</div>
	);
}

/** Read-only breakdown of the system prompt layers and their token share. */
export function PromptCompositionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const totalTokens = LAYERS.reduce((s, l) => s + l.tokens, 0);

	return (
		<SettingsSheet
			open={open}
			onClose={onClose}
			title="系统提示词构成 (只读)"
			subtitle="每个会话开始时按下面的层级拼成系统提示词。这里只能查看。"
		>
			<ListGroup title="总体积">
				<GroupBlock>
					<div className="flex items-baseline justify-between gap-3">
						<span className="text-m-md text-m-text">合计</span>
						<span className="font-m-mono text-m-lg text-m-text">约 {(totalTokens / 1000).toFixed(1)}k tokens</span>
					</div>
				</GroupBlock>
			</ListGroup>

			<ListGroup title="分层明细">
				{LAYERS.map((layer) => (
					<SettingRow key={layer.name} icon={layer.icon} name={layer.name} hint={layer.desc} stacked>
						<ShareBar pct={layer.pct} label={`${layer.name}占比`} />
						<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
							<span className="font-m-mono text-m-xs whitespace-nowrap text-m-text-3">
								约 {layer.tokens} tokens · {layer.pct}%
							</span>
							<Chip>{layer.source}</Chip>
						</div>
					</SettingRow>
				))}
			</ListGroup>
		</SettingsSheet>
	);
}
