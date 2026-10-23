import { GitBranch } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { GitCommit, ServiceInfo, WorktreeInfo } from "../../lib/contracts";
import { timeAgo } from "../../lib/format";
import { useHomeDir } from "../../lib/hooks";
import { gitLog } from "../../lib/ipc";
import { shortPath } from "../../lib/paths";
import { useSessions } from "../../stores/sessions";
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
	/** Worktree sits in the collapsed idle group. */
	isIdle?: boolean;
	/** Local base branch the ahead/behind counts are measured against. */
	baseBranch?: string;
	/** Services listening inside this worktree. */
	services?: ServiceInfo[];
	/** Repo-level card: number of worktrees in the repo. */
	worktreeCount?: number;
	/** Which side to open relative to the anchor: "left" (for right sidebar) or "right" (for left sidebar). Default: "left" */
	side?: "left" | "right";
	/** Custom session count if wt object is not provided */
	sessionCount?: number;
	onMouseEnterCard?: () => void;
	onMouseLeaveCard?: () => void;
	onClose?: () => void;
}

// Last commit per HEAD sha; a commit never changes once a sha is known.
const commitCache = new Map<string, GitCommit | null>();
const COMMIT_CACHE_LIMIT = 100;

/** Lazily loads the HEAD commit of `path`, cached per head; null while loading/failed. */
export function useHeadCommit(path: string | undefined, head: string | undefined, enabled: boolean) {
	const key = path && head ? `${path}@${head}` : "";
	const [commit, setCommit] = useState<GitCommit | null>(() => commitCache.get(key) ?? null);
	useEffect(() => {
		if (!enabled || !key || !path) return;
		if (commitCache.has(key)) {
			setCommit(commitCache.get(key) ?? null);
			return;
		}
		setCommit(null);
		let alive = true;
		gitLog(path, 1)
			.then((h) => {
				const c = h.commits[0] ?? null;
				commitCache.set(key, c);
				if (commitCache.size > COMMIT_CACHE_LIMIT) {
					const oldest = commitCache.keys().next().value;
					if (oldest !== undefined) commitCache.delete(oldest);
				}
				if (alive) setCommit(c);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [enabled, key, path]);
	return commit;
}

function Tag({ tone, children }: { tone: "emerald" | "muted" | "amber"; children: string }) {
	return (
		<span
			className={
				tone === "emerald"
					? "shrink-0 rounded border border-emerald-800/60 bg-emerald-950/80 px-1.5 text-[9px] text-emerald-300"
					: tone === "amber"
						? "shrink-0 rounded border border-amber-800/60 bg-amber-950/60 px-1.5 text-[9px] text-amber-300"
						: "shrink-0 rounded border border-neutral-700 bg-neutral-800 px-1.5 text-[9px] text-neutral-400"
			}
		>
			{children}
		</span>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex gap-2">
			<span className="w-14 shrink-0 text-neutral-500">{label}</span>
			<div className="min-w-0 flex-1 space-y-0.5 text-neutral-300">{children}</div>
		</div>
	);
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
	isIdle = false,
	baseBranch = "main",
	services,
	worktreeCount,
	side = "left",
	sessionCount,
	onMouseEnterCard,
	onMouseLeaveCard,
	onClose,
}: WorktreeHoverCardProps) {
	const home = useHomeDir();
	const sessions = useSessions((s) => s.sessions);
	const visible = open && !!anchorRect;
	const commit = useHeadCommit(wt?.path, wt?.head, visible && !!wt);

	if (!visible) return null;

	const targetPath = wt?.path ?? path ?? "";
	const detached = !!wt && !wt.branch;
	const targetBranch = wt ? (wt.branch ?? `分离 HEAD · ${wt.head.slice(0, 7)}`) : (title ?? "main");
	const sessionIds = wt?.sessionIds ?? [];
	const effectiveSessionCount = wt ? sessionIds.length : (sessionCount ?? 0);
	const known = sessionIds.map((id) => sessions[id]).filter((s) => !!s);
	const running = known.filter((s) => s.status === "working").length;
	const recent = [...known].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
	const isBase = wt?.branch === baseBranch;

	const tag = isCurrent ? (
		<Tag tone="emerald">当前环境</Tag>
	) : detached ? (
		<Tag tone="amber">分离 HEAD</Tag>
	) : isIdle ? (
		<Tag tone="muted">闲置</Tag>
	) : null;

	const syncText = (() => {
		if (!wt || isBase) return null;
		if (wt.ahead === 0 && wt.behind === 0) return `与 ${baseBranch} 一致`;
		const parts: string[] = [];
		if (wt.ahead > 0) parts.push(`领先 ${baseBranch} ${wt.ahead} 个提交`);
		if (wt.behind > 0) parts.push(`落后 ${baseBranch} ${wt.behind} 个提交`);
		return parts.join("，");
	})();

	return (
		<FloatingLayer
			anchor={anchorRect}
			placement={side === "right" ? "right-start" : "left-start"}
			offset={8}
			layer="hovercard"
			onDismiss={onClose}
			onMouseEnter={onMouseEnterCard}
			onMouseLeave={onMouseLeaveCard}
			className="w-[320px] max-w-[calc(100vw-32px)] space-y-2 p-3 text-[11px] text-neutral-200 shadow-2xl select-none"
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<GitBranch size={13} className={isCurrent ? "shrink-0 text-emerald-400" : "shrink-0 text-neutral-400"} />
				<span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-neutral-100">
					{targetBranch}
				</span>
				{tag}
			</div>

			<div className="space-y-1.5 border-t border-[var(--border-divider)] pt-2">
				{wt ? (
					<Row label="状态">
						<div className={wt.dirty > 0 ? "text-amber-300" : undefined}>
							{wt.dirty > 0 ? `${wt.dirty} 个文件未提交` : "工作区干净"}
						</div>
						{syncText && <div>{syncText}</div>}
					</Row>
				) : (
					worktreeCount !== undefined && (
						<Row label="工作树">
							<div>{worktreeCount} 个</div>
						</Row>
					)
				)}

				{services && services.length > 0 && (
					<Row label="运行中">
						{services.map((s) => (
							<div key={`${s.pid}-${s.port}`} className="flex min-w-0 gap-1.5" title={s.command}>
								<span className="shrink-0 font-mono text-emerald-300">:{s.port}</span>
								<span className="min-w-0 truncate text-neutral-400">{s.name || s.command}</span>
							</div>
						))}
					</Row>
				)}

				{wt && (
					<Row label="最近提交">
						{commit ? (
							<div className="flex min-w-0 gap-1.5" title={commit.subject}>
								<span className="shrink-0 font-mono text-neutral-500">{commit.short}</span>
								<span className="min-w-0 flex-1 truncate">{commit.subject}</span>
								<span className="shrink-0 text-neutral-500">{timeAgo(commit.ts)}</span>
							</div>
						) : (
							<div className="font-mono text-neutral-500">{wt.head.slice(0, 7)}</div>
						)}
					</Row>
				)}

				{(wt || sessionCount !== undefined) && (
					<Row label="会话">
						<div>
							{effectiveSessionCount === 0
								? "暂无会话"
								: running > 0
									? `${effectiveSessionCount} 个，${running} 个运行中`
									: `${effectiveSessionCount} 个`}
						</div>
						{recent.map((s) => (
							<div key={s.id} className="truncate text-neutral-400">
								{s.title || s.id.slice(0, 8)}
							</div>
						))}
					</Row>
				)}
			</div>

			{targetPath && (
				<div className="truncate font-mono text-[10px] text-neutral-500" title={targetPath}>
					{shortPath(targetPath, home)}
				</div>
			)}
		</FloatingLayer>
	);
}
