/**
 * Display-time "healing" of a markdown prefix that is still being generated.
 *
 * A half-written body flips between raw syntax and rendered output as tokens
 * arrive: `**路线核心` shows literal asterisks until the closer lands, a lone
 * `-` under a paragraph turns it into a heading for one frame, a table header
 * is plain pipes until its delimiter row arrives. Healing makes every prefix
 * render the way its finished form will, so the text only ever grows — it never
 * re-shapes. Only the last paragraph is touched; finished text must not go
 * through this (it would rewrite literal `*` characters).
 */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const LONE_MARKER_LINE_RE = /^ {0,3}(?:[-+*>]|\d+[.)]|#{1,6}|=+|-{1,2})\s*$/;
const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** True when the text ends inside an unclosed fenced code block. */
function endsInsideFence(text: string): boolean {
	let open = "";
	for (const line of text.split("\n")) {
		const m = FENCE_RE.exec(line);
		if (!m) continue;
		const mark = m[1];
		if (!open) open = mark;
		else if (mark[0] === open[0] && mark.length >= open.length) open = "";
	}
	return open !== "";
}

interface OpenMarker {
	marker: string;
	index: number;
}

/** Close (or drop, when nothing follows it) inline markers left open at the end. */
function balanceInline(tail: string): string {
	const stack: OpenMarker[] = [];
	let codeRun = 0;
	for (let i = 0; i < tail.length; i++) {
		const ch = tail[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === "`") {
			let n = 1;
			while (tail[i + n] === "`") n++;
			if (codeRun === 0) codeRun = n;
			else if (codeRun === n) codeRun = 0;
			i += n - 1;
			continue;
		}
		if (codeRun > 0) continue;
		if (ch === "*" || ch === "~") {
			let n = 1;
			while (tail[i + n] === ch) n++;
			const start = i;
			let left = n;
			let at = start;
			const pair = ch === "*" ? "**" : "~~";
			while (left >= 2) {
				toggle(stack, pair, at);
				left -= 2;
				at += 2;
			}
			if (left === 1 && ch === "*") {
				const prev = tail[at - 1] ?? " ";
				const next = tail[at + 1] ?? " ";
				const top = stack[stack.length - 1];
				if (top?.marker === "*" && !/\s/.test(prev)) stack.pop();
				else if (!/\s/.test(next)) stack.push({ marker: "*", index: at });
			}
			i += n - 1;
		}
	}
	let out = tail;
	if (codeRun > 0) {
		// Unclosed inline code: drop a bare opener, otherwise close it.
		const at = out.lastIndexOf("`".repeat(codeRun));
		if (out.slice(at + codeRun).trim() === "") out = out.slice(0, at).trimEnd();
		else out = `${out}${"`".repeat(codeRun)}`;
		return out;
	}
	let closers = "";
	for (let i = stack.length - 1; i >= 0; i--) {
		const m = stack[i];
		if (closers === "" && out.slice(m.index + m.marker.length).trim() === "") {
			out = out.slice(0, m.index).trimEnd();
		} else {
			closers += m.marker;
		}
	}
	return closers ? out.trimEnd() + closers : out;
}

function toggle(stack: OpenMarker[], marker: string, index: number): void {
	const at = stack.map((s) => s.marker).lastIndexOf(marker);
	if (at >= 0) stack.length = at;
	else stack.push({ marker, index });
}

/** Heal the last paragraph of a streaming markdown prefix. */
export function healStreamingMarkdown(text: string): string {
	if (!text || endsInsideFence(text)) return text;
	let body = text;
	// An unfinished `$$ … ` display formula renders as raw source: hold it back
	// until its closer arrives.
	// Code spans and closed fences may legitimately contain `$$` (shell PID):
	// mask them (same length) before counting.
	const masked = body
		.replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[^\n]*(?=\n|$)/g, (m) => " ".repeat(m.length))
		.replace(/(`+)[^`\n]*?\1/g, (m) => " ".repeat(m.length));
	const dollars = masked.match(/\$\$/g)?.length ?? 0;
	if (dollars % 2 === 1) body = body.slice(0, masked.lastIndexOf("$$"));

	let split = 0;
	const blank = /\n[ \t]*\n/g;
	for (let m = blank.exec(body); m; m = blank.exec(body)) {
		split = m.index + m[0].length;
	}
	const head = body.slice(0, split);
	let tail = body.slice(split);

	let lines = tail.split("\n");
	if (lines.length > 0 && LONE_MARKER_LINE_RE.test(lines[lines.length - 1])) {
		lines = lines.slice(0, -1);
		tail = lines.join("\n");
	}
	// A table is plain pipes until its delimiter row exists.
	if (tail.trimStart().startsWith("|")) {
		const rows = tail.split("\n").filter((l) => l.trim() !== "");
		if (rows.length < 2 || !TABLE_DELIMITER_RE.test(rows[1])) return head;
		return head + tail;
	}
	tail = tail.replace(/(!?)\[([^\]\n]*)\]\([^)\n]*$/, (_m, bang: string, label: string) =>
		bang ? "" : label,
	);
	tail = tail.replace(/!?\[([^\]\n]*)$/, "$1");
	return head + balanceInline(tail);
}

/** A block whose first line starts one of these can continue past a blank line. */
const CONTINUABLE_BLOCK_RE = /^(?:\s|[-+*>|<]|\d+[.)]|\[|:)/;

/**
 * Split streaming text into a `head` of finished top-level blocks that will
 * not change again, and the live `tail`. A boundary is a blank line outside
 * fences / `$$` math whose preceding block is a plain paragraph, heading or
 * closed fence, and whose following line is unindented. Lists, quotes, tables,
 * HTML and reference definitions can continue across blank lines, so they stay
 * in the tail until the stream moves on. `head + tail === text` always.
 */
export function splitStableBlocks(text: string): { head: string; tail: string } {
	let boundary = 0;
	let fence = "";
	let math = false;
	let blockFirstLine = "";
	let inBlank = false;
	let pos = 0;
	for (const raw of text.split("\n")) {
		const lineStart = pos;
		pos += raw.length + 1;
		const line = raw.replace(/\r$/, "");
		const fenceMatch = FENCE_RE.exec(line);
		if (fence) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = "";
			continue;
		}
		if (math) {
			if (line.includes("$$")) math = false;
			continue;
		}
		if (line.trim() === "") {
			inBlank = true;
			continue;
		}
		if (inBlank || blockFirstLine === "") {
			// First line of a new block: the previous one is finished if it cannot continue.
			if (inBlank && blockFirstLine !== "" && !CONTINUABLE_BLOCK_RE.test(blockFirstLine) && !/^\s/.test(line)) {
				boundary = lineStart;
			}
			blockFirstLine = line;
			inBlank = false;
		}
		if (fenceMatch) fence = fenceMatch[1];
		else if ((line.match(/\$\$/g)?.length ?? 0) % 2 === 1) math = true;
	}
	return { head: text.slice(0, boundary), tail: text.slice(boundary) };
}
