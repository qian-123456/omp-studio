/** Settings ▸ 版本与更新 (`about`): app version, omp version, `omp update` and stale-session switching. */
import { ArrowUpCircle, CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { confirmDialog } from "../../../lib/dialogs";
import { timeAgo } from "../../../lib/format";
import { sessionDisplayName } from "../../../lib/sessionName";
import { toast } from "../../../lib/toast";
import { ompVersionLabel, useOmpUpdate } from "../../../stores/ompUpdate";
import { switchPendingNow, syncStaleness, useOmpUpdateSessions } from "../../../stores/ompUpdateSessions";
import { useSessions } from "../../../stores/sessions";
import { useAppSettings } from "../useAppSettings";
import { OmpSections } from "../OmpSettingsList";
import {
	Button,
	Chip,
	CommitInput,
	IconButton,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
	normalizeHours,
} from "../ui";

function nameOf(id: string): string {
	const meta = useSessions.getState().sessions[id];
	return meta ? sessionDisplayName(meta) : id;
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
		latestHint = <Chip tone="accent" icon={Loader2}>正在更新</Chip>;
		latestControl = (
			<Button variant="primary" loading disabled>
				正在更新
			</Button>
		);
	} else if (checking) {
		latestHint = <Chip tone="neutral" icon={Loader2}>正在检查</Chip>;
	} else if (error) {
		latestHint = <Chip tone="danger">{status?.updateAvailable ? "更新失败" : "检查更新失败"}</Chip>;
		latestControl = (
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant="ghost"
					icon={detailsOpen ? ChevronDown : ChevronRight}
					onClick={() => setDetailsOpen((v) => !v)}
				>
					查看详情
				</Button>
				<Button
					icon={RotateCw}
					disabled={!info?.found && status?.updateAvailable}
					title={!info?.found && status?.updateAvailable ? "未在 PATH 中找到 omp 命令行" : undefined}
					onClick={() => void (status?.updateAvailable ? handleUpdate() : check())}
				>
					重试
				</Button>
			</div>
		);
	} else if (status?.updateAvailable) {
		latestHint = <Chip tone="accent" icon={ArrowUpCircle}>有新版本 {status.latest}</Chip>;
		latestControl = (
			<Button variant="primary" icon={ArrowUpCircle} disabled={!info?.found} title={!info?.found ? "未在 PATH 中找到 omp 命令行" : undefined} onClick={() => void handleUpdate()}>
				更新到 {status.latest}
			</Button>
		);
	} else if (status) {
		latestHint = (
			<span className="inline-flex items-center gap-2">
				<Chip tone="success" icon={CheckCircle2}>已是最新版本</Chip>
				{lastCheckedAt ? <span className="text-[11px] text-[var(--text-dim)]">上次检查 {timeAgo(lastCheckedAt)}</span> : null}
			</span>
		);
		latestControl = (
			<Button icon={RefreshCw} onClick={() => void check()}>
				重新检查
			</Button>
		);
	} else {
		latestHint = <Chip tone="neutral">尚未检查</Chip>;
		latestControl = (
			<Button variant="primary" icon={RefreshCw} onClick={() => void check()}>
				检查更新
			</Button>
		);
	}

	return (
		<div className="space-y-6">
			<SectionHeader title="版本与更新" description="本应用和 omp 的版本，检查与安装更新" />

			<SettingsCard title="版本">
				<SettingRow
					label="本产品"
					description="OMP 工作台桌面应用"
					control={<span className="font-mono text-xs text-[var(--text-muted)]">omp-workspace v{appVersion ?? "未知"}</span>}
				/>
				<SettingRow
					label="omp 版本"
					description={info?.found ? <span className="font-mono">{info.resolvedPath}</span> : "未找到 omp，可在「高级」中设置 omp 程序位置"}
					control={<span className="font-mono text-xs text-[var(--text-muted)]">{ompVersion ?? "未知"}</span>}
				/>
				<SettingRow
					label="omp 更新"
					description={latestHint}
					control={latestControl}
				>
					{error && !checking && !updating && detailsOpen ? (
						<div className="relative mt-2">
							<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--well-bg)] p-2 pr-16 font-mono text-[11px] text-[var(--text-muted)]">
								{lastOutput ?? error}
							</pre>
							<IconButton
								size="sm"
								icon={Copy}
								label="复制详情"
								className="absolute right-2 top-2"
								onClick={() => void copyOutput()}
							/>
						</div>
					) : null}
				</SettingRow>
				{pendingIds.length > 0 ? (
					<SettingRow
						label="会话切换"
						description={`${pendingIds.length} 个会话仍在使用旧版本 omp，将在本轮结束后自动切换：${pendingIds.map(nameOf).join("、")}`}
						control={
							<Button icon={RotateCw} loading={switching} onClick={() => void handleSwitchNow()}>
								立即切换
							</Button>
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
							<span className="text-xs text-[var(--text-dim)]">小时</span>
						</div>
					}
				/>
			</SettingsCard>

			<OmpSections page="about" />
		</div>
	);
}
