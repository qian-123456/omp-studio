import type { ToolResultInfo, TranscriptItem } from "../../lib/contracts";
import type { ToolStatus } from "./ToolCard";

/**
 * Builds a lookup map of ToolResultInfo by toolCallId from transcript items.
 */
export function buildToolResultsMap(
	items: TranscriptItem[],
): Map<string, ToolResultInfo> {
	const map = new Map<string, ToolResultInfo>();
	for (const it of items) {
		if (it.toolResult?.toolCallId) {
			map.set(it.toolResult.toolCallId, it.toolResult);
		}
	}
	return map;
}

/**
 * Collects all toolCall IDs defined across assistant messages.
 */
export function collectKnownToolCallIds(items: TranscriptItem[]): Set<string> {
	const set = new Set<string>();
	for (const it of items) {
		if (it.toolCalls) {
			for (const tc of it.toolCalls) {
				if (tc.id) set.add(tc.id);
			}
		}
	}
	return set;
}

/**
 * Filters visible items, absorbing any tool_result whose toolCallId was already
 * declared in an assistant message (Codex-style unified action trace).
 * Standalone/orphan tool_result items remain visible.
 */
export function filterVisibleItems(
	items: TranscriptItem[],
	showHidden: boolean,
): TranscriptItem[] {
	const knownIds = collectKnownToolCallIds(items);
	const base = showHidden ? items : items.filter((i) => !i.hidden);
	return base.filter((it) => {
		if (
			(it.kind === "tool_result" || it.kind === "bash") &&
			it.toolResult?.toolCallId
		) {
			if (knownIds.has(it.toolResult.toolCallId)) {
				return false;
			}
		}
		return true;
	});
}

/**
 * Resolves the display status for a tool call given live state and historical result.
 */
export function resolveToolStatus(
	liveStatus?: ToolStatus,
	histResult?: ToolResultInfo | null,
): ToolStatus {
	if (liveStatus === "running") return "running";
	if (liveStatus === "error" || histResult?.isError) return "error";
	if (liveStatus === "done" || histResult) return "done";
	if (liveStatus === "called") return "called";
	return "done";
}

/**
 * Determines whether an assistant message at `currentIndex` is the final assistant
 * message in the current turn (followed by user message or end of stream).
 */
export function isLastInTurn(
	items: TranscriptItem[],
	currentIndex: number,
): boolean {
	for (let i = currentIndex + 1; i < items.length; i++) {
		const next = items[i];
		if (next.kind === "user") return true;
		if (next.kind === "assistant") return false;
	}
	return true;
}
