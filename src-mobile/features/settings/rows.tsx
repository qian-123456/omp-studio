import type { ReactNode } from "react";
import { BottomSheet, ListRow } from "../../ui";

/**
 * Settings sub-page sheet: Gemini page sheet (handle, close circle, large left title) with the
 * content as `ListGroup`s and room below the last group.
 */
export function SettingsSheet({
	open,
	onClose,
	title,
	subtitle,
	headerRight,
	footer,
	children,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: ReactNode;
	headerRight?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	return (
		<BottomSheet open={open} onClose={onClose} title={title} subtitle={subtitle} headerRight={headerRight} footer={footer} fullHeight>
			<div className="flex flex-col gap-2 pb-8">{children}</div>
		</BottomSheet>
	);
}

/**
 * One setting inside a `ListGroup`: label + hint, the control on the right (switches, short
 * values) or below the text when `stacked` (segmented controls, steppers, inputs).
 * `reason` explains in warn colour why the control is unavailable.
 */
export function SettingRow({
	name,
	hint,
	reason,
	icon,
	stacked = false,
	children,
}: {
	name: ReactNode;
	hint?: ReactNode;
	reason?: ReactNode;
	icon?: ReactNode;
	stacked?: boolean;
	children?: ReactNode;
}) {
	const sub =
		hint != null || reason != null ? (
			<>
				{hint}
				{reason != null && <span className="mt-0.5 block text-m-warn">{reason}</span>}
			</>
		) : undefined;
	if (!stacked) return <ListRow icon={icon} title={name} subtitle={sub} right={children} chevron={false} />;
	return (
		<div className="m-list-row flex w-full gap-4 pl-4">
			{icon != null && <span className="flex w-6 shrink-0 items-start justify-center pt-3.5 text-m-text-2">{icon}</span>}
			<div className="m-list-sep min-w-0 flex-1 py-3 pr-4">
				<div className="text-m-md break-words text-m-text">{name}</div>
				{sub != null && <div className="mt-0.5 text-m-xs break-words text-m-text-3">{sub}</div>}
				{children != null && <div className="mt-3">{children}</div>}
			</div>
		</div>
	);
}

/** Free content block inside a `ListGroup` (text, forms) with the group's padding. */
export function GroupBlock({ children, className = "" }: { children: ReactNode; className?: string }) {
	return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
