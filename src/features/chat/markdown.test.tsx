import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));

import { Markdown } from "./markdown";

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
	it("keeps math", () => {
		expect(html("$$x^2$$")).toContain("katex");
	});

	it("turns prose and inline-code file paths into preview links", () => {
		const out = html(
			"读取 /Users/qianhairui/.omp/agent/AGENTS.md 与 `~/CodingWiki/wiki/rules.md`，目录 /Users/qianhairui 不链接。",
		);
		expect(out).toContain('href="/Users/qianhairui/.omp/agent/AGENTS.md"');
		expect(out).toContain('href="~/CodingWiki/wiki/rules.md"');
		expect(out).toContain("在右侧预览");
		// A directory is not a file link.
		expect(out).not.toContain('href="/Users/qianhairui"');
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
