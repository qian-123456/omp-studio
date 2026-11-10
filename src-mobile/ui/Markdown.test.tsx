// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as format from "../core/lib/format";
import { Markdown } from "./Markdown";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function texSources(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('annotation[encoding="application/x-tex"]'), (node) => node.textContent ?? "");
}

describe("mobile Markdown math", () => {
	it("renders desktop-compatible single-dollar inline math within prose", () => {
		const { container } = render(<Markdown text={"行内 $x^2 + \\alpha$，以及 $1 + 1 = 2$。"} />);
		expect(texSources(container)).toEqual(["x^2 + \\alpha", "1 + 1 = 2"]);
		expect(container.querySelectorAll(".katex-html")).toHaveLength(2);
		expect(container.querySelector(".katex-display")).toBeNull();
		expect(container.textContent).toContain("行内");
	});

	it.each([
		["same-line display", "前文 $$\\frac{a}{b}$$ 后文"],
		["multiline display", "前文\n\n$$\n\\frac{a}{b}\n$$\n\n后文"],
	])("renders %s without swallowing following prose", (_label, text) => {
		const { container } = render(<Markdown text={text} />);
		expect(texSources(container)).toEqual(["\\frac{a}{b}"]);
		expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
		expect(screen.getByText("前文")).toBeDefined();
		expect(screen.getByText("后文")).toBeDefined();
	});

	it.each([
		["matrix", "\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}"],
		["aligned", "\\begin{aligned}\na &= b + c \\\\\nd &= e + f\n\\end{aligned}"],
	])("renders %s display math with the closing delimiter after content", (_label, tex) => {
		const { container } = render(<Markdown text={`$$${tex}$$\n\n结论仍在。`} />);
		expect(texSources(container)).toEqual([tex]);
		expect(container.querySelector(".katex-display .katex-html")).not.toBeNull();
		expect(container.querySelector(".katex-error")).toBeNull();
		expect(screen.getByText("结论仍在。")).toBeDefined();
	});

	it.each([
		["costs $5 and $6", "costs $5 and $6"],
		["from $5-$10 total", "from $5-$10 total"],
		["花了$5，赚了$10", "花了$5，赚了$10"],
		["a \\$b$ c", "a $b$ c"],
	])("keeps desktop-compatible currency/escaped prose case %#", (text, visible) => {
		const { container } = render(<Markdown text={text} />);
		expect(container.querySelector(".katex")).toBeNull();
		expect(container.textContent).toBe(visible);
	});

	it("preserves inline and fenced code containing math syntax", () => {
		const inline = "$x^2$ and $$\\alpha$$";
		const code = "echo $$\nprintf '$x$'";
		const { container } = render(<Markdown text={`\`${inline}\`\n\n\`\`\`sh\n${code}\n\`\`\``} />);
		expect(container.querySelector(".katex")).toBeNull();
		expect(container.querySelector("p code")?.textContent).toBe(inline);
		expect(Array.from(container.querySelectorAll("pre code .whitespace-pre"), (node) => node.textContent).join("\n")).toBe(`${code}\n`);
	});

	it("preserves code after normalization changes source offsets", () => {
		const { container } = render(<Markdown text={"$$x^2$$\n\n```txt\n$x$ and $$y$$\n```"} />);
		expect(texSources(container)).toEqual(["x^2"]);
		expect(container.querySelector("pre code")?.textContent).toBe("$x$ and $$y$$");
	});

	it.each([
		["quoted fence", "> ~~~sh\n> echo $$\n> ~~~"],
		["indented code", "    echo $$"],
		["listed fence", "- example\n\n  ~~~sh\n  echo $$\n  ~~~"],
		["quoted indented code", ">     echo $$"],
		["listed indented code", "- example\n\n      echo $$"],
	])("preserves CommonMark code boundaries when displaying and copying %s", async (_label, text) => {
		const copy = vi.spyOn(format, "copyText").mockResolvedValue(true);
		const { container } = render(<Markdown text={text} />);
		expect(container.querySelector("pre code")?.textContent?.trimEnd()).toBe("echo $$");
		expect(container.querySelector(".katex")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
		await waitFor(() => expect(copy).toHaveBeenCalledWith("echo $$"));
	});

	it("renders completed math in a streaming head and tail, then the final snapshot", () => {
		const head = "已完成 $x^2$。\n\n";
		const { container, rerender } = render(<Markdown text={`${head}$$\\frac{1}{`} streaming />);
		expect(texSources(container)).toEqual(["x^2"]);
		expect(container.textContent).not.toContain("\\frac");
		const complete = `${head}$$\\frac{1}{2}$$\n\n流式完成。`;
		rerender(<Markdown text={complete} streaming />);
		expect(texSources(container)).toEqual(["x^2", "\\frac{1}{2}"]);
		expect(screen.getByText("流式完成。")).toBeDefined();
		rerender(<Markdown text={complete} streaming={false} />);
		expect(texSources(container)).toEqual(["x^2", "\\frac{1}{2}"]);
		expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
	});

	it("converts a completed inline stream without leaving raw LaTeX", () => {
		const { container, rerender } = render(<Markdown text={"结果为 $\\alpha"} streaming />);
		rerender(<Markdown text={"结果为 $\\alpha + 1$。"} streaming={false} />);
		expect(texSources(container)).toEqual(["\\alpha + 1"]);
		expect(container.querySelector(".katex-html")?.textContent).toContain("α");
		expect(container.querySelector("p")?.firstChild?.textContent).toBe("结果为 ");
	});
});
