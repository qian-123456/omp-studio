import clsx from "clsx";
import { Activity, AppWindow, Server, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServiceInfo } from "../../lib/contracts";
import { useEscapeKey } from "../../lib/hooks";
import { servicesList } from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";

interface PerfPopoverProps {
	/** Formatted memory of the app itself and helpers (e.g. "412 MB"). */
	appMemory: string | null;
	/** Number of processes included in the app total. */
	processes?: number;
	open: boolean;
	onClose: () => void;
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
	appMemory,
	processes = 1,
	open,
	onClose,
	className,
}: PerfPopoverProps) {
	const workspaces = useSessions((s) => s.workspaces);
	const [rows, setRows] = useState<ServiceInfo[] | null>(null);

	useEscapeKey(() => {
		if (open) onClose();
	}, open);

	// Fresh services_list(all=true) scan while the popover is open.
	const refresh = useCallback(async () => {
		try {
			setRows(await servicesList(true));
		} catch {
			/* keep last snapshot */
		}
	}, []);

	useEffect(() => {
		if (!open) return;
		void refresh();
		const timer = setInterval(() => {
			void refresh();
		}, 4000);
		return () => clearInterval(timer);
	}, [open, refresh]);

	// Processes that belong to this app: spawned by it, or running out of a
	// known workspace directory.
	const procs = useMemo<ProcRow[]>(() => {
		if (!rows) return [];
		const roots = workspaces
			.map((w) => w.path.replace(/\/+$/, ""))
			.filter((p) => p.length > 1);
		const byPid = new Map<number, ProcRow>();
		for (const s of rows) {
			const cwd = s.cwd;
			const inWorkspace =
				cwd != null &&
				roots.some((r) => cwd === r || cwd.startsWith(`${r}/`));
			if (!s.startedByApp && !inWorkspace) continue;
			const existing = byPid.get(s.pid);
			if (existing) {
				if (!existing.ports.includes(s.port)) existing.ports.push(s.port);
				continue;
			}
			byPid.set(s.pid, {
				pid: s.pid,
				name: s.name,
				ports: [s.port],
				command: s.command,
				memoryKb: s.memoryKb,
				startedByApp: s.startedByApp,
			});
		}
		return [...byPid.values()].sort(
			(a, b) => (b.memoryKb ?? 0) - (a.memoryKb ?? 0),
		);
	}, [rows, workspaces]);

	if (!open) return null;

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 z-40"
				onMouseDown={(e) => {
					if (e.target === e.currentTarget) {
						onClose();
					}
				}}
			/>

			{/* Floating card */}
			<div
				onClick={(e) => e.stopPropagation()}
				className={clsx(
					"absolute z-50 w-72 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-divider)] shadow-apple-modal p-3.5 text-neutral-200 select-none",
					className,
				)}
			>
				{/* Header */}
				<div className="mb-3 flex items-center justify-between border-b border-[var(--border-divider)] pb-2">
					<div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-100">
						<Activity size={14} className="text-emerald-400" />
						<span>性能</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						<X size={12} />
					</button>
				</div>

				{/* App itself */}
				<div
					className="flex items-center justify-between text-xs"
					title={`含 ${processes} 个进程（本体+WebView/帮助进程）`}
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<AppWindow size={12} className="shrink-0 text-[#0A84FF]" />
						<span
							className="truncate text-neutral-300"
							title={`含 ${processes} 个进程（本体+WebView/帮助进程）`}
						>
							omp-workspace (本体)
						</span>
					</div>
					<span className="shrink-0 font-mono tabular-nums text-neutral-200">
						{appMemory ?? "—"}
					</span>
				</div>

				{/* Service processes */}
				<div className="mt-3 border-t border-[var(--border-divider)] pt-2.5">
					<div className="mb-1.5 text-[10px] font-medium tracking-wide text-neutral-500">
						服务进程
					</div>
					{rows === null ? (
						<div className="py-2 text-center text-[11px] text-neutral-500">
							加载中…
						</div>
					) : procs.length === 0 ? (
						<div className="py-2 text-center text-[11px] text-neutral-500">
							未发现本应用启动的进程
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
													? "text-emerald-400"
													: "text-neutral-500",
											)}
										/>
										<span className="truncate text-neutral-300">
											{p.name}
										</span>
										<span className="shrink-0 font-mono text-neutral-500">
											:{p.ports.join(",:")}
										</span>
									</div>
									<span className="shrink-0 font-mono tabular-nums text-neutral-200">
										{formatKb(p.memoryKb)}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</>
	);
}
