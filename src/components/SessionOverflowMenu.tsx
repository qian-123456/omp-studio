/**
 * Session overflow actions menu (Task C fold + Task D resilience commands).
 * Folds low-frequency header actions (Finder, Share/Pair) and provides
 * resilience commands:
 * - /fresh equivalent: 重置流连接（保留历史） via rpcRestart
 * - /clear equivalent: 清空上下文（保留会话） honest backend limitation notice
 */
import {
	Copy,
	Eraser,
	FileDown,
	FolderOpen,
	MessageSquare,
	MoreHorizontal,
	QrCode,
	RefreshCw,
	TerminalSquare,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { rpcRestart, sessionExportHtml } from "../lib/ipc";
import { toast } from "../lib/toast";
import { useUi } from "../stores/ui";
export interface SessionOverflowMenuProps {
	sessionId: string;
	cwd?: string | null;
	onOpenInFinder?: () => void;
	onCopyMarkdown?: () => void;
	onMobilePair?: () => void;
	onToggleSessionTerminal?: () => void;
	className?: string;
}

export function SessionOverflowMenu({
	sessionId,
	cwd,
	onOpenInFinder,
	onCopyMarkdown,
	onMobilePair,
	onToggleSessionTerminal,
	className,
}: SessionOverflowMenuProps) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const sessionViewMode = useUi((s) => s.sessionViewMode[sessionId] ?? "chat");
	const setSessionViewMode = useUi((s) => s.setSessionViewMode);

	const handleToggleTerminal = () => {
		setOpen(false);
		if (onToggleSessionTerminal) {
			onToggleSessionTerminal();
		} else {
			setSessionViewMode(
				sessionId,
				sessionViewMode === "terminal" ? "chat" : "terminal",
			);
		}
	};

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("mousedown", onDown);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("mousedown", onDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const handleFreshRestart = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await rpcRestart(sessionId);
			toast.info("流连接已重置（本地历史已保留）");
			setOpen(false);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(`重置流连接失败: ${msg}`);
		} finally {
			setBusy(false);
		}
	};

	const handleClearContextNotice = () => {
		toast.info(
			"当前 omp CLI / RPC 后端暂不支持在保留同一会话的同时清空上下文（仅交互式 TUI 支持 /clear，RPC 模式未开放重置边界接口）。",
			5000,
		);
		setOpen(false);
	};

	const handleExportHtml = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const outPath = await sessionExportHtml(sessionId);
			toast.success(`已导出 HTML: ${outPath}`);
			try {
				await revealItemInDir(outPath);
			} catch (err) {
				console.warn("在访达中显示失败:", err);
			}
			setOpen(false);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(`导出 HTML 失败: ${msg}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={clsx("relative z-20", className)} ref={ref}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label="更多会话操作"
				aria-haspopup="menu"
				aria-expanded={open}
				title="更多操作"
				className={clsx(
					"flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-95",
					open
						? "bg-[var(--bg-active-fill)] text-neutral-100"
						: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
				)}
			>
				<MoreHorizontal size={14} />
			</button>

			{open && (
				<div
					role="menu"
					aria-orientation="vertical"
					className="absolute right-0 top-full z-[60] mt-1.5 w-60 rounded-xl vibrancy-popover shadow-apple-modal hairline p-1 text-xs"
				>
					{/* Section 1: 会话弹性与恢复 */}
					<div className="px-2.5 py-1 text-[10px] font-medium tracking-wider text-neutral-400/80 uppercase">
						会话连接与维护
					</div>

					{/* /fresh equivalent: 重置流连接（保留历史） */}
					<button
						type="button"
						role="menuitem"
						disabled={busy}
						onClick={handleFreshRestart}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40 transition-all active:scale-[0.98]"
						title="重启 RPC 进程并重置提供商与网络连接，保留完整本地历史"
					>
						<RefreshCw
							size={13}
							className={clsx("shrink-0 text-emerald-400", busy && "animate-spin")}
						/>
						<span className="flex-1 truncate">重置流连接（保留历史）</span>
					</button>

					{/* 会话终端接管 / 返回聊天视图 */}
					<button
						type="button"
						role="menuitem"
						onClick={handleToggleTerminal}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-all active:scale-[0.98]"
						title={
							sessionViewMode === "terminal"
								? "返回聊天视图"
								: "用完整终端接管此会话（omp --resume，可交互操作 Agent）"
						}
					>
						{sessionViewMode === "terminal" ? (
							<>
								<MessageSquare size={13} className="shrink-0 text-indigo-400" />
								<span className="flex-1 truncate">返回聊天视图</span>
							</>
						) : (
							<>
								<TerminalSquare size={13} className="shrink-0 text-neutral-400" />
								<span className="flex-1 truncate">在会话终端中打开</span>
							</>
						)}
					</button>

					{/* /clear equivalent: 清空上下文（保留会话） */}
					<button
						type="button"
						role="menuitem"
						onClick={handleClearContextNotice}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-all active:scale-[0.98]"
						title="清空上下文（保留会话）：当前 CLI 后端在 RPC 模式下暂不支持"
					>
						<Eraser size={13} className="shrink-0 text-neutral-400" />
						<span className="flex-1 truncate">清空上下文（保留会话）</span>
						<span className="shrink-0 rounded-md bg-amber-500/15 border border-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300 font-medium">
							未支持
						</span>
					</button>

					<div className="my-1 border-t border-[var(--border-divider)]" />

					{/* Section 2: 折叠的常用操作 (Task C fold) */}
					<div className="px-2.5 py-1 text-[10px] font-medium tracking-wider text-neutral-400/80 uppercase">
						快捷操作
					</div>

					{/* 在访达中显示 */}
					{onOpenInFinder && (
						<button
							type="button"
							role="menuitem"
							disabled={!cwd}
							onClick={() => {
								setOpen(false);
								onOpenInFinder();
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-30 transition-all active:scale-[0.98]"
							title={cwd ? `在访达中显示 (${cwd})` : "无工作目录"}
						>
							<FolderOpen size={13} className="shrink-0 text-neutral-400" />
							<span className="flex-1 truncate">在访达中显示</span>
						</button>
					)}

					{/* 复制为 Markdown */}
					{onCopyMarkdown && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								onCopyMarkdown();
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-all active:scale-[0.98]"
						>
							<Copy size={13} className="shrink-0 text-neutral-400" />
							<span className="flex-1 truncate">复制为 Markdown</span>
						</button>
					)}

					{/* 导出 HTML */}
					<button
						type="button"
						role="menuitem"
						disabled={busy}
						onClick={handleExportHtml}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40 transition-all active:scale-[0.98]"
						title="导出当前会话为独立 HTML 文件并在访达中显示"
					>
						<FileDown size={13} className="shrink-0 text-neutral-400" />
						<span className="flex-1 truncate">导出 HTML</span>
					</button>

					{/* 手机扫码查看 */}
					{onMobilePair && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								onMobilePair();
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-all active:scale-[0.98]"
						>
							<QrCode size={13} className="shrink-0 text-neutral-400" />
							<span className="flex-1 truncate">手机扫码查看</span>
						</button>
					)}
				</div>
			)}
		</div>
	);
}
