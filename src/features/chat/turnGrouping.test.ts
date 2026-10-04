import { describe, expect, it } from "vitest";
import type { ToolCall, TranscriptItem } from "../../lib/contracts";
import {
	computeDurationMs,
	activityGroupSummary,
	formatDurationChinese,
	formatDurationCompact,
	formatShortModel,
	groupActivityUnits,
	groupTurnBlocks,
	noticeBody,
	noticeSummary,
	type TurnStep,
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
			expect(turn.userItem?.id).toBe("msg-1");
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

	it("surfaces text accompanying a final ask call as the answer, call in steps", () => {
		const ask: ToolCall = { id: "ask-1", name: "ask", args: { question: "继续吗？" }, intent: null };
		const blocks = groupTurnBlocks([
			makeItem({ id: "u-1", kind: "user", text: "do it" }),
			makeItem({ id: "a-1", kind: "assistant", text: "需要你确认方案。", toolCalls: [ask] }),
		]);
		const turn = blocks[0];
		if (turn.type !== "turn") throw new Error("expected turn");
		expect(turn.answerItem?.id).toBe("a-1");
		expect(turn.intermediateSteps.map((s) => s.kind)).toEqual(["tool"]);
	});

	it("treats last assistant text with a normal tool call as the answer", () => {
		const call: ToolCall = { id: "c-1", name: "bash", args: {}, intent: null };
		const blocks = groupTurnBlocks([
			makeItem({ id: "u-1", kind: "user", text: "go" }),
			makeItem({ id: "a-1", kind: "assistant", text: "完成，最后跑一下。", toolCalls: [call] }),
			makeItem({
				id: "r-1",
				kind: "tool_result",
				toolResult: { toolCallId: "c-1", toolName: "bash", text: "ok", isError: false, details: null },
			}),
		]);
		const turn = blocks[0];
		if (turn.type !== "turn") throw new Error("expected turn");
		expect(turn.answerItem?.id).toBe("a-1");
		expect(turn.intermediateSteps.map((s) => s.kind)).toEqual(["tool"]);
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
			expect(turn2.userItem?.id).toBe("u-2");
			expect(turn2.answerItem?.id).toBe("a-2");
			// Thinking from final assistant message is captured in intermediateSteps
			expect(turn2.intermediateSteps).toHaveLength(1);
			expect(turn2.intermediateSteps[0].kind).toBe("thinking");
		}
	});

	it("keeps a mid-run visible notice inside the turn as a notice step", () => {
		const call1: ToolCall = { id: "call-1", name: "run", args: {}, intent: null };
		const call2: ToolCall = { id: "call-2", name: "run", args: {}, intent: null };

		const items: TranscriptItem[] = [
			makeItem({ id: "u-1", kind: "user", text: "Run the job" }),
			makeItem({ id: "a-1", kind: "assistant", toolCalls: [call1] }),
			makeItem({
				id: "r-1",
				kind: "tool_result",
				toolResult: {
					toolCallId: "call-1",
					toolName: "run",
					text: "ok",
					isError: false,
					details: null,
				},
			}),
			makeItem({
				id: "n-1",
				kind: "custom",
				text: "<system-notice>\nBackground job bg_1 has completed. Resume your work using the result below.\nok\n</system-notice>",
			}),
			makeItem({ id: "a-2", kind: "assistant", toolCalls: [call2] }),
			makeItem({
				id: "r-2",
				kind: "tool_result",
				toolResult: {
					toolCallId: "call-2",
					toolName: "run",
					text: "ok",
					isError: false,
					details: null,
				},
			}),
			makeItem({ id: "a-3", kind: "assistant", text: "All done." }),
		];

		const blocks = groupTurnBlocks(items);
		expect(blocks).toHaveLength(1);

		const turn = blocks[0];
		expect(turn.type).toBe("turn");
		if (turn.type === "turn") {
			expect(turn.userItem?.id).toBe("u-1");
			expect(turn.answerItem?.id).toBe("a-3");
			expect(turn.allItemIds).toEqual([
				"u-1",
				"a-1",
				"r-1",
				"n-1",
				"a-2",
				"r-2",
				"a-3",
			]);

			// Steps: tool c1, notice n1, tool c2 — in order.
			expect(turn.intermediateSteps.map((s) => s.kind)).toEqual([
				"tool",
				"notice",
				"tool",
			]);

			const notice = turn.intermediateSteps[1];
			expect(notice.id).toBe("notice-n-1");
			if (notice.kind === "notice") {
				expect(notice.item.id).toBe("n-1");
			}

			const firstTool = turn.intermediateSteps[0];
			if (firstTool.kind === "tool") {
				expect(firstTool.call.id).toBe("call-1");
				expect(firstTool.result?.toolCallId).toBe("call-1");
			}
			const secondTool = turn.intermediateSteps[2];
			if (secondTool.kind === "tool") {
				expect(secondTool.call.id).toBe("call-2");
				expect(secondTool.result?.toolCallId).toBe("call-2");
			}
		}
	});

	it("keeps a trailing protocol item as a standalone row", () => {
		const items: TranscriptItem[] = [
			makeItem({ id: "u-1", kind: "user", text: "Hi" }),
			makeItem({ id: "a-1", kind: "assistant", text: "Hello!" }),
			makeItem({ id: "n-1", kind: "custom", text: "Job finished" }),
		];

		const blocks = groupTurnBlocks(items);
		expect(blocks).toHaveLength(2);

		expect(blocks[0].type).toBe("turn");
		if (blocks[0].type === "turn") {
			expect(blocks[0].answerItem?.id).toBe("a-1");
		}

		expect(blocks[1].type).toBe("protocol");
		if (blocks[1].type === "protocol") {
			expect(blocks[1].id).toBe("protocol-n-1");
			expect(blocks[1].item.id).toBe("n-1");
		}
	});

	it("groups agent activity with no user message into a userless turn", () => {
		const call1: ToolCall = { id: "call-1", name: "run", args: {}, intent: null };

		const items: TranscriptItem[] = [
			makeItem({ id: "a-1", kind: "assistant", toolCalls: [call1] }),
			makeItem({
				id: "r-1",
				kind: "tool_result",
				toolResult: {
					toolCallId: "call-1",
					toolName: "run",
					text: "ok",
					isError: false,
					details: null,
				},
			}),
			makeItem({ id: "a-2", kind: "assistant", text: "Finished." }),
		];

		const blocks = groupTurnBlocks(items);
		expect(blocks).toHaveLength(1);

		const turn = blocks[0];
		expect(turn.type).toBe("turn");
		if (turn.type === "turn") {
			expect(turn.id).toBe("turn-a-1");
			expect(turn.userItem).toBeNull();
			expect(turn.answerItem?.id).toBe("a-2");
			expect(turn.allItemIds).toEqual(["a-1", "r-1", "a-2"]);

			expect(turn.intermediateSteps).toHaveLength(1);
			const step = turn.intermediateSteps[0];
			expect(step.kind).toBe("tool");
			if (step.kind === "tool") {
				expect(step.call.id).toBe("call-1");
				expect(step.result?.toolCallId).toBe("call-1");
			}
		}
	});

	it("extracts notice bodies and one-line summaries", () => {
		const notice = makeItem({
			id: "n-1",
			kind: "custom",
			text: "<system-notice>\nBackground job bg_1 has completed. Resume your work using the result below.\nok\n</system-notice>",
		});

		expect(noticeSummary(notice)).toBe(
			"Background job bg_1 has completed. Resume your work using the result below.",
		);

		const body = noticeBody(notice);
		expect(body).toContain("ok");
		expect(body).not.toContain("system-notice");

		expect(
			noticeSummary(
				makeItem({
					id: "m-1",
					kind: "model_change",
					model: "claude-3-7-sonnet",
				}),
			),
		).toBe("");
	});
});

describe("activity grouping", () => {
	it("formats compact durations for the worked-for divider", () => {
		expect(formatDurationCompact(0)).toBe("0秒");
		expect(formatDurationCompact(500)).toBe("1秒");
		expect(formatDurationCompact(123000)).toBe("2分3秒");
		expect(formatDurationCompact(60000)).toBe("1分");
		expect(formatDurationCompact(3600000 + 240000)).toBe("1小时4分");
	});

	const tool = (
		id: string,
		name: string,
		args: unknown = {},
	): Extract<TurnStep, { kind: "tool" }> => ({
		id,
		kind: "tool",
		item: makeItem({ id: `${id}-item`, kind: "assistant" }),
		call: { id, name, args, intent: null },
	});

	it("summarizes folded runs per kind", () => {
		const explore = [tool("a", "read"), tool("b", "grep"), tool("c", "glob")];
		expect(activityGroupSummary("exploration", explore, false)).toBe(
			"已浏览 1 个文件、2 次搜索",
		);
		expect(activityGroupSummary("exploration", explore, true)).toBe(
			"正在浏览…",
		);
		expect(
			activityGroupSummary("commands", [tool("x", "bash"), tool("y", "bash")], false),
		).toBe("已运行 2 条命令");
		// Edits count distinct paths, not calls.
		expect(
			activityGroupSummary(
				"edits",
				[
					tool("e1", "edit", { path: "a.ts" }),
					tool("e2", "edit", { path: "a.ts" }),
					tool("e3", "write", { path: "b.ts" }),
				],
				false,
			),
		).toBe("已编辑 2 个文件");
	});

	it("folds same-kind runs, splits on kind change, absorbs thinking", () => {
		const thinking: TurnStep = {
			id: "th-1",
			kind: "thinking",
			item: makeItem({ id: "th-item", kind: "assistant" }),
			thinking: "…",
		};

		const units = groupActivityUnits([
			tool("c1", "read"),
			tool("c2", "grep"),
			thinking,
			tool("c3", "glob"),
			tool("r1", "bash"),
			tool("r2", "bash"),
			tool("e1", "edit"),
			tool("c4", "read"),
		]);

		expect(units.map((u) => (u.kind === "group" ? u.group : u.step.id))).toEqual(
			["exploration", "commands", "e1", "c4"],
		);
		if (units[0].kind === "group") {
			expect(units[0].steps.map((s) => s.call.name)).toEqual([
				"read",
				"grep",
				"glob",
			]);
		}
	});
});
