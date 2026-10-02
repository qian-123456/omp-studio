/** Settings ▸ 会话 (`sessions`): idle suspend, summary refresh, turn checkpoints. */
import { CheckpointsSection } from "../CheckpointsSection";
import { useAppSettings } from "../useAppSettings";
import { CommitInput, SectionHeader, SettingRow, SettingsCard, ToggleRow } from "../ui";

export function SessionsSection() {
	const { settings, save } = useAppSettings();
	const minutes = settings?.idleSuspendMinutes ?? 0;

	return (
		<div className="space-y-6">
			<SectionHeader
				title="会话"
				description="对话在后台怎么运行、怎么保存。默认模型和审批模式在「通用」里设置。"
			/>
			<SettingsCard title="后台运行">
				<SettingRow
					fieldId="idleSuspendMinutes"
					label="闲置多久后休眠（分钟）"
					description="对话一段时间没动静就暂停它的后台进程以省内存；下次发消息时自动恢复，内容不会丢。"
					hint={minutes === 0 ? "当前：永不休眠（填 0）" : `当前：闲置 ${minutes} 分钟后休眠；填 0 表示永不休眠，最多 1440（一天）`}
					control={
						<CommitInput
							type="number"
							min={0}
							max={1440}
							className="w-24"
							aria-label="闲置多久后休眠（分钟）"
							value={String(minutes)}
							normalize={(raw) => String(Math.min(1440, Math.max(0, parseInt(raw, 10) || 0)))}
							onCommit={(v) => save({ idleSuspendMinutes: Number(v) })}
						/>
					}
				/>
				<ToggleRow
					fieldId="sessionTurnAutoRefresh"
					label="自动更新对话标题与摘要"
					description="每轮回答结束后，在后台重新总结一下对话，让左侧列表的标题保持贴切。"
					checked={settings?.sessionTurnAutoRefresh ?? true}
					onChange={(v) => save({ sessionTurnAutoRefresh: v })}
				/>
			</SettingsCard>

			<CheckpointsSection />
		</div>
	);
}
