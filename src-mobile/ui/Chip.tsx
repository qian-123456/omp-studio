import type { ReactNode } from "react";

export type ChipTone = "neutral" | "accent" | "success" | "warn" | "danger";

const TONES: Record<ChipTone, string> = {
	neutral: "bg-m-surface text-m-text-2",
	accent: "bg-m-accent-soft text-m-accent-soft-text",
	success: "bg-m-success-bg text-m-success",
	warn: "bg-m-warn-bg text-m-warn",
	danger: "bg-m-danger-bg text-m-danger",
};

/** 24px status/count capsule. Clickable chips reserve a 44px target in the layout. */
export function Chip({
	children,
	tone = "neutral",
	icon,
	onClick,
	active,
	className = "",
}: {
	children: ReactNode;
	tone?: ChipTone;
	icon?: ReactNode;
	onClick?: () => void;
	active?: boolean;
	className?: string;
}) {
	const cls = `relative inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-m-pill px-2.5 text-m-xs font-medium ${
		active ? "bg-m-text text-m-bg" : TONES[tone]
	} ${className}`;
	const inner = (
		<>
			{icon}
			{children}
		</>
	);
	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				aria-pressed={active}
				className={`${cls} min-h-11 min-w-11 justify-center active:opacity-70`}
			>
				{inner}
			</button>
		);
	}
	return <span className={cls}>{inner}</span>;
}
