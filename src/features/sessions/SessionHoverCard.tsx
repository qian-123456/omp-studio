import clsx from "clsx";
import { GitBranch, GitFork } from "lucide-react";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { sessionDisplayName } from "../../lib/sessionName";
import { shortPath } from "../../lib/paths";
import { useHomeDir } from "../../lib/hooks";
import { FloatingLayer } from "../../components/FloatingLayer";

export interface SessionHoverCardProps {
	session: SessionMeta;
	anchorRect: DOMRect | null;
	open: boolean;
	workspaces: Workspace[];
	/** Optional callback when hovering the card itself to prevent premature close */
	onMouseEnterCard?: () => void;
	onMouseLeaveCard?: () => void;
	onClose?: () => void;
}

/**
 * Superset-style floating workspace/session preview card:
 * Renders via FloatingLayer (layer="hovercard", placement="right-start").
 * Clamped strictly above the status bar with internal scrolling on overflow.
 */
export function SessionHoverCard({
	session,
	anchorRect,
	open,
	workspaces,
	onMouseEnterCard,
	onMouseLeaveCard,
	onClose,
}: SessionHoverCardProps) {
	const home = useHomeDir();

	if (!open || !anchorRect) return null;

	const title = sessionDisplayName(session);
	const branch = session.git?.worktree ?? session.git?.branch ?? null;
	const isWorktree = Boolean(session.git?.worktree);
	const matchedWs = workspaces.find((w) => w.id === session.workspaceId);

	return (
		<FloatingLayer
			anchor={open ? anchorRect : null}
			placement="right-start"
			offset={8}
			layer="hovercard"
			onDismiss={onClose}
			onMouseEnter={onMouseEnterCard}
			onMouseLeave={onMouseLeaveCard}
			className="w-[280px] p-3 text-xs text-neutral-200 select-none space-y-2.5 animate-in fade-in zoom-in-95 duration-100"
		>
			{/* Header: Full unclipped Title */}
			<div className="space-y-1">
				<div className="text-sm font-semibold text-neutral-100 break-words leading-snug">
					{title}
				</div>
				{session.parentId && (
					<div className="flex items-center gap-1 text-[11px] text-neutral-400">
						<GitFork size={11} className="shrink-0 text-indigo-400" />
						<span>分叉会话</span>
					</div>
				)}
			</div>

			{/* BRANCH Section (Superset signature) */}
			<div className="space-y-1 pt-1.5 border-t border-neutral-800/80">
				<div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
					BRANCH
				</div>
				<div className="flex items-center gap-1.5 font-mono text-xs text-neutral-200 min-w-0">
					<GitBranch
						size={12}
						className={clsx("shrink-0", isWorktree ? "text-emerald-400" : "text-neutral-400")}
					/>
					<span className="truncate" title={branch ?? "默认分支"}>
						{branch ?? "main"}
					</span>
					{isWorktree && (
						<span className="shrink-0 rounded bg-emerald-950/80 border border-emerald-800/60 px-1 py-0.2 text-[9px] text-emerald-300 font-sans">
							工作树
						</span>
					)}
				</div>
			</div>

			{/* CWD / Path section */}
			{session.cwd && (
				<div className="space-y-0.5 text-[11px] text-neutral-400">
					<div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
						DIRECTORY
					</div>
					<div className="font-mono truncate text-[11px] text-neutral-300" title={session.cwd}>
						{shortPath(session.cwd, home)}
					</div>
				</div>
			)}

			{/* Footer: relative time & model */}
			<div className="pt-1.5 border-t border-neutral-800/60 flex items-center justify-between text-[10px] text-neutral-500">
				<span>{relativeTime(session.updatedAt || session.createdAt)}</span>
				{matchedWs && (
					<span className="truncate max-w-[120px]" title={matchedWs.name}>
						{matchedWs.name}
					</span>
				)}
			</div>
		</FloatingLayer>
	);
}
