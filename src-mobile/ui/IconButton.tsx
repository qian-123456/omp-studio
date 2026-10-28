import type { ReactNode } from "react";

export type IconButtonVariant = "filled" | "plain" | "tinted";

const VARIANTS: Record<IconButtonVariant, string> = {
	filled: "bg-m-surface text-m-text active:bg-m-surface-2",
	plain: "text-m-text active:bg-m-surface-hover",
	tinted: "bg-m-accent-soft text-m-accent-soft-text active:opacity-80",
};

/**
 * Round icon-only button (docs/MOBILE_DESIGN.md §3). Always a 44px hit area; `size="sm"` draws a
 * 36px disc inside it. `badge` renders a small count/dot at the top-right.
 */
export function IconButton({
	icon,
	label,
	onClick,
	disabled,
	variant = "plain",
	size = "md",
	badge,
	pressed,
	className = "",
}: {
	icon: ReactNode;
	label: string;
	onClick?: () => void;
	disabled?: boolean;
	variant?: IconButtonVariant;
	size?: "md" | "sm";
	badge?: number | boolean;
	pressed?: boolean;
	className?: string;
}) {
	const disc = size === "sm" ? "h-9 w-9" : "h-11 w-11";
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={pressed}
			disabled={disabled}
			onClick={onClick}
			className={`relative flex h-11 min-w-11 shrink-0 items-center justify-center rounded-m-pill disabled:opacity-35 ${className}`}
		>
			<span
				className={`flex ${disc} items-center justify-center rounded-m-pill transition-colors duration-(--m-dur-fast) ${VARIANTS[variant]}`}
			>
				{icon}
			</span>
			{(badge === true || (typeof badge === "number" && badge > 0)) && (
				<span
					aria-hidden
					className={`absolute top-0.5 right-0.5 flex items-center justify-center rounded-m-pill bg-m-danger font-medium whitespace-nowrap text-m-bg ${
						badge === true ? "h-2.5 w-2.5" : "h-[18px] min-w-[18px] px-1 text-[11px] leading-none"
					}`}
				>
					{typeof badge === "number" ? (badge > 99 ? "99+" : badge) : null}
				</span>
			)}
		</button>
	);
}
