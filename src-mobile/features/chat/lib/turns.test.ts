import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../../../core/normalize";
import type { TranscriptItem } from "../../../core/types";
import { buildBlocks, foldLabel, reuseBlocks, type Turn } from "./turns";

const raw: TranscriptItem[] = [
	{ id: "u1", kind: "user", text: "q1", ts: "2026-10-26T10:00:00Z" },
	{ id: "a1", kind: "assistant", text: "", thinking: "hmm", ts: "2026-10-26T10:00:10Z", toolCalls: [{ id: "c1", name: "bash" }] },
	{ id: "r1", kind: "tool_result", toolResult: { toolCallId: "c1", text: "ok" } },
	{ id: "a2", kind: "assistant", text: "answer", ts: "2026-10-26T10:00:20Z" },
	{ id: "u2", kind: "user", text: "q2", ts: "2026-10-26T10:01:00Z" },
	{ id: "m1", kind: "compaction", text: "x" },
];

describe("buildBlocks", () => {
	const items = normalizeTranscript(raw);
	const blocks = buildBlocks(items, {});
	it("groups a user message with the assistant work, last text row is the answer", () => {
		const t = blocks[0] as Turn;
		expect(t.type).toBe("turn");
		expect(t.user?.text).toBe("q1");
		expect(t.answer?.text).toBe("answer");
		expect(t.steps.map((s) => s.kind)).toEqual(["thinking", "tool"]);
		expect(t.lastAssistantId).toBe("a2");
		expect(t.end - t.start).toBe(20_000);
	});
	it("a trailing protocol row becomes its own notice block", () => {
		expect(blocks.map((b) => b.type)).toEqual(["turn", "turn", "notice"]);
	});
	it("a protocol row inside a turn stays a step", () => {
		const mid = normalizeTranscript([
			{ id: "u", kind: "user", text: "q" },
			{ id: "a", kind: "assistant", text: "one" },
			{ id: "n", kind: "compaction" },
			{ id: "b", kind: "assistant", text: "two" },
		]);
		const t = buildBlocks(mid, {})[0] as Turn;
		expect(t.steps.map((s) => s.kind)).toContain("notice");
		expect(t.answer?.text).toBe("two");
	});
});

describe("reuseBlocks", () => {
	it("keeps identity of unchanged turns when a new row is appended", () => {
		const items = normalizeTranscript(raw.slice(0, 4));
		const first = buildBlocks(items, {});
		const more = [...items, ...normalizeTranscript([{ id: "u2", kind: "user", text: "q2" }])];
		const next = reuseBlocks(first, buildBlocks(more, {}));
		expect(next).toHaveLength(2);
		expect(next[0]).toBe(first[0]);
	});
	it("replaces a turn whose rows changed", () => {
		const items = normalizeTranscript(raw.slice(0, 2));
		const first = buildBlocks(items, {});
		const patched = [items[0], { ...items[1], tools: items[1].tools.map((t) => ({ ...t, status: "done" as const })) }];
		const next = reuseBlocks(first, buildBlocks(patched, {}));
		expect(next[0]).not.toBe(first[0]);
	});
	it("returns the previous array when everything is identical", () => {
		const items = normalizeTranscript(raw);
		const first = buildBlocks(items, {});
		expect(reuseBlocks(first, buildBlocks(items, {}))).toBe(first);
	});
});

describe("foldLabel", () => {
	it("formats running and finished labels", () => {
		const t = { steps: [{ kind: "text", key: "k", text: "x" }] as Turn["steps"], start: 1000, end: 126_000 };
		expect(foldLabel(t, true, 4000)).toBe("正在处理 3秒");
		expect(foldLabel(t, false, 0)).toBe("已处理 1 个步骤 · 2分5秒");
	});
});
