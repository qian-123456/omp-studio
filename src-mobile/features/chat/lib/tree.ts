/**
 * Conversation-tree helpers for the mobile chat: reuse the desktop pure
 * helpers (same parent-pointer semantics) and adapt them to the normalized
 * `Item` rows. The leaf id comes from `GET /sessions/{id}/tree`.
 */
import { filterToLeafPath, leafPathIds } from "../../../../src/features/chat/treePath";
import type { Item } from "../../../core/types";

export { filterToLeafPath, leafPathIds };

/** Version group of one entry among its same-kind siblings (file order). */
export interface TreeVersions {
	/** 0-based position of the current entry among `ids`. */
	index: number;
	/** Sibling count including the current entry. */
	total: number;
	/** Sibling entry ids, the current one included. */
	ids: string[];
}

/**
 * Sibling versions of `entryId`: rows sharing its parent and kind. The
 * current one is the sibling on the leaf path; null when there are no
 * siblings or none is on the path (rewound past the entry).
 */
export function treeVersions(
	items: readonly Item[],
	leafId: string | null,
	entryId: string,
): TreeVersions | null {
	const self = items.find((it) => it.id === entryId);
	if (!self) return null;
	const siblings = items.filter(
		(it) => it.kind === self.kind && it.parentId === self.parentId,
	);
	if (siblings.length < 2) return null;
	const path = leafPathIds(items, leafId);
	const index = siblings.findIndex((it) => it.id === entryId);
	if (index < 0 || !path.has(entryId)) return null;
	return { index, total: siblings.length, ids: siblings.map((it) => it.id) };
}
