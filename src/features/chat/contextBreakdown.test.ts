import { describe, expect, it } from "vitest";
import type { PromptComposition } from "../../lib/contracts";
import {
	allocateCells,
	buildContextSegments,
	compactionBuffer,
	gridShape,
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
	it("leaves messages as the remainder and keeps the window fully accounted for", () => {
		const segs = buildContextSegments(1000, 10_000, comp([["system", 300], ["tools", 200]]));
		expect(tok(segs, "messages")).toBe(500);
		expect(tok(segs, "free")).toBe(9000);
		expect(segs.reduce((a, s) => a + s.tokens, 0)).toBe(10_000);
	});

	it("treats everything used as messages without a probe", () => {
		expect(tok(buildContextSegments(800, 1000, null), "messages")).toBe(800);
	});

	it("scales estimates down when they exceed reported usage", () => {
		const segs = buildContextSegments(100, 1000, comp([["system", 300], ["tools", 100]]));
		expect(tok(segs, "messages")).toBe(0);
		expect(tok(segs, "system")! + tok(segs, "tools")!).toBeLessThanOrEqual(100);
	});

	it("lets usage eat into the compaction buffer instead of overflowing", () => {
		const buffer = { tokens: 20_000, label: "自动压缩缓冲" };
		const segs = buildContextSegments(90_000, 100_000, null, buffer);
		expect(tok(segs, "buffer")).toBe(10_000);
		expect(tok(segs, "free")).toBe(0);
	});
});

describe("gridShape", () => {
	it("is 10×10 below 1M tokens and 20×10 at 1M or more, as in Claude", () => {
		expect(gridShape(200_000)).toEqual({ cols: 10, rows: 10 });
		expect(gridShape(1_000_000)).toEqual({ cols: 20, rows: 10 });
	});
});

describe("allocateCells", () => {
	const shape = { cols: 10, rows: 10 };

	it("keeps tiny categories visible and pads the middle with free space", () => {
		const cells = allocateCells(buildContextSegments(1010, 100_000, comp([["system", 10]])), 100_000, shape);
		expect(cells).toHaveLength(100);
		expect(cells.filter((c) => c.id === "system")).toHaveLength(1);
		expect(cells.filter((c) => c.id === "messages")).toHaveLength(1);
		expect(cells.filter((c) => c.id === "free")).toHaveLength(98);
	});

	it("puts the compaction buffer at the end of the block", () => {
		const segs = buildContextSegments(10_000, 100_000, null, { tokens: 20_000, label: "自动压缩缓冲" });
		const cells = allocateCells(segs, 100_000, shape);
		expect(cells.slice(-20).every((c) => c.id === "buffer")).toBe(true);
		expect(cells.filter((c) => c.id === "free")).toHaveLength(70);
	});

	it("marks a rounded-up trailing cell as partly filled", () => {
		// 1% of the window = exactly one cell; 0.4% must still show as a thinner block.
		const cells = allocateCells(buildContextSegments(400, 100_000, comp([["system", 400]])), 100_000, shape);
		const system = cells.filter((c) => c.id === "system");
		expect(system).toHaveLength(1);
		expect(system[0].fullness).toBeLessThan(0.7);
	});

	it("never overflows when many small categories round up", () => {
		const segs = buildContextSegments(
			100_000,
			100_000,
			comp([["system", 500], ["tools", 500], ["mcp", 500], ["rules", 500]]),
		);
		const cells = allocateCells(segs, 100_000, shape);
		expect(cells).toHaveLength(100);
		expect(cells.every((c) => c.id !== "free")).toBe(true);
	});
});

describe("compactionBuffer", () => {
	const base = { enabled: true, thresholdTokens: -1, thresholdPercent: -1 };
	it("uses omp's default 20k reserve", () => {
		expect(compactionBuffer(200_000, base)).toEqual({ tokens: 20_000, label: "自动压缩缓冲" });
	});
	it("derives from a percent threshold", () => {
		expect(compactionBuffer(1_000_000, { ...base, thresholdPercent: 80 }).tokens).toBe(200_000);
	});
	it("derives from a token threshold and is empty when unreachable", () => {
		expect(compactionBuffer(1_000_000, { ...base, thresholdTokens: 900_000 }).tokens).toBe(100_000);
		expect(compactionBuffer(100_000, { ...base, thresholdTokens: 150_000 }).tokens).toBe(0);
	});
	it("shows Claude's fixed 3k compact buffer when auto-compaction is off", () => {
		expect(compactionBuffer(200_000, { ...base, enabled: false })).toEqual({ tokens: 3000, label: "压缩缓冲" });
	});
});
