import { GitBranch, GitCommit, Layers } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorktreeInfo } from "../../lib/contracts";
import { useHomeDir } from "../../lib/hooks";
import { shortPath } from "../../lib/paths";

export interface WorktreeHoverCardProps {
	/** Worktree information or null */
	wt?: WorktreeInfo | null;
	/** Custom title for repo-level header */
	title?: string;
	/** Custom path */
	path?: string;
	anchorRect: DOMRect | null;
	open: boolean;
	isCurrent?: boolean;
	/** Which side to open relative to the anchor: "left" (for right sidebar) or "right" (for left sidebar). Default: "left" */
	side?: "left" | "right";
	/** Custom session count if wt object is not provided */
	sessionCount?: number;
	onMouseEnterCard?: () => void;
	onMouseLeaveCard?: () => void;
	onClose?: () => void;
}

/**
 * Floating hover card for right-side Git worktree and branch items:
 * Renders via React portal into document.body.
 * Opens to the LEFT of the anchor to make full use of the wide center workspace.
 */
export function WorktreeHoverCard({
	wt,
	title,
	path,
	anchorRect,
	open,
	isCurrent = false,
	side = "left",
	sessionCount,
	onMouseEnterCard,
	onMouseLeaveCard,
	onClose,
}: WorktreeHoverCardProps) {
	const cardRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
	const home = useHomeDir();

	const cardWidth = 300;

	useLayoutEffect(() => {
		if (!open || !anchorRect) return;

		const cardEl = cardRef.current;
		const cardHeight = cardEl ? cardEl.offsetHeight : 170;
		const viewportHeight = window.innerHeight;

		const viewportWidth = window.innerWidth;
		let left: number;
		if (side === "right") {
			// Open to the RIGHT of the left-sidebar anchor
			left = Math.min(viewportWidth - cardWidth - 16, anchorRect.right + 10);
		} else {
			// Open to the LEFT of the right-sidebar anchor
			left = Math.max(16, anchorRect.left - cardWidth - 10);
		}
		let top = anchorRect.top - 10;

		// Screen boundary collision handling
		if (top + cardHeight > viewportHeight - 16) {
			top = Math.max(16, viewportHeight - cardHeight - 16);
		}
		if (top < 16) {
			top = 16;
		}

		setPosition({ top, left });
	}, [open, anchorRect, side]);

	// Close immediately on any global mouse down (e.g. clicking an action button or opening a modal)
	useEffect(() => {
		if (!open) return;
		const handleGlobalMouseDown = () => {
			onClose?.();
		};
		window.addEventListener("mousedown", handleGlobalMouseDown, { capture: true });
		return () => {
			window.removeEventListener("mousedown", handleGlobalMouseDown, { capture: true });
		};
	}, [open, onClose]);

	if (!open || !anchorRect) return null;

	const targetPath = wt?.path ?? path ?? "";
	const targetBranch = wt?.branch ?? title ?? "main";
	const isMainRepo = !wt ? (targetPath ? !targetPath.includes(".worktrees") : true) : !wt.path.includes(".worktrees");
	const effectiveSessionCount = wt?.sessionIds?.length ?? sessionCount ?? 0;
	const dirtyCount = wt?.dirty ?? 0;

	const cardContent = (
		<div
			ref={cardRef}
			style={{
				position: "fixed",
				top: `${position.top}px`,
				left: `${position.left}px`,
				width: `${cardWidth}px`,
				zIndex: 40,
			}}
			onMouseEnter={onMouseEnterCard}
			onMouseLeave={onMouseLeaveCard}
			className="rounded-xl border border-neutral-700/80 bg-neutral-900/95 p-3 text-xs text-neutral-200 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none space-y-2.5 pointer-events-none"
		>
			{/* Header: Full unclipped Branch/Worktree Name */}
			<div className="space-y-1">
				<div className="flex items-start gap-1.5 font-mono text-xs font-semibold text-neutral-100 leading-snug">
					<GitBranch size={13} className={isCurrent ? "text-emerald-400 shrink-0 mt-0.5" : "text-neutral-400 shrink-0 mt-0.5"} />
					<span className="break-all">{targetBranch}</span>
				</div>
				<div className="flex items-center gap-1 text-[10px]">
					{isMainRepo ? (
						<span className="rounded bg-neutral-800 px-1.5 py-0.2 text-neutral-300">
							原始主目录
						</span>
					) : (
						<span className="rounded bg-indigo-950/80 border border-indigo-800/60 px-1.5 py-0.2 text-indigo-300">
							并行工作树
						</span>
					)}
					{isCurrent && (
						<span className="rounded bg-emerald-950/80 border border-emerald-800/60 px-1.5 py-0.2 text-emerald-300 font-medium">
							当前检出
						</span>
					)}
				</div>
			</div>

			{/* PATH section */}
			{targetPath && (
				<div className="space-y-0.5 pt-1.5 border-t border-neutral-800/80">
					<div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
						PATH
					</div>
					<div className="font-mono text-[11px] text-neutral-300 break-all" title={targetPath}>
						{shortPath(targetPath, home)}
					</div>
				</div>
			)}

			{/* Status & Metrics */}
			<div className="pt-1.5 border-t border-neutral-800/80 flex items-center justify-between text-[11px]">
				<div className="flex items-center gap-1.5">
					{dirtyCount > 0 ? (
						<span className="rounded bg-amber-950/70 border border-amber-800/50 px-1.5 py-0.2 text-amber-300 text-[10px]">
							{dirtyCount} 处未提交改动
						</span>
					) : (
						<span className="text-neutral-500 text-[10px]">工作区干净（无改动）</span>
					)}
				</div>
				{effectiveSessionCount > 0 && (
					<div className="flex items-center gap-1 text-[10px] text-neutral-400">
						<Layers size={10} className="text-indigo-400" />
						<span>{effectiveSessionCount} 会话</span>
					</div>
				)}
			</div>

			{/* Commit Head if present */}
			{wt?.head && (
				<div className="pt-1 border-t border-neutral-800/60 flex items-center gap-1 text-[10px] font-mono text-neutral-500">
					<GitCommit size={10} />
					<span>HEAD: {wt.head.slice(0, 7)}</span>
				</div>
			)}
		</div>
	);

	return createPortal(cardContent, document.body);
}
