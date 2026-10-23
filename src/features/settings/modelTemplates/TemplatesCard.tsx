/**
 * [D] Settings ▸ 模板与自动切换: the template list.
 *
 * One row per saved role→model template: name, how many roles it covers, the
 * 「当前生效」 badge (from the store snapshot's `current`), the quota providers
 * its rules depend on (with the live percentage), and 应用 / 编辑 / 复制 / 删除.
 * Creating a template captures the current global `modelRoles` on the backend.
 */
import { Copy, Layers, Loader2, Pencil, Play, Plus, Shield, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type {
	ModelSwitchRule,
	ModelTemplate,
	ProviderStatus,
	SwitchStatus,
	TemplateStoreSnapshot,
} from "../../../lib/contracts";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { modelTemplateDelete } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { EmptyState } from "../../../components/EmptyState";
import { Button, Chip, SettingsCard, type ChipTone } from "../ui";
import {
	currentForScope,
	driftSummary,
	GLOBAL_SCOPE,
	inScope,
	providerOptions,
	scopeWriteHint,
	type ScopeProject,
	windowOptionsFor,
} from "./logic";
import { useModelTemplatesStore } from "./store";

const PROVIDER_STATE: Record<string, { label: string; tone: ChipTone }> = {
	available: { label: "额度充足", tone: "success" },
	exhausted: { label: "额度用尽", tone: "danger" },
	unmapped: { label: "无额度报告", tone: "neutral" },
};

/** 「规则「省钱」依赖 Anthropic · 5 小时 · 当前 82%」 for one rule that applies this template. */
function RuleDependency({
	rule,
	providers,
}: {
	rule: ModelSwitchRule;
	providers: ProviderStatus[];
}) {
	const provider = providerOptions(providers).find((p) => p.value === rule.provider);
	const window = windowOptionsFor(providers, rule.provider).find((w) => w.key === rule.windowKey);
	const state = PROVIDER_STATE[providers.find((p) => p.usageSlug === rule.provider)?.state ?? ""] ?? {
		label: "状态未知",
		tone: "neutral" as ChipTone,
	};
	return (
		<div className="flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-[var(--text-muted)]">
			<span>规则「{rule.name}」依赖</span>
			<span className="font-medium text-[var(--text)]">{provider?.label ?? rule.provider}</span>
			<span>·</span>
			<span>{window?.label ?? rule.windowKey}</span>
			<span>·</span>
			<span className="tabular-nums">
				{window ? `当前 ${Math.round(window.usedPct)}%` : "暂无额度数据"}
			</span>
			<Chip tone={state.tone}>{state.label}</Chip>
		</div>
	);
}

function TemplateRow({
	template,
	snapshot,
	providers,
	busy,
	onApply,
	onEdit,
	onDuplicate,
	onDelete,
}: {
	template: ModelTemplate;
	snapshot: TemplateStoreSnapshot;
	providers: ProviderStatus[];
	busy: boolean;
	onApply: () => void;
	onEdit: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
}) {
	const roles = Object.keys(template.roles);
	const current = currentForScope(snapshot.currents, template.scope);
	const isCurrent = current !== null && current.templateId === template.id;
	const drift = current !== null && isCurrent ? driftSummary(current) : null;
	const dependents = snapshot.rules.filter((r) => r.templateId === template.id);

	return (
		<div className="px-4 py-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="break-words text-[13px] font-medium leading-5 text-[var(--text)]">
							{template.name}
						</span>
						<Chip title={roles.length > 0 ? roles.join("、") : undefined}>
							{roles.length} 个角色
						</Chip>
						{template.isBottomLine && (
							<Chip tone="accent" icon={Shield}>
								保底模板
							</Chip>
						)}
						{isCurrent && <Chip tone="accent">当前生效</Chip>}
						{drift && current && (
							<Chip tone="warning" title={drift}>{`${current.driftedRoles.length} 个角色被改动`}</Chip>
						)}
					</div>
					<div className="mt-1 space-y-0.5">
						{drift && (
							<div className="break-words text-[11px] leading-4 text-[var(--status-warning)]">
								{drift}：{current?.driftedRoles.join("、")}
							</div>
						)}
						{dependents.length === 0 ? (
							<div className="text-[11px] leading-4 text-[var(--text-dim)]">没有规则使用此模板</div>
						) : (
							dependents.map((rule) => (
								<RuleDependency key={rule.id} rule={rule} providers={providers} />
							))
						)}
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-1.5">
					<Button
						variant="primary"
						size="sm"
						icon={Play}
						disabled={busy}
						onClick={onApply}
						aria-label={`应用模板：${template.name}`}
					>
						应用
					</Button>
					<Button
						size="sm"
						icon={Pencil}
						disabled={busy}
						onClick={onEdit}
						aria-label={`编辑模板：${template.name}`}
					>
						编辑
					</Button>
					<Button
						size="sm"
						icon={Copy}
						disabled={busy}
						onClick={onDuplicate}
						aria-label={`复制模板：${template.name}`}
					>
						复制
					</Button>
					<Button
						variant="danger"
						size="sm"
						icon={Trash2}
						disabled={busy}
						onClick={onDelete}
						aria-label={`删除模板：${template.name}`}
					>
						删除
					</Button>
				</div>
			</div>
		</div>
	);
}

export function TemplatesCard({
	snapshot,
	status,
	onNew,
	creating,
	onEdit,
	onDuplicate,
	onApply,
	scope,
	projects,
}: {
	snapshot: TemplateStoreSnapshot | null;
	/** Page scope: `"global"` or a project path. */
	scope: string;
	projects: ScopeProject[];
	status: SwitchStatus | null;
	onNew: () => void;
	/** `modelTemplateCapture` is running; the header button shows the read state. */
	creating: boolean;
	onEdit: (template: ModelTemplate) => void;
	onDuplicate: (template: ModelTemplate) => void;
	onApply: (template: ModelTemplate) => void;
}) {
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const templates = useMemo(() => inScope(snapshot?.templates ?? [], scope), [snapshot, scope]);
	const providers = status?.providers ?? [];

	const remove = async (template: ModelTemplate) => {
		const dependents = snapshot?.rules.filter((r) => r.templateId === template.id).length ?? 0;
		const extra = dependents > 0 ? `\n引用它的 ${dependents} 条规则也会一起删除。` : "";
		const ok = await confirmDialog(`确定删除模板「${template.name}」吗？${extra}`, {
			title: "删除模板",
			danger: true,
			okLabel: "删除",
		});
		if (!ok) return;
		setDeletingId(template.id);
		try {
			const next = await modelTemplateDelete(template.id);
			useModelTemplatesStore.getState().setSnapshot(next);
			toast.success(`已删除模板「${template.name}」`);
		} catch (e) {
			toast.error(`删除模板失败：${errMsg(e)}`);
		} finally {
			setDeletingId(null);
		}
	};

	return (
		<SettingsCard title="角色模板" description={`一份「角色 → 模型」对照表。${scopeWriteHint(scope, projects)}`} clip>
			<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
				<span className="text-[11px] text-[var(--text-dim)]">
					{snapshot === null ? "正在读取" : `共 ${templates.length} 个模板`}
				</span>
				<Button variant="primary" size="sm" icon={Plus} onClick={onNew} loading={creating}>
					新建模板
				</Button>
			</div>
			{snapshot === null ? (
				<EmptyState icon={Loader2} spin title="正在读取模板" />
			) : templates.length === 0 ? (
				<EmptyState
					icon={Layers}
					title="还没有模板"
					description={
						scope === GLOBAL_SCOPE
							? "新建模板会把当前的全局模型角色存成一份对照表，之后可以一键应用或按额度自动切换。"
							: "新建模板会把该项目自己配置的模型角色存成一份对照表，之后可以一键应用或按额度自动切换。"
					}
					action={
						<Button variant="primary" size="sm" icon={Plus} onClick={onNew} loading={creating}>
							新建模板
						</Button>
					}
				/>
			) : (
				templates.map((template) => (
					<TemplateRow
						key={template.id}
						template={template}
						snapshot={snapshot}
						providers={providers}
						busy={deletingId === template.id}
						onApply={() => onApply(template)}
						onEdit={() => onEdit(template)}
						onDuplicate={() => onDuplicate(template)}
						onDelete={() => void remove(template)}
					/>
				))
			)}
		</SettingsCard>
	);
}
