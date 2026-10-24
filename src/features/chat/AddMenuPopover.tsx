/** Codex-style "+" Add menu in the Composer bottom toolbar. */
import { Check, FolderOpen, Lightbulb, Monitor, Paperclip, Signature, Target } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { useT } from "../../stores/language";

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
	const { t } = useT();
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
			<div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-[var(--text-40,var(--text-dim))]">{t("chat.addMenu.add")}</div>
			<Item icon={<Paperclip size={14} />} color={TONE.files} title={t("chat.addMenu.files")} desc={t("chat.addMenu.filesDesc")} onClick={run(onAddFiles)} />
			<Item icon={<Monitor size={14} />} color={TONE.finder} title={t("chat.addMenu.finder")} desc={t("chat.addMenu.finderDesc")} onClick={run(onAttachFinder)} />
			<div className="my-1 border-t border-[var(--line,var(--border-divider))]" />
			<Item icon={<FolderOpen size={14} />} color={TONE.project} title={t("chat.addMenu.workInProject")} desc={t("chat.addMenu.workInProjectDesc")} onClick={run(onPickProject)} />
			<Item icon={<Target size={14} />} color={TONE.goal} title={t("chat.addMenu.goal")} desc={t("chat.addMenu.goalDesc")} onClick={run(onGoal)} />
			<Item
				icon={<Lightbulb size={14} />}
				color={TONE.plan}
				title={t("chat.addMenu.planMode")}
				desc={planMode ? t("chat.addMenu.disablePlan") : t("chat.addMenu.enablePlan")}
				active={planMode}
				onClick={run(onTogglePlan)}
			/>
			<Item icon={<Signature size={14} />} color={TONE.sketch} title={t("chat.addMenu.sketch")} desc={t("chat.addMenu.sketchDesc")} onClick={run(onSketch)} />
		</FloatingLayer>
	);
}
