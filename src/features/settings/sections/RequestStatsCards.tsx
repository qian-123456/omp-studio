/**
 * Settings ▸ 外观: 「请求统计」 (per-request stats line fields) and
 * 「对话显示」 (thinking preview). Both are local display preferences stored
 * in localStorage by `useDisplayPrefs` — no Rust settings round-trip.
 */
import { Segmented } from "../../../components/Segmented";
import { REQUEST_STAT_FIELDS } from "../../chat/requestStats";
import {
	REQUEST_STAT_FIELD_IDS,
	DEFAULT_REQUEST_STAT_FIELDS,
	useDisplayPrefs,
	type RequestStatField,
	type SideChatHandbackMode,
} from "../../../stores/displayPrefs";
import { REQUEST_STAT_FIELD_ROW_IDS } from "../fieldRegistry";
import { SettingRow, SettingsCard, ToggleRow } from "../ui";

/** 「↘ 输入」/「$ 费用」/「开始时间」 (time has no glyph). */
function fieldLabel(field: RequestStatField): string {
	const { glyph, label } = REQUEST_STAT_FIELDS[field];
	return glyph ? `${glyph} ${label}` : label;
}

function defaultHint(field: RequestStatField): string {
	return `默认：${DEFAULT_REQUEST_STAT_FIELDS[field] ? "显示" : "不显示"}`;
}

export function RequestStatsCard() {
	const requestStats = useDisplayPrefs((s) => s.requestStats);
	const requestStatFields = useDisplayPrefs((s) => s.requestStatFields);
	const setRequestStats = useDisplayPrefs((s) => s.setRequestStats);
	const setRequestStatField = useDisplayPrefs((s) => s.setRequestStatField);

	return (
		<SettingsCard
			title="请求统计"
			footer="这些设置保存在本机、立即生效。旧会话没有记录到的数据会显示「—」。"
		>
			<ToggleRow
				fieldId="requestStats"
				label="显示请求统计"
				description="每次模型请求下方显示开始时间、输入输出、缓存、首字延迟和速度"
				checked={requestStats}
				onChange={setRequestStats}
			/>
			{REQUEST_STAT_FIELD_IDS.map((field) => (
				<div key={field} className={requestStats ? undefined : "opacity-50"}>
					<ToggleRow
						fieldId={REQUEST_STAT_FIELD_ROW_IDS[field]}
						label={fieldLabel(field)}
						description={REQUEST_STAT_FIELDS[field].description}
						hint={
							requestStats
								? defaultHint(field)
								: "需先打开上面的「显示请求统计」"
						}
						disabled={!requestStats}
						checked={requestStatFields[field]}
						onChange={(next) => setRequestStatField(field, next)}
					/>
				</div>
			))}
		</SettingsCard>
	);
}

export function ConversationDisplayCard() {
	const thinkingPreview = useDisplayPrefs((s) => s.thinkingPreview);
	const setThinkingPreview = useDisplayPrefs((s) => s.setThinkingPreview);
	const sideChatHandback = useDisplayPrefs((s) => s.sideChatHandback);
	const setSideChatHandback = useDisplayPrefs((s) => s.setSideChatHandback);

	return (
		<SettingsCard title="对话显示" footer="这些设置保存在本机、立即生效。">
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
				hint="默认：整理成结论。两种方式都不会自动发送给主对话。"
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
