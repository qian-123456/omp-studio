import { useT } from "../../stores/language";
/** [D] Structured editors for OMP config values: string list chips, key/value
 * table, JSON escape hatch and write-only secret input. Each calls `onSave`
 * with the new value; the caller serializes and persists it. */

import clsx from "clsx";
import { ArrowDown, ArrowUp, Braces, Eye, EyeOff, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isComposing } from "../../lib/hooks";
import {
	listAdd,
	listMove,
	listRemove,
	parseJsonFor,
	type RecordRow,
	recordToRows,
	rowsToRecord,
} from "./ompConfigEdit";
import { INPUT_CLASS } from "./ui";

const ICON_BUTTON =
	"rounded-md p-1 text-neutral-500 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 disabled:pointer-events-none disabled:opacity-30";
const LINK_BUTTON = "inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-200";

type Save = (value: unknown) => Promise<boolean>;

/** Chip list for arrays of strings: Enter adds (comma/newline split, deduped). */
export function StringListEditor({ value, onSave, busy }: { value: string[]; onSave: Save; busy: boolean }) {
	const { t } = useT();
	const [draft, setDraft] = useState("");
	const add = async () => {
		const next = listAdd(value, draft);
		if (next.length === value.length) {
			setDraft("");
			return;
		}
		if (await onSave(next)) setDraft("");
	};
	return (
		<div className="space-y-1.5">
			{value.length === 0 ? (
				<div className="text-[11px] text-neutral-600">{t("settingsCore.ompValueEditors.listEmpty")}</div>
			) : (
				<ul className="space-y-1">
					{value.map((item, i) => (
						<li
							key={`${i}:${item}`}
							className="group flex items-center gap-1 rounded-md bg-[var(--well-bg)] px-2 py-0.5 hairline"
						>
							<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-200" title={item}>
								{item}
							</span>
							<button
								type="button"
								title={t("settingsCore.ompValueEditors.moveUp")}
								disabled={busy || i === 0}
								onClick={() => void onSave(listMove(value, i, -1))}
								className={ICON_BUTTON}
							>
								<ArrowUp className="h-3 w-3" />
							</button>
							<button
								type="button"
								title={t("settingsCore.ompValueEditors.moveDown")}
								disabled={busy || i === value.length - 1}
								onClick={() => void onSave(listMove(value, i, 1))}
								className={ICON_BUTTON}
							>
								<ArrowDown className="h-3 w-3" />
							</button>
							<button
								type="button"
								title={t("settingsCore.ompValueEditors.remove")}
								disabled={busy}
								onClick={() => void onSave(listRemove(value, i))}
								className={clsx(ICON_BUTTON, "hover:text-rose-300")}
							>
								<X className="h-3 w-3" />
							</button>
						</li>
					))}
				</ul>
			)}
			<div className="flex items-center gap-1.5">
				<input
					value={draft}
					disabled={busy}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (isComposing(e)) return;
						if (e.key === "Enter") {
							e.preventDefault();
							void add();
						}
					}}
					spellCheck={false}
					placeholder={t("settingsCore.ompValueEditors.addPlaceholder")}
					className={clsx(INPUT_CLASS, "min-w-0 flex-1 font-mono")}
				/>
				<button
					type="button"
					disabled={busy || !draft.trim()}
					onClick={() => void add()}
					className={clsx(ICON_BUTTON, "hairline px-2 py-1")}
					title={t("settingsCore.ompValueEditors.add")}
				>
					<Plus className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}

/** Key/value table for records; nested values edit as per-entry JSON. Saves on blur/Enter. */
export function RecordEditor({ value, onSave, busy }: { value: unknown; onSave: Save; busy: boolean }) {
	const { t } = useT();
	const [rows, setRows] = useState<RecordRow[]>(() => recordToRows(value));
	const [error, setError] = useState<{ index: number; text: string } | null>(null);
	const serialized = JSON.stringify(value ?? {});
	// biome-ignore lint/correctness/useExhaustiveDependencies: resync only when the stored value changes
	useEffect(() => {
		setRows(recordToRows(value));
		setError(null);
	}, [serialized]);

	const commit = async (next: RecordRow[]) => {
		const result = rowsToRecord(next);
		if (!result.ok) {
			setError({ index: result.index, text: result.error });
			return;
		}
		setError(null);
		if (JSON.stringify(result.value) === serialized) return;
		await onSave(result.value);
	};
	const update = (i: number, patch: Partial<RecordRow>) =>
		setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (isComposing(e)) return;
		if (e.key === "Enter") {
			e.preventDefault();
			e.currentTarget.blur();
		}
	};

	return (
		<div className="space-y-1.5">
			{rows.length === 0 && <div className="text-[11px] text-neutral-600">{t("settingsCore.ompValueEditors.noEntries")}</div>}
			{rows.map((row, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id while keys are being edited
				<div key={i} className="flex items-center gap-1.5">
					<input
						value={row.key}
						disabled={busy}
						onChange={(e) => update(i, { key: e.target.value })}
						onBlur={() => void commit(rows)}
						onKeyDown={onKey}
						spellCheck={false}
						placeholder={t("settingsCore.ompValueEditors.namePlaceholder")}
						aria-invalid={error?.index === i || undefined}
						className={clsx(
							INPUT_CLASS,
							"w-40 shrink-0 font-mono",
							error?.index === i && "ring-1 ring-rose-500/60",
						)}
					/>
					<span className="text-neutral-600">=</span>
					<input
						value={row.text}
						disabled={busy}
						onChange={(e) => update(i, { text: e.target.value })}
						onBlur={() => void commit(rows)}
						onKeyDown={onKey}
						spellCheck={false}
						placeholder={row.kind === "json" ? t("settingsCore.ompValueEditors.jsonValuePlaceholder") : t("settingsCore.ompValueEditors.valuePlaceholder")}
						title={row.kind === "json" ? t("settingsCore.ompValueEditors.jsonTooltip") : undefined}
						className={clsx(INPUT_CLASS, "min-w-0 flex-1 font-mono")}
					/>
					<button
						type="button"
						title={row.kind === "json" ? t("settingsCore.ompValueEditors.editAsText") : t("settingsCore.ompValueEditors.editAsJson")}
						disabled={busy}
						onClick={() => {
							const next = rows.map((r, j) =>
								j === i ? { ...r, kind: r.kind === "json" ? "string" : "json" } as RecordRow : r,
							);
							setRows(next);
							void commit(next);
						}}
						className={clsx(ICON_BUTTON, row.kind === "json" && "text-amber-300")}
					>
						<Braces className="h-3 w-3" />
					</button>
					<button
						type="button"
						title={t("settingsCore.ompValueEditors.remove")}
						disabled={busy}
						onClick={() => {
							const next = rows.filter((_, j) => j !== i);
							setRows(next);
							void commit(next);
						}}
						className={clsx(ICON_BUTTON, "hover:text-rose-300")}
					>
						<X className="h-3 w-3" />
					</button>
				</div>
			))}
			{error && <div className="text-[11px] text-rose-400">{error.text}</div>}
			<button
				type="button"
				disabled={busy}
				onClick={() => setRows((prev) => [...prev, { key: "", text: "", kind: "string" }])}
				className={LINK_BUTTON}
			>
				<Plus className="h-3 w-3" />
				{t("settingsCore.ompValueEditors.addEntry")}
			</button>
		</div>
	);
}

/** Raw JSON escape hatch with validation; saves only on explicit 应用. */
export function JsonEditor({
	value,
	valueType,
	onSave,
	onClose,
	busy,
}: {
	value: unknown;
	valueType: string;
	onSave: Save;
	onClose: () => void;
	busy: boolean;
}) {
	const { t } = useT();
	const [draft, setDraft] = useState(() => JSON.stringify(value ?? (valueType === "array" ? [] : {}), null, 2));
	const [error, setError] = useState<string | null>(null);
	const apply = async () => {
		const parsed = parseJsonFor(valueType, draft);
		if (!parsed.ok) {
			setError(parsed.error);
			return;
		}
		setError(null);
		if (await onSave(parsed.value)) onClose();
	};
	return (
		<div className="space-y-1.5">
			<textarea
				value={draft}
				onChange={(e) => {
					setDraft(e.target.value);
					if (error) setError(null);
				}}
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
						e.preventDefault();
						void apply();
					} else if (e.key === "Escape") {
						e.stopPropagation();
						onClose();
					}
				}}
				rows={Math.min(14, Math.max(4, draft.split("\n").length))}
				spellCheck={false}
				autoFocus
				className={clsx(
					INPUT_CLASS,
					"w-full font-mono text-[11px] leading-5",
					error && "ring-1 ring-rose-500/60",
				)}
			/>
			{error && <div className="text-[11px] text-rose-400">{error}</div>}
			<div className="flex items-center gap-2">
				<button
					type="button"
					disabled={busy}
					onClick={() => void apply()}
					className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
				>
					{t("settingsCore.ompValueEditors.apply")}
				</button>
				<button type="button" onClick={onClose} className={LINK_BUTTON}>
					{t("settingsCore.ompValueEditors.cancel")}
				</button>
				<span className="text-[10px] text-neutral-600">{t("settingsCore.ompValueEditors.shortcutsHint")}</span>
			</div>
		</div>
	);
}

/**
 * Write-only credential input: never shows the stored secret. Commits on
 * Enter/blur when non-empty and clears itself afterwards.
 */
export function SecretInput({
	isSet,
	onSave,
	busy,
	label,
}: {
	isSet: boolean;
	onSave: (raw: string) => Promise<boolean>;
	busy: boolean;
	label: string;
}) {
	const { t } = useT();
	const [draft, setDraft] = useState("");
	const [reveal, setReveal] = useState(false);
	const commit = async () => {
		if (!draft.trim()) return;
		if (await onSave(draft.trim())) setDraft("");
	};
	return (
		<div className="flex items-center gap-1.5">
			<input
				type={reveal ? "text" : "password"}
				value={draft}
				disabled={busy}
				aria-label={label}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => void commit()}
				onKeyDown={(e) => {
					if (isComposing(e)) return;
					if (e.key === "Enter") {
						e.preventDefault();
						void commit();
					} else if (e.key === "Escape") {
						e.stopPropagation();
						setDraft("");
					}
				}}
				autoComplete="off"
				spellCheck={false}
				placeholder={isSet ? t("settingsCore.ompValueEditors.secretPlaceholderSet") : t("settingsCore.ompValueEditors.secretPlaceholderUnset")}
				className={clsx(INPUT_CLASS, "w-56 font-mono")}
			/>
			<button
				type="button"
				title={reveal ? t("settingsCore.ompValueEditors.hideSecret") : t("settingsCore.ompValueEditors.showSecret")}
				onClick={() => setReveal(!reveal)}
				className={ICON_BUTTON}
			>
				{reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
			</button>
		</div>
	);
}
