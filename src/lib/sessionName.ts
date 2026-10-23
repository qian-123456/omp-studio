import type { SessionMeta } from "./contracts";

/**
 * Display name for a session row/header.
 *
 * OMP writes its global session number and the project slug into the file
 * title: "#209-omp-workspace 成品与人机差异分析". Both are redundant — the
 * number is the session's label identity and the slug repeats the workspace
 * group header — so the display name strips them, leaving just the human
 * part. Custom names and titles that don't match the pattern pass through.
 */
export function sessionDisplayName(
	session: Pick<SessionMeta, "title" | "label"> & Partial<Pick<SessionMeta, "cwd">>,
): string {
	const title = (session.title ?? "").trim();
	const label = (session.label ?? "").trim();
	if (!title) return "新建的草稿";

	// Legacy forks stored a "分支：" / "分支 " prefix; the fork chip replaces it.
	let rest = title.replace(/^分支[：:\s]\s*(?=\S)/, "");
	if (!rest) rest = title;

	// 1. Strip leading `#<n>` (optionally `-`/` ` separated) when it is the
	//    session's own number — or when the session has no label at all.
	const num = /^#(\d+)[\s\-–—:：]*/.exec(rest);
	if (num) {
		const labelNum = label.match(/^#(\d+)/)?.[1];
		if (!labelNum || num[1] === labelNum) {
			rest = rest.slice(num[0].length);
		}
	}

	// 2. Strip the project slug (cwd basename) when it directly follows.
	//    "#209-omp-workspace X" → after step 1 "omp-workspace X" → "X".
	const cwd = session.cwd?.replace(/[/\\]+$/, "");
	const slug = cwd?.split(/[/\\]/).pop();
	if (slug) {
		const slugRe = new RegExp(`^${escapeRegExp(slug)}[\\s\\-–—:：]+`);
		const m2 = slugRe.exec(rest);
		if (m2) rest = rest.slice(m2[0].length);
	}

	rest = rest.trim();
	return rest || title;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `sessionDisplayName` + fallback for objects where both may be empty. */
export function sessionDisplayNameOr<
	T extends Pick<SessionMeta, "title" | "label"> & Partial<Pick<SessionMeta, "cwd">>,
>(session: T | null | undefined, fallback: string): string {
	if (!session) return fallback;
	const name = sessionDisplayName(session);
	return name === "新建的草稿" && !session.title ? fallback : name;
}
