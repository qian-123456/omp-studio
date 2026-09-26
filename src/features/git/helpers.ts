/** Pure helpers shared by the git / services / editor features (module C). */

import type { SessionMeta } from "../../lib/contracts";
import { isInside } from "../../lib/paths";

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
