import { commonmarkLanguage } from "@codemirror/lang-markdown";

/**
 * Makes `$$…$$` safe for remark-math. LLMs write display math inline
 * (`$$\begin{aligned} … \end{aligned}$$` with the closing `$$` at the end of a
 * content line). remark-math only closes a block on a line of its own, so such
 * input would otherwise swallow the rest of the message.
 *
 * - balanced `$$…$$` (no blank line inside) → fenced block on its own lines
 * - a lone `$$` (unclosed, e.g. mid-stream) → escaped, shown as text
 * - CommonMark code blocks (including nested/indented ones) and code spans stay byte-for-byte intact
 * - single-dollar spans follow the pandoc rule — opening `$` not followed by
 *   whitespace, closing `$` not preceded by whitespace and not followed by a
 *   digit — and become inline `$$…$$` (`$1 + 1 = 2$`, `$\to$`). Single-dollar
 *   math is off globally so `$5 and $6` / `$5-$10` stay prose.
 */

const MATH_RE = /\$\$((?:(?!\n[ \t]*\n)[\s\S])+?)\$\$|\$\$/g;
const INLINE_RE = /(?<![$\\])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![$\d])/g;

function normalizeSegment(segment: string): string {
	if (!segment.includes("$")) return segment;
	const display = segment.replace(MATH_RE, (match, body: string | undefined) => {
		if (body !== undefined) return `\n\n$$\n${body.trim()}\n$$\n\n`;
		return match.startsWith("$$") ? "\\$\\$" : match;
	});
	return display.replace(INLINE_RE, (match, body: string | undefined) =>
		body !== undefined ? `$$${body}$$` : match,
	);
}

export function normalizeMath(text: string): string {
	if (!text.includes("$")) return text;
	// Without a code delimiter, tab, or four spaces, CommonMark cannot contain code.
	if (!/[`~\t]| {4}/.test(text)) return normalizeSegment(text);
	let out = "";
	let cursor = 0;
	commonmarkLanguage.parser.parse(text).iterate({
		enter(node) {
			if (node.name !== "FencedCode" && node.name !== "CodeBlock" && node.name !== "InlineCode") return;
			out += normalizeSegment(text.slice(cursor, node.from));
			out += text.slice(node.from, node.to);
			cursor = node.to;
			// A code block's subtree contains delimiters/content, not additional prose.
			return false;
		},
	});
	return out + normalizeSegment(text.slice(cursor));
}
