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

	it("shows everything as a pending system prompt when there is no probe and no chat estimate", () => {
		const segs = buildContextSegments(800, 1000, null);
		expect(segs.find((s) => s.pending)).toMatchObject({ id: "system", group: "prompt", tokens: 800 });
		expect(tok(segs, "free")).toBe(200);
	});

	it("keeps raw chat estimates without a probe and leaves the remainder pending", () => {
		const chat = estimateConversation([item({ id: "a", kind: "assistant", text: "y".repeat(300) })]);
		const segs = buildContextSegments(1000, 5000, null, chat);
		expect(tok(segs, "messages")).toBe(100);
		expect(segs.find((s) => s.pending)?.tokens).toBe(900);
	});

	it("caps raw chat estimates at used without a probe", () => {
		const chat = estimateConversation([item({ id: "a", kind: "assistant", text: "y".repeat(3000) })]);
		const segs = buildContextSegments(400, 5000, null, chat);
		expect(tok(segs, "messages")).toBe(400);
		expect(segs.find((s) => s.pending)).toBeUndefined();
	});

	it("keeps integer segments summing to used exactly", () => {
		const chat: Parameters<typeof buildContextSegments>[3] = [
			{ id: "messages", tokens: 1 },
			{ id: "thinking", tokens: 1 },
			{ id: "toolCalls", tokens: 1 },
		];
		const segs = buildContextSegments(1000, 5000, comp([["system", 333], ["tools", 111]]), chat);
		expect(segs.filter((s) => s.group !== "free").reduce((a, s) => a + s.tokens, 0)).toBe(1000);
	});

	it("shares an overshoot between prompt and conversation instead of dropping the chat", () => {
		const chat: Parameters<typeof buildContextSegments>[3] = [{ id: "messages", tokens: 3000 }];
		const segs = buildContextSegments(10_000, 100_000, comp([["system", 12_000]]), chat);
		expect(tok(segs, "system")).toBe(8000);
		expect(tok(segs, "messages")).toBe(2000);
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

describe("liveContextItems branches", () => {
	it("drops abandoned branches by following parentId from the leaf", () => {
		const items = [
			item({ id: "a", kind: "user", text: "root" }),
			item({ id: "b", kind: "assistant", parentId: "a" }),
			item({ id: "c", kind: "user", parentId: "b", text: "abandoned" }),
			item({ id: "d", kind: "user", parentId: "b", text: "live" }),
			item({ id: "e", kind: "assistant", parentId: "d" }),
		];
		expect(liveContextItems(items).map((i) => i.id)).toEqual(["a", "b", "d", "e"]);
	});

	it("falls back to file order when the parent is a dropped entry", () => {
		const items = [
			item({ id: "a", kind: "user" }),
			item({ id: "b", kind: "tool_result", parentId: "ghost" }),
		];
		expect(liveContextItems(items).map((i) => i.id)).toEqual(["a", "b"]);
	});

	it("applies compaction on the active branch only", () => {
		const items = [
			item({ id: "a", kind: "user" }),
			item({ id: "x", kind: "user", parentId: "a" }),
			item({ id: "b", kind: "user", parentId: "a" }),
			item({ id: "c", kind: "compaction", parentId: "b", firstKeptEntryId: "b" }),
			item({ id: "d", kind: "user", parentId: "c" }),
		];
		expect(liveContextItems(items).map((i) => i.id)).toEqual(["c", "b", "d"]);
	});
});

describe("estimateConversation", () => {
	it("counts skill-prompt custom items as skill reads and images as messages", () => {
		const est = estimateConversation([
			item({ id: "s", kind: "custom", text: '[IMPORTANT: User invoked the "eli5" skill; follow it.]\n' + "x".repeat(900) }),
			item({ id: "u", kind: "user", text: "", images: [{ id: "i", width: 1500, height: 1000 }] }),
		]);
		const by = Object.fromEntries(est.map((e) => [e.id, e]));
		expect(by.skillReads.details?.[0].name).toBe("eli5");
		expect(by.skillReads.tokens).toBeGreaterThan(300);
		expect(by.messages.tokens).toBe(1600);
	});

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
	it("tiles used categories end to end with no seams and leaves free space as track", () => {
		const segs = buildContextSegments(50_000, 200_000, comp([["tools", 30_000], ["system", 20_000]]));
		const arcs = computeRingArcs(segs, 200_000, 400);
		expect(arcs.map((a) => a.id)).toEqual(["tools", "system"]);
		expect(arcs[0].offset).toBe(0);
		expect(arcs[0].length).toBeCloseTo(60);
		expect(arcs[1].offset).toBeCloseTo(60);
		expect(arcs[1].length).toBeCloseTo(40);
	});

	it("widens tiny categories while the total span still equals the used fraction", () => {
		const tiny = buildContextSegments(100_000, 1_000_000, comp([["skills", 10], ["tools", 99_990]]));
		const arcs = computeRingArcs(tiny, 1_000_000, 300, { minLength: 3 });
		expect(arcs.every((a) => a.length >= 3 - 1e-9)).toBe(true);
		const last = arcs[arcs.length - 1];
		expect(last.offset + last.length).toBeCloseTo(30);
		arcs.slice(1).forEach((a, i) => expect(a.offset).toBeCloseTo(arcs[i].offset + arcs[i].length));
	});

	it("never runs past the full circle", () => {
		const full = buildContextSegments(1000, 1000, comp([["tools", 999]]));
		const arcs = computeRingArcs(full, 1000, 300);
		const last = arcs[arcs.length - 1];
		expect(last.offset + last.length).toBeLessThanOrEqual(300 + 1e-9);
	});
});
