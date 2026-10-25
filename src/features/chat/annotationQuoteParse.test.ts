import { describe, expect, it } from "vitest";
import { formatWithAnnotations } from "../../stores/composer";
import { parseAnnotationQuotes } from "./annotationQuoteParse";

describe("parseAnnotationQuotes", () => {
	it("parses the bubble from the bug report", () => {
		const raw = "[1]\n> awaiting_answer\n批注：这个应该是未读吧，不是等待我回答\n\n那你觉得怎么改好";
		expect(parseAnnotationQuotes(raw)).toEqual({
			cards: [{ n: 1, quote: "awaiting_answer", comment: "这个应该是未读吧，不是等待我回答" }],
			body: "那你觉得怎么改好",
		});
	});

	it("round-trips formatWithAnnotations output", () => {
		const out = formatWithAnnotations("请看", [
			{ id: "a", source: "message", text: "第一行\n第二行", comment: "多行\n批注" },
			{ id: "b", source: "doc", text: "code", file: "a.md", lines: "3-4" },
			{ id: "c", source: "message", text: "from side", label: "来自辅助对话" },
		]);
		const parsed = parseAnnotationQuotes(out);
		expect(parsed?.body).toBe("请看");
		expect(parsed?.cards).toEqual([
			{ n: 1, quote: "第一行\n第二行", comment: "多行\n批注" },
			{ n: 2, label: "a.md 3-4", quote: "code" },
			{ n: 3, label: "来自辅助对话", quote: "from side" },
		]);
	});

	it("parses diff annotations whose comment lives in the header", () => {
		const out = formatWithAnnotations("", [
			{ id: "d", source: "diff", text: "+x", file: "src/a.ts", lines: "5-6", comment: "改名" },
		]);
		expect(parseAnnotationQuotes(out)).toEqual({
			cards: [{ n: 1, label: "src/a.ts 第 5-6 行", quote: "+x", comment: "改名" }],
			body: "",
		});
	});

	it("accepts the side-chat echo '> [1]' prefix", () => {
		const parsed = parseAnnotationQuotes("> [1]\n> hello quote\n批注：n\n\n解释一下");
		expect(parsed?.cards[0]).toEqual({ n: 1, quote: "hello quote", comment: "n" });
		expect(parsed?.body).toBe("解释一下");
	});

	it("leaves ordinary text alone", () => {
		expect(parseAnnotationQuotes("hello")).toBeNull();
		expect(parseAnnotationQuotes("[1]\nnot a quote")).toBeNull();
		expect(parseAnnotationQuotes("[2]\n> skipped number")).toBeNull();
		expect(parseAnnotationQuotes("[1] (a.png)\n> [图片: a.png]")).toBeNull();
	});
});
