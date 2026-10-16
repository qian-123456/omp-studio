/**
 * [D] Step 3 of 批量替换模型: the planned edits grouped by 全局 / 每个项目 /
 * 回退链 / 应用设置 / 定时任务. Every row carries a checkbox, its old → new value,
 * an optional per-row target override (model + level) and 冲突 / 已去重 badges.
 * Projects that could not be scanned are listed with their reason.
 */
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { useState } from "react";
import type { ModelOption } from "../../../lib/models";
import { HoverScrollText } from "../../../components/HoverScrollText";
import type { Plan, PlanRow, RowOverride } from "./logic";
import { BTN_GHOST, CHECKBOX_CLASS, Chip, LevelSelect, TargetPicker } from "./parts";

/** Shown wherever the scan's project coverage matters. */
export const PROJECT_SCOPE_NOTICE = "仅覆盖在本桌面端添加的项目";

const SMALL_PICKER_BUTTON =
	"flex h-6 max-w-[200px] items-center gap-1 rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 text-left text-[10px] text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50";

function PlanRowView({
	row,
	models,
	override,
	onOverride,
	onToggle,
}: {
	row: PlanRow;
	models: ModelOption[] | null;
	override: RowOverride | undefined;
	onOverride: (override: RowOverride | null) => void;
	onToggle: (checked: boolean) => void;
}) {
	const [editing, setEditing] = useState(false);
	const open = editing || override !== undefined;
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
					<span className="font-medium text-neutral-200">{row.title}</span>
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
						<Chip tone="good" title="这一行使用单独的目标模型/等级">
							已覆盖目标
						</Chip>
					)}
				</div>
				<div className="mt-1 flex items-center gap-1.5 font-mono text-[10px]">
					<HoverScrollText
						text={row.before}
						className="min-w-0 flex-1"
						innerClassName="text-neutral-500 line-through decoration-neutral-700"
						title={row.before}
					/>
					<ArrowRight size={10} className="shrink-0 text-neutral-600" />
					<HoverScrollText
						text={row.after}
						className="min-w-0 flex-1"
						innerClassName="text-neutral-200"
						title={row.after}
					/>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{open ? (
					<>
						<TargetPicker
							value={row.model}
							models={models}
							caption={`仅替换「${row.title}」`}
							buttonClass={SMALL_PICKER_BUTTON}
							onSelect={(model) => onOverride({ ...override, model })}
						/>
						<LevelSelect
							value={row.level}
							onChange={(level) => onOverride({ ...override, level })}
							ariaLabel={`「${row.title}」的思考等级`}
							containerClassName="w-24"
						/>
						<button type="button" onClick={() => onOverride(null)} className={BTN_GHOST}>
							恢复默认
						</button>
					</>
				) : (
					<button type="button" onClick={() => setEditing(true)} className={BTN_GHOST} title="单独指定这一行的目标模型与思考等级">
						覆盖目标
					</button>
				)}
			</div>
		</div>
	);
}

export function ModelReplacePlanPreview({
	plan,
	fromModel,
	models,
	overrides,
	onOverride,
	onToggle,
}: {
	plan: Plan;
	fromModel: string;
	models: ModelOption[] | null;
	overrides: Record<string, RowOverride>;
	onOverride: (rowId: string, override: RowOverride | null) => void;
	onToggle: (rowId: string, checked: boolean) => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-[11px] text-neutral-400">
				<span>
					将修改 <span className="font-medium text-neutral-200">{plan.edits.length}</span> 项
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
						没有引用到「<span className="font-mono text-neutral-300">{fromModel}</span>」的配置，换个来源模型试试。
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
									models={models}
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
							<div key={project.path} className="flex items-center gap-2 border-t border-[var(--border-divider)] px-3 py-1.5 text-[11px]">
								<span className="shrink-0 text-neutral-300" title={project.path}>
									{project.name}
								</span>
								<span className="min-w-0 flex-1 truncate font-mono text-[10px] text-neutral-600" title={project.path}>
									{project.path}
								</span>
								<span className="shrink-0 text-amber-300">{project.reason}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
