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
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	Plus,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OmpConfigEntry } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import {
	listModels,
	ompConfigSet,
	ompProjectConfigRead,
	ompProjectConfigWrite,
} from "../../lib/ipc";
import { parseModels, toModelKey, type ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
import { ModelSelect } from "../../components/ModelSelect";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import {
	BUILTIN_ROLES,
	THINKING_SUFFIXES,
	applyProjectRole,
	asRecord,
	asStringList,
	customRoles,
	joinRoleValue,
	parseChain,
	parseProjectRoles,
	roleValue,
	splitRoleValue,
	withChain,
	withRoleAssignment,
} from "./modelRoles";
import { useSessions } from "../../stores/sessions";
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

const ICON_BTN =
	"rounded-md p-1 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none";

const SAVE_BTN =
	"shrink-0 whitespace-nowrap rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--bg)] hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-50";

type Scope = "global" | "project";

/** Pretty name for catalog selectors; raw selector (with suffix) otherwise. */
function modelDisplayName(
	value: string | null,
	models: ModelOption[],
	catalogKeys: Set<string>,
): string {
	if (value === null) return "未设置";
	const { selector, thinkingSuffix } = splitRoleValue(value);
	if (!catalogKeys.has(selector)) return value;
	const name = models.find((m) => toModelKey(m.provider, m.id) === selector)?.name ?? selector;
	return thinkingSuffix ? `${name}:${thinkingSuffix}` : name;
}

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
					size="sm"
					value={committed.state === "list" ? "list" : committed.state}
					disabled={busy}
					onChange={(m) => void pickMode(m)}
					options={[
						{ value: "unset", label: "未设置", title: "继承：模型职能角色用内置候选，对话角色跟随 default 链" },
						{ value: "empty", label: "不回退", title: "显式空链 []：此角色失败时不回退" },
						{ value: "list", label: "自定义", title: "按顺序尝试的回退模型（provider/id[:level] 或 @角色）" },
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
						className="flex-1 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all"
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
	scope,
	current,
	inherited = null,
	projectOverride = null,
	chains,
	models,
	writeRole,
	onSaved,
}: {
	roleId: string;
	label: string;
	description: string;
	kind: "chat" | "modelKind";
	isCustom?: boolean;
	scope: Scope;
	/** Value stored in the edited scope (null = absent there). */
	current: string | null;
	/** Project scope only: global value inherited when not overridden. */
	inherited?: string | null;
	/** Global scope only: project override shadowing this role, if any. */
	projectOverride?: string | null;
	chains: Record<string, unknown>;
	models: ModelOption[];
	/** Persist the role value in the edited scope; null removes the key. Throws on failure. */
	writeRole: (roleId: string, value: string | null) => Promise<void>;
	onSaved: () => void;
}) {
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
	const isProject = scope === "project";
	const overridden = isProject && current !== null;

	/** Commit a full role value (selector + suffix); empty removes the role. */
	const commit = async (value: string): Promise<boolean> => {
		if (kind === "modelKind" && splitRoleValue(value).thinkingSuffix) {
			toast.error("模型职能角色不支持 :thinking 后缀");
			return false;
		}
		setBusy(true);
		try {
			await writeRole(roleId, value || null);
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

	const pretty = (v: string | null) => modelDisplayName(v, models, catalogKeys);

	// Trigger label: pretty name for catalog picks, raw selector otherwise.
	const modelLabel = customDraft
		? "自定义选择器…"
		: current === null
			? isProject
				? `继承全局：${inherited === null ? "未设置" : pretty(inherited)}`
				: "未设置（内置默认）"
			: pretty(current);
	const unsetExtra = isProject
		? { value: "", label: "继承全局（不覆盖）", hint: "inherit" }
		: { value: "", label: "未设置（内置默认）", hint: "unset" };

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
					{overridden && (
						<span className="rounded bg-sky-500/15 px-1 py-px text-[9px] font-normal text-sky-300">
							项目覆盖
						</span>
					)}
					{projectOverride !== null && (
						<span
							title={`项目设置：${pretty(projectOverride)}（在该项目里以此为准）`}
							className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-normal text-amber-300"
						>
							项目已覆盖
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
						buttonClass={`h-7 flex min-w-[140px] max-w-[240px] items-center justify-between rounded-lg hairline bg-[var(--well-bg)] px-2.5 text-left text-[11px] hover:bg-[var(--bg-hover)] active:scale-95 transition-all ${isProject && !overridden ? "italic text-neutral-500" : "text-neutral-200"} ${busy ? "pointer-events-none opacity-50" : ""}`}
						models={models}
						currentValue={catalogKeys.has(baseSelector) ? baseSelector : ""}
						extras={[
							unsetExtra,
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
					{overridden && (
						<button
							type="button"
							disabled={busy}
							onClick={() => void commit("")}
							title={`删除项目里的 modelRoles.${roleId}，改用全局设置`}
							className="shrink-0 whitespace-nowrap rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-50"
						>
							恢复继承
						</button>
					)}
					{!isProject && (
						<button
							type="button"
							disabled={busy}
							onClick={() => setChainOpen((v) => !v)}
							title="回退链：未设置=继承内置默认 · 不回退=失败即停 · N 项=按序尝试"
							className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg hairline px-2 py-1 text-[11px] transition-all active:scale-95 disabled:opacity-50 ${
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
					)}
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
						className="flex-1 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all"
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

			{chainOpen && !isProject && (
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
				<span className="text-[11px] text-neutral-500">会话内切换模型时按此顺序轮换</span>
				{savedTick && <Check className="h-2.5 w-2.5 text-emerald-400" />}
			</div>
			<div className="mt-1.5 flex flex-wrap items-center gap-1">
				{items.map((r, i) => (
					<span
						key={`${r}-${i}`}
						className="inline-flex items-center gap-0.5 rounded-lg hairline bg-[var(--well-bg)] py-0.5 pl-1.5 pr-0.5"
					>
						<span className="text-[10px] tabular-nums text-neutral-500">{i + 1}</span>
						<button
							type="button"
							disabled={busy || i === 0}
							onClick={() => move(i, -1)}
							title="前移"
							className={ICON_BTN}
						>
							<ChevronLeft className="h-2.5 w-2.5" />
						</button>
						<span className="font-mono text-[11px] text-neutral-200">{r}</span>
						<button
							type="button"
							disabled={busy || i === items.length - 1}
							onClick={() => move(i, 1)}
							title="后移"
							className={ICON_BTN}
						>
							<ChevronRight className="h-2.5 w-2.5" />
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
			<div className="mt-2 flex flex-nowrap items-center gap-1.5">
				<NativeSelect
					value=""
					disabled={busy || addable.length === 0}
					onChange={(e) => {
						const v = e.target.value;
						if (v) setItems([...items, v]);
						e.target.value = "";
					}}
					className="text-[11px]"
					containerClassName="w-28 shrink-0"
				>
					<option value="">＋ 角色</option>
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
					className="w-28 shrink-0 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all"
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
				<span className="flex-1" />
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
export function ModelRolesSection({
	query = "",
	cwd,
}: {
	query?: string;
	/** Current project dir (selected/last session's cwd); null disables project scope. */
	cwd: string | null;
}) {
	const entries = useOmpConfigStore((s) => s.entries);
	const loading = useOmpConfigStore((s) => s.loading);
	const loaded = useOmpConfigStore((s) => s.loaded);
	const error = useOmpConfigStore((s) => s.error);
	const load = useOmpConfigStore((s) => s.load);

	const [models, setModels] = useState<ModelOption[]>([]);
	const [storageBusy, setStorageBusy] = useState(false);
	const [scopePick, setScopePick] = useState<Scope>("global");
	const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
	const [project, setProject] = useState<ProjectState>({ status: "idle" });
	const scope: Scope = cwd ? scopePick : "global";

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

	// Initialize active project path when switching to project scope or cwd changes
	useEffect(() => {
		if (scope === "project" && cwd && !activeProjectPath) {
			setActiveProjectPath(cwd);
		}
	}, [scope, cwd, activeProjectPath]);

	// Latest active path for project operations
	const activePathRef = useRef(activeProjectPath);
	activePathRef.current = activeProjectPath;

	const loadProject = useCallback(async (dir: string | null) => {
		if (!dir) {
			setProject({ status: "idle" });
			return;
		}
		try {
			const file = await ompProjectConfigRead(dir);
			if (activePathRef.current !== dir) return;
			const parsed = parseProjectRoles(file.content);
			setProject(
				parsed.ok
					? { status: "ok", path: file.path, roles: parsed.roles }
					: { status: "error", path: file.path, error: parsed.error },
			);
		} catch (e) {
			if (activePathRef.current !== dir) return;
			setProject({ status: "error", path: projectConfigPath(dir), error: errMsg(e) });
		}
	}, []);

	useEffect(() => {
		setProject({ status: "idle" });
		void loadProject(activeProjectPath);
	}, [activeProjectPath, loadProject]);

	// Mirror OmpConfigSection.handleChanged: force a reload after each write.
	const handleChanged = () => {
		void useOmpConfigStore.getState().load(true);
	};

	const roles = useMemo(() => asRecord(entryValue(entries, "modelRoles")), [entries]);
	const projectRoles = project.status === "ok" ? project.roles : EMPTY_ROLES;
	const chains = useMemo(
		() => asRecord(entryValue(entries, "retry.fallbackChains")),
		[entries],
	);
	const storage = useMemo(() => {
		const v = entryValue(entries, "modelRoleStorage");
		return v === "project" ? "project" : "global";
	}, [entries]);
	const cycle = useMemo(() => asStringList(entryValue(entries, "cycleOrder")), [entries]);
	const isProject = scope === "project";
	const customIds = useMemo(
		() => customRoles(isProject ? { ...roles, ...projectRoles } : roles),
		[roles, projectRoles, isProject],
	);
	const overrideIds = useMemo(
		() => Object.keys(projectRoles).filter((id) => roleValue(projectRoles, id) !== null),
		[projectRoles],
	);

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
		() => [...BUILTIN_ROLES.map((r) => r.id), ...customRoles(roles)],
		[roles],
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

	const writeGlobalRole = async (roleId: string, value: string | null) => {
		await ompConfigSet("modelRoles", JSON.stringify(withRoleAssignment(roles, roleId, value)));
	};

	// Re-read before every write so edits made elsewhere are never clobbered;
	// applyProjectRole throws on invalid YAML, so nothing is written then.
	const writeProjectRole = async (roleId: string, value: string | null) => {
		const targetPath = activeProjectPath;
		if (!targetPath) throw new Error("没有选中的项目");
		try {
			const file = await ompProjectConfigRead(targetPath);
			await ompProjectConfigWrite(targetPath, applyProjectRole(file.content, roleId, value));
		} finally {
			await loadProject(targetPath);
		}
	};

	const workspaces = useSessions((s) => s.workspaces);
	const activeProject = activeProjectPath
		? workspaces.find((w) => w.path === activeProjectPath) ?? null
		: null;
	const projectName = activeProject?.name ?? (activeProjectPath ? basename(activeProjectPath) : "");
	const projectPath =
		project.status === "idle"
			? activeProjectPath
				? projectConfigPath(activeProjectPath)
				: ""
			: project.path;

	const renderRow = (
		r: { id: string; label: string; description: string; kind: "chat" | "modelKind" },
		isCustom = false,
	) => (
		<RoleRow
			key={`${scope}:${r.id}`}
			roleId={r.id}
			label={r.label}
			description={r.description}
			kind={r.kind}
			isCustom={isCustom}
			scope={scope}
			current={roleValue(isProject ? projectRoles : roles, r.id)}
			inherited={isProject ? roleValue(roles, r.id) : null}
			projectOverride={isProject ? null : roleValue(projectRoles, r.id)}
			chains={chains}
			models={models}
			writeRole={isProject ? writeProjectRole : writeGlobalRole}
			onSaved={handleChanged}
		/>
	);

	return (
		<div className="space-y-4">
			{/* modelRoleStorage prominently */}
			<div className="space-y-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card">
				<div>
					<div className="mb-1.5 flex items-center gap-2">
						<span className="text-[11px] font-semibold text-neutral-300">角色保存策略</span>
						<span className="text-[10px] text-neutral-500">(modelRoleStorage)</span>
					</div>
					<div className="flex items-center gap-3">
						<Segmented
							size="sm"
							value={storage}
							disabled={storageBusy}
							onChange={(m) => void setStorage(m)}
							options={[
								{ value: "global", label: "全局统一" },
								{ value: "project", label: "按项目决定" },
							]}
						/>
					</div>
					<p className="mt-1.5 text-[11px] leading-[1.4] text-neutral-500">
						{storage === "global"
							? "所有会话与终端 /model 默认使用全局配置"
							: "终端 /model 优先写入当前项目 .omp/config.yml，实现仓库专属模型"}
					</p>
				</div>
			</div>

			{/* scope switcher */}
			<div className="space-y-1.5 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card">
				<div className="flex items-center gap-3">
					<span className="text-[11px] font-medium text-neutral-300">作用范围</span>
					<Segmented<Scope>
						size="sm"
						value={scope}
						onChange={(v) => {
							setScopePick(v);
							if (v === "project" && cwd && !activeProjectPath) {
								setActiveProjectPath(cwd);
							}
						}}
						options={[
							{ value: "global", label: "全局" },
							{
								value: "project",
								label: "项目",
								disabled: !cwd && workspaces.length === 0,
								title:
									!cwd && workspaces.length === 0
										? "先在左侧选中一个会话，或注册一个项目"
										: undefined,
							},
						]}
					/>
				</div>
				{isProject ? (
					<>
						{/* Workspace picker */}
						<div className="space-y-1.5">
							<span className="text-[10px] font-medium text-neutral-400">选择要配置的项目</span>
							<NativeSelect
								value={activeProjectPath ?? ""}
								onChange={(e) => setActiveProjectPath(e.target.value || null)}
								className="w-full text-[11px]"
							>
								{cwd && (
									<option value={cwd}>
										当前活跃会话所在项目 ({basename(cwd)})
									</option>
								)}
								{workspaces
									.filter((w) => w.path !== cwd)
									.map((w) => (
										<option key={w.id} value={w.path}>
											{w.name} — {w.path}
										</option>
									))}
							</NativeSelect>
						</div>
						<div className="min-w-0 text-[11px] leading-5 text-neutral-400">
							<div className="flex min-w-0 items-baseline gap-1.5">
								<span className="shrink-0 font-medium text-neutral-200">{projectName}</span>
								<span title={projectPath} className="min-w-0 truncate font-mono text-neutral-500">
									{projectPath}
								</span>
							</div>
							<div>仅对在该目录启动的会话生效；未覆盖的角色继承全局</div>
						</div>
					</>
				) : (
					<div className="text-[11px] leading-5 text-neutral-400">
						写入 <span className="font-mono text-neutral-300">~/.omp/agent/config.yml</span>（所有项目共用）
						{storage === "project" && (
							<div className="mt-1 text-neutral-500">
								💡 当前策略为「按项目决定」，终端 /model 会写入项目配置；上方「项目」范围可为任意项目预设角色
							</div>
						)}
					</div>
				)}
			</div>

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

			{isProject && project.status === "error" && (
				<div className="flex items-start gap-1.5 rounded-xl hairline bg-rose-950/20 px-3 py-2 text-[11px] leading-5 text-rose-300">
					<AlertTriangle className="mt-1 h-3 w-3 shrink-0" />
					<div className="min-w-0 flex-1">
						<div>无法使用项目配置（为免覆盖已停止写入）：{project.error}</div>
						<div className="break-all font-mono text-rose-300/70">{project.path}</div>
					</div>
					<button
						type="button"
						onClick={() => void loadProject(activeProjectPath)}
						className="shrink-0 whitespace-nowrap rounded-md bg-rose-500/20 px-1.5 py-0.5 font-medium text-rose-100 hover:bg-rose-500/30 active:scale-95 transition-all"
					>
						重新读取
					</button>
				</div>
			)}
			{isProject && project.status === "idle" && (
				<div className="text-xs text-neutral-500">正在读取项目配置…</div>
			)}

			{loaded && (!isProject || project.status === "ok") && (
				<>
					{!isProject && overrideIds.length > 0 && (
						<div className="flex items-center gap-2 rounded-xl hairline bg-sky-500/10 px-3 py-2 text-[11px] leading-5 text-sky-200">
							<span className="min-w-0 flex-1">
								当前项目「{projectName}」单独设置了 {overrideIds.length} 个角色（
								<span className="font-mono">{overrideIds.join(", ")}</span>
								），在该项目里以项目设置为准
							</span>
							<button
								type="button"
								onClick={() => setScopePick("project")}
								className="shrink-0 whitespace-nowrap rounded-md bg-sky-500/20 px-2 py-0.5 font-medium text-sky-100 hover:bg-sky-500/30 active:scale-95 transition-all"
							>
								查看项目设置
							</button>
						</div>
					)}

					<p className="px-1 text-[11px] leading-4 text-neutral-500">
						{isProject
							? "选模型即为本项目创建覆盖，「恢复继承」删除覆盖。回退链与切换顺序只支持全局设置。"
							: "选模型后立即保存；「回退」徽章展开该角色的回退链（未设置 = 用内置默认，不回退 = 失败即停，N 项 = 按顺序尝试）。"}
					</p>

					{chatRows.length > 0 && (
						<RoleGroup title="对话角色" titleHint="chat roles — 可带 :thinking 后缀">
							{chatRows.map((r) =>
								renderRow({ id: r.id, label: r.zhLabel, description: r.description, kind: r.kind }),
							)}
						</RoleGroup>
					)}

					{kindRows.length > 0 && (
						<RoleGroup
							title="模型职能角色"
							titleHint="model-kind roles — 图像 / 搜索 / 语音等专用运行器"
						>
							{kindRows.map((r) =>
								renderRow({ id: r.id, label: r.zhLabel, description: r.description, kind: r.kind }),
							)}
						</RoleGroup>
					)}

					{customRows.length > 0 && (
						<RoleGroup title="自定义角色" titleHint="modelRoles 中的非内置键">
							{customRows.map((id) =>
								renderRow(
									{
										id,
										label: id,
										description: "用户自定义角色（modelRoles 中的非内置键）",
										kind: "chat",
									},
									true,
								),
							)}
						</RoleGroup>
					)}

					{!isProject && (
						<div>
							<h3 className="mb-1.5 px-1 text-[11px] font-semibold text-neutral-400">高级</h3>
							<div className="space-y-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card">
								<CycleOrderEditor
									value={cycle}
									availableRoles={allRoleIds}
									onSaved={handleChanged}
								/>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}

/** idle = not yet read (or no cwd); ok/error carry the resolved file path. */
type ProjectState =
	| { status: "idle" }
	| { status: "ok"; path: string; roles: Record<string, unknown> }
	| { status: "error"; path: string; error: string };

const EMPTY_ROLES: Record<string, unknown> = {};

function projectConfigPath(dir: string): string {
	return `${dir.replace(/[\\/]+$/, "")}/.omp/config.yml`;
}

function basename(dir: string): string {
	return dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;
}
