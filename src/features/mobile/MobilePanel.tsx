/**
 * [E] Pairing / tunnel panel (rendered inside Settings ▸ 手机访问, §11 E).
 * LAN server controls, QR pairing, cloudflared tunnel, device revocation.
 */
import { ChevronDown, Copy, Globe, Power, QrCode, RefreshCw, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
	tunnelCloudflaredLogin,
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
	| "ddnsSync"
	| "cfLogin";

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
		<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_44px] items-start gap-x-2 text-xs text-[var(--text-muted)]">
			<span className="col-span-2 whitespace-nowrap">{label}</span>
			<code
				className={`min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] rounded bg-[var(--well-bg)] px-1.5 py-2 text-[var(--text)] ${mono ? "font-mono" : ""}`}
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

/** Ports are applied only by an explicit action, never by blur or unmount. */
function PortEditor({ value, activePort, running, disabled, busy, label, onSave }: {
	value: number;
	activePort?: number;
	running: boolean;
	disabled: boolean;
	busy: boolean;
	label: string;
	onSave: (port: number) => Promise<void>;
}) {
	const { t } = useT();
	const [draft, setDraft] = useState(String(value));
	const [invalid, setInvalid] = useState<string | null>(null);
	useEffect(() => { setDraft(String(value)); setInvalid(null); }, [value]);
	const dirty = draft.trim() !== String(value) || (running && Number(draft) !== activePort);
	return (
		<form className="flex w-full flex-col gap-2" onSubmit={(event) => {
			event.preventDefault();
			if (disabled || busy || !dirty) return;
			const next = draft.trim();
			const error = validatePort(next);
			setInvalid(error);
			if (!error) void onSave(Number(next));
		}}>
			<label className="space-y-1">
				<span className="text-xs whitespace-nowrap text-[var(--text-muted)]">{label}</span>
				<input type="text" inputMode="numeric" className={`${INPUT_CLASS} w-full font-mono tabular-nums`}
					value={draft} aria-invalid={invalid ? true : undefined} disabled={disabled || busy}
					onChange={(event) => { setDraft(event.target.value); setInvalid(null); }}
					onBlur={() => setInvalid(validatePort(draft.trim()))} />
			</label>
			{invalid && <p role="alert" className="text-xs text-[var(--status-error)] [overflow-wrap:anywhere]">{invalid}</p>}
			<Button type="submit" icon={RotateCcw} loading={busy} disabled={disabled || !dirty}>
				{running ? t("mobile.btnSaveRestart") : t("common.save")}
			</Button>
		</form>
	);
}

export function MobilePanel() {
	const { t, locale } = useT();
	const { settings, save } = useAppSettings();
	const [status, setStatus] = useState<MobileStatus | null>(null);
	const [pairing, setPairing] = useState<PairingInfo | null>(null);
	const [pairTarget, setPairTarget] = useState<PairingTarget>("lan");
	const [busy, setBusy] = useState<Busy | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [ddnsTokenDraft, setDdnsTokenDraft] = useState("");
	const savedMode = asMode(settings?.tunnelMode);
	const [tunnelMode, setTunnelMode] = useState<TunnelMode>(savedMode);
	const [tunnelName, setTunnelName] = useState(settings?.tunnelName ?? "");
	const [tunnelHost, setTunnelHost] = useState(settings?.tunnelHostname ?? "");
	const [expiresIn, setExpiresIn] = useState(0);
	const tunnelSave = useSaveStatus();

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
			await refresh();
		});

	const savePort = (port: number) =>
		run("restart", async () => {
			await save({ mobilePort: port });
			if (running) {
				try {
					await mobileStop();
					if (pairTarget !== "ipv6") setPairing(null);
					await mobileStart();
					toast.success(t("mobile.toastRestartedPort"));
				} finally { await refresh(); }
			} else { toast.success(t("mobile.toastPortSaved")); }
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
			await refresh();
		});

	const saveIpv6Port = (port: number) =>
		run("ipv6Restart", async () => {
			await save({ mobileIpv6Port: port });
			if (ipv6Running) {
				try {
					await mobileIpv6Stop();
					if (pairTarget === "ipv6") setPairing(null);
					await mobileIpv6Start();
					toast.success(t("mobile.toastIpv6RestartedPort"));
				} finally { await refresh(); }
			} else { toast.success(t("mobile.toastPortSaved")); }
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
		});

	const tunnelDirty =
		tunnelMode !== savedMode ||
		(tunnelMode === "named" &&
			(tunnelName.trim() !== (settings?.tunnelName ?? "") || tunnelHost.trim() !== (settings?.tunnelHostname ?? "")));
	const namedMissing = tunnelMode === "named" && !tunnelHost.trim();
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
					tunnelName: tunnelName.trim() || (tunnelMode === "named" ? "omp-mobile" : null),
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
		<div className="min-w-0 space-y-4 [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:whitespace-nowrap [&_input]:min-h-11 [&_input]:min-w-0 [&_input]:max-w-full [&_input]:text-base">
			{error && (
				<Notice
					tone="danger"
					action={<IconButton size="sm" icon={X} label={t("mobile.dismissErrorAria")} onClick={() => setError(null)} />}
				>
					<span role="alert" className="whitespace-pre-wrap [overflow-wrap:anywhere]">{error}</span>
				</Notice>
			)}

			{/* Primary pairing flow stays before all network configuration. */}
			<SettingsCard title={t("mobile.pairHeroTitle")} fieldId="mobilePairing">
				<div className="space-y-3 p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="whitespace-nowrap"><RunChip status={status == null ? "unknown" : running ? "running" : "stopped"} /></div>
						<Button variant={running ? "danger" : "secondary"} icon={Power}
							loading={busy === "server"} disabled={busy !== null || status == null} onClick={toggleServer}>
							{busy === "server" ? (running ? t("mobile.btnStopping") : t("mobile.btnStarting")) : running ? t("mobile.btnStop") : t("mobile.btnStart")}
						</Button>
					</div>
					{!pairing && <p className="text-sm text-[var(--text-muted)]">{running ? t("mobile.pairHeroHelp") : t("mobile.rowMobileLanDescStopped")}</p>}
					<div className="flex flex-wrap gap-2">
						<Button className="flex-1" variant="primary" icon={QrCode} loading={busy === "pair"}
							disabled={busy !== null || !running} title={running ? undefined : t("mobile.pairLanTitleStopped")}
							onClick={() => makePairing("lan")}>
							{t("mobile.btnGenerateQr")}
						</Button>
						<IconButton icon={RefreshCw} label={t("mobile.btnRefreshStatus")} disabled={busy !== null} onClick={() => run("refresh", refresh)} />
					</div>
				</div>
			{/* Pairing QR */}
			{pairing && (
				<div
					className="flex flex-col items-center gap-3 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card"
				>
					<div className="flex w-full items-start justify-between gap-2 border-b border-[var(--border-divider)] pb-2">
						<span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs font-medium text-[var(--text)]">
							{t("mobile.qrTitle", { target: targetLabels[pairTarget] })}
							{expired ? (
								<span className="whitespace-nowrap text-[var(--status-error)]">{t("mobile.qrExpired")}</span>
							) : (
								<span className={`whitespace-nowrap font-mono tabular-nums ${expiresIn <= 30 ? "text-[var(--status-warning)]" : "text-[var(--text-muted)]"}`}>
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
						<div className="flex w-full min-w-0 flex-col gap-2 rounded-lg hairline bg-[var(--well-bg)] p-2 sm:flex-row sm:items-center">
							<code className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[11px] text-[var(--text)]">{pairing.url}</code>
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
			</SettingsCard>
			{/* Paired devices */}
			<SettingsCard title={t("mobile.cardDevicesTitle")} fieldId="mobileDevices">
				<SettingRow
					stacked
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

			{/* Native disclosure keeps drafts mounted and never changes connectivity. */}
			<details className="group/advanced min-w-0 rounded-xl border border-[var(--border-divider)] p-4">
				<summary className="flex min-h-11 cursor-pointer list-none flex-col justify-center gap-2 [&::-webkit-details-marker]:hidden">
					<span className="flex items-center justify-between gap-3 font-medium whitespace-nowrap text-[var(--text)]">
						{t("mobile.advancedTitle")}
						<ChevronDown aria-hidden className="h-4 w-4 shrink-0 transition-transform group-open/advanced:rotate-180" />
					</span>
					<span className="text-xs text-[var(--text-muted)]">{t("mobile.advancedHelp")}</span>
					{(ipv6Running || status?.tunnelUrl || status?.ddns?.lastError || status?.ddns?.halted) && (
						<span className="flex flex-wrap gap-2 whitespace-nowrap">
							{ipv6Running && <Chip tone="success">IPv6 · {t("mobile.statusRunning")}</Chip>}
							{status?.tunnelUrl && <Chip tone="success">{t("mobile.tunnelConnectedChip")}</Chip>}
							{(status?.ddns?.lastError || status?.ddns?.halted) && <Chip tone="warning">DDNS · {t(status?.ddns?.halted ? "mobile.ddnsStatusHalted" : "mobile.ddnsStatusError")}</Chip>}
						</span>
					)}
				</summary>
				<div className="mt-4 min-w-0 space-y-6">
					<SettingsCard title={t("mobile.cardLanTitle")} fieldId="mobileLan">
						<div className="space-y-3 p-4">
							<PortEditor value={settings?.mobilePort ?? 7788} activePort={status?.port} running={running}
								disabled={busy !== null || !settings || !status} busy={busy === "restart"}
								label={t("mobile.portLabel")} onSave={savePort} />
							<p className="text-xs text-[var(--text-muted)]">{t("mobile.portHint")}</p>
							{running && status?.lanUrl && <UrlLine label={t("mobile.lanUrlLabel")} url={status.lanUrl} />}
						</div>
					</SettingsCard>

			{/* IPv6 direct */}
			<details className="group/ipv6 min-w-0 rounded-xl border border-[var(--border-divider)]">
				<summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 p-4 text-sm font-medium text-[var(--text)] [&::-webkit-details-marker]:hidden">
					<span className="min-w-0 flex-1">{t("mobile.cardIpv6Title")} / DDNS</span>
					<RunChip status={status == null ? "unknown" : ipv6Running ? "running" : !status.ipv6Address ? "noIpv6" : "stopped"} />
					{settings?.ddnsEnabled && <Chip tone={status?.ddns?.lastError || status?.ddns?.halted ? "warning" : status?.ddns?.lastIp ? "success" : "neutral"}>DDNS · {t(status?.ddns?.halted ? "mobile.ddnsStatusHalted" : status?.ddns?.lastError ? "mobile.ddnsStatusError" : status?.ddns?.lastIp ? "mobile.ddnsStatusSynced" : "mobile.ddnsStatusUnsynced")}</Chip>}
					<ChevronDown aria-hidden className="h-4 w-4 shrink-0 transition-transform group-open/ipv6:rotate-180" />
				</summary>
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
				<div className="p-4">
					<PortEditor value={settings?.mobileIpv6Port ?? 7789} activePort={status?.ipv6Port} running={ipv6Running}
						disabled={busy !== null || !settings || !status} busy={busy === "ipv6Restart"}
						label={t("mobile.ipv6PortLabel")} onSave={saveIpv6Port} />
					<p className="mt-2 text-xs text-[var(--text-muted)]">{t("mobile.ipv6PortHint")}</p>
				</div>
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
								<div className="flex min-w-0 flex-wrap gap-2">
									<input
										type="password"
										className={`${INPUT_CLASS} w-full min-w-0 basis-full`}
										placeholder={
											status?.ddns?.tokenSet
												? t("mobile.tokenSetPlaceholder")
												: t("mobile.tokenEmptyPlaceholder")
										}
										value={ddnsTokenDraft}
										aria-label={t("mobile.cfTokenLabel")}
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
			</details>

			{/* Tunnel */}
			<details className="group/tunnel min-w-0 rounded-xl border border-[var(--border-divider)]">
				<summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 p-4 text-sm font-medium text-[var(--text)] [&::-webkit-details-marker]:hidden">
					<span className="min-w-0 flex-1">{t("mobile.cardTunnelTitle")} / Zero Trust</span>
					<Chip tone={status?.tunnelUrl ? "success" : "neutral"}>{t(status?.tunnelUrl ? "mobile.tunnelConnectedChip" : "mobile.tunnelDisconnectedChip")}</Chip>
					{tunnelDirty && <Chip tone="warning">{t("mobile.unsavedChangesChip")}</Chip>}
					<ChevronDown aria-hidden className="h-4 w-4 shrink-0 transition-transform group-open/tunnel:rotate-180" />
				</summary>
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
							<>
								{status?.cloudflaredLoggedIn ? (
									<div>
										<Chip tone="success">{t("mobile.cfLoginSuccess")}</Chip>
									</div>
								) : (
									<Notice
										tone="info"
										action={
											<Button
												loading={busy === "cfLogin"}
												disabled={busy !== null || cloudflaredMissing}
												onClick={() =>
													run("cfLogin", async () => {
														await tunnelCloudflaredLogin();
														await refresh();
													})
												}
											>
												{busy === "cfLogin" ? t("mobile.cfLoginLoggingIn") : t("mobile.cfLoginBtn")}
											</Button>
										}
									>
										{t("mobile.cfLoginNotice")}
									</Notice>
								)}
								<Notice tone="info">{t("mobile.domainPrefixTip")}</Notice>
								<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
								<div className="space-y-2 rounded-lg border border-[var(--border-divider)] p-3 text-xs text-[var(--text-muted)]">
									<div className="flex flex-wrap items-center gap-2 text-[var(--text-primary)]">
										<ShieldAlert className="h-4 w-4" />
										<span className="font-medium whitespace-nowrap">{t("mobile.zeroTrustTitle")}</span>
										<Chip tone="success">{t("mobile.zeroTrustBadge")}</Chip>
									</div>
									<p>{t("mobile.zeroTrustDesc")}</p>
									<p>{t("mobile.zeroTrustGuide")}</p>
									<Button onClick={() => void openUrl("https://one.dash.cloudflare.com/").catch((error) => { setError(errMsg(error)); })}>
										{t("mobile.zeroTrustOpenDash")}
									</Button>
								</div>
							</>
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
			</details>
				</div>
			</details>


		</div>
	);
}
