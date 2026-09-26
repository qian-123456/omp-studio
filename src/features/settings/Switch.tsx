/** [D] macOS-style toggle switch — light pill with dark knob when on. */

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
			className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 ${
				checked ? "bg-neutral-100" : "bg-neutral-700"
			} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
		>
			<span
				className={`inline-block h-4 w-4 transform rounded-full shadow-sm transition-transform duration-200 ease-in-out ${
					checked
						? "translate-x-[18px] bg-neutral-950"
						: "translate-x-[2px] bg-neutral-400"
				}`}
			/>
		</button>
	);
}
