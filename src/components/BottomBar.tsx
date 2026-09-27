import clsx from "clsx";
import {
	Activity,
	Coins,
	Gauge,
	GitBranch,
	RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { computeSessionStats, formatTokens } from "../features/chat/sessionStats";
import { PerfPopover } from "../features/chat/PerfPopover";
import { SessionStatsPopover } from "../features/chat/SessionStatsPopover";
import { useLive } from "../stores/live";
import { useSessions } from "../stores/sessions";
import { useUi } from "../stores/ui";
import { getAppMemoryUsage, type ProcessMemoryInfo } from "../lib/ipc";
import { useZoom } from "../lib/zoom";


export function BottomBar() {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const lastSessionId = useUi((s) => s.lastSessionId);
	const activeSessionId = selectedSessionId || lastSessionId;

	const rightTab = useUi((s) => s.rightTab);
	const setRightTab = useUi((s) => s.setRightTab);
	const rightOpen = useUi((s) => s.rightOpen);
	const setRightOpen = useUi((s) => s.setRightOpen);

	const activeSession = useSessions((s) =>
		activeSessionId ? s.sessions[activeSessionId] : undefined,
	);
	const live = useLive((s) =>
		activeSessionId ? s.sessions[activeSessionId] : undefined,
	);
	const streaming = live?.streaming === true;

	// Global keyboard shortcuts (Cmd/Ctrl +/-, Cmd/Ctrl 0) and stored zoom application
	useZoom();

	const handleToggleGit = () => {
		if (rightTab === "git" && rightOpen) {
			setRightOpen(false);
		} else {
			setRightTab("git");
		}
	};

	// Session statistics (dsh style)
	const [statsOpen, setStatsOpen] = useState(false);
	const transcriptItems = live?.items ?? [];
	const stats = useMemo(
		() => computeSessionStats(transcriptItems, live),
		[transcriptItems, live],
	);
	// Real OS process physical memory (footprint across app + helpers)
	const [memoryInfo, setMemoryInfo] = useState<ProcessMemoryInfo | null>(null);
	const [perfOpen, setPerfOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const fetchMemory = async () => {
			try {
				const info = await getAppMemoryUsage();
				if (!cancelled && info?.formatted) {
					setMemoryInfo(info);
				}
			} catch {
				/* ignore */
			}
		};

		void fetchMemory();
		const timer = setInterval(() => {
			void fetchMemory();
		}, 4000);

		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);
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
		<footer className="relative flex h-7 shrink-0 items-center justify-between border-t border-[var(--border-divider)] bg-neutral-950 px-3 text-[11px] text-neutral-400 select-none tabular-nums">
			{/* Left: dsh-style Session Stats */}
			<div className="flex items-center gap-2">
				{activeSessionId && stats.hasData ? (
					<button
						type="button"
						onClick={() => setStatsOpen((v) => !v)}
						title="点击查看详细会话统计 (模型用时、TTFT、TPS、Token 消耗)"
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
							{stats.rounds} 轮 {stats.steps} 步
						</span>
						{stats.tps > 0 && (
							<>
								<span className="text-neutral-600">·</span>
								<span className="tabular-nums font-mono">{stats.tps} tok/s</span>
							</>
						)}
						<span className="text-neutral-600">·</span>
						<Coins size={11} className="text-neutral-500 group-hover:text-amber-400 transition-colors" />
						<span className="tabular-nums font-mono">{formatTokens(stats.totalTokens)}</span>
						{stats.cacheHitRate > 0 && (
							<>
								<span className="text-neutral-600">·</span>
								<span className="tabular-nums font-mono">缓存 {stats.cacheHitRate.toFixed(1)}%</span>
							</>
						)}
					</button>
				) : (
					<div className="flex items-center gap-1.5 text-neutral-500">
						<Activity size={12} className="text-neutral-600" />
						<span>OMP 工作台已就绪</span>
					</div>
				)}

				{/* Floating Session Stats Popover */}
				<SessionStatsPopover
					stats={stats}
					open={statsOpen}
					onClose={() => setStatsOpen(false)}
					className="bottom-8 left-3"
				/>
			</div>

			{/* Right: CC GUI style Status Strip (Performance, Zoom, Sync, Git) */}
			<div className="flex items-center gap-2 text-neutral-400">
				{/* Performance indicator (Real OS physical memory RSS) — click for per-process breakdown */}
				<button
					type="button"
					onClick={() => setPerfOpen((v) => !v)}
					title={`真实物理内存占用 (对齐活动监视器口径，含本体及 WebView/帮助进程)${memoryInfo?.processes ? ` — 含 ${memoryInfo.processes} 个进程` : ""}，点击查看各进程明细`}
					className={clsx(
						"flex items-center gap-1 rounded-[6px] px-1 py-0.5 transition-all hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-97",
						perfOpen && "bg-[var(--bg-hover)] text-neutral-100",
					)}
				>
					<Activity size={11} className="text-emerald-400" />
					<span className="tabular-nums font-mono text-[10.5px]">
						性能 {realMemoryStr ?? memEstimate}
					</span>
				</button>
				<PerfPopover
					appMemory={realMemoryStr}
					processes={memoryInfo?.processes}
					open={perfOpen}
					onClose={() => setPerfOpen(false)}
					className="bottom-8 right-3"
				/>

				<span className="text-neutral-700">·</span>

				{/* Sync state */}
				<div className="flex items-center gap-1" title={streaming ? "正在生成中" : "会话状态已同步"}>
					<RefreshCw
						size={11}
						className={clsx(
							"transition-colors",
							streaming ? "animate-spin text-indigo-400" : "text-neutral-500",
						)}
					/>
					<span className="text-[10.5px]">{streaming ? "生成中" : "已同步"}</span>
				</div>

				{/* Git branch if available */}
				{branch && (
					<>
						<span className="text-neutral-700">·</span>
						<button
							type="button"
							onClick={handleToggleGit}
							aria-label="查看 Git 面板"
							title="查看 Git 面板"
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
