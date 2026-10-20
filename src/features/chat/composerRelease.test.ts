import { describe, expect, it } from "vitest";
import { remainingDraft } from "./composerRelease";

describe("remainingDraft", () => {
	it("keeps only text typed after the sent draft", () => {
		expect(remainingDraft("hello world", "hello", 0, 0)).toBe("world");
	});

	it("drops tokens of sent attachments and renumbers newly added ones", () => {
		// 2 images were sent; the user then added image #3 (now the only one left).
		const cur = "see 🖼️ #1 and 🖼️ #2 more 🖼️#3 text";
		const raw = "see 🖼️ #1 and 🖼️ #2";
		expect(remainingDraft(cur, raw, 2, 0)).toBe("more 🖼️#1 text");
	});

	it("handles files and images independently", () => {
		const cur = "a 📎#1 b 🖼️#1 c 📎#2 d 🖼️#2";
		expect(remainingDraft(cur, "a 📎#1 b 🖼️#1", 1, 1)).toBe("c 📎#1 d 🖼️#1");
	});

	it("returns empty when nothing new was typed", () => {
		expect(remainingDraft("x 🖼️#1", "x 🖼️#1", 1, 0)).toBe("");
	});
});
