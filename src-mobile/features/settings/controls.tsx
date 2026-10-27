import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
	return (
		<section className="mt-5">
			<h2 className="px-4 pb-2 text-m-xs font-medium whitespace-nowrap text-m-text-3">{title}</h2>
			<div className="border-y border-m-border bg-m-bg-elev">{children}</div>
			{note != null && <p className="px-4 pt-2 text-m-xs leading-relaxed text-m-text-3">{note}</p>}
		</section>
	);
}

/** Label + hint on the left, control on the right (or underneath for wide controls). */
export function Row({
	name,
	hint,
	children,
	stacked = false,
	reason,
}: {
	name: ReactNode;
	hint?: ReactNode;
	children?: ReactNode;
	stacked?: boolean;
	reason?: ReactNode;
}) {
	return (
		<div className={`border-b border-m-border px-4 py-3 last:border-b-0 ${stacked ? "" : "flex items-center gap-3"}`}>
			<div className="min-w-0 flex-1">
				<div className="text-m-md text-m-text">{name}</div>
				{hint != null && <div className="mt-0.5 text-m-xs leading-relaxed text-m-text-3">{hint}</div>}
				{reason != null && <div className="mt-0.5 text-m-xs leading-relaxed text-m-warn">{reason}</div>}
			</div>
			{children != null && <div className={stacked ? "mt-2" : "shrink-0"}>{children}</div>}
		</div>
	);
}

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
			className="flex min-h-11 min-w-14 items-center justify-center disabled:opacity-40"
		>
			<span
				className={`relative h-7 w-12 rounded-m-pill border border-m-border transition-colors ${checked ? "bg-m-accent" : "bg-m-surface-2"}`}
			>
				<span
					className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-m-pill bg-m-bg shadow-m-pop transition-transform ${checked ? "translate-x-5" : ""}`}
				/>
			</span>
		</button>
	);
}

export function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
	disabled,
}: {
	value: T | null | undefined;
	options: ReadonlyArray<{ value: T; label: string }>;
	onChange: (next: T) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<div role="group" aria-label={label} className="flex gap-1 rounded-m-md bg-m-surface p-1">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					disabled={disabled}
					aria-pressed={value === o.value}
					onClick={() => o.value !== value && onChange(o.value)}
					className={`min-h-11 flex-1 rounded-m-sm px-3 text-m-sm whitespace-nowrap disabled:opacity-40 ${
						value === o.value ? "bg-m-accent text-m-accent-text" : "text-m-text-2 active:bg-m-surface-hover"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

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
	const btn = "flex min-h-11 min-w-11 items-center justify-center rounded-m-md bg-m-surface text-m-text active:bg-m-surface-hover disabled:opacity-40";
	return (
		<div className="flex items-center gap-1">
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
				className="min-h-11 w-24 rounded-m-md border border-m-border bg-m-bg px-2 text-center text-m-md text-m-text"
			/>
			<button type="button" aria-label="增加" className={btn} disabled={disabled || (value != null && v >= max)} onClick={() => onCommit(Math.min(max, v + step))}>
				<Plus size={18} />
			</button>
			<span className="w-8 text-m-xs whitespace-nowrap text-m-text-3">{unit}</span>
		</div>
	);
}

export function ActionButton({
	children,
	onClick,
	disabled,
	tone = "neutral",
}: {
	children: ReactNode;
	onClick: () => void;
	disabled?: boolean;
	tone?: "neutral" | "accent" | "danger";
}) {
	const t =
		tone === "accent"
			? "bg-m-accent text-m-accent-text"
			: tone === "danger"
				? "border border-m-danger text-m-danger"
				: "border border-m-border bg-m-surface text-m-text";
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={`min-h-11 rounded-m-md px-4 text-m-sm font-medium whitespace-nowrap active:opacity-80 disabled:opacity-40 ${t}`}
		>
			{children}
		</button>
	);
}
