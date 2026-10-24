/** Settings ▸ 会话 (`sessions`): idle suspend, summary refresh, send behaviour, turn checkpoints, omp session behaviour. */
import { Segmented } from "../../../components/Segmented";
import { describeStrategy, readThreshold } from "../autoCompactionLogic";
import { CheckpointsSection } from "../CheckpointsSection";
import { useOmpConfigStore } from "../ompConfigStore";
import { OmpSections } from "../OmpSettingsList";
import { useSettingsNav } from "../settingsNav";
import { useAppSettings } from "../useAppSettings";
import { Button, CommitInput, SectionHeader, SettingRow, SettingsCard, ToggleRow } from "../ui";
import { SectionJumpBar } from "../SectionJumpBar";
import { useEffect } from "react";
import { useT } from "../../../stores/language";

export function SessionsSection() {
	const { t } = useT();
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
			<SectionHeader title={t("settingsSections.sessions.title")} description={t("settingsSections.sessions.description")} />
			<SectionJumpBar />
			<SettingsCard jump={t("settingsSections.sessions.jumpBackground")} title={t("settingsSections.sessions.titleBackground")}>
				<SettingRow
					fieldId="idleSuspendMinutes"
					label={t("settingsSections.sessions.idleSuspendLabel")}
					description={t("settingsSections.sessions.idleSuspendDesc")}
					hint={minutes === 0 ? t("settingsSections.sessions.idleSuspendNever") : t("settingsSections.sessions.idleSuspendMinutes", { minutes })}
					control={
						<CommitInput
							type="number"
							min={0}
							max={1440}
							className="w-24"
							aria-label={t("settingsSections.sessions.idleSuspendLabel")}
							value={String(minutes)}
							normalize={(raw) => String(Math.min(1440, Math.max(0, parseInt(raw, 10) || 0)))}
							onCommit={(v) => save({ idleSuspendMinutes: Number(v) })}
						/>
					}
				/>
				<ToggleRow
					fieldId="sessionTurnAutoRefresh"
					label={t("settingsSections.sessions.turnAutoRefreshLabel")}
					description={t("settingsSections.sessions.turnAutoRefreshDesc")}
					checked={settings?.sessionTurnAutoRefresh ?? true}
					onChange={(v) => save({ sessionTurnAutoRefresh: v })}
				/>
				<ToggleRow
					fieldId="sessionGroupByWorktree"
					label={t("settingsSections.sessions.groupByWorktreeLabel")}
					description={t("settingsSections.sessions.groupByWorktreeDesc")}
					checked={settings?.sessionGroupByWorktree ?? true}
					onChange={(v) => save({ sessionGroupByWorktree: v })}
				/>
			</SettingsCard>

			<SettingsCard jump={t("settingsSections.sessions.jumpCompaction")} title={t("settingsSections.sessions.titleCompaction")}>
				<SettingRow
					fieldId="sessionCompaction"
					label={t("settingsSections.sessions.compactionLabel")}
					description={compactionStrategy}
					control={
						<Button onClick={() => navigate("context-window")}>{t("settingsSections.sessions.compactionSetupBtn")}</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard jump={t("settingsSections.sessions.jumpSend")}
				title={t("settingsSections.sessions.titleSend")}
				description={t("settingsSections.sessions.sendDesc")}
			>
				<ToggleRow
					fieldId="queueAutoSend"
					label={t("settingsSections.sessions.queueAutoSendLabel")}
					description={t("settingsSections.sessions.queueAutoSendDesc")}
					checked={settings?.queueAutoSend !== false}
					onChange={(v) => save({ queueAutoSend: v })}
				/>
				<SettingRow
					fieldId="followUpBehavior"
					label={t("settingsSections.sessions.followUpBehaviorLabel")}
					description={t("settingsSections.sessions.followUpBehaviorDesc")}
					control={
						<Segmented
							value={settings?.followUpBehavior ?? "steer"}
							onChange={(v) => void save({ followUpBehavior: v })}
							options={[
								{ value: "steer", label: t("settingsSections.sessions.followUpSteerLabel"), title: t("settingsSections.sessions.followUpSteerTitle") },
								{ value: "queue", label: t("settingsSections.sessions.followUpQueueLabel"), title: t("settingsSections.sessions.followUpQueueTitle") },
								{ value: "interrupt", label: t("settingsSections.sessions.followUpInterruptLabel"), title: t("settingsSections.sessions.followUpInterruptTitle") },
							]}
						/>
					}
				/>
			</SettingsCard>

			<CheckpointsSection />

			<SettingsCard jump={t("settingsSections.sessions.jumpVisualize")}
				title={t("settingsSections.sessions.titleVisualize")}
				footer={t("settingsSections.sessions.footerVisualize")}
			>
				<ToggleRow
					fieldId="visualizeEnabled"
					label={t("settingsSections.sessions.visualizeLabel")}
					description={t("settingsSections.sessions.visualizeDesc")}
					checked={settings?.visualizeEnabled ?? true}
					onChange={(v) => save({ visualizeEnabled: v })}
				/>
			</SettingsCard>

			<OmpSections page="sessions" />
		</div>
	);
}
