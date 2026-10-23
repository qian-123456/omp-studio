/** Settings ▸ 会话 (`sessions`): idle suspend, summary refresh, send behaviour, turn checkpoints, omp session behaviour. */
import { Segmented } from "../../../components/Segmented";
import { describeStrategy, readThreshold } from "../autoCompactionLogic";
import { CheckpointsSection } from "../CheckpointsSection";
import { useOmpConfigStore } from "../ompConfigStore";
import { OmpSections } from "../OmpSettingsList";
import { useSettingsNav } from "../settingsNav";
import { useAppSettings } from "../useAppSettings";
import { Button, CommitInput, SectionHeader, SettingRow, SettingsCard, ToggleRow } from "../ui";
import { useEffect } from "react";

export function SessionsSection() {
	const { settings, save } = useAppSettings();
	const { navigate } = useSettingsNav();
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
			<SectionHeader title="会话" description="会话挂起与摘要、消息排队、计划与目标模式等对话行为" />
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
					description="每轮回答结束后，在后台重新总结对话，让左侧列表的标题保持贴切。"
					checked={settings?.sessionTurnAutoRefresh ?? true}
					onChange={(v) => save({ sessionTurnAutoRefresh: v })}
				/>
				<ToggleRow
					fieldId="sessionGroupByWorktree"
					label="按工作树区分会话"
					description="仅对代码空间生效：项目下的会话按 Git 工作树分组显示，并可在指定工作树新建会话。关闭则平铺显示。"
					checked={settings?.sessionGroupByWorktree ?? true}
					onChange={(v) => save({ sessionGroupByWorktree: v })}
				/>
			</SettingsCard>

			<SettingsCard title="上下文压缩">
				<SettingRow
					fieldId="sessionCompaction"
					label="自动上下文压缩"
					description={compactionStrategy}
					control={
						<Button onClick={() => navigate("context-window")}>在「上下文窗口」页设置</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard
				title="发送方式"
				description="这里是桌面端对每条消息的处理；下方「消息排队与打断」是 omp 自身的排队模式，两者配合生效。"
			>
				<ToggleRow
					fieldId="queueAutoSend"
					label="排队消息自动发送"
					description="排队的消息在这一轮结束后自动逐条发送；关闭则等你手动确认。"
					checked={settings?.queueAutoSend !== false}
					onChange={(v) => save({ queueAutoSend: v })}
				/>
				<SettingRow
					fieldId="sendShortcut"
					label="发送快捷键"
					description="选择用哪个按键发送消息，另一个组合用于换行。"
					control={
						<Segmented
							value={settings?.sendShortcut ?? "enter"}
							onChange={(v) => void save({ sendShortcut: v })}
							options={[
								{ value: "enter", label: "Enter 发送", title: "Enter 发送，Shift + Enter 换行" },
								{ value: "mod-enter", label: "⌘ Enter 发送", title: "⌘ Enter 发送，Enter 换行" },
							]}
						/>
					}
				/>
				<SettingRow
					fieldId="followUpBehavior"
					label="任务进行中发送新消息"
					description="AI 还在回复时发出的消息怎么处理。按住 ⌥ 发送可对单条消息临时换一种方式。"
					control={
						<Segmented
							value={settings?.followUpBehavior ?? "steer"}
							onChange={(v) => void save({ followUpBehavior: v })}
							options={[
								{ value: "steer", label: "引导", title: "立即插入当前回合，AI 据此调整" },
								{ value: "queue", label: "排队", title: "等当前回合结束后依次发送" },
								{ value: "interrupt", label: "打断后发送", title: "先停止当前回合，再发送" },
							]}
						/>
					}
				/>
			</SettingsCard>

			<CheckpointsSection />

			<SettingsCard
				title="可视化"
				footer="只对在本应用里新开的对话生效；关闭后回答中的可视化代码按普通代码块显示。"
			>
				<ToggleRow
					fieldId="visualizeEnabled"
					label="启用可视化"
					description="让 AI 在回答里生成可交互的图表、示意图和模拟，渲染在沙箱中。"
					checked={settings?.visualizeEnabled ?? true}
					onChange={(v) => save({ visualizeEnabled: v })}
				/>
			</SettingsCard>

			<OmpSections page="sessions" />
		</div>
	);
}
