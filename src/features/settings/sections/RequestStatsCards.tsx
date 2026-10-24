/**
 * Settings ▸ 外观: 「请求统计」 (per-request stats line fields) and
 * 「对话显示」 (thinking preview). Both are local display preferences stored
 * in localStorage by `useDisplayPrefs` — no Rust settings round-trip.
 */
import clsx from "clsx";
import { Segmented } from "../../../components/Segmented";
import { useT } from "../../../stores/language";
import { REQUEST_STAT_FIELDS } from "../../chat/requestStats";
import {
	REQUEST_STAT_FIELD_IDS,
	DEFAULT_REQUEST_STAT_FIELDS,
	useDisplayPrefs,
		type SideChatHandbackMode,
} from "../../../stores/displayPrefs";
import { REQUEST_STAT_FIELD_ROW_IDS } from "../fieldRegistry";
import { Switch } from "../Switch";
import { SettingRow, SettingsCard, ToggleRow } from "../ui";

export function RequestStatsCard() {
	const { t, locale } = useT();
	const requestStats = useDisplayPrefs((s) => s.requestStats);
	const requestStatFields = useDisplayPrefs((s) => s.requestStatFields);
	const setRequestStats = useDisplayPrefs((s) => s.setRequestStats);
	const setRequestStatField = useDisplayPrefs((s) => s.setRequestStatField);
	const defaultOn = REQUEST_STAT_FIELD_IDS.filter((f) => DEFAULT_REQUEST_STAT_FIELDS[f])
		.map((f) => REQUEST_STAT_FIELDS[f].label)
		.join(locale === "zh-CN" ? "、" : ", ");

	return (
		<SettingsCard
			title={t("settingsSections.requestStats.title")}
			footer={t("settingsSections.requestStats.footer", { defaultOn })}
		>
			<ToggleRow
				fieldId="requestStats"
				label={t("settingsSections.requestStats.toggleLabel")}
				description={t("settingsSections.requestStats.toggleDesc")}
				checked={requestStats}
				onChange={setRequestStats}
			/>
			<div
				className={clsx("grid grid-cols-1 gap-x-6 px-4 py-2 sm:grid-cols-2", !requestStats && "opacity-50")}
				title={requestStats ? undefined : t("settingsSections.requestStats.needsToggleHint")}
			>
				{REQUEST_STAT_FIELD_IDS.map((field) => (
					<div
						key={field}
						data-field-id={REQUEST_STAT_FIELD_ROW_IDS[field]}
						className="flex items-center justify-between gap-3 py-1.5"
						title={REQUEST_STAT_FIELDS[field].description}
					>
						<span className="text-[13px] text-[var(--text)]">{REQUEST_STAT_FIELDS[field].label}</span>
						<Switch
							checked={requestStatFields[field]}
							disabled={!requestStats}
							onChange={(next) => setRequestStatField(field, next)}
						/>
					</div>
				))}
			</div>
		</SettingsCard>
	);
}

export function ConversationDisplayCard() {
	const { t } = useT();
	const thinkingPreview = useDisplayPrefs((s) => s.thinkingPreview);
	const setThinkingPreview = useDisplayPrefs((s) => s.setThinkingPreview);
	const sideChatHandback = useDisplayPrefs((s) => s.sideChatHandback);
	const setSideChatHandback = useDisplayPrefs((s) => s.setSideChatHandback);
	const bottomBar = useDisplayPrefs((s) => s.bottomBar);
	const setBottomBar = useDisplayPrefs((s) => s.setBottomBar);

	return (
		<SettingsCard title={t("settingsSections.conversationDisplay.title")} footer={t("settingsSections.conversationDisplay.footer")}>
			<ToggleRow
				fieldId="bottomBar"
				label={t("settingsSections.conversationDisplay.bottomBarLabel")}
				description={t("settingsSections.conversationDisplay.bottomBarDesc")}
				checked={bottomBar}
				onChange={setBottomBar}
			/>
			<ToggleRow
				fieldId="thinkingPreview"
				label={t("settingsSections.conversationDisplay.thinkingPreviewLabel")}
				description={t("settingsSections.conversationDisplay.thinkingPreviewDesc")}
				checked={thinkingPreview}
				onChange={setThinkingPreview}
			/>
			<SettingRow
				fieldId="sideChatHandback"
				label={t("settingsSections.conversationDisplay.sideChatHandbackLabel")}
				description={
					sideChatHandback === "summary"
						? t("settingsSections.conversationDisplay.sideChatHandbackSummary")
						: t("settingsSections.conversationDisplay.sideChatHandbackSelect")
				}
				hint={t("settingsSections.conversationDisplay.sideChatHandbackHint")}
				control={
					<Segmented<SideChatHandbackMode>
						aria-label={t("settingsSections.conversationDisplay.sideChatHandbackAria")}
						size="sm"
						value={sideChatHandback}
						onChange={setSideChatHandback}
						options={[
							{ value: "summary", label: t("settingsSections.conversationDisplay.sideChatHandbackOptionSummary") },
							{ value: "select", label: t("settingsSections.conversationDisplay.sideChatHandbackOptionSelect") },
						]}
					/>
				}
			/>
		</SettingsCard>
	);
}
