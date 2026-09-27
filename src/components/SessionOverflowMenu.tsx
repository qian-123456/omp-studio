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
	FolderOpen,
	MoreHorizontal,
	QrCode,
	RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { rpcRestart } from "../lib/ipc";
import { toast } from "../lib/toast";

export interface SessionOverflowMenuProps {
	sessionId: string;
	cwd?: string | null;
	onOpenInFinder?: () => void;
	onCopyMarkdown?: () => void;
	onMobilePair?: () => void;
	className?: string;
}

export function SessionOverflowMenu({
	sessionId,
	cwd,
	onOpenInFinder,
	onCopyMarkdown,
	onMobilePair,
	className,
}: SessionOverflowMenuProps) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

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

	return (
		<div className={clsx("relative", className)} ref={ref}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label="更多会话操作"
				aria-haspopup="menu"
				aria-expanded={open}
				title="更多操作"
				className={clsx(
					"flex h-7 w-7 items-center justify-center rounded-md transition-colors",
					open
						? "bg-neutral-800 text-neutral-100"
						: "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
				)}
			>
				<MoreHorizontal size={14} />
			</button>

			{open && (
				<div
					role="menu"
					aria-orientation="vertical"
					className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-neutral-700 bg-neutral-900 p-1 text-xs shadow-xl"
				>
					{/* Section 1: 会话弹性与恢复 */}
					<div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
						会话连接与维护
					</div>

					{/* /fresh equivalent: 重置流连接（保留历史） */}
					<button
						type="button"
						role="menuitem"
						disabled={busy}
						onClick={handleFreshRestart}
						className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-neutral-200 hover:bg-neutral-800 hover:text-white disabled:opacity-50 transition-colors"
						title="重启 RPC 进程并重置提供商与网络连接，保留完整本地历史"
					>
						<RefreshCw
							size={13}
							className={clsx("shrink-0 text-emerald-400", busy && "animate-spin")}
						/>
						<span className="flex-1 truncate">重置流连接（保留历史）</span>
					</button>

					{/* /clear equivalent: 清空上下文（保留会话） */}
					<button
						type="button"
						role="menuitem"
						onClick={handleClearContextNotice}
						className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
						title="清空上下文（保留会话）：当前 CLI 后端在 RPC 模式下暂不支持"
					>
						<Eraser size={13} className="shrink-0 text-neutral-400" />
						<span className="flex-1 truncate">清空上下文（保留会话）</span>
						<span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
							未支持
						</span>
					</button>

					<div className="my-1 border-t border-neutral-800" />

					{/* Section 2: 折叠的常用操作 (Task C fold) */}
					<div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-neutral-400">
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
							className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-30 transition-colors"
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
							className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
						>
							<Copy size={13} className="shrink-0 text-neutral-400" />
							<span className="flex-1 truncate">复制为 Markdown</span>
						</button>
					)}

					{/* 手机扫码查看 */}
					{onMobilePair && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								onMobilePair();
							}}
							className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
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
