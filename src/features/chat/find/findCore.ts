/** Pure helpers for in-thread find: data-level matching + DOM range collection. */
import type { TranscriptItem } from "../../../lib/contracts";
import { filterVisibleItems } from "../messageTrace";
import { trimSideChatItems } from "../sideChatView";

export interface FindMatch {
	/** Transcript item id (DOM anchor is `msg-<itemId>`). */
	itemId: string;
	/** Which occurrence of the query inside that item (0-based). */
	occurrence: number;
}

/** Case-insensitive plain-text match positions of `query` in `text`. */
export function matchOffsets(text: string, query: string): number[] {
	if (!query) return [];
	const hay = text.toLowerCase();
	const needle = query.toLowerCase();
	const out: number[] = [];
	let from = 0;
	for (;;) {
		const at = hay.indexOf(needle, from);
		if (at < 0) return out;
		out.push(at);
		from = at + needle.length;
	}
}

/**
 * Items the thread actually renders as prose, after the side-chat trim: a side
 * chat hides the parent history it inherited, so find must search the same
 * items the message list draws or it counts hits that can never be located.
 */
export function visibleFindItems(
	items: readonly TranscriptItem[],
	isSideChat: boolean,
): TranscriptItem[] {
	return filterVisibleItems(trimSideChatItems([...items], isSideChat), false);
}

/** Items whose text is shown as message prose: user and assistant text. */
export function searchableText(item: TranscriptItem): string {
	if (item.hidden || (item.kind !== "user" && item.kind !== "assistant")) return "";
	return item.text ?? "";
}

/**
 * DOM id prefixes a transcript item can be rendered under. The thread wraps
 * turn steps in their own anchors (`steer-`, `text-`, …), so the raw item id
 * alone is not enough to find the node that holds the matched text.
 */
const ANCHOR_PREFIXES = [
	"",
	"steer-",
	"text-",
	"notice-",
	"thinking-",
	"protocol-",
	"failed-",
	"orphan-result-",
] as const;

/** First rendered anchor for `itemId` under `root` (null when it is not mounted). */
export function resolveAnchor(root: ParentNode, itemId: string): HTMLElement | null {
	for (const prefix of ANCHOR_PREFIXES) {
		const id = `msg-${prefix}${itemId}`;
		const el =
			typeof CSS !== "undefined" && typeof CSS.escape === "function"
				? root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
				: [...root.querySelectorAll<HTMLElement>("[id]")].find((node) => node.id === id) ?? null;
		if (el) return el;
	}
	return null;
}

export function computeMatches(items: readonly TranscriptItem[], query: string): FindMatch[] {
	if (!query) return [];
	const out: FindMatch[] = [];
	for (const item of items) {
		const n = matchOffsets(searchableText(item), query).length;
		for (let occurrence = 0; occurrence < n; occurrence++) {
			out.push({ itemId: item.id, occurrence });
		}
	}
	return out;
}

/** Next/previous index with wrap-around; -1 when there is nothing to step over. */
export function stepIndex(current: number, count: number, dir: 1 | -1): number {
	if (count <= 0) return -1;
	if (current < 0 || current >= count) return dir === 1 ? 0 : count - 1;
	return (current + dir + count) % count;
}

/** Text-node ranges of `query` under `root` (single text nodes only). */
export function collectRanges(root: Element, query: string): Range[] {
	if (!query) return [];
	const ranges: Range[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const text = n.nodeValue ?? "";
		for (const at of matchOffsets(text, query)) {
			const r = document.createRange();
			r.setStart(n, at);
			r.setEnd(n, at + query.length);
			ranges.push(r);
		}
	}
	return ranges;
}
