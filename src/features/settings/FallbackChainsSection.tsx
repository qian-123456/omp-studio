/**
 * [D] Settings ▸ 回退链与切换 (`model-fallback`): per-role fallback chains
 * (`retry.fallbackChains`) and the in-session switch order (`cycleOrder`).
 *
 * Primary role models are edited only in Settings ▸ 模型角色
 * (AgentModelAssignmentsPanel); this file never writes `modelRoles`. Chains are
 * record-typed, so every chain write rewrites the whole `retry.fallbackChains`
 * record via withChain.
 */
import { Check, ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NativeSelect } from "../../components/NativeSelect";
import type { OmpConfigEntry } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompConfigSet } from "../../lib/ipc";
import type { ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { BUILTIN_ROLES, asRecord, asStringList, customRoles, parseChain } from "./modelRoles";
import { FallbackChainEditor } from "./FallbackChainEditor";
import { FallbackSwitchesCard, UsageAwareCard } from "./FallbackSwitchesCard";
import { ModelRulesSection } from "./ModelRulesSection";
import { Notice } from "../../components/Notice";
import { Button, Chip, IconButton, SettingsCard } from "./ui";
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
				title={preview ? `${roleId}\n${preview}` : roleId}
				className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
			>
				<span title={description} className="w-24 shrink-0 pt-0.5">
					<span className="flex flex-wrap items-center gap-1.5">
						<span className="min-w-0 break-all font-mono text-xs font-semibold text-[var(--text)]">{roleId}</span>
						{isCustom && <Chip tone="accent">自定义</Chip>}
					</span>
					{label && label !== roleId && chainOpen && (
						<span className="mt-0.5 block break-words text-[11px] text-[var(--text-dim)]">{label}</span>
					)}
				</span>
				<Chip tone={chain.state === "unset" ? "neutral" : chain.state === "empty" ? "warning" : "success"}>
					{chainChipLabel(chain.state, chain.items.length)}
				</Chip>
				<span
					className={`min-w-0 flex-1 break-all pt-0.5 text-[11px] leading-[1.45] ${chain.state === "unset" ? "text-[var(--text-dim)]" : "font-mono text-[var(--text-muted)]"}`}
				>
					{preview}
				</span>
				<ChevronDown
					className={`mt-1 h-3 w-3 shrink-0 text-[var(--text-dim)] transition-transform ${chainOpen ? "rotate-180" : ""}`}
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
			<div className="flex flex-wrap items-center gap-2">
				<span
					title="会话内模型切换器按此顺序轮换对话角色（cycleOrder）"
					className="text-xs font-medium text-[var(--text)]"
				>
					角色切换顺序
				</span>
				<span className="text-xs text-[var(--text-dim)]">会话内切换模型时按此顺序轮换</span>
				{savedTick && <Check className="h-3 w-3 text-[var(--status-success)]" />}
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				{items.map((r, i) => (
					<span
						key={`${r}-${i}`}
						className="inline-flex min-w-0 items-center gap-0.5 rounded-lg hairline bg-[var(--well-bg)] py-0.5 pl-1.5 pr-0.5"
					>
						<span className="text-[10px] tabular-nums text-[var(--text-dim)]">{i + 1}</span>
						<IconButton icon={ChevronLeft} size="sm" label="前移" disabled={busy || i === 0} onClick={() => move(i, -1)} />
						<span title={r} className="min-w-0 break-all font-mono text-[11px] text-[var(--text)]">
							{r}
						</span>
						<IconButton
							icon={ChevronRight}
							size="sm"
							label="后移"
							disabled={busy || i === items.length - 1}
							onClick={() => move(i, 1)}
						/>
						<IconButton
							icon={Trash2}
							size="sm"
							label="移除"
							disabled={busy}
							onClick={() => setItems(items.filter((_, j) => j !== i))}
						/>
					</span>
				))}
				{items.length === 0 && <span className="text-xs text-[var(--text-dim)]">暂无角色</span>}
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-1.5">
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
					className="w-28 shrink-0 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-[var(--text)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all"
				/>
				<IconButton
					icon={Plus}
					size="sm"
					label="把自定义角色名加入轮换顺序"
					disabled={busy || !other.trim() || items.includes(other.trim())}
					onClick={addOther}
				/>
				<span className="flex-1" />
				<Button variant="primary" size="sm" loading={busy} disabled={!dirty} onClick={() => void apply()}>
					{busy ? "保存中" : "应用"}
				</Button>
			</div>
		</div>
	);
}

/** One grouped card of role rows. */
function RoleGroup({
	title,
	description,
	count,
	children,
}: {
	title: string;
	description: string;
	count: number;
	children: ReactNode;
}) {
	return (
		<SettingsCard title={title} aside={`${count} 个`} description={description} clip jump={title}>
			{children}
		</SettingsCard>
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
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)]"
			>
				<span className="flex-1">出错后用哪份备用名单？看这里</span>
				<Chip>{open ? "收起" : "展开说明"}</Chip>
				<ChevronDown className={`h-3 w-3 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} />
			</button>
			{open && (
				<div className="space-y-3 px-4 pb-4 text-xs leading-[1.55] text-[var(--text-muted)]">
					<div>
						<p className="mb-1 font-semibold text-[var(--text)]">一个模型出错时，按这个顺序找备用名单，找到就用：</p>
						<ol className="list-decimal space-y-0.5 pl-5">
							<li>先看「模型规则」里有没有专门写给这个模型的（供应商/模型名）。</li>
							<li>没有，再看有没有写给它所属供应商的（供应商/*）。</li>
							<li>还没有，用它当时扮演的角色那一行的备用名单。</li>
							<li>仍然没有，聊天类角色会用 default 的名单；图像、搜索等专用角色不会用 default。</li>
						</ol>
					</div>
					<div>
						<p className="mb-1 font-semibold text-[var(--text)]">每一行有三种状态：</p>
						<ul className="list-disc space-y-0.5 pl-5">
							<li>未设置：专用角色用内置的备选；聊天类角色沿用 default 的名单。</li>
							<li>不回退：明确不换，出错就停。</li>
							<li>自定义：按你排的顺序一个个试。</li>
						</ul>
					</div>
					<div>
						<p className="mb-1 font-semibold text-[var(--text)]">名单里可以写：</p>
						<ul className="list-disc space-y-0.5 pl-5">
							<li>某个模型，可选思考强度；不选就沿用出错那一轮的强度。</li>
							<li>@角色：换成那个角色现在用的模型。</li>
							<li>供应商/*：模型名不变，只换供应商，强度总是沿用。</li>
						</ul>
					</div>
					<p>子代理没有单独的回退名单：它自己配置的多个模型就是它的备用顺序，所以这里不提供编辑。</p>
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

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		void useModelCatalog.getState().refresh();
	}, []);

	// Force an omp config reload after each write.
	const handleChanged = () => {
		void useOmpConfigStore.getState().load(true);
	};

	const roles = useMemo(() => asRecord(entryValue(entries, "modelRoles")), [entries]);
	const chains = useMemo(() => asRecord(entryValue(entries, "retry.fallbackChains")), [entries]);
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
		<div className="space-y-6">
			{error && (
				<Notice tone="danger">
					<span className="break-all">{error}</span>
				</Notice>
			)}
			{!loaded && !error && (
				<div className="text-xs text-[var(--text-dim)]">{loading ? "正在读取配置" : "暂无配置数据"}</div>
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
						<RoleGroup title="对话角色" description="聊天时使用的模型角色；备用模型可带思考强度后缀" count={chatRows.length}>
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
						<RoleGroup
							title="模型职能角色"
							description="图像、搜索、语音等专用模型角色；未设置时用内置备选"
							count={kindRows.length}
						>
							{kindRows.map((r) =>
								renderRow({ id: r.id, label: r.zhLabel, description: r.description }, false, "使用内置候选"),
							)}
						</RoleGroup>
					)}

					{customRows.length > 0 && (
						<RoleGroup title="自定义角色" description="你自己加的角色，也可以设置失败后的备用模型" count={customRows.length}>
							{customRows.map((id) =>
								renderRow({ id, label: id, description: "用户自定义角色（模型角色中的非内置项）" }, true, defaultInherit),
							)}
						</RoleGroup>
					)}

					{q !== "" && !anyRole && (
						<p className="px-1 text-xs text-[var(--text-dim)]">没有匹配「{q}」的角色。</p>
					)}

					{showExplainer && <PriorityExplainer />}

					<SettingsCard title="会话内切换" description="聊天时快捷键切换模型的先后顺序" jump="会话内切换">
						<div className="p-4">
							<CycleOrderEditor value={cycle} availableRoles={allRoleIds} onSaved={handleChanged} />
						</div>
					</SettingsCard>

					{showSwitches && <UsageAwareCard onSaved={handleChanged} />}
				</>
			)}
		</div>
	);
}
