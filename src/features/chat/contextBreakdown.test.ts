import { describe, expect, it } from "vitest";
import type { PromptComposition } from "../../lib/contracts";
import { buildContextSegments, computeRingArcs, type ContextSegment } from "./contextBreakdown";

const comp = (cats: Array<[PromptComposition["categories"][number]["id"], number]>): PromptComposition => ({
	cwd: "/a",
	categories: cats.map(([id, tokens]) => ({ id, label: id, tokens, items: [] })),
	totalTokens: cats.reduce((a, [, t]) => a + t, 0),
	reportedTokens: null,
	contextWindow: null,
	hints: [],
	probeMs: 0,
	estimateNote: "",
});

const tok = (segs: ContextSegment[], id: string) => segs.find((s) => s.id === id)?.tokens;

describe("buildContextSegments", () => {
	it("leaves messages as the remainder and sorts used descending with free space last", () => {
		const segs = buildContextSegments(1000, 10_000, comp([["system", 300], ["tools", 200]]));
		expect(tok(segs, "tools")).toBe(200);
		expect(tok(segs, "system")).toBe(300);
		expect(tok(segs, "messages")).toBe(500);
		expect(tok(segs, "free")).toBe(9000);
		expect(segs[segs.length - 1].id).toBe("free");
	});

	it("treats everything used as messages without a probe", () => {
		const segs = buildContextSegments(800, 1000, null);
		expect(tok(segs, "messages")).toBe(800);
		expect(tok(segs, "free")).toBe(200);
	});

	it("scales estimates down when they exceed reported usage", () => {
		const segs = buildContextSegments(100, 1000, comp([["system", 300], ["tools", 100]]));
		expect(tok(segs, "messages")).toBeUndefined();
		expect(tok(segs, "free")).toBe(900);
	});
});

describe("computeRingArcs", () => {
	it("lays used categories end to end with seams and leaves free space as track", () => {
		const segs = buildContextSegments(50_000, 200_000, comp([["tools", 30_000], ["system", 20_000]]));
		const arcs = computeRingArcs(segs, 200_000, 400, { gap: 2, minLength: 3 });
		expect(arcs.map((a) => a.id)).toEqual(["tools", "system"]);
		expect(arcs[0].offset).toBe(0);
		expect(arcs[0].length).toBe(58);
		expect(arcs[1].offset).toBe(60);
		expect(arcs[1].length).toBe(38);
	});

	it("keeps tiny categories visible and never runs past the full circle", () => {
		const tiny = buildContextSegments(100, 1_000_000, comp([["skills", 10]]));
		const arcs = computeRingArcs(tiny, 1_000_000, 300, { gap: 1, minLength: 3 });
		expect(arcs.every((a) => a.length >= 3)).toBe(true);

		const full = buildContextSegments(1000, 1000, comp([["tools", 999]]));
		const fullArcs = computeRingArcs(full, 1000, 300, { gap: 1, minLength: 3 });
		const last = fullArcs[fullArcs.length - 1];
		expect(last.offset + last.length).toBeLessThanOrEqual(300);
	});
});
