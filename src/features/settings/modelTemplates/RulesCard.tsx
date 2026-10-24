/**
 * [D] Settings ▸ 模板与自动切换: quota-driven switch rules.
 *
 * A rule is 「某个额度供应商的某个窗口 ≥ 阈值%」→「应用模板 X」. The list order is
 * the priority order (first matching rule wins), so it is reordered with
 * up/down buttons like the `cycleOrder` editor. Providers and windows come from
 * the live `modelSwitchStatus().providers` report — never a hard-coded list.
 */
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { NativeSelect } from "../../../components/NativeSelect";
import { Switch } from "../Switch";
import type {
	ModelSwitchRule,
	ModelSwitchRuleInput,
	ModelTemplate,
	SwitchStatus,
	TemplateStoreSnapshot,
} from "../../../lib/contracts";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { isComposing } from "../../../lib/hooks";
import {
	modelSwitchRuleDelete,
	modelSwitchRuleSave,
	modelSwitchRulesReorder,
	modelSwitchSettingsSet,
	modelTemplateSave,
} from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { Notice } from "../../../components/Notice";
import {
	Button,
	Chip,
	CommitInput,
	IconButton,
	INPUT_CLASS,
	SettingRow,
	SettingsCard,
} from "../ui";
import {
	canAutoRevert,
	conflictText,
	GLOBAL_SCOPE,
	inScope,
	providerOptions,
	ruleConditionText,
	ruleFormDefaults,
	scopeDisplayName,
	type ScopeProject,
	windowOptionsFor,
} from "./logic";
import { useModelTemplatesStore } from "./store";
import { useT } from "../../../stores/language";

const DEFAULT_REVERT_DROP = 10;
const DEFAULT_POLL_MINUTES = 10;
const MIN_POLL_MINUTES = 1;
const MAX_POLL_MINUTES = 1440;

interface RuleForm {
	id: string | null;
	/** Where the rule applies: `"global"` or a project path. */
	scope: string;
	name: string;
	enabled: boolean;
	provider: string;
	windowKey: string;
	thresholdPct: string;
	templateId: string;
	autoRevert: boolean;
	revertThresholdPct: string;
}

function blankForm(status: SwitchStatus | null, templates: ModelTemplate[], scope: string): RuleForm {
	return {
		id: null,
		name: "",
		enabled: true,
		...ruleFormDefaults(status?.providers ?? [], templates, scope),
		thresholdPct: "95",
		autoRevert: false,
		revertThresholdPct: "",
	};
}

/** Clamp a percentage draft to 0–100; empty stays empty so the field can be cleared. */
function clampPct(raw: string): string {
	const n = Number.parseFloat(raw);
	if (!Number.isFinite(n)) return "";
	return String(Math.min(100, Math.max(0, n)));
}

function RuleFormView({
	form,
	status,
	templates,
	projects,
	busy,
	onChange,
	onCancel,
	onSave,
}: {
	form: RuleForm;
	status: SwitchStatus | null;
	/** Every template of every scope; the form lists the ones of its own scope. */
	templates: ModelTemplate[];
	projects: ScopeProject[];
	busy: boolean;
	onChange: (next: RuleForm) => void;
	onCancel: () => void;
	onSave: () => void;
}) {
	const { t } = useT();
	const scopeTemplates = inScope(templates, form.scope);
	const scopeMissing = form.scope !== GLOBAL_SCOPE && !projects.some((p) => p.path === form.scope);
	const providerChoices = providerOptions(status?.providers ?? []);
	// A rule saved against a provider/window that has no live report keeps its value
	// selectable, so editing another field never silently rewrites the condition.
	const providerMissing = form.provider !== "" && !providerChoices.some((p) => p.value === form.provider);
	const windowChoices = windowOptionsFor(status?.providers ?? [], form.provider);
	const windowMissing = form.windowKey !== "" && !windowChoices.some((w) => w.key === form.windowKey);
	const threshold = Number.parseFloat(form.thresholdPct);
	const revertDefault = Number.isFinite(threshold) ? String(Math.max(0, threshold - DEFAULT_REVERT_DROP)) : "";
	const canSave =
		form.name.trim().length > 0 &&
		form.provider.length > 0 &&
		form.windowKey.length > 0 &&
		form.templateId.length > 0 &&
		Number.isFinite(threshold) &&
		threshold >= 0 &&
		threshold <= 100;

	const patch = (part: Partial<RuleForm>) => onChange({ ...form, ...part });

	return (
		<div className="space-y-2 px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<input
					type="text"
					value={form.name}
					disabled={busy}
					onChange={(e) => patch({ name: e.target.value })}
					onKeyDown={(e) => {
						if (isComposing(e)) return;
						if (e.key === "Enter") {
							e.preventDefault();
							onSave();
						}
					}}
					placeholder={t("modelTemplates.ruleNamePlaceholder")}
					aria-label={t("modelTemplates.ruleNameLabel")}
					spellCheck={false}
					className={`${INPUT_CLASS} w-64`}
				/>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					{t("modelTemplates.providerLabel")}
					<NativeSelect
						aria-label={t("modelTemplates.providerAria")}
						value={form.provider}
						disabled={busy || providerChoices.length === 0}
						containerClassName="w-36"
						className="text-[11px]"
						onChange={(e) => {
							const provider = e.target.value;
							const first = windowOptionsFor(status?.providers ?? [], provider)[0];
							patch({ provider, windowKey: first?.key ?? "" });
						}}
					>
						{providerChoices.length === 0 && !providerMissing && <option value="">{t("modelTemplates.noQuotaReport")}</option>}
						{providerMissing && <option value={form.provider}>{t("modelTemplates.providerNoReport", { provider: form.provider })}</option>}
						{providerChoices.map((p) => (
							<option key={p.value} value={p.value}>
								{p.label}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					{t("modelTemplates.windowLabel")}
					<NativeSelect
						aria-label={t("modelTemplates.windowAria")}
						value={form.windowKey}
						disabled={busy || windowChoices.length === 0}
						containerClassName="w-32"
						className="text-[11px]"
						onChange={(e) => patch({ windowKey: e.target.value })}
					>
						{windowChoices.length === 0 && !windowMissing && <option value="">{t("modelTemplates.noWindows")}</option>}
						{windowMissing && <option value={form.windowKey}>{t("modelTemplates.windowNoData", { window: form.windowKey })}</option>}
						{windowChoices.map((w) => (
							<option key={w.key} value={w.key}>
								{w.label}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					{t("modelTemplates.reachLabel")}
					<input
						type="number"
						min={0}
						max={100}
						step={1}
						value={form.thresholdPct}
						disabled={busy}
						onChange={(e) => patch({ thresholdPct: e.target.value })}
						onBlur={() => patch({ thresholdPct: clampPct(form.thresholdPct) })}
						aria-label={t("modelTemplates.thresholdAria")}
						className={`${INPUT_CLASS} w-20 font-mono tabular-nums`}
					/>
					%
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					{t("modelTemplates.scopeLabel")}
					<NativeSelect
						aria-label={t("modelTemplates.scopeAria")}
						value={form.scope}
						disabled={busy}
						containerClassName="w-40"
						className="text-[11px]"
						onChange={(e) => patch({ scope: e.target.value, templateId: "" })}
					>
						<option value={GLOBAL_SCOPE}>{t("modelTemplates.scopeGlobal")}</option>
						{scopeMissing && <option value={form.scope}>{scopeDisplayName(form.scope, projects)}</option>}
						{projects.map((p) => (
							<option key={p.path} value={p.path}>
								{p.name}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					{t("modelTemplates.applyTemplateLabel")}
					<NativeSelect
						aria-label={t("modelTemplates.targetTemplateAria")}
						value={form.templateId}
						disabled={busy || scopeTemplates.length === 0}
						containerClassName="w-40"
						className="text-[11px]"
						onChange={(e) => patch({ templateId: e.target.value })}
					>
						{scopeTemplates.length === 0 && <option value="">{t("modelTemplates.scopeNoTemplates")}</option>}
						{scopeTemplates.length > 0 && form.templateId === "" && <option value="">{t("modelTemplates.selectTemplate")}</option>}
						{scopeTemplates.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
							</option>
						))}
					</NativeSelect>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					<Switch
						checked={form.autoRevert}
						onChange={(next) => patch({ autoRevert: next })}
						disabled={busy}
						ariaLabel={t("modelTemplates.autoRevertAria")}
					/>
					{t("modelTemplates.autoRevertLabel")}
				</div>
				{form.autoRevert && (
					<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
						{t("modelTemplates.dropsTo")}
						<input
							type="number"
							min={0}
							max={100}
							step={1}
							value={form.revertThresholdPct}
							disabled={busy}
							onChange={(e) => patch({ revertThresholdPct: e.target.value })}
							onBlur={() => patch({ revertThresholdPct: clampPct(form.revertThresholdPct) })}
							placeholder={revertDefault}
							aria-label={t("modelTemplates.revertThresholdAria")}
							className={`${INPUT_CLASS} w-20 font-mono tabular-nums`}
						/>
						{t("modelTemplates.percentOrBelow")}
						<span className="text-[var(--text-dim)]">{t("modelTemplates.revertDefaultHint", { drop: String(DEFAULT_REVERT_DROP) })}</span>
					</div>
				)}
				<span className="flex-1" />
				<Button size="sm" onClick={onCancel} disabled={busy}>
					{t("common.cancel")}
				</Button>
				<Button size="sm" variant="primary" onClick={onSave} disabled={busy || !canSave} loading={busy}>
					{form.id ? t("modelTemplates.saveRule") : t("modelTemplates.addRule")}
				</Button>
			</div>

			{providerChoices.length === 0 && (
				<Notice tone="info">
					{t("modelTemplates.noReportNotice")}
				</Notice>
			)}
		</div>
	);
}

function RuleRow({
	rule,
	index,
	total,
	status,
	templates,
	busy,
	onMove,
	onEdit,
	onToggle,
	onDelete,
}: {
	rule: ModelSwitchRule;
	index: number;
	total: number;
	status: SwitchStatus | null;
	templates: ModelTemplate[];
	busy: boolean;
	onMove: (delta: number) => void;
	onEdit: () => void;
	onToggle: (next: boolean) => void;
	onDelete: () => void;
}) {
	const { t } = useT();
	const template = templates.find((t) => t.id === rule.templateId);
	// The window is already at or below the revert threshold: the next check switches back.
	const reverting = canAutoRevert(rule, status?.providers ?? []);
	const revertPct = rule.revertThresholdPct ?? Math.max(0, rule.thresholdPct - DEFAULT_REVERT_DROP);
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<div className="flex shrink-0 items-center">
					<IconButton
						icon={ArrowUp}
						size="sm"
						label={t("modelTemplates.moveUp")}
						disabled={busy || index === 0}
						onClick={() => onMove(-1)}
					/>
					<span className="w-4 text-center text-[10px] tabular-nums text-[var(--text-dim)]">{index + 1}</span>
					<IconButton
						icon={ArrowDown}
						size="sm"
						label={t("modelTemplates.moveDown")}
						disabled={busy || index === total - 1}
						onClick={() => onMove(1)}
					/>
				</div>
				<Switch
					checked={rule.enabled}
					onChange={onToggle}
					disabled={busy}
					ariaLabel={rule.enabled ? t("modelTemplates.disableRuleAria", { name: rule.name }) : t("modelTemplates.enableRuleAria", { name: rule.name })}
				/>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="break-words text-[13px] font-medium leading-5 text-[var(--text)]">
							{rule.name}
						</span>
						{rule.autoRevert && <Chip tone="neutral">{t("modelTemplates.autoRevertChip", { pct: String(revertPct) })}</Chip>}
						{reverting && <Chip tone="accent">{t("modelTemplates.willRevertNextCheck")}</Chip>}
					</div>
					<div className="break-words text-[11px] leading-4 text-[var(--text-muted)]">
						{ruleConditionText(rule, status?.providers ?? [])} →{" "}
						{template ? template.name : t("modelTemplates.templateDeleted", { id: rule.templateId })}
					</div>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				<Button size="sm" icon={Pencil} disabled={busy} onClick={onEdit}>
					{t("common.edit")}
				</Button>
				<Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={onDelete}>
					{t("common.delete")}
				</Button>
			</div>
		</div>
	);
}

export function RulesCard({
	snapshot,
	status,
	scope,
	projects,
}: {
	snapshot: TemplateStoreSnapshot | null;
	status: SwitchStatus | null;
	/** Page scope: `"global"` or a project path; decides which rules are listed. */
	scope: string;
	projects: ScopeProject[];
}) {
	const { t, locale } = useT();
	const [editing, setEditing] = useState<RuleForm | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const allTemplates = useMemo(() => snapshot?.templates ?? [], [snapshot]);
	const templates = useMemo(() => inScope(allTemplates, scope), [allTemplates, scope]);
	const rules = useMemo(
		() => inScope(snapshot?.rules ?? [], scope).sort((a, b) => a.sort - b.sort),
		[snapshot, scope],
	);
	const pageConflicts = useMemo(() => inScope(snapshot?.conflicts ?? [], scope), [snapshot, scope]);
	const scopeLabel = scopeDisplayName(scope, projects);
	const bottomLine = templates.find((t) => t.isBottomLine) ?? null;

	const publish = (next: TemplateStoreSnapshot) => {
		useModelTemplatesStore.getState().setSnapshot(next);
	};

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const save = (form: RuleForm) => {
		const threshold = Number.parseFloat(form.thresholdPct);
		const revertRaw = form.revertThresholdPct.trim();
		const revert = revertRaw === "" ? null : Number.parseFloat(revertRaw);
		const input: ModelSwitchRuleInput = {
			id: form.id,
			name: form.name.trim(),
			enabled: form.enabled,
			provider: form.provider,
			windowKey: form.windowKey,
			thresholdPct: threshold,
			templateId: form.templateId,
			scope: form.scope,
			autoRevert: form.autoRevert,
			revertThresholdPct: revert !== null && Number.isFinite(revert) ? revert : null,
		};
		void run(async () => {
			publish(await modelSwitchRuleSave(input));
			setEditing(null);
			toast.success(form.id ? t("modelTemplates.savedRule", { name: input.name }) : t("modelTemplates.addedRule", { name: input.name }));
		});
	};

	const reorder = (index: number, delta: number) => {
		const target = index + delta;
		if (target < 0 || target >= rules.length) return;
		const ids = rules.map((r) => r.id);
		[ids[index], ids[target]] = [ids[target], ids[index]];
		void run(async () => {
			publish(await modelSwitchRulesReorder(scope, ids));
		});
	};

	/** Re-save one rule with a single field changed (toggles on the row). */
	const patchRule = (rule: ModelSwitchRule, patch: Partial<ModelSwitchRuleInput>) => {
		void run(async () => {
			publish(
				await modelSwitchRuleSave({
					id: rule.id,
					name: rule.name,
					enabled: rule.enabled,
					provider: rule.provider,
					windowKey: rule.windowKey,
					thresholdPct: rule.thresholdPct,
					templateId: rule.templateId,
					autoRevert: rule.autoRevert,
					revertThresholdPct: rule.revertThresholdPct,
					scope: rule.scope,
					...patch,
				}),
			);
		});
	};

	const remove = async (rule: ModelSwitchRule) => {
		const ok = await confirmDialog(t("modelTemplates.deleteRuleConfirm", { name: rule.name }), {
			title: t("modelTemplates.deleteRuleTitle"),
			danger: true,
			okLabel: t("common.delete"),
		});
		if (!ok) return;
		void run(async () => {
			publish(await modelSwitchRuleDelete(rule.id));
			toast.success(t("modelTemplates.deletedRule", { name: rule.name }));
		});
	};

	/**
	 * The backend keeps the bottom line unique, so marking one clears the others.
	 * Clearing (`""`) means saving the current bottom line template without the flag.
	 */
	const setBottomLine = (templateId: string) => {
		const target = templateId === "" ? bottomLine : templates.find((t) => t.id === templateId);
		if (!target) return;
		const next = templateId !== "";
		if (target.isBottomLine === next) return;
		void run(async () => {
			publish(
				await modelTemplateSave({
					id: target.id,
					name: target.name,
					roles: target.roles,
					isBottomLine: next,
					scope: target.scope,
				}),
			);
		});
	};

	const setPollMinutes = (raw: string) => {
		const minutes = Number.parseInt(raw, 10);
		if (!Number.isFinite(minutes)) return;
		const clamped = Math.min(MAX_POLL_MINUTES, Math.max(MIN_POLL_MINUTES, minutes));
		const secs = clamped * 60;
		if (secs === (snapshot?.settings.pollIntervalSecs ?? DEFAULT_POLL_MINUTES * 60)) return;
		void run(async () => {
			publish(await modelSwitchSettingsSet(secs));
		});
	};

	const pollMinutes = String(Math.round((snapshot?.settings.pollIntervalSecs ?? DEFAULT_POLL_MINUTES * 60) / 60));

	return (
		<SettingsCard
			title={t("modelTemplates.rulesCardTitle")}
			jump={t("modelTemplates.rulesCardTitle")}
			description={t("modelTemplates.rulesCardDesc")}
			aside={rules.length > 0 ? t("modelTemplates.rulesCount", { count: String(rules.length) }) : undefined}
			clip
		>
			<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
				<span className="text-xs leading-[18px] text-[var(--text-muted)]">
					{templates.length === 0
						? t("modelTemplates.rulesPromptNewTemplate")
						: rules.length === 0 && !editing
							? t("modelTemplates.rulesPromptEmpty")
							: t("modelTemplates.rulesPromptOrder")}
				</span>
				<Button
					variant="primary"
					size="sm"
					icon={Plus}
					disabled={busy || templates.length === 0}
					onClick={() => {
						setError(null);
						setEditing(blankForm(status, allTemplates, scope));
					}}
					title={templates.length === 0 ? t("modelTemplates.rulesPromptNewTemplate") : undefined}
				>
					{t("modelTemplates.newRule")}
				</Button>
			</div>

			{status?.lastError && (
				<div className="px-4 pb-3">
					<Notice tone="danger" title={t("modelTemplates.lastCheckFailed")}>
						<span className="select-text break-all">{status.lastError}</span>
					</Notice>
				</div>
			)}

			{pageConflicts.length > 0 && (
				<div className="space-y-2 px-4 pb-3">
					{pageConflicts.map((conflict, i) => (
						<Notice key={`${conflict.kind}-${i}`} tone="warning">
							<span className="break-words">{conflictText(conflict)}</span>
						</Notice>
					))}
				</div>
			)}

			{error && (
				<div className="px-4 pb-3">
					<Notice tone="danger" title={t("common.failed")}>
						<span className="select-text break-all">{error}</span>
					</Notice>
				</div>
			)}

			{rules.map((rule, index) => (
				<RuleRow
					key={rule.id}
					rule={rule}
					index={index}
					total={rules.length}
					status={status}
					templates={templates}
					busy={busy}
					onMove={(delta) => reorder(index, delta)}
					onEdit={() => {
						setError(null);
						setEditing({
							scope: rule.scope,
							id: rule.id,
							name: rule.name,
							enabled: rule.enabled,
							provider: rule.provider,
							windowKey: rule.windowKey,
							thresholdPct: String(rule.thresholdPct),
							templateId: rule.templateId,
							autoRevert: rule.autoRevert,
							revertThresholdPct:
								rule.revertThresholdPct === null ? "" : String(rule.revertThresholdPct),
						});
					}}
					onToggle={(next) => patchRule(rule, { enabled: next })}
					onDelete={() => void remove(rule)}
				/>
			))}

			{editing && (
				<RuleFormView
					form={editing}
					status={status}
					templates={allTemplates}
					projects={projects}
					busy={busy}
					onChange={setEditing}
					onCancel={() => setEditing(null)}
					onSave={() => save(editing)}
				/>
			)}

			<div className="border-t border-[var(--border-divider)]">
				<SettingRow
					label={t("modelTemplates.bottomLineLabel")}
					description={t("modelTemplates.bottomLineScopeDesc", { scope: scopeLabel })}
					control={
						<NativeSelect
							aria-label={t("modelTemplates.bottomLineLabel")}
							value={bottomLine?.id ?? ""}
							disabled={busy || templates.length === 0}
							containerClassName="w-44"
							className="text-[11px]"
							onChange={(e) => setBottomLine(e.target.value)}
						>
							<option value="">{t("modelTemplates.notSet")}</option>
							{templates.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</NativeSelect>
					}
				/>
				<SettingRow
					label={t("modelTemplates.pollFrequencyLabel")}
					description={
						[
							status?.lastCheckAt
								? t("modelTemplates.lastCheckedAt", { time: new Date(status.lastCheckAt).toLocaleString(locale) })
								: t("modelTemplates.neverChecked"),
							status?.nextCheckAt
								? t("modelTemplates.nextCheckAt", { time: new Date(status.nextCheckAt).toLocaleString(locale) })
								: null,
						]
							.filter(Boolean)
							.join(" · ")
					}
					control={
						<div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
							{t("modelTemplates.every")}
							<CommitInput
								value={pollMinutes}
								type="number"
								min={MIN_POLL_MINUTES}
								max={MAX_POLL_MINUTES}
								aria-label={t("modelTemplates.pollIntervalAria")}
								className="w-16"
								normalize={(draft) => {
									const n = Number.parseInt(draft, 10);
									if (!Number.isFinite(n)) return String(DEFAULT_POLL_MINUTES);
									return String(Math.min(MAX_POLL_MINUTES, Math.max(MIN_POLL_MINUTES, n)));
								}}
								validate={(next) => {
									const n = Number.parseInt(next, 10);
									return Number.isFinite(n) && n >= MIN_POLL_MINUTES && n <= MAX_POLL_MINUTES
										? null
										: t("modelTemplates.pollIntervalValidation", { min: String(MIN_POLL_MINUTES), max: String(MAX_POLL_MINUTES) });
								}}
								onCommit={setPollMinutes}
							/>
							{t("modelTemplates.minutes")}
						</div>
					}
				/>
			</div>
		</SettingsCard>
	);
}
