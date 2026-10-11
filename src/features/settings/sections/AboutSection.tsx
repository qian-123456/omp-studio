/** Settings ▸ 版本与更新 (`about`): app version, omp version, `omp update` and stale-session switching. */
import { ArrowUpCircle, CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { confirmDialog } from "../../../lib/dialogs";
import { sessionDisplayName } from "../../../lib/sessionName";
import { toast } from "../../../lib/toast";
import { ompVersionLabel, useOmpUpdate } from "../../../stores/ompUpdate";
import { switchPendingNow, syncStaleness, useOmpUpdateSessions } from "../../../stores/ompUpdateSessions";
import { useSessions } from "../../../stores/sessions";
import { useAppSettings } from "../useAppSettings";
import {
	CommitInput,
	SETTINGS_BUTTON_CLASS,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
	normalizeHours,
} from "../ui";

const PRIMARY_BUTTON_CLASS =
	"inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 active:scale-95 transition-all disabled:opacity-50";

function nameOf(id: string): string {
	const meta = useSessions.getState().sessions[id];
	return meta ? sessionDisplayName(meta) : id;
}

function formatChecked(at: number): string {
	const mins = Math.floor((Date.now() - at) / 60_000);
	if (mins < 1) return "刚刚";
	if (mins < 60) return `${mins} 分钟前`;
	if (mins < 24 * 60) return `${Math.floor(mins / 60)} 小时前`;
	return new Date(at).toLocaleString();
}

export function AboutSection() {
	const { appVersion, info, status, checking, updating, lastCheckedAt, error, lastOutput, loadInfo, check, runUpdate } =
		useOmpUpdate();
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [switching, setSwitching] = useState(false);
	const { settings, save } = useAppSettings();
	const pendingIds = useOmpUpdateSessions((s) => s.pendingSessionIds);
	useSessions((s) => s.sessions);

	useEffect(() => {
		void loadInfo();
		void syncStaleness().catch(() => {});
	}, [loadInfo]);

	const ompVersion = ompVersionLabel(info, status);

	const handleUpdate = async () => {
		const target = status?.latest ? ` ${status.latest}` : "";
		const ok = await confirmDialog(
			`将运行 omp update 把 omp 升级到${target || "最新版本"}。完成后空闲的会话会立即切换到新版本，正在运行的会话在本轮结束后自动切换，对话记录会保留。`,
			{ okLabel: `更新到${target || "最新版本"}` },
		);
		if (ok) await runUpdate();
	};

	const handleSwitchNow = async () => {
		const ok = await confirmDialog(
			`以下会话正在运行，立即切换会中断当前回合：\n${pendingIds.map((id) => `• ${nameOf(id)}`).join("\n")}\n\n对话记录、草稿与排队消息会保留。确定立即切换？`,
			{ okLabel: "立即切换", danger: true },
		);
		if (!ok) return;
		setSwitching(true);
		try {
			await switchPendingNow();
		} finally {
			setSwitching(false);
		}
	};

	const copyOutput = async () => {
		try {
			await navigator.clipboard.writeText(lastOutput ?? error ?? "");
			toast.success("已复制");
		} catch {
			toast.error("复制失败");
		}
	};

	let latestHint: React.ReactNode;
	let latestControl: React.ReactNode = null;
	if (updating) {
		latestHint = (
			<span className="inline-flex items-center gap-1 text-neutral-400">
				<Loader2 className="h-3 w-3 animate-spin" /> 正在更新…
			</span>
		);
		latestControl = (
			<button type="button" disabled className={PRIMARY_BUTTON_CLASS}>
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
				<span>正在更新…</span>
			</button>
		);
	} else if (checking) {
		latestHint = (
			<span className="inline-flex items-center gap-1 text-neutral-400">
				<Loader2 className="h-3 w-3 animate-spin" /> 正在检查…
			</span>
		);
	} else if (error) {
		latestHint = <span className="text-amber-400">{status?.updateAvailable ? "更新失败" : "检查更新失败"}</span>;
		latestControl = (
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => setDetailsOpen((v) => !v)}
					className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
				>
					{detailsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
					<span>查看详情</span>
				</button>
				<button
					type="button"
					disabled={!info?.found && status?.updateAvailable}
					onClick={() => void (status?.updateAvailable ? handleUpdate() : check())}
					className={SETTINGS_BUTTON_CLASS}
				>
					<RotateCw className="h-3.5 w-3.5" />
					<span>重试</span>
				</button>
			</div>
		);
	} else if (status?.updateAvailable) {
		latestHint = (
			<span className="inline-flex items-center gap-1 text-indigo-300">
				<ArrowUpCircle className="h-3 w-3" /> 有新版本 {status.latest}
			</span>
		);
		latestControl = (
			<button
				type="button"
				disabled={!info?.found}
				onClick={() => void handleUpdate()}
				className={PRIMARY_BUTTON_CLASS}
			>
				<ArrowUpCircle className="h-3.5 w-3.5" />
				<span>更新到 {status.latest}</span>
			</button>
		);
	} else if (status) {
		latestHint = (
			<span className="inline-flex items-center gap-1 text-emerald-400">
				<CheckCircle2 className="h-3 w-3" /> 已是最新版本
				{lastCheckedAt ? <span className="text-neutral-500"> · 上次检查 {formatChecked(lastCheckedAt)}</span> : null}
			</span>
		);
		latestControl = (
			<button type="button" onClick={() => void check()} className="text-xs text-neutral-500 hover:text-neutral-300">
				重新检查
			</button>
		);
	} else {
		latestHint = <span className="text-neutral-500">尚未检查</span>;
		latestControl = (
			<button type="button" onClick={() => void check()} className={SETTINGS_BUTTON_CLASS}>
				<RefreshCw className="h-3.5 w-3.5" />
				<span>检查更新</span>
			</button>
		);
	}

	return (
		<div className="space-y-6">
			<SectionHeader title="版本与更新" description="查看本产品与 omp 的版本，检查并安装 omp 更新。" />

			<SettingsCard title="版本">
				<SettingRow
					label="本产品"
					description="OMP 工作台桌面应用"
					control={<span className="font-mono text-xs text-neutral-300">omp-workspace v{appVersion ?? "…"}</span>}
				/>
				<SettingRow
					label="omp 版本"
					description={info?.found ? <span className="font-mono">{info.resolvedPath}</span> : "未找到 omp，可在「高级」中设置 omp 程序位置"}
					control={<span className="font-mono text-xs text-neutral-300">{ompVersion ?? "未知"}</span>}
				/>
				<SettingRow label={status?.updateAvailable ? "更新" : "最新版本"} hint={latestHint} control={latestControl}>
					{error && !checking && !updating && detailsOpen ? (
						<div className="relative mt-2">
							<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-2 pr-16 font-mono text-[11px] text-neutral-300">
								{lastOutput ?? error}
							</pre>
							<button
								type="button"
								onClick={() => void copyOutput()}
								className="absolute right-2 top-2 inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200"
							>
								<Copy className="h-3 w-3" /> 复制
							</button>
						</div>
					) : null}
				</SettingRow>
				{pendingIds.length > 0 ? (
					<SettingRow
						label="会话切换"
						description={`${pendingIds.length} 个会话仍在使用旧版本 omp，将在本轮结束后自动切换：${pendingIds.map(nameOf).join("、")}`}
						control={
							<button
								type="button"
								disabled={switching}
								onClick={() => void handleSwitchNow()}
								className={SETTINGS_BUTTON_CLASS}
							>
								{switching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
								<span>立即切换</span>
							</button>
						}
					/>
				) : null}
				<ToggleRow
					fieldId="ompAutoUpdate"
					label="自动更新 omp"
					description="检查到新版本时会自动安装；正在运行的对话不会被打断，会在本轮结束后切换。"
					checked={settings?.ompAutoUpdate === true}
					onChange={(v) => save({ ompAutoUpdate: v })}
				/>
				<SettingRow
					fieldId="ompCheckIntervalHours"
					label="自动检查间隔"
					description="应用运行期间，每隔这么久检查一次 omp 新版本"
					hint="可填 1–720（30 天）"
					control={
						<div className="flex items-center gap-1.5">
							<CommitInput
								type="number"
								min={1}
								max={720}
								className="w-24"
								aria-label="omp 自动检查间隔（小时）"
								value={String(settings?.ompCheckIntervalHours ?? 24)}
								normalize={normalizeHours}
								onCommit={(v) => save({ ompCheckIntervalHours: Number(v) })}
							/>
							<span className="text-xs text-neutral-500">小时</span>
						</div>
					}
				/>
			</SettingsCard>
		</div>
	);
}
