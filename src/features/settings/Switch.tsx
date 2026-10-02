/** [D] Apple HIG toggle switch — h-5 w-9, white knob, theme-adaptive --accent on-track, spring transition. */

export function Switch({
	checked,
	onChange,
	disabled = false,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={(e) => {
				// Contained in clickable rows; never double-toggle the row.
				e.stopPropagation();
				onChange(!checked);
			}}
			className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] ${
				checked ? "bg-[var(--accent)]" : "bg-[var(--switch-off,#39393D)]"
			} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer press-scale"}`}
		>
			<span
				className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3),0_0_1px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] ${
					checked ? "translate-x-[18px]" : "translate-x-[2px]"
				}`}
			/>
		</button>
	);
}
