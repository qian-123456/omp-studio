import { describe, expect, it } from "vitest";
import { catalogKeys, classifyModel, isNonChatModel, isProbeFailed } from "./modelClass";

describe("classifyModel", () => {
	it("prefers provider metadata over id heuristics", () => {
		expect(classifyModel({ id: "text-embedding-3", kind: "chat" })).toBe("chat");
		expect(classifyModel({ id: "my-chat-model", kind: "other" })).toBe("other");
	});

	it("treats OMP catalog membership as chat even when the id looks like audio/image", () => {
		expect(classifyModel({ id: "gpt-4o-audio-preview", inCatalog: true })).toBe("chat");
		expect(classifyModel({ id: "gemini-2.5-flash-image", inCatalog: true })).toBe("chat");
	});

	it("falls back to id heuristics without hiding multimodal chat models", () => {
		expect(classifyModel({ id: "text-embedding-3-small" })).toBe("other");
		expect(classifyModel({ id: "bge-m3" })).toBe("other");
		expect(classifyModel({ id: "whisper-1" })).toBe("other");
		expect(classifyModel({ id: "dall-e-3" })).toBe("other");
		expect(classifyModel({ id: "gpt-4o-audio-preview" })).toBe("chat");
		expect(classifyModel({ id: "claude-sonnet-4-5" })).toBe("chat");
		expect(classifyModel({ id: "llama-3.1-canada" })).toBe("chat");
		expect(isNonChatModel("gpt-4-ada")).toBe(true);
	});

	it("catalogKeys qualifies by provider", () => {
		const keys = catalogKeys([{ provider: "p", id: "m" }]);
		expect(keys.has("p::m")).toBe(true);
		expect(keys.has("q::m")).toBe(false);
	});
});

describe("isProbeFailed", () => {
	it("flags only finished failed probes", () => {
		expect(isProbeFailed(undefined)).toBe(false);
		expect(isProbeFailed({ state: "testing" })).toBe(false);
		expect(isProbeFailed({ state: "done", result: { ok: true, latencyMs: 1, detail: "" } })).toBe(false);
		expect(isProbeFailed({ state: "done", result: { ok: false, latencyMs: 1, detail: "空响应" } })).toBe(true);
	});
});
