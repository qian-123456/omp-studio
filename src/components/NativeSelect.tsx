import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import React, { forwardRef } from "react";

export interface NativeSelectProps
	extends React.SelectHTMLAttributes<HTMLSelectElement> {
	containerClassName?: string;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
	({ className, containerClassName, children, disabled, ...props }, ref) => {
		return (
			// `w-full` and a caller width (e.g. `w-28`) are equal-specificity utilities whose
			// winner depends on stylesheet order, so drop the default when one is given.
			<div
				className={clsx(
					"relative",
					!/(^|\s)!?w-/.test(containerClassName ?? "") && "w-full",
					containerClassName,
				)}
			>
				<select
					ref={ref}
					disabled={disabled}
					className={clsx(
						"peer w-full appearance-none rounded-lg hairline bg-[var(--well-bg)] pl-2.5 pr-8 py-1.5 text-xs text-neutral-200 cursor-pointer",
						"focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all",
						"disabled:cursor-not-allowed disabled:opacity-50",
						"[&>option]:bg-neutral-900 [&>option]:text-neutral-200",
						className,
					)}
					{...props}
				>
					{children}
				</select>
				<ChevronDown
					size={14}
					className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-neutral-500 peer-disabled:opacity-40"
				/>
			</div>
		);
	},
);

NativeSelect.displayName = "NativeSelect";
