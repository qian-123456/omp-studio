import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import type { FlowNotice } from "../../stores/live";
import { flowNoticeText, isFlowItem, persistedCompactionText, withFlowNotices } from "./flowNotice";

const item = (id: string, kind: TranscriptItem["kind"], ts = "2026-10-18T03:00:00.000Z"): TranscriptItem => ({
	id,
	parentId: null,
	ts,
	kind,
	text: null,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
});

const notice = (over: Partial<FlowNotice> = {}): FlowNotice => ({
	id: 1,
	kind: "compaction",
	status: "running",
	startedAt: Date.parse("2026-10-18T03:00:10.000Z"),
	anchorId: "a",
	...over,
});

describe("flowNoticeText", () => {
	it("running / done with tokens / error / handoff", () => {
		expect(flowNoticeText(notice())).toBe("正在压缩上下文");
		const done = flowNoticeText(
			notice({ status: "done", endedAt: Date.now(), tokensBefore: 200_000, tokensAfter: 40_000 }),
		);
		expect(done).toMatch(/^已压缩 · \d{2}:\d{2} · 200\.0k token → 40\.0k token$/);
		expect(flowNoticeText(notice({ status: "error", detail: "boom" }))).toBe("压缩失败：boom");
		expect(flowNoticeText(notice({ kind: "handoff" }))).toBe("正在生成交接文档");
		expect(flowNoticeText(notice({ kind: "handoff", status: "done", endedAt: Date.now() }))).toMatch(
			/^已交接 · \d{2}:\d{2}$/,
		);
	});

	it("persisted compaction items show their time", () => {
		expect(persistedCompactionText(item("c", "compaction"))).toMatch(/^已压缩 · \d{2}:\d{2}$/);
		expect(persistedCompactionText(item("c", "compaction", "garbage"))).toBe("已压缩");
	});
});

describe("withFlowNotices", () => {
	const items = [item("a", "assistant"), item("b", "user")];

	it("splices the divider right after its anchor so later items append below", () => {
		const out = withFlowNotices(items, [notice()]);
		expect(out.map((i) => i.id)).toEqual(["a", "flow-notice-1", "b"]);
		expect(isFlowItem(out[1])).toBe(true);
		expect(out[1].kind).toBe("compaction");
	});

	it("head anchor and unknown anchor", () => {
		expect(withFlowNotices(items, [notice({ anchorId: null })]).map((i) => i.id)).toEqual([
			"flow-notice-1",
			"a",
			"b",
		]);
		expect(withFlowNotices(items, [notice({ anchorId: "gone" })]).map((i) => i.id)).toEqual([
			"a",
			"b",
			"flow-notice-1",
		]);
	});

	it("yields to the persisted compaction entry of the same event, but keeps errors", () => {
		const persisted = [...items, item("c", "compaction", "2026-10-18T03:00:20.000Z")];
		expect(withFlowNotices(persisted, [notice({ status: "done" })])).toBe(persisted);
		expect(withFlowNotices(persisted, [notice({ status: "error" })])).toHaveLength(4);
		// An older compaction entry does not hide a newer notice.
		const old = [...items, item("o", "compaction", "2026-10-18T02:00:00.000Z")];
		expect(withFlowNotices(old, [notice()])).toHaveLength(4);
	});
});
