import { Minus, Plus } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

/** iOS-shaped switch in the accent colour, 44px hit area. */
export function Switch({
	checked,
	onChange,
	label,
	disabled,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className="flex min-h-11 shrink-0 items-center justify-center disabled:opacity-40"
		>
			<span
				className={`relative h-[31px] w-[51px] rounded-m-pill transition-colors duration-(--m-dur) ease-m ${checked ? "bg-m-accent" : "bg-m-surface-2"}`}
			>
				<span
					className={`absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-m-pill bg-white shadow-[0_2px_6px_rgb(0_0_0/0.25)] transition-transform duration-(--m-dur) ease-m ${
						checked ? "translate-x-5" : ""
					}`}
				/>
			</span>
		</button>
	);
}

/** Pill track with a raised selected segment. Labels never wrap; keep them short. */
export function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
	disabled,
	className = "",
}: {
	value: T | null | undefined;
	options: ReadonlyArray<{ value: T; label: string }>;
	onChange: (next: T) => void;
	label: string;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<div role="radiogroup" aria-label={label} className={`flex rounded-m-pill bg-m-surface p-1 ${className}`}>
			{options.map((o) => {
				const on = value === o.value;
				return (
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={on}
						disabled={disabled}
						onClick={() => !on && onChange(o.value)}
						className={`min-h-11 min-w-11 flex-1 rounded-m-pill px-3 text-m-sm whitespace-nowrap transition-colors duration-(--m-dur-fast) disabled:opacity-40 ${
							on ? "bg-m-segment-on font-medium text-m-text shadow-[0_1px_4px_rgb(0_0_0/0.18)]" : "text-m-text-2"
						}`}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}

/** Number with circle −/+ buttons; commits on blur or button press. */
export function Stepper({
	value,
	min,
	max,
	step,
	unit,
	label,
	onCommit,
	disabled,
}: {
	value: number | null | undefined;
	min: number;
	max: number;
	step: number;
	unit: string;
	label: string;
	onCommit: (next: number) => void;
	disabled?: boolean;
}) {
	const v = value ?? 0;
	const btn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill bg-m-surface text-m-text active:bg-m-surface-2 disabled:opacity-35";
	return (
		<div className="flex items-center gap-1.5">
			<button type="button" aria-label="减少" className={btn} disabled={disabled || (value != null && v <= min)} onClick={() => onCommit(Math.max(min, v - step))}>
				<Minus size={18} />
			</button>
			<input
				key={String(value)}
				type="number"
				inputMode="numeric"
				aria-label={label}
				min={min}
				max={max}
				disabled={disabled}
				defaultValue={value ?? ""}
				onBlur={(e) => {
					const t = e.currentTarget.value;
					const n = Number(t);
					if (t.trim() === "" || !Number.isFinite(n)) {
						e.currentTarget.value = value == null ? "" : String(value);
						return;
					}
					const next = Math.min(max, Math.max(min, Math.round(n)));
					e.currentTarget.value = String(next);
					if (next !== value) onCommit(next);
				}}
				className="h-11 min-w-11 w-20 rounded-m-sm bg-m-surface px-2 text-center text-m-md text-m-text outline-none focus:ring-2 focus:ring-m-accent"
			/>
			<button type="button" aria-label="增加" className={btn} disabled={disabled || (value != null && v >= max)} onClick={() => onCommit(Math.min(max, v + step))}>
				<Plus size={18} />
			</button>
			{unit && <span className="text-m-xs whitespace-nowrap text-m-text-3">{unit}</span>}
		</div>
	);
}

/** Class for text inputs/textareas: filled, borderless, accent ring on focus. */
export const inputCls =
	"min-h-12 w-full rounded-[14px] bg-m-surface px-4 py-3 text-m-md text-m-text placeholder:text-m-text-3 outline-none focus:ring-2 focus:ring-m-accent disabled:opacity-50";

/** Labelled form field: 13px label above, hint/error below (errors selectable, never truncated). */
export function Field({ label, hint, error, children }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
	return (
		<label className="block">
			{label != null && <span className="mb-1.5 block px-1 text-m-xs font-medium text-m-text-3">{label}</span>}
			{children}
			{error != null && error !== false ? (
				<span className="m-selectable mt-1.5 block px-1 text-m-xs break-words text-m-danger">{error}</span>
			) : hint != null ? (
				<span className="mt-1.5 block px-1 text-m-xs break-words text-m-text-3">{hint}</span>
			) : null}
		</label>
	);
}

export function TextField(props: InputHTMLAttributes<HTMLInputElement>) {
	const { className = "", ...rest } = props;
	return <input {...rest} className={`${inputCls} ${className}`} />;
}
