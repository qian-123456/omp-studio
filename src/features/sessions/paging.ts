import type { SessionMeta } from "../../lib/contracts";

/**
 * How many leading rows of a session list are rendered.
 *
 * Invariant: rendered rows are always a contiguous prefix — a row is never
 * shown with folded rows above it (no 「展开中间 N 条」 gap pill). The user's
 * paging count is the baseline; a live row (`needsAttention`) or the selected
 * row below it drags the cut down to just past the lowest such row, revealing
 * everything in between.
 */
export function visibleCut(
	sessions: readonly SessionMeta[],
	userCount: number,
	selectedSessionId: string | null,
	needsAttention: (s: SessionMeta) => boolean,
): number {
	const baseline = Math.max(0, Math.min(userCount, sessions.length));
	for (let i = sessions.length - 1; i >= baseline; i--) {
		const s = sessions[i];
		if (needsAttention(s) || s.id === selectedSessionId) return i + 1;
	}
	return baseline;
}
