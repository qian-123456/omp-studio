import { BookOpen, Briefcase, ChevronDown, Code2, FlaskConical, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useSessions } from "../../core/stores/sessions";
import type { SpaceMode } from "../../core/types";
import { ActionSheet } from "./ActionSheets";
import { MODES, modeLabel, needsAttn } from "./tree";
import { useTree } from "./treeStore";

export const MODE_ICON: Record<SpaceMode, ReactNode> = {
	code: <Code2 size={18} />,
	work: <Briefcase size={18} />,
	study: <BookOpen size={18} />,
	research: <FlaskConical size={18} />,
	chat: <MessageSquare size={18} />,
};

const Dot = () => <span aria-label="有运行中的会话" className="size-2 rounded-full bg-m-accent" />;

/**
 * Mode switcher (代码/工作/学习/研究/聊天). Activity dots use the flat session list: a mode is marked busy when
 * one of its non-archived sessions is working or waiting.
 */
export function ModeSwitch({ onChange }: { onChange?: () => void }) {
	const mode = useTree((s) => s.mode);
	const list = useSessions((s) => s.list);
	const [open, setOpen] = useState(false);
	const busy = (m: SpaceMode) => list.some((s) => (s.mode ?? "code") === m && !s.archived && needsAttn(s));
	const otherBusy = MODES.some(([m]) => m !== mode && busy(m));
	return (
		<>
			<button
				type="button"
				aria-haspopup="menu"
				aria-label={`${modeLabel(mode)}模式，点击切换`}
				onClick={() => setOpen(true)}
				className="relative inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-m-pill border border-m-border bg-m-surface px-4 text-m-sm font-medium text-m-text active:bg-m-surface-hover"
			>
				{MODE_ICON[mode]}
				{modeLabel(mode)}
				<ChevronDown size={16} className="text-m-text-3" />
				{otherBusy && <span className="absolute right-1 top-1 size-2 rounded-full bg-m-accent" />}
			</button>
			<ActionSheet
				open={open}
				title="切换模式"
				onClose={() => setOpen(false)}
				items={MODES.map(([m, label]) => ({
					key: m,
					active: m === mode,
					label: (
						<span className="flex items-center gap-2">
							{MODE_ICON[m]}
							{label}
							{m !== mode && busy(m) && <Dot />}
							{m === mode && <span className="text-m-accent">已选</span>}
						</span>
					),
					run: () => {
						useTree.getState().setMode(m);
						onChange?.();
					},
				}))}
			/>
		</>
	);
}
