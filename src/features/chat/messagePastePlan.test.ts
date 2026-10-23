import { describe, expect, it } from "vitest";
import { planMessagePaste } from "./messagePastePlan";

describe("planMessagePaste", () => {
	it("keeps images where the markers sit, in marker order", () => {
		expect(planMessagePaste("🖼️#2 hello 🖼️#1 world", ["/a.png", "/b.png"])).toEqual([
			{ kind: "image", path: "/b.png" },
			{ kind: "text", text: "hello" },
			{ kind: "image", path: "/a.png" },
			{ kind: "text", text: "world" },
		]);
	});

	it("appends images that no marker references and drops unknown markers", () => {
		expect(planMessagePaste("hi 🖼️#9", ["/a.png", "/b.png"])).toEqual([
			{ kind: "text", text: "hi" },
			{ kind: "image", path: "/a.png" },
			{ kind: "image", path: "/b.png" },
		]);
	});

	it("does not paste file chips as prose", () => {
		expect(planMessagePaste("see 📎#1 now", [])).toEqual([{ kind: "text", text: "see  now" }]);
	});
});
