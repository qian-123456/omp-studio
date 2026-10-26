import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import type { ModelOption } from "../../lib/models";
import {
	compactTokens,
	findCandidateCompactionModel,
	findPreviousSessionModel,
	isContextOverflow,
	isContextOverflowError,
	splitModelRef,
} from "./contextOverflow";

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

	it.each(["429 quota reached", "network timeout", "", null])("ignores %s", (msg) => {
		expect(isContextOverflowError(msg)).toBe(false);
	});
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

describe("contextOverflow pure logic", () => {
	describe("compactTokens", () => {
		it("formats small and large numbers", () => {
			expect(compactTokens(0)).toBe("0");
			expect(compactTokens(500)).toBe("500");
			expect(compactTokens(2000)).toBe("2k");
			expect(compactTokens(12700)).toBe("12.7k");
			expect(compactTokens(200000)).toBe("200k");
			expect(compactTokens(1000000)).toBe("1M");
			expect(compactTokens(1500000)).toBe("1.5M");
		});
	});

	describe("isContextOverflow", () => {
		it("detects overflow when tokens exceed window", () => {
			expect(isContextOverflow({ contextTokens: 150_000, contextWindow: 128_000 })).toBe(true);
		});

		it("returns false when tokens fit within window", () => {
			expect(isContextOverflow({ contextTokens: 100_000, contextWindow: 128_000 })).toBe(false);
			expect(isContextOverflow({ contextTokens: 128_000, contextWindow: 128_000 })).toBe(false);
		});

		it("returns false for missing or invalid token/window values", () => {
			expect(isContextOverflow({})).toBe(false);
			expect(isContextOverflow({ contextTokens: null, contextWindow: 128_000 })).toBe(false);
			expect(isContextOverflow({ contextTokens: 150_000, contextWindow: null })).toBe(false);
			expect(isContextOverflow({ contextTokens: 0, contextWindow: 128_000 })).toBe(false);
			expect(isContextOverflow({ contextTokens: 150_000, contextWindow: 0 })).toBe(false);
		});
	});

	describe("findPreviousSessionModel", () => {
		it("finds the most recent model distinct from current", () => {
			const items = [
				{ id: "1", kind: "message", model: "anthropic/claude-3-7-sonnet" },
				{ id: "2", kind: "model_change", model: "openai/gpt-4o" },
				{ id: "3", kind: "message", model: "openai/gpt-4o-mini" },
			] as TranscriptItem[];

			expect(findPreviousSessionModel(items, "openai/gpt-4o-mini")).toBe("openai/gpt-4o");
			expect(findPreviousSessionModel(items, "openai/gpt-4o")).toBe("openai/gpt-4o-mini");
		});

		it("returns null when no previous model is found", () => {
			expect(findPreviousSessionModel([])).toBeNull();
			const items = [
				{ id: "1", kind: "message", model: "openai/gpt-4o" },
			] as unknown as TranscriptItem[];
			expect(findPreviousSessionModel(items, "openai/gpt-4o")).toBeNull();
		});
	});

	describe("findCandidateCompactionModel", () => {
		const models: ModelOption[] = [
			{ id: "small", provider: "test", name: "Small", contextWindow: 32_000 },
			{ id: "medium", provider: "test", name: "Medium", contextWindow: 128_000 },
			{ id: "large", provider: "test", name: "Large", contextWindow: 200_000 },
			{ id: "huge", provider: "other", name: "Huge", contextWindow: 1_000_000 },
		];

		it("prefers the previously-used model if its window is big enough", () => {
			const candidate = findCandidateCompactionModel({
				models,
				currentTokens: 150_000,
				previousModelKey: "test/large",
				currentModelKey: "test/small",
			});
			expect(candidate?.id).toBe("large");
		});

		it("skips previous model if its window is smaller than current tokens", () => {
			const candidate = findCandidateCompactionModel({
				models,
				currentTokens: 150_000,
				previousModelKey: "test/medium",
				currentModelKey: "test/small",
			});
			// "medium" only has 128k, so it should pick "large" (same provider) or "huge"
			expect(candidate?.contextWindow).toBeGreaterThanOrEqual(150_000);
			expect(candidate?.id).toBe("large");
		});

		it("prefers same provider among candidates when previous model is not given", () => {
			const candidate = findCandidateCompactionModel({
				models,
				currentTokens: 150_000,
				currentModelKey: "test/small",
			});
			expect(candidate?.id).toBe("large");
		});

		it("falls back to the largest fitting model across providers", () => {
			const candidate = findCandidateCompactionModel({
				models,
				currentTokens: 250_000,
				currentModelKey: "test/small",
			});
			expect(candidate?.id).toBe("huge");
		});

		it("returns null when no model in catalog has a large enough context window", () => {
			const candidate = findCandidateCompactionModel({
				models,
				currentTokens: 2_000_000,
				currentModelKey: "test/small",
			});
			expect(candidate).toBeNull();
		});
	});
});
