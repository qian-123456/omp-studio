import { BookOpen, Briefcase, ChevronDown, Code2, FlaskConical, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useSessions } from "../../core/stores/sessions";
import type { SpaceMode } from "../../core/types";
import { ActionSheet } from "./ActionSheets";
import { MODES, modeLabel, needsAttn } from "./tree";
import { useTree } from "./treeStore";

const ICONS: Record<SpaceMode, typeof Code2> = {
	code: Code2,
	work: Briefcase,
	study: BookOpen,
	research: FlaskConical,
	chat: MessageSquare,
};

/**
 * Space switcher (代码/工作/学习/研究/聊天): a small tonal pill opening a menu sheet. Activity dots use the flat
 * session list: a space is marked busy when one of its non-archived sessions is working or waiting.
 */
export function ModeSwitch({ onChange }: { onChange?: () => void }) {
	const mode = useTree((s) => s.mode);
	const list = useSessions((s) => s.list);
	const [open, setOpen] = useState(false);
	const busy = (m: SpaceMode) => list.some((s) => (s.mode ?? "code") === m && !s.archived && needsAttn(s));
	const otherBusy = MODES.some(([m]) => m !== mode && busy(m));
	const Icon = ICONS[mode];
	return (
		<>
			<button
				type="button"
				aria-haspopup="menu"
				aria-label={`${modeLabel(mode)}空间，点击切换`}
				onClick={() => setOpen(true)}
				className="group flex min-h-11 shrink-0 items-center"
			>
				<span className="relative inline-flex h-9 items-center gap-1.5 rounded-m-pill bg-m-surface pr-2.5 pl-3 text-m-sm font-medium whitespace-nowrap text-m-text transition-colors duration-(--m-dur-fast) group-active:bg-m-surface-2">
					<Icon size={16} strokeWidth={1.75} className="text-m-text-2" />
					{modeLabel(mode)}
					<ChevronDown size={16} strokeWidth={1.75} className="text-m-text-3" />
					{otherBusy && <span aria-label="其他空间有运行中的会话" className="absolute -top-0.5 -right-0.5 size-2.5 rounded-m-pill bg-m-accent" />}
				</span>
			</button>
			<ActionSheet
				open={open}
				title="切换空间"
				onClose={() => setOpen(false)}
				items={MODES.map(([m, label]) => {
					const ItemIcon = ICONS[m];
					return {
						key: m,
						active: m === mode,
						icon: <ItemIcon size={22} strokeWidth={1.75} />,
						label,
						hint: m !== mode && busy(m) ? "有运行中或待回复的会话" : undefined,
						run: () => {
							useTree.getState().setMode(m);
							onChange?.();
						},
					};
				})}
			/>
		</>
	);
}
