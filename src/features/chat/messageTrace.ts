import type { ToolResultInfo, TranscriptItem } from "../../lib/contracts";
import { stripImageMarkers } from "./userTextChips";
import type { ToolStatus } from "./ToolCard";
import { tNow } from "../../stores/language";

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

// ---- Chat trace (turn navigator, ported from ZCode desktop's TurnNavigator) ----

export const TRACE_PREVIEW_MAX_CHARS = 220;
export const TRACE_PREVIEW_MAX_PARAGRAPHS = 2;

/** One dash in the chat trace gutter: a real user query worth jumping to.
 * `id` matches the transcript item id (or pending echo id) so the strip can
 * locate the rendered row via the `msg-<id>` DOM id. */
export interface ChatTraceEntry {
	id: string;
	userPreview: string;
	assistantPreview: string;
	assistantPreviewKind: "text" | "running" | "empty";
	isRunning: boolean;
}

export function splitPreviewParagraphs(text: string, max: number): string[] {
	return text
		.trim()
		.split(/\n\s*\n/u)
		.map((p) => p.replace(/\s+/gu, " ").trim())
		.filter(Boolean)
		.slice(0, Math.max(1, max));
}

export function truncatePreview(text: string, maxChars: number): string {
	const n = Math.max(8, maxChars);
	return text.length <= n ? text : `${text.slice(0, n - 3).trimEnd()}...`;
}

export function buildPreview(
	texts: string[],
	fallback: string,
	maxChars = TRACE_PREVIEW_MAX_CHARS,
	maxParagraphs = TRACE_PREVIEW_MAX_PARAGRAPHS,
): string {
	const parts = splitPreviewParagraphs(texts.join("\n\n"), maxParagraphs);
	return parts.length === 0 ? fallback : truncatePreview(parts.join("\n"), maxChars);
}

/**
 * Collects the chat trace entries: one per real user query, paired with a
 * preview of its turn's assistant text. The turn in flight marks its query
 * running and folds the streaming text into the assistant preview.
 * `streamingText` is the in-flight assistant text, or null when idle.
 */
export function collectChatTraceEntries(
	items: TranscriptItem[],
	pendingEchoes: TranscriptItem[],
	streamingText: string | null,
): ChatTraceEntry[] {
	interface Unit {
		queries: TranscriptItem[];
		assistantTexts: string[];
	}
	const units: Unit[] = [];
	for (const it of filterVisibleItems(items, false)) {
		if (it.kind === "user") {
			units.push({ queries: [it], assistantTexts: [] });
		} else if (units.length > 0 && it.kind === "assistant" && it.text?.trim()) {
			units[units.length - 1].assistantTexts.push(it.text);
		}
	}
	const streaming = streamingText !== null;
	if (units.length > 0 && streaming && pendingEchoes.length > 0) {
		// Steers sent mid-turn belong to the running unit.
		units[units.length - 1].queries.push(...pendingEchoes);
	} else {
		for (const echo of pendingEchoes) {
			units.push({ queries: [echo], assistantTexts: [] });
		}
	}
	if (units.length > 0 && streaming) {
		const live = units[units.length - 1];
		if (streamingText.trim()) live.assistantTexts.push(streamingText);
	}

	const entries: ChatTraceEntry[] = [];
	for (const unit of units) {
		const isRunning = streaming && unit === units[units.length - 1];
		const assistantPreviewKind: ChatTraceEntry["assistantPreviewKind"] =
			unit.assistantTexts.length > 0
				? "text"
				: isRunning
					? "running"
					: "empty";
		const assistantPreview = buildPreview(
			unit.assistantTexts,
			assistantPreviewKind === "running"
				? tNow("chat.trace.runningAssistant")
				: tNow("chat.trace.emptyAssistant"),
		);
		for (let i = 0; i < unit.queries.length; i++) {
			const q = unit.queries[i];
			entries.push({
				id: q.id,
				userPreview: buildPreview([stripImageMarkers(q.text ?? "")], tNow("chat.trace.userQuery")),
				assistantPreview,
				assistantPreviewKind,
				isRunning: isRunning && i === unit.queries.length - 1,
			});
		}
	}
	return entries;
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
