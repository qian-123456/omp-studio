/**
 * Rehype plugin (run after rehype-katex): wrap every rendered display formula
 * (`.katex-display`) in a `<math-block data-tex="…">` element, carrying the
 * original LaTeX source (read back from KaTeX's MathML `<annotation>`). The
 * markdown renderer maps that tag to a framed block with a copy button.
 */

/** Tag emitted by `rehypeMathBlocks`; markdown maps it to `MathBlock`. */
export const MATH_BLOCK_TAG = "math-block";

interface HastNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}

function hasClass(node: HastNode, name: string): boolean {
	const cls = node.properties?.className;
	return Array.isArray(cls) ? cls.includes(name) : typeof cls === "string" && cls.split(/\s+/).includes(name);
}

function textOf(node: HastNode): string {
	if (node.type === "text") return node.value ?? "";
	return (node.children ?? []).map(textOf).join("");
}

function findTex(node: HastNode): string | null {
	if (node.type === "element" && node.tagName === "annotation") return textOf(node);
	for (const child of node.children ?? []) {
		const found = findTex(child);
		if (found !== null) return found;
	}
	return null;
}

function wrap(parent: HastNode): void {
	const children = parent.children;
	if (!children) return;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.type === "element" && hasClass(child, "katex-display")) {
			children[i] = {
				type: "element",
				tagName: MATH_BLOCK_TAG,
				properties: { dataTex: findTex(child)?.trim() ?? "" },
				children: [child],
			};
			continue;
		}
		wrap(child);
	}
}

export function rehypeMathBlocks() {
	return (tree: HastNode) => wrap(tree);
}
