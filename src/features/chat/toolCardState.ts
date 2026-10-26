/** Remembered open state of tool cards, keyed by session + call id.
 *
 * Lives outside ToolCard.tsx so non-component modules (the live store's
 * session pruning) can import it without making the component file a
 * non-component-export module, which forces a full reload on every edit in dev.
 */
const openToolCards = new Set<string>();

export function isToolCardOpen(key: string): boolean {
	return openToolCards.has(key);
}

export function setToolCardOpen(key: string, open: boolean): void {
	if (open) openToolCards.add(key);
	else openToolCards.delete(key);
}

/** Forget remembered open state of the given sessions (call when sessions are removed). */
export function pruneToolCards(sessionIds: readonly string[]): void {
	const prefixes = sessionIds.map((sid) => `${sid}:`);
	for (const key of [...openToolCards]) {
		if (prefixes.some((p) => key.startsWith(p))) openToolCards.delete(key);
	}
}
