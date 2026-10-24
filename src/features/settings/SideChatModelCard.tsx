/**
 * Settings ▸ 模型角色, last card: optional dedicated model for side chats.
 * Off (`sideChatModel` null) = a side chat inherits the parent session's model and
 * thinking level; on = new side chats use the model picked here.
 */
import { useState } from "react";
import { useT } from "../../stores/language";
import { ModelSelect, type ModelExtraOption } from "../../components/ModelSelect";
import { parseSelection, roleIdOf } from "../../components/modelSelectLogic";
import { sideChatModelLabel } from "../sidechat/modelDefault";
import { useAppSettings, useCatalogModels } from "./useAppSettings";
import { MODEL_PICKER_BUTTON_CLASS, SettingRow, SettingsCard, ToggleRow, useSaveStatus } from "./ui";

export function SideChatModelCard() {
	const { t } = useT();
	const roleExtras: ModelExtraOption[] = [
		{ value: "smol", label: t("settingsModels.sideChatSmolLabel"), hint: t("settingsModels.sideChatSmolHint") },
		{ value: "default", label: t("settingsModels.sideChatDefaultLabel"), hint: t("settingsModels.sideChatDefaultHint") },
		{ value: "slow", label: t("settingsModels.sideChatSlowLabel"), hint: t("settingsModels.sideChatSlowHint") },
	];
	const { settings, save } = useAppSettings();
	const { models, catalogKeys } = useCatalogModels();
	const pickSave = useSaveStatus();
	// "On" before any model is chosen exists only in this component.
	const [armed, setArmed] = useState(false);

	const current = settings?.sideChatModel ?? "";
	const enabled = current !== "" || armed;
	const selector = parseSelection(current).selector;
	const pickerValue = catalogKeys.has(selector) || roleIdOf(selector) ? current : "";
	const label = current ? sideChatModelLabel(selector, models) : t("settingsModels.selectModelPrompt");

	return (
		<SettingsCard title={t("settingsModels.sideChatCardTitle")} fieldId="sideChatModel" jump={t("settingsModels.sideChatCardJump")}>
			<ToggleRow
				label={t("settingsModels.dedicatedModelLabel")}
				description={t("settingsModels.dedicatedModelDesc")}
				checked={enabled}
				onChange={async (next) => {
					if (next) {
						setArmed(true);
						return;
					}
					setArmed(false);
					if (current !== "") await save({ sideChatModel: null });
				}}
			/>
			{enabled && (
				<SettingRow
					label={t("settingsModels.modelRowLabel")}
					description={t("settingsModels.modelRowDesc")}
					status={pickSave.status}
					statusError={pickSave.error}
					control={
						<ModelSelect
							direction="up"
							widthClass="w-[360px]"
							label={label}
							buttonClass={MODEL_PICKER_BUTTON_CLASS}
							models={models}
							currentValue={pickerValue}
							extras={roleExtras}
							thinking
							allowCustom
							onSelect={(v) => {
								void pickSave.run(() => save({ sideChatModel: v.trim() || null }));
							}}
						/>
					}
				/>
			)}
		</SettingsCard>
	);
}
