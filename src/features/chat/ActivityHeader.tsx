/** [B] Shared Codex-style activity row header: leading muted kind icon,
 * verb-first label, dimmer object, accessory, and a trailing chevron that
 * fades in on hover and rotates when open. Used by tool, thinking,
 * exploration, and subagent rows so they align with assistant prose. */

import clsx from "clsx";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function ActivityHeader({
	icon: Icon,
	label,
	labelTitle,
	object,
	objectIsCode,
	running,
	error,
	expandable,
	open,
	onToggle,
	accessory,
}: {
	icon?: LucideIcon;
	label: string;
	labelTitle?: string;
	object?: string;
	/** Paths/commands render mono; natural-language intents stay in body font. */
	objectIsCode?: boolean;
	running?: boolean;
	error?: boolean;
	expandable?: boolean;
	open?: boolean;
	onToggle?: () => void;
	accessory?: ReactNode;
}) {
	const tone = running
		? "shimmer-text"
		: error
			? "text-[var(--status-error)]"
			: "text-[var(--text-60)] group-hover/act:text-[var(--text)]";

	const inner = (
		<>
			{Icon && (
				<Icon
					size={14}
					strokeWidth={1.75}
					className={clsx(
						"shrink-0",
						error ? "text-[var(--status-error)]" : "text-[var(--text-40)]",
					)}
					aria-hidden
				/>
			)}
			<span
				className={clsx(
					"min-w-0 truncate text-[length:var(--chat-font-size)] leading-6",
					running && "shimmer-text",
				)}
			>
				<span
					className={clsx("transition-colors", !running && tone)}
					title={labelTitle}
				>
					{label}
				</span>
				{object && (
					<span
						className={clsx(
							"ml-1.5",
							objectIsCode && "font-mono text-[12px]",
							!running && "text-[var(--text-40)]",
						)}
						title={object}
					>
						{object}
					</span>
				)}
			</span>
			{accessory}
			{expandable && (
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-[var(--text-30)] transition-all duration-150",
						open
							? "rotate-90 opacity-100"
							: "opacity-0 group-hover/act:opacity-100",
					)}
					aria-hidden
				/>
			)}
		</>
	);

	const cls = "flex max-w-full items-center gap-1.5 py-0.5 text-left";
	return expandable ? (
		<button
			type="button"
			onClick={onToggle}
			className={clsx(cls, "group/act cursor-pointer select-none rounded")}
			aria-expanded={open}
		>
			{inner}
		</button>
	) : (
		<div className={clsx(cls, "group/act")}>{inner}</div>
	);
}
