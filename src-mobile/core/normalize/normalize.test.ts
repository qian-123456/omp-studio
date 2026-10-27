import { describe, expect, it } from "vitest";
import { appendUnique, applyLiveFrame, liveIsPersisted, newLiveItem, normalizeTranscript, prependUnique } from "./index";
import type { RpcFrame, TranscriptItem } from "../types";

const t = (x: Partial<TranscriptItem> & { id: string; kind: string }): TranscriptItem => x;

describe("normalizeTranscript", () => {
	it("maps user/assistant rows, drops hidden ones and keeps image references only", () => {
		const items = normalizeTranscript([
			t({ id: "e1", kind: "user", text: "hi", images: [{ id: "img1", mimeType: "image/png", path: "/tmp/a.png", width: 40, height: 30 }] }),
			t({ id: "e2", kind: "user", text: "hidden one", hidden: true }),
			t({ id: "e3", kind: "assistant", text: "yo", thinking: "hm", toolCalls: [{ id: "c1", name: "read", args: { p: 1 }, intent: "look" }] }),
		]);
		expect(items.map((i) => [i.id, i.role])).toEqual([
			["e1", "user"],
			["e3", "assistant"],
		]);
		expect(items[0].images).toEqual([{ id: "img1", mime: "image/png", path: "/tmp/a.png", marker: "", width: 40, height: 30 }]);
		expect(items[1].tools[0]).toMatchObject({ id: "c1", name: "read", intent: "look", status: "done", result: "" });
		expect(items[1].thinking).toBe("hm");
	});

	it("attaches a tool result to its call and records errors", () => {
		const items = normalizeTranscript([
			t({ id: "a", kind: "assistant", toolCalls: [{ id: "c1", name: "bash" }, { id: "c2", name: "edit" }] }),
			t({ id: "r1", kind: "tool_result", toolResult: { toolCallId: "c1", text: "ok" } }),
			t({ id: "r2", kind: "tool_result", toolResult: { toolCallId: "c2", text: "boom", isError: true } }),
		]);
		expect(items).toHaveLength(1);
		expect(items[0].tools.map((x) => [x.status, x.result])).toEqual([
			["done", "ok"],
			["error", "boom"],
		]);
	});

	it("hosts an orphan tool result on the last assistant row, or on a system row when none exists", () => {
		const hosted = normalizeTranscript([
			t({ id: "a", kind: "assistant", text: "x" }),
			t({ id: "r", kind: "tool_result", toolResult: { toolCallId: "zz", toolName: "grep", text: "out" } }),
		]);
		expect(hosted[0].tools[0]).toMatchObject({ id: "zz", name: "grep", result: "out" });
		const alone = normalizeTranscript([t({ id: "r", kind: "tool_result", toolResult: { toolCallId: "zz", text: "out" } })]);
		expect(alone[0]).toMatchObject({ role: "system", text: "out" });
	});

	it("turns bash entries and unknown kinds into rows", () => {
		const items = normalizeTranscript([
			t({ id: "b", kind: "bash", text: "ls" }),
			t({ id: "c", kind: "compaction", text: "summary" }),
			null,
		]);
		expect(items[0]).toMatchObject({ role: "assistant", kind: "bash" });
		expect(items[0].tools[0].name).toBe("bash");
		expect(items[1]).toMatchObject({ role: "system", kind: "compaction", text: "summary" });
	});
});

describe("merging", () => {
	const a = normalizeTranscript([t({ id: "1", kind: "user", text: "a" })]);
	const b = normalizeTranscript([t({ id: "1", kind: "user", text: "a" }), t({ id: "2", kind: "assistant", text: "b" })]);
	it("appendUnique never duplicates and keeps identity when nothing is new", () => {
		expect(appendUnique(a, b).map((i) => i.id)).toEqual(["1", "2"]);
		expect(appendUnique(b, a)).toBe(b);
	});
	it("prependUnique puts only unknown older rows in front", () => {
		const older = normalizeTranscript([t({ id: "0", kind: "user", text: "z" }), t({ id: "1", kind: "user", text: "a" })]);
		expect(prependUnique(a, older).map((i) => i.id)).toEqual(["0", "1"]);
		expect(prependUnique(a, a)).toBe(a);
	});
});

describe("applyLiveFrame", () => {
	const frame = (f: Partial<RpcFrame> & { type: string }): RpcFrame => f;
	it("streams text and thinking into one live row without mutating the previous one", () => {
		const start = applyLiveFrame(null, frame({ type: "agent_start" }));
		expect(start.streaming).toBe(true);
		const u1 = applyLiveFrame(start.live, frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hel" }, { type: "thinking", thinking: "t" }] } }));
		expect(u1.live).toMatchObject({ text: "Hel", thinking: "t", streaming: true });
		const u2 = applyLiveFrame(u1.live, frame({ type: "message_update", message: { content: [{ type: "text", text: "Hello" }] } }));
		expect(u2.live?.text).toBe("Hello");
		expect(u1.live?.text).toBe("Hel");
		// identical frame keeps the very same object (no wasted render)
		expect(applyLiveFrame(u2.live, frame({ type: "message_update", message: { content: [{ type: "text", text: "Hello" }] } })).live).toBe(u2.live);
	});
	it("ignores user-role message updates", () => {
		const live = newLiveItem();
		expect(applyLiveFrame(live, frame({ type: "message_update", message: { role: "user", content: [] } })).live).toBe(live);
	});
	it("tracks tool execution and asks for a refetch when it ends", () => {
		const s = applyLiveFrame(null, frame({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { cmd: "ls" } }));
		expect(s.live?.tools[0]).toMatchObject({ id: "c1", status: "running" });
		const e = applyLiveFrame(s.live, frame({ type: "tool_execution_end", toolCallId: "c1", isError: true, result: { content: [{ type: "text", text: "bad" }] } }));
		expect(e.live?.tools[0]).toMatchObject({ status: "error", result: "bad" });
		expect(e.refetch).toBe(true);
	});
	it("clears the live row only on a terminal end", () => {
		const live = newLiveItem();
		expect(applyLiveFrame(live, frame({ type: "agent_end" }))).toMatchObject({ live: null, streaming: false, refetch: true });
		expect(applyLiveFrame(live, frame({ type: "agent_end", isTerminal: false }))).toMatchObject({ live, streaming: null });
		expect(applyLiveFrame(live, frame({ type: "agent_end", isTerminal: false, awaitingAsyncWork: true }))).toMatchObject({ live: null, streaming: false });
		expect(applyLiveFrame(live, frame({ type: "turn_end" })).live).toBe(live);
		expect(applyLiveFrame(live, frame({ type: "turn_end", isTerminal: true })).live).toBeNull();
	});
	it("reports unknown frames as unhandled", () => {
		expect(applyLiveFrame(null, frame({ type: "wat" })).handled).toBe(false);
	});
});

describe("liveIsPersisted", () => {
	it("drops the live bubble once the tail assistant row holds its text", () => {
		const live = { ...newLiveItem(), text: "answer" };
		const tail = normalizeTranscript([t({ id: "a", kind: "assistant", text: "prefix answer" })]);
		expect(liveIsPersisted(tail, live)).toBe(true);
		expect(liveIsPersisted(tail, { ...live, text: "other" })).toBe(false);
		expect(liveIsPersisted(normalizeTranscript([t({ id: "u", kind: "user", text: "answer" })]), live)).toBe(false);
	});
});
