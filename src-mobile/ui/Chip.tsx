import type { ReactNode } from "react";

export type ChipTone = "neutral" | "accent" | "success" | "warn" | "danger";

const TONES: Record<ChipTone, string> = {
	neutral: "bg-m-surface text-m-text-2",
	accent: "bg-[color-mix(in_srgb,var(--m-accent)_16%,transparent)] text-m-accent",
	success: "bg-[color-mix(in_srgb,var(--m-success)_16%,transparent)] text-m-success",
	warn: "bg-[color-mix(in_srgb,var(--m-warn)_16%,transparent)] text-m-warn",
	danger: "bg-[color-mix(in_srgb,var(--m-danger)_16%,transparent)] text-m-danger",
};

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
	const cls = `relative inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-m-pill px-3 text-m-xs font-medium ${
		active ? "bg-m-accent text-m-accent-text" : TONES[tone]
	} ${className}`;
	const inner = (
		<>
			{icon}
			{children}
		</>
	);
	if (onClick) {
		// The ::before pseudo-element extends the hit area to 44px without changing the visual size.
		return (
			<button
				type="button"
				onClick={onClick}
				aria-pressed={active}
				className={`${cls} before:absolute before:-inset-x-1 before:-inset-y-2 active:opacity-70`}
			>
				{inner}
			</button>
		);
	}
	return <span className={cls}>{inner}</span>;
}
