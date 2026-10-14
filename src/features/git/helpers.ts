/** Pure helpers shared by the git / services / editor features (module C). */

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { createElement } from "react";
import type { SessionMeta } from "../../lib/contracts";
import { isInside } from "../../lib/paths";

/**
 * Expander footer row for capped lists: `还有 N {unit} · 展开` toggling to `收起`.
 * Renders nothing when collapsed and nothing is hidden (n <= 0).
 * Lives in this .ts file, so it uses createElement instead of JSX.
 */
export function ListMore({
	n,
	expanded,
	onToggle,
	unit = "项",
	className,
}: {
	/** Hidden item count while collapsed. */
	n: number;
	expanded: boolean;
	onToggle: () => void;
	/** Counter noun, e.g. "个文件" / "条". */
	unit?: string;
	className?: string;
}): ReactNode {
	if (!expanded && n <= 0) return null;
	return createElement(
		"button",
		{
			type: "button",
			onClick: onToggle,
			className: clsx(
				"flex w-full items-center justify-center gap-0.5 rounded py-1 text-[11px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors",
				className,
			),
		},
		createElement(ChevronDown, {
			size: 12,
			className: clsx("transition-transform", expanded && "rotate-180"),
		}),
		expanded ? "收起" : `还有 ${n} ${unit} · 展开`,
	);
}

/** Toplevel of the worktree containing `cwd` (deepest match), else `cwd`. */
export function toplevelFor(cwd: string, worktreePaths: string[]): string {
	const hits = worktreePaths.filter((p) => isInside(cwd, p));
	if (hits.length === 0) return cwd;
	return hits.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Worktree/branch slug from free text (ASCII only), else a timestamp slug. */
export function defaultSlug(text: string, now: Date = new Date()): string {
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 5);
	const slug = words.join("-").slice(0, 40).replace(/-+$/, "");
	if (slug.length >= 3) return slug;
	const pad = (n: number) => String(n).padStart(2, "0");
	return `s-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Sessions currently running (live or working) in the same repo as `cwd`. */
export function runningInRepo(sessions: SessionMeta[], cwd: string): SessionMeta[] {
	if (!cwd) return [];
	return sessions.filter((s) => {
		if (!(s.live || s.status === "working")) return false;
		const root = s.repoRoot ?? s.cwd;
		return isInside(cwd, root) || isInside(s.cwd, cwd);
	});
}

/** Line tail of a log buffer. */
export function appendLog(lines: string[], line: string, max = 300): string[] {
	const next = lines.length >= max ? lines.slice(lines.length - max + 1) : lines.slice();
	next.push(line);
	return next;
}

/** Strip ANSI escape sequences from terminal log text. */
export function stripAnsi(text: string): string {
	return text.replace(
		/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]/g,
		"",
	);
}

/** Extract main repo root from a worktree path under `.worktrees/`. */
export function repoRootFromWorktree(wtPath: string): string {
	const idx = wtPath.indexOf("/.worktrees/");
	if (idx !== -1) return wtPath.slice(0, idx);
	const winIdx = wtPath.indexOf("\\.worktrees\\");
	if (winIdx !== -1) return wtPath.slice(0, winIdx);
	return wtPath;
}

/** Tab of the worktree detail pane. */
export type GitPaneTab = "changes" | "history";

/**
 * Effective detail-pane tab: a `manual` pick (segmented-control click) wins while
 * set; `count === null` means the summary has not loaded yet, so keep showing the
 * last `fallback` tab instead of flashing either pane. Once loaded, an empty
 * worktree auto-shows history, a dirty one auto-shows changes.
 */
export function paneTab(
	count: number | null,
	manual: GitPaneTab | null,
	fallback: GitPaneTab,
): GitPaneTab {
	return manual ?? (count === null ? fallback : count === 0 ? "history" : "changes");
}

/** True when a loaded change count crosses the empty/non-empty boundary. */
export function countCrossedEmpty(prev: number | null, next: number | null): boolean {
	return prev !== null && next !== null && prev !== next && (prev === 0 || next === 0);
}
