import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../../../core/normalize";
import type { RpcFrame } from "../../../core/types";
import { contentMatch, contentPersisted, livePersisted, pruneLive, reduceFrame, type StreamState } from "./stream";

const idle: StreamState = { live: null, working: false };
const msg = (text: string): RpcFrame => ({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text }] } });

describe("reduceFrame", () => {
	it("starts working on agent_start and streams text into one live row", () => {
		const a = reduceFrame(idle, { type: "agent_start" });
		expect(a.state.working).toBe(true);
		expect(a.reloadState).toBe(true);
		const b = reduceFrame(a.state, msg("he"));
		const c = reduceFrame(b.state, msg("hello"));
		expect(c.state.live?.text).toBe("hello");
		expect(c.state.live?.id).toBe(b.state.live?.id);
	});

	it("an identical update keeps the same live object (no re-render)", () => {
		const b = reduceFrame(idle, msg("same"));
		const c = reduceFrame(b.state, msg("same"));
		expect(c.state.live).toBe(b.state.live);
	});

	it("message_end refetches but keeps the live row until persisted", () => {
		const b = reduceFrame(idle, msg("done"));
		const e = reduceFrame(b.state, { type: "message_end" });
		expect(e.refetch).toBe(true);
		expect(e.state.live).toBe(b.state.live);
		expect(e.state.working).toBe(true);
	});

	it("takes the final assistant snapshot even when it differs from the last update", () => {
		const b = reduceFrame(idle, msg("partial"));
		const e = reduceFrame(b.state, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "final" }] } });
		expect(e.state.live?.text).toBe("final");
		expect(e.state.live?.streaming).toBe(false);
		expect(e.refetch).toBe(true);
	});

	it("terminal agent_end stops work, flags the turn end and hands back the dropped live row", () => {
		const b = reduceFrame(idle, msg("answer"));
		const e = reduceFrame(b.state, { type: "agent_end", isTerminal: true });
		expect(e.state).toEqual({ live: null, working: false });
		expect(e.turnEnded).toBe(true);
		expect(e.dropped?.text).toBe("answer");
	});

	it("non-terminal agent_end keeps working, awaitingAsyncWork goes idle", () => {
		const b = reduceFrame(idle, msg("x"));
		const cont = reduceFrame(b.state, { type: "agent_end", isTerminal: false });
		expect(cont.state.working).toBe(true);
		expect(cont.turnEnded).toBe(false);
		const wait = reduceFrame(b.state, { type: "agent_end", isTerminal: false, awaitingAsyncWork: true });
		expect(wait.state.working).toBe(false);
	});

	it("tracks tool lifecycle on the live row", () => {
		const s = reduceFrame(idle, { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } });
		expect(s.state.live?.tools[0]).toMatchObject({ id: "c1", status: "running" });
		const e = reduceFrame(s.state, { type: "tool_execution_end", toolCallId: "c1", result: { content: [{ type: "text", text: "a\nb" }] } });
		expect(e.state.live?.tools[0]).toMatchObject({ status: "done", result: "a\nb" });
		expect(e.refetch).toBe(true);
	});

	it("streams tool_execution_update partial output into the running tool card", () => {
		const s = reduceFrame(idle, { type: "tool_execution_start", toolCallId: "c1", toolName: "bash" }).state;
		const u = reduceFrame(s, { type: "tool_execution_update", toolCallId: "c1", partialResult: { content: [{ type: "text", text: "loading…" }] } });
		expect(u.state.live?.tools[0]).toMatchObject({ status: "running", result: "loading…" });
		expect(u.handled).toBe(true);
		expect(u.refetch).toBe(false);
		// An update frame never flips the working flag on its own.
		expect(u.state.working).toBe(s.working);
	});
});

describe("pruneLive", () => {
	const persisted = normalizeTranscript([
		{ id: "u", kind: "user", text: "q" },
		{ id: "a", kind: "assistant", text: "final answer", toolCalls: [{ id: "c1", name: "bash" }] },
		{ id: "r", kind: "tool_result", toolResult: { toolCallId: "c1", text: "ok" } },
	]);
	it("detects the persisted copy by text suffix or thinking", () => {
		const live = reduceFrame(idle, msg("final answer")).state.live;
		expect(livePersisted(persisted, live)).toBe(true);
		expect(livePersisted(persisted, reduceFrame(idle, msg("different")).state.live)).toBe(false);
	});
	it("does not let an earlier identical answer acknowledge a newer stream or retained segment", () => {
		const oldTs = "2026-11-06T10:00:00.000Z";
		const newTs = "2026-11-06T10:01:00.000Z";
		const frame = { type: "message_update", message: { role: "assistant", timestamp: Date.parse(newTs), content: [{ type: "text", text: "same answer" }] } };
		const live = reduceFrame(idle, frame).state.live;
		const oldRows = normalizeTranscript([{ id: "old", kind: "assistant", text: "same answer", ts: oldTs }]);
		expect(live?.ts).toBe(newTs);
		expect(livePersisted(oldRows, live)).toBe(false);
		expect(contentPersisted(oldRows, "same answer", "", newTs)).toBe(false);
		const currentRows = normalizeTranscript([{ id: "new", kind: "assistant", text: "same answer", ts: newTs }]);
		expect(livePersisted(currentRows, live)).toBe(true);
		expect(contentPersisted(currentRows, "same answer", "", newTs)).toBe(true);
	});
	it("clears text and drops resolved tools, keeps unresolved ones", () => {
		let s = reduceFrame(idle, msg("final answer")).state;
		s = reduceFrame(s, { type: "tool_execution_start", toolCallId: "c1", toolName: "bash" }).state;
		s = reduceFrame(s, { type: "tool_execution_start", toolCallId: "c2", toolName: "bash" }).state;
		const pruned = pruneLive(persisted, s.live);
		expect(pruned?.text).toBe("");
		expect(pruned?.tools.map((t) => t.id)).toEqual(["c2"]);
	});
	it("returns the same object when nothing changes", () => {
		const live = reduceFrame(idle, msg("still streaming")).state.live;
		expect(pruneLive(persisted, live)).toBe(live);
	});
});

describe("contentPersisted / contentMatch", () => {
	const rows = normalizeTranscript([
		{ id: "u", kind: "user", text: "q" },
		{ id: "a", kind: "assistant", text: "final answer", thinking: "chain of thought" },
	]);
	it("matches equal and prefix-persisted text, and thinking-only rows", () => {
		expect(contentPersisted(rows, "final answer", "")).toBe(true);
		expect(contentPersisted(rows, "final ", "")).toBe(true);
		expect(contentPersisted(rows, "", "")).toBe(false);
		expect(contentPersisted(rows, "不同内容", "")).toBe(false);
		expect(contentPersisted(rows, "", "不存在")).toBe(false);
		expect(contentPersisted(rows, "final answer with an unseen suffix", "")).toBe(false);
		expect(contentPersisted(rows, "", "chain of thought with an unseen suffix")).toBe(false);
	});

	it("dedups a retained segment against any recent assistant row, not only the tail", () => {
		const items = normalizeTranscript([
			{ id: "a1", kind: "assistant", text: "第一段" },
			{ id: "a2", kind: "assistant", text: "第二段" },
		]);
		expect(contentPersisted(items, "第一段", "")).toBe(true);
		expect(contentPersisted(items, "第三段", "")).toBe(false);
	});

	it("deduplicates earlier retained segments after a long turn persists in one page", () => {
		const items = normalizeTranscript(Array.from({ length: 40 }, (_, index) => ({ id: `a${index}`, kind: "assistant", text: `segment ${index}` })));
		expect(contentPersisted(items, "segment 0", "")).toBe(true);
		expect(contentPersisted(items, "segment 39", "")).toBe(true);
	});

	it("contentMatch is a two-way prefix containment on trimmed text", () => {
		expect(contentMatch("abc", "abc")).toBe(true);
		expect(contentMatch("abcdef", "abc")).toBe(true);
		expect(contentMatch("abc", "abcdef")).toBe(true);
		expect(contentMatch("xabc", "abc")).toBe(false);
		expect(contentMatch("", "abc")).toBe(false);
		expect(contentMatch("abd", "abc")).toBe(false);
	});
});
