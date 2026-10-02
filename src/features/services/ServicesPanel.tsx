import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	AlertTriangle,
	Copy,
	ExternalLink,
	FolderOpen,
	Loader2,
	RefreshCw,
	RotateCcw,
	Square,
	TerminalSquare,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceInfo } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { onServicesChanged } from "../../lib/events";
import { useShortPath } from "../../lib/hooks";
import { servicesList, servicesStop } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useDrawerStore, type DrawerTab } from "../terminal/drawerStore";
import { destroyDrawerTerminal } from "../terminal/drawerRegistry";
export function ServicesPanel() {
	const [all, setAll] = useState(false);
	const [rows, setRows] = useState<ServiceInfo[] | null>(null);
	const sessions = useSessions((s) => s.sessions);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const [stoppingPids, setStoppingPids] = useState<Set<number>>(new Set());
	const [cleaningOrphans, setCleaningOrphans] = useState(false);
	const [displayLimit, setDisplayLimit] = useState(50);
	const selectSession = useUi((s) => s.selectSession);
	const short = useShortPath();
	const tabs = useDrawerStore((s) => s.tabs);
	const detachedTabs = tabs.filter((t) => t.detached);
	const reattachTab = useDrawerStore((s) => s.reattachTab);
	const removeTab = useDrawerStore((s) => s.removeTab);
	const allRef = useRef(all);
	allRef.current = all;
	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			setRows(await servicesList(allRef.current));
			setError(null);
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(`获取服务列表失败: ${msg}`);
		} finally {
			setLoading(false);
		}
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the filter flips
	useEffect(() => {
		refresh();
	}, [all, refresh]);

	useEffect(() => {
		// Payload is the default (dev-only) list; "all" mode refetches.
		const un = onServicesChanged((list) =>
			allRef.current ? refresh() : setRows(list),
		);
		return () => {
			un.then((f) => f());
		};
	}, [refresh]);

	const stop = async (s: ServiceInfo) => {
		const ok = await confirmDialog(
			`确定停止 ${s.name}（PID ${s.pid}，端口 :${s.port}）吗？`,
			{
				danger: true,
				title: "停止服务",
				okLabel: "停止",
			},
		);
		if (!ok) return;

		setStoppingPids((prev) => new Set(prev).add(s.pid));
		try {
			await servicesStop(s.pid);
			toast.success(`服务 :${s.port} 已停止`);
			await refresh();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(`停止服务失败: ${msg}`);
		} finally {
			setStoppingPids((prev) => {
				const next = new Set(prev);
				next.delete(s.pid);
				return next;
			});
		}
	};

	const copy = async (s: ServiceInfo) => {
		const key = `${s.pid}:${s.port}`;
		try {
			await copyText(s.url);
			setCopiedKey(key);
			toast.success("已复制服务地址");
			setTimeout(() => {
				setCopiedKey((c) => (c === key ? null : c));
			}, 1500);
		} catch (e) {
			toast.error(`复制失败: ${errMsg(e)}`);
		}
	};

	const handleOpenBrowser = async (url: string) => {
		try {
			await openUrl(url);
		} catch (e) {
			toast.error(`在浏览器打开失败: ${errMsg(e)}`);
		}
	};

	const handleRevealCwd = async (cwd: string | null | undefined) => {
		if (!cwd) return;
		try {
			await revealItemInDir(cwd);
		} catch {
			try {
				await openPath(cwd);
			} catch (e) {
				toast.error(`在文件管理器中打开失败: ${errMsg(e)}`);
			}
		}
	};

	// Detect orphan services: service has a sessionId, but that session is no longer live or active
	const orphanServices =
		rows?.filter((s) => {
			if (!s.sessionId) return false;
			const sess = sessions[s.sessionId];
			return !sess || !sess.live;
		}) ?? [];

	const handleCleanOrphans = async () => {
		if (orphanServices.length === 0) return;
		const ok = await confirmDialog(
			`确定停止所有 ${orphanServices.length} 个残留服务吗？这些服务所属的会话已结束。`,
			{
				danger: true,
				title: "清理残留服务",
				okLabel: "全部停止",
			},
		);
		if (!ok) return;

		setCleaningOrphans(true);
		try {
			await Promise.allSettled(
				orphanServices.map((srv) => servicesStop(srv.pid)),
			);
			toast.success("已清理残留服务");
			await refresh();
		} catch (e) {
			toast.error(`清理失败: ${errMsg(e)}`);
		} finally {
			setCleaningOrphans(false);
		}
	};
	const handleReattachTerminal = useCallback(
		(tabId: string, title: string) => {
			reattachTab(tabId);
			useUi.getState().setRightTab("terminal");
			toast.success(`已恢复终端「${title}」`);
		},
		[reattachTab],
	);

	const handleTerminateTerminal = useCallback(
		async (tab: DrawerTab) => {
			const ok = await confirmDialog(`确定要结束后台终端「${tab.title}」吗？`, {
				danger: true,
				title: "结束后台终端",
				okLabel: "结束进程",
			});
			if (!ok) return;
			destroyDrawerTerminal(tab.id);
			removeTab(tab.id);
			toast.success(`已结束终端「${tab.title}」`);
		},
		[removeTab],
	);


	return (
		<div className="flex h-full flex-col text-xs">
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-divider)] px-3 py-2">
				<span className="flex-1 font-medium text-[var(--text)]">
					本地服务{" "}
					{rows && (
						<span className="font-mono text-neutral-500">({rows.length})</span>
					)}
				</span>
				<label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-400 select-none">
					<input
						type="checkbox"
						checked={all}
						onChange={(e) => {
							setAll(e.target.checked);
							setDisplayLimit(50);
						}}
						className="rounded border-[var(--border-divider)] bg-[var(--well-bg)] text-[#0A84FF] focus:ring-0"
					/>
					显示全部端口
				</label>
				<button
					type="button"
					title="刷新服务列表"
					onClick={refresh}
					className="rounded-lg p-1.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
				>
					<RefreshCw size={13} className={loading ? "animate-spin" : ""} />
				</button>
			</div>
			{/* Detached background terminals block */}
			{detachedTabs.length > 0 && (
				<div className="shrink-0 border-b border-[var(--border-divider)] bg-[var(--well-bg)]/40 p-2.5">
					<div className="mb-2 flex items-center justify-between text-[11px] font-medium text-neutral-300">
						<span className="flex items-center gap-1.5">
							<TerminalSquare size={13} className="text-[#0A84FF]" />
							后台终端 ({detachedTabs.length})
						</span>
						<span className="text-[10px] text-neutral-500">已从终端折叠</span>
					</div>
					<div className="space-y-1.5">
						{detachedTabs.map((tab) => (
							<div
								key={tab.id}
								className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2.5 py-1.5 transition-colors hover:border-neutral-700"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-1.5">
										<span className="truncate font-medium text-neutral-200">
											{tab.title}
										</span>
										{tab.status === "exited" ? (
											<span className="rounded border border-neutral-700/60 bg-neutral-800/40 px-1 py-0.2 text-[10px] text-neutral-400">
												已退出{tab.exitCode !== null ? ` (${tab.exitCode})` : ""}
											</span>
										) : (
											<span className="flex shrink-0 items-center gap-1 rounded border border-emerald-800/50 bg-emerald-950/50 px-1 py-0.2 text-[10px] text-emerald-400">
												<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
												运行中
											</span>
										)}
									</div>
									<div className="mt-0.5 flex items-center gap-1 text-[10px] text-neutral-500">
										<FolderOpen size={10} className="shrink-0 text-neutral-500" />
										<span className="truncate" title={tab.cwd}>
											{short(tab.cwd)}
										</span>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<button
										type="button"
										onClick={() => handleReattachTerminal(tab.id, tab.title)}
										className="flex items-center gap-1 rounded bg-[#0A84FF] px-2 py-0.5 text-[11px] font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-xs"
										title="恢复到终端"
									>
										<RotateCcw size={10} />
										恢复
									</button>
									<button
										type="button"
										onClick={() => void handleTerminateTerminal(tab)}
										className="flex items-center gap-1 rounded border border-rose-800/60 bg-rose-950/30 px-2 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-900/50 active:scale-95 transition-all"
										title="结束终端进程并移除"
									>
										<Square size={10} />
										结束
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Orphan services banner */}
			{orphanServices.length > 0 && (
				<div className="m-2 flex items-center justify-between gap-2 rounded-md border border-amber-600/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
					<div className="flex items-center gap-2 min-w-0">
						<AlertTriangle size={14} className="shrink-0 text-amber-400" />
						<span className="truncate">
							{orphanServices.length} 个残留服务（所属会话已结束）
						</span>
					</div>
					<button
						type="button"
						onClick={handleCleanOrphans}
						disabled={cleaningOrphans}
						className="flex shrink-0 items-center gap-1 rounded bg-amber-600/90 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
					>
						{cleaningOrphans && (
							<Loader2 size={11} className="animate-spin" />
						)}
						一键清理
					</button>
				</div>
			)}

			{error && <div className="px-3 py-1.5 text-rose-400">{error}</div>}

			{/* Loading skeleton */}
			{rows === null && loading && (
				<div className="space-y-3 p-3">
					<div className="flex items-center gap-2 text-neutral-500">
						<Loader2 size={13} className="animate-spin text-sky-400" />
						<span>正在扫描本地监听端口与服务…</span>
					</div>
					{[1, 2, 3].map((n) => (
						<div
							key={n}
							className="animate-pulse rounded border border-neutral-800/80 bg-neutral-900/40 p-2.5"
						>
							<div className="flex items-center justify-between">
								<div className="h-4 w-20 rounded bg-neutral-800" />
								<div className="h-4 w-14 rounded bg-neutral-800" />
							</div>
							<div className="mt-2 h-3 w-40 rounded bg-neutral-800/60" />
						</div>
					))}
				</div>
			)}

			{rows?.length === 0 && (
				<div className="p-8 text-center text-neutral-500 leading-relaxed">
					<p className="text-xs">
						{all
							? "没有检测到监听中的端口"
							: "没有检测到开发服务（可勾选右上角「显示全部端口」）"}
					</p>
				</div>
			)}

			<ul className="min-h-0 flex-1 overflow-y-auto">
				{rows?.slice(0, displayLimit).map((s) => {
					const session = s.sessionId ? sessions[s.sessionId] : undefined;
					const key = `${s.pid}:${s.port}`;
					const isStopping = stoppingPids.has(s.pid);
					const isCopied = copiedKey === key;
					const isOrphan = s.sessionId && (!session || !session.live);

					return (
						<li
							key={key}
							className={clsx(
								"group border-b border-[var(--border-divider)] px-3 py-2 transition-colors",
								isOrphan
									? "bg-amber-500/5 hover:bg-amber-500/10"
									: "hover:bg-[var(--bg-hover)]",
							)}
						>
							<div className="flex items-center gap-2">
								<span className="font-mono text-sm font-semibold text-sky-400">
									:{s.port}
								</span>
								<span
									className="min-w-0 flex-1 truncate text-neutral-200"
									title={s.command || s.name}
								>
									<span className="font-medium">{s.name}</span>
									<span className="ml-1.5 font-mono text-[10px] text-neutral-500">
										pid {s.pid}
									</span>
									{s.startedByApp && (
										<span className="ml-1.5 rounded bg-emerald-950/50 px-1 py-0.2 text-[10px] text-emerald-400 border border-emerald-800/50">
											时光机
										</span>
									)}
									{isOrphan && (
										<span className="ml-1.5 rounded bg-amber-950/50 px-1 py-0.2 text-[10px] text-amber-400 border border-amber-800/50">
											残留
										</span>
									)}
								</span>
								<div className="flex shrink-0 items-center gap-0.5">
									<IconBtn
										title="在浏览器中打开此服务"
										onClick={() => handleOpenBrowser(s.url)}
									>
										<ExternalLink size={12} />
									</IconBtn>
									<IconBtn
										title={isCopied ? "已复制" : "复制服务地址"}
										onClick={() => copy(s)}
									>
										<Copy
											size={12}
											className={clsx(isCopied && "text-emerald-400")}
										/>
									</IconBtn>
									<IconBtn
										title={isStopping ? "正在停止…" : "停止此服务"}
										danger
										disabled={isStopping}
										onClick={() => stop(s)}
									>
										{isStopping ? (
											<Loader2 size={12} className="animate-spin text-rose-400" />
										) : (
											<Square size={12} />
										)}
									</IconBtn>
								</div>
							</div>

							<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-500">
								{s.cwd && (
									<button
										type="button"
										onClick={() => handleRevealCwd(s.cwd)}
										title={s.cwd}
										className="flex max-w-[220px] items-center gap-1 truncate text-left text-neutral-400 hover:text-sky-300 hover:underline transition-colors focus:opacity-100"
									>
										<FolderOpen size={11} className="shrink-0 text-neutral-500" />
										<span className="truncate">{short(s.cwd)}</span>
									</button>
								)}
								{session && (
									<button
										type="button"
										onClick={() => selectSession(session.id)}
										title={`切换到关联会话: ${session.label} ${session.title}`}
										className="shrink-0 text-indigo-400 hover:underline hover:text-indigo-300 transition-colors focus:opacity-100"
									>
										{session.label} {session.title}
									</button>
								)}
							</div>
						</li>
					);
				})}
				{rows && rows.length > displayLimit && (
					<li className="p-3 text-center border-b border-[var(--border-divider)]">
						<button
							type="button"
							onClick={() => setDisplayLimit((n) => n + 50)}
							className="text-xs text-[#0A84FF] hover:underline font-medium"
						>
							展开更多（还有 {rows.length - displayLimit} 个端口）
						</button>
					</li>
				)}
			</ul>
		</div>
	);
}

function IconBtn({
	title,
	danger,
	disabled,
	onClick,
	children,
}: {
	title: string;
	danger?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			className={clsx(
				"rounded-lg p-1.5 min-w-[26px] min-h-[26px] flex items-center justify-center text-neutral-400 transition-colors focus:opacity-100",
				disabled && "opacity-40 cursor-not-allowed",
				!disabled &&
					(danger
						? "hover:bg-rose-500/10 hover:text-rose-400"
						: "hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"),
			)}
		>
			{children}
		</button>
	);
}
