import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Grouped card (docs/MOBILE_DESIGN.md §3): 13px grey section label, 24-radius `--m-card` card,
 * optional footnote. Rows inside get inset separators automatically.
 */
export function ListGroup({
	title,
	note,
	children,
	className = "",
}: {
	title?: ReactNode;
	note?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={`px-4 ${className}`}>
			{title != null && <h3 className="px-4 pt-5 pb-2 text-m-xs font-medium whitespace-nowrap text-m-text-3">{title}</h3>}
			<div className="m-list overflow-hidden rounded-m-lg bg-m-card shadow-m-card">{children}</div>
			{note != null && <p className="px-4 pt-2 text-m-xs break-words text-m-text-3">{note}</p>}
		</section>
	);
}

/**
 * Row of a `ListGroup`: icon, label (+ subtitle), right value, chevron when it navigates.
 * Text wraps instead of truncating. Separator is drawn from the label start (inset), not under
 * the icon.
 */
export function ListRow({
	icon,
	title,
	subtitle,
	right,
	onClick,
	chevron,
	danger = false,
	disabled = false,
	className = "",
}: {
	icon?: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	right?: ReactNode;
	onClick?: () => void;
	/** Defaults to true when `onClick` is set and no `right` control is given. */
	chevron?: boolean;
	danger?: boolean;
	disabled?: boolean;
	className?: string;
}) {
	const showChevron = chevron ?? (onClick != null && right == null);
	const inner = (
		<>
			{icon != null && (
				<span className={`flex w-6 shrink-0 items-center justify-center ${danger ? "text-m-danger" : "text-m-text-2"}`}>{icon}</span>
			)}
			<span className="m-list-sep flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pr-4">
				<span className="min-w-0 flex-1">
					<span className={`block text-m-md break-words ${danger ? "text-m-danger" : "text-m-text"}`}>{title}</span>
					{subtitle != null && <span className="mt-0.5 block text-m-xs break-words text-m-text-3">{subtitle}</span>}
				</span>
				{right != null && <span className="flex shrink-0 items-center gap-1 text-m-sm whitespace-nowrap text-m-text-3">{right}</span>}
				{showChevron && <ChevronRight size={18} className="shrink-0 text-m-text-3" aria-hidden />}
			</span>
		</>
	);
	const cls = `m-list-row flex w-full items-center gap-4 pl-4 text-left ${className}`;
	if (onClick) {
		return (
			<button type="button" onClick={onClick} disabled={disabled} className={`${cls} active:bg-m-surface-hover disabled:opacity-40`}>
				{inner}
			</button>
		);
	}
	return <div className={`${cls} ${disabled ? "opacity-40" : ""}`}>{inner}</div>;
}

/** Flat action row for menu sheets (no card): icon + label (+ hint), ≥ 52px. */
export function MenuRow({
	icon,
	label,
	hint,
	right,
	onClick,
	danger = false,
	disabled = false,
	selected = false,
}: {
	icon?: ReactNode;
	label: ReactNode;
	hint?: ReactNode;
	right?: ReactNode;
	onClick?: () => void;
	danger?: boolean;
	disabled?: boolean;
	selected?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-current={selected || undefined}
			className={`flex min-h-13 w-full items-center gap-4 px-5 py-2.5 text-left active:bg-m-surface-hover disabled:opacity-40 ${
				danger ? "text-m-danger" : "text-m-text"
			}`}
		>
			{icon != null && <span className={`flex w-6 shrink-0 items-center justify-center ${danger ? "" : "text-m-text-2"}`}>{icon}</span>}
			<span className="min-w-0 flex-1">
				<span className="block text-m-md break-words">{label}</span>
				{hint != null && <span className="mt-0.5 block text-m-xs break-words text-m-text-3">{hint}</span>}
			</span>
			{right != null && <span className="flex shrink-0 items-center text-m-sm whitespace-nowrap text-m-text-3">{right}</span>}
		</button>
	);
}
