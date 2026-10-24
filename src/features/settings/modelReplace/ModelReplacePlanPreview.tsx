/**
 * [D] Step 3 of 批量替换模型: the planned edits grouped by 全局 / 每个项目 /
 * 回退链 / 应用设置 / 定时任务. Every row carries a checkbox, its old → new value,
 * an optional per-row target override (model + level) and 冲突 / 已去重 badges.
 * Projects that could not be scanned are listed with their reason.
 */
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { useState } from "react";
import type { ModelKindEntry } from "../../../lib/contracts";
import type { KindGroup } from "./kinds";
import type { Plan, PlanRow, RowOverride } from "./logic";
import { levelsForSelector, supportedLevel } from "./logic";
import { BTN_GHOST, CHECKBOX_CLASS, Chip, LevelSelect, TargetPicker } from "./parts";
import { useT } from "../../../stores/language";

const SMALL_PICKER_BUTTON =
	"flex min-h-6 w-[340px] max-w-full items-center justify-between gap-1 rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-left text-[10px] text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50";

interface PickerData {
	entries: ModelKindEntry[] | null;
	loading: boolean;
	error: string | null;
	/** Overrides stay on the dialog target's kind. */
	group: KindGroup;
}

function PlanRowView({
	row,
	picker,
	override,
	onOverride,
	onToggle,
}: {
	row: PlanRow;
	picker: PickerData;
	override: RowOverride | undefined;
	onOverride: (override: RowOverride | null) => void;
	onToggle: (checked: boolean) => void;
}) {
	const { t } = useT();
	const [editing, setEditing] = useState(false);
	const open = editing || override !== undefined;
	// The level options belong to this row's own target, not the shared one.
	const levels = levelsForSelector(picker.entries, row.model);
	return (
		<div className="flex items-start gap-2 border-t border-[var(--border-divider)] px-3 py-2 text-[11px]">
			<input
				type="checkbox"
				checked={row.checked}
				onChange={(e) => onToggle(e.target.checked)}
				aria-label={t("modelReplace.replaceItemAria", { title: row.title })}
				className={`${CHECKBOX_CLASS} mt-0.5`}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="min-w-0 break-words font-medium text-neutral-200">{row.title}</span>
					<Chip tone="neutral">{row.context}</Chip>
					{row.conflict && (
						<Chip tone="warn" title={t("modelReplace.conflictTitle")}>
							{t("modelReplace.conflictBadge")}
						</Chip>
					)}
					{row.deduped && (
						<Chip tone="info" title={t("modelReplace.dedupedTitle")}>
							{t("modelReplace.dedupedBadge")}
						</Chip>
					)}
					{override !== undefined && (
						<Chip tone="good" title={t("modelReplace.overrideTitle")}>
							{t("modelReplace.overrideBadge")}
						</Chip>
					)}
					{!open && (
						<button
							type="button"
							onClick={() => setEditing(true)}
							className={`${BTN_GHOST} ml-auto`}
							title={levels.length > 0 ? t("modelReplace.overrideButtonTitle") : t("modelReplace.overrideButtonTitleNoLevel")}
						>
							{t("modelReplace.overrideButton")}
						</button>
					)}
				</div>
				<div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 font-mono text-[10px]">
					{/* `break-words` only splits inside a token when it cannot fit; browsers already break after `/` and `-`. */}
					<span className="whitespace-pre-wrap break-words text-neutral-500 line-through decoration-neutral-700">
						{row.before}
					</span>
					<ArrowRight size={10} className="mt-0.5 shrink-0 text-neutral-600" />
					<span className="whitespace-pre-wrap break-words text-neutral-200">{row.after}</span>
				</div>
				{open && (
					<div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--well-bg)] px-2 py-1.5">
						<span className="shrink-0 text-[10px] text-neutral-500">{t("modelReplace.overrideRowPrompt")}</span>
						<TargetPicker
							value={row.model}
							entries={picker.entries}
							loading={picker.loading}
							error={picker.error}
							initialGroup={picker.group}
							lockGroup={picker.group}
							caption={t("modelReplace.overrideCaption", { title: row.title })}
							buttonClass={SMALL_PICKER_BUTTON}
							onSelect={(model) =>
								onOverride({
									...override,
									model,
									level: supportedLevel(row.level, levelsForSelector(picker.entries, model)),
								})
							}
						/>
						<LevelSelect
							value={row.level}
							levels={levels}
							onChange={(level) => onOverride({ ...override, level })}
							ariaLabel={t("modelReplace.overrideLevelAria", { title: row.title })}
							containerClassName="w-40"
						/>
						<button
							type="button"
							onClick={() => {
								setEditing(false);
								onOverride(null);
							}}
							className={BTN_GHOST}
							title={t("modelReplace.revertToUnifiedTitle")}
						>
							{t("modelReplace.revertToUnified")}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

export function ModelReplacePlanPreview({
	plan,
	fromModel,
	scopeLabel,
	entries,
	kindsLoading,
	kindsError,
	targetGroup,
	overrides,
	onOverride,
	onToggle,
}: {
	plan: Plan;
	/** Display name of the replace scope (全部 / 全局 / 项目：<name>). */
	scopeLabel: string;
	fromModel: string;
	entries: ModelKindEntry[] | null;
	kindsLoading: boolean;
	kindsError: string | null;
	targetGroup: KindGroup;
	overrides: Record<string, RowOverride>;
	onOverride: (rowId: string, override: RowOverride | null) => void;
	onToggle: (rowId: string, checked: boolean) => void;
}) {
	const { t } = useT();
	const picker: PickerData = { entries, loading: kindsLoading, error: kindsError, group: targetGroup };
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-[11px] text-neutral-400">
				<span>
					{t("modelReplace.willModifyCount", { count: String(plan.edits.length) })}
				</span>
				<span className="rounded-full bg-[var(--well-bg)] px-2 py-0.5 text-[10px] text-neutral-300" title={t("modelReplace.scopePillTitle")}>
					{t("modelReplace.scopePill", { scope: scopeLabel })}
				</span>
				<span className="flex items-center gap-1">
					<Info className="h-3 w-3 shrink-0" />
					{t("modelReplace.projectScopeNotice")}
				</span>
			</div>

			{plan.chainError !== null && (
				<div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] px-3 py-2 text-[11px] leading-5 text-[var(--status-warning)]">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">
						{t("modelReplace.chainErrorNotice", { error: plan.chainError })}
					</span>
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
				{plan.rows.length === 0 ? (
					<p className="px-1 py-6 text-xs text-neutral-500">
						{t("modelReplace.emptyPlanNotice", { scope: scopeLabel, fromModel })}
					</p>
				) : (
					plan.groups.map((group) => (
						<div key={group.group} className="mb-3 rounded-xl hairline">
							<div className="flex items-center justify-between rounded-t-xl bg-[var(--well-bg)] px-3 py-1.5 text-[10px] text-neutral-500">
								<span>{group.title}</span>
								<span>{t("modelReplace.itemsCount", { count: String(group.rows.length) })}</span>
							</div>
							{group.rows.map((row) => (
								<PlanRowView
									key={row.id}
									row={row}
									picker={picker}
									override={overrides[row.id]}
									onOverride={(override) => onOverride(row.id, override)}
									onToggle={(checked) => onToggle(row.id, checked)}
								/>
							))}
						</div>
					))
				)}

				{plan.skippedProjects.length > 0 && (
					<div className="rounded-xl hairline">
						<div className="rounded-t-xl bg-[var(--well-bg)] px-3 py-1.5 text-[10px] text-neutral-500">
							{t("modelReplace.skippedProjectsHeader", { count: String(plan.skippedProjects.length) })}
						</div>
						{plan.skippedProjects.map((project) => (
							<div key={project.path} className="flex items-start gap-2 border-t border-[var(--border-divider)] px-3 py-1.5 text-[11px]">
								<span className="shrink-0 text-neutral-300">{project.name}</span>
								<span className="min-w-0 flex-1 break-all font-mono text-[10px] text-neutral-600">{project.path}</span>
								<span className="max-w-[40%] shrink-0 break-all text-[var(--status-warning)]">{project.reason}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
