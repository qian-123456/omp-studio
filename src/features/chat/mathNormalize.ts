/**
 * Makes `$$…$$` safe for remark-math. LLMs write display math inline
 * (`$$\begin{aligned} … \end{aligned}$$` with the closing `$$` at the end of a
 * content line). remark-math only closes a block on a line of its own, so such
 * input would otherwise swallow the rest of the message.
 *
 * - balanced `$$…$$` (no blank line inside) → fenced block on its own lines
 * - a lone `$$` (unclosed, e.g. mid-stream) → escaped, shown as text
 * - fenced code blocks and inline code spans are left untouched
 * - single-dollar spans follow the pandoc rule — opening `$` not followed by
 *   whitespace, closing `$` not preceded by whitespace and not followed by a
 *   digit — and become inline `$$…$$` (`$1 + 1 = 2$`, `$\to$`). Single-dollar
 *   math is off globally so `$5 and $6` / `$5-$10` stay prose.
 */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_RE = /(`+)(?:(?!\1)[\s\S])*?\1|\$\$((?:(?!\n[ \t]*\n)[\s\S])+?)\$\$|\$\$/g;
const INLINE_RE = /(`+)(?:(?!\1)[\s\S])*?\1|(?<![$\\])\$(?![\s$])((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![$\d])/g;

function normalizeSegment(segment: string): string {
	if (!segment.includes("$")) return segment;
	const display = segment.replace(MATH_RE, (match, _ticks: string, body: string | undefined) => {
		if (body !== undefined) return `\n\n$$\n${body.trim()}\n$$\n\n`;
		return match.startsWith("$$") ? "\\$\\$" : match;
	});
	return display.replace(INLINE_RE, (match, _ticks: string, body: string | undefined) =>
		body !== undefined ? `$$${body}$$` : match,
	);
}

export function normalizeMath(text: string): string {
	if (!text.includes("$")) return text;
	const lines = text.split("\n");
	const out: string[] = [];
	let prose: string[] = [];
	let fence: { char: string; len: number } | null = null;

	const flushProse = () => {
		if (prose.length > 0) out.push(normalizeSegment(prose.join("\n")));
		prose = [];
	};

	for (const line of lines) {
		const m = FENCE_RE.exec(line);
		if (fence) {
			out.push(line);
			if (m && m[1][0] === fence.char && m[1].length >= fence.len && line.trim() === m[1]) {
				fence = null;
			}
		} else if (m) {
			flushProse();
			out.push(line);
			fence = { char: m[1][0], len: m[1].length };
		} else {
			prose.push(line);
		}
	}
	flushProse();
	return out.join("\n");
}
