import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronUp,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OmpConfigEntry } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { listModels, ompConfigSet } from "../../lib/ipc";
import { parseModels, toModelKey, type ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
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

function entryValue(
	entries: OmpConfigEntry[],
	key: string,
): unknown {
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

function flashSaved(setter: (v: boolean) => void) {
	setter(true);
	setTimeout(() => setter(false), 2000);
}

/**
 * Ordered fallback-chain editor for one role.
 * `omp` stores chains inside the `retry.fallbackChains` record, so writes
 * re-serialize the whole record with this role's entry replaced/removed.
 */
function ChainEditor({
	roleId,
	isCustom,
	chains,
	models,
	onSaved,
}: {
	roleId: string;
	isCustom: boolean;
	chains: Record<string, unknown>;
	models: ModelOption[];
	onSaved: () => void;
}) {
	const committed = useMemo(() => parseChain(chains[roleId]), [chains, roleId]);
	const [items, setItems] = useState<string[]>(committed.items);
	// Entered by picking 自定义 while unset/empty; cleared once the write lands
	// or another mode is picked.
	const [editing, setEditing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [savedTick, setSavedTick] = useState(false);

	// Re-sync the draft when the persisted chain changes (store reload / reset).
	useEffect(() => {
		setItems(committed.items);
	}, [committed]);

	const dirty = JSON.stringify(items) !== JSON.stringify(committed.items);
	const showList = committed.state === "list" || editing;

	const writeRecord = async (
		next: Record<string, unknown>,
	): Promise<boolean> => {
		setBusy(true);
		try {
			await ompConfigSet("retry.fallbackChains", JSON.stringify(next));
			flashSaved(setSavedTick);
			toast.success(`「${roleId}」回退链已保存`);
			onSaved();
			return true;
		} catch (e) {
			toast.error(`保存回退链失败：${errMsg(e)}`);
			return false;
		} finally {
			setBusy(false);
		}
	};

	const applyChain = async () => {
		if (await writeRecord(withChain(chains, roleId, items))) {
			setEditing(false);
		}
	};

	const pickMode = async (mode: string) => {
		if (busy) return;
		if (mode === "unset") {
			if (committed.state === "unset" && !editing) return;
			// omp config only accepts top-level schema keys, so "未设置" is reached
			// by rewriting retry.fallbackChains without this role's entry — a
			// subkey reset (`omp config reset retry.fallbackChains.<role>`) does
			// not exist.
			setEditing(false);
			await writeRecord(withChain(chains, roleId, null));
		} else if (mode === "empty") {
			setEditing(false);
			await writeRecord(withChain(chains, roleId, []));
		} else {
			// Custom: edit the committed list locally; written on 应用更改.
			setItems(committed.items);
			setEditing(true);
		}
	};

	const move = (i: number, delta: number) => {
		const j = i + delta;
		if (j < 0 || j >= items.length) return;
		const next = [...items];
		[next[i], next[j]] = [next[j], next[i]];
		setItems(next);
	};

	const chainKey = `retry.fallbackChains.${roleId}`;

	return (
		<div className="mt-3 border-t border-[var(--border-divider)] pt-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-[11px] font-medium text-neutral-300">回退链</span>
				<Segmented
					value={committed.state === "list" || editing ? "list" : committed.state}
					disabled={busy}
					onPick={(m) => void pickMode(m)}
					options={[
						{ id: "unset", label: "未设置", title: "继承 / 使用 OMP 内置默认回退" },
						{ id: "empty", label: "不回退", title: "显式空链：此角色失败时不回退" },
						{ id: "list", label: "自定义", title: "按顺序尝试回退模型" },
					]}
				/>
				{savedTick && (
					<span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400">
						<Check className="h-2.5 w-2.5" />
						已保存
					</span>
				)}
				{committed.state !== "unset" && !editing && (
					<button
						type="button"
						disabled={busy}
						onClick={() => void pickMode("unset")}
						title={`从 ${chainKey} 移除该角色的回退链，恢复内置默认`}
						className="ml-auto rounded-lg px-2 py-1 text-[11px] text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-amber-300 active:scale-95 transition-all disabled:opacity-50"
					>
						恢复默认
					</button>
				)}
			</div>

			{committed.state === "unset" && !editing && (
				<p className="mt-1.5 text-[11px] leading-5 text-neutral-500">
					此角色没有自定义回退链 — OMP 使用内置默认（模型职能角色回退到各自的内置候选列表，对话角色跟随 default）。
					重置整条记录需用命令行 <span className="font-mono">omp config reset retry.fallbackChains</span>。
				</p>
			)}
			{committed.state === "empty" && !editing && (
				<p className="mt-1.5 text-[11px] leading-5 text-neutral-500">
					显式空链（[]）：此角色失败时不会回退到其他模型。
				</p>
			)}
			{showList && (
				<div className="mt-2 space-y-1.5">
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
										void applyChain();
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
					<div className="flex items-center gap-2 pt-0.5 pl-5">
						<button
							type="button"
							disabled={busy || !dirty}
							onClick={() => void applyChain()}
							className="rounded-lg bg-[#0A84FF] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm disabled:opacity-50"
						>
							{busy ? "保存中..." : "应用更改"}
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
						{isCustom && (
							<span className="text-[10px] text-neutral-600">自定义角色</span>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
/**
 * One role card: primary model selector + fallback chain editor.
 * Primary writes rewrite the whole `modelRoles` record.
 */
function RoleCard({
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
	const [draft, setDraft] = useState(current ?? "");
	const [thinking, setThinking] = useState("");
	const [customMode, setCustomMode] = useState(false);
	const [busy, setBusy] = useState(false);
	const [savedTick, setSavedTick] = useState(false);

	// Re-sync when the persisted assignment changes.
	useEffect(() => {
		const next = current ?? "";
		setDraft(next);
		const { selector, thinkingSuffix } = splitRoleValue(next);
		setThinking(thinkingSuffix ?? "");
		setCustomMode(
			next !== "" && !models.some((m) => toModelKey(m.provider, m.id) === selector),
		);
	}, [current, models]);

	const catalogKeys = useMemo(
		() => models.map((m) => toModelKey(m.provider, m.id)),
		[models],
	);
	const grouped = useMemo(() => groupModelsByProvider(models), [models]);
	const { selector: baseSelector } = splitRoleValue(draft);
	const selectValue = customMode
		? CUSTOM_VALUE
		: catalogKeys.includes(baseSelector)
			? baseSelector
			: "";
	// The value omp would store for the current draft (selector + thinking
	// suffix for catalog picks, raw text in custom mode).
	const effective = customMode
		? draft.trim()
		: kind === "chat"
			? joinRoleValue(baseSelector, thinking || null)
			: baseSelector;
	const dirty = effective !== (current ?? "");

	const writeRoles = async (
		next: Record<string, unknown>,
		okMsg: string,
		errMsgPrefix: string,
	) => {
		setBusy(true);
		try {
			await ompConfigSet("modelRoles", JSON.stringify(next));
			flashSaved(setSavedTick);
			toast.success(okMsg);
			onSaved();
		} catch (e) {
			toast.error(`${errMsgPrefix}：${errMsg(e)}`);
		} finally {
			setBusy(false);
		}
	};

	const save = async () => {
		const final = effective;
		if (!final) {
			// Empty selector = un-assign the role (record entries can only be
			// removed by rewriting modelRoles without the key).
			await writeRoles(
				withRoleAssignment(roles, roleId, null),
				`已移除「${label}」的角色指定`,
				"移除失败",
			);
			return;
		}
		if (kind === "modelKind" && splitRoleValue(final).thinkingSuffix) {
			toast.error("模型职能角色不支持 :thinking 后缀");
			return;
		}
		await writeRoles(
			withRoleAssignment(roles, roleId, final),
			`「${label}」已保存为 ${final}`,
			"保存模型角色失败",
		);
	};

	const remove = () =>
		writeRoles(
			withRoleAssignment(roles, roleId, null),
			`已移除「${label}」的角色指定`,
			"移除失败",
		);

	return (
		<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card px-3 py-2.5">
			<div className="flex items-center gap-2">
				<span className="text-xs font-semibold tracking-[-0.01em] text-neutral-100">
					{label}
				</span>
				<span className="rounded bg-neutral-700/60 px-1 py-0.5 font-mono text-[9px] text-neutral-400">
					{roleId}
				</span>
				{isCustom && (
					<span className="rounded bg-violet-500/15 px-1 py-0.5 text-[9px] text-violet-300">
						自定义
					</span>
				)}
				{savedTick && (
					<span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400">
						<Check className="h-2.5 w-2.5" />
						已保存
					</span>
				)}
				{current !== null && (
					<button
						type="button"
						disabled={busy}
						onClick={() => void remove()}
						title="移除角色指定（重写 modelRoles 记录，移除该键）"
						className="ml-auto rounded-lg p-1 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-amber-300 active:scale-95 transition-all disabled:opacity-50"
					>
						<Trash2 className="h-3 w-3" />
					</button>
				)}
			</div>
			<p className="mt-0.5 text-[11px] leading-4 text-neutral-500">{description}</p>

			<div className="mt-2 flex items-end gap-1.5">
				<div className="min-w-0 flex-1">
					<NativeSelect
						value={customMode ? CUSTOM_VALUE : selectValue}
						disabled={busy}
						onChange={(e) => {
							if (e.target.value === CUSTOM_VALUE) {
								setCustomMode(true);
							} else {
								setCustomMode(false);
								setDraft(e.target.value);
							}
						}}
						className="text-[11px]"
					>
						<option value="">未设置（使用内置默认）</option>
						{grouped.map((g) => (
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
						<option value={CUSTOM_VALUE}>自定义…</option>
					</NativeSelect>
				</div>
				{kind === "chat" && !customMode && (
					<NativeSelect
						value={thinking}
						disabled={busy}
						onChange={(e) => setThinking(e.target.value)}
						className="text-[11px]"
						containerClassName="w-24 shrink-0"
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
					disabled={busy || !dirty}
					onClick={() => void save()}
					className="shrink-0 rounded-lg bg-[#0A84FF] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm disabled:opacity-50"
				>
					{busy ? "保存中..." : "保存"}
				</button>
			</div>
			{customMode && (
				<input
					type="text"
					value={draft}
					disabled={busy}
					autoFocus
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (isComposing(e)) return;
						if (e.key === "Enter") {
							e.preventDefault();
							void save();
						}
						if (e.key === "Escape") {
							setCustomMode(false);
							setDraft(current ?? "");
						}
					}}
					spellCheck={false}
					placeholder="provider/id[:level]、web/duckduckgo、local/kokoro、@smol"
					className="mt-1.5 w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
				/>
			)}
			{models.length === 0 && !customMode && (
				<p className="mt-1.5 text-[10px] leading-4 text-neutral-600">
					未获取到模型目录，可用「自定义…」手动输入选择器。
				</p>
			)}

			<ChainEditor
				roleId={roleId}
				isCustom={isCustom}
				chains={chains}
				models={models}
				onSaved={onSaved}
			/>
		</div>
	);
}

/**
 * Ordered `cycleOrder` editor — the chat roles the model switcher cycles through.
 */
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
			toast.success("角色切换顺序已保存");
			onSaved();
		} catch (e) {
			toast.error(`保存 cycleOrder 失败：${errMsg(e)}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div>
			<div className="flex items-center gap-2">
				<span className="text-[11px] font-medium text-neutral-300">角色切换顺序</span>
				{savedTick && (
					<span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400">
						<Check className="h-2.5 w-2.5" />
						已保存
					</span>
				)}
			</div>
			<p className="mt-0.5 text-[11px] leading-4 text-neutral-500">
				会话内模型切换器按此顺序轮换对话角色（cycleOrder）
			</p>
			<div className="mt-2 flex flex-wrap items-center gap-1">
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
					<span className="text-[11px] text-neutral-600">（空 — 切换器将无角色可轮换）</span>
				)}
			</div>
			<div className="mt-2 flex items-center gap-1.5">
				<NativeSelect
					value=""
					disabled={busy}
					onChange={(e) => {
						const v = e.target.value;
						if (v) setItems([...items, v]);
						e.target.value = "";
					}}
					className="text-[11px]"
					containerClassName="w-48"
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
					className="w-32 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
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
					className="rounded-lg bg-[#0A84FF] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm disabled:opacity-50"
				>
					{busy ? "保存中..." : "应用"}
				</button>
			</div>
		</div>
	);
}

const CHAT_ROLES = BUILTIN_ROLES.filter((r) => r.kind === "chat");
const KIND_ROLES = BUILTIN_ROLES.filter((r) => r.kind === "modelKind");

/**
 * Desktop equivalent of omp `/model` → Roles: assign each role a primary model
 * and an ordered fallback chain. Backed by `modelRoles` + `retry.fallbackChains`
 * (both record-typed — single-role writes rewrite the whole record).
 */
export function ModelRolesSection() {
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

	const roles = useMemo(
		() => asRecord(entryValue(entries, "modelRoles")),
		[entries],
	);
	const chains = useMemo(
		() => asRecord(entryValue(entries, "retry.fallbackChains")),
		[entries],
	);
	const storage = useMemo(() => {
		const v = entryValue(entries, "modelRoleStorage");
		return v === "project" ? "project" : "global";
	}, [entries]);
	const cycle = useMemo(
		() => asStringList(entryValue(entries, "cycleOrder")),
		[entries],
	);
	const customIds = useMemo(() => customRoles(roles), [roles]);

	const allRoleIds = useMemo(
		() => [...BUILTIN_ROLES.map((r) => r.id), ...customIds],
		[customIds],
	);

	const setStorage = async (mode: string) => {
		if (mode === storage || storageBusy) return;
		setStorageBusy(true);
		try {
			await ompConfigSet("modelRoleStorage", mode);
			toast.success(
				mode === "global"
					? "角色指定将保存到全局配置"
					: "角色指定将保存到项目配置",
			);
			handleChanged();
		} catch (e) {
			toast.error(`保存 modelRoleStorage 失败：${errMsg(e)}`);
		} finally {
			setStorageBusy(false);
		}
	};

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
					模型角色与回退链
				</h2>
				<p className="text-xs text-[rgba(235,235,245,0.60)]">
					为每个角色指定主力模型（modelRoles），并配置按顺序尝试的回退模型（retry.fallbackChains）
				</p>
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

			{loaded && (
				<>
					{/* storage + cycle order */}
					<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
						<div>
							<div className="flex items-center gap-3">
								<span className="text-[11px] font-medium text-neutral-300">
									角色保存位置
								</span>
								<Segmented
									value={storage}
									disabled={storageBusy}
									onPick={(m) => void setStorage(m)}
									options={[
										{ id: "global", label: "global（全局）" },
										{ id: "project", label: "project（项目）" },
									]}
								/>
							</div>
						<p className="mt-1 text-[11px] leading-4 text-neutral-500">
							modelRoleStorage：TUI 里 /model 选择器的保存位置。此处编辑始终写入全局配置（omp config set 不走项目分支）
						</p>
						{storage === "project" && (
							<div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-200">
								<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
								<div className="flex-1">
									project 模式下，仓库内
									<span className="font-mono"> .omp/config.yml </span>
									的角色指定会覆盖全局——在此处的修改写进全局后，带项目覆盖的仓库里仍使用项目值，改动看起来不生效。建议使用 global，并删除仓库里的角色覆盖。
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
						</div>
						<div className="border-t border-[var(--border-divider)] pt-4">
							<CycleOrderEditor
								value={cycle}
								availableRoles={allRoleIds}
								onSaved={handleChanged}
							/>
						</div>
					</div>

					{/* chat roles */}
					<div>
						<h3 className="mb-2 text-xs font-semibold tracking-[-0.01em] text-neutral-300">
							对话角色
						</h3>
						<div className="space-y-2">
							{CHAT_ROLES.map((r) => (
								<RoleCard
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
						</div>
					</div>

					{/* model-kind roles */}
					<div>
						<h3 className="mb-2 text-xs font-semibold tracking-[-0.01em] text-neutral-300">
							模型职能角色
						</h3>
						<div className="space-y-2">
							{KIND_ROLES.map((r) => (
								<RoleCard
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
						</div>
					</div>

					{/* custom roles (only when present in modelRoles / modelTags) */}
					{customIds.length > 0 && (
						<div>
							<h3 className="mb-2 text-xs font-semibold tracking-[-0.01em] text-neutral-300">
								自定义角色
							</h3>
							<div className="space-y-2">
								{customIds.map((id) => (
									<RoleCard
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
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
