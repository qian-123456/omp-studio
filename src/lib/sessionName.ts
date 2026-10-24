import type { SessionMeta } from "./contracts";
import { tNow } from "../stores/language";

/**
 * Display name for a session row/header.
 *
 * The canonical OMP title is shown verbatim, including the global session
 * number and project slug ("#209-omp-workspace 成品与人机差异分析"). The only
 * rewrite is dropping the legacy "分支：" prefix that old forks stored in the
 * title (the fork chip replaces it). An empty title falls back to the draft
 * label.
 */
export function sessionDisplayName(session: Pick<SessionMeta, "title">): string {
	const title = (session.title ?? "").trim();
	if (!title) return tNow("shell.newDraft");

	const rest = title.replace(/^分支[：:\s]\s*(?=\S)/, "").trim();
	return rest || title;
}

/** `sessionDisplayName` + fallback for objects where both may be empty. */
export function sessionDisplayNameOr<T extends Pick<SessionMeta, "title">>(
	session: T | null | undefined,
	fallback: string,
): string {
	if (!session) return fallback;
	const name = sessionDisplayName(session);
	return !session.title ? fallback : name;
}
