import { describe, expect, it } from "vitest";
import { applyListEdit, continueListOnEnter, indentList } from "./mdListEdit";

/** Run Enter with the caret marked by `|`; returns the text with `|` at the new caret. */
function enter(src: string): string | null {
	const pos = src.indexOf("|");
	const text = src.replace("|", "");
	const edit = continueListOnEnter(text, pos, pos);
	if (!edit) return null;
	const out = applyListEdit(text, edit);
	return `${out.slice(0, edit.selStart)}|${out.slice(edit.selStart)}`;
}

function tab(src: string, shift = false): string | null {
	const a = src.indexOf("|");
	const b = src.lastIndexOf("|");
	const text = src.replaceAll("|", "");
	const end = b === a ? a : b - 1;
	const edit = indentList(text, a, end, shift);
	if (!edit) return null;
	const out = applyListEdit(text, edit);
	if (edit.selStart === edit.selEnd) return `${out.slice(0, edit.selStart)}|${out.slice(edit.selStart)}`;
	return `${out.slice(0, edit.selStart)}|${out.slice(edit.selStart, edit.selEnd)}|${out.slice(edit.selEnd)}`;
}

describe("continueListOnEnter", () => {
	it("continues ordered lists with the next number", () => {
		expect(enter("1. foo|")).toBe("1. foo\n2. |");
		expect(enter("9. foo|")).toBe("9. foo\n10. |");
		expect(enter("3) foo|")).toBe("3) foo\n4) |");
	});

	it("continues bullets with the same marker", () => {
		expect(enter("- a|")).toBe("- a\n- |");
		expect(enter("* a|")).toBe("* a\n* |");
		expect(enter("+ a|")).toBe("+ a\n+ |");
	});

	it("keeps indentation and starts task items unchecked", () => {
		expect(enter("  - [x] done|")).toBe("  - [x] done\n  - [ ] |");
		expect(enter("- [ ] todo|")).toBe("- [ ] todo\n- [ ] |");
	});

	it("splits the item at the caret", () => {
		expect(enter("1. ab|cd")).toBe("1. ab\n2. |cd");
	});

	it("exits the list on an empty item", () => {
		expect(enter("1. foo\n2. |")).toBe("1. foo\n|");
		expect(enter("- |")).toBe("|");
		expect(enter("- [ ] |")).toBe("|");
	});

	it("outdents an empty nested item instead of removing it", () => {
		expect(enter("- a\n  - |")).toBe("- a\n- |");
		expect(enter("1. a\n  2. |")).toBe("1. a\n2. |");
	});

	it("ignores non-list lines, markers without a space and selections", () => {
		expect(enter("hello|")).toBeNull();
		expect(enter("-foo|")).toBeNull();
		expect(enter("2024.|")).toBeNull();
		expect(continueListOnEnter("- a", 0, 3)).toBeNull();
	});

	it("does nothing when the caret is inside the marker", () => {
		expect(enter("1.| foo")).toBeNull();
		expect(enter("|- foo")).toBeNull();
	});

	it("only touches the current line in multi-line text", () => {
		expect(enter("intro\n1. a|\ntail")).toBe("intro\n1. a\n2. |\ntail");
	});
});

describe("indentList", () => {
	it("indents a list item by one level, keeping the caret in place", () => {
		expect(tab("- a|")).toBe("  - a|");
		expect(tab("1. ab|c")).toBe("  1. ab|c");
	});

	it("outdents with Shift+Tab and clamps at the left edge", () => {
		expect(tab("  - a|", true)).toBe("- a|");
		expect(tab("- a|", true)).toBe("- a|");
	});

	it("handles tabs as indentation", () => {
		expect(tab("\t- a|", true)).toBe("- a|");
	});

	it("indents every selected list line", () => {
		const text = "- a\n- b\n- c";
		const edit = indentList(text, 2, 9, false);
		expect(edit && applyListEdit(text, edit)).toBe("  - a\n  - b\n  - c");
	});

	it("leaves non-list lines alone and returns null when nothing is a list", () => {
		expect(tab("hello|")).toBeNull();
		const text = "intro\n- a";
		const edit = indentList(text, 0, text.length, false);
		expect(edit && applyListEdit(text, edit)).toBe("intro\n  - a");
	});

	it("does not include the line after a selection ending at a newline", () => {
		const text = "- a\n- b";
		const edit = indentList(text, 0, 4, false);
		expect(edit && applyListEdit(text, edit)).toBe("  - a\n- b");
	});
});
