import { describe, expect, it } from "vitest";
import { sideChatTitle } from "./sideChatTitle";

const s = (id: string, parentId: string | null, createdAt: string, kind: "side" | "fork" | null = "side") => ({
	id,
	parentId,
	createdAt,
	label: `#1.${id}`,
	kind,
});

describe("sideChatTitle", () => {
	const sessions = {
		p: s("p", null, "2026-01-01", null),
		b: s("b", "p", "2026-01-03"),
		a: s("a", "p", "2026-01-02"),
		f: s("f", "p", "2026-01-02T12", "fork"),
		o: s("o", "q", "2026-01-01"),
	};

	it("numbers per parent in creation order, ignoring forks and other parents", () => {
		expect(sideChatTitle("a", sessions)).toBe("辅助对话1");
		expect(sideChatTitle("b", sessions)).toBe("辅助对话2");
		expect(sideChatTitle("o", sessions)).toBe("辅助对话1");
	});

	it("returns null for main sessions, forks and unknown ids", () => {
		expect(sideChatTitle("p", sessions)).toBeNull();
		expect(sideChatTitle("f", sessions)).toBeNull();
		expect(sideChatTitle("zz", sessions)).toBeNull();
	});
});
