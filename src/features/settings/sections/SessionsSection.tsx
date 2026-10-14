/** Settings ▸ 会话 (`sessions`): idle suspend, summary refresh, turn checkpoints. */
import { useEffect } from "react";
import { describeStrategy, readThreshold } from "../autoCompactionLogic";
import { CheckpointsSection } from "../CheckpointsSection";
import { useOmpConfigStore } from "../ompConfigStore";
import { openSettingsTarget } from "../settingsTargets";
import { useAppSettings } from "../useAppSettings";
import { CommitInput, SETTINGS_BUTTON_CLASS, SectionHeader, SettingRow, SettingsCard, ToggleRow } from "../ui";

export function SessionsSection() {
	const { settings, save } = useAppSettings();
	const minutes = settings?.idleSuspendMinutes ?? 0;
	const ompEntries = useOmpConfigStore((s) => s.entries);
	const loadOmp = useOmpConfigStore((s) => s.load);
	useEffect(() => {
		void loadOmp();
	}, [loadOmp]);
	const ompValue = (key: string) => ompEntries.find((e) => e.key === key)?.value;
	const compactionStrategy = describeStrategy(
		readThreshold(ompValue("compaction.thresholdTokens"), ompValue("compaction.thresholdPercent")),
		ompValue("compaction.enabled") !== false,
	);

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
				<ToggleRow
					fieldId="sessionGroupByWorktree"
					label="按工作树区分会话"
					description="仅对代码空间生效：开启时项目下的会话按 Git 工作树 / 分支分组显示，并可在指定工作树新建会话。关闭则每个项目只显示一个平铺列表。工作 / 学习 / 研究 / 通用对话空间始终使用平铺列表。"
					checked={settings?.sessionGroupByWorktree ?? true}
					onChange={(v) => save({ sessionGroupByWorktree: v })}
				/>
			</SettingsCard>
			<SettingsCard title="上下文压缩">
				<SettingRow
					fieldId="sessionCompaction"
					label="自动上下文压缩"
					description="长对话接近模型上下文上限时，自动把较早内容总结成摘要，会话可以持续进行。"
					hint={compactionStrategy}
					control={
						<button type="button" className={SETTINGS_BUTTON_CLASS} onClick={() => openSettingsTarget("compaction")}>
							配置压缩阈值
						</button>
					}
				/>
			</SettingsCard>

			<CheckpointsSection />

			<SettingsCard
				title="可视化（Visualize）"
				footer="只对在本应用里新开的对话生效；关闭后回答中的可视化代码按普通代码块显示。"
			>
				<ToggleRow
					fieldId="visualizeEnabled"
					label="启用可视化（Visualize）"
					description="让 Agent 在回答里生成可交互的图表、示意图和模拟，渲染在沙箱中。"
					checked={settings?.visualizeEnabled ?? true}
					onChange={(v) => save({ visualizeEnabled: v })}
				/>
			</SettingsCard>
		</div>
	);
}
