import { describe, expect, it } from "vitest";
import { healStreamingMarkdown as heal } from "./streamingMarkdown";

describe("healStreamingMarkdown", () => {
	it("leaves finished-looking text alone", () => {
		const s = "你好 **世界** 和 `code`\n\n- a\n- b";
		expect(heal(s)).toBe(s);
	});

	it("closes an open bold span so it renders progressively", () => {
		expect(heal("前文 **路线核心")).toBe("前文 **路线核心**");
	});

	it("drops a bare opener with nothing after it", () => {
		expect(heal("前文 **")).toBe("前文");
		expect(heal("前文 **  ")).toBe("前文");
	});

	it("closes nested markers innermost first", () => {
		expect(heal("**a *b")).toBe("**a *b***");
	});

	it("does not treat spaced asterisks or bullets as emphasis", () => {
		expect(heal("2 * 3 = 6")).toBe("2 * 3 = 6");
		expect(heal("* item")).toBe("* item");
	});

	it("closes or drops unfinished inline code", () => {
		expect(heal("run `ls -l")).toBe("run `ls -l`");
		expect(heal("run `")).toBe("run");
		expect(heal("a `x` b")).toBe("a `x` b");
	});

	it("ignores markers inside inline code", () => {
		expect(heal("`**` ok")).toBe("`**` ok");
	});

	it("never touches an open code fence", () => {
		const s = "```ts\nconst a = **b";
		expect(heal(s)).toBe(s);
	});

	it("reduces an unfinished link to its label", () => {
		expect(heal("见 [文档](https://exa")).toBe("见 文档");
		expect(heal("见 [文档")).toBe("见 文档");
		expect(heal("见 [文档](https://a.b)")).toBe("见 [文档](https://a.b)");
	});

	it("strips a lone block marker that would re-shape the paragraph", () => {
		expect(heal("标题\n-")).toBe("标题");
		expect(heal("段落\n\n1.")).toBe("段落\n\n");
		expect(heal("段落\n\n##")).toBe("段落\n\n");
	});

	it("holds back a table until the delimiter row arrives", () => {
		expect(heal("说明\n\n| a | b |")).toBe("说明\n\n");
		expect(heal("说明\n\n| a | b |\n| --- |")).toBe("说明\n\n| a | b |\n| --- |");
		expect(heal("| a | b |\n| --- | --- |\n| 1 | 2")).toBe("| a | b |\n| --- | --- |\n| 1 | 2");
	});

	it("holds back an unfinished display formula", () => {
		expect(heal("式子 $$x^2 + y")).toBe("式子 ");
		expect(heal("式子 $$x$$ 完")).toBe("式子 $$x$$ 完");
	});

	it("only repairs the last paragraph", () => {
		expect(heal("a **b\n\nc **d")).toBe("a **b\n\nc **d**");
	});
});

describe("healStreamingMarkdown `$$` inside code", () => {
	it("does not treat `$$` in inline code as an open display formula", () => {
		expect(heal("进程号用 `$$` 查看，然后继续")).toBe("进程号用 `$$` 查看，然后继续");
		expect(heal("- `$$` 当前 PID\n- 下一项")).toBe("- `$$` 当前 PID\n- 下一项");
	});

	it("ignores `$$` in a closed code fence but still holds back a real open formula", () => {
		const fenced = "```sh\necho $$\n```\n后面的文字";
		expect(heal(fenced)).toBe(fenced);
		expect(heal("`$$` 是 PID，式子 $$x^2")).toBe("`$$` 是 PID，式子 ");
	});
});
