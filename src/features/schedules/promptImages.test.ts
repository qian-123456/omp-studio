import { describe, expect, it } from "vitest";
import { docToPrompt, promptToDoc } from "./promptImages";

describe("promptImages", () => {
	it("round-trips markers through editable tokens", () => {
		const stored = "看 [Image #1: /a.png] 对比 [Image #2: /b.png] 与 [Image #1: /a.png]";
		const doc = promptToDoc(stored);
		expect(doc.images).toEqual(["/a.png", "/b.png"]);
		expect(doc.text).toBe("看 🖼️ #1 对比 🖼️ #2 与 🖼️ #1");
		expect(docToPrompt(doc)).toBe(stored);
	});
	it("parses dimensioned markers and drops orphan tokens", () => {
		expect(promptToDoc("[Image #1, 10x20: /a.png]").images).toEqual(["/a.png"]);
		expect(docToPrompt({ text: "x 🖼️ #3", images: ["/a.png"] })).toBe("x ");
	});
});
