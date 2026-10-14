import type { TranscriptItem } from "../../../lib/contracts";
import { stripImageMarkers } from "../MessageList";
import { filterVisibleItems } from "../messageTrace";
import { groupTurnBlocks } from "../turnGrouping";

export interface ShareEntry {
	id: string;
	role: "user" | "assistant";
	text: string;
	imageCount: number;
	ts: string;
}

/** A user prompt with visible text after image markers are stripped. */
export function isShareableUser(item: TranscriptItem | null | undefined): item is TranscriptItem {
	return !!item && stripImageMarkers(item.text ?? "").trim().length > 0;
}

/** A finished answer with text; aborted/errored answers carry no content to share. */
export function isShareableAnswer(
	item: TranscriptItem | null | undefined,
): item is TranscriptItem {
	if (!item) return false;
	if (item.stopReason === "aborted" || item.stopReason === "error") return false;
	return stripImageMarkers(item.text ?? "").trim().length > 0;
}

/** Ids of every shareable message (user prompts + answers) in transcript order. */
export function listShareableIds(items: TranscriptItem[]): string[] {
	const ids: string[] = [];
	for (const block of groupTurnBlocks(filterVisibleItems(items, false))) {
		if (block.type !== "turn") continue;
		if (isShareableUser(block.userItem)) ids.push(block.userItem.id);
		if (isShareableAnswer(block.answerItem)) ids.push(block.answerItem.id);
	}
	return ids;
}

/** Selected shareable messages in transcript order. */
export function buildShareEntries(
	items: TranscriptItem[],
	selectedIds: ReadonlySet<string>,
): ShareEntry[] {
	const entries: ShareEntry[] = [];
	for (const block of groupTurnBlocks(filterVisibleItems(items, false))) {
		if (block.type !== "turn") continue;
		const { userItem, answerItem } = block;
		if (isShareableUser(userItem) && selectedIds.has(userItem.id)) {
			entries.push({
				id: userItem.id,
				role: "user",
				text: stripImageMarkers(userItem.text ?? "").trim(),
				imageCount: (userItem.images ?? []).length,
				ts: userItem.ts,
			});
		}
		if (isShareableAnswer(answerItem) && selectedIds.has(answerItem.id)) {
			entries.push({
				id: answerItem.id,
				role: "assistant",
				text: stripImageMarkers(answerItem.text ?? "").trim(),
				imageCount: 0,
				ts: answerItem.ts,
			});
		}
	}
	return entries;
}
