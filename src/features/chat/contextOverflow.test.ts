import { describe, expect, it } from "vitest";
import { isContextOverflowError, splitModelRef } from "./contextOverflow";

describe("isContextOverflowError", () => {
	it.each([
		"400 Prompt is too long: 210000 tokens > 200000 maximum",
		"error code: CONTEXT_LENGTH_EXCEEDED",
		"This model's maximum context length is 128000 tokens",
		"Context window exceeded",
		"input exceeds the context window of this model",
		"Too many tokens in request",
	])("detects %s", (msg) => {
		expect(isContextOverflowError(msg)).toBe(true);
	});

	it.each(["429 quota reached", "network timeout", "", null])(
		"ignores %s",
		(msg) => {
			expect(isContextOverflowError(msg)).toBe(false);
		},
	);
});

describe("splitModelRef", () => {
	it("splits provider/model and keeps nested slashes in model id", () => {
		expect(splitModelRef("openrouter/anthropic/claude")).toEqual({
			providerId: "openrouter",
			modelId: "anthropic/claude",
		});
		expect(splitModelRef("gpt-5")).toEqual({ providerId: null, modelId: "gpt-5" });
		expect(splitModelRef("  ")).toBeNull();
	});
});
