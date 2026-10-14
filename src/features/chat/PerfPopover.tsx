import clsx from "clsx";
import { Activity, AppWindow, Layers, Server, X } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useState } from "react";
import type { PerfBreakdown, ServiceInfo } from "../../lib/contracts";
import { perfBreakdown, servicesList } from "../../lib/ipc";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { type Anchor, FloatingLayer } from "../../components/FloatingLayer";

export interface PerfPopoverProps {
	anchor?: Anchor | null;
	/** Formatted memory of the app itself and helpers (e.g. "412 MB"). */
	appMemory: string | null;
	/** Number of processes included in the app total. */
	processes?: number;
	open: boolean;
	onClose: () => void;
	services?: ServiceInfo[] | null;
	/** Shared `perf_breakdown` payload polled by the bottom bar while open. */
	breakdown?: PerfBreakdown | null;
	ignoreRefs?: RefObject<HTMLElement | null>[];
	className?: string;
}

/** One display row per process; multiple ports on one pid collapse. */
interface ProcRow {
	pid: number;
	name: string;
	ports: number[];
	command: string;
	memoryKb: number | null;
	startedByApp: boolean;
}

function formatKb(kb: number | null): string {
	if (kb == null) return "—";
	const mb = kb / 1024;
	return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null) return "—";
	const mb = bytes / (1024 * 1024);
	if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
	return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Stacked-bar segment colors: quiet neutrals, omp gets the agent accent. */
const SEG = {
	app: "bg-indigo-400/60",
	omp: "bg-emerald-400/50",
	other: "bg-neutral-500/40",
	free: "bg-neutral-700/40",
} as const;

export function PerfPopover({
	anchor,
	appMemory,
	processes = 1,
	open,
	onClose,
	services,
	breakdown,
	ignoreRefs,
	className,
}: PerfPopoverProps) {
	const workspaces = useSessions((s) => s.workspaces);
	const liveSessions = useLive((s) => s.sessions);
	const liveOmpCount = useMemo(
		() => Object.values(liveSessions).filter((l) => l.alive).length,
		[liveSessions],
	);
	const [internalRows, setInternalRows] = useState<ServiceInfo[] | null>(null);
	const [internalBreakdown, setInternalBreakdown] = useState<PerfBreakdown | null>(null);

	// If parent doesn't provide shared services, do a one-off fetch when opened
	const fetchFallback = useCallback(async () => {
		try {
			setInternalRows(await servicesList(true));
		} catch {
			/* ignore */
		}
	}, []);

	useEffect(() => {
		if (open && services === undefined) {
			void fetchFallback();
		}
	}, [open, services, fetchFallback]);

	// Same fallback for the breakdown when the parent doesn't poll it.
	useEffect(() => {
		if (!open || breakdown !== undefined) return;
		let cancelled = false;
		const tick = async () => {
			try {
				const bd = await perfBreakdown();
				if (!cancelled) setInternalBreakdown(bd);
			} catch {
				/* ignore */
			}
		};
		void tick();
		const id = window.setInterval(() => void tick(), 4000);
		return () => {
			cancelled = true;
			window.clearInterval(id);
		};
	}, [open, breakdown]);

	const rows = services !== undefined ? services : internalRows;
	const bd = breakdown !== undefined ? breakdown : internalBreakdown;

	// Processes that belong to this project: spawned by the app, an `omp`
	// executable, or running in / referencing an exact workspace path.
	const procs = useMemo<ProcRow[]>(() => {
		if (!rows) return [];
		const byPid = new Map<number, ProcRow>();
		for (const s of rows) {
			const existing = byPid.get(s.pid);
			if (existing) {
				if (!existing.ports.includes(s.port)) {
					existing.ports.push(s.port);
				}
				continue;
			}
			const executable = s.command.trim().split(/\s+/, 1)[0] ?? "";
			const isOmp = /^omp\b/i.test(s.command.trim()) || /^omp\b/i.test(executable.split("/").pop() ?? "");
			const inProject = workspaces.some(
				(w) =>
					w.path &&
					((s.cwd != null && (s.cwd === w.path || s.cwd.startsWith(`${w.path}/`))) ||
						s.command.includes(w.path)),
			);
			if (!s.startedByApp && !isOmp && !inProject) continue;
			byPid.set(s.pid, {
				pid: s.pid,
				name: s.name,
				ports: [s.port],
				command: s.command,
				memoryKb: s.memoryKb,
				startedByApp: s.startedByApp,
			});
		}
		return Array.from(byPid.values()).sort(
			(a, b) => (b.memoryKb ?? 0) - (a.memoryKb ?? 0),
		);
	}, [rows, workspaces]);

	// Disjoint bar segments: app tree footprint, omp not already attributed to
	// the app, other processes/system, free.
	const segments = useMemo(() => {
		if (!bd?.totalBytes) return null;
		const parts = [
			{ key: "app" as const, bytes: bd.app.bytes ?? 0 },
			{ key: "omp" as const, bytes: bd.barOmpBytes ?? 0 },
			{ key: "other" as const, bytes: bd.otherBytes ?? 0 },
			{ key: "free" as const, bytes: bd.freeBytes ?? 0 },
		];
		const total = bd.totalBytes;
		return parts.map((p) => ({ ...p, pct: (p.bytes / total) * 100 }));
	}, [bd]);

	if (!open) return null;

	return (
		<FloatingLayer
			anchor={open ? (anchor ?? null) : null}
			placement="top-end"
			offset={4}
			layer="popover"
			ignoreRefs={ignoreRefs}
			onDismiss={onClose}
			className={clsx(
				"w-80 p-3.5 text-[var(--text)] select-none animate-in fade-in zoom-in-95 duration-100",
				className,
			)}
		>
			{/* Header */}
			<div className="mb-3 flex items-center justify-between border-b border-[var(--line)] pb-2">
				<div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
					<Activity size={14} className="text-[var(--text-60)]" />
					<span>性能</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md p-1 text-[var(--text-40)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] active:scale-95 transition-all"
				>
					<X size={12} />
				</button>
			</div>

			<div className="mb-3 rounded-md bg-[var(--ghost-hover)] px-2 py-1.5 text-[10.5px] leading-snug text-[var(--text-60)]">
				整机内存分布（本应用 / OMP 智能体 / 其他程序 / 空闲）与活跃窗口；打开时每 4 秒刷新
			</div>

			{/* 内存分布: stacked bar + legend */}
			<div className="mb-2.5">
				<div className="mb-1.5 text-[10px] font-medium tracking-wide text-[var(--text-40)]">
					内存分布
					{bd?.usedBytes != null && bd?.totalBytes != null && (
						<span className="ml-1 font-normal text-[var(--text-40)]">
							已用 {formatBytes(bd.usedBytes)} / 共 {formatBytes(bd.totalBytes)}
						</span>
					)}
				</div>
				{segments ? (
					<>
						<div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--ghost-hover)]">
							{segments.map((s) =>
								s.pct > 0 ? (
									<div
										key={s.key}
										className={clsx("h-full", SEG[s.key])}
										style={{ width: `${s.pct}%` }}
									/>
								) : null,
							)}
						</div>
						<div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
							{([
								["app", "本应用", bd?.app.bytes],
								["omp", "OMP 智能体", bd?.barOmpBytes],
								["other", "其他程序", bd?.otherBytes],
								["free", "空闲", bd?.freeBytes],
							] as const).map(([key, label, bytes]) => (
								<div key={key} className="flex items-center justify-between gap-2">
									<span className="flex min-w-0 items-center gap-1.5 text-[var(--text-60)]">
										<span className={clsx("h-1.5 w-1.5 shrink-0 rounded-[2px]", SEG[key])} />
										{label}
									</span>
									<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
										{formatBytes(bytes)}
									</span>
								</div>
							))}
						</div>
					</>
				) : (
					<div className="py-1.5 text-center text-[11px] text-[var(--text-40)]">
						{bd ? "暂不支持当前系统" : "采集数据…"}
					</div>
				)}
			</div>

			{/* Detail rows: 本程序 + OMP split */}
			<div className="space-y-1 text-xs">
				<div
					className="flex items-center justify-between"
					title={`本程序进程树（本体 + WebView/帮助进程），共 ${bd?.app.processes ?? processes} 个进程；与底部状态栏同一口径`}
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<AppWindow size={12} className="shrink-0 text-[var(--text-60)]" />
						<span className="truncate text-[var(--text-60)]">本应用（界面）</span>
						<span className="shrink-0 font-mono text-[10px] text-[var(--text-40)]">
							{bd?.app.processes ?? processes} 个进程
						</span>
					</div>
					<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
						{bd?.app.bytes != null ? formatBytes(bd.app.bytes) : (appMemory ?? "—")}
					</span>
				</div>
				<div
					className="flex items-center justify-between"
					title="由本程序启动的 omp Agent 会话进程"
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="w-3 shrink-0 text-center text-[var(--text-40)]">└</span>
						<span className="truncate text-[var(--text-60)]">OMP · 本应用开的会话</span>
						<span className="shrink-0 font-mono text-[10px] text-[var(--text-40)]">
							{bd?.ompSpawned.bytes != null ? `${bd.ompSpawned.processes} 个进程` : "—"}
						</span>
					</div>
					<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
						{formatBytes(bd?.ompSpawned.bytes)}
					</span>
				</div>
				<div
					className="flex items-center justify-between"
					title="本机其他 omp 进程（终端、其他窗口启动的会话等）"
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="w-3 shrink-0 text-center text-[var(--text-40)]">└</span>
						<span className="truncate text-[var(--text-60)]">OMP · 终端/其他窗口开的</span>
						<span className="shrink-0 font-mono text-[10px] text-[var(--text-40)]">
							{bd?.ompExternal.bytes != null ? `${bd.ompExternal.processes} 个进程` : "—"}
						</span>
					</div>
					<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
						{formatBytes(bd?.ompExternal.bytes)}
					</span>
				</div>
			</div>

			{/* 活跃窗口 */}
			<div className="mt-3 border-t border-[var(--line)] pt-2.5">
				<div className="mb-1.5 flex items-center justify-between text-[10px] font-medium tracking-wide text-[var(--text-40)]">
					<span>活跃窗口</span>
					<span className="font-normal">
						本机 {bd?.instances.length ?? "—"} 个实例 · 本窗口 OMP 会话 {liveOmpCount} 个
					</span>
				</div>
				{bd && bd.instances.length > 0 ? (
					<div className="space-y-1 text-[11px]">
						{bd.instances.map((i) => (
							<div
								key={i.pid}
								title={i.cwd ?? `pid ${i.pid}`}
								className="flex items-center justify-between gap-2"
							>
								<div className="flex min-w-0 items-center gap-1.5">
									<AppWindow
										size={11}
										className={clsx(
											"shrink-0",
											i.isThis ? "text-[var(--status-success)]" : "text-[var(--text-40)]",
										)}
									/>
									<span className="truncate text-[var(--text-60)]">
										{i.label}
										{i.isThis ? "（本窗口）" : ""}
									</span>
								</div>
								<span className="shrink-0 font-mono text-[10px] text-[var(--text-40)]">
									pid {i.pid}
								</span>
							</div>
						))}
					</div>
				) : (
					<div className="py-1.5 text-center text-[11px] text-[var(--text-40)]">
						{bd ? "仅当前窗口" : "采集数据…"}
					</div>
				)}
			</div>

			{/* Service processes */}
			<div className="mt-3 border-t border-[var(--line)] pt-2.5">
				<div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium tracking-wide text-[var(--text-40)]">
					<Layers size={10} className="text-[var(--text-40)]" />
					服务进程
				</div>
				{rows === null ? (
					<div className="py-2 text-center text-[11px] text-[var(--text-40)]">
						加载中…
					</div>
				) : procs.length === 0 ? (
					<div className="py-2 text-center text-[11px] text-[var(--text-40)]">
						未发现当前项目关联的进程
					</div>
				) : (
					<div className="max-h-48 space-y-1 overflow-y-auto pr-3 text-[11px]">
						{procs.map((p) => (
							<div
								key={p.pid}
								title={`pid ${p.pid} · ${p.command}`}
								className="flex items-center justify-between gap-2"
							>
								<div className="flex min-w-0 items-center gap-1.5">
									<Server
										size={11}
										className={clsx(
											"shrink-0",
											p.startedByApp
												? "text-[var(--status-success)]"
												: "text-[var(--text-40)]",
										)}
									/>
									<span className="truncate text-[var(--text-60)]">
										{p.name}
									</span>
									<span className="shrink-0 font-mono text-[var(--text-40)]">
										:{p.ports.join(",:")}
									</span>
								</div>
								<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
									{formatKb(p.memoryKb)}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</FloatingLayer>
	);
}
