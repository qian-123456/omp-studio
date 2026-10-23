import { describe, expect, it } from "vitest";
import { expandImageTokens, expandImagesForSend } from "./imageTokens";

const imgs = [{ path: "/a.png", width: 10, height: 20 }, { path: "/b.png" }];

describe("expandImageTokens", () => {
	it("expands tokens with dimensions and path", () => {
		expect(expandImageTokens("see 🖼️#1 and 🖼️ #2", imgs)).toBe(
			"see [Image #1, 10x20: /a.png] and [Image #2: /b.png]",
		);
	});
	it("slash skill-chip text never ships a bare token (regression)", () => {
		const out = expandImagesForSend("/skill:grill-me 🖼️#1", imgs.slice(0, 1), "suffix");
		expect(out).toBe("/skill:grill-me [Image #1, 10x20: /a.png]");
		expect(out).not.toContain("🖼️");
	});
	it("appends unreferenced images at the requested end", () => {
		expect(expandImagesForSend("/x", imgs.slice(1), "suffix")).toBe("/x [Image #1: /b.png]");
		expect(expandImagesForSend("hi", imgs.slice(1))).toBe("[Image #1: /b.png] hi");
	});
});
