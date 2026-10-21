import { describe, expect, it } from "vitest";
import type { PromptComposition } from "../../lib/contracts";
import { allocateCells, autocompactBuffer, buildContextSegments, type ContextSegment } from "./contextBreakdown";

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
	it("puts the remainder after fixed categories into messages and keeps totals equal to the window", () => {
		const segs = buildContextSegments(1000, 10_000, comp([["system", 300], ["tools", 200]]));
		expect(tok(segs, "messages")).toBe(500);
		expect(tok(segs, "free")).toBe(9000);
		expect(segs.reduce((a, s) => a + s.tokens, 0)).toBe(10_000);
	});

	it("treats everything as messages without a probe", () => {
		const segs = buildContextSegments(800, 1000, null);
		expect(tok(segs, "messages")).toBe(800);
	});

	it("scales estimates down when they exceed reported usage", () => {
		const segs = buildContextSegments(100, 1000, comp([["system", 300], ["tools", 100]]));
		expect(tok(segs, "messages")).toBe(0);
		expect(segs.reduce((a, s) => a + s.tokens, 0)).toBeLessThanOrEqual(1000);
		expect(tok(segs, "system")! + tok(segs, "tools")!).toBeLessThanOrEqual(100);
	});
});

describe("allocateCells", () => {
	it("keeps tiny used segments visible and fills the rest with free", () => {
		const segs = buildContextSegments(1010, 100_000, comp([["system", 10]]));
		const cells = allocateCells(segs, 100_000, 100);
		expect(cells).toHaveLength(100);
		expect(cells.filter((c) => c === "system")).toHaveLength(1);
		expect(cells.filter((c) => c === "messages")).toHaveLength(1);
		expect(cells.filter((c) => c === "free")).toHaveLength(98);
	});

	it("never overflows when many segments are rounded up", () => {
		const segs = buildContextSegments(100_000, 100_000, comp([["system", 500], ["tools", 500], ["mcp", 500], ["rules", 500]]));
		const cells = allocateCells(segs, 100_000, 100);
		expect(cells).toHaveLength(100);
		expect(cells.every((c) => c !== "free")).toBe(true);
	});

	it("puts the autocompact buffer at the end and keeps it out of used tokens", () => {
		const segs = buildContextSegments(10_000, 100_000, null, 20_000);
		expect(tok(segs, "free")).toBe(70_000);
		expect(tok(segs, "buffer")).toBe(20_000);
		const cells = allocateCells(segs, 100_000, 100);
		expect(cells.slice(-20).every((c) => c === "buffer")).toBe(true);
		expect(cells.filter((c) => c === "free")).toHaveLength(70);
	});

	it("lets usage eat into the buffer instead of overflowing the window", () => {
		const segs = buildContextSegments(90_000, 100_000, null, 20_000);
		expect(tok(segs, "buffer")).toBe(10_000);
		expect(tok(segs, "free")).toBe(0);
	});
});

describe("autocompactBuffer", () => {
	const base = { enabled: true, thresholdTokens: -1, thresholdPercent: -1 };
	it("uses the default 20k reserve", () => {
		expect(autocompactBuffer(200_000, base)).toBe(20_000);
	});
	it("derives from a percent threshold", () => {
		expect(autocompactBuffer(1_000_000, { ...base, thresholdPercent: 80 })).toBe(200_000);
	});
	it("derives from a token threshold and is empty when unreachable", () => {
		expect(autocompactBuffer(1_000_000, { ...base, thresholdTokens: 900_000 })).toBe(100_000);
		expect(autocompactBuffer(100_000, { ...base, thresholdTokens: 150_000 })).toBe(0);
	});
	it("is zero when auto-compaction is off", () => {
		expect(autocompactBuffer(200_000, { ...base, enabled: false })).toBe(0);
	});
});
