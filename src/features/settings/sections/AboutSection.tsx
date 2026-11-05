/** Settings ▸ 版本与更新 (`about`): app version, omp version, `omp update` and stale-session switching. */
import { ArrowUpCircle, CheckCircle2, ChevronDown, ChevronRight, Copy, Download, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../../stores/language";
import { confirmDialog } from "../../../lib/dialogs";
import { timeAgo } from "../../../lib/format";
import { sessionDisplayName } from "../../../lib/sessionName";
import { toast } from "../../../lib/toast";
import { ompVersionLabel, useOmpUpdate } from "../../../stores/ompUpdate";
import { useAppUpdate } from "../../../stores/appUpdate";
import { useOmpInstall } from "../../../stores/ompInstall";
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
	Switch,
	normalizeHours,
	useSaveStatus,
} from "../ui";

function nameOf(id: string): string {
	const meta = useSessions.getState().sessions[id];
	return meta ? sessionDisplayName(meta) : id;
}

import { SectionJumpBar } from "../SectionJumpBar";

export function AboutSection() {
	const { t, locale } = useT();
	const { appVersion, info, status, checking, updating, lastCheckedAt, error, lastOutput, loadInfo, check, runUpdate } =
		useOmpUpdate();
	const {
		appVersion: desktopAppVersion,
		updateInfo: appUpdateInfo,
		checking: appChecking,
		downloading: appDownloading,
		downloadProgress: appProgress,
		readyToRestart,
		lastCheckedAt: appLastCheckedAt,
		error: appError,
		autoCheck: appAutoCheck,
		checkIntervalHours: appIntervalHours,
		setAutoCheck: setAppAutoCheck,
		setCheckIntervalHours: setAppIntervalHours,
		loadVersion: loadAppVersion,
		check: checkAppUpdate,
		downloadAndInstall: downloadAppUpdate,
		relaunchApp,
		markUpdateSeen,
	} = useAppUpdate();
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [switching, setSwitching] = useState(false);
	const { settings, save } = useAppSettings();
	const pendingIds = useOmpUpdateSessions((s) => s.pendingSessionIds);
	const ompSave = useSaveStatus();
	const appSave = useSaveStatus();
	useSessions((s) => s.sessions);

	useEffect(() => {
		void loadInfo();
		void loadAppVersion();
		void syncStaleness().catch(() => {});
		markUpdateSeen();
	}, [loadInfo, markUpdateSeen]);

	const ompVersion = ompVersionLabel(info, status);

	const handleUpdate = async () => {
		const target = status?.latest ? t("settingsSections.about.updateTargetVersion", { version: status.latest }) : t("settingsSections.about.updateTargetLatest");
		const ok = await confirmDialog(
			t("settingsSections.about.updateConfirm", { target }),
			{ okLabel: t("settingsSections.about.updateButton", { target }) },
		);
		if (ok) await runUpdate();
	};

	const handleSwitchNow = async () => {
		const ok = await confirmDialog(
			t("settingsSections.about.switchPendingConfirm", { list: pendingIds.map((id) => `• ${nameOf(id)}`).join("\n") }),
			{ okLabel: t("settingsSections.about.switchPendingOk"), danger: true },
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
			toast.success(t("settingsSections.about.copied"));
		} catch {
			toast.error(t("settingsSections.about.copyFailed"));
		}
	};

	let latestHint: React.ReactNode;
	let latestControl: React.ReactNode = null;
	if (updating) {
		latestHint = <Chip tone="accent" icon={Loader2}>{t("settingsSections.about.updating")}</Chip>;
		latestControl = (
			<Button variant="primary" loading disabled>
				{t("settingsSections.about.updating")}
			</Button>
		);
	} else if (checking) {
		latestHint = <Chip tone="neutral" icon={Loader2}>{t("settingsSections.about.checking")}</Chip>;
	} else if (error) {
		latestHint = <Chip tone="danger">{status?.updateAvailable ? t("settingsSections.about.updateFailed") : t("settingsSections.about.checkFailed")}</Chip>;
		latestControl = (
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant="ghost"
					icon={detailsOpen ? ChevronDown : ChevronRight}
					onClick={() => setDetailsOpen((v) => !v)}
				>
					{t("settingsSections.about.viewDetails")}
				</Button>
				<Button
					icon={RotateCw}
					disabled={!info?.found && status?.updateAvailable}
					title={!info?.found && status?.updateAvailable ? t("settingsSections.about.ompNotFound") : undefined}
					onClick={() => void (status?.updateAvailable ? handleUpdate() : check())}
				>
					{t("settingsSections.about.retry")}
				</Button>
			</div>
		);
	} else if (status?.updateAvailable) {
		latestHint = <Chip tone="accent" icon={ArrowUpCircle}>{t("settingsSections.about.newVersionAvailable", { version: status.latest ?? "" })}</Chip>;
		latestControl = (
			<Button variant="primary" icon={ArrowUpCircle} disabled={!info?.found} title={!info?.found ? t("settingsSections.about.ompNotFound") : undefined} onClick={() => void handleUpdate()}>
				{t("settingsSections.about.updateToVersion", { version: status.latest ?? "" })}
			</Button>
		);
	} else if (status) {
		latestHint = (
			<span className="inline-flex items-center gap-2">
				<Chip tone="success" icon={CheckCircle2}>{t("settingsSections.about.alreadyLatest")}</Chip>
				{lastCheckedAt ? <span className="text-[11px] text-[var(--text-dim)]">{t("settingsSections.about.lastCheckedTime", { time: timeAgo(lastCheckedAt) })}</span> : null}
			</span>
		);
		latestControl = (
			<Button icon={RefreshCw} onClick={() => void check()}>
				{t("settingsSections.about.recheck")}
			</Button>
		);
	} else {
		latestHint = <Chip tone="neutral">{t("settingsSections.about.notChecked")}</Chip>;
		latestControl = (
			<Button variant="primary" icon={RefreshCw} onClick={() => void check()}>
				{t("settingsSections.about.checkUpdate")}
			</Button>
		);
	}
	let appUpdateHint: React.ReactNode;
	let appUpdateControl: React.ReactNode = null;
	if (readyToRestart) {
		appUpdateHint = <Chip tone="success" icon={CheckCircle2}>{t("settingsSections.about.appReadyToRestart")}</Chip>;
		appUpdateControl = (
			<Button variant="primary" icon={RotateCw} onClick={() => void relaunchApp()}>
				{t("settingsSections.about.appRestartNow")}
			</Button>
		);
	} else if (appDownloading) {
		const pct = appProgress?.percent ?? 0;
		appUpdateHint = <Chip tone="accent" icon={Loader2}>{t("settingsSections.about.appDownloading", { percent: String(pct) })}</Chip>;
		appUpdateControl = (
			<Button variant="primary" loading disabled>
				{t("settingsSections.about.appDownloading", { percent: String(pct) })}
			</Button>
		);
	} else if (appChecking) {
		appUpdateHint = <Chip tone="neutral" icon={Loader2}>{t("settingsSections.about.appChecking")}</Chip>;
		appUpdateControl = (
			<Button variant="ghost" loading disabled>
				{t("settingsSections.about.appChecking")}
			</Button>
		);
	} else if (appUpdateInfo) {
		appUpdateHint = <Chip tone="accent" icon={ArrowUpCircle}>{t("settingsSections.about.appUpdateAvailable", { version: appUpdateInfo.version })}</Chip>;
		appUpdateControl = (
			<Button variant="primary" icon={ArrowUpCircle} onClick={() => void downloadAppUpdate()}>
				{t("settingsSections.about.appDownloadAndInstall")}
			</Button>
		);
	} else if (appError) {
		appUpdateHint = <Chip tone="danger">{t("settingsSections.about.appCheckFailed")}</Chip>;
		appUpdateControl = (
			<Button icon={RotateCw} onClick={() => void checkAppUpdate()}>
				{t("settingsSections.about.retry")}
			</Button>
		);
	} else if (appLastCheckedAt) {
		appUpdateHint = (
			<span className="inline-flex items-center gap-2">
				<Chip tone="success" icon={CheckCircle2}>{t("settingsSections.about.appAlreadyLatest")}</Chip>
				<span className="text-[11px] text-[var(--text-dim)]">{t("settingsSections.about.lastCheckedTime", { time: timeAgo(appLastCheckedAt) })}</span>
			</span>
		);
		appUpdateControl = (
			<Button icon={RefreshCw} onClick={() => void checkAppUpdate()}>
				{t("settingsSections.about.recheck")}
			</Button>
		);
	} else {
		appUpdateHint = <Chip tone="neutral">{t("settingsSections.about.notChecked")}</Chip>;
		appUpdateControl = (
			<Button variant="primary" icon={RefreshCw} onClick={() => void checkAppUpdate()}>
				{t("settingsSections.about.appCheckNow")}
			</Button>
		);
	}


	return (
		<div className="space-y-6">
			<SectionHeader title={t("settingsSections.about.title")} description={t("settingsSections.about.description")} />

			<SectionJumpBar />
			{/* 1. 本产品 (omp-workspace) */}
			<SettingsCard jump={t("settingsSections.about.titleApp")} title={t("settingsSections.about.titleApp")}>
				<SettingRow
					label={t("settingsSections.about.thisProduct")}
					description={
						<div className="space-y-1">
							<div className="text-xs text-[var(--text-muted)]">{t("settingsSections.about.thisProductDesc")}</div>
							<div className="text-[11px] font-mono text-[var(--text-dim)]">
								omp-workspace v{desktopAppVersion ?? appVersion ?? t("settingsSections.about.unknown")}
							</div>
						</div>
					}
					control={
						<div className="flex items-center gap-3">
							{appUpdateHint}
							{appUpdateControl}
						</div>
					}
				>
					{appUpdateInfo?.notes ? (
						<div className="mt-2 rounded-md bg-[var(--well-bg)] p-3 text-xs text-[var(--text-muted)]">
							<div className="mb-1 font-semibold text-[var(--text-normal)]">
								{t("settingsSections.about.appReleaseNotes")} (v{appUpdateInfo.version}):
							</div>
							<div className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
								{appUpdateInfo.notes}
							</div>
						</div>
					) : null}
					{appError && !appChecking && !appDownloading ? (
						<div className="mt-2 text-xs text-[var(--color-danger)]">
							{appError}
						</div>
					) : null}
				</SettingRow>
				<SettingRow
					label={t("settingsSections.about.appAutoUpdateLabel")}
					description={t("settingsSections.about.appAutoUpdateDesc")}
					hint={appAutoCheck ? t("settingsSections.about.appCheckIntervalHint") : undefined}
					status={appSave.status}
					statusError={appSave.error}
					onActivate={() => void appSave.run(() => setAppAutoCheck(!appAutoCheck))}
					control={
						<div className="flex items-center gap-3">
							{appAutoCheck ? (
								<div className="flex items-center gap-1.5 pr-1 border-r border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
									<span className="text-xs text-[var(--text-dim)]">{t("settingsSections.about.every")}</span>
									<CommitInput
										type="number"
										min={1}
										max={720}
										className="w-16"
										aria-label={t("settingsSections.about.appCheckIntervalAria")}
										value={String(appIntervalHours)}
										normalize={normalizeHours}
										onCommit={(v) => void appSave.run(() => setAppIntervalHours(Number(v)))}
									/>
									<span className="text-xs text-[var(--text-dim)]">{t("settingsSections.about.hours")}</span>
								</div>
							) : null}
							<Switch
								checked={appAutoCheck}
								onChange={(checked) => void appSave.run(() => setAppAutoCheck(checked))}
							/>
						</div>
					}
				/>
			</SettingsCard>

			{/* 2. omp 命令行 */}
			<SettingsCard jump={t("settingsSections.about.titleOmp")} title={t("settingsSections.about.titleOmp")}>
				<SettingRow
					label={t("settingsSections.about.ompUpdateRow")}
					description={
						<div className="space-y-1">
							{info?.found ? (
								<div className="font-mono text-[11px] text-[var(--text-dim)] break-all">{info.resolvedPath}</div>
							) : (
								<div className="text-xs text-[var(--text-muted)]">{t("settingsSections.about.ompNotFoundDesc")}</div>
							)}
							<div className="text-xs font-mono text-[var(--text-muted)]">
								{ompVersion ? `v${ompVersion}` : t("settingsSections.about.unknown")}
							</div>
						</div>
					}
					control={
						info?.found === false ? (
							<Button icon={Download} onClick={() => void useOmpInstall.getState().openAndInstall()}>
								{t("settingsSections.about.installOmp")}
							</Button>
						) : (
							<div className="flex items-center gap-3">
								{latestHint}
								{latestControl}
							</div>
						)
					}
				>
					{error && !checking && !updating && detailsOpen ? (
						<div className="relative mt-2">
							<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--well-bg)] p-2 pr-16 font-mono text-[11px] text-[var(--text-muted)]">
								{lastOutput ?? error}
							</pre>
							<IconButton
								size="sm"
								icon={Copy}
								label={t("settingsSections.about.copyDetails")}
								className="absolute right-2 top-2"
								onClick={() => void copyOutput()}
							/>
						</div>
					) : null}
				</SettingRow>
				{pendingIds.length > 0 ? (
					<SettingRow
						label={t("settingsSections.about.sessionSwitchRow")}
						description={t("settingsSections.about.sessionSwitchDesc", { count: pendingIds.length, list: pendingIds.map(nameOf).join(locale === "zh-CN" ? "、" : ", ") })}
						control={
							<Button icon={RotateCw} loading={switching} onClick={() => void handleSwitchNow()}>
								{t("settingsSections.about.switchNow")}
							</Button>
						}
					/>
				) : null}
				<SettingRow
					label={t("settingsSections.about.autoUpdateLabel")}
					description={t("settingsSections.about.autoUpdateDesc")}
					hint={settings?.ompAutoUpdate === true ? t("settingsSections.about.checkIntervalHint") : undefined}
					status={ompSave.status}
					statusError={ompSave.error}
					onActivate={() => void ompSave.run(() => save({ ompAutoUpdate: !settings?.ompAutoUpdate }))}
					control={
						<div className="flex items-center gap-3">
							{settings?.ompAutoUpdate === true ? (
								<div className="flex items-center gap-1.5 pr-1 border-r border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
									<span className="text-xs text-[var(--text-dim)]">{t("settingsSections.about.every")}</span>
									<CommitInput
										type="number"
										min={1}
										max={720}
										className="w-16"
										aria-label={t("settingsSections.about.checkIntervalAria")}
										value={String(settings?.ompCheckIntervalHours ?? 24)}
										normalize={normalizeHours}
										onCommit={(v) => void ompSave.run(() => save({ ompCheckIntervalHours: Number(v) }))}
									/>
									<span className="text-xs text-[var(--text-dim)]">{t("settingsSections.about.hours")}</span>
								</div>
							) : null}
							<Switch
								checked={settings?.ompAutoUpdate === true}
								onChange={(checked) => void ompSave.run(() => save({ ompAutoUpdate: checked }))}
							/>
						</div>
					}
				/>
			</SettingsCard>

			<OmpSections page="about" />
		</div>
	);
}
