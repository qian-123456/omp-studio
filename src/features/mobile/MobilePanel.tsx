/**
 * [E] Pairing / tunnel panel (rendered inside SettingsPage, §11 E).
 * LAN server controls, QR pairing, cloudflared tunnel, device revocation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MobileStatus, PairingInfo, Settings } from "../../lib/contracts";
import {
	getSettings,
	installStatusExtensionGlobally,
	mobileCreatePairing,
	mobileRevokeAll,
	mobileStart,
	mobileStatus,
	mobileStop,
	saveSettings,
	tunnelStart,
	tunnelStop,
} from "../../lib/ipc";

type PairTarget = "lan" | "tunnel";

export function MobilePanel() {
	const [status, setStatus] = useState<MobileStatus | null>(null);
	const [settings, setSettings] = useState<Settings | null>(null);
	const [pairing, setPairing] = useState<PairingInfo | null>(null);
	const [pairTarget, setPairTarget] = useState<PairTarget>("lan");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [tunnelMode, setTunnelMode] = useState("off");
	const [tunnelName, setTunnelName] = useState("");
	const [tunnelHost, setTunnelHost] = useState("");
	const [port, setPort] = useState("7788");
	const pairingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
	const [expiresIn, setExpiresIn] = useState(0);

	const refresh = useCallback(async () => {
		try {
			const [st, se] = await Promise.all([mobileStatus(), getSettings()]);
			setStatus(st);
			setSettings(se);
			setTunnelMode(se.tunnelMode);
			setTunnelName(se.tunnelName ?? "");
			setTunnelHost(se.tunnelHostname ?? "");
			setPort(String(se.mobilePort));
		} catch (e) {
			setError(String(e));
		}
	}, []);

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
			setError(String(e));
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
				return;
			}
			await saveSettings({ ...settings, mobilePort: p });
			setNotice("端口已保存，重启手机访问后生效");
			await refresh();
		});

	const makePairing = (viaTunnel: boolean) =>
		run("pair", async () => {
			const info = await mobileCreatePairing(viaTunnel);
			setPairing(info);
			setPairTarget(viaTunnel ? "tunnel" : "lan");
		});

	const applyTunnel = () =>
		run("tunnel", async () => {
			if (!settings) return;
			if (tunnelMode === "named" && (!tunnelName.trim() || !tunnelHost.trim())) {
				setError("命名隧道需要同时填写隧道名称和公网域名");
				return;
			}
			// Persist all tunnel fields in one save (backend validates named mode).
			const next: Settings = {
				...settings,
				tunnelMode,
				tunnelName: tunnelName.trim() || null,
				tunnelHostname: tunnelHost.trim() || null,
			};
			await saveSettings(next);
			if (tunnelMode === "off") {
				await tunnelStop();
			} else {
				await tunnelStart();
			}
			await refresh();
		});

	const revokeAll = () =>
		run("revoke", async () => {
			if (!window.confirm("撤销所有已配对设备？手机端需要重新扫码配对。")) return;
			await mobileRevokeAll();
			setNotice("已撤销全部设备");
		});

	const installExt = () =>
		run("ext", async () => {
			const path = await installStatusExtensionGlobally();
			setNotice(`已安装到 ${path}`);
		});

	const mm = Math.floor(expiresIn / 60);
	const ss = String(expiresIn % 60).padStart(2, "0");

	return (
		<section className="flex flex-col gap-4 p-4 text-sm">
			<header className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-neutral-200">手机访问</h2>
				<span
					className={
						"rounded px-2 py-0.5 text-xs " +
						(status?.running
							? "bg-emerald-900/50 text-emerald-300"
							: "bg-neutral-800 text-neutral-400")
					}
				>
					{status?.running ? "运行中" : "已停止"}
				</span>
			</header>

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
			<div className="flex flex-col gap-2 rounded border border-neutral-800 p-3">
				<div className="text-xs font-medium text-neutral-400">局域网直连</div>
				<div className="flex items-center gap-2">
					<label className="text-xs text-neutral-400">端口</label>
					<input
						className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
						value={port}
						onChange={(e) => setPort(e.target.value)}
					/>
					<button
						className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
						disabled={busy !== null}
						onClick={savePort}
					>
						保存端口
					</button>
				</div>
				{status?.lanUrl && (
					<div className="text-xs text-neutral-400">
						地址 <code className="text-neutral-200">{status.lanUrl}</code>
					</div>
				)}
				<div className="flex gap-2">
					<button
						className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
						disabled={busy !== null}
						onClick={toggleServer}
					>
						{status?.running ? "停止服务" : "启动服务"}
					</button>
					<button
						className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-40"
						disabled={busy !== null || !status?.running}
						onClick={() => makePairing(false)}
					>
						生成配对二维码
					</button>
				</div>
			</div>

			{/* Tunnel */}
			<div className="flex flex-col gap-2 rounded border border-neutral-800 p-3">
				<div className="text-xs font-medium text-neutral-400">
					Cloudflare Tunnel
				</div>
				{status && !status.cloudflaredInstalled && (
					<div className="text-xs text-amber-400">
						未安装 cloudflared：brew install cloudflared
					</div>
				)}
				<select
					className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
					value={tunnelMode}
					onChange={(e) => setTunnelMode(e.target.value)}
				>
					<option value="off">关闭</option>
					<option value="quick">临时隧道（trycloudflare）</option>
					<option value="named">命名隧道（固定域名）</option>
				</select>
				{tunnelMode === "named" && (
					<>
						<input
							className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
							placeholder="隧道名称"
							value={tunnelName}
							onChange={(e) => setTunnelName(e.target.value)}
						/>
						<input
							className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
							placeholder="公网域名，如 ws.example.com"
							value={tunnelHost}
							onChange={(e) => setTunnelHost(e.target.value)}
						/>
					</>
				)}
				{status?.tunnelUrl && (
					<div className="text-xs text-neutral-400">
						公网地址{" "}
						<code className="text-neutral-200">{status.tunnelUrl}</code>
					</div>
				)}
				<div className="flex gap-2">
					<button
						className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
						disabled={busy !== null}
						onClick={applyTunnel}
					>
						{tunnelMode === "off" ? "保存并停止隧道" : "保存并启动隧道"}
					</button>
					<button
						className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-40"
						disabled={busy !== null || !status?.tunnelUrl}
						onClick={() => makePairing(true)}
					>
						生成隧道配对二维码
					</button>
				</div>
				<div className="text-[11px] leading-4 text-neutral-500">
					有域名建议绑子域名并配置 Cloudflare Access；无域名可用临时隧道。
				</div>
			</div>

			{/* Pairing QR */}
			{pairing && (
				<div className="flex flex-col items-center gap-2 rounded border border-neutral-800 p-3">
					<div className="text-xs text-neutral-400">
						{pairTarget === "tunnel" ? "隧道" : "局域网"}配对码 · {mm}:{ss} 后过期
						· 一次性
					</div>
					<div
						className="rounded bg-white p-2 [&_svg]:h-44 [&_svg]:w-44"
						// Backend-generated SVG QR (qrcode crate), not user content.
						dangerouslySetInnerHTML={{ __html: pairing.qrSvg }}
					/>
					<code className="max-w-full break-all text-center text-[11px] text-neutral-500">
						{pairing.url}
					</code>
				</div>
			)}

			{/* Devices + status extension */}
			<div className="flex flex-col gap-2 rounded border border-neutral-800 p-3">
				<button
					className="self-start rounded border border-red-900 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-40"
					disabled={busy !== null}
					onClick={revokeAll}
				>
					撤销全部已配对设备
				</button>
				<button
					className="self-start rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-40"
					disabled={busy !== null}
					onClick={installExt}
				>
					安装状态扩展到全局 omp
				</button>
			</div>
		</section>
	);
}
