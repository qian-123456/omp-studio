import { describe, expect, it } from "vitest";
import { createFrameBatcher } from "./frameBatch";

function setup() {
	const out: { sessionId: string; frame: Record<string, unknown> }[] = [];
	let pending: (() => void) | null = null;
	const b = createFrameBatcher(
		(p) => out.push(p as (typeof out)[number]),
		(f) => {
			pending = f;
		},
	);
	const push = (sessionId: string, frame: Record<string, unknown>) =>
		b.push({ sessionId, frame });
	return { out, push, flush: () => pending?.(), b };
}

describe("frameBatch", () => {
	it("keeps only the newest message_update of a burst", () => {
		const { out, push, flush } = setup();
		push("a", { type: "message_update", n: 1 });
		push("a", { type: "message_update", n: 2 });
		push("a", { type: "message_update", n: 3 });
		flush();
		expect(out.map((o) => o.frame.n)).toEqual([3]);
	});

	it("coalesces across tool updates but never past message_end", () => {
		const { out, push, flush } = setup();
		push("a", { type: "message_update", n: 1 });
		push("a", { type: "tool_execution_update", toolCallId: "t", n: 2 });
		push("a", { type: "message_update", n: 3 });
		push("a", { type: "message_end", n: 4 });
		push("a", { type: "message_update", n: 5 });
		flush();
		expect(out.map((o) => o.frame.n)).toEqual([3, 2, 4, 5]);
	});

	it("coalesces tool updates per toolCallId and keeps other sessions apart", () => {
		const { out, push, flush } = setup();
		push("a", { type: "tool_execution_update", toolCallId: "t1", n: 1 });
		push("b", { type: "tool_execution_update", toolCallId: "t1", n: 2 });
		push("a", { type: "tool_execution_update", toolCallId: "t2", n: 3 });
		push("a", { type: "tool_execution_update", toolCallId: "t1", n: 4 });
		flush();
		expect(out.map((o) => o.frame.n)).toEqual([4, 2, 3]);
	});

	it("never drops lifecycle frames", () => {
		const { out, push, flush } = setup();
		push("a", { type: "tool_execution_start", toolCallId: "t" });
		push("a", { type: "tool_execution_update", toolCallId: "t", n: 1 });
		push("a", { type: "tool_execution_end", toolCallId: "t" });
		push("a", { type: "tool_execution_update", toolCallId: "t", n: 2 });
		flush();
		expect(out.map((o) => o.frame.type)).toEqual([
			"tool_execution_start",
			"tool_execution_update",
			"tool_execution_end",
			"tool_execution_update",
		]);
	});
});
