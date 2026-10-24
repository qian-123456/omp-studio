import { FolderGit2, GitBranch, GitFork } from "lucide-react";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { sessionDisplayName } from "../../lib/sessionName";
import { shortPath } from "../../lib/paths";
import { useHomeDir } from "../../lib/hooks";
import { FloatingLayer } from "../../components/FloatingLayer";
import { useT } from "../../stores/language";

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
 * Labels in Chinese (R18/R19).
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
	const { t } = useT();
	const home = useHomeDir();

	if (!open || !anchorRect) return null;

	const title = sessionDisplayName(session);
	const hasGit = session.git !== null;
	const branch = session.git?.branch ?? null;
	const worktree = session.git?.worktree ?? null;
	const dirty = session.git?.dirty ?? 0;
	const result = session.result;
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
			className="w-[280px] p-3 text-xs text-[var(--text)] select-none space-y-2.5 bg-[var(--bg-panel)] shadow-apple-modal hairline rounded-2xl"
		>
			{/* Header: Full unclipped Title */}
			<div className="space-y-1">
				<div className="text-sm font-semibold text-[var(--text)] break-words leading-snug">
					{title}
				</div>
				{session.parentId && (
					<div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
						<GitFork size={11} className="shrink-0 text-indigo-400" />
						<span>{t("sessions.forkedSession")}</span>
					</div>
				)}
			</div>

			{/* 分支 Section */}
			<div className="space-y-1 pt-1.5 border-t border-[var(--border-divider)]">
				<div className="text-[10px] font-semibold text-[var(--text-dim)]">
					{t("sessions.branch")}
				</div>
				{hasGit ? (
					<div className="flex items-center justify-between gap-1.5 font-mono text-xs text-[var(--text)] min-w-0">
						<div className="flex items-center gap-1.5 min-w-0 truncate">
							<GitBranch size={12} className="shrink-0 text-[var(--text-muted)]" />
							<span className="truncate" title={branch ?? t("sessions.defaultBranch")}>
								{branch ?? t("sessions.defaultBranch")}
							</span>
						</div>
						{dirty > 0 && (
							<span className="shrink-0 text-[10px] text-amber-400 font-sans whitespace-nowrap">
								●{dirty} {t("sessions.uncommitted")}
							</span>
						)}
					</div>
				) : (
					<div className="text-[11px] text-[var(--text-dim)]">
						{t("sessions.nonGitDir")}
					</div>
				)}
			</div>

			{/* 工作树 Section (shown when separate worktree folder exists) */}
			{worktree && (
				<div className="space-y-1 pt-1.5 border-t border-[var(--border-divider)]">
					<div className="text-[10px] font-semibold text-[var(--text-dim)]">
						{t("sessions.worktree")}
					</div>
					<div className="flex items-center gap-1.5 font-mono text-xs text-[var(--text)] min-w-0">
						<FolderGit2 size={12} className="shrink-0 text-emerald-400" />
						<span className="truncate" title={worktree}>
							{worktree}
						</span>
						<span className="shrink-0 rounded bg-emerald-950/80 border border-emerald-800/60 px-1 py-0.2 text-[9px] text-emerald-300 font-sans">
							{t("sessions.isolatedWorktree")}
						</span>
					</div>
				</div>
			)}

			{/* 结果 Badge Section (when result present) */}
			{result && (
				<div className="space-y-1 pt-1.5 border-t border-[var(--border-divider)]">
					<div className="text-[10px] font-semibold text-[var(--text-dim)]">
						{t("sessions.result")}
					</div>
					<div className="flex items-center gap-1.5 text-xs text-[var(--text)] min-w-0">
						<span className="shrink-0">{result.ok ? "✅" : "❌"}</span>
						<span className="font-medium capitalize shrink-0">
							{result.kind}
						</span>
						{result.summary && (
							<span
								className="truncate text-[11px] text-[var(--text-muted)] font-mono"
								title={result.summary}
							>
								{result.summary}
							</span>
						)}
					</div>
				</div>
			)}

			{/* 目录 Section */}
			{session.cwd && (
				<div className="space-y-0.5 text-[11px] text-[var(--text-muted)] pt-1.5 border-t border-[var(--border-divider)]">
					<div className="text-[10px] font-semibold text-[var(--text-dim)]">
						{t("sessions.directory")}
					</div>
					<div
						className="font-mono truncate text-[11px] text-[var(--text)]"
						title={session.cwd}
					>
						{shortPath(session.cwd, home)}
					</div>
				</div>
			)}

			{/* Footer: relative time & workspace */}
			<div className="pt-1.5 border-t border-[var(--border-divider)] flex items-center justify-between text-[10px] text-[var(--text-dim)]">
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
