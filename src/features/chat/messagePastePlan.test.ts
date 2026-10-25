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

	it("does not paste unresolvable file chips as prose", () => {
		expect(planMessagePaste("see 📎#1 now", [])).toEqual([
			{ kind: "text", text: "see" },
			{ kind: "text", text: "now" },
		]);
	});

	it("restores a video attachment from the bare 📎#N marker, text preserved", () => {
		expect(planMessagePaste("📎#1 帮我修一下这个闪烁的问题", [], ["/tmp/clip.mp4"])).toEqual([
			{ kind: "file", path: "/tmp/clip.mp4" },
			{ kind: "text", text: "帮我修一下这个闪烁的问题" },
		]);
	});

	it("uses the path embedded in a serialized file marker", () => {
		expect(
			planMessagePaste("[文件 #1: /tmp/a.pdf] hi 🖼️#1", ["/x.png"], ["/tmp/a.pdf"]),
		).toEqual([
			{ kind: "file", path: "/tmp/a.pdf" },
			{ kind: "text", text: "hi" },
			{ kind: "image", path: "/x.png" },
		]);
	});

	it("appends files no marker references", () => {
		expect(planMessagePaste("hi", [], ["/a.zip"])).toEqual([
			{ kind: "text", text: "hi" },
			{ kind: "file", path: "/a.zip" },
		]);
	});
});
