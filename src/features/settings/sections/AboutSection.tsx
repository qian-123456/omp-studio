/** Settings ▸ 版本与更新 (`about`): app version, omp version, `omp update` and stale-session switching. */
import { ArrowUpCircle, CheckCircle2, ChevronDown, ChevronRight, Copy, Download, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../../stores/language";
import { confirmDialog } from "../../../lib/dialogs";
import { timeAgo } from "../../../lib/format";
import { sessionDisplayName } from "../../../lib/sessionName";
import { toast } from "../../../lib/toast";
import { ompVersionLabel, useOmpUpdate } from "../../../stores/ompUpdate";
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
	ToggleRow,
	normalizeHours,
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

	return (
		<div className="space-y-6">
			<SectionHeader title={t("settingsSections.about.title")} description={t("settingsSections.about.description")} />

			<SectionJumpBar />
			<SettingsCard jump={t("settingsSections.about.jumpVersion")} title={t("settingsSections.about.titleVersion")}>
				<SettingRow
					label={t("settingsSections.about.thisProduct")}
					description={t("settingsSections.about.thisProductDesc")}
					control={<span className="font-mono text-xs text-[var(--text-muted)]">omp-workspace v{appVersion ?? t("settingsSections.about.unknown")}</span>}
				/>
				<SettingRow
					label={t("settingsSections.about.ompVersion")}
					description={info?.found ? <span className="font-mono">{info.resolvedPath}</span> : t("settingsSections.about.ompNotFoundDesc")}
					control={
						info?.found === false ? (
							<Button icon={Download} onClick={() => void useOmpInstall.getState().openAndInstall()}>
								{t("settingsSections.about.installOmp")}
							</Button>
						) : (
							<span className="font-mono text-xs text-[var(--text-muted)]">{ompVersion ?? t("settingsSections.about.unknown")}</span>
						)
					}
				/>
				<SettingRow
					label={t("settingsSections.about.ompUpdateRow")}
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
				<ToggleRow
					fieldId="ompAutoUpdate"
					label={t("settingsSections.about.autoUpdateLabel")}
					description={t("settingsSections.about.autoUpdateDesc")}
					checked={settings?.ompAutoUpdate === true}
					onChange={(v) => save({ ompAutoUpdate: v })}
				/>
				<SettingRow
					fieldId="ompCheckIntervalHours"
					label={t("settingsSections.about.checkIntervalLabel")}
					description={t("settingsSections.about.checkIntervalDesc")}
					hint={t("settingsSections.about.checkIntervalHint")}
					control={
						<div className="flex items-center gap-1.5">
							<CommitInput
								type="number"
								min={1}
								max={720}
								className="w-24"
								aria-label={t("settingsSections.about.checkIntervalAria")}
								value={String(settings?.ompCheckIntervalHours ?? 24)}
								normalize={normalizeHours}
								onCommit={(v) => save({ ompCheckIntervalHours: Number(v) })}
							/>
							<span className="text-xs text-[var(--text-dim)]">{t("settingsSections.about.hours")}</span>
						</div>
					}
				/>
			</SettingsCard>

			<OmpSections page="about" />
		</div>
	);
}
