import { describe, expect, it } from "vitest";
import { mergeFailedDraft, NativeAttachmentHistory, remainingDraft, syncAttachmentTokens } from "./composerRelease";

describe("native attachment history", () => {
	it("restores image identities across normalized and grouped native undo/redo", () => {
		const images = [{ id: "a", path: "/a.png" }, { id: "b", path: "/b.png" }];
		const original = { text: "🖼️#1 and 🖼️#2", images, files: [] };
		const deleted = { text: " and 🖼️#1", images: [images[1]], files: [] };
		const typed = { ...deleted, text: deleted.text + "!" };
		const history = new NativeAttachmentHistory();
		history.record(original, deleted, " and 🖼️#2");
		history.record(deleted, typed, typed.text);
		expect(history.restore(" and 🖼️#2", "historyUndo", typed)).toBe(deleted);
		expect(history.restore(original.text, "historyUndo", deleted)).toBe(original);
		expect(history.restore(" and 🖼️#2", "historyRedo", original)).toBe(deleted);
		expect(history.restore(typed.text, "historyRedo", deleted)).toBe(typed);
		// Native editors can coalesce several character edits into one undo boundary.
		expect(history.restore(original.text, "historyUndo", typed)).toBe(original);
		expect(history.restore(typed.text, "historyRedo", original)).toBe(typed);
	});

	it("requires actual history events and the complete current object identity", () => {
		const image = { id: "a", path: "/a.png" };
		const before = { text: "🖼️#1", images: [image], files: [] };
		const after = { text: "", images: [], files: [] };
		const history = new NativeAttachmentHistory();
		history.record(before, after, "");
		expect(history.restore(before.text, "insertText", after)).toBeUndefined();
		expect(history.restore(before.text, "historyUndo", after)).toBe(before);
		expect(history.restore("", "historyRedo", { ...before, images: [{ ...image }] })).toBeUndefined();
		// A failed identity check invalidates the old transaction rather than guessing later.
		expect(history.restore("", "historyRedo", before)).toBeUndefined();
	});

	it("clears consumed attachments and truncates redo after a new edit", () => {
		const image = { id: "a", path: "/a.png" };
		const before = { text: "🖼️#1", images: [image], files: [] };
		const after = { text: "", images: [], files: [] };
		const history = new NativeAttachmentHistory();
		history.record(before, after, "");
		expect(history.restore(before.text, "historyUndo", after)).toBe(before);
		const replacement = { ...before, text: before.text + " changed" };
		history.record(before, replacement, replacement.text);
		expect(history.restore("", "historyRedo", replacement)).toBeUndefined();
		history.record(before, after, "");
		history.clear();
		expect(history.restore(before.text, "historyUndo", after)).toBeUndefined();
	});
});

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
