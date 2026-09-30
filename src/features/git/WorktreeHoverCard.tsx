import { GitBranch, GitCommit, Layers } from "lucide-react";
import type { WorktreeInfo } from "../../lib/contracts";
import { useHomeDir } from "../../lib/hooks";
import { shortPath } from "../../lib/paths";
import { FloatingLayer } from "../../components/FloatingLayer";

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
 * Renders via FloatingLayer (layer="hovercard", placement="left-start" or "right-start").
 * Clamped strictly above the status bar with internal scrolling on overflow.
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
	const home = useHomeDir();

	if (!open || !anchorRect) return null;

	const targetPath = wt?.path ?? path ?? "";
	const targetBranch = wt?.branch ?? title ?? "main";
	const isMainRepo = !wt ? (targetPath ? !targetPath.includes(".worktrees") : true) : !wt.path.includes(".worktrees");
	const effectiveSessionCount = wt?.sessionIds?.length ?? sessionCount ?? 0;
	const dirtyCount = wt?.dirty ?? 0;

	return (
		<FloatingLayer
			anchor={open ? anchorRect : null}
			placement={side === "right" ? "right-start" : "left-start"}
			offset={8}
			layer="hovercard"
			onDismiss={onClose}
			onMouseEnter={onMouseEnterCard}
			onMouseLeave={onMouseLeaveCard}
			className="w-[300px] p-3 text-xs text-neutral-200 select-none space-y-2.5 animate-in fade-in zoom-in-95 duration-100"
		>
			{/* Top Header: Target Name & Tag */}
			<div className="space-y-1">
				<div className="flex items-center justify-between gap-1.5 min-w-0">
					<div className="flex items-center gap-1.5 min-w-0">
						<GitBranch
							size={13}
							className={isCurrent ? "text-emerald-400 shrink-0" : "text-neutral-400 shrink-0"}
						/>
						<span className="font-mono text-sm font-semibold text-neutral-100 truncate">
							{targetBranch}
						</span>
					</div>
					{isCurrent && (
						<span className="shrink-0 rounded bg-emerald-950/80 border border-emerald-800/60 px-1.5 py-0.2 text-[9px] text-emerald-300 font-sans">
							当前环境
						</span>
					)}
					{isMainRepo && !isCurrent && (
						<span className="shrink-0 rounded bg-neutral-800 border border-neutral-700 px-1.5 py-0.2 text-[9px] text-neutral-400 font-sans">
							主仓库
						</span>
					)}
				</div>
			</div>

			{/* PATH / DIRECTORY Section */}
			{targetPath && (
				<div className="space-y-0.5 text-[11px] text-neutral-400 pt-1.5 border-t border-neutral-800/80">
					<div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
						LOCAL DIRECTORY
					</div>
					<div className="font-mono truncate text-[11px] text-neutral-300" title={targetPath}>
						{shortPath(targetPath, home)}
					</div>
				</div>
			)}

			{/* STATS Section: Sessions & Head Commit / Status */}
			<div className="pt-1.5 border-t border-neutral-800/60 flex items-center justify-between text-[11px] text-neutral-400">
				<div className="flex items-center gap-1">
					<Layers size={11} className="text-indigo-400" />
					<span>
						关联 <strong className="font-mono text-neutral-200">{effectiveSessionCount}</strong> 个会话
					</span>
				</div>

				{wt?.head && (
					<div className="flex items-center gap-1 font-mono text-[10px] text-neutral-500">
						<GitCommit size={10} />
						<span>{wt.head.slice(0, 7)}</span>
					</div>
				)}
			</div>

			{/* Dirty Status Pill if any changes exist */}
			{dirtyCount > 0 && (
				<div className="pt-1 flex items-center gap-1 text-[10px] text-amber-400 font-medium">
					<span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.5)]" />
					<span>包含 {dirtyCount} 处未提交的代码改动</span>
				</div>
			)}
		</FloatingLayer>
	);
}
