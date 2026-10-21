import { describe, expect, it } from "vitest";
import type { PromptComposition } from "../../lib/contracts";
import {
	buildContextSegments,
	computeMeterSegments,
	type ContextSegment,
} from "./contextBreakdown";

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

describe("computeMeterSegments", () => {
	it("computes exact startPct, widthPct, and pill radii matching Claude's StackedMeter", () => {
		const segs = buildContextSegments(50_000, 200_000, comp([["tools", 30_000], ["system", 20_000]]));
		const meter = computeMeterSegments(segs, 200_000, 4);
		expect(meter).toHaveLength(2);
		expect(meter[0].seam).toBe(0);
		expect(meter[0].radiusStart).toBe(2);
		expect(meter[1].seam).toBe(1);
		expect(meter[1].radiusEnd).toBe(2);
		expect(meter[0].startPct).toBe(0);
		expect(meter[1].startPct).toBeGreaterThan(0);
	});
});
