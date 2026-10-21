/** Codex-style "+" Add menu in the Composer bottom toolbar. */
import { Check, FolderOpen, Lightbulb, Monitor, Paperclip, Signature, Target } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";

/**
 * Per-item icon hues. Fixed on purpose rather than theme tokens: several themes
 * (e.g. "light") collapse accent / error / warning into one hue, which would
 * turn the menu monochrome again. Mixing toward --text keeps each hue readable
 * on both light and dark panels.
 */
const tone = (hex: string) => `color-mix(in oklab, ${hex} 76%, var(--text))`;
const TONE = {
	files: tone("#3b82f6"),
	finder: tone("#14b8a6"),
	project: tone("#8b5cf6"),
	goal: tone("#f43f5e"),
	plan: tone("#f59e0b"),
	sketch: tone("#10b981"),
};

function Item({
	icon,
	color,
	title,
	desc,
	active,
	onClick,
}: {
	icon: ReactNode;
	color: string;
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
			<span className="flex w-4 shrink-0 justify-center" style={{ color }}>
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
	onSketch,
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
	onSketch: () => void;
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
			<div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-[var(--text-40,var(--text-dim))]">添加</div>
			<Item icon={<Paperclip size={14} />} color={TONE.files} title="文件" desc="从电脑选择并附加" onClick={run(onAddFiles)} />
			<Item icon={<Monitor size={14} />} color={TONE.finder} title="Finder 选中项" desc="附加当前在 Finder 中选中的文件" onClick={run(onAttachFinder)} />
			<div className="my-1 border-t border-[var(--line,var(--border-divider))]" />
			<Item icon={<FolderOpen size={14} />} color={TONE.project} title="在项目中工作" desc="为新聊天选择项目" onClick={run(onPickProject)} />
			<Item icon={<Target size={14} />} color={TONE.goal} title="目标" desc="设置要持续追求的目标" onClick={run(onGoal)} />
			<Item
				icon={<Lightbulb size={14} />}
				color={TONE.plan}
				title="规划模式"
				desc={planMode ? "关闭规划模式" : "开启规划模式"}
				active={planMode}
				onClick={run(onTogglePlan)}
			/>
			<Item icon={<Signature size={14} />} color={TONE.sketch} title="草图" desc="绘制草图" onClick={run(onSketch)} />
		</FloatingLayer>
	);
}
