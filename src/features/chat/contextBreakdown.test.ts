import { describe, expect, it } from "vitest";
import type { PromptComposition } from "../../lib/contracts";
import { buildContextSegments, type ContextSegment } from "./contextBreakdown";

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
		expect(tok(segs, "tools")).toBe(200);
		expect(tok(segs, "system")).toBe(300);
		expect(tok(segs, "messages")).toBe(500);
		expect(tok(segs, "free")).toBe(9000);
		expect(segs.reduce((a, s) => a + s.tokens, 0)).toBe(10_000);
	});

	it("treats everything used as messages without a probe", () => {
		expect(tok(buildContextSegments(800, 1000, null), "messages")).toBe(800);
		expect(tok(buildContextSegments(800, 1000, null), "free")).toBe(200);
	});

	it("scales estimates down when they exceed reported usage", () => {
		const segs = buildContextSegments(100, 1000, comp([["system", 300], ["tools", 100]]));
		expect(tok(segs, "messages")).toBe(0);
		expect(tok(segs, "system")! + tok(segs, "tools")!).toBeLessThanOrEqual(100);
		expect(tok(segs, "free")).toBe(900);
	});
});
