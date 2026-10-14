import { describe, expect, it } from "vitest";
import { estimateBlockHeight, estimateTextHeight } from "./blockEstimate";
import type { DisplayBlock } from "./turnGrouping";
import type { TranscriptItem } from "../../lib/contracts";

const item = (id: string, text: string | null): TranscriptItem => ({
	id,
	parentId: null,
	ts: "2026-01-01T00:00:00Z",
	kind: "assistant",
	text,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
});

const turn = (answer: string | null, steps = 0): DisplayBlock => ({
	type: "turn",
	id: "t",
	userItem: item("u", "hi"),
	intermediateSteps: Array.from({ length: steps }, (_, i) => ({
		id: `s${i}`,
		kind: "steer" as const,
		item: item(`s${i}`, "x"),
		text: "x",
	})),
	answerItem: answer === null ? undefined : item("a", answer),
	allItemIds: ["u", "a"],
	stepCount: steps,
});

describe("block height estimates", () => {
	it("a long answer is estimated taller than a short one", () => {
		const short = estimateBlockHeight(turn("ok"));
		const long = estimateBlockHeight(turn("段落内容。".repeat(400)));
		expect(long).toBeGreaterThan(short * 5);
	});

	it("fenced code counts per source line, not as one wrapped paragraph", () => {
		const code = "```\n" + "const a = 1;\n".repeat(50) + "```";
		const prose = "const a = 1; ".repeat(50);
		expect(estimateTextHeight(code)).toBeGreaterThan(estimateTextHeight(prose));
	});

	it("tool steps add the collapsed-disclosure row", () => {
		expect(estimateBlockHeight(turn("ok", 3))).toBeGreaterThan(
			estimateBlockHeight(turn("ok", 0)),
		);
	});

	it("never collapses to zero for empty or missing blocks", () => {
		expect(estimateBlockHeight(undefined)).toBeGreaterThan(0);
		expect(estimateBlockHeight(turn(null))).toBeGreaterThan(0);
	});
});
