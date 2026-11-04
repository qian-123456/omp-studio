/**
 * [E] Pairing / tunnel panel (rendered inside Settings ▸ 手机访问, §11 E).
 * LAN server controls, QR pairing, cloudflared tunnel, device revocation.
 */
import { Copy, Globe, Info, Power, QrCode, RefreshCw, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Segmented } from "../../components/Segmented";
import type { MobileDevice, MobileDeviceWork, MobileStatus, PairingInfo, PairingTarget } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import {
	mobileCreatePairing,
	mobileDeviceWork,
	mobileListDevices,
	mobileRenameDevice,
	mobileRevokeDevice,
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
import { Modal } from "../../components/Modal";
import {
	Button,
	Chip,
	CommitInput,
	INPUT_CLASS,
	IconButton,
	SaveIndicator,
	SettingRow,
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
		<form className="flex items-center gap-2" onSubmit={(event) => {
			event.preventDefault();
			if (disabled || busy || !dirty) return;
			const next = draft.trim();
			const error = validatePort(next);
			setInvalid(error);
			if (!error) void onSave(Number(next));
		}}>
			<label className="flex items-center gap-2">
				{label && <span className="text-xs whitespace-nowrap text-[var(--text-muted)]">{label}:</span>}
				<input
					type="text"
					inputMode="numeric"
					className={`${INPUT_CLASS} w-20 text-center font-mono tabular-nums`}
					value={draft}
					aria-label={label || t("mobile.portLabel")}
					aria-invalid={invalid ? true : undefined}
					disabled={disabled || busy}
					onChange={(event) => { setDraft(event.target.value); setInvalid(null); }}
					onBlur={() => setInvalid(validatePort(draft.trim()))}
				/>
			</label>
			{dirty && (
				<Button size="sm" type="submit" icon={RotateCcw} loading={busy} disabled={disabled}>
					{running ? t("mobile.btnSaveRestart") : t("common.save")}
				</Button>
			)}
			{invalid && <p role="alert" className="text-xs text-[var(--status-error)] [overflow-wrap:anywhere]">{invalid}</p>}
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
	const [view, setView] = useState<"lan" | "remote">("lan");
	const [remote, setRemote] = useState<"ipv6" | "tunnel">("ipv6");
	const [devices, setDevices] = useState<MobileDevice[] | null>(null);
	const [deviceListError, setDeviceListError] = useState<string | null>(null);
	const [deviceDialog, setDeviceDialog] = useState<{ type: "rename" | "remove"; device: MobileDevice } | null>(null);
	const [deviceName, setDeviceName] = useState("");
	const [deviceWork, setDeviceWork] = useState<MobileDeviceWork[] | null>(null);
	const [workError, setWorkError] = useState<string | null>(null);
	const [stopWork, setStopWork] = useState(false);
	const [selectedWork, setSelectedWork] = useState<string[]>([]);
	const [deviceBusy, setDeviceBusy] = useState(false);
	const [showLanGuide, setShowLanGuide] = useState(false);
	const [showIpv6Guide, setShowIpv6Guide] = useState(false);
	const [showTunnelGuide, setShowTunnelGuide] = useState(false);
	const [devicesOpen, setDevicesOpen] = useState(false);
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

	const refreshDevices = useCallback(async () => {
		try { setDevices(await mobileListDevices()); setDeviceListError(null); }
		catch (e) { setDeviceListError(errMsg(e)); }
	}, []);
	useEffect(() => { void refreshDevices(); }, [refreshDevices]);

	const openRemove = (device: MobileDevice) => {
		setDeviceDialog({ type: "remove", device });
		setDeviceWork(null);
		setWorkError(null);
		setStopWork(false);
		setSelectedWork([]);
	};
	useEffect(() => {
		if (deviceDialog?.type !== "remove") return;
		let active = true;
		void mobileDeviceWork(deviceDialog.device.id).then((work) => {
			if (active) setDeviceWork(work);
		}).catch((e) => { if (active) setWorkError(errMsg(e)); });
		return () => { active = false; };
	}, [deviceDialog]);

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
			await refreshDevices();
			toast.success(t("mobile.toastRevoked"));
		});

	const mm = Math.floor(expiresIn / 60);
	const ss = String(expiresIn % 60).padStart(2, "0");
	const expired = pairing != null && expiresIn === 0;
	const modeInfo = tunnelModes.find((m) => m.value === tunnelMode) ?? tunnelModes[0];
	const tunnelButtonLabel =
		tunnelMode === "off" ? (status?.tunnelUrl ? t("mobile.btnCloseTunnel") : t("common.save")) : status?.tunnelUrl ? t("mobile.btnSaveAndReconnect") : t("mobile.btnSaveAndStartTunnel");
	return (
		<div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
			{error && (
				<Notice
					tone="danger"
					action={<IconButton size="sm" icon={X} label={t("mobile.dismissErrorAria")} onClick={() => setError(null)} />}
				>
					<span role="alert" className="whitespace-pre-wrap [overflow-wrap:anywhere]">{error}</span>
				</Notice>
			)}
			{/* Top Unified Action Bar */}
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-divider)] bg-[var(--card-bg)] p-3.5 shadow-sm">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="text-sm font-semibold text-[var(--text)]">{t("mobile.rowMobileLanLabel")}</span>
						<RunChip status={status == null ? "unknown" : running ? "running" : "stopped"} />
					</div>
					<p className="mt-0.5 text-xs text-[var(--text-muted)]">
						{running ? t("mobile.rowMobileLanDescRunning") : t("mobile.rowMobileLanDescStopped")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant={running ? "secondary" : "primary"}
						icon={Power}
						loading={busy === "server"}
						disabled={busy !== null || status == null}
						onClick={toggleServer}
					>
						{busy === "server" ? (running ? t("mobile.btnStopping") : t("mobile.btnStarting")) : running ? t("mobile.btnStop") : t("mobile.btnStart")}
					</Button>
					<Button
						variant="secondary"
						icon={QrCode}
						loading={busy === "pair"}
						disabled={busy !== null || !running || (view === "remote" && remote === "ipv6" && !status?.ipv6Url) || (view === "remote" && remote === "tunnel" && !status?.tunnelUrl)}
						title={running ? undefined : t("mobile.pairLanTitleStopped")}
						onClick={() => makePairing(view === "lan" ? "lan" : remote)}
					>
						{t("mobile.btnGenerateQr")}
					</Button>
					<IconButton icon={RefreshCw} label={t("mobile.btnRefreshStatus")} disabled={busy !== null} onClick={() => run("refresh", refresh)} />
				</div>
			</div>

			{/* Active QR Code Card */}
			{pairing && (
				<div data-field-id="mobileQr" className="rounded-xl border border-[var(--border-divider)] bg-[var(--card-bg)] p-4 shadow-sm">
					<div className="flex min-w-0 flex-wrap items-start gap-4">
						<div className="relative shrink-0">
							<div
								className={`rounded-lg bg-white p-3 [&_svg]:h-44 [&_svg]:w-44 ${expired ? "opacity-20 blur-[2px]" : ""}`}
								dangerouslySetInnerHTML={{ __html: pairing.qrSvg }}
							/>
							{expired && (
								<div className="absolute inset-0 flex items-center justify-center">
									<Button variant="primary" icon={RefreshCw} disabled={busy !== null} onClick={() => makePairing(view === "lan" ? "lan" : remote)}>
										{t("mobile.btnRegenerate")}
									</Button>
								</div>
							)}
						</div>
						<div className="min-w-[min(100%,16rem)] flex-1 space-y-3">
							<div className="flex items-start justify-between gap-2">
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
							<p className="text-xs text-[var(--text-muted)]">
								{expired ? t("mobile.qrExpiredHelp") : t("mobile.qrScanHelp")}
							</p>
							{!expired && (
								<div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg hairline bg-[var(--well-bg)] p-2">
									<code className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[11px] text-[var(--text)]">{pairing.url}</code>
									<Button
										className="shrink-0"
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
					</div>
				</div>
			)}

			<Segmented aria-label={t("settingsSections.mobile.title")} value={view} onChange={setView}
				options={[{ value: "lan", label: t("mobile.tabLan") }, { value: "remote", label: t("mobile.tabRemote") }]} />
			{view === "remote" && (
				<fieldset className="flex flex-wrap gap-5 text-sm text-[var(--text)]">
					<label className="flex items-center gap-2 whitespace-nowrap"><input type="radio" name="remote-transport" checked={remote === "ipv6"} onChange={() => setRemote("ipv6")} />{t("mobile.remoteIpv6")}</label>
					<label className="flex items-center gap-2 whitespace-nowrap"><input type="radio" name="remote-transport" checked={remote === "tunnel"} onChange={() => setRemote("tunnel")} />{t("mobile.remoteTunnel")}</label>
				</fieldset>
			)}

			{/* LAN Panel */}
			<div hidden={view !== "lan"} className="space-y-3" data-field-id="mobileLan">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5">
						<span className="text-[13px] font-medium text-[var(--text)]">{t("mobile.lanConnection")}</span>
						<button
							type="button"
							className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-divider)] bg-[var(--well-bg)] text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
							onClick={() => setShowLanGuide((v) => !v)}
							title={t("mobile.usageTipsTitle")}
							aria-label={t("mobile.usageTipsTitle")}
						>
							<Info className="h-3 w-3" />
						</button>
					</div>
					<span className="text-xs text-[var(--text-muted)]">{t("mobile.tunnelModeOffExplain")}</span>
				</div>

				{showLanGuide && (
					<div className="rounded-lg border-l-2 border-[#0969da] bg-[var(--well-bg)] p-3 text-xs text-[var(--text-muted)]">
						<p>{t("mobile.pairHeroHelp")}</p>
					</div>
				)}

				{/* Plan B Flat Card */}
				<div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border-divider)] bg-[var(--card-bg)] p-3.5">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
						<div>
							<span className="block text-[11px] text-[var(--text-muted)]">{t("mobile.lanUrlLabel")}</span>
							<span className="font-mono text-sm font-semibold text-[var(--text)]">
								{status?.lanUrl ?? `http://...:${settings?.mobilePort ?? 7788}`}
							</span>
						</div>
						<div className="hidden h-7 w-[1px] bg-[var(--border-divider)] sm:block" />
						<PortEditor
							value={settings?.mobilePort ?? 7788}
							activePort={status?.port}
							running={running}
							disabled={busy !== null || !settings || !status}
							busy={busy === "restart"}
							label={t("mobile.portLabel")}
							onSave={savePort}
						/>
					</div>
					{status?.lanUrl && (
						<Button
							size="sm"
							variant="secondary"
							icon={Copy}
							onClick={async () => {
								await copyText(status.lanUrl!);
								toast.success(t("mobile.toastAddressCopied"));
							}}
						>
							{t("mobile.btnCopyLink")}
						</Button>
					)}
				</div>
			</div>

			{/* IPv6 direct */}
			<div hidden={view !== "remote" || remote !== "ipv6"} className="space-y-3" data-field-id="mobileIpv6">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5">
						<span className="text-[13px] font-medium text-[var(--text)]">{t("mobile.ipv6Connection")}</span>
						<button
							type="button"
							className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-divider)] bg-[var(--well-bg)] text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
							onClick={() => setShowIpv6Guide((v) => !v)}
							title={t("mobile.usageTipsTitle")}
							aria-label={t("mobile.usageTipsTitle")}
						>
							<Info className="h-3 w-3" />
						</button>
					</div>
					<div className="flex items-center gap-2">
						<RunChip status={status == null ? "unknown" : ipv6Running ? "running" : !status.ipv6Address ? "noIpv6" : "stopped"} />
						<Button size="sm" variant="secondary" icon={Power} loading={busy === "ipv6Server"} disabled={busy !== null || status == null} onClick={toggleIpv6}>
							{busy === "ipv6Server" ? (ipv6Running ? t("mobile.btnStopping") : t("mobile.btnStarting")) : ipv6Running ? t("mobile.btnStop") : t("mobile.btnStart")}
						</Button>
					</div>
				</div>

				{showIpv6Guide && (
					<div className="space-y-1.5 rounded-lg border-l-2 border-[#0969da] bg-[var(--well-bg)] p-3 text-xs text-[var(--text-muted)]">
						<div className="font-medium text-[var(--text)]">{t("mobile.usageTipsTitle")}</div>
						<ul className="list-inside list-disc space-y-1">
							<li>{t("mobile.tip1")}</li>
							<li>{t("mobile.tip2")}</li>
							<li>{t("mobile.tip3")}</li>
							<li>{t("mobile.tip4")}</li>
						</ul>
					</div>
				)}

				{ipv6Running && status?.ipv6Url && <UrlLine label={t("mobile.ipv6UrlLabel")} url={status.ipv6Url} />}
				{status && !status.ipv6Address && <Notice tone="warning">{t("mobile.noticeNoIpv6")}</Notice>}

				{/* Plan B: IPv6 address, Cert fingerprint, and Port 7789 */}
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
					<div className="rounded-xl border border-[var(--border-divider)] bg-[var(--card-bg)] p-3">
						<span className="block text-[11px] text-[var(--text-muted)]">{t("mobile.ipv6AddrLabel")}</span>
						<span className="font-mono text-xs font-semibold text-[var(--text)] [overflow-wrap:anywhere]">
							{status?.ipv6Address ?? "—"}
						</span>
					</div>
					<div className="rounded-xl border border-[var(--border-divider)] bg-[var(--card-bg)] p-3">
						<span className="block text-[11px] text-[var(--text-muted)]">{t("mobile.certShaLabel")}</span>
						<span className="font-mono text-xs font-semibold text-[var(--text)] [overflow-wrap:anywhere]">
							{status?.certSha256 ?? "—"}
						</span>
					</div>
					<div className="flex items-center rounded-xl border border-[var(--border-divider)] bg-[var(--card-bg)] p-3">
						<PortEditor
							value={settings?.mobileIpv6Port ?? 7789}
							activePort={status?.ipv6Port}
							running={ipv6Running}
							disabled={busy !== null || !settings || !status}
							busy={busy === "ipv6Restart"}
							label={t("mobile.ipv6PortLabel")}
							onSave={saveIpv6Port}
						/>
					</div>
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
			</div>

			{/* Tunnel */}
			<div hidden={view !== "remote" || remote !== "tunnel"} className="space-y-3" data-field-id="mobileTunnel">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5">
						<span className="text-[13px] font-medium text-[var(--text)]">{t("mobile.remoteTunnel")}</span>
						<button
							type="button"
							className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-divider)] bg-[var(--well-bg)] text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
							onClick={() => setShowTunnelGuide((v) => !v)}
							title={t("mobile.usageTipsTitle")}
							aria-label={t("mobile.usageTipsTitle")}
						>
							<Info className="h-3 w-3" />
						</button>
					</div>
					<div className="flex items-center gap-2">
						<Chip tone={status?.tunnelUrl ? "success" : "neutral"}>{t(status?.tunnelUrl ? "mobile.tunnelConnectedChip" : "mobile.tunnelDisconnectedChip")}</Chip>
						<Button variant={tunnelMode === "off" ? "secondary" : "primary"} icon={Globe} loading={busy === "tunnel"}
							disabled={busy !== null || namedMissing || (tunnelMode !== "off" && cloudflaredMissing) || (!tunnelDirty && tunnelMode === "off" && !status?.tunnelUrl)}
							title={namedMissing ? t("mobile.errorNamedMissing") : undefined} onClick={applyTunnel}>
							{busy === "tunnel" ? t("mobile.btnTunnelProcessing") : tunnelButtonLabel}
						</Button>
					</div>
				</div>

				{showTunnelGuide && (
					<div className="rounded-lg border-l-2 border-[#0969da] bg-[var(--well-bg)] p-3 text-xs text-[var(--text-muted)]">
						<p>{t("mobile.cardTunnelFooter")}</p>
					</div>
				)}
				{status?.tunnelUrl && <UrlLine label={t("mobile.tunnelPublicUrlLabel")} url={status.tunnelUrl} />}
				<SettingRow
					stacked
					label={t("mobile.tunnelMethodLabel")}
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
						<div className="flex flex-wrap items-center gap-2">
							{tunnelDirty && tunnelSave.status === "idle" && (
								<Chip tone="warning">{t("mobile.unsavedChangesChip")}</Chip>
							)}
							<SaveIndicator status={tunnelSave.status} error={tunnelSave.error} />
						</div>
					</div>
				</SettingRow>
			</div>
			{/* Paired devices (Compact summary bar + expandable drawer) */}
			<section data-field-id="mobileDevices" className="border-t border-[var(--border-divider)] pt-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<h3 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
							{t("mobile.devicesTitle")}
							{devices !== null && <Chip tone="neutral">{devices.length}</Chip>}
						</h3>
						{devices && devices.length > 0 && devices[0].lastSeenAt && (
							<span className="text-xs text-[var(--text-muted)]">
								· {t("mobile.deviceLastSeen", { time: formatSyncTime(devices[0].lastSeenAt, locale) })}
							</span>
						)}
					</div>
					<div className="flex items-center gap-2">
						{devices && devices.length > 0 && (
							<Button size="sm" variant="ghost" onClick={() => setDevicesOpen((v) => !v)}>
								{devicesOpen ? t("mobile.collapseDevices") : t("mobile.manageDevices", { count: devices.length })}
							</Button>
						)}
						<Button size="sm" variant="secondary" icon={ShieldAlert} loading={busy === "revoke"} disabled={busy !== null || deviceBusy || !devices || devices.length === 0} onClick={revokeAll}>
							{t("mobile.btnRevokeAll")}
						</Button>
						<IconButton size="sm" icon={RefreshCw} label={t("mobile.btnRefreshStatus")} disabled={deviceBusy || busy !== null} onClick={() => void refreshDevices()} />
					</div>
				</div>

				{deviceListError && <Notice tone="danger"><span role="alert" className="whitespace-pre-wrap [overflow-wrap:anywhere]">{deviceListError}</span></Notice>}
				{devices === null ? !deviceListError && <p className="py-2 text-xs text-[var(--text-muted)]">{t("mobile.deviceLoading")}</p> : devices.length === 0 ? (
					<p className="py-2 text-xs text-[var(--text-muted)]">{t("mobile.devicesEmpty")}</p>
				) : (devices.length <= 2 || devicesOpen) ? (
					<div className="mt-2 max-h-60 overflow-y-auto space-y-2 pr-1">
						{devices.map((device) => (
							<div key={device.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border-divider)] bg-[var(--card-bg)] p-2.5">
								<div className="min-w-0 flex-1 space-y-1">
									<div className="font-medium text-sm text-[var(--text)] [overflow-wrap:anywhere]">{device.name}</div>
									<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
										<span>{t("mobile.deviceLastSeen", { time: device.lastSeenAt ? formatSyncTime(device.lastSeenAt, locale) : t("mobile.deviceNever") })}</span>
										<details className="min-w-0 open:basis-full">
											<summary className="cursor-pointer whitespace-nowrap">{t("mobile.deviceDetails")}</summary>
											<div className="space-y-1 pt-2 [overflow-wrap:anywhere]">
												<div>{t("mobile.deviceCreated", { time: formatSyncTime(device.createdAt, locale) })}</div>
												{device.userAgent && <div>{device.userAgent}</div>}
											</div>
										</details>
									</div>
								</div>
								<div className="flex gap-2">
									<Button size="sm" disabled={busy !== null || deviceBusy} onClick={() => { setDeviceName(device.name); setWorkError(null); setDeviceDialog({ type: "rename", device }); }}>{t("mobile.deviceRename")}</Button>
									<Button size="sm" disabled={busy !== null || deviceBusy} onClick={() => openRemove(device)}>{t("mobile.deviceRemove")}</Button>
								</div>
							</div>
						))}
					</div>
				) : null}
			</section>
			{deviceDialog && (
				<Modal title={t(deviceDialog.type === "rename" ? "mobile.deviceRenameTitle" : "mobile.removeDeviceTitle")} onClose={() => { if (!deviceBusy) setDeviceDialog(null); }}>
					<div className="space-y-3 px-4 py-3 text-sm text-[var(--text)]">
						{deviceDialog.type === "rename" ? (
							<label className="block space-y-1"><span>{t("mobile.deviceName")}</span><input className={`${INPUT_CLASS} w-full`} value={deviceName} disabled={deviceBusy} onChange={(e) => setDeviceName(e.target.value)} /></label>
						) : (
							<>
								<p>{t("mobile.removeDeviceBody")}</p>
								{deviceWork === null && !workError && <p>{t("mobile.deviceLoading")}</p>}
								{deviceWork && deviceWork.length > 0 && (
									<fieldset className="space-y-2">
										<legend className="mb-2">{t("mobile.removeDeviceWork")}</legend>
                                        {deviceWork.some((work) => work.kind === "session") && (
                                            <div className="space-y-1 text-xs text-[var(--text-muted)]">
                                                <p>{t("mobile.deviceSessionWorkContinues")}</p>
                                                {deviceWork.filter((work) => work.kind === "session").map((work) => <p key={work.id} className="[overflow-wrap:anywhere]">{work.title} · {t("mobile.deviceWorkManualStop")}</p>)}
                                            </div>
                                        )}
                                        {deviceWork.some((work) => work.kind === "terminal") && <>
                                            <label className="flex items-center gap-2"><input type="radio" name="device-work" checked={!stopWork} onChange={() => setStopWork(false)} />{t("mobile.keepDeviceWork")}</label>
                                            <label className="flex items-center gap-2"><input type="radio" name="device-work" checked={stopWork} onChange={() => setStopWork(true)} />{t("mobile.stopDeviceWork")}</label>
                                            {stopWork && <div className="space-y-2 pl-5"><p>{t("mobile.selectDeviceWork")}</p>{deviceWork.filter((work) => work.kind === "terminal").map((work) => (
                                                <label key={work.id} className="flex items-start gap-2"><input type="checkbox" checked={selectedWork.includes(work.id)} onChange={(e) => { const checked = e.target.checked; setSelectedWork((ids) => checked ? [...ids, work.id] : ids.filter((id) => id !== work.id)); }} /><span className="[overflow-wrap:anywhere]">{work.title}</span></label>
                                            ))}</div>}
                                        </>}
									</fieldset>
								)}
							</>
						)}
						{workError && <Notice tone="danger"><span role="alert" className="whitespace-pre-wrap [overflow-wrap:anywhere]">{workError}</span></Notice>}
					</div>
					<div className="flex justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
						<Button variant="ghost" disabled={deviceBusy} onClick={() => setDeviceDialog(null)}>{t("common.cancel")}</Button>
						<Button variant={deviceDialog.type === "remove" ? "danger" : "primary"} loading={deviceBusy}
							disabled={deviceBusy || (deviceDialog.type === "rename" ? !deviceName.trim() : deviceWork === null || (stopWork && selectedWork.length === 0))}
							onClick={async () => {
								setDeviceBusy(true);
								setWorkError(null);
								try {
									if (deviceDialog.type === "rename") await mobileRenameDevice(deviceDialog.device.id, deviceName.trim());
									else await mobileRevokeDevice(deviceDialog.device.id, stopWork ? selectedWork : []);
									setDeviceDialog(null);
									await refreshDevices();
								} catch (e) { setWorkError(errMsg(e)); }
								finally { setDeviceBusy(false); }
							}}>{t(deviceDialog.type === "rename" ? "common.save" : "mobile.deviceRemove")}</Button>
					</div>
				</Modal>
			)}


		</div>
	);
}
