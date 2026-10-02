/** Settings ▸ 收件箱 (`inbox`): todo detection and the read-only supervisor. */
import { useState } from "react";
import { ModelSelect, type ModelExtraOption } from "../../../components/ModelSelect";
import { toModelKey } from "../../../lib/models";
import { useAppSettings, useModelCatalog } from "../useAppSettings";
import {
	CommitInput,
	MODEL_PICKER_BUTTON_CLASS,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
	useSaveStatus,
} from "../ui";

const SUPERVISOR_EXTRAS: ModelExtraOption[] = [
	{ value: "smol", label: "快速模型 (smol)", hint: "内置默认" },
	{ value: "default", label: "主力模型 (default)", hint: "主力角色" },
	{ value: "slow", label: "深度模型 (slow)", hint: "深度角色" },
	{ value: "__custom", label: "自定义模型…", hint: "手动输入" },
];

const ROLE_LABELS: Record<string, string> = {
	smol: "快速模型 (smol)",
	default: "主力模型 (default)",
	slow: "深度模型 (slow)",
};

export function InboxSection() {
	const { settings, save } = useAppSettings();
	const { models, catalogKeys } = useModelCatalog();
	const modelSave = useSaveStatus();
	const [customOpen, setCustomOpen] = useState(false);

	const current = settings?.supervisorModel ?? "";
	const supervisorOn = settings?.supervisorEnabled ?? false;
	const isRole = Object.prototype.hasOwnProperty.call(ROLE_LABELS, current);
	const modelLabel = isRole
		? ROLE_LABELS[current]
		: (models.find((m) => toModelKey(m.provider, m.id) === current)?.name ?? (current || "选择模型"));
	const showCustom = customOpen || (current !== "" && !catalogKeys.has(current) && !isRole);

	return (
		<div className="space-y-6">
			<SectionHeader title="收件箱" description="把需要你处理的事情（审批、提问、报错等）集中成待办，并可让 AI 定期给出建议" />
			<SettingsCard title="待办">
				<ToggleRow
					fieldId="systemDetection"
					label="自动收集待办"
					description="会话里出现审批请求、提问、报错、中断或等你验收时，自动加入收件箱"
					checked={settings?.systemDetection ?? true}
					onChange={(v) => save({ systemDetection: v })}
				/>
				<ToggleRow
					fieldId="homeShowCompletedTodos"
					label="默认展开已处理待办"
					description="首页待办卡片默认也显示已经处理过的历史事项"
					checked={settings?.homeShowCompletedTodos ?? false}
					onChange={(v) => save({ homeShowCompletedTodos: v })}
				/>
				<SettingRow
					fieldId="inboxWindowHours"
					label="自动移出时间（小时）"
					description="超过这个时间没动静的会话不再出现在收件箱；待回复的不受影响"
					hint="可填 1–720（30 天）"
					control={
						<div className="flex items-center gap-1.5">
							<CommitInput
								type="number"
								min={1}
								max={720}
								className="w-24"
								aria-label="收件箱自动移出时间（小时）"
								value={String(settings?.inboxWindowHours ?? 24)}
								normalize={normalizeWindowHours}
								onCommit={(v) => save({ inboxWindowHours: Number(v) })}
							/>
							<span className="text-xs text-neutral-500">小时</span>
						</div>
					}
				/>
			</SettingsCard>
			<SettingsCard
				title="监工建议"
				footer="监工只读取会话摘要并给出建议，不会替你执行任何操作；每次分析都会调用一次所选模型，会产生少量费用。"
			>
				<ToggleRow
					fieldId="supervisorEnabled"
					label="后台监工建议 (Supervisor)"
					description="定期查看各会话进展和收件箱，给出下一步建议"
					checked={supervisorOn}
					onChange={(v) => save({ supervisorEnabled: v })}
				/>
				<div
					className={`divide-y divide-[var(--border-divider)] transition-opacity ${supervisorOn ? "" : "opacity-50"}`}
					inert={!supervisorOn}
					aria-disabled={!supervisorOn}
				>
					{!supervisorOn && (
						<div className="px-4 py-2 text-[11px] text-neutral-500">打开上面的「后台监工建议」后，以下设置才会生效</div>
					)}
					<SettingRow
						fieldId="supervisorModel"
						label="监工模型"
						description="用来生成建议的模型；建议选择速度快、价格低的模型"
						status={modelSave.status}
						statusError={modelSave.error}
						control={
							<ModelSelect
								direction="down"
								widthClass="w-[360px]"
								label={modelLabel}
								buttonClass={MODEL_PICKER_BUTTON_CLASS}
								models={models}
								currentValue={catalogKeys.has(current) || isRole ? current : ""}
								extras={SUPERVISOR_EXTRAS}
								onSelect={(v) => {
									if (v === "__custom") {
										setCustomOpen(true);
										return;
									}
									setCustomOpen(false);
									void modelSave.run(() => save({ supervisorModel: v }));
								}}
							/>
						}
					>
						{showCustom && (
							<CommitInput
								aria-label="自定义监工模型"
								placeholder="输入模型标识，例如 smol 或 openai/gpt-4o-mini"
								value={current}
								validate={(v) => (v ? null : "监工模型不能为空")}
								onCommit={(v) => save({ supervisorModel: v })}
							/>
						)}
					</SettingRow>
					<SettingRow
						fieldId="supervisorIntervalMinutes"
						label="分析间隔（分钟）"
						description="会话状态变化后，至少隔这么久才再分析一次"
						hint="可填 0 或 5–10080（7 天）；0 表示只在你手动刷新时分析，1–4 会自动调整为 5"
						control={
							<div className="flex items-center gap-1.5">
								<CommitInput
									type="number"
									min={0}
									max={10080}
									className="w-24"
									aria-label="监工分析间隔（分钟）"
									value={String(settings?.supervisorIntervalMinutes ?? 30)}
									normalize={normalizeInterval}
									onCommit={(v) => save({ supervisorIntervalMinutes: Number(v) })}
								/>
								<span className="text-xs text-neutral-500">分钟</span>
							</div>
						}
					/>
				</div>
			</SettingsCard>
		</div>
	);
}

/** 0 = manual only; otherwise clamp to [5, 10080]. */
function normalizeInterval(raw: string): string {
	const n = parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return "0";
	return String(Math.min(10080, Math.max(5, n)));
}

/** Clamp to [1, 720]; garbage falls back to the 24h default. */
function normalizeWindowHours(raw: string): string {
	const n = parseInt(raw, 10);
	if (!Number.isFinite(n)) return "24";
	return String(Math.min(720, Math.max(1, n)));
}
