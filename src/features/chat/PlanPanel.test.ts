import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { latestAssistantTextAfter } from "./PlanPanel";

const item = (id: string, kind: string, text: string) =>
	({ id, kind, text }) as unknown as TranscriptItem;

describe("latestAssistantTextAfter", () => {
	const items = [
		item("u1", "user", "hi"),
		item("a1", "assistant", "old answer"),
		item("u2", "user", "/plan make it"),
	];

	it("ignores assistant text from before plan mode was enabled", () => {
		expect(latestAssistantTextAfter(items, "a1")).toBeNull();
		expect(latestAssistantTextAfter(items, "u2")).toBeNull();
	});

	it("returns the newest assistant text after the baseline", () => {
		const next = [...items, item("a2", "assistant", "the plan")];
		expect(latestAssistantTextAfter(next, "u2")).toBe("the plan");
		expect(latestAssistantTextAfter(next, "a1")).toBe("the plan");
	});

	it("considers everything when there is no usable baseline", () => {
		expect(latestAssistantTextAfter(items, null)).toBe("old answer");
		expect(latestAssistantTextAfter(items, "missing")).toBe("old answer");
	});
});
