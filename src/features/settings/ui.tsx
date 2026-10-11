/**
 * Shared Settings primitives: section header, grouped cards/rows, save
 * feedback and the buffered CommitInput. Every settings section renders
 * through these so layout and save semantics stay consistent.
 */
import clsx from "clsx";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { Switch } from "./Switch";

// ── Header / card / row ──────────────────────────────────────────────

export function SectionHeader({
	title,
	description,
	actions,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="min-w-0">
				<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">{title}</h2>
				{description && <p className="text-xs text-neutral-400">{description}</p>}
			</div>
			{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
		</div>
	);
}

/** Grouped macOS-style card; direct children (rows) are separated by hairlines. */
export function SettingsCard({
	title,
	footer,
	fieldId,
	children,
}: {
	title?: ReactNode;
	footer?: ReactNode;
	/** Renders `data-field-id` on the card (deep links to a whole card). */
	fieldId?: string;
	children: ReactNode;
}) {
	return (
		<section className="space-y-1.5" data-field-id={fieldId}>
			{title && (
				<h3 className="px-1 text-[11px] font-semibold text-neutral-400">{title}</h3>
			)}
			<div className="divide-y divide-[var(--border-divider)] rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card">
				{children}
			</div>
			{footer && <div className="px-1 text-[11px] leading-4 text-neutral-500">{footer}</div>}
		</section>
	);
}

export interface SettingRowProps {
	label: ReactNode;
	description?: ReactNode;
	/** Secondary muted line under the description (units, defaults, caveats). */
	hint?: ReactNode;
	/** Right-side control; with `stacked` it renders below the text instead. */
	control?: ReactNode;
	/** Renders `data-field-id` for search highlight / openSettings focusKey. */
	fieldId?: string;
	status?: SaveState;
	statusError?: string | null;
	/** Red label for destructive rows. */
	danger?: boolean;
	/** Put the control under the label (wide controls: pickers, long inputs). */
	stacked?: boolean;
	icon?: ComponentType<{ className?: string }>;
	/** Makes the whole row clickable (e.g. toggles). */
	onActivate?: () => void;
	/** Extra content under the row (conditional inputs, results). */
	children?: ReactNode;
}

export function SettingRow({
	label,
	description,
	hint,
	control,
	fieldId,
	status = "idle",
	statusError,
	danger,
	stacked,
	icon: Icon,
	onActivate,
	children,
}: SettingRowProps) {
	const clickable = onActivate !== undefined;
	return (
		<div
			data-field-id={fieldId}
			role={clickable ? "button" : undefined}
			tabIndex={clickable ? 0 : undefined}
			onClick={onActivate}
			onKeyDown={
				clickable
					? (e) => {
							if (e.target !== e.currentTarget) return;
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onActivate();
							}
						}
					: undefined
			}
			className={clsx(
				"px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl",
				clickable &&
					"group cursor-pointer hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]",
			)}
		>
			<div className={clsx("flex gap-4", stacked ? "flex-col gap-2" : "items-center justify-between")}>
				<div className="flex min-w-0 items-start gap-2.5">
					{Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />}
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span
								className={clsx(
									"text-xs font-medium",
									danger ? "text-rose-300" : "text-neutral-200",
								)}
							>
								{label}
							</span>
							<SaveIndicator status={status} error={statusError} />
						</div>
						{description && (
							<div className="mt-0.5 text-[11px] leading-4 text-neutral-400">{description}</div>
						)}
						{hint && <div className="mt-0.5 text-[11px] leading-4 text-neutral-500">{hint}</div>}
					</div>
				</div>
				{control && (
					<div className={clsx("flex items-center gap-2", !stacked && "shrink-0")}>{control}</div>
				)}
			</div>
			{children && <div className="mt-2">{children}</div>}
		</div>
	);
}

/** Switch row bound to an async save; the whole row toggles and shows save state. */
export function ToggleRow({
	checked,
	onChange,
	disabled,
	...row
}: Omit<SettingRowProps, "control" | "onActivate" | "status" | "statusError"> & {
	checked: boolean;
	onChange: (next: boolean) => Promise<void> | void;
	disabled?: boolean;
}) {
	const save = useSaveStatus();
	const flip = (next: boolean) => {
		if (!disabled) void save.run(() => onChange(next));
	};
	return (
		<SettingRow
			{...row}
			status={save.status}
			statusError={save.error}
			onActivate={() => flip(!checked)}
			control={<Switch checked={checked} onChange={flip} disabled={disabled} />}
		/>
	);
}

// ── Save feedback ────────────────────────────────────────────────────

export type SaveState = "idle" | "saving" | "saved" | "error";

const SAVED_VISIBLE_MS = 1800;

/**
 * Tracks one control's autosave. `run(fn)` shows saving → saved (auto-hides)
 * or error; the returned promise resolves `true` on success.
 */
export interface SaveStatus {
	status: SaveState;
	error: string | null;
	run: (fn: () => Promise<unknown> | unknown) => Promise<boolean>;
}

export function useSaveStatus(): SaveStatus {
	const [status, setStatus] = useState<SaveState>("idle");
	const [error, setError] = useState<string | null>(null);
	const seq = useRef(0);
	const timer = useRef<number | undefined>(undefined);
	useEffect(
		() => () => {
			window.clearTimeout(timer.current);
		},
		[],
	);
	const run = useCallback(async (fn: () => Promise<unknown> | unknown) => {
		const id = ++seq.current;
		window.clearTimeout(timer.current);
		setStatus("saving");
		setError(null);
		try {
			await fn();
			if (id !== seq.current) return true;
			setStatus("saved");
			timer.current = window.setTimeout(() => {
				if (id === seq.current) setStatus("idle");
			}, SAVED_VISIBLE_MS);
			return true;
		} catch (err) {
			if (id === seq.current) {
				setStatus("error");
				setError(errMsg(err));
			}
			return false;
		}
	}, []);
	return { status, error, run };
}

export function SaveIndicator({ status, error }: { status: SaveState; error?: string | null }) {
	if (status === "idle") return null;
	if (status === "saving")
		return (
			<span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
				<Loader2 className="h-3 w-3 animate-spin" />
				保存中
			</span>
		);
	if (status === "saved")
		return (
			<span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400">
				<Check className="h-3 w-3" />
				已保存
			</span>
		);
	return (
		<span title={error ?? undefined} className="inline-flex items-center gap-0.5 text-[10px] text-rose-400">
			<AlertTriangle className="h-3 w-3" />
			保存失败
		</span>
	);
}

// ── Buffered input ───────────────────────────────────────────────────

export const INPUT_CLASS =
	"rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all";

export interface CommitInputProps {
	/** Committed value from the store; the draft resyncs when it changes. */
	value: string;
	/** Persist the (normalized, validated) draft. Throw to signal failure. */
	onCommit: (next: string) => Promise<unknown> | unknown;
	/** Map the raw draft before validation/commit (default: trim). */
	normalize?: (draft: string) => string;
	/** Return an error message to block the commit and show it inline. */
	validate?: (next: string) => string | null;
	type?: "text" | "number";
	min?: number;
	max?: number;
	placeholder?: string;
	mono?: boolean;
	/** Width/layout classes (default `w-full`). */
	className?: string;
	"aria-label"?: string;
}

/**
 * Text/number input that buffers keystrokes and commits on Enter, on blur and
 * on unmount (section switch / close) when dirty. Escape reverts the draft.
 */
export function CommitInput({
	value,
	onCommit,
	normalize = (d) => d.trim(),
	validate,
	type = "text",
	min,
	max,
	placeholder,
	mono,
	className = "w-full",
	"aria-label": ariaLabel,
}: CommitInputProps) {
	const [draft, setDraft] = useState(value);
	const [invalid, setInvalid] = useState<string | null>(null);
	const save = useSaveStatus();
	const latest = useRef({ draft, value, onCommit, normalize, validate });
	latest.current = { draft, value, onCommit, normalize, validate };

	// Resync from the store whenever the committed value changes.
	useEffect(() => {
		setDraft(value);
		setInvalid(null);
	}, [value]);

	const commit = () => {
		const next = normalize(draft);
		if (next === value) {
			setDraft(value);
			setInvalid(null);
			return;
		}
		const err = validate?.(next) ?? null;
		setInvalid(err);
		if (err) return;
		setDraft(next);
		void save.run(() => onCommit(next));
	};

	// Flush a dirty, valid draft when the input unmounts.
	useEffect(
		() => () => {
			const l = latest.current;
			const next = l.normalize(l.draft);
			if (next === l.value || l.validate?.(next)) return;
			void Promise.resolve()
				.then(() => l.onCommit(next))
				.catch(() => {});
		},
		[],
	);

	return (
		<div className={clsx("flex flex-col gap-1", className)}>
			<div className="relative flex">
				<input
					type={type}
					min={min}
					max={max}
					value={draft}
					aria-label={ariaLabel}
					aria-invalid={invalid ? true : undefined}
					placeholder={placeholder}
					onChange={(e) => {
						setDraft(e.target.value);
						if (invalid) setInvalid(null);
					}}
					onBlur={commit}
					onKeyDown={(e) => {
						if (isComposing(e)) return;
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.stopPropagation();
							setDraft(value);
							setInvalid(null);
							e.currentTarget.blur();
						}
					}}
					className={clsx(
						INPUT_CLASS,
						"w-full",
						(mono || type === "number") && "font-mono tabular-nums",
						type === "number" && "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
						invalid && "ring-1 ring-rose-500/60",
					)}
				/>
				{/* Save feedback sits under the field, so it never resizes the input or pushes the unit label. */}
				<div className="pointer-events-none absolute right-0 top-full mt-0.5 leading-none">
					<SaveIndicator status={invalid ? "idle" : save.status} error={save.error} />
				</div>
			</div>
			{invalid && <div className="text-[11px] text-rose-400">{invalid}</div>}
		</div>
	);
}

/** Clamp an hours field to [1, 720]; garbage falls back to the 24h default. */
export function normalizeHours(raw: string): string {
	const n = parseInt(raw, 10);
	if (!Number.isFinite(n)) return "24";
	return String(Math.min(720, Math.max(1, n)));
}

/** Secondary action button used in settings rows. */
export const SETTINGS_BUTTON_CLASS =
	"inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-50";

/** Trigger button for ModelSelect pickers in settings rows. */
export const MODEL_PICKER_BUTTON_CLASS =
	"h-7 flex min-w-[140px] max-w-[240px] items-center justify-between rounded-lg hairline bg-[var(--well-bg)] px-2.5 text-left text-[11px] text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all";
