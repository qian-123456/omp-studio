import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));

import { Markdown } from "./Markdown";
import { pendingMarkdownAssets } from "../features/chat/markdownAssets";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown inline HTML", () => {
	it("renders details/summary", () => {
		const out = html("<details>\n<summary>展开查看</summary>\n\n正文\n\n</details>");
		expect(out).toContain("<details>");
		expect(out).toContain("<summary>展开查看</summary>");
		expect(out).not.toContain("&lt;details");
	});
	it("survives unclosed details", () => {
		const out = html("<details><summary>x</summary>\n\nbody **b**");
		expect(out).toContain("<details>");
		expect(out).toContain("<strong>b</strong>");
	});
	it("strips scripts and handlers", () => {
		const out = html('<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">l</a><kbd>K</kbd>');
		expect(out).not.toContain("<script");
		expect(out).not.toContain("onerror");
		expect(out).not.toContain("javascript:");
		expect(out).toContain("<kbd>K</kbd>");
	});
	it("keeps tags literal in code", () => {
		const out = html("`<details>`\n\n```html\n<summary>s</summary>\n```");
		expect(out).not.toContain("<summary>");
		expect(out).toContain("&lt;");
	});
	it("keeps math", async () => {
		await pendingMarkdownAssets("$x^2$");
		expect(html("$$x^2$$")).toContain("katex");
	});

	it("turns prose and inline-code file paths into preview links", () => {
		const out = html(
			"读取 /Users/me/.omp/agent/AGENTS.md 与 `~/CodingWiki/wiki/rules.md`，目录 /Users/me 不链接。",
		);
		expect(out).toContain('href="/Users/me/.omp/agent/AGENTS.md"');
		expect(out).toContain('href="~/CodingWiki/wiki/rules.md"');
		expect(out).toContain("在右侧预览");
		// A directory is not a file link.
		expect(out).not.toContain('href="/Users/me"');
	});

	it("keeps a leading @ outside the file link", () => {
		const out = html("见 `@~/CodingWiki/wiki/rules.md` 与 @/Users/me/a.md。");
		expect(out).toContain('href="~/CodingWiki/wiki/rules.md"');
		expect(out).toContain('href="/Users/me/a.md"');
		expect(out).not.toContain('href="@');
		expect(out).not.toContain('>@~/CodingWiki/wiki/rules.md</a>');
	});

	it("does not relink text inside existing links or fenced code", () => {
		const out = html("[见 /a/b.md](/c/d.md)\n\n```\n/a/b.md\n```");
		expect(out).toContain('href="/c/d.md"');
		expect(out).not.toContain('href="/a/b.md"');
	});
});

describe("Markdown links and finished visualize fences", () => {
	it("keeps file:// hrefs so the file-preview branch can run", () => {
		const out = html("[a.md](file:///Users/me/a.md)");
		expect(out).toContain('href="file:///Users/me/a.md"');
	});
	it("still strips javascript: and data: hrefs", () => {
		const out = html("[x](javascript:alert(1)) [y](data:text/html;base64,AAAA)");
		expect(out).not.toContain("javascript:");
		expect(out).not.toContain("data:text");
		expect(out).not.toContain("<a");
	});
	it("keeps data:image sources", () => {
		const out = html("![p](data:image/png;base64,AAAA)");
		expect(out).toContain('src="data:image/png;base64,AAAA"');
	});
	it("shows an unclosed visualize fence of a finished message as code", () => {
		const out = html("```visualize\n<div>half");
		expect(out).not.toContain("正在生成可视化");
		expect(out).toContain("&lt;div&gt;half");
	});
	it("export mode expands long code without controls", () => {
		const code = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
		const out = renderToStaticMarkup(<Markdown text={"```ts\n" + code + "\n```"} exportMode />);
		expect(out).toContain("line29");
		expect(out).not.toContain("展开剩余");
		expect(out).not.toContain("<button");
	});
});

describe("Markdown images", () => {
	it("never fetches a remote image on render", () => {
		const out = html("![p](https://tracker.example/pixel.png)");
		expect(out).not.toContain("<img");
		expect(out).not.toContain("src=");
		expect(out).toContain("远程图片");
		expect(out).toContain("https://tracker.example/pixel.png");
	});

	it("still renders a local absolute image immediately", () => {
		const out = html("![p](/Users/me/pic.png)");
		expect(out).toContain('src="/Users/me/pic.png"');
		expect(out).not.toContain("远程图片");
	});

	it("still renders a data: image", () => {
		const out = html("![p](data:image/png;base64,AAAA)");
		expect(out).toContain('src="data:image/png;base64,AAAA"');
	});
});

describe("Markdown mermaid fences", () => {
	it("hands a closed mermaid fence to the diagram block", () => {
		const out = html("```mermaid\ngraph TD\n  A-->B\n```");
		expect(out).toContain("正在渲染图表");
	});
	it("keeps an unclosed fence a plain code block while streaming", () => {
		const out = renderToStaticMarkup(<Markdown text={"```mermaid\ngraph TD\n  A-->B"} streaming />);
		expect(out).not.toContain("正在渲染图表");
		expect(out).toContain("A--&gt;B");
	});
	it("leaves mermaid as code in static image export", () => {
		const out = renderToStaticMarkup(<Markdown text={"```mermaid\ngraph TD\n  A-->B\n```"} exportMode />);
		expect(out).not.toContain("正在渲染图表");
	});
});
