/** Open inline-edit drafts by transcript item id (outlive the virtualized row).
 *
 * Kept out of MessageList.tsx so the live store can prune it without importing
 * a component module.
 */
const editDrafts = new Map<string, string>();

export function hasEditDraft(itemId: string): boolean {
	return editDrafts.has(itemId);
}

export function getEditDraft(itemId: string): string | undefined {
	return editDrafts.get(itemId);
}

export function setEditDraft(itemId: string, text: string): void {
	editDrafts.set(itemId, text);
}

export function clearEditDraft(itemId: string): void {
	editDrafts.delete(itemId);
}

/** Drop inline-edit drafts of the given transcript item ids (their session was removed). */
export function pruneEditDrafts(itemIds: readonly string[]): void {
	for (const id of itemIds) editDrafts.delete(id);
}
