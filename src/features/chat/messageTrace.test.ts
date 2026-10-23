import { stripImageMarkers } from "./userTextChips";
import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import {
	buildPreview,
	buildToolResultsMap,
	collectChatTraceEntries,
	collectKnownToolCallIds,
	filterVisibleItems,
	isLastInTurn,
	resolveToolStatus,
	splitPreviewParagraphs,
	truncatePreview,
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

	it("splitPreviewParagraphs splits on blank lines and collapses whitespace", () => {
		expect(splitPreviewParagraphs("第一段\n\n第二段\n\n\n第三段", 2)).toEqual([
			"第一段",
			"第二段",
		]);
		expect(splitPreviewParagraphs("a  b\nc   d", 3)).toEqual(["a b c d"]);
	});

	it("truncatePreview clamps long text with an ellipsis and floors at 8 chars", () => {
		expect(truncatePreview("0123456789abcdef", 10)).toBe("0123456...");
		expect(truncatePreview("short", 4)).toBe("short");
	});

	it("buildPreview joins paragraphs and falls back when empty", () => {
		expect(buildPreview(["第一段\n\n第二段"], "fallback")).toBe("第一段\n第二段");
		expect(buildPreview(["   "], "fallback")).toBe("fallback");
	});

	it("collectChatTraceEntries creates one dash per user query with its turn's preview", () => {
		const items: TranscriptItem[] = [
			makeItem({ id: "u1", kind: "user", text: "第一问" }),
			// Hidden system chip — no dash
			makeItem({ id: "s1", kind: "system", text: "reminder", hidden: true }),
			makeItem({ id: "a1", kind: "assistant", text: "第一答\n\n补充段落" }),
			makeItem({ id: "a2", kind: "assistant", text: "更多正文" }),
			makeItem({
				id: "a3",
				kind: "assistant",
				toolCalls: [{ id: "call_1", name: "bash", args: {}, intent: null }],
			}),
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
			makeItem({ id: "u2", kind: "user", text: "第二问" }),
		];

		const entries = collectChatTraceEntries(items, [], null);

		expect(entries.map((e) => e.id)).toEqual(["u1", "u2"]);
		expect(entries[0].userPreview).toBe("第一问");
		expect(entries[0].assistantPreviewKind).toBe("text");
		expect(entries[0].assistantPreview).toBe("第一答\n补充段落");
		expect(entries[0].isRunning).toBe(false);
		expect(entries[1].assistantPreviewKind).toBe("empty");
		expect(entries[1].assistantPreview).toBe("暂无助手正文");
	});

	it("collectChatTraceEntries strips image markers from the user preview", () => {
		const items: TranscriptItem[] = [
			makeItem({ id: "u1", kind: "user", text: "[Image #1, 640x235: /tmp/a.png] 看看 🖼️ #2" }),
		];
		const [entry] = collectChatTraceEntries(items, [], null);
		expect(entry.userPreview).not.toMatch(/Image #|🖼️/u);
		expect(entry.userPreview).toContain("看看");
	});

	it("collectChatTraceEntries marks the running turn's last query and folds in streaming text", () => {
		const items: TranscriptItem[] = [
			makeItem({ id: "u1", kind: "user", text: "第一问" }),
			makeItem({ id: "a1", kind: "assistant", text: "第一答" }),
			makeItem({ id: "u2", kind: "user", text: "第二问" }),
		];

		const entries = collectChatTraceEntries(items, [], "正在生成的内容");

		expect(entries).toHaveLength(2);
		expect(entries[0].isRunning).toBe(false);
		expect(entries[0].assistantPreview).toBe("第一答");
		expect(entries[1].isRunning).toBe(true);
		expect(entries[1].assistantPreviewKind).toBe("text");
		expect(entries[1].assistantPreview).toContain("正在生成的内容");
	});

	it("collectChatTraceEntries merges echoes into the running unit, splits them when idle", () => {
		const items: TranscriptItem[] = [
			makeItem({ id: "u1", kind: "user", text: "第一问" }),
		];
		const echoes = [
			makeItem({ id: "pending-echo-1", kind: "user", text: "排队中的追问" }),
		];

		const idle = collectChatTraceEntries(items, echoes, null);
		expect(idle.map((e) => e.id)).toEqual(["u1", "pending-echo-1"]);
		expect(idle[1].assistantPreviewKind).toBe("empty");
		expect(idle[1].isRunning).toBe(false);

		const live = collectChatTraceEntries(items, echoes, "");
		expect(live).toHaveLength(2);
		expect(live[0].isRunning).toBe(false);
		expect(live[1].isRunning).toBe(true);
		expect(live[1].assistantPreviewKind).toBe("running");
		expect(live[1].assistantPreview).toBe("助手仍在工作");
	});
});

describe("stripImageMarkers", () => {
	it("removes [Image #N] markers with dimensions and leaves clean prose text", () => {
		const text = "[Image #1, 640x235] 还有就是总感觉这里堆叠太多东西也不好看";
		expect(stripImageMarkers(text)).toBe("还有就是总感觉这里堆叠太多东西也不好看");
	});

	it("returns empty string when message contains only image markers", () => {
		expect(stripImageMarkers("[Image #1]")).toBe("");
		expect(stripImageMarkers("🖼️ #1")).toBe("");
		expect(stripImageMarkers("🖼️#1")).toBe("");
	});

	it("removes inline emoji markers and multiple image tags", () => {
		const text = "🖼️ #1 看看这个效果 🖼️ #2 以及这个";
		expect(stripImageMarkers(text)).toBe("看看这个效果  以及这个");
	});
});
