/** Settings ▸ 收件箱 (`inbox`): todo detection and the read-only supervisor. */
import { ModelSelect, type ModelExtraOption } from "../../../components/ModelSelect";
import { parseSelection } from "../../../components/modelSelectLogic";
import { Segmented } from "../../../components/Segmented";
import { toModelKey } from "../../../lib/models";
import { useAppSettings, useCatalogModels } from "../useAppSettings";
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
];

const ROLE_LABELS: Record<string, string> = {
	smol: "快速模型 (smol)",
	default: "主力模型 (default)",
	slow: "深度模型 (slow)",
};

export function InboxSection() {
	const { settings, save } = useAppSettings();
	const { models, catalogKeys } = useCatalogModels();
	const modelSave = useSaveStatus();

	const current = settings?.supervisorModel ?? "";
	const supervisorOn = settings?.supervisorEnabled ?? false;
	const currentSelector = parseSelection(current).selector;
	const isRole = Object.prototype.hasOwnProperty.call(ROLE_LABELS, currentSelector);
	const modelLabel = isRole
		? ROLE_LABELS[currentSelector]
		: (models.find((m) => toModelKey(m.provider, m.id) === currentSelector)?.name ?? (current || "选择模型"));

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
								currentValue={catalogKeys.has(currentSelector) || isRole ? current : ""}
								extras={SUPERVISOR_EXTRAS}
								thinking
								allowCustom
								onSelect={(v) => {
									if (!v.trim()) return;
									void modelSave.run(() => save({ supervisorModel: v.trim() }));
								}}
							/>
						}
					/>
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

/** Settings ▸ AI 会诊 (`doctor`): heatmap AI doctor model and auto mode. */
export function DoctorSection() {
	const { settings, save } = useAppSettings();
	const { models, catalogKeys } = useCatalogModels();
	const doctorSave = useSaveStatus();
	const doctorCurrent = settings?.doctorModel ?? "smol";
	const doctorSelector = parseSelection(doctorCurrent).selector;
	const doctorIsRole = Object.prototype.hasOwnProperty.call(ROLE_LABELS, doctorSelector);
	const doctorLabel = doctorIsRole
		? ROLE_LABELS[doctorSelector]
		: (models.find((m) => toModelKey(m.provider, m.id) === doctorSelector)?.name ?? (doctorCurrent || "选择模型"));
	const doctorMode = settings?.doctorAutoMode ?? "manual";
	return (
		<div className="space-y-6">
			<SectionHeader title="AI 会诊" description="在 Token 用量面板里诊断会话：找出绕路、返工和上下文浪费，并给出可编辑的提示词草稿" />
			<SettingsCard
				title="AI 会诊"
				footer="自动会诊（闲置后 / 每日定时）会消耗所选模型的 Token；默认手动按需，不点不花钱。会诊只给出诊断和提示词草稿，不会修改任何文件。"
			>
				<SettingRow
					fieldId="doctorModel"
					label="诊断模型"
					description="Token 用量面板「AI会诊」使用的模型；建议选择速度快、价格低的模型"
					status={doctorSave.status}
					statusError={doctorSave.error}
					control={
						<ModelSelect
							direction="down"
							widthClass="w-[360px]"
							label={doctorLabel}
							buttonClass={MODEL_PICKER_BUTTON_CLASS}
							models={models}
							currentValue={catalogKeys.has(doctorSelector) || doctorIsRole ? doctorCurrent : ""}
							extras={SUPERVISOR_EXTRAS}
							thinking
							allowCustom
							onSelect={(v) => {
								if (!v.trim()) return;
								void doctorSave.run(() => save({ doctorModel: v.trim() }));
							}}
						/>
					}
				/>
				<SettingRow
					fieldId="doctorAutoMode"
					label="自动会诊"
					description="手动按需：只在你点击时诊断；闲置后：会话闲置一段时间后自动诊断；每日定时：每天固定时间诊断"
					control={
						<Segmented
							value={doctorMode}
							onChange={(v) => void save({ doctorAutoMode: v })}
							options={[
								{ value: "manual", label: "手动按需" },
								{ value: "idle", label: "会话闲置后" },
								{ value: "scheduled", label: "每日定时" },
							]}
						/>
					}
				/>
				{doctorMode === "idle" && (
					<SettingRow
						fieldId="doctorIdleMinutes"
						label="闲置时长（分钟）"
						description="会话停止活动超过这么久后自动会诊一次"
						control={
							<Segmented
								value={String(settings?.doctorIdleMinutes ?? 30)}
								onChange={(v) => void save({ doctorIdleMinutes: Number(v) })}
								options={[
									{ value: "30", label: "30 分钟" },
									{ value: "60", label: "60 分钟" },
									{ value: "120", label: "120 分钟" },
								]}
							/>
						}
					/>
				)}
				{doctorMode === "scheduled" && (
					<SettingRow
						fieldId="doctorScheduleTime"
						label="定时时间"
						description="每天到这个时间自动会诊（24 小时制 HH:MM）"
						control={
							<CommitInput
								className="w-24"
								aria-label="每日会诊时间"
								placeholder="23:00"
								value={settings?.doctorScheduleTime ?? "23:00"}
								validate={(v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : "请输入 HH:MM，例如 23:00")}
								onCommit={(v) => save({ doctorScheduleTime: v })}
							/>
						}
					/>
				)}
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
