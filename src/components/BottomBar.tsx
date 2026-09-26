import clsx from "clsx";
import {
	Activity,
	Coins,
	Gauge,
	GitBranch,
	Minus,
	Plus,
	RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { computeSessionStats, formatTokens } from "../features/chat/sessionStats";
import { SessionStatsPopover } from "../features/chat/SessionStatsPopover";
import { useLive } from "../stores/live";
import { useSessions } from "../stores/sessions";
import { useUi } from "../stores/ui";
import { getAppMemoryUsage } from "../lib/ipc";

const ZOOM_STORAGE_KEY = "ompws:ui-zoom";
const DEFAULT_ZOOM = 100;
const MIN_ZOOM = 80;
const MAX_ZOOM = 140;
const ZOOM_STEP = 5;

function readStoredZoom(): number {
	try {
		const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
		if (raw) {
			const n = Number(raw);
			if (!Number.isNaN(n) && n >= MIN_ZOOM && n <= MAX_ZOOM) return n;
		}
	} catch {
		/* ignore */
	}
	return DEFAULT_ZOOM;
}

function applyZoom(zoomPercent: number) {
	try {
		const val = `${zoomPercent}%`;
		// CSS zoom property is supported in WebKit / Chromium
		(document.documentElement.style as unknown as { zoom: string }).zoom = val;
		localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomPercent));
	} catch {
		/* ignore */
	}
}

export function BottomBar() {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const lastSessionId = useUi((s) => s.lastSessionId);
	const activeSessionId = selectedSessionId || lastSessionId;

	const activeSession = useSessions((s) =>
		activeSessionId ? s.sessions[activeSessionId] : undefined,
	);
	const live = useLive((s) =>
		activeSessionId ? s.sessions[activeSessionId] : undefined,
	);
	const streaming = live?.streaming === true;

	// Zoom state
	const [zoom, setZoom] = useState<number>(readStoredZoom);

	useEffect(() => {
		applyZoom(zoom);
	}, [zoom]);

	const handleZoomIn = () => {
		setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
	};

	const handleZoomOut = () => {
		setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
	};

	const handleResetZoom = () => {
		setZoom(DEFAULT_ZOOM);
	};

	// Session statistics (dsh style)
	const [statsOpen, setStatsOpen] = useState(false);
	const transcriptItems = live?.items ?? [];
	const stats = useMemo(
		() => computeSessionStats(transcriptItems, live),
		[transcriptItems, live],
	);
	// Real OS process physical memory (RSS)
	const [realMemoryStr, setRealMemoryStr] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const fetchMemory = async () => {
			try {
				const info = await getAppMemoryUsage();
				if (!cancelled && info?.formatted) {
					setRealMemoryStr(info.formatted);
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

	// Approximate memory estimation for CC-GUI style indicator
	const memEstimate = useMemo(() => {
		const baseMb = 75;
		const itemMb = (transcriptItems.length * 0.15);
		return `${Math.round(baseMb + itemMb)} MB`;
	}, [transcriptItems.length]);

	const branch = activeSession?.git?.branch;
	const dirty = activeSession?.git?.dirty ?? 0;

	return (
		<footer className="relative flex h-7 shrink-0 items-center justify-between border-t border-neutral-800/80 bg-neutral-950/95 px-3 text-[11px] text-neutral-400 select-none backdrop-blur-sm">
			{/* Left: dsh-style Session Stats */}
			<div className="flex items-center gap-2">
				{activeSessionId && stats.hasData ? (
					<button
						type="button"
						onClick={() => setStatsOpen((v) => !v)}
						title="点击查看详细会话统计 (模型用时、TTFT、TPS、Token 消耗)"
						className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors"
					>
						<Gauge
							size={12}
							className={clsx(
								"transition-colors",
								streaming ? "text-indigo-400 animate-pulse" : "text-neutral-500 group-hover:text-indigo-400",
							)}
						/>
						<span>
							{stats.rounds} 轮 {stats.steps} 步
						</span>
						{stats.tps > 0 && (
							<>
								<span className="text-neutral-600">·</span>
								<span className="font-mono">{stats.tps} tok/s</span>
							</>
						)}
						<span className="text-neutral-600">·</span>
						<Coins size={11} className="text-neutral-500 group-hover:text-amber-400 transition-colors" />
						<span className="font-mono">{formatTokens(stats.totalTokens)}</span>
						{stats.cacheHitRate > 0 && (
							<>
								<span className="text-neutral-600">·</span>
								<span>缓存 {stats.cacheHitRate.toFixed(1)}%</span>
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
				{/* Performance indicator (Real OS physical memory RSS) */}
				<div
					className="flex items-center gap-1"
					title="真实物理内存占用 (操作系统内核报告的 Resident Set Size)"
				>
					<Activity size={11} className="text-emerald-400" />
					<span className="font-mono text-[10.5px]">
						性能 {realMemoryStr ?? memEstimate}
					</span>
				</div>

				<span className="text-neutral-700">·</span>

				{/* Zoom controls: - 100% + */}
				<div className="flex items-center gap-1 text-[11px]">
					<button
						type="button"
						onClick={handleZoomOut}
						disabled={zoom <= MIN_ZOOM}
						title="缩小界面 (-5%)"
						className="rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30 transition-colors"
					>
						<Minus size={11} />
					</button>
					<button
						type="button"
						onClick={handleResetZoom}
						title="重置缩放为 100%"
						className="font-mono text-[10.5px] hover:text-neutral-200 transition-colors"
					>
						{zoom}%
					</button>
					<button
						type="button"
						onClick={handleZoomIn}
						disabled={zoom >= MAX_ZOOM}
						title="放大界面 (+5%)"
						className="rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30 transition-colors"
					>
						<Plus size={11} />
					</button>
				</div>

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
						<div
							className="flex items-center gap-1 text-neutral-400 hover:text-neutral-200 transition-colors"
							title={`当前分支: ${branch}${dirty > 0 ? ` (${dirty} 处未提交变更)` : ""}`}
						>
							<GitBranch size={11} className="text-neutral-500" />
							<span className="max-w-[120px] truncate font-mono text-[10.5px]">
								{branch}
							</span>
							{dirty > 0 && (
								<span className="text-[10px] text-amber-400">+{dirty}</span>
							)}
						</div>
					</>
				)}
			</div>
		</footer>
	);
}
