import { Sparkles, SquareSlash } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

interface CommandItem {
	name: string;
	desc: string;
	type: "skill" | "slash";
}

const ITEMS: CommandItem[] = [
	{ name: "/compact", desc: "手动压缩当前会话的上下文", type: "slash" },
	{ name: "/doctor", desc: "检查当前会话的健康度和提问方式", type: "slash" },
	{ name: "/diff", desc: "查看工作区还没提交的 Git 改动", type: "slash" },
	{ name: "git-commit-task", desc: "分析改动，按约定格式生成提交信息", type: "skill" },
	{ name: "reverse-engineer", desc: "逆向分析二进制程序和通信协议", type: "skill" },
	{ name: "answer-me-with-html", desc: "用网页画出流程图、交互演示和对比表", type: "skill" },
];

const ICON = { size: 22, strokeWidth: 1.75 } as const;

function Group({ title, type }: { title: string; type: CommandItem["type"] }) {
	return (
		<ListGroup title={title}>
			{ITEMS.filter((it) => it.type === type).map((it) => (
				<ListRow
					key={it.name}
					icon={type === "slash" ? <SquareSlash {...ICON} /> : <Sparkles {...ICON} />}
					title={<span className="font-m-mono break-all">{it.name}</span>}
					subtitle={it.desc}
				/>
			))}
		</ListGroup>
	);
}

/** Read-only list of slash commands and auto-activated skills. */
export function SkillsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet
			open={open}
			onClose={onClose}
			title="技能与命令"
			subtitle="在输入框输入 / 可以使用斜杠命令；技能会在合适的场景下由智能体自动启用。"
		>
			<Group title="斜杠命令" type="slash" />
			<Group title="自动技能" type="skill" />
		</SettingsSheet>
	);
}
