/** [B] Obsidian-like Markdown list editing for the composer textarea. Pure:
 * no React, no DOM. Every function returns a minimal text edit
 * (`from`/`to` replaced by `insert`) plus the resulting selection, so the
 * caller can apply it through `execCommand("insertText")` (keeps native undo)
 * or fall back to a plain value assignment. `null` = not a list context, let
 * the textarea behave natively. */

export interface ListEdit {
	/** Replace `text.slice(from, to)` … */
	from: number;
	to: number;
	/** … with this string. */
	insert: string;
	/** Selection after the edit, in the new text's coordinates. */
	selStart: number;
	selEnd: number;
}

/** One indent level written by Tab. */
export const LIST_INDENT = "  ";

interface ListLine {
	/** Start offset of the line. */
	lineStart: number;
	/** End offset of the line (excluding `\n`). */
	lineEnd: number;
	indent: string;
	/** `-`/`*`/`+` for bullets, `N.`/`N)` for ordered. */
	marker: string;
	/** Ordered number, or null for bullets. */
	num: number | null;
	/** Ordered delimiter (`.` or `)`). */
	delim: string;
	/** Task box text including trailing space (`[ ] `), or "". */
	task: string;
	/** Offset right after marker + space + task box. */
	contentStart: number;
	/** Text after the prefix. */
	content: string;
}

const LIST_RE = /^([ \t]*)(?:(\d{1,9})([.)])|([-*+]))[ \t]+(\[[ xX]\][ \t]+)?/;

function lineBounds(text: string, pos: number): { start: number; end: number } {
	const start = text.lastIndexOf("\n", pos - 1) + 1;
	const nl = text.indexOf("\n", pos);
	return { start, end: nl === -1 ? text.length : nl };
}

/** Parse the list item on the line containing `pos`, or null. */
export function parseListLine(text: string, pos: number): ListLine | null {
	const { start, end } = lineBounds(text, pos);
	const line = text.slice(start, end);
	const m = LIST_RE.exec(line);
	if (!m) return null;
	const [prefix, indent, num, delim, bullet, task] = m;
	return {
		lineStart: start,
		lineEnd: end,
		indent,
		marker: bullet ?? `${num}${delim}`,
		num: num === undefined ? null : Number(num),
		delim: delim ?? "",
		task: task ?? "",
		contentStart: start + prefix.length,
		content: line.slice(prefix.length),
	};
}

function nextPrefix(item: ListLine): string {
	const marker = item.num === null ? item.marker : `${item.num + 1}${item.delim}`;
	return `${item.indent}${marker} ${item.task ? "[ ] " : ""}`;
}

/** Enter on a list item. Continues the list (next number, unchecked task
 * box), splits the item at the caret, and on an empty item exits the list
 * (outdents nested items first). Requires a collapsed caret after the marker. */
export function continueListOnEnter(
	text: string,
	selStart: number,
	selEnd: number,
): ListEdit | null {
	if (selStart !== selEnd) return null;
	const item = parseListLine(text, selStart);
	if (!item || selStart < item.contentStart) return null;

	if (item.content.trim() === "") {
		// Empty item: outdent when nested, otherwise drop the marker.
		if (item.indent.length > 0) {
			const newIndent = outdentOf(item.indent);
			const prefix = `${newIndent}${item.marker} ${item.task}`;
			const caret = item.lineStart + prefix.length;
			return { from: item.lineStart, to: item.lineEnd, insert: prefix, selStart: caret, selEnd: caret };
		}
		return { from: item.lineStart, to: item.lineEnd, insert: "", selStart: item.lineStart, selEnd: item.lineStart };
	}

	const prefix = nextPrefix(item);
	const insert = `\n${prefix}`;
	const caret = selStart + insert.length;
	return { from: selStart, to: selStart, insert, selStart: caret, selEnd: caret };
}

function outdentOf(indent: string): string {
	if (indent.startsWith("\t")) return indent.slice(1);
	return indent.slice(Math.min(LIST_INDENT.length, indent.length));
}

/** Tab / Shift+Tab on list item line(s) in the selection. Indents or outdents
 * every selected item line by one level; returns null when no selected line is
 * a list item (Tab then keeps its default behaviour). */
export function indentList(
	text: string,
	selStart: number,
	selEnd: number,
	outdent: boolean,
): ListEdit | null {
	const firstLine = lineBounds(text, selStart).start;
	// A selection ending right after a newline does not include the next line.
	const lastPos = selEnd > selStart && text[selEnd - 1] === "\n" ? selEnd - 1 : selEnd;
	const lastLineEnd = lineBounds(text, lastPos).end;
	const lines = text.slice(firstLine, lastLineEnd).split("\n");

	let offset = firstLine;
	let anyList = false;
	let changed = false;
	let startDelta = 0;
	let endDelta = 0;
	const out: string[] = [];
	for (const line of lines) {
		const lineStart = offset;
		offset += line.length + 1;
		const m = LIST_RE.exec(line);
		if (!m) {
			out.push(line);
			continue;
		}
		anyList = true;
		let delta = 0;
		let next = line;
		if (outdent) {
			const indent = m[1];
			if (indent.length > 0) {
				const stripped = outdentOf(indent);
				delta = stripped.length - indent.length;
				next = stripped + line.slice(indent.length);
			}
		} else {
			delta = LIST_INDENT.length;
			next = LIST_INDENT + line;
		}
		if (delta !== 0) {
			changed = true;
			// Shift selection ends that sit after this line's start.
			if (selStart > lineStart) startDelta += Math.max(delta, lineStart - selStart);
			if (selEnd > lineStart) endDelta += Math.max(delta, lineStart - selEnd);
		}
		out.push(next);
	}
	if (!anyList) return null;
	if (!changed) {
		// Already at the left edge: swallow Shift+Tab without editing.
		return { from: selStart, to: selStart, insert: "", selStart, selEnd };
	}
	const insert = out.join("\n");
	return {
		from: firstLine,
		to: lastLineEnd,
		insert,
		selStart: Math.max(firstLine, selStart + startDelta),
		selEnd: Math.max(firstLine, selEnd + endDelta),
	};
}

/** Apply an edit to a string (used by tests and the non-execCommand fallback). */
export function applyListEdit(text: string, edit: ListEdit): string {
	return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}
