/**
 * [D] Inline editor for ONE `retry.fallbackChains` key — a role name, an exact
 * model, `provider/*` or a prefixed wildcard. Tri-state: 未设置 (key absent) ·
 * 不回退 (`[]`) · 自定义 (ordered list). Entries are structured rows that still
 * accept raw text. Every write rewrites the whole record via `withChain`, so
 * keys this editor does not touch are preserved verbatim.
 */
import { Check, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

export const ICON_BTN =
	"rounded-md p-1 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none";

export const SAVE_BTN =
	"shrink-0 whitespace-nowrap rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--bg)] hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-50";

export const PICKER_BUTTON_CLASS =
	"flex h-8 w-full items-center justify-between gap-2 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 text-left text-xs text-neutral-400 transition-all hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] active:scale-[0.98] disabled:opacity-50";

const SMALL_INPUT =
	"rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 text-[11px] text-neutral-200 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all";

const ENTRY_KIND_CHIP: Record<ChainEntryKind, { label: string; cls: string }> = {
	model: { label: "模型", cls: "bg-sky-500/15 text-sky-300" },
	role: { label: "角色", cls: "bg-violet-500/15 text-violet-300" },
	wildcard: { label: "通配符", cls: "bg-amber-500/15 text-amber-300" },
	invalid: { label: "格式有误", cls: "bg-rose-500/15 text-rose-300" },
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
				<span className="w-4 shrink-0 text-center font-mono text-[10px] text-neutral-600">{index + 1}</span>
				{value.trim() !== "" && (
					<span className={`shrink-0 whitespace-nowrap rounded px-1.5 py-px text-[10px] ${chip.cls}`}>{chip.label}</span>
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
					placeholder="供应商/模型，或 @角色"
					className={`min-w-0 flex-1 font-mono ${SMALL_INPUT}`}
				/>
				{!error && levels.length > 0 && (
					<label className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-500">
						<span className="whitespace-nowrap">思考强度</span>
						<NativeSelect
							value={level ?? ""}
							disabled={busy}
							containerClassName="w-28"
							className="!py-1 !text-[11px]"
							onChange={(e) => onChange(formatChainEntry(selector, e.target.value || null))}
						>
							<option value="">沿用出错那一轮</option>
							{levels.map((l) => (
								<option key={l} value={l}>
									{l}
								</option>
							))}
						</NativeSelect>
					</label>
				)}
				<button type="button" disabled={busy || index === 0} onClick={() => onMove(-1)} title="上移" className={ICON_BTN}>
					<ChevronUp className="h-3 w-3" />
				</button>
				<button
					type="button"
					disabled={busy || index === count - 1}
					onClick={() => onMove(1)}
					title="下移"
					className={ICON_BTN}
				>
					<ChevronDown className="h-3 w-3" />
				</button>
				<button type="button" disabled={busy} onClick={onRemove} title="移除" className={ICON_BTN}>
					<Trash2 className="h-3 w-3" />
				</button>
			</div>
			{(error || kind === "wildcard") && (
				<div className="flex flex-wrap items-center gap-2 pl-5 text-[10.5px]">
					{error && <span className="break-words text-rose-300">{error}</span>}
					{!error && kind === "wildcard" && (
						<span className="text-neutral-500">保持出错模型的名字，只换供应商；思考强度沿用出错那一轮</span>
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
			toast.error(`保存回退链失败：${errMsg(e)}`);
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
						{ value: "unset", label: "未设置", title: unsetTitle },
						{ value: "empty", label: "不回退", title: emptyTitle },
						{ value: "list", label: "自定义", title: "按顺序尝试的备用模型" },
					]}
				/>
				{savedTick && (
					<span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400">
						<Check className="h-2.5 w-2.5" />
						已保存
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
							label="添加备用模型"
							buttonClass={PICKER_BUTTON_CLASS}
							models={models}
							currentValue=""
							onSelect={(v) => {
								if (v) setItems([...items, v]);
							}}
						/>
					</div>
					<button
						type="button"
						disabled={busy}
						onClick={() => setItems([...items, ""])}
						title="添加一行手动输入"
						className={ICON_BTN}
					>
						<Plus className="h-3 w-3" />
					</button>
				</div>
				<div className="flex items-center gap-1.5 pl-5">
					<NativeSelect
						value=""
						disabled={busy || addableRoles.length === 0}
						onChange={(e) => {
							if (e.target.value) setItems([...items, `@${e.target.value}`]);
						}}
					>
						<option value="">添加「角色」：沿用该角色当前的模型</option>
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
						<option value="">换供应商（同名模型）</option>
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
						placeholder="模型名前缀（可不填）"
						title="例如在 openrouter 下填 google，只匹配 openrouter/google/ 开头的模型"
						className={`w-40 font-mono ${SMALL_INPUT}`}
					/>
					<button
						type="button"
						disabled={busy || !wildProvider}
						onClick={() => {
							setItems([...items, buildWildcard(wildProvider, wildPrefix)]);
							setWildPrefix("");
						}}
						className="whitespace-nowrap rounded-full hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
					>
						添加通配符
					</button>
				</div>
			</div>

			<div className="flex items-center gap-2 pl-5">
				<button type="button" disabled={busy || !dirty || hasError} onClick={() => void apply()} className={SAVE_BTN}>
					{busy ? "保存中..." : "应用"}
				</button>
				{dirty && (
					<button
						type="button"
						disabled={busy}
						onClick={() => setItems(committed.items)}
						className="rounded-lg px-2 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-50"
					>
						放弃
					</button>
				)}
				{hasError && <span className="text-[10.5px] text-rose-300">有条目格式不对，修正后才能应用</span>}
			</div>
		</div>
	);
}
