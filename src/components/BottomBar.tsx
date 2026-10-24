import clsx from "clsx";
import {
	Activity,
	Coins,
	Gauge,
	GitBranch,
	Minus,
	Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { computeSessionStats, formatTokens } from "../features/chat/sessionStats";
import { PerfPopover } from "../features/chat/PerfPopover";
import { SessionStatsPopover } from "../features/chat/SessionStatsPopover";
import { useChatUi } from "../features/chat/chatUi";
import { useLive } from "../stores/live";
import { useSessions } from "../stores/sessions";
import { useUi } from "../stores/ui";
import { ompVersionLabel, useOmpUpdate } from "../stores/ompUpdate";
import { getAppMemoryUsage, perfBreakdown, servicesList, type ProcessMemoryInfo } from "../lib/ipc";
import { useDisplayPrefs } from "../stores/displayPrefs";
import type { PerfBreakdown, ServiceInfo } from "../lib/contracts";
import { useZoom } from "../lib/zoom";
import { useT } from "../stores/language";

export function BottomBar() {
	const { t } = useT();
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const lastSessionId = useUi((s) => s.lastSessionId);
	const bottomBarVisible = useDisplayPrefs((s) => s.bottomBar);
	const activeSessionId = selectedSessionId || lastSessionId;

	const rightTab = useUi((s) => s.rightTab);
	const setRightTab = useUi((s) => s.setRightTab);
	const rightOpen = useUi((s) => s.rightOpen);
	const setRightOpen = useUi((s) => s.setRightOpen);
	const openSettings = useUi((s) => s.openSettings);
	const ompInfo = useOmpUpdate((s) => s.info);
	const ompStatus = useOmpUpdate((s) => s.status);
	const ompVersion = ompVersionLabel(ompInfo, ompStatus);
	const ompUpdateAvailable = ompStatus?.updateAvailable === true;

	const activeSession = useSessions((s) =>
		activeSessionId ? s.sessions[activeSessionId] : undefined,
	);
	const live = useLive((s) =>
		activeSessionId ? s.sessions[activeSessionId] : undefined,
	);
	const streaming = live?.streaming === true;

	// Global keyboard shortcuts (Cmd/Ctrl +/-, Cmd/Ctrl 0) and stored zoom application
	const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom();

	const handleToggleGit = () => {
		if (rightTab === "git" && rightOpen) {
			setRightOpen(false);
		} else {
			setRightTab("git");
		}
	};

	// Session statistics (dsh style)
	const statsOpen = useChatUi((s) => s.statsOpen);
	const setStatsOpen = useChatUi((s) => s.setStatsOpen);
	const transcriptItems = live?.items ?? [];
	const stats = useMemo(
		() => computeSessionStats(transcriptItems, live),
		[transcriptItems, live],
	);
	// Real OS process physical memory (footprint across app + helpers)
	const [memoryInfo, setMemoryInfo] = useState<ProcessMemoryInfo | null>(null);
	const [perfData, setPerfData] = useState<PerfBreakdown | null>(null);
	const [serviceRows, setServiceRows] = useState<ServiceInfo[] | null>(null);
	const [perfOpen, setPerfOpen] = useState(false);
	const statsBtnRef = useRef<HTMLButtonElement>(null);
	const perfBtnRef = useRef<HTMLButtonElement>(null);

	// Shared poller for memory + services:
	// - Pauses when document is hidden
	// - Relaxed interval (30s) when PerfPopover is closed, 4s when open
	// - Skips overlapping runs
	useEffect(() => {
		let cancelled = false;
		let timer: number | null = null;
		let inFlight = false;

		// Closed: only the bar label needs refreshing; the backend walks every
		// system pid for it, so keep that rare.
		const intervalMs = perfOpen ? 4000 : 30000;

		const poll = async () => {
			if (cancelled || document.visibilityState === "hidden") return;
			if (inFlight) return;
			inFlight = true;

			try {
				const memPromise = getAppMemoryUsage();
				const srvPromise = perfOpen ? servicesList(true) : null;
				const perfPromise = perfOpen ? perfBreakdown() : null;
				const [mem, srv, perf] = await Promise.all([memPromise, srvPromise, perfPromise]);
				if (!cancelled) {
					if (mem?.formatted) {
						setMemoryInfo((prev) =>
							prev && prev.formatted === mem.formatted && prev.processes === mem.processes
								? prev
								: mem,
						);
					}
					if (srv !== null) setServiceRows(srv);
					if (perf !== null) setPerfData(perf);
				}
			} catch {
				/* ignore */
			} finally {
				inFlight = false;
				if (!cancelled && (document.visibilityState as string) !== "hidden") {
					timer = window.setTimeout(() => {
						void poll();
					}, intervalMs);
				}
			}
		};

		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				if (timer !== null) {
					window.clearTimeout(timer);
					timer = null;
				}
				void poll();
			} else {
				if (timer !== null) {
					window.clearTimeout(timer);
					timer = null;
				}
			}
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		void poll();

		return () => {
			cancelled = true;
			if (timer !== null) window.clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [perfOpen]);
	const realMemoryStr = memoryInfo?.formatted ?? null;


	// Approximate memory estimation for CC-GUI style indicator
	const memEstimate = useMemo(() => {
		const baseMb = 75;
		const itemMb = (transcriptItems.length * 0.15);
		return `${Math.round(baseMb + itemMb)} MB`;
	}, [transcriptItems.length]);

	const branch = activeSession?.git?.branch;
	const dirty = activeSession?.git?.dirty ?? 0;

	return (
		<footer data-app-bottombar className={`relative ${bottomBarVisible ? "flex" : "hidden"} h-7 shrink-0 items-center justify-between border-t border-[var(--border-divider)] bg-neutral-950 px-3 text-[11px] text-neutral-400 select-none tabular-nums`}>
			{/* Left: dsh-style Session Stats */}
			<div className="flex items-center gap-2">
				{activeSessionId && stats.hasData ? (
					<button
						ref={statsBtnRef}
						type="button"
						onClick={() => setStatsOpen(!statsOpen)}
						title={t("bottomBar.statsTip")}
						className="group flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-97 transition-all"
					>
						<Gauge
							size={12}
							className={clsx(
								"transition-colors",
								streaming ? "text-indigo-400 animate-pulse" : "text-neutral-500 group-hover:text-indigo-400",
							)}
						/>
						<span className="tabular-nums font-mono">
							{t("bottomBar.roundsAndSteps", { rounds: stats.rounds, steps: stats.steps })}
						</span>
						{stats.tps != null && (
							<>
								<span className="text-neutral-600">·</span>
								<span className="tabular-nums font-mono">{stats.tps.toFixed(1)} token/s</span>
							</>
						)}
						<span className="text-neutral-600">·</span>
						<Coins size={11} className="text-neutral-500 group-hover:text-amber-400 transition-colors" />
						<span className="tabular-nums font-mono">{formatTokens(stats.totalTokens)}</span>
						{stats.cacheHitRate > 0 && (
							<>
								<span className="text-neutral-600">·</span>
								<span className="tabular-nums font-mono">{t("bottomBar.cacheHitRate", { rate: stats.cacheHitRate.toFixed(1) })}</span>
							</>
						)}
					</button>
				) : (
					<div className="flex items-center gap-1.5 text-neutral-500">
						<Activity size={12} className="text-neutral-600" />
						<span>{t("bottomBar.ready")}</span>
					</div>
				)}

				{/* Floating Session Stats Popover */}
				<SessionStatsPopover
					anchor={statsOpen ? statsBtnRef.current : null}
					stats={stats}
					open={statsOpen}
					onClose={() => setStatsOpen(false)}
					ignoreRefs={[statsBtnRef]}
				/>
			</div>

			{/* Right: CC GUI style Status Strip (Performance, Zoom, Sync, Git) */}
			<div className="flex items-center gap-2 text-neutral-400">
				{/* Performance indicator (Real OS physical memory RSS) — click for per-process breakdown */}
				<button
					ref={perfBtnRef}
					type="button"
					onClick={() => setPerfOpen((v) => !v)}
					title={t("bottomBar.memoryTooltip", {
						processes: memoryInfo?.processes ? t("bottomBar.processesCount", { count: memoryInfo.processes }) : "",
					})}
					className={clsx(
						"flex items-center gap-1 rounded-[6px] px-1 py-0.5 transition-all hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-97",
						perfOpen && "bg-[var(--bg-hover)] text-neutral-100",
					)}
				>
					<Activity size={11} className="text-emerald-400" />
					<span className="tabular-nums font-mono text-[10.5px]">
						{t("bottomBar.performance", { memory: realMemoryStr ?? memEstimate })}
					</span>
				</button>
				<PerfPopover
					anchor={perfOpen ? perfBtnRef.current : null}
					appMemory={realMemoryStr}
					processes={memoryInfo?.processes}
					services={serviceRows}
					breakdown={perfData}
					open={perfOpen}
					onClose={() => setPerfOpen(false)}
					ignoreRefs={[perfBtnRef]}
				/>
				<span className="text-neutral-700">·</span>

				{/* omp version chip — click opens 设置 ▸ 版本与更新 */}
				{ompVersion && (
					<>
						<button
							type="button"
							onClick={() => openSettings("about")}
						title={ompUpdateAvailable ? t("bottomBar.ompNewVersion", { version: ompStatus?.latest ?? "" }) : t("bottomBar.ompVersionTip")}
							className="relative flex items-center gap-1 rounded-[6px] px-1 py-0.5 transition-all hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-97"
						>
							<span className="font-mono text-[10.5px]">omp {ompVersion}</span>
							{ompUpdateAvailable && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />}
						</button>
						<span className="text-neutral-700">·</span>
					</>
				)}

				{/* Zoom controls: - 100% + */}
				<div className="flex items-center gap-1 text-[11px]">
					<button
						type="button"
						onClick={zoomOut}
						disabled={zoom <= minZoom}
						title={t("bottomBar.zoomOut")}
						className="rounded p-0.5 text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 disabled:opacity-30 transition-colors"
					>
						<Minus size={11} />
					</button>
					<button
						type="button"
						onClick={resetZoom}
						title={t("bottomBar.resetZoom")}
						className="font-mono text-[10.5px] hover:text-neutral-200 transition-colors"
					>
						{zoom}%
					</button>
					<button
						type="button"
						onClick={zoomIn}
						disabled={zoom >= maxZoom}
						title={t("bottomBar.zoomIn")}
						className="rounded p-0.5 text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 disabled:opacity-30 transition-colors"
					>
						<Plus size={11} />
					</button>
				</div>

				{/* Git branch if available */}
				{branch && (
					<>
						<span className="text-neutral-700">·</span>
						<button
							type="button"
							onClick={handleToggleGit}
							aria-label={t("bottomBar.viewGitPanel")}
							title={t("bottomBar.viewGitPanel")}
							className={clsx(
								"flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-97 transition-all cursor-pointer",
								rightTab === "git" && rightOpen && "bg-[var(--bg-active-fill)] text-neutral-200",
							)}
						>
							<GitBranch
								size={11}
								className={clsx(
									"transition-colors",
									rightTab === "git" && rightOpen ? "text-indigo-400" : "text-neutral-500",
								)}
							/>
							<span className="max-w-[120px] truncate font-mono text-[10.5px]">
								{branch}
							</span>
							{dirty > 0 && (
								<span className="tabular-nums font-mono text-[10px] text-amber-400">+{dirty}</span>
							)}
						</button>
					</>
				)}
			</div>
		</footer>
	);
}
