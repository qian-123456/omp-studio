import clsx from "clsx";
import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
	value: T;
	label: ReactNode;
	/** Tooltip; also explains why a disabled option is unavailable. */
	title?: string;
	disabled?: boolean;
}

interface SegmentedProps<T extends string> {
	options: SegmentedOption<T>[];
	value: T;
	onChange: (value: T) => void;
	/** Disables every option (e.g. while a save is in flight). */
	disabled?: boolean;
	/** `sm` = compact 11px (settings rows), `md` = 12px (page toolbars). */
	size?: "sm" | "md";
	"aria-label"?: string;
	/** Fully rounded track and thumb. */
	pill?: boolean;
}

/** Generic pill segmented control (macOS style). */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	disabled,
	size = "md",
	"aria-label": ariaLabel,
	pill = false,
}: SegmentedProps<T>) {
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className={clsx(
				"inline-flex items-center gap-0.5 bg-[var(--well-bg)] p-0.5 hairline",
				pill ? "rounded-full" : "rounded-lg",
			)}
		>
			{options.map((o) => {
				const active = value === o.value;
				return (
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={active}
						disabled={disabled || o.disabled}
						title={o.title}
						onClick={() => onChange(o.value)}
						className={clsx(
							"whitespace-nowrap px-2.5 py-1 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
							pill ? "rounded-full" : "rounded-md",
							size === "sm" ? "text-[11px]" : "text-xs font-medium",
							active
								? "bg-[var(--bg-active-fill)] font-medium text-neutral-100 shadow-sm"
								: "text-neutral-400 hover:text-neutral-200",
						)}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}
