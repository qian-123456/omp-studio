// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTranscript, runChatBench } from "./harness";

class RO {
	observe() {}
	disconnect() {}
	unobserve() {}
}

beforeEach(() => vi.stubGlobal("ResizeObserver", RO));
afterEach(() => vi.unstubAllGlobals());

describe("chat bench harness", () => {
	it("generates a transcript with tool results", () => {
		const raw = makeTranscript(150);
		expect(raw.filter((r) => r.kind === "user")).toHaveLength(150);
		expect(raw.some((r) => r.kind === "tool_result")).toBe(true);
	});

	it("mounts 150 turns and measures keystrokes while streaming (jsdom timings are not representative)", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const r = await runChatBench(host, { turns: 150, keystrokes: 8, streaming: true, ime: true });
		expect(r.samples).toHaveLength(8);
		expect(r.p95).toBeGreaterThanOrEqual(r.p50);
		expect(Number.isFinite(r.mountMs)).toBe(true);
	});
});
