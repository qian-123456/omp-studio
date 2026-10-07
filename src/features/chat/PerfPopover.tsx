import clsx from "clsx";
import { Activity, AppWindow, Server, X } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useState } from "react";
import type { ServiceInfo } from "../../lib/contracts";
import { servicesList } from "../../lib/ipc";
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

export function PerfPopover({
	anchor,
	appMemory,
	processes = 1,
	open,
	onClose,
	services,
	ignoreRefs,
	className,
}: PerfPopoverProps) {
	const workspaces = useSessions((s) => s.workspaces);
	const [internalRows, setInternalRows] = useState<ServiceInfo[] | null>(null);

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

	const rows = services !== undefined ? services : internalRows;

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
				展示客户端本体内存，以及当前项目关联的 Agent 进程与服务端口
			</div>

			{/* App itself */}
			<div
				className="flex items-center justify-between text-xs"
				title={`含 ${processes} 个进程（本体+WebView/帮助进程）`}
			>
				<div className="flex min-w-0 items-center gap-1.5">
					<AppWindow size={12} className="shrink-0 text-[var(--text-60)]" />
					<span
						className="truncate text-[var(--text-60)]"
						title={`含 ${processes} 个进程（本体+WebView/帮助进程）`}
					>
						omp-workspace (本体)
					</span>
				</div>
				<span className="shrink-0 font-mono tabular-nums text-[var(--text)]">
					{appMemory ?? "—"}
				</span>
			</div>

			{/* Service processes */}
			<div className="mt-3 border-t border-[var(--line)] pt-2.5">
				<div className="mb-1.5 text-[10px] font-medium tracking-wide text-[var(--text-40)]">
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
					<div className="max-h-48 space-y-1 overflow-y-auto text-[11px]">
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
