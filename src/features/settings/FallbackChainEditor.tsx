/**
 * [D] Inline editor for ONE `retry.fallbackChains` key — a role name, an exact
 * model, `provider/*` or a prefixed wildcard. Tri-state: 未设置 (key absent) ·
 * 不回退 (`[]`) · 自定义 (ordered list). Entries are structured rows that still
 * accept raw text. Every write rewrites the whole record via `withChain`, so
 * keys this editor does not touch are preserved verbatim.
 */
import { Check, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { tNow, useT } from "../../stores/language";
import { ModelSelect } from "../../components/ModelSelect";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompConfigSet } from "../../lib/ipc";
import { resolveThinkingLevels, toModelKey, type ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
import {
	buildWildcard,
	classifyChainEntry,
	formatChainEntry,
	parseChain,
	splitChainEntry,
	validateChainEntry,
	withChain,
	type ChainEntryKind,
} from "./modelRoles";
import { Button, Chip, IconButton, type ChipTone } from "./ui";

export const PICKER_BUTTON_CLASS =
	"flex h-8 w-full items-center justify-between gap-2 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 text-left text-xs text-[var(--text-muted)] transition-all hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] active:scale-[0.98] disabled:opacity-50";

const SMALL_INPUT =
	"rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 text-[11px] text-[var(--text)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all";

const ENTRY_KIND_CHIP: Record<ChainEntryKind, { label: string; tone: ChipTone }> = {
	get model() {
		return { label: tNow("settingsModels.kindModel"), tone: "neutral" as const };
	},
	get role() {
		return { label: tNow("settingsModels.kindRole"), tone: "accent" as const };
	},
	get wildcard() {
		return { label: tNow("settingsModels.kindWildcard"), tone: "warning" as const };
	},
	get invalid() {
		return { label: tNow("settingsModels.kindInvalid"), tone: "danger" as const };
	},
};

function flashSaved(setter: (v: boolean) => void) {
	setter(true);
	setTimeout(() => setter(false), 2000);
}

export interface FallbackChainEditorProps {
	/** Chain key being edited: role name, `provider/model`, `provider/*`, `provider/prefix/*`. */
	chainKey: string;
	/** Whole `retry.fallbackChains` record (every write rewrites it). */
	chains: Record<string, unknown>;
	models: ModelOption[];
	/** Role names offered by the @角色 chooser. */
	roleIds: string[];
	onSaved: () => void;
	onCollapse: () => void;
	/** Tooltip for the 未设置 option. */
	unsetTitle: string;
	/** Tooltip for the 不回退 option. */
	emptyTitle: string;
}

/** One chain entry row: kind chip, raw text, thinking level picker, move/remove. */
function EntryRow({
	index,
	count,
	value,
	catalog,
	busy,
	onChange,
	onMove,
	onRemove,
	onEnter,
}: {
	index: number;
	count: number;
	value: string;
	catalog: Map<string, ModelOption>;
	busy: boolean;
	onChange: (v: string) => void;
	onMove: (delta: number) => void;
	onRemove: () => void;
	onEnter: () => void;
}) {
	const { t } = useT();
	const { selector, level } = splitChainEntry(value);
	const kind = classifyChainEntry(value);
	const error = value.trim() === "" ? null : validateChainEntry(value);
	const chip = ENTRY_KIND_CHIP[kind];
	const model = kind === "model" ? catalog.get(selector) : undefined;
	const levels = useMemo(
		() => (kind === "model" ? resolveThinkingLevels(null, model?.thinking, level).filter((l) => l !== "auto") : []),
		[kind, model, level],
	);

	const handleSelectorChange = (raw: string) => {
		const trimmed = raw.trim();
		if (!trimmed) {
			onChange("");
			return;
		}
		const parsed = splitChainEntry(raw);
		if (parsed.level) {
			onChange(formatChainEntry(parsed.selector, parsed.level));
			return;
		}
		if (raw.startsWith("@") || raw.includes("*")) {
			onChange(raw);
			return;
		}
		if (raw.includes(":")) {
			onChange(raw);
			return;
		}
		onChange(formatChainEntry(raw, level));
	};

	return (
		<div className="space-y-1">
			<div className="flex items-center gap-1.5">
				<span className="w-4 shrink-0 text-center font-mono text-[10px] text-[var(--text-dim)]">{index + 1}</span>
				{value.trim() !== "" && (
					<Chip tone={chip.tone}>{chip.label}</Chip>
				)}
				<input
					type="text"
					value={selector}
					disabled={busy}
					onChange={(e) => handleSelectorChange(e.target.value)}
					onKeyDown={(e) => {
						if (isComposing(e)) return;
						if (e.key === "Enter") {
							e.preventDefault();
							onEnter();
						}
					}}
					spellCheck={false}
					placeholder={t("settingsModels.chainInputPlaceholder")}
					className={`min-w-0 flex-1 font-mono ${SMALL_INPUT}`}
				/>
				{!error && levels.length > 0 && (
					<label className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-dim)]">
						<span className="whitespace-nowrap">{t("settingsModels.thinkingIntensityLabel")}</span>
						<NativeSelect
							value={level ?? ""}
							disabled={busy}
							containerClassName="w-28"
							className="!py-1 !text-[11px]"
							onChange={(e) => onChange(formatChainEntry(selector, e.target.value || null))}
						>
							<option value="">{t("settingsModels.inheritErrorTurn")}</option>
							{levels.map((l) => (
								<option key={l} value={l}>
									{l}
								</option>
							))}
						</NativeSelect>
					</label>
				)}
				<IconButton icon={ChevronUp} size="sm" label={t("settingsModels.moveUpAria")} disabled={busy || index === 0} onClick={() => onMove(-1)} />
				<IconButton
					icon={ChevronDown}
					size="sm"
					label={t("settingsModels.moveDownAria")}
					disabled={busy || index === count - 1}
					onClick={() => onMove(1)}
				/>
				<IconButton icon={Trash2} size="sm" label={t("settingsModels.removeAria")} disabled={busy} onClick={onRemove} />
			</div>
			{(error || kind === "wildcard") && (
				<div className="flex flex-wrap items-center gap-2 pl-5 text-[11px]">
					{error && <span className="min-w-0 break-words text-[var(--status-error)]">{error}</span>}
					{!error && kind === "wildcard" && (
						<span className="text-[var(--text-dim)]">{t("settingsModels.wildcardNote")}</span>
					)}
				</div>
			)}
		</div>
	);
}

/** Collapsed-by-default editor for one chain key, shown inline under its row. */
export function FallbackChainEditor({
	chainKey,
	chains,
	models,
	roleIds,
	onSaved,
	onCollapse,
	unsetTitle,
	emptyTitle,
}: FallbackChainEditorProps) {
	const { t } = useT();
	const committed = useMemo(() => parseChain(chains[chainKey]), [chains, chainKey]);
	const [items, setItems] = useState<string[]>(committed.items);
	const [busy, setBusy] = useState(false);
	const [savedTick, setSavedTick] = useState(false);
	const [wildProvider, setWildProvider] = useState("");
	const [wildPrefix, setWildPrefix] = useState("");

	// Re-sync the draft when the persisted chain changes (store reload).
	useEffect(() => {
		setItems(committed.items);
	}, [committed]);

	const catalog = useMemo(() => new Map(models.map((m) => [toModelKey(m.provider, m.id), m])), [models]);
	const providers = useMemo(() => [...new Set(models.map((m) => m.provider))].sort(), [models]);
	const addableRoles = useMemo(() => roleIds.filter((r) => r !== chainKey), [roleIds, chainKey]);

	// Blank rows are dropped on apply, so they neither count as changes nor as errors.
	const cleaned = items.map((x) => x.trim()).filter((x) => x !== "");
	const hasError = cleaned.some((x) => validateChainEntry(x) !== null);
	const dirty = JSON.stringify(cleaned) !== JSON.stringify(committed.items);

	const writeRecord = async (next: Record<string, unknown>) => {
		setBusy(true);
		try {
			await ompConfigSet("retry.fallbackChains", JSON.stringify(next));
			flashSaved(setSavedTick);
			onSaved();
		} catch (e) {
			toast.error(t("settingsModels.saveChainFailed", { error: errMsg(e) }));
		} finally {
			setBusy(false);
		}
	};

	const apply = async () => {
		if (hasError || busy) return;
		await writeRecord(withChain(chains, chainKey, cleaned));
	};

	// withChain(key, null) removes the key; [] disables. "list" is not a mode
	// switch — the editor drafts rows and 应用 writes them.
	const pickMode = async (mode: string) => {
		if (busy || mode === "list") return;
		await writeRecord(withChain(chains, chainKey, mode === "unset" ? null : []));
		onCollapse();
	};

	const move = (i: number, delta: number) => {
		const j = i + delta;
		if (j < 0 || j >= items.length) return;
		const next = [...items];
		[next[i], next[j]] = [next[j], next[i]];
		setItems(next);
	};

	return (
		<div className="space-y-2.5 rounded-xl hairline bg-[var(--well-bg)]/60 p-3">
			<div className="flex flex-wrap items-center gap-2">
				<Segmented
					size="sm"
					value={committed.state}
					disabled={busy}
					onChange={(m) => void pickMode(m)}
					options={[
						{ value: "unset", label: t("settingsModels.stateUnset"), title: unsetTitle },
						{ value: "empty", label: t("settingsModels.stateEmpty"), title: emptyTitle },
						{ value: "list", label: t("settingsModels.stateCustom"), title: t("settingsModels.customStateTitle") },
					]}
				/>
				{savedTick && (
					<span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--status-success)]">
						<Check className="h-3 w-3" />
						{t("settingsModels.savedBadge")}
					</span>
				)}
			</div>
			{items.map((item, i) => (
				<EntryRow
					key={i}
					index={i}
					count={items.length}
					value={item}
					catalog={catalog}
					busy={busy}
					onChange={(v) => setItems(items.map((x, j) => (j === i ? v : x)))}
					onMove={(d) => move(i, d)}
					onRemove={() => setItems(items.filter((_, j) => j !== i))}
					onEnter={() => void apply()}
				/>
			))}

			<div className="space-y-2 border-t border-[var(--border-divider)] pt-2.5">
				<div className="flex items-center gap-1.5">
					<span className="w-4 shrink-0" />
					<div className="min-w-0 flex-1">
						<ModelSelect
							disabled={busy}
							closeOnSelect
							allowCustom
							direction="down"
							align="start"
							widthClass="w-[380px]"
							label={t("settingsModels.addFallbackModelBtn")}
							buttonClass={PICKER_BUTTON_CLASS}
							models={models}
							currentValue=""
							onSelect={(v) => {
								if (v) setItems([...items, v]);
							}}
						/>
					</div>
					<IconButton
						icon={Plus}
						size="sm"
						label={t("settingsModels.addManualRowAria")}
						disabled={busy}
						onClick={() => setItems([...items, ""])}
					/>
				</div>
				<div className="flex items-center gap-1.5 pl-5">
					<NativeSelect
						value=""
						disabled={busy || addableRoles.length === 0}
						onChange={(e) => {
							if (e.target.value) setItems([...items, `@${e.target.value}`]);
						}}
					>
						<option value="">{t("settingsModels.addRoleOption")}</option>
						{addableRoles.map((r) => (
							<option key={r} value={r}>
								@{r}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="flex flex-wrap items-center gap-1.5 pl-5">
					<NativeSelect
						value={wildProvider}
						disabled={busy || providers.length === 0}
						containerClassName="w-40"
						onChange={(e) => setWildProvider(e.target.value)}
					>
						<option value="">{t("settingsModels.switchProviderOption")}</option>
						{providers.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</NativeSelect>
					<input
						type="text"
						value={wildPrefix}
						disabled={busy}
						onChange={(e) => setWildPrefix(e.target.value)}
						spellCheck={false}
						placeholder={t("settingsModels.prefixPlaceholder")}
						title={t("settingsModels.prefixTitle")}
						className={`w-40 font-mono ${SMALL_INPUT}`}
					/>
					<Button
						variant="secondary"
						size="sm"
						disabled={busy || !wildProvider}
						onClick={() => {
							setItems([...items, buildWildcard(wildProvider, wildPrefix)]);
							setWildPrefix("");
						}}
					>
						{t("settingsModels.addWildcardBtn")}
					</Button>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2 pl-5">
				<Button variant="primary" size="sm" loading={busy} disabled={!dirty || hasError} onClick={() => void apply()}>
					{busy ? t("settingsModels.applySaving") : t("settingsModels.applyBtn")}
				</Button>
				{dirty && (
					<Button variant="ghost" size="sm" disabled={busy} onClick={() => setItems(committed.items)}>
						{t("settingsModels.discardBtn")}
					</Button>
				)}
				{hasError && <span className="text-[11px] text-[var(--status-error)]">{t("settingsModels.hasFormatErrorNote")}</span>}
			</div>
		</div>
	);
}
