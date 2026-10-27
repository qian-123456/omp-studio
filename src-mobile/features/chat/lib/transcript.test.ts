import { describe, expect, it } from "vitest";
import type { TranscriptItem, TranscriptPage } from "../../../core/types";
import { EMPTY_TRANSCRIPT, mergePage, reconcileOptimistic, transcriptQuery } from "./transcript";

const user = (id: string, text: string): TranscriptItem => ({ id, kind: "user", text, ts: "2026-10-26T10:00:00Z" });
// duration/ttft are on the wire but not in the shared TranscriptItem type.
const asst = (id: string, text: string, calls: string[] = []): TranscriptItem => ({
	id,
	kind: "assistant",
	text,
	ts: "2026-10-26T10:00:05Z",
	duration: 5000,
	ttft: 800,
	toolCalls: calls.map((c) => ({ id: c, name: "bash", args: { command: "ls" } })),
} as TranscriptItem);
const result = (callId: string, text: string, isError = false): TranscriptItem => ({
	id: `r-${callId}`,
	kind: "tool_result",
	toolResult: { toolCallId: callId, text, isError },
});
const page = (items: TranscriptItem[], extra: Partial<TranscriptPage> = {}): TranscriptPage => ({ items, nextOffset: 100, tailId: "t1", ...extra });

describe("mergePage", () => {
	it("appends incrementally and advances the cursor", () => {
		const a = mergePage(EMPTY_TRANSCRIPT, page([user("u1", "hi"), asst("a1", "yo")]));
		expect(a.state.items.map((i) => i.id)).toEqual(["u1", "a1"]);
		expect(a.state.offset).toBe(100);
		expect(a.state.tailId).toBe("t1");
		expect(a.newUserTexts).toEqual(["hi"]);
		const b = mergePage(a.state, page([user("u2", "more")], { nextOffset: 200, tailId: "t2" }));
		expect(b.state.items).toHaveLength(3);
		expect(b.state.items[0]).toBe(a.state.items[0]);
		expect(transcriptQuery(b.state)).toBe("from=200&tail=t2");
	});

	it("ignores a re-delivered entry and reports no change", () => {
		const a = mergePage(EMPTY_TRANSCRIPT, page([user("u1", "hi")]));
		const b = mergePage(a.state, page([user("u1", "hi")]));
		expect(b.state.items).toHaveLength(1);
		expect(b.changed).toBe(false);
	});

	it("reset discards the buffer and stats", () => {
		const a = mergePage(EMPTY_TRANSCRIPT, page([user("u1", "hi"), asst("a1", "yo")]));
		const b = mergePage(a.state, page([user("u9", "new")], { reset: true, nextOffset: 10 }));
		expect(b.state.items.map((i) => i.id)).toEqual(["u9"]);
		expect(b.state.stats).toEqual({});
		expect(b.changed).toBe(true);
	});

	it("attaches a tool result that arrives in a later page to the earlier call", () => {
		const a = mergePage(EMPTY_TRANSCRIPT, page([user("u1", "go"), asst("a1", "", ["c1"])]));
		expect(a.state.items[1].tools[0].status).toBe("running"); // unresolved
		const b = mergePage(a.state, page([result("c1", "out", true)], { nextOffset: 150 }));
		const tool = b.state.items[1].tools[0];
		expect(tool.status).toBe("error");
		expect(tool.result).toBe("out");
		expect(b.state.items).toHaveLength(2);
		expect(b.state.items[1]).not.toBe(a.state.items[1]);
		expect(b.state.items[0]).toBe(a.state.items[0]);
	});

	it("resolves a call whose result is in the same page", () => {
		const a = mergePage(EMPTY_TRANSCRIPT, page([asst("a1", "", ["c1"]), result("c1", "ok")]));
		expect(a.state.items[0].tools[0]).toMatchObject({ status: "done", result: "ok" });
	});

	it("records request stats for assistant rows", () => {
		const a = mergePage(EMPTY_TRANSCRIPT, page([asst("a1", "yo")]));
		expect(a.state.stats.a1?.durationMs).toBe(5000);
		expect(a.state.stats.a1?.ttftMs).toBe(800);
	});
});

describe("reconcileOptimistic", () => {
	const o = (id: string, text: string) => ({ id, text, imageUrls: [] });
	it("drops the bubble once the transcript shows the message (plan prefix tolerated)", () => {
		const left = reconcileOptimistic([o("1", "fix it"), o("2", "other")], ["[规划模式] 说明\n\nfix it"]);
		expect(left.map((x) => x.id)).toEqual(["2"]);
	});
	it("consumes one persisted row per bubble", () => {
		const left = reconcileOptimistic([o("1", "same"), o("2", "same")], ["same"]);
		expect(left).toHaveLength(1);
	});
	it("returns the same array when nothing matches", () => {
		const list = [o("1", "a")];
		expect(reconcileOptimistic(list, ["b"])).toBe(list);
	});
});
