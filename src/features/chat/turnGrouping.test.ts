import { describe, expect, it } from "vitest";
import type { ToolCall, TranscriptItem } from "../../lib/contracts";
import {
	computeDurationMs,
	formatDurationChinese,
	formatShortModel,
	groupTurnBlocks,
} from "./turnGrouping";

function makeItem(partial: Partial<TranscriptItem> & { id: string; kind: TranscriptItem["kind"] }): TranscriptItem {
	return {
		parentId: null,
		ts: "2026-10-01T12:00:00Z",
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

describe("turnGrouping", () => {
	it("formats duration in Chinese correctly", () => {
		expect(formatDurationChinese(0)).toBe("0 秒");
		expect(formatDurationChinese(500)).toBe("1 秒");
		expect(formatDurationChinese(12_000)).toBe("12 秒");
		expect(formatDurationChinese(60_000)).toBe("1 分钟");
		expect(formatDurationChinese(83_000)).toBe("1 分 23 秒");
		expect(formatDurationChinese(3600_000)).toBe("1 小时");
		expect(formatDurationChinese(7500_000)).toBe("2 小时 5 分");
	});

	it("formats short model names cleanly", () => {
		expect(formatShortModel(null)).toBe("");
		expect(formatShortModel(undefined)).toBe("");
		expect(formatShortModel("anthropic/claude-3-5-sonnet-20241022")).toBe(
			"Claude 3.5 Sonnet",
		);
		expect(formatShortModel("claude-3-7-sonnet")).toBe("Claude 3.7 Sonnet");
		expect(formatShortModel("openai/gpt-4o-mini")).toBe("GPT-4o mini");
		expect(formatShortModel("deepseek/deepseek-r1")).toBe("DeepSeek R1");
		expect(formatShortModel("unknown-model")).toBe("unknown-model");
	});

	it("computes duration in milliseconds correctly", () => {
		expect(
			computeDurationMs(
				"2026-10-01T12:00:00.000Z",
				"2026-10-01T12:00:15.500Z",
			),
		).toBe(15500);
		expect(computeDurationMs(1000, 5000)).toBe(4000);
		expect(computeDurationMs(5000, 1000)).toBeUndefined();
	});

	it("groups a standard turn with thinking, tool calls, and final answer", () => {
		const toolCall1: ToolCall = {
			id: "call-1",
			name: "read_file",
			args: { path: "foo.txt" },
			intent: null,
		};

		const items: TranscriptItem[] = [
			makeItem({
				id: "msg-1",
				kind: "user",
				text: "Check foo.txt and summarize",
				ts: "2026-10-01T12:00:00Z",
			}),
			makeItem({
				id: "msg-2",
				kind: "assistant",
				thinking: "I should read foo.txt first.",
				text: "Let me check the file.",
				toolCalls: [toolCall1],
				ts: "2026-10-01T12:00:03Z",
			}),
			makeItem({
				id: "msg-3",
				kind: "tool_result",
				toolResult: {
					toolCallId: "call-1",
					toolName: "read_file",
					text: "Hello world content",
					isError: false,
					details: null,
				},
				ts: "2026-10-01T12:00:05Z",
			}),
			makeItem({
				id: "msg-4",
				kind: "assistant",
				text: "The file contains 'Hello world content'.",
				ts: "2026-10-01T12:00:08Z",
			}),
		];

		const blocks = groupTurnBlocks(items);
		expect(blocks).toHaveLength(1);

		const turn = blocks[0];
		expect(turn.type).toBe("turn");
		if (turn.type === "turn") {
			expect(turn.id).toBe("turn-msg-1");
			expect(turn.userItem.id).toBe("msg-1");
			expect(turn.answerItem?.id).toBe("msg-4");
			expect(turn.durationMs).toBe(8000);

			// Intermediate steps: thinking, intermediate text, tool call (with attached result)
			expect(turn.intermediateSteps).toHaveLength(3);
			expect(turn.intermediateSteps[0].kind).toBe("thinking");
			expect(turn.intermediateSteps[1].kind).toBe("text");
			expect(turn.intermediateSteps[2].kind).toBe("tool");

			if (turn.intermediateSteps[2].kind === "tool") {
				expect(turn.intermediateSteps[2].call.id).toBe("call-1");
				expect(turn.intermediateSteps[2].result?.toolCallId).toBe("call-1");
			}

			expect(turn.allItemIds).toEqual(["msg-1", "msg-2", "msg-3", "msg-4"]);
		}
	});

	it("handles consecutive turns and standalone protocol items", () => {
		const items: TranscriptItem[] = [
			makeItem({
				id: "u-1",
				kind: "user",
				text: "Hello",
				ts: "2026-10-01T10:00:00Z",
			}),
			makeItem({
				id: "a-1",
				kind: "assistant",
				text: "Hi there!",
				ts: "2026-10-01T10:00:02Z",
			}),
			makeItem({
				id: "proto-1",
				kind: "model_change",
				model: "claude-3-7-sonnet",
				ts: "2026-10-01T10:01:00Z",
			}),
			makeItem({
				id: "u-2",
				kind: "user",
				text: "How are you?",
				ts: "2026-10-01T10:02:00Z",
			}),
			makeItem({
				id: "a-2",
				kind: "assistant",
				thinking: "Reflecting...",
				text: "I am doing well!",
				ts: "2026-10-01T10:02:05Z",
			}),
		];

		const blocks = groupTurnBlocks(items);
		expect(blocks).toHaveLength(3);

		expect(blocks[0].type).toBe("turn");
		expect(blocks[1].type).toBe("protocol");
		expect(blocks[2].type).toBe("turn");

		const turn2 = blocks[2];
		if (turn2.type === "turn") {
			expect(turn2.userItem.id).toBe("u-2");
			expect(turn2.answerItem?.id).toBe("a-2");
			// Thinking from final assistant message is captured in intermediateSteps
			expect(turn2.intermediateSteps).toHaveLength(1);
			expect(turn2.intermediateSteps[0].kind).toBe("thinking");
		}
	});
});
