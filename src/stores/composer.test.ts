import { describe, expect, it } from "vitest";
import { type Annotation, formatWithAnnotations } from "./composer";

function ann(partial: Omit<Annotation, "id">): Annotation {
	return { ...partial, id: "x" };
}

describe("formatWithAnnotations", () => {
	it("returns the text unchanged when there are no annotations", () => {
		expect(formatWithAnnotations("你好", [])).toBe("你好");
	});

	it("appends numbered quote blocks", () => {
		const out = formatWithAnnotations("看看这个", [
			ann({ source: "message", text: "第一行\n第二行" }),
			ann({ source: "terminal", text: "cmd output" }),
		]);
		expect(out).toContain("看看这个");
		expect(out).toContain("[1]");
		expect(out).toContain("> 第一行");
		expect(out).toContain("> 第二行");
		expect(out).toContain("[2]");
		expect(out).toContain("> cmd output");
		expect(out.indexOf("[1]")).toBeLessThan(out.indexOf("[2]"));
	});

	it("formats diff comments as 文件 path 第 lines 行：comment", () => {
		const out = formatWithAnnotations("改这里", [
			ann({
				source: "diff",
				text: "+new line",
				file: "src/a.ts",
				lines: "10-12",
				comment: "这里写错了",
			}),
		]);
		expect(out).toContain("文件 src/a.ts 第 10-12 行：这里写错了");
	});

	it("works with an empty composer text", () => {
		const out = formatWithAnnotations("", [
			ann({ source: "doc", text: "quoted", file: "README.md" }),
		]);
		expect(out).toContain("[1]");
		expect(out).toContain("README.md");
	});
});
