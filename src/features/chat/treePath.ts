/**
 * Conversation-tree path helpers (pure). Upstream session files are
 * append-only records with parent pointers; after a `navigate_tree` the file
 * holds sibling branches and only the root→leaf path is the live
 * conversation. `TranscriptItem.parentId` (§4) plus `get_tree`'s `leafId`
 * drive everything here. Never mutates its inputs.
 *
 * The leaf id is never guessed from the items: after a navigation the file
 * tail belongs to the abandoned branch, and a leaf's own old tool chain stays
 * in the file below it. `stores/tree.ts` refreshes the cached leaf whenever
 * the transcript is refetched.
 */

import type { TranscriptItem } from "../../lib/contracts";

/** Version group of one entry: its same-kind siblings in file order. */
export interface TreeVersions {
	/** 0-based position of the current entry among `ids`. */
	index: number;
	/** Sibling count including the current entry. */
	total: number;
	/** Sibling entry ids (file order), the current one included. */
	ids: string[];
}

/** Ids on the root→leaf path (the leaf included). */
export function leafPathIds(
	items: readonly { id: string; parentId?: string | null }[],
	leafId: string | null,
): Set<string> {
	const byId = new Map(items.map((it) => [it.id, it]));
	const path = new Set<string>();
	let cur = leafId;
	// Guard against a corrupted loop in the parent chain.
	for (let i = 0; cur !== null && i <= items.length; i++) {
		if (path.has(cur)) break;
		path.add(cur);
		cur = byId.get(cur)?.parentId ?? null;
	}
	return path;
}

/**
 * Keep only the entries on the root→leaf path, in file order. `leafId` null
 * (unknown tree state, e.g. an offline session) or an id the transcript does
 * not hold → unchanged, matching the pre-tree rendering.
 */
export function filterToLeafPath<T extends { id: string; parentId?: string | null }>(
	items: readonly T[],
	leafId: string | null,
): T[] {
	if (!leafId || !items.some((it) => it.id === leafId)) {
		return items as T[];
	}
	const path = leafPathIds(items, leafId);
	return items.filter((it) => path.has(it.id));
}

/**
 * Sibling versions of `itemId`: entries sharing its parent and kind. The
 * current one is the sibling on the leaf path (exactly one when `itemId` is
 * rendered). Returns null when the entry has no siblings or none is on the
 * path (a stale group left over from a navigation).
 */
export function siblingVersions(
	items: readonly TranscriptItem[],
	leafId: string | null,
	itemId: string,
): TreeVersions | null {
	const self = items.find((it) => it.id === itemId);
	if (!self) return null;
	// File order preserved (items arrive in file order); hidden entries are
	// never switchable targets.
	const siblings = items.filter(
		(it) => it.kind === self.kind && it.parentId === self.parentId && !it.hidden,
	);
	if (siblings.length < 2) return null;
	const path = leafPathIds(items, leafId);
	const index = siblings.findIndex((it) => it.id === itemId);
	if (index < 0 || !path.has(itemId)) return null;
	return { index, total: siblings.length, ids: siblings.map((it) => it.id) };
}

/** Sibling versions for every entry that has them, keyed by entry id. */
export function versionsByItem(
	items: readonly TranscriptItem[],
	leafId: string | null,
): Map<string, TreeVersions> {
	const out = new Map<string, TreeVersions>();
	const grouped = new Map<string, TranscriptItem[]>();
	for (const it of items) {
		if (it.hidden) continue;
		const key = `${it.parentId ?? ""}\u0000${it.kind}`;
		const list = grouped.get(key);
		if (list) list.push(it);
		else grouped.set(key, [it]);
	}
	const path = leafPathIds(items, leafId);
	for (const list of grouped.values()) {
		if (list.length < 2) continue;
		const index = list.findIndex((it) => path.has(it.id));
		if (index < 0) continue;
		for (const it of list) out.set(it.id, { index, total: list.length, ids: list.map((i) => i.id) });
	}
	return out;
}
