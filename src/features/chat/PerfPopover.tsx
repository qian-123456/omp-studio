import clsx from "clsx";
import { Activity, AppWindow, Layers, Server, X } from "lucide-react";
import { type RefObject, useMemo } from "react";
import type { PerfBreakdown, ServiceInfo } from "../../lib/contracts";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { type Anchor, FloatingLayer } from "../../components/FloatingLayer";
import { useT } from "../../stores/language";

export interface PerfPopoverProps {
	anchor?: Anchor | null;
	/** Formatted memory of the app itself and helpers (e.g. "412 MB"). */
	appMemory: string | null;
	/** Number of processes included in the app total. */
	processes?: number;
	open: boolean;
	onClose: () => void;
	/** Shared `servicesList(true)` payload polled by the bottom bar while open. */
	services: ServiceInfo[] | null;
	/** Shared `perf_breakdown` payload polled by the bottom bar while open. */
	breakdown: PerfBreakdown | null;
	ignoreRefs?: RefObject<HTMLElement | null>[];
	className?: string;
}

/** One display row per process; multiple ports on one pid collapse. */
interface ProcRow {
	pid: number;
	name: string;
	ports: number[];
	command: string;
	startedByApp: boolean;
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
	const { t } = useT();
	const workspaces = useSessions((s) => s.workspaces);
	const liveSessions = useLive((s) => s.sessions);
	const liveOmpCount = useMemo(
		() => Object.values(liveSessions).filter((l) => l.alive).length,
		[liveSessions],
	);
	const rows = services;
	const bd = breakdown;

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
				startedByApp: s.startedByApp,
			});
		}
		return Array.from(byPid.values()).sort((a, b) => a.pid - b.pid);
	}, [rows, workspaces]);

	// Disjoint physical-footprint segments. Do not turn an unknown probe into a
	// zero-width segment: that would make the total and the details disagree.
	const segments = useMemo(() => {
		if (!bd?.totalBytes || bd.app.bytes == null || bd.barOmpBytes == null ||
			bd.otherBytes == null || bd.freeBytes == null) return null;
		const parts = [
			{ key: "app" as const, bytes: bd.app.bytes },
			{ key: "omp" as const, bytes: bd.barOmpBytes },
			{ key: "other" as const, bytes: bd.otherBytes },
			{ key: "free" as const, bytes: bd.freeBytes },
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
					<span>{t("chatView.perf.title")}</span>
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
				{t("chatView.perf.description")}
			</div>

			{/* 内存分布: stacked bar + legend */}
			<div className="mb-2.5">
				<div className="mb-1.5 text-[10px] font-medium tracking-wide text-[var(--text-40)]">
					{t("chatView.perf.memoryDistribution")}
					{bd?.usedBytes != null && bd?.totalBytes != null && (
						<span className="ml-1 font-normal text-[var(--text-40)]">
							{t("chatView.perf.usedOfTotal", {
								used: formatBytes(bd.usedBytes),
								total: formatBytes(bd.totalBytes),
							})}
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
								["app", t("chatView.perf.app"), bd?.app.bytes],
								["omp", t("chatView.perf.ompAgents"), bd?.barOmpBytes],
								["other", t("chatView.perf.otherApps"), bd?.otherBytes],
								["free", t("chatView.perf.free"), bd?.freeBytes],
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
						{bd ? t("chatView.perf.notSupported") : t("chatView.perf.collecting")}
					</div>
				)}
			</div>

			{/* Detail rows: 本程序 + OMP split */}
			<div className="space-y-1 text-xs">
				<div
					className="flex items-center justify-between"
					title={t("chatView.perf.appProcessTreeTitle", { count: bd?.app.processes ?? processes })}
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<AppWindow size={12} className="shrink-0 text-[var(--text-60)]" />
						<span className="truncate text-[var(--text-60)]">{t("chatView.perf.appUi")}</span>
						<span className="shrink-0 font-mono text-[10px] text-[var(--text-40)]">
							{t("chatView.perf.processCount", { count: bd?.app.processes ?? processes })}
						</span>
					</div>
					<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
						{bd?.app.bytes != null ? formatBytes(bd.app.bytes) : (appMemory ?? "—")}
					</span>
				</div>
				<div
					className="flex items-center justify-between"
					title={t("chatView.perf.ompSpawnedTitle")}
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="w-3 shrink-0 text-center text-[var(--text-40)]">└</span>
						<span className="truncate text-[var(--text-60)]">{t("chatView.perf.ompSpawned")}</span>
						<span className="shrink-0 font-mono text-[10px] text-[var(--text-40)]">
							{bd?.ompSpawned.bytes != null ? t("chatView.perf.processCount", { count: bd.ompSpawned.processes }) : "—"}
						</span>
					</div>
					<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
						{formatBytes(bd?.ompSpawned.bytes)}
					</span>
				</div>
				<div
					className="flex items-center justify-between"
					title={t("chatView.perf.ompExternalTitle")}
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="w-3 shrink-0 text-center text-[var(--text-40)]">└</span>
						<span className="truncate text-[var(--text-60)]">{t("chatView.perf.ompExternal")}</span>
						<span className="shrink-0 font-mono text-[10px] text-[var(--text-40)]">
							{bd?.ompExternal.bytes != null ? t("chatView.perf.processCount", { count: bd.ompExternal.processes }) : "—"}
						</span>
					</div>
					<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
						{formatBytes(bd?.ompExternal.bytes)}
					</span>
				</div>
			</div>

			{/* Instance labels and process IDs are development diagnostics only. */}
			{import.meta.env.DEV && (
			<div className="mt-3 border-t border-[var(--line)] pt-2.5">
				<div className="mb-1.5 flex items-center justify-between text-[10px] font-medium tracking-wide text-[var(--text-40)]">
					<span>{t("chatView.perf.activeWindows")}</span>
					<span className="font-normal">
						{t("chatView.perf.instancesSummary", { total: bd?.instances.length ?? "—", live: liveOmpCount })}
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
										{i.isThis ? t("chatView.perf.thisWindow") : ""}
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
						{bd ? t("chatView.perf.currentWindowOnly") : t("chatView.perf.collecting")}
					</div>
				)}
			</div>
			)}

			{/* Process/close/debug management is not offered by formal releases. */}
			{import.meta.env.DEV && (
			<div className="mt-3 border-t border-[var(--line)] pt-2.5">
				<div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium tracking-wide text-[var(--text-40)]">
					<Layers size={10} className="text-[var(--text-40)]" />
					{t("chatView.perf.serviceProcesses")}
				</div>
				{rows === null ? (
					<div className="py-2 text-center text-[11px] text-[var(--text-40)]">
						{t("chatView.perf.loading")}
					</div>
				) : procs.length === 0 ? (
					<div className="py-2 text-center text-[11px] text-[var(--text-40)]">
						{t("chatView.perf.noServiceProcesses")}
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
								<span className="shrink-0 font-mono text-[10px] text-[var(--text-40)]">
									pid {p.pid}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
			)}
		</FloatingLayer>
	);
}
