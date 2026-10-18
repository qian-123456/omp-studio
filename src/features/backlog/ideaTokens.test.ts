import { describe, expect, it } from "vitest";
import {
	docToStored,
	ensureTokens,
	insertImages,
	reconcileDoc,
	removeImage,
	splitTokens,
	storedToDoc,
	storedImagePaths,
	toComposerText,
} from "./ideaTokens";

describe("storedToDoc / docToStored", () => {
	it("turns inline tags into numbered tokens and back", () => {
		const doc = storedToDoc("看 [图片: /a.png] 再看 [图片: /b.png] 和 [图片: /a.png]");
		expect(doc.images).toEqual(["/a.png", "/b.png"]);
		expect(doc.text).toBe("看 🖼️ #1 再看 🖼️ #2 和 🖼️ #1");
		expect(docToStored(doc)).toBe("看 [图片: /a.png] 再看 [图片: /b.png] 和 [图片: /a.png]");
	});

	it("appends legacy ref images as tokens", () => {
		const doc = storedToDoc("旧想法", ["/r.png"]);
		expect(doc).toEqual({ text: "旧想法 🖼️ #1", images: ["/r.png"] });
		expect(storedToDoc("文 [图片: /a.png]", ["/a.png", "/b.png"]).images).toEqual(["/a.png", "/b.png"]);
	});

	it("legacy-only image item has just tokens", () => {
		expect(storedToDoc("", ["/r.png"]).text).toBe("🖼️ #1");
	});

	it("drops tokens that point at no image", () => {
		expect(docToStored({ text: "x 🖼️ #3 y", images: ["/a.png"] })).toBe("x  y");
	});
});

describe("reconcileDoc", () => {
	it("removes the image and renumbers when a token is deleted", () => {
		const doc = reconcileDoc({ text: "a 🖼️ #1 c 🖼️ #3", images: ["/a", "/b", "/c"] });
		expect(doc).toEqual({ text: "a 🖼️ #1 c 🖼️ #2", images: ["/a", "/c"] });
	});

	it("is a no-op when every token is present", () => {
		const d = { text: "🖼️ #1 🖼️ #2", images: ["/a", "/b"] };
		expect(reconcileDoc(d)).toEqual(d);
	});

	it("drops out-of-range tokens", () => {
		expect(reconcileDoc({ text: "x 🖼️ #5", images: ["/a"] })).toEqual({ text: "x ", images: [] });
	});
});

describe("removeImage", () => {
	it("drops all tokens of the image and renumbers", () => {
		const doc = { text: "a 🖼️ #1 b 🖼️ #2 🖼️ #1", images: ["/a", "/b"] };
		expect(removeImage(doc, 1)).toEqual({ text: "a  b 🖼️ #1 ", images: ["/b"] });
	});
});

describe("insertImages", () => {
	it("inserts spaced tokens at the caret and reports the new caret", () => {
		const r = insertImages({ text: "abcdef", images: [] }, 3, ["/a.png"]);
		expect(r.doc.text).toBe("abc 🖼️ #1 def");
		expect(r.doc.images).toEqual(["/a.png"]);
		expect(r.caret).toBe("abc 🖼️ #1 ".length);
	});

	it("reuses already attached images and appends new ones", () => {
		const r = insertImages({ text: "🖼️ #1", images: ["/a"] }, "🖼️ #1".length, ["/a", "/b"]);
		expect(r.doc.images).toEqual(["/a", "/b"]);
		expect(r.doc.text).toBe("🖼️ #1 🖼️ #1 🖼️ #2");
	});

	it("clamps the caret", () => {
		expect(insertImages({ text: "", images: [] }, 99, ["/a"]).doc.text).toBe("🖼️ #1");
	});
});

describe("splitTokens", () => {
	it("splits text and image segments", () => {
		expect(splitTokens("a 🖼️ #2 b")).toEqual([
			{ kind: "text", value: "a " },
			{ kind: "image", index: 2, raw: "🖼️ #2" },
			{ kind: "text", value: " b" },
		]);
	});
});

describe("toComposerText", () => {
	it("rewrites tags as composer image tokens and appends ref-only images", () => {
		const num = (p: string) => ({ "/a.png": 3, "/b.png": 4 })[p] ?? 0;
		expect(toComposerText("看 [图片: /a.png]", ["/a.png", "/b.png"], num)).toBe("看 🖼️#3 🖼️#4");
		expect(toComposerText("纯文字", [], num)).toBe("纯文字");
	});

	it("storedImagePaths lists inline then ref images, deduped", () => {
		expect(storedImagePaths("[图片: /b] x [图片: /a] [图片: /b]", ["/a", "/c"])).toEqual(["/b", "/a", "/c"]);
	});
});

describe("ensureTokens", () => {
	it("appends tokens only for unreferenced images", () => {
		expect(ensureTokens({ text: "x 🖼️ #1", images: ["/a", "/b"] })).toEqual({
			text: "x 🖼️ #1 🖼️ #2",
			images: ["/a", "/b"],
		});
		const d = { text: "🖼️ #1", images: ["/a"] };
		expect(ensureTokens(d)).toBe(d);
	});
});
