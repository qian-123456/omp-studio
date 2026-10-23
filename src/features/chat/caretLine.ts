const MIRRORED_STYLES = [
	"boxSizing",
	"width",
	"fontFamily",
	"fontSize",
	"fontWeight",
	"fontStyle",
	"letterSpacing",
	"lineHeight",
	"textTransform",
	"textIndent",
	"wordSpacing",
	"tabSize",
	"whiteSpace",
	"overflowWrap",
	"wordBreak",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
] as const;

/** Whether the caret sits on the first / last visual (soft-wrapped) line of a
 * textarea. Measured with an off-screen mirror; where layout is unavailable
 * (jsdom: all offsets 0) both are decided by hard newlines alone. */
export function caretVisualLines(ta: HTMLTextAreaElement): { first: boolean; last: boolean } {
	const value = ta.value;
	const pos = ta.selectionStart ?? 0;
	const hardFirst = !value.slice(0, pos).includes("\n");
	const hardLast = !value.slice(pos).includes("\n");
	try {
		const cs = getComputedStyle(ta);
		const mirror = document.createElement("div");
		for (const k of MIRRORED_STYLES) mirror.style[k] = cs[k];
		mirror.style.position = "absolute";
		mirror.style.visibility = "hidden";
		mirror.style.top = "0";
		mirror.style.left = "-9999px";
		mirror.style.height = "auto";
		mirror.style.overflow = "hidden";
		mirror.style.whiteSpace = "pre-wrap";
		const mark = (): HTMLSpanElement => {
			const s = document.createElement("span");
			s.textContent = "\u200b";
			return s;
		};
		const before = mark();
		const caret = mark();
		const after = mark();
		mirror.append(before, value.slice(0, pos), caret, value.slice(pos), after);
		document.body.appendChild(mirror);
		const tTop = before.offsetTop;
		const tCaret = caret.offsetTop;
		const tEnd = after.offsetTop;
		mirror.remove();
		return {
			first: hardFirst && tCaret <= tTop,
			last: hardLast && tCaret >= tEnd,
		};
	} catch {
		return { first: hardFirst, last: hardLast };
	}
}
