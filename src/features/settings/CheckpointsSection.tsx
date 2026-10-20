/**
 * Settings ▸ 会话 ▸ 对话检查点: the desktop's per-turn git snapshots
 * (`settings.turnCheckpoints`; null = never asked → treated as off here).
 */
import { useAppSettings } from "./useAppSettings";
import { useSettingsNav } from "./settingsNav";
import { Button, SettingRow, SettingsCard, ToggleRow } from "./ui";

export function CheckpointsSection() {
	const { settings, save } = useAppSettings();
	const { navigate } = useSettingsNav();
	return (
		<SettingsCard
			title="对话检查点"
			description="桌面端在每轮对话前用 Git 保存的项目快照，用来「撤回这一轮」。"
			footer="只对在本应用里新开的对话生效；正在进行的对话不受影响。"
		>
			<ToggleRow
				fieldId="turnCheckpoints"
				label="每轮自动存档"
				description="每轮对话前保存项目现场，改坏了可以撤回这一轮；AI 验证通过后会把自己的改动提交成一个版本。"
				checked={settings?.turnCheckpoints === true}
				onChange={(v) => save({ turnCheckpoints: v })}
			/>
			<SettingRow
				label="omp 的检查点工具"
				description="这是另一回事：让 AI 自己在任务中途设置检查点的工具，在「工具」页开关。"
				control={<Button onClick={() => navigate("tools")}>前往「工具」</Button>}
			/>
		</SettingsCard>
	);
}
