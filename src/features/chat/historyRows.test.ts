import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { estimateBlockHeight } from "./blockEstimate";
import { buildHistoryRows, splitAnswerText } from "./historyRows";
import { rowStaticMetrics } from "./renderBudget";
import type { DisplayBlock, HistoryTurnRow, TurnBlock, TurnStep } from "./turnGrouping";

const item = (id: string, kind: TranscriptItem["kind"], text: string | null): TranscriptItem => ({
	id,
	parentId: null,
	ts: "2026-01-01T00:00:00Z",
	kind,
	text,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
});

const paragraphs = (n: number, prefix = "p") =>
	Array.from({ length: n }, (_, i) => `${prefix}${i} ${"段落内容。".repeat(30)}`).join("\n\n");

const toolStep = (id: string): TurnStep => ({
	id,
	kind: "tool",
	item: item(`it-${id}`, "assistant", null),
	call: { id, name: "read", args: {}, intent: null },
});
const proseStep = (id: string, text: string): TurnStep => ({
	id,
	kind: "text",
	item: item(`it-${id}`, "assistant", text),
	text,
});

function turn(opts: {
	id?: string;
	user?: string | null;
	steps?: TurnStep[];
	answer?: string | null;
}): TurnBlock {
	const id = opts.id ?? "t1";
	const userItem = opts.user === null ? null : item(`${id}-u`, "user", opts.user ?? "hi");
	const answerItem = opts.answer == null ? undefined : item(`${id}-a`, "assistant", opts.answer);
	const steps = opts.steps ?? [];
	return {
		type: "turn",
		id: `turn-${id}`,
		userItem,
		intermediateSteps: steps,
		answerItem,
		allItemIds: [
			...(userItem ? [userItem.id] : []),
			...steps.map((s) => s.item.id),
			...(answerItem ? [answerItem.id] : []),
			`${id}-hidden-result`,
		],
		stepCount: steps.length,
	};
}

const turnRows = (blocks: DisplayBlock[]) =>
	buildHistoryRows(blocks).filter((r): r is HistoryTurnRow => r.type === "turn");

describe("splitAnswerText", () => {
	it("keeps short text whole", () => {
		expect(splitAnswerText("hello\n\nworld")).toEqual(["hello\n\nworld"]);
	});

	it("is lossless: slices rejoin to the exact source", () => {
		const text = paragraphs(40);
		const slices = splitAnswerText(text);
		expect(slices.length).toBeGreaterThan(2);
		expect(slices.join("\n")).toBe(text);
	});

	it("never cuts inside a fenced code block", () => {
		const code = "```ts\n" + "const a = 1;\n\n".repeat(80) + "```";
		const text = `${paragraphs(10)}\n\n${code}\n\n${paragraphs(10, "q")}`;
		const slices = splitAnswerText(text);
		expect(slices.join("\n")).toBe(text);
		for (const s of slices) {
			const fences = s.split("\n").filter((l) => l.startsWith("```")).length;
			expect(fences % 2).toBe(0);
		}
	});

	it("does not cut where a list continues across the blank line", () => {
		const list = Array.from({ length: 60 }, (_, i) => `- ${"项目内容".repeat(20)} ${i}`).join("\n\n");
		expect(splitAnswerText(list)).toEqual([list]);
	});
});

describe("buildHistoryRows", () => {
	it("passes a small turn through as one row that keeps the turn id", () => {
		const t = turn({ answer: "ok" });
		const rows = turnRows([t]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: t.id,
			turnId: t.id,
			partCount: 1,
			isFirstTurnPart: true,
			isLastTurnPart: true,
			renderAnswerAnchor: true,
		});
		expect(rows[0].allItemIds).toEqual(t.allItemIds);
	});

	it("splits a huge turn into several rows with unique ids", () => {
		const t = turn({ answer: paragraphs(60) });
		const rows = turnRows([t]);
		expect(rows.length).toBeGreaterThan(3);
		expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
		expect(rows.map((r) => r.partIndex)).toEqual(rows.map((_, i) => i));
		for (const r of rows) {
			expect(r.partCount).toBe(rows.length);
			expect(r.turnId).toBe(t.id);
			expect(r.turn).toBe(t);
		}
	});

	it("emits the answer anchor once and the footer part last", () => {
		const t = turn({ answer: paragraphs(60) });
		const rows = turnRows([t]);
		expect(rows.filter((r) => r.renderAnswerAnchor)).toHaveLength(1);
		expect(rows.find((r) => r.renderAnswerAnchor)?.answerItem).toBe(t.answerItem);
		expect(rows.filter((r) => r.isLastTurnPart)).toHaveLength(1);
		expect(rows[rows.length - 1].isLastTurnPart).toBe(true);
		expect(rows[rows.length - 1].answerItem).toBe(t.answerItem);
		expect(rows.filter((r) => r.isFirstTurnPart)).toHaveLength(1);
		expect(rows.slice(1).every((r) => r.isContinuation)).toBe(true);
	});

	it("loses no content: user once, every step once in order, answer slices rejoin", () => {
		const steps: TurnStep[] = [];
		for (let i = 0; i < 12; i++) {
			steps.push(toolStep(`tool${i}`), proseStep(`prose${i}`, paragraphs(3, `s${i}-`)));
		}
		const t = turn({ steps, answer: paragraphs(50) });
		const rows = turnRows([t]);
		expect(rows.length).toBeGreaterThan(4);

		expect(rows.filter((r) => r.userItem).map((r) => r.userItem)).toEqual([t.userItem]);
		const gotIds = rows.flatMap((r) => r.intermediateSteps.map((s) => s.id));
		expect([...gotIds].sort()).toEqual(t.intermediateSteps.map((s) => s.id).sort());
		const slices = rows.filter((r) => r.answerItem).map((r) => r.answerSlice ?? "");
		expect(slices.join("\n")).toBe(t.answerItem?.text);
		// Item ids are partitioned: every source id in exactly one row.
		const all = rows.flatMap((r) => r.allItemIds);
		expect(new Set(all).size).toBe(all.length);
		expect([...all].sort()).toEqual([...t.allItemIds].sort());
	});

	it("keeps each run's fold whole and owns first/last fold in exactly one part", () => {
		const steps: TurnStep[] = [
			toolStep("a"),
			proseStep("pa", paragraphs(8)),
			{ id: "steer1", kind: "steer", item: item("steer1", "user", "more"), text: "more" },
			toolStep("b"),
			toolStep("c"),
			proseStep("pb", paragraphs(8)),
		];
		const rows = turnRows([turn({ steps, answer: "done" })]);
		expect(rows.filter((r) => r.ownsFirstFold)).toHaveLength(1);
		expect(rows.filter((r) => r.ownsLastFold)).toHaveLength(1);
		const withB = rows.filter((r) => r.intermediateSteps.some((s) => s.id === "b"));
		expect(withB).toHaveLength(1);
		expect(withB[0].intermediateSteps.some((s) => s.id === "c")).toBe(true);
	});

	it("passes protocol blocks through unchanged between turns", () => {
		const proto: DisplayBlock = {
			type: "protocol",
			id: "p1",
			item: item("p1", "system", "x"),
			allItemIds: ["p1"],
		};
		const rows = buildHistoryRows([turn({ id: "a", answer: "1" }), proto, turn({ id: "b", answer: "2" })]);
		expect(rows.map((r) => r.type)).toEqual(["turn", "protocol", "turn"]);
		expect(rows[1]).toBe(proto);
	});
});

describe("row estimates and metrics", () => {
	it("each part is estimated smaller than the whole turn, footer only on the last", () => {
		const t = turn({ answer: paragraphs(60) });
		const rows = turnRows([t]);
		const whole = estimateBlockHeight(t);
		for (const r of rows) expect(estimateBlockHeight(r)).toBeLessThan(whole / 2);
		const sum = rows.reduce((n, r) => n + estimateBlockHeight(r), 0);
		expect(sum).toBeGreaterThan(whole * 0.6);
	});

	it("counts only what the row renders", () => {
		const code = "```\nx\n```\n\n```\ny\n```";
		const rows = turnRows([
			turn({ steps: [toolStep("a"), toolStep("b")], answer: code, user: "q" }),
		]);
		const m = rowStaticMetrics(rows[0]);
		expect(m.toolCalls).toBe(2);
		expect(m.codeBlocks).toBe(2);
		expect(m.chars).toBe(code.length + 1);
	});
});
