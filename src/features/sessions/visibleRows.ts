/**
 * Single source of truth for "which session rows the user can see, in what
 * order": the sidebar DOM itself. Paging ("展开 N 条"), collapsed groups and
 * subgroups, search and the workspace filter all decide what gets rendered,
 * so reading rendered rows at event time can never disagree with the screen
 * (a memoized id list did — shift-range select picked up paged-out rows).
 */

/** Attribute placed on the sidebar's scroll container. */
export const SIDEBAR_LIST_ATTR = "data-sidebar-list";

/** Ordered, de-duplicated ids of session rows currently rendered in the sidebar. */
export function getVisibleSessionIds(): string[] {
	if (typeof document === "undefined") return [];
	const root = document.querySelector(`[${SIDEBAR_LIST_ATTR}]`);
	if (!root) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const el of root.querySelectorAll<HTMLElement>("[data-session-id]")) {
		const id = el.dataset.sessionId;
		if (id && !seen.has(id)) {
			seen.add(id);
			out.push(id);
		}
	}
	return out;
}

/**
 * Row to select after `removed` rows leave the list: the first surviving row
 * after the first removed one, else the closest surviving row before it.
 * Returns null when nothing survives or `removed` is not on screen.
 */
export function neighborAfterRemoval(
	removed: readonly string[],
	ids: readonly string[] = getVisibleSessionIds(),
): string | null {
	const gone = new Set(removed);
	const first = ids.findIndex((id) => gone.has(id));
	if (first < 0) return null;
	for (let i = first + 1; i < ids.length; i++) {
		if (!gone.has(ids[i])) return ids[i];
	}
	for (let i = first - 1; i >= 0; i--) {
		if (!gone.has(ids[i])) return ids[i];
	}
	return null;
}
