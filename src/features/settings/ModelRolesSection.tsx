/**
 * [D] Desktop equivalent of omp `/model` → Roles view.
 *
 * Compact grouped-row layout: one row per role — primary model select saves
 * immediately on pick; the fallback chain collapses into a small state chip
 * that expands into an inline editor on demand. Explanations live in
 * tooltips and one section-level legend line, not per-role paragraphs.
 *
 * Backed by `modelRoles` + `retry.fallbackChains` (both record-typed omp
 * settings: `omp config set` only accepts top-level keys, so every write
 * rewrites the whole record via withRoleAssignment/withChain).
 */

import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronUp,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { OmpConfigEntry } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { listModels, ompConfigSet } from "../../lib/ipc";
import { parseModels, toModelKey, type ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
import { ModelSelect } from "../../components/ModelSelect";
import { NativeSelect } from "../../components/NativeSelect";
import {
	BUILTIN_ROLES,
	THINKING_SUFFIXES,
	asRecord,
	asStringList,
	customRoles,
	joinRoleValue,
	parseChain,
	roleValue,
	splitRoleValue,
	withChain,
	withRoleAssignment,
} from "./modelRoles";
import { useOmpConfigStore } from "./ompConfigStore";

const CUSTOM_VALUE = "__custom__";

function entryValue(entries: OmpConfigEntry[], key: string): unknown {
	return entries.find((e) => e.key === key)?.value;
}

/** Group catalog models by provider, preserving `listModels` order. */
function groupModelsByProvider(
	models: ModelOption[],
): { provider: string; models: ModelOption[] }[] {
	const order: string[] = [];
	const byProvider: Record<string, ModelOption[]> = {};
	for (const m of models) {
		if (!byProvider[m.provider]) {
			byProvider[m.provider] = [];
			order.push(m.provider);
		}
		byProvider[m.provider].push(m);
	}
	return order.map((provider) => ({ provider, models: byProvider[provider] }));
}

/** Small labeled segmented control, matching the settings-page pill style. */
function Segmented({
	options,
	value,
	disabled,
	onPick,
}: {
	options: { id: string; label: string; title?: string }[];
	value: string;
	disabled?: boolean;
	onPick: (id: string) => void;
}) {
	return (
		<div className="inline-flex rounded-lg hairline bg-[var(--well-bg)] p-0.5">
			{options.map((o) => (
				<button
					key={o.id}
					type="button"
					disabled={disabled}
					title={o.title}
					onClick={() => onPick(o.id)}
					className={`rounded-md px-2.5 py-1 text-[11px] transition-all active:scale-95 disabled:opacity-50 ${
						value === o.id
							? "bg-[var(--bg-active-fill)] text-neutral-100 shadow-sm font-medium"
							: "text-neutral-400 hover:text-neutral-200"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

const ICON_BTN =
	"rounded-md p-1 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none";

const SAVE_BTN =
	"rounded-lg bg-[#0A84FF] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm disabled:opacity-50";

function flashSaved(setter: (v: boolean) => void) {
	setter(true);
	setTimeout(() => setter(false), 2000);
}

/**
 * Collapsed-by-default fallback-chain editor for one role, shown inline under
 * the role row. Tri-state: 未设置 (inherit/built-in) · 不回退 ([]) · 自定义.
 */
function ChainPanel({
	roleId,
	chains,
	models,
	onSaved,
	onCollapse,
}: {
	roleId: string;
	chains: Record<string, unknown>;
	models: ModelOption[];
	onSaved: () => void;
	onCollapse: () => void;
}) {
	const committed = useMemo(() => parseChain(chains[roleId]), [chains, roleId]);
	const [items, setItems] = useState<string[]>(committed.items);
	const [busy, setBusy] = useState(false);
	const [savedTick, setSavedTick] = useState(false);

	// Re-sync the draft when the persisted chain changes (store reload).
	useEffect(() => {
		setItems(committed.items);
	}, [committed]);

	const dirty = JSON.stringify(items) !== JSON.stringify(committed.items);

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

	/** Apply the current draft list. */
	const apply = async () => {
		await writeRecord(withChain(chains, roleId, items));
	};

	// withChain(role, null) removes the key → inherit/built-in; [] disables.
	// "list" is not a mode switch — the editor drafts rows and 应用 writes them.
	const pickMode = async (mode: string) => {
		if (busy || mode === "list") return;
		if (mode === "unset") {
			await writeRecord(withChain(chains, roleId, null));
			onCollapse();
		} else {
			await writeRecord(withChain(chains, roleId, []));
			onCollapse();
		}
	};

	const move = (i: number, delta: number) => {
		const j = i + delta;
		if (j < 0 || j >= items.length) return;
		const next = [...items];
		[next[i], next[j]] = [next[j], next[i]];
		setItems(next);
	};

	return (
		<div className="mt-2 space-y-1.5 border-t border-[var(--border-divider)] pt-2">
			<div className="flex flex-wrap items-center gap-2">
				<Segmented
					value={committed.state === "list" ? "list" : committed.state}
					disabled={busy}
					onPick={(m) => void pickMode(m)}
					options={[
						{ id: "unset", label: "未设置", title: "继承：模型职能角色用内置候选，对话角色跟随 default 链" },
						{ id: "empty", label: "不回退", title: "显式空链 []：此角色失败时不回退" },
						{ id: "list", label: "自定义", title: "按顺序尝试的回退模型（provider/id[:level] 或 @角色）" },
					]}
				/>
				<button
					type="button"
					disabled={busy}
					onClick={onCollapse}
					className="ml-auto rounded-lg px-2 py-1 text-[11px] text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-50"
				>
					收起
				</button>
				{savedTick && (
					<span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400">
						<Check className="h-2.5 w-2.5" />
						已保存
					</span>
				)}
			</div>

			{items.map((item, i) => (
				<div key={i} className="flex items-center gap-1.5">
					<span className="w-4 shrink-0 text-center font-mono text-[10px] text-neutral-600">
						{i + 1}
					</span>
					<input
						type="text"
						value={item}
						disabled={busy}
						onChange={(e) =>
							setItems(items.map((x, j) => (j === i ? e.target.value : x)))
						}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								void apply();
							}
						}}
						spellCheck={false}
						placeholder="provider/id[:level] 或 @角色"
						className="flex-1 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
					/>
					<button
						type="button"
						disabled={busy || i === 0}
						onClick={() => move(i, -1)}
						title="上移"
						className={ICON_BTN}
					>
						<ChevronUp className="h-3 w-3" />
					</button>
					<button
						type="button"
						disabled={busy || i === items.length - 1}
						onClick={() => move(i, 1)}
						title="下移"
						className={ICON_BTN}
					>
						<ChevronDown className="h-3 w-3" />
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => setItems(items.filter((_, j) => j !== i))}
						title="移除"
						className={ICON_BTN}
					>
						<Trash2 className="h-3 w-3" />
					</button>
				</div>
			))}
			<div className="flex items-center gap-1.5">
				<span className="w-4 shrink-0" />
				<NativeSelect
					value=""
					disabled={busy}
					onChange={(e) => {
						const v = e.target.value;
						if (v) setItems([...items, v]);
						e.target.value = "";
					}}
					className="text-[11px]"
					containerClassName="flex-1"
				>
					<option value="">从模型列表添加…</option>
					{groupModelsByProvider(models).map((g) => (
						<optgroup key={g.provider} label={g.provider}>
							{g.models.map((m) => {
								const key = toModelKey(m.provider, m.id);
								return (
									<option key={key} value={key} title={m.name}>
										{key}
									</option>
								);
							})}
						</optgroup>
					))}
				</NativeSelect>
				<button
					type="button"
					disabled={busy}
					onClick={() => setItems([...items, ""])}
					title="添加空行手动输入（如 @smol、web/duckduckgo）"
					className={ICON_BTN}
				>
					<Plus className="h-3 w-3" />
				</button>
			</div>
			<div className="flex items-center gap-2 pl-5">
				<button
					type="button"
					disabled={busy || !dirty}
					onClick={() => void apply()}
					className={SAVE_BTN}
				>
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
			</div>
		</div>
	);
}

/** Chain-state chip label for the collapsed row. */
function chainChipLabel(state: "unset" | "empty" | "list", count: number) {
	if (state === "unset") return "未设置";
	if (state === "empty") return "不回退";
	return `${count} 项`;
}

/**
 * One compact role row inside a grouped card: label + primary model select
 * (auto-save on pick) + optional thinking suffix + collapsed chain chip.
 */
function RoleRow({
	roleId,
	label,
	description,
	kind,
	isCustom = false,
	roles,
	chains,
	models,
	onSaved,
}: {
	roleId: string;
	label: string;
	description: string;
	kind: "chat" | "modelKind";
	isCustom?: boolean;
	roles: Record<string, unknown>;
	chains: Record<string, unknown>;
	models: ModelOption[];
	onSaved: () => void;
}) {
	const current = roleValue(roles, roleId);
	const [thinking, setThinking] = useState(
		() => splitRoleValue(current ?? "").thinkingSuffix ?? "",
	);
	const [customDraft, setCustomDraft] = useState<string | null>(null);
	const [chainOpen, setChainOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [savedTick, setSavedTick] = useState(false);

	// Re-sync suffix state when the persisted assignment changes.
	useEffect(() => {
		setThinking(splitRoleValue(current ?? "").thinkingSuffix ?? "");
	}, [current]);

	const catalogKeys = useMemo(
		() => new Set(models.map((m) => toModelKey(m.provider, m.id))),
		[models],
	);
	const baseSelector = splitRoleValue(current ?? "").selector;
	const isCustomValue =
		current !== null && current !== "" && !catalogKeys.has(baseSelector);

	const writeRoles = async (
		next: Record<string, unknown>,
	): Promise<boolean> => {
		setBusy(true);
		try {
			await ompConfigSet("modelRoles", JSON.stringify(next));
			flashSaved(setSavedTick);
			onSaved();
			return true;
		} catch (e) {
			toast.error(`保存「${label}」失败：${errMsg(e)}`);
			return false;
		} finally {
			setBusy(false);
		}
	};

	/** Commit a full role value (selector + suffix); empty removes the role. */
	const commit = async (value: string): Promise<boolean> => {
		if (kind === "modelKind" && splitRoleValue(value).thinkingSuffix) {
			toast.error("模型职能角色不支持 :thinking 后缀");
			return false;
		}
		return writeRoles(withRoleAssignment(roles, roleId, value || null));
	};

	// Trigger label: pretty name for catalog picks, raw selector otherwise.
	const modelLabel = customDraft
		? "自定义选择器…"
		: current === null
			? "未设置（内置默认）"
			: isCustomValue
				? current
				: (models.find((m) => toModelKey(m.provider, m.id) === baseSelector)
						?.name ?? baseSelector);

	const onPickModel = async (key: string) => {
		if (key === CUSTOM_VALUE) {
			setCustomDraft(current ?? "");
			return;
		}
		setCustomDraft(null);
		const value =
			key === ""
				? ""
				: kind === "chat"
					? joinRoleValue(key, thinking || null)
					: key;
		await commit(value);
	};

	const onPickThinking = async (suffix: string) => {
		setThinking(suffix);
		if (!baseSelector || !catalogKeys.has(baseSelector)) return;
		await commit(joinRoleValue(baseSelector, suffix || null));
	};

	const commitCustom = async () => {
		const v = (customDraft ?? "").trim();
		if (!(await commit(v))) return;
		setCustomDraft(null);
	};

	const chain = useMemo(() => parseChain(chains[roleId]), [chains, roleId]);

	return (
		<div className="px-3.5 py-2">
			<div className="flex items-center gap-2">
				<span
					title={description}
					className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-neutral-200"
				>
					{label}
					<span className="rounded bg-neutral-700/60 px-1 py-px font-mono text-[9px] font-normal text-neutral-400">
						{roleId}
					</span>
					{isCustom && (
						<span className="rounded bg-violet-500/15 px-1 py-px text-[9px] font-normal text-violet-300">
							自定义
						</span>
					)}
				</span>
				{savedTick && (
					<Check className="h-3 w-3 shrink-0 text-emerald-400" />
				)}

				<div className="ml-auto flex min-w-0 items-center gap-1.5">
					<ModelSelect
						direction="down"
						widthClass="w-[360px]"
						icon={false}
						label={modelLabel}
						buttonClass={`h-7 flex min-w-[140px] max-w-[240px] items-center justify-between rounded-lg hairline bg-[var(--well-bg)] px-2.5 text-left text-[11px] text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all ${busy ? "pointer-events-none opacity-50" : ""}`}
						models={models}
						currentValue={catalogKeys.has(baseSelector) ? baseSelector : ""}
						extras={[
							{ value: "", label: "未设置（内置默认）", hint: "unset" },
							{ value: CUSTOM_VALUE, label: "自定义选择器…", hint: "手动输入" },
						]}
						onSelect={(v) => void onPickModel(v)}
					/>
					{kind === "chat" && !isCustomValue && (
						<NativeSelect
							value={thinking}
							disabled={busy || !baseSelector}
							onChange={(e) => void onPickThinking(e.target.value)}
							className="text-[11px]"
							containerClassName="w-[72px] shrink-0"
							title="思考级别后缀（:minimal…:max / :auto）"
						>
							<option value="">默认</option>
							{THINKING_SUFFIXES.map((t) => (
								<option key={t} value={t}>
									:{t}
								</option>
							))}
						</NativeSelect>
					)}
					<button
						type="button"
						disabled={busy}
						onClick={() => setChainOpen((v) => !v)}
						title="回退链：未设置=继承内置默认 · 不回退=失败即停 · N 项=按序尝试"
						className={`inline-flex shrink-0 items-center gap-1 rounded-lg hairline px-2 py-1 text-[11px] transition-all active:scale-95 disabled:opacity-50 ${
							chainOpen
								? "bg-[var(--bg-active-fill)] text-neutral-100"
								: "bg-[var(--well-bg)] text-neutral-400 hover:text-neutral-200"
						}`}
					>
						回退 · {chainChipLabel(chain.state, chain.items.length)}
						<ChevronDown
							className={`h-2.5 w-2.5 transition-transform ${chainOpen ? "rotate-180" : ""}`}
						/>
					</button>
				</div>
			</div>

			{customDraft !== null && (
				<div className="mt-1.5 flex items-center gap-1.5 pl-1">
					<input
						type="text"
						value={customDraft}
						disabled={busy}
						autoFocus
						onChange={(e) => setCustomDraft(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								void commitCustom();
							}
							if (e.key === "Escape") {
								setCustomDraft(null);
							}
						}}
						spellCheck={false}
						placeholder="provider/id[:level]、web/duckduckgo、@smol"
						className="flex-1 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
					/>
					<button
						type="button"
						disabled={busy || !customDraft.trim()}
						onClick={() => void commitCustom()}
						className={SAVE_BTN}
					>
						保存
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => setCustomDraft(null)}
						title="取消自定义输入"
						className={ICON_BTN}
					>
						<Trash2 className="h-3 w-3" />
					</button>
				</div>
			)}

			{chainOpen && (
				<ChainPanel
					roleId={roleId}
					chains={chains}
					models={models}
					onSaved={onSaved}
					onCollapse={() => setChainOpen(false)}
				/>
			)}
		</div>
	);
}

/** Ordered `cycleOrder` editor — chat roles the in-session switcher cycles. */
function CycleOrderEditor({
	value,
	availableRoles,
	onSaved,
}: {
	value: string[];
	availableRoles: string[];
	onSaved: () => void;
}) {
	const [items, setItems] = useState<string[]>(value);
	const [busy, setBusy] = useState(false);
	const [savedTick, setSavedTick] = useState(false);
	const [other, setOther] = useState("");

	useEffect(() => {
		setItems(value);
	}, [value]);

	const dirty = JSON.stringify(items) !== JSON.stringify(value);
	const addable = availableRoles.filter((r) => !items.includes(r));

	const addOther = () => {
		const t = other.trim();
		if (t && !items.includes(t)) {
			setItems([...items, t]);
			setOther("");
		}
	};

	const move = (i: number, delta: number) => {
		const j = i + delta;
		if (j < 0 || j >= items.length) return;
		const next = [...items];
		[next[i], next[j]] = [next[j], next[i]];
		setItems(next);
	};

	const apply = async () => {
		setBusy(true);
		try {
			await ompConfigSet("cycleOrder", JSON.stringify(items));
			flashSaved(setSavedTick);
			onSaved();
		} catch (e) {
			toast.error(`保存切换顺序失败：${errMsg(e)}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div>
			<div className="flex items-center gap-2">
				<span
					title="会话内模型切换器按此顺序轮换对话角色（cycleOrder）"
					className="text-[11px] font-medium text-neutral-300"
				>
					角色切换顺序
				</span>
				{savedTick && <Check className="h-2.5 w-2.5 text-emerald-400" />}
			</div>
			<div className="mt-1.5 flex flex-wrap items-center gap-1">
				{items.map((r, i) => (
					<span
						key={`${r}-${i}`}
						className="inline-flex items-center gap-0.5 rounded-lg hairline bg-[var(--well-bg)] px-1.5 py-1"
					>
						<button
							type="button"
							disabled={busy || i === 0}
							onClick={() => move(i, -1)}
							className={ICON_BTN}
						>
							<ChevronUp className="h-2.5 w-2.5" />
						</button>
						<span className="px-0.5 font-mono text-[11px] text-neutral-200">{r}</span>
						<button
							type="button"
							disabled={busy || i === items.length - 1}
							onClick={() => move(i, 1)}
							className={ICON_BTN}
						>
							<ChevronDown className="h-2.5 w-2.5" />
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => setItems(items.filter((_, j) => j !== i))}
							title="移除"
							className={ICON_BTN}
						>
							<Trash2 className="h-2.5 w-2.5" />
						</button>
					</span>
				))}
				{items.length === 0 && (
					<span className="text-[11px] text-neutral-600">（空）</span>
				)}
			</div>
			<div className="mt-1.5 flex items-center gap-1.5">
				<NativeSelect
					value=""
					disabled={busy}
					onChange={(e) => {
						const v = e.target.value;
						if (v) setItems([...items, v]);
						e.target.value = "";
					}}
					className="text-[11px]"
					containerClassName="w-44"
				>
					<option value="">添加角色…</option>
					{addable.map((r) => (
						<option key={r} value={r}>
							{r}
						</option>
					))}
				</NativeSelect>
				<input
					type="text"
					value={other}
					disabled={busy}
					onChange={(e) => setOther(e.target.value)}
					onKeyDown={(e) => {
						if (isComposing(e)) return;
						if (e.key === "Enter") {
							e.preventDefault();
							addOther();
						}
					}}
					spellCheck={false}
					placeholder="自定义角色名"
					className="w-28 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
				/>
				<button
					type="button"
					disabled={busy || !other.trim() || items.includes(other.trim())}
					onClick={addOther}
					title="把自定义角色名加入轮换顺序"
					className={ICON_BTN}
				>
					<Plus className="h-3 w-3" />
				</button>
				<button
					type="button"
					disabled={busy || !dirty}
					onClick={() => void apply()}
					className={SAVE_BTN}
				>
					{busy ? "保存中..." : "应用"}
				</button>
			</div>
		</div>
	);
}

const CHAT_ROLES = BUILTIN_ROLES.filter((r) => r.kind === "chat");
const KIND_ROLES = BUILTIN_ROLES.filter((r) => r.kind === "modelKind");

/** One grouped card of role rows (macOS-style grouped list). */
function RoleGroup({
	title,
	titleHint,
	children,
}: {
	title: string;
	titleHint?: string;
	children: ReactNode;
}) {
	return (
		<div>
			<h3
				title={titleHint}
				className="mb-1.5 px-1 text-[11px] font-semibold text-neutral-400"
			>
				{title}
			</h3>
			<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card divide-y divide-[var(--border-divider)]">
				{children}
			</div>
		</div>
	);
}

/**
 * Desktop equivalent of omp `/model` → Roles: assign each role a primary model
 * and an ordered fallback chain. Backed by `modelRoles` + `retry.fallbackChains`
 * (both record-typed — single-role writes rewrite the whole record).
 */
export function ModelRolesSection({ query = "" }: { query?: string }) {
	const entries = useOmpConfigStore((s) => s.entries);
	const loading = useOmpConfigStore((s) => s.loading);
	const loaded = useOmpConfigStore((s) => s.loaded);
	const error = useOmpConfigStore((s) => s.error);
	const load = useOmpConfigStore((s) => s.load);

	const [models, setModels] = useState<ModelOption[]>([]);
	const [storageBusy, setStorageBusy] = useState(false);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		let cancelled = false;
		listModels()
			.then((ms) => {
				if (!cancelled) setModels(parseModels(ms));
			})
			.catch(() => {
				if (!cancelled) setModels([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Mirror OmpConfigSection.handleChanged: force a reload after each write.
	const handleChanged = () => {
		void useOmpConfigStore.getState().load(true);
	};

	const roles = useMemo(() => asRecord(entryValue(entries, "modelRoles")), [entries]);
	const chains = useMemo(
		() => asRecord(entryValue(entries, "retry.fallbackChains")),
		[entries],
	);
	const storage = useMemo(() => {
		const v = entryValue(entries, "modelRoleStorage");
		return v === "project" ? "project" : "global";
	}, [entries]);
	const cycle = useMemo(() => asStringList(entryValue(entries, "cycleOrder")), [entries]);
	const customIds = useMemo(() => customRoles(roles), [roles]);

	const q = query.trim().toLowerCase();
	const matchRole = (r: { id: string; zhLabel: string; description: string }) =>
		!q ||
		r.id.toLowerCase().includes(q) ||
		r.zhLabel.toLowerCase().includes(q) ||
		r.description.toLowerCase().includes(q);
	const chatRows = useMemo(() => CHAT_ROLES.filter(matchRole), [q]);
	const kindRows = useMemo(() => KIND_ROLES.filter(matchRole), [q]);
	const customRows = useMemo(() => customIds.filter((id) => matchRole({ id, zhLabel: id, description: "" })), [customIds, q]);

	const allRoleIds = useMemo(
		() => [...BUILTIN_ROLES.map((r) => r.id), ...customIds],
		[customIds],
	);

	const setStorage = async (mode: string) => {
		if (mode === storage || storageBusy) return;
		setStorageBusy(true);
		try {
			await ompConfigSet("modelRoleStorage", mode);
			handleChanged();
		} catch (e) {
			toast.error(`保存 modelRoleStorage 失败：${errMsg(e)}`);
		} finally {
			setStorageBusy(false);
		}
	};

	return (
		<div className="space-y-4">
			{error && (
				<div className="flex items-start gap-1.5 rounded-xl hairline bg-rose-950/20 px-3 py-2 text-[11px] text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="break-all">{error}</span>
				</div>
			)}
			{!loaded && !error && (
				<div className="text-xs text-neutral-500">
					{loading ? "正在读取 OMP 配置…" : "暂无配置数据"}
				</div>
			)}

			{loaded && (
				<>
					{/* storage + cycle order */}
					<div className="space-y-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card">
						<div className="flex items-center gap-3">
							<span
								title="modelRoleStorage：TUI 里 /model 选择器的保存位置；此处编辑始终写入全局配置"
								className="text-[11px] font-medium text-neutral-300"
							>
								角色保存位置
							</span>
							<Segmented
								value={storage}
								disabled={storageBusy}
								onPick={(m) => void setStorage(m)}
								options={[
									{ id: "global", label: "global" },
									{ id: "project", label: "project" },
								]}
							/>
						</div>
						{storage === "project" && (
							<div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-200">
								<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
								<div className="flex-1">
									仓库 .omp/config.yml 里的角色会覆盖全局——此处的修改对带项目覆盖的仓库不生效。建议 global。
									<button
										type="button"
										disabled={storageBusy}
										onClick={() => void setStorage("global")}
										className="ml-1.5 inline-flex rounded-md bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-100 hover:bg-amber-500/30 active:scale-95 transition-all disabled:opacity-50"
									>
										切换为 global
									</button>
								</div>
							</div>
						)}
						<div className="border-t border-[var(--border-divider)] pt-3">
							<CycleOrderEditor
								value={cycle}
								availableRoles={allRoleIds}
								onSaved={handleChanged}
							/>
						</div>
					</div>

					<p className="px-1 text-[11px] leading-4 text-neutral-500">
						选模型后立即保存；「回退」徽章展开该角色的回退链（未设置 = 用内置默认，不回退 = 失败即停，N 项 = 按顺序尝试）。
					</p>

					<RoleGroup
						title="对话角色"
						titleHint="chat roles — 可带 :thinking 后缀"
					>
						{chatRows.map((r) => (
							<RoleRow
								key={r.id}
								roleId={r.id}
								label={r.zhLabel}
								description={r.description}
								kind={r.kind}
								roles={roles}
								chains={chains}
								models={models}
								onSaved={handleChanged}
							/>
						))}
					</RoleGroup>

					<RoleGroup
						title="模型职能角色"
						titleHint="model-kind roles — 图像 / 搜索 / 语音等专用运行器"
					>
						{kindRows.map((r) => (
							<RoleRow
								key={r.id}
								roleId={r.id}
								label={r.zhLabel}
								description={r.description}
								kind={r.kind}
								roles={roles}
								chains={chains}
								models={models}
								onSaved={handleChanged}
							/>
						))}
					</RoleGroup>

					{customRows.length > 0 && (
						<RoleGroup title="自定义角色" titleHint="modelRoles 中的非内置键">
							{customRows.map((id) => (
								<RoleRow
									key={id}
									roleId={id}
									label={id}
									description="用户自定义角色（modelRoles 中的非内置键）"
									kind="chat"
									isCustom
									roles={roles}
									chains={chains}
									models={models}
									onSaved={handleChanged}
								/>
							))}
						</RoleGroup>
					)}
				</>
			)}
		</div>
	);
}
