/** Settings ▸ 通知 (`notifications`): when to notify, how, and quiet hours. */
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errMsg } from "../../../lib/dialogs";
import { notifyTest } from "../../../lib/ipc";
import { saveAppSettings, useAppSettings } from "../useAppSettings";
import { Notice } from "../../../components/Notice";
import {
	Button,
	INPUT_CLASS,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
	useSaveStatus,
} from "../ui";

type TestResult = { ok: true; at: string } | { ok: false; error: string } | null;

export function NotificationsSection() {
	const { settings, save } = useAppSettings();
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<TestResult>(null);

	const handleNotifyTest = async () => {
		setTesting(true);
		setTestResult(null);
		try {
			await notifyTest();
			setTestResult({ ok: true, at: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
		} catch (err) {
			setTestResult({ ok: false, error: errMsg(err) });
		} finally {
			setTesting(false);
		}
	};

	return (
		<div className="space-y-6">
			<SectionHeader title="通知" description="什么时候提醒你、怎么提醒，以及免打扰时段" />

			<SettingsCard title="什么时候提醒">
				<ToggleRow
					fieldId="notifyTurnEnd"
					label="完成一轮回复"
					description="Agent 做完一轮工作、等你查看结果时提醒"
					checked={settings?.notifyTurnEnd ?? true}
					onChange={(v) => save({ notifyTurnEnd: v })}
				/>
				<ToggleRow
					fieldId="notifyApproval"
					label="需要你批准或回答"
					description="Agent 要执行有风险的操作需要你同意，或向你提问时提醒"
					checked={settings?.notifyApproval ?? true}
					onChange={(v) => save({ notifyApproval: v })}
				/>
				<ToggleRow
					fieldId="notifyExit"
					label="出错或意外中断"
					description="会话因报错退出，或后台进程意外停止时提醒"
					checked={settings?.notifyExit ?? true}
					onChange={(v) => save({ notifyExit: v })}
				/>
			</SettingsCard>

			<SettingsCard title="怎么提醒">
				<ToggleRow
					fieldId="notifySound"
					label="提示音"
					description="弹出通知时同时播放系统默认提示音"
					checked={settings?.notifySound ?? true}
					onChange={(v) => save({ notifySound: v })}
				/>
				<ToggleRow
					fieldId="dockBadgeEnabled"
					label="Dock 角标"
					description="在程序坞图标右上角显示待处理事项的数量"
					checked={settings?.dockBadgeEnabled ?? true}
					onChange={(v) => save({ dockBadgeEnabled: v })}
				/>
				<SettingRow
					fieldId="notifyTest"
					label="发送测试通知"
					description="用来确认系统通知和提示音是否正常"
					control={
						<Button icon={Bell} loading={testing} onClick={handleNotifyTest}>
							{testing ? "正在发送" : "发送测试通知"}
						</Button>
					}
				>
					{testResult?.ok && (
						<Notice tone="success" title={`已在 ${testResult.at} 发出测试通知`}>
							如果屏幕右上角没有弹出通知：打开「系统设置 → 通知」，找到 omp-workspace，打开「允许通知」，提醒样式选「横幅」或「提醒」；
							同时确认没有开启系统的「专注模式 / 勿扰模式」。
						</Notice>
					)}
					{testResult && !testResult.ok && <Notice tone="danger" title={`发送失败：${testResult.error}`} />}
				</SettingRow>
			</SettingsCard>

			<SettingsCard title="免打扰">
				<QuietHoursRow />
			</SettingsCard>
		</div>
	);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validation message for a quiet-hours pair, or null when it can be saved. */
function quietHoursError(from: string, to: string): string | null {
	if (!from && !to) return null;
	if (!from || !to) return "开始和结束时间需要同时填写（或同时清空表示关闭免打扰）";
	if (!HHMM.test(from) || !HHMM.test(to)) return "时间格式应为 HH:MM，例如 22:00";
	if (from === to) return "开始和结束时间不能相同";
	return null;
}

/** Human summary of a saved quiet-hours window. */
function quietHoursSummary(from: string, to: string): string {
	if (!from || !to) return "未开启：任何时间都会提醒";
	return from < to ? `每天 ${from}–${to} 不提醒` : `每天 ${from}–次日 ${to} 不提醒（跨夜）`;
}

/** Patch to persist, or null when invalid or unchanged. */
function quietHoursPatch(f: string, t: string, savedFrom: string, savedTo: string) {
	if (quietHoursError(f, t)) return null;
	if (f === savedFrom && t === savedTo) return null;
	return { notifyQuietFrom: f || null, notifyQuietTo: t || null };
}

/** Quiet hours: both ends must be set together; commits on blur and on unmount. */
function QuietHoursRow() {
	const { settings, save } = useAppSettings();
	const status = useSaveStatus();
	const savedFrom = settings?.notifyQuietFrom ?? "";
	const savedTo = settings?.notifyQuietTo ?? "";
	const [from, setFrom] = useState(savedFrom);
	const [to, setTo] = useState(savedTo);
	const [touched, setTouched] = useState(false);

	useEffect(() => {
		setFrom(savedFrom);
		setTo(savedTo);
		setTouched(false);
	}, [savedFrom, savedTo]);

	const latest = useRef({ from, to, savedFrom, savedTo });
	latest.current = { from, to, savedFrom, savedTo };
	useEffect(
		() => () => {
			const l = latest.current;
			const patch = quietHoursPatch(l.from, l.to, l.savedFrom, l.savedTo);
			if (patch) void saveAppSettings(patch).catch(() => {});
		},
		[],
	);

	const commit = (f: string, t: string) => {
		setTouched(true);
		const patch = quietHoursPatch(f, t, savedFrom, savedTo);
		if (patch) void status.run(() => save(patch));
	};

	const error = touched ? quietHoursError(from, to) : null;
	const enabled = Boolean(savedFrom && savedTo);
	const timeClass = `${INPUT_CLASS} w-28 px-2.5 font-mono tabular-nums`;

	return (
		<SettingRow
			fieldId="notifyQuiet"
			stacked
			label="免打扰时段"
			description="这段时间内不弹系统通知（待办仍会照常记录）。结束时间早于开始时间表示跨夜，例如 22:00 到 08:00。"
			status={status.status}
			statusError={status.error}
			control={
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<input
							type="text"
							inputMode="numeric"
							maxLength={5}
							placeholder="22:00"
							aria-label="免打扰开始时间"
							value={from}
							onChange={(e) => setFrom(e.target.value)}
							onBlur={() => commit(from, to)}
							className={timeClass}
						/>
						<span className="text-xs text-[var(--text-dim)]">到</span>
						<input
							type="text"
							inputMode="numeric"
							maxLength={5}
							placeholder="22:00"
							aria-label="免打扰结束时间"
							value={to}
							onChange={(e) => setTo(e.target.value)}
							onBlur={() => commit(from, to)}
							className={timeClass}
						/>
						{!enabled && !from && !to && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setFrom("22:00");
									setTo("08:00");
									commit("22:00", "08:00");
								}}
							>
								填入 22:00–08:00
							</Button>
						)}
						{(enabled || from || to) && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setFrom("");
									setTo("");
									commit("", "");
								}}
							>
								关闭免打扰
							</Button>
						)}
					</div>
					{error ? (
						<div className="text-[11px] text-[var(--status-error)]">{error}</div>
					) : (
						<div className={`text-[11px] ${enabled ? "text-[var(--accent)]" : "text-[var(--text-dim)]"}`}>
							{quietHoursSummary(savedFrom, savedTo)}
						</div>
					)}
				</div>
			}
		/>
	);
}
