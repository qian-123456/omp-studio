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
import { useT } from "../../stores/language";
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
function chainChipLabel(state: "unset" | "empty" | "list", count: number, t: (k: string, p?: Record<string, string | number>) => string) {
	if (state === "unset") return t("settingsModels.stateUnset");
	if (state === "empty") return t("settingsModels.stateEmpty");
	return t("settingsModels.stateCount", { count });
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
	const { t } = useT();
	const [chainOpen, setChainOpen] = useState(false);
	const chain = useMemo(() => parseChain(chains[roleId]), [chains, roleId]);

	const preview =
		chain.state === "list" ? chain.items.join(" → ") : chain.state === "empty" ? t("settingsModels.noFallbackStop") : inheritHint;

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
						{isCustom && <Chip tone="accent">{t("settingsModels.customBadge")}</Chip>}
					</span>
					{label && label !== roleId && chainOpen && (
						<span className="mt-0.5 block break-words text-[11px] text-[var(--text-dim)]">{label}</span>
					)}
				</span>
				<Chip tone={chain.state === "unset" ? "neutral" : chain.state === "empty" ? "warning" : "success"}>
					{chainChipLabel(chain.state, chain.items.length, t)}
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
						unsetTitle={t("settingsModels.unsetRoleTitle")}
						emptyTitle={t("settingsModels.emptyRoleTitle")}
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
	const { t } = useT();
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
			toast.error(t("settingsModels.saveOrderFailed", { error: errMsg(e) }));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div>
			<div className="flex flex-wrap items-center gap-2">
				<span
					title={t("settingsModels.cycleOrderCardDesc")}
					className="text-xs font-medium text-[var(--text)]"
				>
					{t("settingsModels.cycleOrderCardTitle")}
				</span>
				<span className="text-xs text-[var(--text-dim)]">{t("settingsModels.cycleOrderHint")}</span>
				{savedTick && <Check className="h-3 w-3 text-[var(--status-success)]" />}
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				{items.map((r, i) => (
					<span
						key={`${r}-${i}`}
						className="inline-flex min-w-0 items-center gap-0.5 rounded-lg hairline bg-[var(--well-bg)] py-0.5 pl-1.5 pr-0.5"
					>
						<span className="text-[10px] tabular-nums text-[var(--text-dim)]">{i + 1}</span>
						<IconButton icon={ChevronLeft} size="sm" label={t("settingsModels.movePrevAria")} disabled={busy || i === 0} onClick={() => move(i, -1)} />
						<span title={r} className="min-w-0 break-all font-mono text-[11px] text-[var(--text)]">
							{r}
						</span>
						<IconButton
							icon={ChevronRight}
							size="sm"
							label={t("settingsModels.moveNextAria")}
							disabled={busy || i === items.length - 1}
							onClick={() => move(i, 1)}
						/>
						<IconButton
							icon={Trash2}
							size="sm"
							label={t("settingsModels.removeAria")}
							disabled={busy}
							onClick={() => setItems(items.filter((_, j) => j !== i))}
						/>
					</span>
				))}
				{items.length === 0 && <span className="text-xs text-[var(--text-dim)]">{t("settingsModels.noRolesYet")}</span>}
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
					<option value="">{t("settingsModels.addRoleSelectOption")}</option>
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
					placeholder={t("settingsModels.customRolePlaceholder")}
					className="w-28 shrink-0 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-[var(--text)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all"
				/>
				<IconButton
					icon={Plus}
					size="sm"
					label={t("settingsModels.addCustomRoleAria")}
					disabled={busy || !other.trim() || items.includes(other.trim())}
					onClick={addOther}
				/>
				<span className="flex-1" />
				<Button variant="primary" size="sm" loading={busy} disabled={!dirty} onClick={() => void apply()}>
					{busy ? t("settingsModels.applySaving") : t("settingsModels.applyBtn")}
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
	const { t } = useT();
	return (
		<SettingsCard title={title} aside={t("settingsModels.countItemsAside", { count })} description={description} clip jump={title}>
			{children}
		</SettingsCard>
	);
}

/** Collapsible plain-language summary of how omp picks the backup chain. */
function PriorityExplainer() {
	const [open, setOpen] = useState(false);
	const { t } = useT();
	return (
		<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)]"
			>
				<span className="flex-1">{t("settingsModels.fallbackExplainerToggle")}</span>
				<Chip>{open ? t("settingsModels.fallbackExplainerCollapse") : t("settingsModels.fallbackExplainerExpand")}</Chip>
				<ChevronDown className={`h-3 w-3 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} />
			</button>
			{open && (
				<div className="space-y-3 px-4 pb-4 text-xs leading-[1.55] text-[var(--text-muted)]">
					<div>
						<p className="mb-1 font-semibold text-[var(--text)]">{t("settingsModels.fallbackOrderTitle")}</p>
						<ol className="list-decimal space-y-0.5 pl-5">
							<li>{t("settingsModels.fallbackOrder1")}</li>
							<li>{t("settingsModels.fallbackOrder2")}</li>
							<li>{t("settingsModels.fallbackOrder3")}</li>
							<li>{t("settingsModels.fallbackOrder4")}</li>
						</ol>
					</div>
					<div>
						<p className="mb-1 font-semibold text-[var(--text)]">{t("settingsModels.fallbackStatesTitle")}</p>
						<ul className="list-disc space-y-0.5 pl-5">
							<li>{t("settingsModels.fallbackState1")}</li>
							<li>{t("settingsModels.fallbackState2")}</li>
							<li>{t("settingsModels.fallbackState3")}</li>
						</ul>
					</div>
					<div>
						<p className="mb-1 font-semibold text-[var(--text)]">{t("settingsModels.fallbackContentsTitle")}</p>
						<ul className="list-disc space-y-0.5 pl-5">
							<li>{t("settingsModels.fallbackContent1")}</li>
							<li>{t("settingsModels.fallbackContent2")}</li>
							<li>{t("settingsModels.fallbackContent3")}</li>
						</ul>
					</div>
					<p>{t("settingsModels.fallbackAgentNote")}</p>
				</div>
			)}
		</div>
	);
}

/** Global fallback chains per role, the cycle order and the /model storage mode. */
export function FallbackChainsSection({ query = "" }: { query?: string }) {
	const { t } = useT();
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
		defaultChain.state === "list" ? t("settingsModels.defaultInheritHint", { items: defaultChain.items.join(" → ") }) : t("settingsModels.defaultInheritChain");

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

	const showSwitches = q === "" || /retry|fallback|usage|开关|额度|回退|冷却|切换|switch|quota|revert|cooling/i.test(q);
	const showExplainer = q === "" || /优先|顺序|规则|agent|代理|继承|default|priority|order|rule|inherit/i.test(q);

	return (
		<div className="space-y-6">
			{error && (
				<Notice tone="danger">
					<span className="break-all">{error}</span>
				</Notice>
			)}
			{!loaded && !error && (
				<div className="text-xs text-[var(--text-dim)]">{loading ? t("settingsModels.readingConfig") : t("settingsModels.noConfigData")}</div>
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
						<RoleGroup title={t("settingsModels.groupChatRoles")} description={t("settingsModels.groupChatRolesDesc")} count={chatRows.length}>
							{chatRows.map((r) =>
								renderRow(
									{ id: r.id, label: r.zhLabel, description: r.description },
									false,
									r.id === "default" ? t("settingsModels.unconfiguredChain") : defaultInherit,
								),
							)}
						</RoleGroup>
					)}

					{kindRows.length > 0 && (
						<RoleGroup
							title={t("settingsModels.groupFunctionalRoles")}
							description={t("settingsModels.groupFunctionalRolesDesc")}
							count={kindRows.length}
						>
							{kindRows.map((r) =>
								renderRow({ id: r.id, label: r.zhLabel, description: r.description }, false, t("settingsModels.useBuiltinCandidates")),
							)}
						</RoleGroup>
					)}

					{customRows.length > 0 && (
						<RoleGroup title={t("settingsModels.groupCustomRoles")} description={t("settingsModels.groupCustomRolesDesc")} count={customRows.length}>
							{customRows.map((id) =>
								renderRow({ id, label: id, description: t("settingsModels.customRoleDesc") }, true, defaultInherit),
							)}
						</RoleGroup>
					)}

					{q !== "" && !anyRole && (
						<p className="px-1 text-xs text-[var(--text-dim)]">{t("settingsModels.noMatchingRoles", { query: q })}</p>
					)}

					{showExplainer && <PriorityExplainer />}

					<SettingsCard title={t("settingsModels.inSessionSwitchCardTitle")} description={t("settingsModels.inSessionSwitchCardDesc")} jump={t("settingsModels.inSessionSwitchCardTitle")}>
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
