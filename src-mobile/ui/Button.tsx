import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "tonal" | "accent" | "danger" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
	// Gemini's high-contrast pill: inverse of the page.
	primary: "bg-m-text text-m-bg active:opacity-85",
	tonal: "bg-m-surface text-m-text active:bg-m-surface-2",
	accent: "bg-m-accent-soft text-m-accent-soft-text active:opacity-85",
	danger: "bg-m-danger-bg text-m-danger active:opacity-85",
	ghost: "text-m-accent active:bg-m-surface-hover",
};

/** Capsule button (docs/MOBILE_DESIGN.md §3). Labels never contain 「…」 and never wrap. */
export function Button({
	children,
	onClick,
	variant = "tonal",
	size = "md",
	icon,
	block = false,
	busy = false,
	disabled,
	type = "button",
	className = "",
}: {
	children: ReactNode;
	onClick?: () => void;
	variant?: ButtonVariant;
	size?: "md" | "sm";
	icon?: ReactNode;
	block?: boolean;
	busy?: boolean;
	disabled?: boolean;
	type?: "button" | "submit";
	className?: string;
}) {
	const sz = size === "sm" ? "px-4 text-m-sm" : "px-5 text-m-md";
	return (
		<button
			type={type}
			onClick={onClick}
			disabled={disabled || busy}
			aria-busy={busy || undefined}
			className={`relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-m-pill font-medium whitespace-nowrap transition-[opacity,background-color] duration-(--m-dur-fast) disabled:opacity-40 ${sz} ${
				block ? "w-full" : ""
			} ${VARIANTS[variant]} ${className}`}
		>
			{busy ? <Spinner size={16} /> : icon}
			{children}
		</button>
	);
}
