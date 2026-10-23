/**
 * Settings ▸ 外观: 「请求统计」 (per-request stats line fields) and
 * 「对话显示」 (thinking preview). Both are local display preferences stored
 * in localStorage by `useDisplayPrefs` — no Rust settings round-trip.
 */
import clsx from "clsx";
import { Segmented } from "../../../components/Segmented";
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
	const requestStats = useDisplayPrefs((s) => s.requestStats);
	const requestStatFields = useDisplayPrefs((s) => s.requestStatFields);
	const setRequestStats = useDisplayPrefs((s) => s.setRequestStats);
	const setRequestStatField = useDisplayPrefs((s) => s.setRequestStatField);
	const defaultOn = REQUEST_STAT_FIELD_IDS.filter((f) => DEFAULT_REQUEST_STAT_FIELDS[f])
		.map((f) => REQUEST_STAT_FIELDS[f].label)
		.join("、");

	return (
		<SettingsCard
			title="请求统计"
			footer={`默认显示：${defaultOn}，其余默认不显示。旧会话没有记录到的数据会显示「—」。`}
		>
			<ToggleRow
				fieldId="requestStats"
				label="显示请求统计"
				description="每次模型请求下方显示一行统计，下面可选择包含哪些项"
				checked={requestStats}
				onChange={setRequestStats}
			/>
			<div
				className={clsx("grid grid-cols-1 gap-x-6 px-4 py-2 sm:grid-cols-2", !requestStats && "opacity-50")}
				title={requestStats ? undefined : "需先打开上面的「显示请求统计」"}
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
	const thinkingPreview = useDisplayPrefs((s) => s.thinkingPreview);
	const setThinkingPreview = useDisplayPrefs((s) => s.setThinkingPreview);
	const sideChatHandback = useDisplayPrefs((s) => s.sideChatHandback);
	const setSideChatHandback = useDisplayPrefs((s) => s.setSideChatHandback);
	const bottomBar = useDisplayPrefs((s) => s.bottomBar);
	const setBottomBar = useDisplayPrefs((s) => s.setBottomBar);

	return (
		<SettingsCard title="对话显示" footer="保存在本机，立即生效。">
			<ToggleRow
				fieldId="bottomBar"
				label="显示底栏"
				description="窗口底部的状态栏（会话统计、性能、omp 版本、缩放）；关闭后隐藏，缩放快捷键仍可用"
				checked={bottomBar}
				onChange={setBottomBar}
			/>
			<ToggleRow
				fieldId="thinkingPreview"
				label="思考时显示最新两行"
				description="模型思考时在「正在思考」下面滚动显示最新两行；思考结束后折叠成一行，点一下可展开全文"
				checked={thinkingPreview}
				onChange={setThinkingPreview}
			/>
			<SettingRow
				fieldId="sideChatHandback"
				label="回传给父会话的方式"
				description={
					sideChatHandback === "summary"
						? "整理成结论：让辅助对话把讨论定下来的结论写成一段，确认后放进主对话输入框"
						: "手动选择：在辅助对话里选中文字，点「发到主对话」放进主对话输入框"
				}
				hint="两种方式都不会自动发送给主对话；默认为整理成结论。"
				control={
					<Segmented<SideChatHandbackMode>
						aria-label="回传给父会话的方式"
						size="sm"
						value={sideChatHandback}
						onChange={setSideChatHandback}
						options={[
							{ value: "summary", label: "整理成结论" },
							{ value: "select", label: "手动选择" },
						]}
					/>
				}
			/>
		</SettingsCard>
	);
}
