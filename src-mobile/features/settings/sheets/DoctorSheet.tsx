import { Coins, ShieldAlert, Target } from "lucide-react";
import type { ReactNode } from "react";
import { Chip, ListGroup, ListRow } from "../../../ui";
import type { ChipTone } from "../../../ui";
import { SettingsSheet } from "../rows";

interface Issue {
	icon: ReactNode;
	title: string;
	detail: string;
	status: string;
	tone: ChipTone;
}

const ISSUES: Issue[] = [
	{
		icon: <Coins size={22} strokeWidth={1.75} />,
		title: "大文件重复整篇读取",
		detail: "多次整篇读取超过 500 行的代码文件。建议在主提示词里让智能体先用 grep 定位，再按行范围读取。",
		status: "中等风险",
		tone: "warn",
	},
	{
		icon: <Target size={22} strokeWidth={1.75} />,
		title: "多个需求混在一次提问",
		detail: "把大功能拆成可单独验收的小目标后，工具调用失败率降低了 45%。",
		status: "已改善",
		tone: "success",
	},
	{
		icon: <ShieldAlert size={22} strokeWidth={1.75} />,
		title: "改完代码没有跑类型检查",
		detail: "多处修改后没有直接运行 tsc --noEmit，类型可能悄悄出错。",
		status: "低风险",
		tone: "neutral",
	},
];

const METRICS: { name: string; value: string; cls: string }[] = [
	{ name: "工具执行成功率", value: "98.2%", cls: "text-m-success" },
	{ name: "平均重试次数", value: "1.2 倍", cls: "text-m-text" },
	{ name: "上下文膨胀", value: "良好", cls: "text-m-success" },
];

/** Read-only session health report. */
export function DoctorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet
			open={open}
			onClose={onClose}
			title="会话体检 (只读)"
			subtitle="分析上下文瘦身空间、提问方式和改代码的风险，帮你用更少的 token 得到更准的结果。数据只在本机处理。"
		>
			<ListGroup title="长期共性问题 Top 3">
				{ISSUES.map((it) => (
					<ListRow
						key={it.title}
						icon={it.icon}
						title={it.title}
						subtitle={it.detail}
						right={<Chip tone={it.tone}>{it.status}</Chip>}
					/>
				))}
			</ListGroup>

			<ListGroup title="健康指标监控">
				{METRICS.map((m) => (
					<ListRow key={m.name} title={m.name} right={<span className={`font-m-mono text-m-md ${m.cls}`}>{m.value}</span>} />
				))}
			</ListGroup>
		</SettingsSheet>
	);
}
