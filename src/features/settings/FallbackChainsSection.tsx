/**
 * [D] Settings ▸ 回退链与切换 (`model-fallback`): per-role fallback chains
 * (`retry.fallbackChains`), the in-session switch order (`cycleOrder`) and where
 * the terminal /model picker saves roles (`modelRoleStorage`).
 *
 * Primary role models are edited only in Settings ▸ 模型角色
 * (AgentModelAssignmentsPanel); this file never writes `modelRoles`. Chains are
 * record-typed, so every chain write rewrites the whole `retry.fallbackChains`
 * record via withChain.
 */
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import type { OmpConfigEntry } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompConfigSet } from "../../lib/ipc";
import { type ModelOption, toModelKey } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { BUILTIN_ROLES, asRecord, asStringList, customRoles, parseChain, withChain } from "./modelRoles";
import { useOmpConfigStore } from "./ompConfigStore";

const NO_MODELS: ModelOption[] = [];

const CHAT_ROLES = BUILTIN_ROLES.filter((r) => r.kind === "chat");
const KIND_ROLES = BUILTIN_ROLES.filter((r) => r.kind === "modelKind");

const ICON_BTN =
	"rounded-md p-1 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none";

const SAVE_BTN =
	"shrink-0 whitespace-nowrap rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--bg)] hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-50";

function entryValue(entries: OmpConfigEntry[], key: string): unknown {
	return entries.find((e) => e.key === key)?.value;
}

/** Group catalog models by provider, preserving `listModels` order. */
function groupModelsByProvider(models: ModelOption[]): { provider: string; models: ModelOption[] }[] {
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
					<span className="w-4 shrink-0 text-center font-mono text-[10px] text-neutral-600">{i + 1}</span>
					<input
						type="text"
						value={item}
						disabled={busy}
						onChange={(e) => setItems(items.map((x, j) => (j === i ? e.target.value : x)))}
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
				<button type="button" disabled={busy || !dirty} onClick={() => void apply()} className={SAVE_BTN}>
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

/** One compact role row: label, role id, chain state chip; expands the chain editor inline. */
function ChainRow({
	roleId,
	label,
	description,
	isCustom = false,
	chains,
	models,
	onSaved,
}: {
	roleId: string;
	label: string;
	description: string;
	isCustom?: boolean;
	chains: Record<string, unknown>;
	models: ModelOption[];
	onSaved: () => void;
}) {
	const [chainOpen, setChainOpen] = useState(false);
	const chain = useMemo(() => parseChain(chains[roleId]), [chains, roleId]);

	return (
		<div className="px-3.5 py-2">
			<div className="flex items-center gap-2">
				<span
					title={description}
					className="flex min-w-0 shrink-0 items-center gap-1.5 text-xs font-medium text-neutral-200"
				>
					{label}
					<span className="rounded bg-neutral-700/60 px-1 py-px font-mono text-[9px] font-normal text-neutral-400">
						{roleId}
					</span>
					{isCustom && (
						<span className="rounded bg-violet-500/15 px-1 py-px text-[9px] font-normal text-violet-300">自定义</span>
					)}
				</span>
				<div className="ml-auto flex min-w-0 items-center gap-1.5">
					<button
						type="button"
						onClick={() => setChainOpen((v) => !v)}
						title="回退链：未设置=继承内置默认 · 不回退=失败即停 · N 项=按序尝试"
						className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg hairline px-2 py-1 text-[11px] transition-all active:scale-95 ${
							chainOpen
								? "bg-[var(--bg-active-fill)] text-neutral-100"
								: "bg-[var(--well-bg)] text-neutral-400 hover:text-neutral-200"
						}`}
					>
						回退 · {chainChipLabel(chain.state, chain.items.length)}
						<ChevronDown className={`h-2.5 w-2.5 transition-transform ${chainOpen ? "rotate-180" : ""}`} />
					</button>
				</div>
			</div>

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
				{items.length === 0 && <span className="text-[11px] text-neutral-600">（空）</span>}
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
				<button type="button" disabled={busy || !dirty} onClick={() => void apply()} className={SAVE_BTN}>
					{busy ? "保存中..." : "应用"}
				</button>
			</div>
		</div>
	);
}

/** One grouped card of role rows (macOS-style grouped list). */
function RoleGroup({ title, titleHint, children }: { title: string; titleHint?: string; children: ReactNode }) {
	return (
		<div>
			<h3 title={titleHint} className="mb-1.5 px-1 text-[11px] font-semibold text-neutral-400">
				{title}
			</h3>
			<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card divide-y divide-[var(--border-divider)]">
				{children}
			</div>
		</div>
	);
}

/** Global fallback chains per role, the cycle order and the /model storage mode. */
export function FallbackChainsSection({ query = "" }: { query?: string }) {
	const entries = useOmpConfigStore((s) => s.entries);
	const loading = useOmpConfigStore((s) => s.loading);
	const loaded = useOmpConfigStore((s) => s.loaded);
	const error = useOmpConfigStore((s) => s.error);
	const load = useOmpConfigStore((s) => s.load);
	const models = useModelOptions() ?? NO_MODELS;
	const [storageBusy, setStorageBusy] = useState(false);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		void useModelCatalog.getState().refresh();
	}, []);

	// Mirror OmpConfigSection.handleChanged: force a reload after each write.
	const handleChanged = () => {
		void useOmpConfigStore.getState().load(true);
	};

	const roles = useMemo(() => asRecord(entryValue(entries, "modelRoles")), [entries]);
	const chains = useMemo(() => asRecord(entryValue(entries, "retry.fallbackChains")), [entries]);
	const storage = entryValue(entries, "modelRoleStorage") === "project" ? "project" : "global";
	const cycle = useMemo(() => asStringList(entryValue(entries, "cycleOrder")), [entries]);
	const customIds = useMemo(() => customRoles(roles), [roles]);
	const allRoleIds = useMemo(() => [...BUILTIN_ROLES.map((r) => r.id), ...customIds], [customIds]);

	const q = query.trim();
	const matchRole = (r: { id: string; zhLabel: string; description: string }) => {
		const needle = q.toLowerCase();
		return (
			!needle ||
			r.id.toLowerCase().includes(needle) ||
			r.zhLabel.toLowerCase().includes(needle) ||
			r.description.toLowerCase().includes(needle)
		);
	};
	const chatRows = CHAT_ROLES.filter(matchRole);
	const kindRows = KIND_ROLES.filter(matchRole);
	const customRows = customIds.filter((id) => matchRole({ id, zhLabel: id, description: "" }));
	const anyRole = chatRows.length + kindRows.length + customRows.length > 0;

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

	const renderRow = (r: { id: string; label: string; description: string }, isCustom = false) => (
		<ChainRow
			key={r.id}
			roleId={r.id}
			label={r.label}
			description={r.description}
			isCustom={isCustom}
			chains={chains}
			models={models}
			onSaved={handleChanged}
		/>
	);

	return (
		<div className="space-y-4">
			{error && (
				<div className="flex items-start gap-1.5 rounded-xl hairline bg-rose-950/20 px-3 py-2 text-[11px] text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="break-all">{error}</span>
				</div>
			)}
			{!loaded && !error && (
				<div className="text-xs text-neutral-500">{loading ? "正在读取 OMP 配置…" : "暂无配置数据"}</div>
			)}

			{loaded && (
				<>
					<p className="px-1 text-[11px] leading-4 text-neutral-500">
						未设置 = 内置默认 · 不回退 = 失败即停 · N 项 = 按顺序尝试。主力模型请在「模型角色」中设置。
					</p>

					{chatRows.length > 0 && (
						<RoleGroup title="对话角色" titleHint="chat roles — 回退候选可带 :thinking 后缀">
							{chatRows.map((r) => renderRow({ id: r.id, label: r.zhLabel, description: r.description }))}
						</RoleGroup>
					)}

					{kindRows.length > 0 && (
						<RoleGroup title="模型职能角色" titleHint="model-kind roles — 图像 / 搜索 / 语音等专用运行器">
							{kindRows.map((r) => renderRow({ id: r.id, label: r.zhLabel, description: r.description }))}
						</RoleGroup>
					)}

					{customRows.length > 0 && (
						<RoleGroup title="自定义角色" titleHint="modelRoles 中的非内置键">
							{customRows.map((id) =>
								renderRow({ id, label: id, description: "用户自定义角色（modelRoles 中的非内置键）" }, true),
							)}
						</RoleGroup>
					)}

					{q !== "" && !anyRole && (
						<p className="px-1 text-[11px] text-neutral-500">没有匹配「{q}」的角色。</p>
					)}

					<div className="space-y-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card">
						<CycleOrderEditor value={cycle} availableRoles={allRoleIds} onSaved={handleChanged} />
					</div>

					<div>
						<h3 className="mb-1.5 px-1 text-[11px] font-semibold text-neutral-400">高级</h3>
						<div className="space-y-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card">
							<div>
								<div className="mb-1.5 flex items-center gap-2">
									<span className="text-[11px] font-semibold text-neutral-300">命令行 /model 保存位置</span>
									<span className="text-[10px] text-neutral-500">(modelRoleStorage)</span>
								</div>
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
								<p className="mt-1.5 text-[11px] leading-[1.4] text-neutral-500">
									{storage === "global"
										? "终端 /model 默认写入全局配置"
										: "终端 /model 优先写入当前项目 .omp/config.yml，实现仓库专属模型"}
								</p>
							</div>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
