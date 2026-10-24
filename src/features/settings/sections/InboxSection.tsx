/** Settings ▸ 收件箱 (`inbox`): todo detection and auto-hide window. */
import { ModelSelect, type ModelExtraOption } from "../../../components/ModelSelect";
import { parseSelection } from "../../../components/modelSelectLogic";
import { Segmented } from "../../../components/Segmented";
import { toModelKey } from "../../../lib/models";
import { useT } from "../../../stores/language";
import { useAppSettings, useCatalogModels } from "../useAppSettings";
import {
	CommitInput,
	MODEL_PICKER_BUTTON_CLASS,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
	normalizeHours,
	useSaveStatus,
} from "../ui";

function getModelRoleExtras(t: (k: string) => string): ModelExtraOption[] {
	return [
		{ value: "smol", label: t("notifications.doctor.fastModel"), hint: t("notifications.doctor.fastModelHint") },
		{ value: "default", label: t("notifications.doctor.defaultModel"), hint: t("notifications.doctor.defaultModelHint") },
		{ value: "slow", label: t("notifications.doctor.slowModel"), hint: t("notifications.doctor.slowModelHint") },
	];
}

function getRoleLabels(t: (k: string) => string): Record<string, string> {
	return {
		smol: t("notifications.doctor.fastModel"),
		default: t("notifications.doctor.defaultModel"),
		slow: t("notifications.doctor.slowModel"),
	};
}

const THINKING_ZH: Record<string, string> = {
	off: "off",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
	auto: "auto",
};

export function InboxSection() {
	const { t } = useT();
	const { settings, save } = useAppSettings();
	return (
		<div className="space-y-6">
			<SectionHeader title={t("notifications.inbox.title")} description={t("notifications.inbox.desc")} />
			<SettingsCard title={t("notifications.inbox.rulesTitle")}>
				<ToggleRow
					fieldId="systemDetection"
					label={t("notifications.inbox.autoCollect")}
					description={t("notifications.inbox.autoCollectDesc")}
					checked={settings?.systemDetection ?? true}
					onChange={(v) => save({ systemDetection: v })}
				/>
				<SettingRow
					fieldId="inboxWindowHours"
					label={t("notifications.inbox.autoRemoveHours")}
					description={t("notifications.inbox.autoRemoveHoursDesc")}
					hint={t("notifications.inbox.hoursHint")}
					control={
						<div className="flex items-center gap-1.5">
							<CommitInput
								type="number"
								min={1}
								max={720}
								className="w-24"
								aria-label={t("notifications.inbox.hoursAria")}
								value={String(settings?.inboxWindowHours ?? 24)}
								normalize={normalizeHours}
								onCommit={(v) => save({ inboxWindowHours: Number(v) })}
							/>
							<span className="text-xs text-[var(--text-muted)]">{t("notifications.inbox.hoursUnit")}</span>
						</div>
					}
				/>
			</SettingsCard>
		</div>
	);
}

/** Settings ▸ 会话体检 (`doctor`): heatmap AI doctor model and auto mode. */
export function DoctorSection() {
	const { t } = useT();
	const { settings, save } = useAppSettings();
	const { models, catalogKeys } = useCatalogModels();
	const doctorSave = useSaveStatus();
	const doctorCurrent = settings?.doctorModel ?? "smol";
	const doctorSelector = parseSelection(doctorCurrent).selector;
	const roleLabels = getRoleLabels(t);
	const modelRoleExtras = getModelRoleExtras(t);
	const doctorIsRole = Object.prototype.hasOwnProperty.call(roleLabels, doctorSelector);
	const doctorBase = doctorIsRole
		? roleLabels[doctorSelector]
		: (models.find((m) => toModelKey(m.provider, m.id) === doctorSelector)?.id ?? (doctorSelector || t("notifications.doctor.selectModel")));
	const doctorLevel = parseSelection(doctorCurrent).level;
	const doctorLabel = doctorLevel ? `${doctorBase}${t("notifications.doctor.thinkingPrefix")}${THINKING_ZH[doctorLevel] ?? doctorLevel}` : doctorBase;
	const doctorMode = settings?.doctorAutoMode ?? "manual";
	return (
		<div className="space-y-6">
			<SectionHeader title={t("notifications.doctor.title")} description={t("notifications.doctor.desc")} />
			<SettingsCard
				title={t("notifications.doctor.settingsTitle")}
				footer={t("notifications.doctor.footer")}
			>
				<SettingRow
					fieldId="doctorModel"
					label={t("notifications.doctor.modelLabel")}
					description={t("notifications.doctor.modelDesc")}
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
							extras={modelRoleExtras}
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
					label={t("notifications.doctor.autoModeLabel")}
					description={t("notifications.doctor.autoModeDesc")}
					control={
						<Segmented
							value={doctorMode}
							onChange={(v) => void save({ doctorAutoMode: v })}
							options={[
								{ value: "manual", label: t("notifications.doctor.manual") },
								{ value: "idle", label: t("notifications.doctor.idle") },
								{ value: "scheduled", label: t("notifications.doctor.scheduled") },
							]}
						/>
					}
				/>
				{doctorMode === "idle" && (
					<SettingRow
						fieldId="doctorIdleMinutes"
						label={t("notifications.doctor.idleMinutesLabel")}
						description={t("notifications.doctor.idleMinutesDesc")}
						control={
							<Segmented
								value={String(settings?.doctorIdleMinutes ?? 30)}
								onChange={(v) => void save({ doctorIdleMinutes: Number(v) })}
								options={[
									{ value: "30", label: t("notifications.doctor.mins30") },
									{ value: "60", label: t("notifications.doctor.mins60") },
									{ value: "120", label: t("notifications.doctor.mins120") },
								]}
							/>
						}
					/>
				)}
				{doctorMode === "scheduled" && (
					<SettingRow
						fieldId="doctorScheduleTime"
						label={t("notifications.doctor.scheduleTimeLabel")}
						description={t("notifications.doctor.scheduleTimeDesc")}
						control={
							<CommitInput
								className="w-24"
								aria-label={t("notifications.doctor.scheduleTimeAria")}
								placeholder="23:00"
								value={settings?.doctorScheduleTime ?? "23:00"}
								validate={(v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : t("notifications.doctor.scheduleTimeError"))}
								onCommit={(v) => save({ doctorScheduleTime: v })}
							/>
						}
					/>
				)}
			</SettingsCard>
		</div>
	);
}

