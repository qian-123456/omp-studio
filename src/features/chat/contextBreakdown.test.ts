import { describe, expect, it } from "vitest";
import type { PromptComposition, TranscriptItem } from "../../lib/contracts";
import {
	buildContextSegments,
	computeRingArcs,
	type ContextSegment,
	estimateConversation,
	liveContextItems,
} from "./contextBreakdown";

const item = (p: Partial<TranscriptItem> & Pick<TranscriptItem, "id" | "kind">): TranscriptItem => ({
	parentId: null,
	ts: "",
	text: null,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
	...p,
});
const call = (id: string, name: string, args: unknown) => ({ id, name, args, intent: null });
const result = (id: string, toolCallId: string, toolName: string, text: string) =>
	item({ id, kind: "tool_result", toolResult: { toolCallId, toolName, text, isError: false, details: null } });

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

describe("liveContextItems", () => {
	it("keeps only the latest compaction's summary, its kept entries and what follows", () => {
		const items = [
			item({ id: "a", kind: "user", text: "old" }),
			item({ id: "b", kind: "user", text: "kept" }),
			item({ id: "c", kind: "compaction", text: "summary", firstKeptEntryId: "b" }),
			item({ id: "d", kind: "user", text: "new" }),
		];
		expect(liveContextItems(items).map((i) => i.id)).toEqual(["c", "b", "d"]);
	});
});

describe("estimateConversation", () => {
	it("routes thinking, skill reads, MCP calls and other tool calls with their results", () => {
		const est = estimateConversation([
			item({ id: "u", kind: "user", text: "hi there" }),
			item({
				id: "a",
				kind: "assistant",
				text: "ok",
				thinking: "x".repeat(300),
				toolCalls: [
					call("c1", "read", { path: "skill://ego-browser/references/a.md" }),
					call("c2", "mcp__github_search", { q: "x" }),
					call("c3", "bash", { command: "ls" }),
				],
			}),
			result("r1", "c1", "read", "s".repeat(3000)),
			result("r2", "c2", "mcp__github_search", "m".repeat(600)),
			result("r3", "c3", "bash", "b".repeat(90)),
		]);
		const by = Object.fromEntries(est.map((e) => [e.id, e]));
		expect(by.thinking.tokens).toBe(100);
		expect(by.skillReads.details?.[0].name).toBe("ego-browser");
		expect(by.skillReads.tokens).toBeGreaterThan(1000);
		expect(by.mcpCalls.details?.[0].name).toBe("github_search");
		expect(by.toolCalls.details?.map((d) => d.name)).toEqual(["bash"]);
		expect(by.messages.tokens).toBe(estimateTokensOf("hi there") + estimateTokensOf("ok"));
	});

	it("scales conversation estimates to exactly fill the reported remainder", () => {
		const chat = estimateConversation([
			item({ id: "a", kind: "assistant", text: "y".repeat(300), thinking: "z".repeat(300) }),
		]);
		const segs = buildContextSegments(10_000, 100_000, comp([["system", 2000]]), chat);
		expect(tok(segs, "messages")).toBe(4000);
		expect(tok(segs, "thinking")).toBe(4000);
		expect(segs.filter((s) => s.group !== "free").reduce((a, s) => a + s.tokens, 0)).toBe(10_000);
	});
});

const estimateTokensOf = (s: string) => Math.ceil(s.length / 3);

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
