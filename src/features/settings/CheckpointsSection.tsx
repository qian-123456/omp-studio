/**
 * Settings ▸ 会话 ▸ 对话检查点: the desktop's per-turn git snapshots
 * (`settings.turnCheckpoints`; null = never asked → treated as off here).
 */
import { useT } from "../../stores/language";
import { useAppSettings } from "./useAppSettings";
import { useSettingsNav } from "./settingsNav";
import { Button, SettingRow, SettingsCard, ToggleRow } from "./ui";

export function CheckpointsSection() {
	const { t } = useT();
	const { settings, save } = useAppSettings();
	const { navigate } = useSettingsNav();
	return (
		<SettingsCard
			title={t("settingsCore.checkpoints.title")}
			description={t("settingsCore.checkpoints.description")}
			footer={t("settingsCore.checkpoints.footer")}
		>
			<ToggleRow
				fieldId="turnCheckpoints"
				label={t("settingsCore.checkpoints.autoSaveLabel")}
				description={t("settingsCore.checkpoints.autoSaveDesc")}
				checked={settings?.turnCheckpoints === true}
				onChange={(v) => save({ turnCheckpoints: v })}
			/>
			<SettingRow
				label={t("settingsCore.checkpoints.ompCheckpointsLabel")}
				description={t("settingsCore.checkpoints.ompCheckpointsDesc")}
				control={<Button onClick={() => navigate("tools")}>{t("settingsCore.checkpoints.goToTools")}</Button>}
			/>
		</SettingsCard>
	);
}
