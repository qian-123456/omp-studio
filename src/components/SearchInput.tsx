import clsx from "clsx";
import { Search, X } from "lucide-react";
import { forwardRef, type KeyboardEvent } from "react";
import { claimEscape } from "../lib/escapeClaim";
import { isComposing } from "../lib/hooks";
import { useT } from "../stores/language";
export interface SearchInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	/** Accessible name of the input; defaults to `placeholder`. */
	ariaLabel?: string;
	autoFocus?: boolean;
	/** Classes for the wrapper (width, flex sizing). */
	className?: string;
	/** Classes for the `<input>`; default matches the common hairline well input. */
	inputClassName?: string;
	/** Called when the clear button or Escape clears a non-empty value (after `onChange("")`). */
	onClear?: () => void;
	onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
	/** Search icon size in px. Default 14. */
	iconSize?: number;
}

const DEFAULT_INPUT_CLASS =
	"w-full rounded-lg hairline bg-[var(--bg-panel)] py-1.5 pl-8 pr-7 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

/**
 * Search field: leading magnifier, trailing clear button while non-empty, and
 * Escape clears a non-empty value (claiming the key so enclosing dialogs stay open).
 * Empty + Escape is left alone so it still closes the surrounding popover/dialog.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
	{ value, onChange, placeholder, ariaLabel, autoFocus, className, inputClassName, onClear, onKeyDown, iconSize = 14 },
	ref,
) {
	const { t } = useT();
	const clear = () => {
		onChange("");
		onClear?.();
	};
	return (
		<div className={clsx("relative", className)}>
			<Search
				size={iconSize}
				className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
			/>
			<input
				ref={ref}
				type="text"
				value={value}
				autoFocus={autoFocus}
				placeholder={placeholder}
				aria-label={ariaLabel ?? placeholder}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					onKeyDown?.(e);
					if (e.defaultPrevented) return;
					if (e.key === "Escape" && value && !isComposing(e)) {
						claimEscape(e);
						e.stopPropagation();
						clear();
					}
				}}
				className={inputClassName ?? DEFAULT_INPUT_CLASS}
			/>
			{value && (
				<button
					type="button"
					onClick={clear}
					aria-label={t("components.clearSearch")}
					title={t("components.clearSearch")}
					className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 transition-colors hover:text-neutral-300"
				>
					<X className="h-3 w-3" />
				</button>
			)}
		</div>
	);
});
