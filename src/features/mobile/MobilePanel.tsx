/**
 * [E] Pairing / tunnel panel (rendered inside Settings ▸ 手机访问, §11 E).
 * LAN server controls, QR pairing, cloudflared tunnel, device revocation.
 */
import { Copy, Globe, Loader2, Power, QrCode, RefreshCw, RotateCcw, ShieldAlert, X } from "lucide-react";
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
import {
	CommitInput,
	INPUT_CLASS,
	SETTINGS_BUTTON_CLASS,
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

const TARGET_LABELS: Record<PairingTarget, string> = {
	lan: "局域网",
	tunnel: "公网",
	ipv6: "IPv6",
};

const TUNNEL_MODES: { value: TunnelMode; label: string; explain: string }[] = [
	{ value: "off", label: "关闭", explain: "只能在同一个 Wi-Fi / 局域网内用手机访问，最安全。" },
	{
		value: "quick",
		label: "临时公网地址",
		explain:
			"不需要任何配置，自动分配一个 trycloudflare.com 的随机网址，出门在外也能访问；每次启动网址都会变，适合临时使用。",
	},
	{
		value: "named",
		label: "固定域名",
		explain:
			"使用你在 Cloudflare 上已经建好的隧道和自己的域名，网址固定不变。需要先用 cloudflared 创建隧道，建议同时配置 Cloudflare Access 保护。",
	},
];

const PRIMARY_BTN =
	"inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40";
const DANGER_BTN =
	"inline-flex items-center gap-1.5 rounded-lg border border-rose-800/40 bg-rose-950/20 px-3 py-1.5 text-xs font-medium text-rose-300 transition-all hover:bg-rose-950/40 active:scale-95 disabled:opacity-40";

function asMode(v: string | undefined | null): TunnelMode {
	return v === "quick" || v === "named" ? v : "off";
}

function validatePort(v: string): string | null {
	const n = Number(v);
	return /^\d+$/.test(v) && Number.isInteger(n) && n >= 1 && n <= 65535 ? null : "端口需要是 1–65535 之间的整数";
}

function formatSyncTime(iso: string | null | undefined): string {
	if (!iso) return "从未同步";
	try {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleString("zh-CN", {
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

function UrlLine({ label, url }: { label: string; url: string }) {
	return (
		<div className="flex items-center gap-2 text-[11px] text-neutral-400">
			<span className="shrink-0">{label}</span>
			<code className="min-w-0 flex-1 truncate rounded bg-[var(--well-bg)] px-1.5 py-0.5 font-mono text-neutral-200">
				{url}
			</code>
			<button
				type="button"
				onClick={async () => {
					await copyText(url);
					toast.success("地址已复制");
				}}
				className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
				title="复制地址"
				aria-label={`复制${label}`}
			>
				<Copy className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}

export function MobilePanel() {
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
				toast.info("手机访问已停止，已配对的手机暂时无法连接");
			} else {
				await mobileStart();
				toast.success("手机访问已启动");
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
			toast.success("已用新端口重新启动");
			await refresh();
		});

	const ipv6Running = status?.ipv6Running ?? false;

	const toggleIpv6 = () =>
		run("ipv6Server", async () => {
			if (ipv6Running) {
				await mobileIpv6Stop();
				if (pairTarget === "ipv6") setPairing(null);
				toast.info("IPv6 直连已停止");
			} else {
				await mobileIpv6Start();
				toast.success("IPv6 直连已启动");
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
			toast.success("已用新端口重新启动 IPv6 直连");
			await refresh();
		});

	const saveDdnsToken = () =>
		run("ddnsToken", async () => {
			const token = ddnsTokenDraft.trim();
			if (!token) return;
			const nextDdns = await mobileDdnsSetToken(token);
			setDdnsTokenDraft("");
			setStatus((prev) => (prev ? { ...prev, ddns: nextDdns } : prev));
			toast.success("Cloudflare API 令牌已保存并验证");
			await refresh();
		});

	const clearDdnsToken = () =>
		run("ddnsClear", async () => {
			const nextDdns = await mobileDdnsClearToken();
			setDdnsTokenDraft("");
			setStatus((prev) => (prev ? { ...prev, ddns: nextDdns } : prev));
			toast.info("Cloudflare API 令牌已清除");
			await refresh();
		});

	const syncDdns = () =>
		run("ddnsSync", async () => {
			const nextDdns = await mobileDdnsSync();
			setStatus((prev) => (prev ? { ...prev, ddns: nextDdns } : prev));
			toast.success("DDNS 记录已同步");
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
				setError("固定域名模式需要同时填写隧道名称和域名");
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
				toast.info("公网访问已关闭");
			} else {
				await tunnelStart();
				toast.success("公网隧道已启动");
			}
			await refresh();
		});

	const revokeAll = () =>
		run("revoke", async () => {
			const confirmed = await confirmDialog(
				"所有已经配对过的手机都会立刻断开，之后需要重新扫码才能使用。确定继续吗？",
				{ danger: true, title: "让所有手机重新配对", okLabel: "全部撤销" },
			);
			if (!confirmed) return;
			await mobileRevokeAll();
			setPairing(null);
			toast.success("已撤销，所有手机需要重新扫码配对");
		});

	const mm = Math.floor(expiresIn / 60);
	const ss = String(expiresIn % 60).padStart(2, "0");
	const expired = pairing != null && expiresIn === 0;
	const modeInfo = TUNNEL_MODES.find((m) => m.value === tunnelMode) ?? TUNNEL_MODES[0];
	const tunnelButtonLabel =
		tunnelMode === "off" ? (status?.tunnelUrl ? "关闭公网访问" : "保存") : status?.tunnelUrl ? "保存并重新连接" : "保存并启动隧道";

	return (
		<div className="space-y-6">
			{error && (
				<div className="flex items-start justify-between gap-2 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
					<span>{error}</span>
					<button type="button" onClick={() => setError(null)} aria-label="关闭错误提示" className="shrink-0">
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}

			{/* LAN server */}
			<SettingsCard title="手机访问服务" fieldId="mobileLan">
				<SettingRow
					label={
						<span className="flex items-center gap-2">
							手机访问
							<span
								className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
									running
										? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
										: "hairline bg-[var(--bg-active-fill)] text-neutral-400"
								}`}
							>
								{status == null ? "检测中…" : running ? "● 运行中" : "○ 已停止"}
							</span>
						</span>
					}
					description={
						running
							? "手机可以连接到这台电脑；不用时可以停止"
							: "启动后，同一 Wi-Fi 下的手机扫码即可查看会话、处理审批"
					}
					control={
						<button
							type="button"
							className={running ? DANGER_BTN : PRIMARY_BTN}
							disabled={busy !== null || status == null}
							onClick={toggleServer}
						>
							{busy === "server" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
							<span>{busy === "server" ? (running ? "正在停止…" : "正在启动…") : running ? "停止" : "启动"}</span>
						</button>
					}
				>
					{running && status?.lanUrl && <UrlLine label="局域网地址" url={status.lanUrl} />}
				</SettingRow>
				<SettingRow
					label="端口"
					description="手机连接用的端口号，一般不需要改；和其他程序冲突导致启动失败时再换一个"
					hint="范围 1–65535，默认 7788"
					control={
						<CommitInput
							type="number"
							min={1}
							max={65535}
							className="w-28"
							aria-label="手机访问端口"
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
						<div className="flex items-center justify-between gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-300">
							<span>新端口已保存，需要重启服务后才会生效</span>
							<button type="button" className={SETTINGS_BUTTON_CLASS} disabled={busy !== null} onClick={restartServer}>
								{busy === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
								<span>立即重启</span>
							</button>
						</div>
					)}
				</SettingRow>
				<SettingRow
					label="配对手机（局域网）"
					description={running ? "生成二维码，用手机相机扫一下即可连接（5 分钟内有效，只能用一次）" : "需要先启动上面的「手机访问」"}
					control={
						<button
							type="button"
							className={SETTINGS_BUTTON_CLASS}
							disabled={busy !== null || !running}
							title={running ? undefined : "请先启动手机访问"}
							onClick={() => makePairing("lan")}
						>
							{busy === "pair" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<QrCode className="h-3.5 w-3.5 text-amber-400" />
							)}
							<span>生成配对二维码</span>
						</button>
					}
				/>
			</SettingsCard>

			{/* IPv6 direct */}
			<SettingsCard
				title="IPv6 直连"
				fieldId="mobileIpv6"
				footer="利用公网 IPv6 无 NAT 特性，让手机在蜂窝移动网络（4G/5G）下直接连接这台电脑，无需第三方服务器中转。"
			>
				<SettingRow
					label={
						<span className="flex items-center gap-2">
							IPv6 直连
							<span
								className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
									ipv6Running
										? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
										: "hairline bg-[var(--bg-active-fill)] text-neutral-400"
								}`}
							>
								{status == null ? "检测中…" : ipv6Running ? "● 运行中" : "○ 已停止"}
							</span>
						</span>
					}
					description={
						ipv6Running
							? "已开启公网 IPv6 上的 HTTPS 服务，手机通过流量可直连"
							: "启动后将在公网 IPv6 地址上开启 HTTPS 服务；首次使用请阅读下方使用提示"
					}
					control={
						<button
							type="button"
							className={ipv6Running ? DANGER_BTN : PRIMARY_BTN}
							disabled={busy !== null || status == null}
							onClick={toggleIpv6}
						>
							{busy === "ipv6Server" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Power className="h-3.5 w-3.5" />
							)}
							<span>
								{busy === "ipv6Server"
									? ipv6Running
										? "正在停止…"
										: "正在启动…"
									: ipv6Running
									? "停止"
									: "启动"}
							</span>
						</button>
					}
				>
					<div className="space-y-2">
						{status?.ipv6Address ? (
							<div className="flex items-center gap-2 text-[11px] text-neutral-400">
								<span className="shrink-0">公网 IPv6 地址</span>
								<code className="min-w-0 flex-1 truncate rounded bg-[var(--well-bg)] px-1.5 py-0.5 font-mono text-neutral-200">
									{status.ipv6Address}
								</code>
								<button
									type="button"
									onClick={async () => {
										await copyText(status.ipv6Address!);
										toast.success("IPv6 地址已复制");
									}}
									className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
									title="复制 IPv6 地址"
									aria-label="复制 IPv6 地址"
								>
									<Copy className="h-3.5 w-3.5" />
								</button>
							</div>
						) : (
							<div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
								本机没有公网 IPv6 地址
							</div>
						)}
						{ipv6Running && status?.ipv6Url && <UrlLine label="IPv6 访问链接" url={status.ipv6Url} />}
						{status?.certSha256 && (
							<div className="flex items-center gap-2 text-[11px] text-neutral-400">
								<span className="shrink-0">证书 SHA-256 指纹</span>
								<code className="min-w-0 flex-1 truncate rounded bg-[var(--well-bg)] px-1.5 py-0.5 font-mono text-neutral-200">
									{status.certSha256}
								</code>
								<button
									type="button"
									onClick={async () => {
										await copyText(status.certSha256!);
										toast.success("证书指纹已复制");
									}}
									className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
									title="复制证书指纹"
									aria-label="复制证书指纹"
								>
									<Copy className="h-3.5 w-3.5" />
								</button>
							</div>
						)}
					</div>
				</SettingRow>
				<SettingRow
					label="IPv6 端口"
					description="IPv6 直连使用的端口号，默认 7789；路由器防火墙需放行该端口的入站连接"
					hint="范围 1–65535，默认 7789"
					control={
						<CommitInput
							type="number"
							min={1}
							max={65535}
							className="w-28"
							aria-label="IPv6 访问端口"
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
						<div className="flex items-center justify-between gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-300">
							<span>新端口已保存，需要重启 IPv6 直连后生效</span>
							<button
								type="button"
								className={SETTINGS_BUTTON_CLASS}
								disabled={busy !== null}
								onClick={restartIpv6}
							>
								{busy === "ipv6Restart" ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<RotateCcw className="h-3.5 w-3.5" />
								)}
								<span>立即重启</span>
							</button>
						</div>
					)}
				</SettingRow>
				<SettingRow
					label="配对手机（IPv6 直连）"
					description={
						ipv6Running
							? "生成二维码，用手机相机扫一下即可通过 IPv6 直连（5 分钟内有效，只能用一次）"
							: "需要先启动上面的「IPv6 直连」"
					}
					control={
						<button
							type="button"
							className={SETTINGS_BUTTON_CLASS}
							disabled={busy !== null || !ipv6Running || !status?.ipv6Url}
							title={
								!ipv6Running
									? "请先启动 IPv6 直连"
									: !status?.ipv6Url
									? "未检测到可用的 IPv6 访问地址"
									: undefined
							}
							onClick={() => makePairing("ipv6")}
						>
							{busy === "pair" && pairTarget === "ipv6" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<QrCode className="h-3.5 w-3.5 text-amber-400" />
							)}
							<span>生成 IPv6 配对二维码</span>
						</button>
					}
				/>
				<div className="rounded-lg hairline bg-[var(--well-bg)] p-3 text-[11px] leading-relaxed text-neutral-400 space-y-1.5">
					<div className="font-medium text-neutral-300">使用提示：</div>
					<ul className="list-disc list-inside space-y-1 text-neutral-400">
						<li>路由器需放行该端口的 IPv6 入站</li>
						<li>首次打开会提示证书不受信任, 核对指纹一致后继续</li>
						<li>用手机流量(关闭 Wi-Fi)测试</li>
						<li>地址变化后重新扫码配对, 或启用 DDNS</li>
					</ul>
				</div>
				{/* DDNS subsection */}
				<SettingRow
					stacked
					label={
						<span className="flex items-center gap-2">
							Cloudflare DDNS 动态域名
							{settings?.ddnsEnabled && (
								<span
									className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
										status?.ddns?.halted
											? "border-amber-500/30 bg-amber-500/15 text-amber-300"
											: status?.ddns?.lastError
											? "border-rose-500/30 bg-rose-500/15 text-rose-300"
											: status?.ddns?.lastIp
											? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
											: "hairline bg-[var(--bg-active-fill)] text-neutral-400"
									}`}
								>
									{status?.ddns?.halted
										? "● 已暂停"
										: status?.ddns?.lastError
										? "● 错误"
										: status?.ddns?.lastIp
										? "● 已同步"
										: "○ 未同步"}
								</span>
							)}
						</span>
					}
					description="公网 IPv6 地址发生变化时，自动更新 Cloudflare 上的 AAAA 解析记录，配合自己的域名保持访问不中断。"
					control={
						<Switch
							checked={settings?.ddnsEnabled ?? false}
							disabled={busy !== null}
							ariaLabel="启用 Cloudflare DDNS"
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
								<label className="space-y-1 text-[11px] text-neutral-400">
									<span>Zone ID</span>
									<CommitInput
										aria-label="Cloudflare Zone ID"
										placeholder="例如 023e105f4ecef8ad9ca31a8372d0c353"
										value={settings?.ddnsZoneId ?? ""}
										onCommit={async (v) => {
											await save({ ddnsZoneId: v.trim() || null });
											await refresh();
										}}
									/>
								</label>
								<label className="space-y-1 text-[11px] text-neutral-400">
									<span>解析域名 (AAAA)</span>
									<CommitInput
										aria-label="DDNS 域名"
										placeholder="例如 home.example.com"
										value={settings?.ddnsHostname ?? ""}
										onCommit={async (v) => {
											await save({ ddnsHostname: v.trim() || null });
											await refresh();
										}}
									/>
								</label>
							</div>

							<div className="space-y-1 text-[11px] text-neutral-400">
								<div className="flex items-center justify-between">
									<span>Cloudflare API 令牌</span>
									{status?.ddns?.tokenSet && (
										<span className="rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
											● 已保存
										</span>
									)}
								</div>
								<div className="flex gap-2">
									<input
										type="password"
										className={INPUT_CLASS}
										placeholder={
											status?.ddns?.tokenSet
												? "••••••••••••••••（已保存，输入新令牌以覆盖）"
												: "输入具备 Zone:DNS:Edit 权限的 API 令牌"
										}
										value={ddnsTokenDraft}
										onChange={(e) => setDdnsTokenDraft(e.target.value)}
									/>
									<button
										type="button"
										className={PRIMARY_BTN}
										disabled={busy !== null || !ddnsTokenDraft.trim()}
										onClick={saveDdnsToken}
									>
										{busy === "ddnsToken" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
										<span>保存令牌</span>
									</button>
									{status?.ddns?.tokenSet && (
										<button
											type="button"
											className={SETTINGS_BUTTON_CLASS}
											disabled={busy !== null}
											onClick={clearDdnsToken}
										>
											{busy === "ddnsClear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
											<span>清除令牌</span>
										</button>
									)}
								</div>
								<p className="text-[10px] text-neutral-500">
									令牌安全存储在本地加密保管库中，仅用于更新 AAAA 记录，绝不会明文回显。
								</p>
							</div>

							{status?.ddns?.halted && (
								<div className="flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-300">
									<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
									<div>
										<div className="font-medium">自动同步已暂停</div>
										<div className="text-amber-300/80">
											遇到鉴权失败或连续同步错误已暂停自动更新。请检查 API 令牌与配置后，点击「立即同步」重试并恢复自动调度。
										</div>
									</div>
								</div>
							)}

							{status?.ddns?.lastError && !status?.ddns?.halted && (
								<div className="rounded-lg border border-rose-900/50 bg-rose-950/20 p-2 text-[11px] text-rose-300">
									最近同步错误: {status.ddns.lastError}
								</div>
							)}

							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-divider)] pt-2 text-[11px] text-neutral-400">
								<div className="flex flex-wrap items-center gap-3">
									<span>上次同步: {formatSyncTime(status?.ddns?.lastSyncAt)}</span>
									<span>
										上次解析 IP:{" "}
										<code className="rounded bg-[var(--well-bg)] px-1 font-mono text-neutral-300">
											{status?.ddns?.lastIp ?? "无"}
										</code>
									</span>
								</div>
								<button
									type="button"
									className={SETTINGS_BUTTON_CLASS}
									disabled={
										busy !== null ||
										!status?.ddns?.tokenSet ||
										!settings?.ddnsZoneId ||
										!settings?.ddnsHostname
									}
									title={
										!status?.ddns?.tokenSet
											? "请先保存 API 令牌"
											: !settings?.ddnsZoneId || !settings?.ddnsHostname
											? "请先填写 Zone ID 和域名"
											: undefined
									}
									onClick={syncDdns}
								>
									<RefreshCw className={`h-3.5 w-3.5 ${busy === "ddnsSync" ? "animate-spin" : ""}`} />
									<span>立即同步</span>
								</button>
							</div>
						</div>
					)}
				</SettingRow>
			</SettingsCard>

			{/* Tunnel */}
			<SettingsCard
				title="不在同一网络时访问（公网隧道）"
				fieldId="mobileTunnel"
				footer="公网隧道通过 Cloudflare 免费服务转发，手机用 4G/5G 或其他 Wi-Fi 也能访问。仍然需要扫码配对，陌生人无法直接使用。"
			>
				<SettingRow
					stacked
					label={
						<span className="flex items-center gap-2">
							访问方式
							{status?.tunnelUrl ? (
								<span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
									● 已连接
								</span>
							) : savedMode !== "off" ? (
								<span className="rounded-full hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] text-neutral-400">
									○ 未连接
								</span>
							) : null}
						</span>
					}
					description={modeInfo.explain}
					control={
						<Segmented
							size="sm"
							aria-label="公网访问方式"
							value={tunnelMode}
							onChange={setTunnelMode}
							disabled={busy !== null}
							options={TUNNEL_MODES.map((m) => ({ value: m.value, label: m.label }))}
						/>
					}
				>
					<div className="space-y-2.5">
						{cloudflaredMissing && tunnelMode !== "off" && (
							<div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-300">
								需要先安装 Cloudflare 的小工具 cloudflared：在「终端」里运行{" "}
								<code className="rounded bg-[var(--well-bg)] px-1 font-mono">brew install cloudflared</code>
								，装好后点右侧「刷新状态」。
							</div>
						)}
						{tunnelMode === "named" && (
							<div className="grid grid-cols-2 gap-2">
								<label className="space-y-1 text-[11px] text-neutral-400">
									<span>隧道名称</span>
									<input
										className={INPUT_CLASS}
										placeholder="例如 omp-mobile"
										value={tunnelName}
										onChange={(e) => setTunnelName(e.target.value)}
									/>
								</label>
								<label className="space-y-1 text-[11px] text-neutral-400">
									<span>域名</span>
									<input
										className={INPUT_CLASS}
										placeholder="例如 omp.example.com"
										value={tunnelHost}
										onChange={(e) => setTunnelHost(e.target.value)}
									/>
								</label>
							</div>
						)}
						{status?.tunnelUrl && <UrlLine label="公网地址" url={status.tunnelUrl} />}
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								className={tunnelMode === "off" ? SETTINGS_BUTTON_CLASS : PRIMARY_BTN}
								disabled={
									busy !== null ||
									namedMissing ||
									(tunnelMode !== "off" && cloudflaredMissing) ||
									(!tunnelDirty && tunnelMode === "off" && !status?.tunnelUrl)
								}
								title={namedMissing ? "请先填写隧道名称和域名" : undefined}
								onClick={applyTunnel}
							>
								{busy === "tunnel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
								<span>{busy === "tunnel" ? "正在处理…" : tunnelButtonLabel}</span>
							</button>
							<button
								type="button"
								className={SETTINGS_BUTTON_CLASS}
								disabled={busy !== null}
								onClick={() => run("refresh", refresh)}
								title="临时公网地址可能需要几秒才会出现"
							>
								<RefreshCw className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />
								<span>刷新状态</span>
							</button>
							<button
								type="button"
								className={SETTINGS_BUTTON_CLASS}
								disabled={busy !== null || !status?.tunnelUrl}
								title={status?.tunnelUrl ? undefined : "公网隧道连接成功后才能生成"}
								onClick={() => makePairing("tunnel")}
							>
								<QrCode className="h-3.5 w-3.5 text-amber-400" />
								<span>生成公网配对二维码</span>
							</button>
							{tunnelDirty && tunnelSave.status === "idle" && (
								<span className="text-[11px] text-amber-300/90">有未保存的修改</span>
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
						<span className="text-xs font-medium text-neutral-200">
							{TARGET_LABELS[pairTarget]}配对二维码 ·{" "}
							{expired ? (
								<span className="text-rose-300">已过期</span>
							) : (
								<span className={`font-mono tabular-nums ${expiresIn <= 30 ? "text-amber-300" : "text-neutral-400"}`}>
									{mm}:{ss} 后失效
								</span>
							)}
						</span>
						<button
							type="button"
							onClick={() => setPairing(null)}
							className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
							title="关闭二维码"
							aria-label="关闭二维码"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
					<div className="relative">
						<div
							className={`rounded-lg bg-white p-3 [&_svg]:h-44 [&_svg]:w-44 ${expired ? "opacity-20 blur-[2px]" : ""}`}
							// Backend-generated SVG QR (qrcode crate), not user content.
							dangerouslySetInnerHTML={{ __html: pairing.qrSvg }}
						/>
						{expired && (
							<div className="absolute inset-0 flex items-center justify-center">
								<button
									type="button"
									className={PRIMARY_BTN}
									disabled={busy !== null}
									onClick={() => makePairing(pairTarget)}
								>
									<RefreshCw className="h-3.5 w-3.5" />
									<span>重新生成</span>
								</button>
							</div>
						)}
					</div>
					<p className="text-center text-[11px] text-neutral-400">
						{expired
							? "二维码已失效，请重新生成"
							: "用手机相机或微信扫一扫打开链接，在手机浏览器中完成配对。每个二维码只能用一次。"}
					</p>
					{!expired && (
						<div className="flex w-full items-center gap-2 rounded-lg hairline bg-[var(--well-bg)] p-2">
							<code className="flex-1 break-all font-mono text-[11px] text-neutral-300">{pairing.url}</code>
							<button
								type="button"
								onClick={async () => {
									await copyText(pairing.url);
									toast.success("配对链接已复制，可发到手机上打开");
								}}
								className={SETTINGS_BUTTON_CLASS}
								title="复制配对链接"
							>
								<Copy className="h-3.5 w-3.5" />
								<span>复制链接</span>
							</button>
						</div>
					)}
				</div>
			)}

			{/* Paired devices */}
			<SettingsCard title="已配对的手机" fieldId="mobileDevices">
				<SettingRow
					danger
					label="撤销所有手机的访问权限"
					description="手机丢失、或不想再让某台手机访问时使用。目前无法单独移除某一台，只能全部撤销后让需要的手机重新扫码。"
					control={
						<button type="button" className={DANGER_BTN} disabled={busy !== null} onClick={revokeAll}>
							{busy === "revoke" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
							<span>全部撤销</span>
						</button>
					}
				/>
			</SettingsCard>
		</div>
	);
}
