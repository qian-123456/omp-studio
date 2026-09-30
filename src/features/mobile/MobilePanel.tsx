/**
 * [E] Pairing / tunnel panel (rendered inside SettingsPage, §11 E).
 * LAN server controls, QR pairing, cloudflared tunnel, device revocation.
 */
import {
	Copy,
	Globe,
	Loader2,
	Network,
	Power,
	QrCode,
	Save,
	ShieldAlert,
	Smartphone,
	X,
} from "lucide-react";
import { NativeSelect } from "../../components/NativeSelect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MobileStatus, PairingInfo } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import {
	mobileCreatePairing,
	mobileRevokeAll,
	mobileStart,
	mobileStatus,
	mobileStop,
	tunnelStart,
	tunnelStop,
} from "../../lib/ipc";
import { useSettings } from "../settings/store";
import { toast } from "../../lib/toast";
type PairTarget = "lan" | "tunnel";

export function MobilePanel() {
	const [status, setStatus] = useState<MobileStatus | null>(null);
	const settings = useSettings((s) => s.settings);
	const loadSettings = useSettings((s) => s.load);
	const [pairing, setPairing] = useState<PairingInfo | null>(null);
	const [pairTarget, setPairTarget] = useState<PairTarget>("lan");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [tunnelMode, setTunnelMode] = useState(settings?.tunnelMode ?? "off");
	const [tunnelName, setTunnelName] = useState(settings?.tunnelName ?? "");
	const [tunnelHost, setTunnelHost] = useState(settings?.tunnelHostname ?? "");
	const [port, setPort] = useState(String(settings?.mobilePort ?? 7788));
	const pairingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
	const [expiresIn, setExpiresIn] = useState(0);
	useEffect(() => {
		if (settings) {
			setTunnelMode(settings.tunnelMode);
			setTunnelName(settings.tunnelName ?? "");
			setTunnelHost(settings.tunnelHostname ?? "");
			setPort(String(settings.mobilePort));
		}
	}, [settings]);

	const refresh = useCallback(async () => {
		try {
			const [st] = await Promise.all([mobileStatus(), loadSettings()]);
			setStatus(st);
		} catch (e) {
			setError(String(e));
		}
	}, [loadSettings]);

	useEffect(() => {
		refresh();
		return () => {
			if (pairingTimer.current) clearInterval(pairingTimer.current);
		};
	}, [refresh]);

	// Countdown for the pairing code (5 min, one-time).
	useEffect(() => {
		if (pairingTimer.current) clearInterval(pairingTimer.current);
		if (!pairing) {
			setExpiresIn(0);
			return;
		}
		const tick = () => {
			const left = Math.max(
				0,
				Math.floor((Date.parse(pairing.expiresAt) - Date.now()) / 1000),
			);
			setExpiresIn(left);
			if (left === 0) setPairing(null);
		};
		tick();
		pairingTimer.current = setInterval(tick, 1000);
		return () => {
			if (pairingTimer.current) clearInterval(pairingTimer.current);
		};
	}, [pairing]);

	const run = async (label: string, fn: () => Promise<void>) => {
		setBusy(label);
		setError(null);
		setNotice(null);
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

	const toggleServer = () =>
		run("server", async () => {
			if (status?.running) {
				await mobileStop();
			} else {
				await mobileStart();
			}
			setPairing(null);
			await refresh();
		});

	const savePort = () =>
		run("port", async () => {
			if (!settings) return;
			const p = Number(port);
			if (!Number.isInteger(p) || p <= 0 || p > 65535) {
				setError("端口必须是 1-65535 的整数");
				toast.error("端口必须是 1-65535 的整数");
				return;
			}
			await useSettings.getState().update({ mobilePort: p });
			toast.success("端口已保存，重启服务后生效");
			setNotice("端口已保存，重启手机访问后生效");
			await refresh();
		});

	const makePairing = (viaTunnel: boolean) =>
		run("pair", async () => {
			const info = await mobileCreatePairing(viaTunnel);
			setPairing(info);
			setPairTarget(viaTunnel ? "tunnel" : "lan");
			toast.info("已生成配对二维码（5分钟内有效）");
		});

	const applyTunnel = () =>
		run("tunnel", async () => {
			if (!settings) return;
			if (tunnelMode === "named" && (!tunnelName.trim() || !tunnelHost.trim())) {
				setError("命名隧道需要同时填写隧道名称和公网域名");
				return;
			}
			// Persist all tunnel fields in one save (backend validates named mode).
			await useSettings.getState().update({
				tunnelMode,
				tunnelName: tunnelName.trim() || null,
				tunnelHostname: tunnelHost.trim() || null,
			});
			if (tunnelMode === "off") {
				await tunnelStop();
			} else {
				await tunnelStart();
			}
			await refresh();
		});

	const revokeAll = () =>
		run("revoke", async () => {
			const confirmed = await confirmDialog(
				"确定要撤销所有已配对设备吗？手机端将无法继续访问，需要重新扫码配对。",
				{
					danger: true,
					title: "撤销所有已配对设备",
					okLabel: "全部撤销",
				},
			);
			if (!confirmed) return;
			await mobileRevokeAll();
			toast.success("已撤销全部已配对设备");
			setNotice("已撤销全部设备，所有旧配对已失效");
		});

	const mm = Math.floor(expiresIn / 60);
	const ss = String(expiresIn % 60).padStart(2, "0");

	return (
		<section className="flex flex-col gap-4 text-xs">
			<div className="flex items-center justify-between border-b border-[var(--border-divider)] pb-3">
				<div className="flex items-center gap-2 text-xs font-medium text-neutral-300">
					<Smartphone className="h-4 w-4 text-amber-400" />
					<span>服务运行状态</span>
				</div>
				<span
					className={
						"rounded-full px-2.5 py-0.5 text-[11px] font-medium border " +
						(status?.running
							? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
							: "bg-[var(--bg-active-fill)] text-neutral-400 hairline")
					}
				>
					{status?.running ? "● 运行中" : "○ 已停止"}
				</span>
			</div>

			{error && (
				<div className="rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
					{error}
				</div>
			)}
			{notice && (
				<div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300">
					{notice}
				</div>
			)}

			{/* LAN server */}
			<div
				data-field-id="mobileLan"
				className="flex flex-col gap-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card transition-all"
			>
				<div className="flex items-center gap-1.5 font-medium text-neutral-300">
					<Network className="h-3.5 w-3.5 text-neutral-400" />
					<span>局域网直连 (LAN)</span>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<label className="text-neutral-400">端口号:</label>
					<input
						className="w-24 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none"
						value={port}
						onChange={(e) => setPort(e.target.value)}
						placeholder="7788"
					/>
					<button
						type="button"
						className="inline-flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-40"
						disabled={busy !== null}
						onClick={savePort}
					>
						<Save className="h-3.5 w-3.5" />
						<span>保存端口</span>
					</button>
				</div>
				{status?.lanUrl && (
					<div className="text-[11px] text-neutral-400">
						局域网地址: <code className="rounded bg-neutral-950 px-1.5 py-0.5 font-mono text-neutral-200">{status.lanUrl}</code>
					</div>
				)}
				<div className="flex flex-wrap gap-2 pt-1">
					<button
						type="button"
						className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all active:scale-95 disabled:opacity-40 ${
							status?.running
								? "border border-rose-800/40 bg-rose-950/20 text-rose-300 hover:bg-rose-950/40"
								: "bg-[#0A84FF] text-white hover:bg-[#0A84FF]/90 font-medium shadow-sm"
						}`}
						disabled={busy !== null}
						onClick={toggleServer}
					>
						{busy === "server" ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Power className="h-3.5 w-3.5" />
						)}
						<span>{status?.running ? "停止服务" : "启动服务"}</span>
					</button>
					<button
						type="button"
						className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-40"
						disabled={busy !== null || !status?.running}
						onClick={() => makePairing(false)}
					>
						<QrCode className="h-3.5 w-3.5 text-amber-400" />
						<span>生成局域网配对码</span>
					</button>
				</div>
			</div>
			{/* Tunnel */}
			<div
				data-field-id="mobileTunnel"
				className="flex flex-col gap-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card transition-all"
			>
				<div className="flex items-center gap-1.5 font-medium text-neutral-300">
					<Globe className="h-3.5 w-3.5 text-neutral-400" />
					<span>Cloudflare Tunnel 公网隧道</span>
				</div>
				{status && !status.cloudflaredInstalled && (
					<div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
						未检测到 cloudflared 二进制：建议执行 <code className="font-mono bg-[var(--well-bg)] px-1 rounded">brew install cloudflared</code> 安装
					</div>
				)}
				<NativeSelect
					value={tunnelMode}
					onChange={(e) => setTunnelMode(e.target.value)}
				>
					<option value="off">关闭隧道 (仅局域网)</option>
					<option value="quick">临时隧道（trycloudflare - 免配置）</option>
					<option value="named">命名隧道（指定固定公网域名）</option>
				</NativeSelect>
				{tunnelMode === "named" && (
					<div className="grid grid-cols-2 gap-2">
						<input
							className="rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none"
							placeholder="隧道名称 (tunnel name)"
							value={tunnelName}
							onChange={(e) => setTunnelName(e.target.value)}
						/>
						<input
							className="rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none"
							placeholder="公网域名 (例如 ws.example.com)"
							value={tunnelHost}
							onChange={(e) => setTunnelHost(e.target.value)}
						/>
					</div>
				)}
				{status?.tunnelUrl && (
					<div className="text-[11px] text-neutral-400">
						公网可访问地址:{" "}
						<code className="rounded bg-neutral-950 px-1.5 py-0.5 font-mono text-neutral-200">{status.tunnelUrl}</code>
					</div>
				)}
				<div className="flex flex-wrap gap-2 pt-1">
					<button
						type="button"
						className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-40"
						disabled={busy !== null}
						onClick={applyTunnel}
					>
						{busy === "tunnel" ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Globe className="h-3.5 w-3.5" />
						)}
						<span>{tunnelMode === "off" ? "保存并停止隧道" : "保存并启动隧道"}</span>
					</button>
					<button
						type="button"
						className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-40"
						disabled={busy !== null || !status?.tunnelUrl}
						onClick={() => makePairing(true)}
					>
						<QrCode className="h-3.5 w-3.5 text-amber-400" />
						<span>生成公网配对码</span>
					</button>
				</div>
				<div className="text-[11px] leading-4 text-neutral-500">
					有域名建议绑子域名并配置 Cloudflare Access；无域名可使用试用临时隧道快速体验。
				</div>
			</div>

			{/* Pairing QR */}
			{pairing && (
				<div className="flex flex-col items-center gap-3 rounded-2xl vibrancy-popover shadow-apple-modal hairline p-4">
					<div className="flex w-full items-center justify-between border-b border-[var(--border-divider)] pb-2">
						<span className="text-xs font-medium text-neutral-300">
							{pairTarget === "tunnel" ? "公网隧道" : "局域网"}配对码 · <span className="tabular-nums font-mono">{mm}:{ss}</span> 后过期
						</span>
						<button
							type="button"
							onClick={() => setPairing(null)}
							className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
							title="关闭二维码"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
					<div
						className="rounded-lg bg-white p-3 [&_svg]:h-44 [&_svg]:w-44"
						// Backend-generated SVG QR (qrcode crate), not user content.
						dangerouslySetInnerHTML={{ __html: pairing.qrSvg }}
					/>
					<div className="flex w-full items-center gap-2 rounded-lg hairline bg-[var(--well-bg)] p-2">
						<code className="flex-1 break-all text-[11px] font-mono text-neutral-300">
							{pairing.url}
						</code>
						<button
							type="button"
							onClick={async () => {
								await copyText(pairing.url);
								toast.success("配对链接已复制到剪贴板");
							}}
							className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
							title="复制配对链接"
						>
							<Copy className="h-3.5 w-3.5" />
							<span>复制链接</span>
						</button>
					</div>
				</div>
			)}
			{/* Paired Devices & Access Control */}
			<div
				data-field-id="mobileDevices"
				className="flex flex-col gap-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card transition-all"
			>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Smartphone className="h-4 w-4 text-amber-400" />
						<span className="text-xs font-semibold text-neutral-200">
							已配对设备与访问控制
						</span>
					</div>
					<span className="rounded-full bg-[var(--bg-active-fill)] hairline px-2 py-0.5 text-[10px] text-neutral-400">
						{status?.running ? "访问凭据生效中" : "服务已停止"}
					</span>
				</div>
				<div className="rounded-lg bg-neutral-950/60 p-2.5 text-[11px] leading-relaxed text-neutral-400 border border-neutral-800/60">
					<div className="font-medium text-neutral-300">设备授权模式说明：</div>
					<p>
						当前移动端访问采用全局凭据授权机制。受限于现有底层后端接口，应用暂不支持单独罗列已连接的各台移动设备详情或针对单台客户端分别解绑。
					</p>
					<p className="mt-1">
						如需阻止历史配对设备继续访问，可随时点击下方按钮一键撤销全部已发放的授权凭据。
					</p>
				</div>
				<div>
					<button
						type="button"
						className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800/40 bg-rose-950/20 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-950/40 active:scale-95 transition-all disabled:opacity-40"
						disabled={busy !== null}
						onClick={revokeAll}
					>
						<ShieldAlert className="h-3.5 w-3.5" />
						<span>撤销全部已配对设备凭据</span>
					</button>
				</div>
			</div>
		</section>
	);
}
