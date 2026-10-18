/**
 * Settings ▸ 模型角色, last card: optional dedicated model for side chats.
 * Off (`sideChatModel` null) = a side chat inherits the parent session's model and
 * thinking level; on = new side chats use the model picked here.
 */
import { useState } from "react";
import { ModelSelect, type ModelExtraOption } from "../../components/ModelSelect";
import { parseSelection, roleIdOf } from "../../components/modelSelectLogic";
import { sideChatModelLabel } from "../sidechat/modelDefault";
import { useAppSettings, useCatalogModels } from "./useAppSettings";
import { MODEL_PICKER_BUTTON_CLASS, SettingRow, SettingsCard, ToggleRow, useSaveStatus } from "./ui";

const ROLE_EXTRAS: ModelExtraOption[] = [
	{ value: "smol", label: "快速模型 (smol)", hint: "内置默认" },
	{ value: "default", label: "主力模型 (default)", hint: "主力角色" },
	{ value: "slow", label: "深度模型 (slow)", hint: "深度角色" },
];

export function SideChatModelCard() {
	const { settings, save } = useAppSettings();
	const { models, catalogKeys } = useCatalogModels();
	const pickSave = useSaveStatus();
	// "On" before any model is chosen exists only in this component.
	const [armed, setArmed] = useState(false);

	const current = settings?.sideChatModel ?? "";
	const enabled = current !== "" || armed;
	const selector = parseSelection(current).selector;
	const pickerValue = catalogKeys.has(selector) || roleIdOf(selector) ? current : "";
	const label = current ? sideChatModelLabel(selector, models) : "选择模型";

	return (
		<SettingsCard title="侧边对话" fieldId="sideChatModel">
			<ToggleRow
				label="侧边对话专用模型"
				description="关闭时，侧边对话继承主对话的模型与 thinking level；开启后新建的侧边对话使用下方选择的模型。侧边对话面板里仍可临时更改。"
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
					label="模型"
					description="模型右侧可单独选择思考等级；所选模型不在列表中时自动回退为主对话模型。"
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
							extras={ROLE_EXTRAS}
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
