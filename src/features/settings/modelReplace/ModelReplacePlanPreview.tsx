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

/** Shown wherever the scan's project coverage matters. */
export const PROJECT_SCOPE_NOTICE = "仅覆盖在本桌面端添加的项目";

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
				aria-label={`替换 ${row.title}`}
				className={`${CHECKBOX_CLASS} mt-0.5`}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="min-w-0 break-words font-medium text-neutral-200">{row.title}</span>
					<Chip tone="neutral">{row.context}</Chip>
					{row.conflict && (
						<Chip tone="warn" title="目标回退链键已存在：勾选后把 X 的条目合并进去，不覆盖原有链">
							冲突
						</Chip>
					)}
					{row.deduped && (
						<Chip tone="info" title="替换后移除了重复条目和等于链名的条目">
							已去重
						</Chip>
					)}
					{override !== undefined && (
						<Chip tone="good" title="这一行没有用统一目标，而是单独指定了模型或思考等级">
							单独指定
						</Chip>
					)}
					{!open && (
						<button
							type="button"
							onClick={() => setEditing(true)}
							className={`${BTN_GHOST} ml-auto`}
							title={
								levels.length > 0
									? "只有这一行换成和统一目标不同的模型（可同时选思考等级），其他行不受影响"
									: "只有这一行换成和统一目标不同的模型，其他行不受影响"
							}
						>
							换成别的模型
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
						<span className="shrink-0 text-[10px] text-neutral-500">这一行换成</span>
						<TargetPicker
							value={row.model}
							entries={picker.entries}
							loading={picker.loading}
							error={picker.error}
							initialGroup={picker.group}
							lockGroup={picker.group}
							caption={`仅替换「${row.title}」`}
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
							ariaLabel={`「${row.title}」的思考等级`}
							containerClassName="w-40"
						/>
						<button
							type="button"
							onClick={() => {
								setEditing(false);
								onOverride(null);
							}}
							className={BTN_GHOST}
							title="这一行重新使用统一目标"
						>
							改回统一目标
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
	const picker: PickerData = { entries, loading: kindsLoading, error: kindsError, group: targetGroup };
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-[11px] text-neutral-400">
				<span>
					将修改 <span className="font-medium text-neutral-200">{plan.edits.length}</span> 项
				</span>
				<span className="rounded-full bg-[var(--well-bg)] px-2 py-0.5 text-[10px] text-neutral-300" title="替换范围，在第一步选择">
					范围：{scopeLabel}
				</span>
				<span className="flex items-center gap-1">
					<Info className="h-3 w-3 shrink-0" />
					{PROJECT_SCOPE_NOTICE}
				</span>
			</div>

			{plan.chainError !== null && (
				<div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">
						无法读取回退链，本次不会改动回退链：{plan.chainError}
					</span>
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
				{plan.rows.length === 0 ? (
					<p className="px-1 py-6 text-xs text-neutral-500">
						「{scopeLabel}」范围内没有引用到「<span className="break-all font-mono text-neutral-300">{fromModel}</span>」的配置，换个来源模型或范围试试。
					</p>
				) : (
					plan.groups.map((group) => (
						<div key={group.group} className="mb-3 rounded-xl hairline">
							<div className="flex items-center justify-between rounded-t-xl bg-[var(--well-bg)] px-3 py-1.5 text-[10px] text-neutral-500">
								<span>{group.title}</span>
								<span>{group.rows.length} 项</span>
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
							未能扫描的位置（{plan.skippedProjects.length}）— 这些位置不会被修改
						</div>
						{plan.skippedProjects.map((project) => (
							<div key={project.path} className="flex items-start gap-2 border-t border-[var(--border-divider)] px-3 py-1.5 text-[11px]">
								<span className="shrink-0 text-neutral-300">{project.name}</span>
								<span className="min-w-0 flex-1 break-all font-mono text-[10px] text-neutral-600">{project.path}</span>
								<span className="max-w-[40%] shrink-0 break-all text-amber-300">{project.reason}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
