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
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Children, useEffect, useMemo, useState, type ReactNode } from "react";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import type { OmpConfigEntry } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompConfigSet } from "../../lib/ipc";
import type { ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { BUILTIN_ROLES, asRecord, asStringList, customRoles, parseChain } from "./modelRoles";
import { FallbackChainEditor, ICON_BTN, SAVE_BTN } from "./FallbackChainEditor";
import { FallbackSwitchesCard, UsageAwareCard } from "./FallbackSwitchesCard";
import { ModelRulesSection } from "./ModelRulesSection";
import { useOmpConfigStore } from "./ompConfigStore";

const NO_MODELS: ModelOption[] = [];

const CHAT_ROLES = BUILTIN_ROLES.filter((r) => r.kind === "chat");
const KIND_ROLES = BUILTIN_ROLES.filter((r) => r.kind === "modelKind");

function entryValue(entries: OmpConfigEntry[], key: string): unknown {
	return entries.find((e) => e.key === key)?.value;
}

function flashSaved(setter: (v: boolean) => void) {
	setter(true);
	setTimeout(() => setter(false), 2000);
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
	inheritHint = "",
	chains,
	models,
	roleIds,
	onSaved,
}: {
	roleId: string;
	label: string;
	description: string;
	isCustom?: boolean;
	inheritHint?: string;
	chains: Record<string, unknown>;
	models: ModelOption[];
	roleIds: string[];
	onSaved: () => void;
}) {
	const [chainOpen, setChainOpen] = useState(false);
	const chain = useMemo(() => parseChain(chains[roleId]), [chains, roleId]);

	const preview =
		chain.state === "list" ? chain.items.join(" → ") : chain.state === "empty" ? "失败即停，不回退" : inheritHint;

	return (
		<div>
			<button
				type="button"
				aria-expanded={chainOpen}
				onClick={() => setChainOpen((v) => !v)}
				className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
			>
				<span title={description} className="w-24 shrink-0 pt-0.5">
					<span className="flex flex-wrap items-center gap-1.5">
						<span className="min-w-0 break-all font-mono text-[12px] font-semibold text-neutral-100">{roleId}</span>
						{isCustom && (
							<span className="shrink-0 rounded bg-violet-500/15 px-1 py-px text-[9px] font-normal text-violet-300">自定义</span>
						)}
					</span>
					{label && label !== roleId && chainOpen && (
						<span className="mt-0.5 block break-words text-[10.5px] text-neutral-500">{label}</span>
					)}
				</span>
				<span
					className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full hairline px-2.5 py-0.5 text-[11px] ${
						chain.state === "unset"
							? "bg-[var(--well-bg)] text-neutral-400"
							: chain.state === "empty"
								? "bg-amber-500/10 text-amber-300"
								: "bg-emerald-500/10 text-emerald-300"
					}`}
				>
					{chainChipLabel(chain.state, chain.items.length)}
				</span>
				<span className={`min-w-0 flex-1 break-all pt-0.5 text-[11px] leading-[1.45] ${chain.state === "unset" ? "text-neutral-600" : "font-mono text-neutral-500"}`}>
					{preview}
				</span>
				<ChevronDown
					className={`mt-1 h-3 w-3 shrink-0 text-neutral-500 transition-transform ${chainOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{chainOpen && (
				<div className="px-4 pb-3">
					<FallbackChainEditor
						chainKey={roleId}
						chains={chains}
						models={models}
						roleIds={roleIds}
						onSaved={onSaved}
						onCollapse={() => setChainOpen(false)}
						unsetTitle="继承：模型职能角色用内置候选，对话角色跟随 default 链"
						emptyTitle="显式空链 []：此角色失败时不回退"
					/>
				</div>
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
			<div className="mt-2 flex flex-wrap items-center gap-1.5">
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
			<h3 title={titleHint} className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-neutral-400">
				{title}
				<span className="rounded-full bg-[var(--well-bg)] px-1.5 py-px text-[10px] font-normal tabular-nums text-neutral-500">
					{Children.count(children)}
				</span>
			</h3>
			<div className="overflow-hidden rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card divide-y divide-[var(--border-divider)]">
				{children}
			</div>
		</div>
	);
}

/** Collapsible plain-language summary of how omp picks the backup chain. */
function PriorityExplainer() {
	const [open, setOpen] = useState(false);
	return (
		<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[11px] font-semibold text-neutral-300 transition-colors hover:bg-[var(--bg-hover)]"
			>
				<span className="flex-1">出错后用哪份备用名单？看这里</span>
				<span className="rounded-full hairline bg-[var(--well-bg)] px-2 py-px text-[10px] font-normal text-neutral-400">
					{open ? "收起" : "展开说明"}
				</span>
				<ChevronDown className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`} />
			</button>
			{open && (
				<div className="space-y-3 px-4 pb-3.5 text-[11px] leading-[1.55] text-neutral-400">
					<div>
						<p className="mb-1 font-semibold text-neutral-300">一个模型出错时，按这个顺序找备用名单，找到就用：</p>
						<ol className="list-decimal space-y-0.5 pl-5">
							<li>先看「模型规则」里有没有专门写给这个模型的（供应商/模型名）。</li>
							<li>没有，再看有没有写给它所属供应商的（供应商/*）。</li>
							<li>还没有，用它当时扮演的角色那一行的备用名单。</li>
							<li>仍然没有，聊天类角色会用 default 的名单；图像、搜索等专用角色不会用 default。</li>
						</ol>
					</div>
					<div>
						<p className="mb-1 font-semibold text-neutral-300">每一行有三种状态：</p>
						<ul className="list-disc space-y-0.5 pl-5">
							<li>未设置：专用角色用内置的备选；聊天类角色沿用 default 的名单。</li>
							<li>不回退：明确不换，出错就停。</li>
							<li>自定义：按你排的顺序一个个试。</li>
						</ul>
					</div>
					<div>
						<p className="mb-1 font-semibold text-neutral-300">名单里可以写：</p>
						<ul className="list-disc space-y-0.5 pl-5">
							<li>某个模型，可选思考强度；不选就沿用出错那一轮的强度。</li>
							<li>@角色：换成那个角色现在用的模型。</li>
							<li>供应商/*：模型名不变，只换供应商，强度总是沿用。</li>
						</ul>
					</div>
					<p>
						子代理（Agent）没有单独的回退名单：它自己配置的多个模型就是它的备用顺序，所以这里不提供编辑。
					</p>
				</div>
			)}
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

	const defaultChain = parseChain(chains.default);
	const defaultInherit =
		defaultChain.state === "list" ? `沿用 default：${defaultChain.items.join(" → ")}` : "沿用 default 链";

	const renderRow = (r: { id: string; label: string; description: string }, isCustom = false, inheritHint = "") => (
		<ChainRow
			key={r.id}
			roleId={r.id}
			label={r.label}
			description={r.description}
			isCustom={isCustom}
			inheritHint={inheritHint}
			chains={chains}
			models={models}
			roleIds={allRoleIds}
			onSaved={handleChanged}
		/>
	);

	const showSwitches = q === "" || /retry|fallback|usage|开关|额度|回退|冷却|切换/i.test(q);
	const showExplainer = q === "" || /优先|顺序|规则|agent|代理|继承|default/i.test(q);

	return (
		<div className="max-w-[600px] space-y-5">
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
					{showSwitches && <FallbackSwitchesCard onSaved={handleChanged} />}
					<ModelRulesSection
						chains={chains}
						models={models}
						roleIds={allRoleIds}
						query={q}
						onSaved={handleChanged}
					/>


					{chatRows.length > 0 && (
						<RoleGroup title="对话角色 · 聊天时用的模型" titleHint="聊天时使用的模型角色；备用模型可带 :thinking 后缀">
							{chatRows.map((r) =>
								renderRow(
									{ id: r.id, label: r.zhLabel, description: r.description },
									false,
									r.id === "default" ? "未配置回退链" : defaultInherit,
								),
							)}
						</RoleGroup>
					)}

					{kindRows.length > 0 && (
						<RoleGroup title="模型职能角色 · 图像/搜索/语音等专用" titleHint="图像、搜索、语音等专用模型角色；未设置时用内置备选">
							{kindRows.map((r) =>
								renderRow({ id: r.id, label: r.zhLabel, description: r.description }, false, "使用内置候选"),
							)}
						</RoleGroup>
					)}

					{customRows.length > 0 && (
						<RoleGroup title="自定义角色 · 你自己加的角色" titleHint="你在 modelRoles 里自己加的角色，也可以设置失败后的备用模型">
							{customRows.map((id) =>
								renderRow({ id, label: id, description: "用户自定义角色（modelRoles 中的非内置键）" }, true, defaultInherit),
							)}
						</RoleGroup>
					)}

					{q !== "" && !anyRole && (
						<p className="px-1 text-[11px] text-neutral-500">没有匹配「{q}」的角色。</p>
					)}

					{showExplainer && <PriorityExplainer />}

					<div>
						<h3 className="mb-1.5 px-1 text-[11px] font-semibold text-neutral-400">
							会话内切换
							<span className="ml-1.5 font-normal text-neutral-500">聊天时快捷键切换模型的先后顺序</span>
						</h3>
						<div className="rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
							<CycleOrderEditor value={cycle} availableRoles={allRoleIds} onSaved={handleChanged} />
						</div>
					</div>

					{showSwitches && <UsageAwareCard onSaved={handleChanged} />}

					<div>
						<h3 className="mb-1.5 px-1 text-[11px] font-semibold text-neutral-400">
							高级
							<span className="ml-1.5 font-normal text-neutral-500">终端里用 /model 换模型时，改动存到哪</span>
						</h3>
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
