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
import {
	Button,
	Chip,
	CommitInput,
	IconButton,
	INPUT_CLASS,
	Notice,
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
					placeholder="规则名称，例如：Claude 五小时额度告急"
					aria-label="规则名称"
					spellCheck={false}
					className={`${INPUT_CLASS} w-64`}
				/>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					供应商
					<NativeSelect
						aria-label="额度供应商"
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
						{providerChoices.length === 0 && !providerMissing && <option value="">没有额度报告</option>}
						{providerMissing && <option value={form.provider}>{form.provider}（当前无额度报告）</option>}
						{providerChoices.map((p) => (
							<option key={p.value} value={p.value}>
								{p.label}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					窗口
					<NativeSelect
						aria-label="额度窗口"
						value={form.windowKey}
						disabled={busy || windowChoices.length === 0}
						containerClassName="w-32"
						className="text-[11px]"
						onChange={(e) => patch({ windowKey: e.target.value })}
					>
						{windowChoices.length === 0 && !windowMissing && <option value="">暂无窗口</option>}
						{windowMissing && <option value={form.windowKey}>{form.windowKey}（当前无数据）</option>}
						{windowChoices.map((w) => (
							<option key={w.key} value={w.key}>
								{w.label}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					达到
					<input
						type="number"
						min={0}
						max={100}
						step={1}
						value={form.thresholdPct}
						disabled={busy}
						onChange={(e) => patch({ thresholdPct: e.target.value })}
						onBlur={() => patch({ thresholdPct: clampPct(form.thresholdPct) })}
						aria-label="阈值百分比"
						className={`${INPUT_CLASS} w-20 font-mono tabular-nums`}
					/>
					%
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					作用范围
					<NativeSelect
						aria-label="作用范围"
						value={form.scope}
						disabled={busy}
						containerClassName="w-40"
						className="text-[11px]"
						onChange={(e) => patch({ scope: e.target.value, templateId: "" })}
					>
						<option value={GLOBAL_SCOPE}>全局</option>
						{scopeMissing && <option value={form.scope}>{scopeDisplayName(form.scope, projects)}</option>}
						{projects.map((p) => (
							<option key={p.path} value={p.path}>
								{p.name}
							</option>
						))}
					</NativeSelect>
				</div>
				<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
					应用模板
					<NativeSelect
						aria-label="目标模板"
						value={form.templateId}
						disabled={busy || scopeTemplates.length === 0}
						containerClassName="w-40"
						className="text-[11px]"
						onChange={(e) => patch({ templateId: e.target.value })}
					>
						{scopeTemplates.length === 0 && <option value="">该范围还没有模板</option>}
						{scopeTemplates.length > 0 && form.templateId === "" && <option value="">请选择模板</option>}
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
						ariaLabel="额度恢复后自动切回"
					/>
					额度恢复后自动切回
				</div>
				{form.autoRevert && (
					<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
						降到
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
							aria-label="自动切回阈值百分比"
							className={`${INPUT_CLASS} w-20 font-mono tabular-nums`}
						/>
						% 以下
						<span className="text-[var(--text-dim)]">留空则按阈值减 {DEFAULT_REVERT_DROP}%</span>
					</div>
				)}
				<span className="flex-1" />
				<Button size="sm" onClick={onCancel} disabled={busy}>
					取消
				</Button>
				<Button size="sm" variant="primary" onClick={onSave} disabled={busy || !canSave} loading={busy}>
					{form.id ? "保存规则" : "添加规则"}
				</Button>
			</div>

			{providerChoices.length === 0 && (
				<Notice tone="info">
					还没有读到额度报告，供应商和窗口暂时无法选择。请先在「模型与供应商」里确认额度账号可用。
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
						label="提高优先级"
						disabled={busy || index === 0}
						onClick={() => onMove(-1)}
					/>
					<span className="w-4 text-center text-[10px] tabular-nums text-[var(--text-dim)]">{index + 1}</span>
					<IconButton
						icon={ArrowDown}
						size="sm"
						label="降低优先级"
						disabled={busy || index === total - 1}
						onClick={() => onMove(1)}
					/>
				</div>
				<Switch
					checked={rule.enabled}
					onChange={onToggle}
					disabled={busy}
					ariaLabel={rule.enabled ? `停用规则：${rule.name}` : `启用规则：${rule.name}`}
				/>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="break-words text-[13px] font-medium leading-5 text-[var(--text)]">
							{rule.name}
						</span>
						{rule.autoRevert && <Chip tone="neutral">自动切回 ≤ {revertPct}%</Chip>}
						{reverting && <Chip tone="accent">下次检查会切回</Chip>}
					</div>
					<div className="break-words text-[11px] leading-4 text-[var(--text-muted)]">
						{ruleConditionText(rule, status?.providers ?? [])} →{" "}
						{template ? template.name : `（模板已删除：${rule.templateId}）`}
					</div>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				<Button size="sm" icon={Pencil} disabled={busy} onClick={onEdit}>
					编辑
				</Button>
				<Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={onDelete}>
					删除
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
			toast.success(form.id ? `已保存规则「${input.name}」` : `已添加规则「${input.name}」`);
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
		const ok = await confirmDialog(`确定删除规则「${rule.name}」吗？`, {
			title: "删除规则",
			danger: true,
			okLabel: "删除",
		});
		if (!ok) return;
		void run(async () => {
			publish(await modelSwitchRuleDelete(rule.id));
			toast.success(`已删除规则「${rule.name}」`);
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
			title="自动切换规则"
			description="额度达到阈值，自动应用对应模板。"
			aside={rules.length > 0 ? `${rules.length} 条` : undefined}
			clip
		>
			<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
				<span className="text-xs leading-[18px] text-[var(--text-muted)]">
					{templates.length === 0
						? "先新建一个模板，再设置自动切换。"
						: rules.length === 0 && !editing
							? "还没有规则。例如：某个供应商额度用到 95% 时，自动切到「省钱模式」模板。"
							: "按从上到下的顺序检查，第一条命中的规则生效。"}
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
					title={templates.length === 0 ? "先新建一个模板" : undefined}
				>
					新建规则
				</Button>
			</div>

			{status?.lastError && (
				<div className="px-4 pb-3">
					<Notice tone="danger" title="上次检查额度失败">
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
					<Notice tone="danger" title="操作失败">
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
					label="保底模板"
					description={`${scopeLabel}范围内所有供应商额度都用尽时，仍然应用这个模板。`}
					control={
						<NativeSelect
							aria-label="保底模板"
							value={bottomLine?.id ?? ""}
							disabled={busy || templates.length === 0}
							containerClassName="w-44"
							className="text-[11px]"
							onChange={(e) => setBottomLine(e.target.value)}
						>
							<option value="">不设置</option>
							{templates.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</NativeSelect>
					}
				/>
				<SettingRow
					label="额度检查频率"
					description={
						[
							status?.lastCheckAt
								? `上次检查 ${new Date(status.lastCheckAt).toLocaleString("zh-CN")}`
								: "还没检查过额度",
							status?.nextCheckAt
								? `下次检查 ${new Date(status.nextCheckAt).toLocaleString("zh-CN")}`
								: null,
						]
							.filter(Boolean)
							.join(" · ")
					}
					control={
						<div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
							每
							<CommitInput
								value={pollMinutes}
								type="number"
								min={MIN_POLL_MINUTES}
								max={MAX_POLL_MINUTES}
								aria-label="额度检查间隔（分钟）"
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
										: `请输入 ${MIN_POLL_MINUTES}–${MAX_POLL_MINUTES} 之间的分钟数`;
								}}
								onCommit={setPollMinutes}
							/>
							分钟
						</div>
					}
				/>
			</div>
		</SettingsCard>
	);
}
