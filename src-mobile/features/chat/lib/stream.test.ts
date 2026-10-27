import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../../../core/normalize";
import type { RpcFrame } from "../../../core/types";
import { livePersisted, pruneLive, reduceFrame, type StreamState } from "./stream";

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
