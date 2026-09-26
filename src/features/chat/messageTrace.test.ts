import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import {
	buildToolResultsMap,
	collectKnownToolCallIds,
	filterVisibleItems,
	isLastInTurn,
	resolveToolStatus,
} from "./messageTrace";

function makeItem(partial: Partial<TranscriptItem>): TranscriptItem {
	return {
		id: Math.random().toString(36).slice(2),
		parentId: null,
		ts: new Date().toISOString(),
		kind: "user",
		text: null,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		...partial,
	};
}

describe("messageTrace helpers", () => {
	it("buildToolResultsMap maps toolCallId to ToolResultInfo", () => {
		const items: TranscriptItem[] = [
			makeItem({
				id: "res1",
				kind: "tool_result",
				toolResult: {
					toolCallId: "call_abc",
					toolName: "bash",
					text: "hello world",
					isError: false,
					details: null,
				},
			}),
			makeItem({
				id: "res2",
				kind: "bash",
				toolResult: {
					toolCallId: "call_def",
					toolName: "bash",
					text: "fatal error",
					isError: true,
					details: { code: 1 },
				},
			}),
		];

		const map = buildToolResultsMap(items);
		expect(map.size).toBe(2);
		expect(map.get("call_abc")?.text).toBe("hello world");
		expect(map.get("call_def")?.isError).toBe(true);
	});

	it("collectKnownToolCallIds gathers IDs from assistant toolCalls", () => {
		const items: TranscriptItem[] = [
			makeItem({
				kind: "assistant",
				toolCalls: [
					{ id: "call_1", name: "bash", args: {}, intent: null },
					{ id: "call_2", name: "read", args: {}, intent: null },
				],
			}),
		];

		const set = collectKnownToolCallIds(items);
		expect(set.has("call_1")).toBe(true);
		expect(set.has("call_2")).toBe(true);
		expect(set.has("call_3")).toBe(false);
	});

	it("filterVisibleItems absorbs paired tool_results and keeps orphan ones", () => {
		const items: TranscriptItem[] = [
			makeItem({ id: "user_1", kind: "user", text: "hi" }),
			makeItem({
				id: "asst_1",
				kind: "assistant",
				toolCalls: [{ id: "call_1", name: "bash", args: {}, intent: null }],
			}),
			// This tool_result should be absorbed
			makeItem({
				id: "res_1",
				kind: "tool_result",
				toolResult: {
					toolCallId: "call_1",
					toolName: "bash",
					text: "ok",
					isError: false,
					details: null,
				},
			}),
			// This orphan tool_result should NOT be absorbed
			makeItem({
				id: "res_orphan",
				kind: "tool_result",
				toolResult: {
					toolCallId: "orphan_call",
					toolName: "bash",
					text: "orphan output",
					isError: false,
					details: null,
				},
			}),
		];

		const visible = filterVisibleItems(items, false);
		const ids = visible.map((v) => v.id);
		expect(ids).toContain("user_1");
		expect(ids).toContain("asst_1");
		expect(ids).not.toContain("res_1");
		expect(ids).toContain("res_orphan");
	});

	it("resolveToolStatus correctly prioritizes live and historical status", () => {
		// Live running takes precedence
		expect(
			resolveToolStatus("running", {
				toolCallId: "c1",
				toolName: "b",
				text: "",
				isError: false,
				details: null,
			}),
		).toBe("running");

		// Live error or hist error
		expect(resolveToolStatus("error", null)).toBe("error");
		expect(
			resolveToolStatus(undefined, {
				toolCallId: "c1",
				toolName: "b",
				text: "",
				isError: true,
				details: null,
			}),
		).toBe("error");

		// Successful historical completion
		expect(
			resolveToolStatus(undefined, {
				toolCallId: "c1",
				toolName: "b",
				text: "done",
				isError: false,
				details: null,
			}),
		).toBe("done");

		// Live called state
		expect(resolveToolStatus("called", null)).toBe("called");

		// Default fallback
		expect(resolveToolStatus(undefined, null)).toBe("done");
	});

	it("isLastInTurn identifies whether an assistant item is the last in turn", () => {
		const items: TranscriptItem[] = [
			makeItem({ id: "u1", kind: "user" }),
			makeItem({ id: "a1", kind: "assistant", text: "" }),
			makeItem({ id: "a2", kind: "assistant", text: "final answer" }),
			makeItem({ id: "u2", kind: "user" }),
			makeItem({ id: "a3", kind: "assistant", text: "second turn" }),
		];

		expect(isLastInTurn(items, 1)).toBe(false); // a1 is followed by a2
		expect(isLastInTurn(items, 2)).toBe(true);  // a2 is followed by u2
		expect(isLastInTurn(items, 4)).toBe(true);  // a3 is the last item
	});
});
