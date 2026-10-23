import { describe, expect, it } from "vitest";
import { MATH_BLOCK_TAG, rehypeMathBlocks } from "./rehypeMathBlocks";

const text = (value: string) => ({ type: "text", value });
const el = (tagName: string, properties: Record<string, unknown>, children: unknown[]) => ({
	type: "element",
	tagName,
	properties,
	children,
});

describe("rehypeMathBlocks", () => {
	it("wraps a display formula and recovers its LaTeX source", () => {
		const display = el("span", { className: ["katex-display"] }, [
			el("span", { className: ["katex"] }, [
				el("math", {}, [
					el("semantics", {}, [
						el("annotation", { encoding: "application/x-tex" }, [text(" a \\cap b ")]),
					]),
				]),
			]),
		]);
		const inline = el("span", { className: ["katex"] }, [text("inline")]);
		const tree = { type: "root", children: [el("p", {}, [inline]), display] };
		rehypeMathBlocks()(tree as never);

		const [p, block] = tree.children as Array<{ tagName: string; properties: { dataTex?: string }; children: unknown[] }>;
		expect(block.tagName).toBe(MATH_BLOCK_TAG);
		expect(block.properties.dataTex).toBe("a \\cap b");
		expect(block.children).toEqual([display]);
		// Inline math is left alone.
		expect(p.children).toEqual([inline]);
	});
});
