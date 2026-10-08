/** Codex-style "+" Add menu in the Composer bottom toolbar. */
import clsx from "clsx";
import { Check, FolderOpen, Lightbulb, Monitor, Paperclip, Target } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";

function Item({
	icon,
	title,
	desc,
	active,
	onClick,
}: {
	icon: ReactNode;
	title: string;
	desc: string;
	active?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-[var(--ghost-hover,var(--bg-hover))]"
		>
			<span
				className={clsx(
					"flex w-4 shrink-0 justify-center",
					active ? "text-amber-500" : "text-[var(--text-60,var(--text-muted))]",
				)}
			>
				{icon}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[12.5px] text-[var(--text)]">{title}</span>
				<span className="block truncate text-[11px] text-[var(--text-40,var(--text-dim))]">{desc}</span>
			</span>
			{active && <Check size={13} className="shrink-0 text-[var(--text)]" />}
		</button>
	);
}

export function AddMenuPopover({
	anchor,
	ignoreRef,
	planMode,
	onClose,
	onAddFiles,
	onAttachFinder,
	onPickProject,
	onGoal,
	onTogglePlan,
}: {
	anchor: HTMLElement | null;
	ignoreRef: RefObject<HTMLElement | null>;
	planMode: boolean;
	onClose: () => void;
	onAddFiles: () => void;
	onAttachFinder: () => void;
	onPickProject: () => void;
	onGoal: () => void;
	onTogglePlan: () => void;
}) {
	const run = (fn: () => void) => () => {
		onClose();
		fn();
	};
	return (
		<FloatingLayer
			anchor={anchor}
			placement="top-start"
			offset={6}
			layer="popover"
			ignoreRefs={[ignoreRef]}
			onDismiss={onClose}
			className="w-[280px] rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] p-1"
		>
			<div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-[var(--text-40,var(--text-dim))]">Add</div>
			<Item icon={<Paperclip size={14} />} title="Files and folders" desc="添加文件和文件夹" onClick={run(onAddFiles)} />
			<Item icon={<Monitor size={14} />} title="Attach Finder" desc="附加 Finder 当前选中项" onClick={run(onAttachFinder)} />
			<div className="my-1 border-t border-[var(--line,var(--border-divider))]" />
			<Item icon={<FolderOpen size={14} />} title="Work in a project" desc="Choose project for new chats" onClick={run(onPickProject)} />
			<Item icon={<Target size={14} />} title="Goal" desc="Set a goal to keep pursuing" onClick={run(onGoal)} />
			<Item
				icon={<Lightbulb size={14} />}
				title="Plan mode"
				desc={planMode ? "Turn plan mode off" : "Turn plan mode on"}
				active={planMode}
				onClick={run(onTogglePlan)}
			/>
		</FloatingLayer>
	);
}
