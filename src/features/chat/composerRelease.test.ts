import { describe, expect, it } from "vitest";
import { mergeFailedDraft, remainingDraft, syncAttachmentTokens } from "./composerRelease";

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

describe("syncAttachmentTokens", () => {
	it("drops attachments whose token is gone and renumbers the survivors", () => {
		const r = syncAttachmentTokens("x  y 🖼️#2 📎#3", 2, 3);
		expect(r.images).toEqual([1]);
		expect(r.files).toEqual([2]);
		expect(r.text).toBe("x  y 🖼️#1 📎#1");
	});

	it("is a no-op when every token is present", () => {
		const r = syncAttachmentTokens("🖼️#1 [Image #2: /b.png]", 2, 0);
		expect(r).toEqual({ text: "🖼️#1 [Image #2: /b.png]", images: null, files: null });
	});

	it("does not confuse #1 with #10", () => {
		const text = Array.from({ length: 9 }, (_, i) => `🖼️#${i + 2}`).join(" ");
		const r = syncAttachmentTokens(`${text} 🖼️#10`, 10, 0);
		expect(r.images).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(r.text.endsWith("🖼️#9")).toBe(true);
	});
});

describe("mergeFailedDraft", () => {
	it("restores the original alone when nothing was typed since", () => {
		expect(mergeFailedDraft("hi 🖼️#1", "  ", 1, 0)).toBe("hi 🖼️#1");
	});

	it("puts the original first and shifts the newer tokens past it", () => {
		expect(mergeFailedDraft("a 🖼️#1 📎#1", "b 🖼️#1 📎#1", 1, 1)).toBe("a 🖼️#1 📎#1\nb 🖼️#2 📎#2");
	});
});
