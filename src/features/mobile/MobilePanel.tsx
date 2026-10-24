/**
 * [E] Pairing / tunnel panel (rendered inside Settings ▸ 手机访问, §11 E).
 * LAN server controls, QR pairing, cloudflared tunnel, device revocation.
 */
import { Copy, Globe, Power, QrCode, RefreshCw, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Segmented } from "../../components/Segmented";
import type { MobileStatus, PairingInfo, PairingTarget } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import {
	mobileCreatePairing,
	mobileDdnsClearToken,
	mobileDdnsSetToken,
	mobileDdnsSync,
	mobileIpv6Start,
	mobileIpv6Stop,
	mobileRevokeAll,
	mobileStart,
	mobileStatus,
	mobileStop,
	tunnelStart,
	tunnelStop,
} from "../../lib/ipc";
import { Switch } from "../settings/Switch";
import { toast } from "../../lib/toast";
import { tNow, useT } from "../../stores/language";
import { Notice } from "../../components/Notice";
import {
	Button,
	Chip,
	CommitInput,
	INPUT_CLASS,
	IconButton,
	SaveIndicator,
	SettingRow,
	SettingsCard,
	useSaveStatus,
} from "../settings/ui";
import { useAppSettings } from "../settings/useAppSettings";

type Busy =
	| "server"
	| "restart"
	| "pair"
	| "tunnel"
	| "revoke"
	| "refresh"
	| "ipv6Server"
	| "ipv6Restart"
	| "ddnsToken"
	| "ddnsClear"
	| "ddnsSync";

type TunnelMode = "off" | "quick" | "named";

function RunChip({ status }: { status: "unknown" | "running" | "stopped" | "noIpv6" }) {
	if (status === "unknown") return <Chip tone="neutral">{tNow("mobile.statusDetecting")}</Chip>;
	if (status === "running") return <Chip tone="success">{tNow("mobile.statusRunning")}</Chip>;
	if (status === "noIpv6") return <Chip tone="warning">{tNow("mobile.statusNoIpv6")}</Chip>;
	return <Chip tone="neutral">{tNow("mobile.statusStopped")}</Chip>;
}

function asMode(v: string | undefined | null): TunnelMode {
	return v === "quick" || v === "named" ? v : "off";
}

function validatePort(v: string): string | null {
	const n = Number(v);
	return /^\d+$/.test(v) && Number.isInteger(n) && n >= 1 && n <= 65535 ? null : tNow("mobile.portValidation");
}

function formatSyncTime(iso: string | null | undefined, locale?: string): string {
	if (!iso) return tNow("mobile.neverSynced");
	try {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleString(locale ?? "zh-CN", {
			hour12: false,
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return iso;
	}
}

function CopyLine({ label, value, toastText, copyLabel, mono = true }: { label: string; value: string; toastText: string; copyLabel: string; mono?: boolean }) {
	return (
		<div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
			<span className="shrink-0">{label}</span>
			<code
				className={`min-w-0 flex-1 truncate rounded bg-[var(--well-bg)] px-1.5 py-0.5 text-[var(--text)] ${mono ? "font-mono" : ""}`}
				title={value}
			>
				{value}
			</code>
			<IconButton
				size="sm"
				icon={Copy}
				label={copyLabel}
				onClick={async () => {
					await copyText(value);
					toast.success(toastText);
				}}
			/>
		</div>
	);
}

function UrlLine({ label, url }: { label: string; url: string }) {
	return <CopyLine label={label} value={url} toastText={tNow("mobile.toastAddressCopied")} copyLabel={tNow("mobile.copyLabel", { label })} />;
}

export function MobilePanel() {
	const { t, locale } = useT();
	const { settings, save } = useAppSettings();
	const [status, setStatus] = useState<MobileStatus | null>(null);
	const [pairing, setPairing] = useState<PairingInfo | null>(null);
	const [pairTarget, setPairTarget] = useState<PairingTarget>("lan");
	const [busy, setBusy] = useState<Busy | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [portChangedWhileRunning, setPortChangedWhileRunning] = useState(false);
	const [ipv6PortChangedWhileRunning, setIpv6PortChangedWhileRunning] = useState(false);
	const [ddnsTokenDraft, setDdnsTokenDraft] = useState("");
	const savedMode = asMode(settings?.tunnelMode);
	const [tunnelMode, setTunnelMode] = useState<TunnelMode>(savedMode);
	const [tunnelName, setTunnelName] = useState(settings?.tunnelName ?? "");
	const [tunnelHost, setTunnelHost] = useState(settings?.tunnelHostname ?? "");
	const [expiresIn, setExpiresIn] = useState(0);
	const tunnelSave = useSaveStatus();
	const qrRef = useRef<HTMLDivElement>(null);

	const targetLabels: Record<PairingTarget, string> = {
		lan: t("mobile.targetLan"),
		tunnel: t("mobile.targetTunnel"),
		ipv6: t("mobile.targetIpv6"),
	};

	const tunnelModes: { value: TunnelMode; label: string; explain: string }[] = [
		{ value: "off", label: t("mobile.tunnelModeOff"), explain: t("mobile.tunnelModeOffExplain") },
		{
			value: "quick",
			label: t("mobile.tunnelModeQuick"),
			explain: t("mobile.tunnelModeQuickExplain"),
		},
		{
			value: "named",
			label: t("mobile.tunnelModeNamed"),
			explain: t("mobile.tunnelModeNamedExplain"),
		},
	];
	useEffect(() => {
		if (!settings) return;
		setTunnelMode(asMode(settings.tunnelMode));
		setTunnelName(settings.tunnelName ?? "");
		setTunnelHost(settings.tunnelHostname ?? "");
	}, [settings?.tunnelMode, settings?.tunnelName, settings?.tunnelHostname]); // eslint-disable-line react-hooks/exhaustive-deps

	const refresh = useCallback(async () => {
		try {
			setStatus(await mobileStatus());
		} catch (e) {
			setError(errMsg(e));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Countdown for the one-time pairing code; keep the card (greyed) once expired.
	useEffect(() => {
		if (!pairing) {
			setExpiresIn(0);
			return;
		}
		const tick = () =>
			setExpiresIn(Math.max(0, Math.floor((Date.parse(pairing.expiresAt) - Date.now()) / 1000)));
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [pairing]);

	const run = async (label: Busy, fn: () => Promise<void>) => {
		setBusy(label);
		setError(null);
		try {
			await fn();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(null);
		}
	};

	const running = status?.running ?? false;

	const toggleServer = () =>
		run("server", async () => {
			if (running) {
				await mobileStop();
				setPairing(null);
				toast.info(t("mobile.toastStopped"));
			} else {
				await mobileStart();
				toast.success(t("mobile.toastStarted"));
			}
			setPortChangedWhileRunning(false);
			await refresh();
		});

	const restartServer = () =>
		run("restart", async () => {
			await mobileStop();
			await mobileStart();
			setPairing(null);
			setPortChangedWhileRunning(false);
			toast.success(t("mobile.toastRestartedPort"));
			await refresh();
		});

	const ipv6Running = status?.ipv6Running ?? false;

	const toggleIpv6 = () =>
		run("ipv6Server", async () => {
			if (ipv6Running) {
				await mobileIpv6Stop();
				if (pairTarget === "ipv6") setPairing(null);
				toast.info(t("mobile.toastIpv6Stopped"));
			} else {
				await mobileIpv6Start();
				toast.success(t("mobile.toastIpv6Started"));
			}
			setIpv6PortChangedWhileRunning(false);
			await refresh();
		});

	const restartIpv6 = () =>
		run("ipv6Restart", async () => {
			await mobileIpv6Stop();
			await mobileIpv6Start();
			if (pairTarget === "ipv6") setPairing(null);
			setIpv6PortChangedWhileRunning(false);
			toast.success(t("mobile.toastIpv6RestartedPort"));
			await refresh();
		});

	const saveDdnsToken = () =>
		run("ddnsToken", async () => {
			const token = ddnsTokenDraft.trim();
			if (!token) return;
			const nextDdns = await mobileDdnsSetToken(token);
			setDdnsTokenDraft("");
			setStatus((prev) => (prev ? { ...prev, ddns: nextDdns } : prev));
			toast.success(t("mobile.toastTokenSaved"));
			await refresh();
		});

	const clearDdnsToken = () =>
		run("ddnsClear", async () => {
			const nextDdns = await mobileDdnsClearToken();
			setDdnsTokenDraft("");
			setStatus((prev) => (prev ? { ...prev, ddns: nextDdns } : prev));
			toast.info(t("mobile.toastTokenCleared"));
			await refresh();
		});

	const syncDdns = () =>
		run("ddnsSync", async () => {
			const nextDdns = await mobileDdnsSync();
			setStatus((prev) => (prev ? { ...prev, ddns: nextDdns } : prev));
			toast.success(t("mobile.toastDdnsSynced"));
			await refresh();
		});

	const makePairing = (target: PairingTarget) =>
		run("pair", async () => {
			const info = await mobileCreatePairing(target);
			setPairing(info);
			setPairTarget(target);
			requestAnimationFrame(() => qrRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
		});

	const tunnelDirty =
		tunnelMode !== savedMode ||
		(tunnelMode === "named" &&
			(tunnelName.trim() !== (settings?.tunnelName ?? "") || tunnelHost.trim() !== (settings?.tunnelHostname ?? "")));
	const namedMissing = tunnelMode === "named" && (!tunnelName.trim() || !tunnelHost.trim());
	const cloudflaredMissing = status != null && !status.cloudflaredInstalled;

	const applyTunnel = () =>
		run("tunnel", async () => {
			if (namedMissing) {
				setError(t("mobile.errorNamedMissing"));
				return;
			}
			const ok = await tunnelSave.run(() =>
				save({
					tunnelMode,
					tunnelName: tunnelName.trim() || null,
					tunnelHostname: tunnelHost.trim() || null,
				}),
			);
			if (!ok) return;
			if (tunnelMode === "off") {
				await tunnelStop();
				toast.info(t("mobile.toastTunnelClosed"));
			} else {
				await tunnelStart();
				toast.success(t("mobile.toastTunnelStarted"));
			}
			await refresh();
		});

	const revokeAll = () =>
		run("revoke", async () => {
			const confirmed = await confirmDialog(
				t("mobile.revokeConfirmMessage"),
				{ danger: true, title: t("mobile.revokeConfirmTitle"), okLabel: t("mobile.revokeConfirmOk") },
			);
			if (!confirmed) return;
			await mobileRevokeAll();
			setPairing(null);
			toast.success(t("mobile.toastRevoked"));
		});

	const mm = Math.floor(expiresIn / 60);
	const ss = String(expiresIn % 60).padStart(2, "0");
	const expired = pairing != null && expiresIn === 0;
	const modeInfo = tunnelModes.find((m) => m.value === tunnelMode) ?? tunnelModes[0];
	const tunnelButtonLabel =
		tunnelMode === "off" ? (status?.tunnelUrl ? t("mobile.btnCloseTunnel") : t("common.save")) : status?.tunnelUrl ? t("mobile.btnSaveAndReconnect") : t("mobile.btnSaveAndStartTunnel");
	return (
		<div className="space-y-6">
			{error && (
				<Notice
					tone="danger"
					action={<IconButton size="sm" icon={X} label={t("mobile.dismissErrorAria")} onClick={() => setError(null)} />}
				>
					{error}
				</Notice>
			)}

			{/* LAN server */}
			<SettingsCard title={t("mobile.cardLanTitle")} fieldId="mobileLan">
				<SettingRow
					label={
						<span className="flex items-center gap-2">
							{t("mobile.rowMobileLanLabel")}
							<RunChip status={status == null ? "unknown" : running ? "running" : "stopped"} />
						</span>
					}
					description={
						running
							? t("mobile.rowMobileLanDescRunning")
							: t("mobile.rowMobileLanDescStopped")
					}
					control={
						<Button
							variant={running ? "danger" : "primary"}
							icon={Power}
							loading={busy === "server"}
							disabled={busy !== null || status == null}
							onClick={toggleServer}
						>
							{busy === "server" ? (running ? t("mobile.btnStopping") : t("mobile.btnStarting")) : running ? t("mobile.btnStop") : t("mobile.btnStart")}
						</Button>
					}
				>
					{running && status?.lanUrl && <UrlLine label={t("mobile.lanUrlLabel")} url={status.lanUrl} />}
				</SettingRow>
				<SettingRow
					label={t("mobile.portLabel")}
					description={t("mobile.portDesc")}
					hint={t("mobile.portHint")}
					control={
						<CommitInput
							type="number"
							min={1}
							max={65535}
							className="w-28"
							aria-label={t("mobile.portAria")}
							value={String(settings?.mobilePort ?? 7788)}
							validate={validatePort}
							onCommit={async (v) => {
								await save({ mobilePort: Number(v) });
								if (running) setPortChangedWhileRunning(true);
							}}
						/>
					}
				>
					{portChangedWhileRunning && (
						<Notice
							tone="warning"
							action={
								<Button icon={RotateCcw} loading={busy === "restart"} disabled={busy !== null} onClick={restartServer}>
									{t("mobile.btnRestartNow")}
								</Button>
							}
						>
							{t("mobile.noticePortRestart")}
						</Notice>
					)}
				</SettingRow>
				<SettingRow
					label={t("mobile.pairLanLabel")}
					description={running ? t("mobile.pairLanDescRunning") : t("mobile.pairLanDescStopped")}
					control={
						<Button
							icon={QrCode}
							loading={busy === "pair" && pairTarget === "lan"}
							disabled={busy !== null || !running}
							title={running ? undefined : t("mobile.pairLanTitleStopped")}
							onClick={() => makePairing("lan")}
						>
							{t("mobile.btnGenerateQr")}
						</Button>
					}
				/>
			</SettingsCard>

			{/* IPv6 direct */}
			<SettingsCard
				title={t("mobile.cardIpv6Title")}
				fieldId="mobileIpv6"
				footer={t("mobile.cardIpv6Footer")}
			>
				<SettingRow
					label={
						<span className="flex items-center gap-2">
							{t("mobile.ipv6DirectLabel")}
							<RunChip
								status={
									status == null
										? "unknown"
										: ipv6Running
											? "running"
											: !status.ipv6Address
												? "noIpv6"
												: "stopped"
								}
							/>
						</span>
					}
					description={
						ipv6Running
							? t("mobile.ipv6DirectDescRunning")
							: t("mobile.ipv6DirectDescStopped")
					}
					control={
						<Button
							variant={ipv6Running ? "danger" : "primary"}
							icon={Power}
							loading={busy === "ipv6Server"}
							disabled={busy !== null || status == null}
							onClick={toggleIpv6}
						>
							{busy === "ipv6Server" ? (ipv6Running ? t("mobile.btnStopping") : t("mobile.btnStarting")) : ipv6Running ? t("mobile.btnStop") : t("mobile.btnStart")}
						</Button>
					}
				>
					<div className="space-y-2">
						{status?.ipv6Address ? (
							<CopyLine
								label={t("mobile.ipv6AddrLabel")}
								value={status.ipv6Address}
								toastText={t("mobile.ipv6AddrCopied")}
								copyLabel={t("mobile.ipv6AddrCopyAria")}
							/>
						) : (
							<Notice tone="warning">{t("mobile.noticeNoIpv6")}</Notice>
						)}
						{ipv6Running && status?.ipv6Url && <UrlLine label={t("mobile.ipv6UrlLabel")} url={status.ipv6Url} />}
						{status?.certSha256 && (
							<CopyLine
								label={t("mobile.certShaLabel")}
								value={status.certSha256}
								toastText={t("mobile.certShaCopied")}
								copyLabel={t("mobile.certShaCopyAria")}
							/>
						)}
					</div>
				</SettingRow>
				<SettingRow
					label={t("mobile.ipv6PortLabel")}
					description={t("mobile.ipv6PortDesc")}
					hint={t("mobile.ipv6PortHint")}
					control={
						<CommitInput
							type="number"
							min={1}
							max={65535}
							className="w-28"
							aria-label={t("mobile.ipv6PortAria")}
							value={String(settings?.mobileIpv6Port ?? 7789)}
							validate={validatePort}
							onCommit={async (v) => {
								await save({ mobileIpv6Port: Number(v) });
								if (ipv6Running) setIpv6PortChangedWhileRunning(true);
							}}
						/>
					}
				>
					{ipv6PortChangedWhileRunning && (
						<Notice
							tone="warning"
							action={
								<Button
									icon={RotateCcw}
									loading={busy === "ipv6Restart"}
									disabled={busy !== null}
									onClick={restartIpv6}
								>
									{t("mobile.btnRestartNow")}
								</Button>
							}
						>
							{t("mobile.noticeIpv6PortRestart")}
						</Notice>
					)}
				</SettingRow>
				<SettingRow
					label={t("mobile.pairIpv6Label")}
					description={
						ipv6Running
							? t("mobile.pairIpv6DescRunning")
							: t("mobile.pairIpv6DescStopped")
					}
					control={
						<Button
							icon={QrCode}
							loading={busy === "pair" && pairTarget === "ipv6"}
							disabled={busy !== null || !ipv6Running || !status?.ipv6Url}
							title={
								!ipv6Running
									? t("mobile.pairIpv6TitleStopped")
									: !status?.ipv6Url
										? t("mobile.pairIpv6TitleNoUrl")
										: undefined
							}
							onClick={() => makePairing("ipv6")}
						>
							{t("mobile.btnGenerateIpv6Qr")}
						</Button>
					}
				/>
				<div className="space-y-1.5 px-4 py-3 text-xs leading-relaxed text-[var(--text-muted)]">
					<div className="font-medium text-[var(--text)]">{t("mobile.usageTipsTitle")}</div>
					<ul className="list-inside list-disc space-y-1">
						<li>{t("mobile.tip1")}</li>
						<li>{t("mobile.tip2")}</li>
						<li>{t("mobile.tip3")}</li>
						<li>{t("mobile.tip4")}</li>
					</ul>
				</div>
				{/* DDNS subsection */}
				<SettingRow
					label={
						<span className="flex items-center gap-2">
							{t("mobile.ddnsLabel")}
							{settings?.ddnsEnabled && (
								<Chip
									tone={
										status?.ddns?.halted
											? "warning"
											: status?.ddns?.lastError
												? "danger"
												: status?.ddns?.lastIp
													? "success"
													: "neutral"
									}
								>
									{status?.ddns?.halted
										? t("mobile.ddnsStatusHalted")
										: status?.ddns?.lastError
											? t("mobile.ddnsStatusError")
											: status?.ddns?.lastIp
												? t("mobile.ddnsStatusSynced")
												: t("mobile.ddnsStatusUnsynced")}
								</Chip>
							)}
						</span>
					}
					description={t("mobile.ddnsDesc")}
					control={
						<Switch
							checked={settings?.ddnsEnabled ?? false}
							disabled={busy !== null}
							ariaLabel={t("mobile.ddnsEnableAria")}
							onChange={async (checked) => {
								await save({ ddnsEnabled: checked });
								await refresh();
							}}
						/>
					}
				>
					{settings?.ddnsEnabled && (
						<div className="space-y-3 pt-2">
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								<label className="space-y-1 text-xs text-[var(--text-muted)]">
									<span>Zone ID</span>
									<CommitInput
										aria-label="Cloudflare Zone ID"
										placeholder={t("mobile.zoneIdPlaceholder")}
										value={settings?.ddnsZoneId ?? ""}
										onCommit={async (v) => {
											await save({ ddnsZoneId: v.trim() || null });
											await refresh();
										}}
									/>
								</label>
								<label className="space-y-1 text-xs text-[var(--text-muted)]">
									<span>{t("mobile.ddnsHostnameLabel")}</span>
									<CommitInput
										aria-label={t("mobile.ddnsHostnameAria")}
										placeholder={t("mobile.ddnsHostnamePlaceholder")}
										value={settings?.ddnsHostname ?? ""}
										onCommit={async (v) => {
											await save({ ddnsHostname: v.trim() || null });
											await refresh();
										}}
									/>
								</label>
							</div>

							<div className="space-y-1 text-xs text-[var(--text-muted)]">
								<div className="flex items-center justify-between">
									<span>{t("mobile.cfTokenLabel")}</span>
									{status?.ddns?.tokenSet && <Chip tone="success">{t("mobile.tokenSetChip")}</Chip>}
								</div>
								<div className="flex gap-2">
									<input
										type="password"
										className={INPUT_CLASS}
										placeholder={
											status?.ddns?.tokenSet
												? t("mobile.tokenSetPlaceholder")
												: t("mobile.tokenEmptyPlaceholder")
										}
										value={ddnsTokenDraft}
										onChange={(e) => setDdnsTokenDraft(e.target.value)}
									/>
									<Button
										variant="primary"
										loading={busy === "ddnsToken"}
										disabled={busy !== null || !ddnsTokenDraft.trim()}
										onClick={saveDdnsToken}
									>
										{t("mobile.btnSaveToken")}
									</Button>
									{status?.ddns?.tokenSet && (
										<Button loading={busy === "ddnsClear"} disabled={busy !== null} onClick={clearDdnsToken}>
											{t("mobile.btnClearToken")}
										</Button>
									)}
								</div>
								<p className="text-[11px] text-[var(--text-dim)]">
									{t("mobile.tokenSecurityNote")}
								</p>
							</div>

							{status?.ddns?.halted && (
								<Notice tone="warning" title={t("mobile.noticeDdnsHaltedTitle")}>
									{t("mobile.noticeDdnsHaltedMsg")}
								</Notice>
							)}

							{status?.ddns?.lastError && !status?.ddns?.halted && (
								<Notice tone="danger">{t("mobile.noticeDdnsLastError", { error: status.ddns.lastError })}</Notice>
							)}

							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-divider)] pt-2 text-xs text-[var(--text-muted)]">
								<div className="flex flex-wrap items-center gap-3">
									<span>{t("mobile.lastSyncLabel", { time: formatSyncTime(status?.ddns?.lastSyncAt, locale) })}</span>
									<span>
										{t("mobile.lastResolvedIpLabel")}
										<code className="rounded bg-[var(--well-bg)] px-1 font-mono text-[var(--text)]">
											{status?.ddns?.lastIp ?? t("mobile.lastResolvedIpNone")}
										</code>
									</span>
								</div>
								<Button
									icon={RefreshCw}
									loading={busy === "ddnsSync"}
									disabled={
										busy !== null ||
										!status?.ddns?.tokenSet ||
										!settings?.ddnsZoneId ||
										!settings?.ddnsHostname
									}
									title={
										!status?.ddns?.tokenSet
											? t("mobile.titleSyncNoToken")
											: !settings?.ddnsZoneId || !settings?.ddnsHostname
												? t("mobile.titleSyncNoDomain")
												: undefined
									}
									onClick={syncDdns}
								>
									{t("mobile.btnSyncNow")}
								</Button>
							</div>
						</div>
					)}
				</SettingRow>
			</SettingsCard>

			{/* Tunnel */}
			<SettingsCard
				title={t("mobile.cardTunnelTitle")}
				fieldId="mobileTunnel"
				footer={t("mobile.cardTunnelFooter")}
			>
				<SettingRow
					stacked
					label={
						<span className="flex items-center gap-2">
							{t("mobile.tunnelMethodLabel")}
							{status?.tunnelUrl ? (
								<Chip tone="success">{t("mobile.tunnelConnectedChip")}</Chip>
							) : savedMode !== "off" ? (
								<Chip tone="neutral">{t("mobile.tunnelDisconnectedChip")}</Chip>
							) : null}
						</span>
					}
					description={modeInfo.explain}
					control={
						<Segmented
							size="sm"
							aria-label={t("mobile.tunnelMethodAria")}
							value={tunnelMode}
							onChange={setTunnelMode}
							disabled={busy !== null}
							options={tunnelModes.map((m) => ({ value: m.value, label: m.label }))}
						/>
					}
				>
					<div className="space-y-2.5">
						{cloudflaredMissing && tunnelMode !== "off" && (
							<Notice tone="warning">
								{t("mobile.noticeCloudflaredMissingPre")}
								<code className="rounded bg-[var(--well-bg)] px-1 font-mono">brew install cloudflared</code>
								{t("mobile.noticeCloudflaredMissingPost")}
							</Notice>
						)}
						{tunnelMode === "named" && (
							<div className="grid grid-cols-2 gap-2">
								<label className="space-y-1 text-xs text-[var(--text-muted)]">
									<span>{t("mobile.tunnelNameLabel")}</span>
									<input
										className={INPUT_CLASS}
										placeholder={t("mobile.tunnelNamePlaceholder")}
										value={tunnelName}
										onChange={(e) => setTunnelName(e.target.value)}
									/>
								</label>
								<label className="space-y-1 text-xs text-[var(--text-muted)]">
									<span>{t("mobile.tunnelHostLabel")}</span>
									<input
										className={INPUT_CLASS}
										placeholder={t("mobile.tunnelHostPlaceholder")}
										value={tunnelHost}
										onChange={(e) => setTunnelHost(e.target.value)}
									/>
								</label>
							</div>
						)}
						{status?.tunnelUrl && <UrlLine label={t("mobile.tunnelPublicUrlLabel")} url={status.tunnelUrl} />}
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant={tunnelMode === "off" ? "secondary" : "primary"}
								icon={Globe}
								loading={busy === "tunnel"}
								disabled={
									busy !== null ||
									namedMissing ||
									(tunnelMode !== "off" && cloudflaredMissing) ||
									(!tunnelDirty && tunnelMode === "off" && !status?.tunnelUrl)
								}
								title={namedMissing ? t("mobile.errorNamedMissing") : undefined}
								onClick={applyTunnel}
							>
								{busy === "tunnel" ? t("mobile.btnTunnelProcessing") : tunnelButtonLabel}
							</Button>
							<Button
								icon={RefreshCw}
								loading={busy === "refresh"}
								disabled={busy !== null}
								onClick={() => run("refresh", refresh)}
								title={t("mobile.tipTempUrlSlow")}
							>
								{t("mobile.btnRefreshStatus")}
							</Button>
							<Button
								icon={QrCode}
								disabled={busy !== null || !status?.tunnelUrl}
								title={status?.tunnelUrl ? undefined : t("mobile.tipTunnelNotReady")}
								onClick={() => makePairing("tunnel")}
							>
								{t("mobile.btnGenerateTunnelQr")}
							</Button>
							{tunnelDirty && tunnelSave.status === "idle" && (
								<Chip tone="warning">{t("mobile.unsavedChangesChip")}</Chip>
							)}
							<SaveIndicator status={tunnelSave.status} error={tunnelSave.error} />
						</div>
					</div>
				</SettingRow>
			</SettingsCard>

			{/* Pairing QR */}
			{pairing && (
				<div
					ref={qrRef}
					className="flex flex-col items-center gap-3 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card"
				>
					<div className="flex w-full items-center justify-between border-b border-[var(--border-divider)] pb-2">
						<span className="text-xs font-medium text-[var(--text)]">
							{t("mobile.qrTitle", { target: targetLabels[pairTarget] })}
							{expired ? (
								<span className="text-[var(--status-error)]">{t("mobile.qrExpired")}</span>
							) : (
								<span className={`font-mono tabular-nums ${expiresIn <= 30 ? "text-[var(--status-warning)]" : "text-[var(--text-muted)]"}`}>
									{t("mobile.qrExpiresIn", { mm, ss })}
								</span>
							)}
						</span>
						<IconButton icon={X} label={t("mobile.closeQrAria")} onClick={() => setPairing(null)} />
					</div>
					<div className="relative">
						<div
							className={`rounded-lg bg-white p-3 [&_svg]:h-44 [&_svg]:w-44 ${expired ? "opacity-20 blur-[2px]" : ""}`}
							// Backend-generated SVG QR (qrcode crate), not user content.
							dangerouslySetInnerHTML={{ __html: pairing.qrSvg }}
						/>
						{expired && (
							<div className="absolute inset-0 flex items-center justify-center">
								<Button
									variant="primary"
									icon={RefreshCw}
									disabled={busy !== null}
									onClick={() => makePairing(pairTarget)}
								>
									{t("mobile.btnRegenerate")}
								</Button>
							</div>
						)}
					</div>
					<p className="text-center text-xs text-[var(--text-muted)]">
						{expired
							? t("mobile.qrExpiredHelp")
							: t("mobile.qrScanHelp")}
					</p>
					{!expired && (
						<div className="flex w-full items-center gap-2 rounded-lg hairline bg-[var(--well-bg)] p-2">
							<code className="flex-1 break-all font-mono text-[11px] text-[var(--text)]">{pairing.url}</code>
							<Button
								icon={Copy}
								title={t("mobile.copyPairUrlTitle")}
								onClick={async () => {
									await copyText(pairing.url);
									toast.success(t("mobile.toastPairUrlCopied"));
								}}
							>
								{t("mobile.btnCopyLink")}
							</Button>
						</div>
					)}
				</div>
			)}

			{/* Paired devices */}
			<SettingsCard title={t("mobile.cardDevicesTitle")} fieldId="mobileDevices">
				<SettingRow
					danger
					label={t("mobile.rowRevokeLabel")}
					description={t("mobile.rowRevokeDesc")}
					control={
						<Button variant="danger" icon={ShieldAlert} loading={busy === "revoke"} disabled={busy !== null} onClick={revokeAll}>
							{t("mobile.btnRevokeAll")}
						</Button>
					}
				/>
			</SettingsCard>
		</div>
	);
}
