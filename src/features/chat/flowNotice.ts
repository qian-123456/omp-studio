/**
 * Compaction / handoff dividers in the message flow. Live notices are
 * spliced into the transcript as synthetic `compaction` items right after the
 * item that was last when they started, so later turn output simply appends
 * below them. Once the transcript itself carries the persisted compaction
 * entry, the live notice yields to it.
 */
import type { TranscriptItem } from "../../lib/contracts";
import type { FlowNotice } from "../../stores/live";
import { formatTokens } from "./sessionStats";

/** Transcript item that may stand for a live compaction/handoff notice. */
export type FlowItem = TranscriptItem & { flow?: FlowNotice };

const FLOW_ID_PREFIX = "flow-notice-";

export const isFlowItem = (item: TranscriptItem): item is FlowItem & { flow: FlowNotice } =>
	(item as FlowItem).flow !== undefined;

/** HH:MM of an epoch-ms / ISO timestamp, "" when unparsable. */
export function clockTime(ts: number | string): string {
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const joinParts = (parts: (string | false | undefined)[]): string =>
	parts.filter((p): p is string => typeof p === "string" && p !== "").join(" · ");

/** One-row divider text of a notice: running → done/error. */
export function flowNoticeText(n: FlowNotice): string {
	const handoff = n.kind === "handoff";
	if (n.status === "running") return handoff ? "正在生成交接文档" : "正在压缩上下文";
	if (n.status === "error") {
		return `${handoff ? "交接失败" : "压缩失败"}${n.detail ? `：${n.detail}` : ""}`;
	}
	const time = n.endedAt ? clockTime(n.endedAt) : "";
	if (n.detail) return joinParts([n.detail, time]);
	const tokens =
		n.tokensBefore !== undefined && n.tokensAfter !== undefined
			? `${formatTokens(n.tokensBefore)} → ${formatTokens(n.tokensAfter)}`
			: n.tokensBefore !== undefined
				? `压缩前 ${formatTokens(n.tokensBefore)}`
				: "";
	return joinParts([handoff ? "已交接" : "已压缩", time, tokens]);
}

/** Divider text of a compaction entry loaded from the transcript file. */
export function persistedCompactionText(item: TranscriptItem): string {
	return joinParts(["已压缩", clockTime(item.ts)]);
}

function noticeItem(n: FlowNotice): FlowItem {
	return {
		id: `${FLOW_ID_PREFIX}${n.id}`,
		parentId: null,
		ts: new Date(n.endedAt ?? n.startedAt).toISOString(),
		kind: "compaction",
		text: null,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		flow: n,
	};
}

/**
 * Splice live notices into `items`. A non-error notice is dropped once the
 * transcript has a compaction entry written at/after its start (that entry is
 * the same event, at its exact position). An unknown anchor appends at the end.
 */
export function withFlowNotices(
	items: TranscriptItem[],
	notices: readonly FlowNotice[],
): TranscriptItem[] {
	if (notices.length === 0) return items;
	const persisted = items
		.filter((i) => i.kind === "compaction")
		.map((i) => Date.parse(i.ts))
		.filter((t) => !Number.isNaN(t));
	const shown = notices.filter(
		(n) => n.status === "error" || !persisted.some((t) => t >= n.startedAt - 5_000),
	);
	if (shown.length === 0) return items;
	const anchorIndex = new Map<string, number>();
	items.forEach((it, i) => anchorIndex.set(it.id, i));
	const after = new Map<number, FlowNotice[]>(); // item index (-1 = head) → notices
	for (const n of shown) {
		const idx = n.anchorId === null ? -1 : (anchorIndex.get(n.anchorId) ?? items.length - 1);
		after.set(idx, [...(after.get(idx) ?? []), n]);
	}
	const out: TranscriptItem[] = [];
	for (const n of after.get(-1) ?? []) out.push(noticeItem(n));
	items.forEach((it, i) => {
		out.push(it);
		for (const n of after.get(i) ?? []) out.push(noticeItem(n));
	});
	return out;
}
