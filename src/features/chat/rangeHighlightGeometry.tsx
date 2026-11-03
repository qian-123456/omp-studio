import { useLayoutEffect, useState, type RefObject } from "react";

export interface HighlightRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

const INLINE_GAP = 12;

/** Merge glyph/padding rectangles into non-overlapping selected visual line segments. */
export function mergeHighlightRects(rects: readonly HighlightRect[]): HighlightRect[] {
	const sorted = rects
		.filter((rect) => rect.width > 0 && rect.height > 0)
		.sort((a, b) => a.top - b.top || a.left - b.left);
	const lines: HighlightRect[][] = [];
	for (const rect of sorted) {
		const line = lines[lines.length - 1];
		const anchor = line?.[0];
		const overlap = anchor
			? Math.min(anchor.top + anchor.height, rect.top + rect.height) - Math.max(anchor.top, rect.top)
			: 0;
		if (anchor && overlap >= Math.min(anchor.height, rect.height) / 2) line.push(rect);
		else lines.push([rect]);
	}
	const out: HighlightRect[] = [];
	for (const line of lines) {
		line.sort((a, b) => a.left - b.left);
		let previous: HighlightRect | undefined;
		for (const rect of line) {
			if (previous && rect.left <= previous.left + previous.width + INLINE_GAP) {
				const right = Math.max(previous.left + previous.width, rect.left + rect.width);
				const bottom = Math.max(previous.top + previous.height, rect.top + rect.height);
				previous.top = Math.min(previous.top, rect.top);
				previous.width = right - previous.left;
				previous.height = bottom - previous.top;
			} else {
				previous = { ...rect };
				out.push(previous);
			}
		}
	}
	return out;
}

/** Element range rects include full-width paragraphs/lists; measure clipped text runs instead. */
export function rangeHighlightRects(range: Range, root: HTMLElement): HighlightRect[] {
	const ancestor = range.commonAncestorContainer;
	if (range.collapsed || !root.contains(ancestor)) return [];
	const rootRect = root.getBoundingClientRect();
	const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
	const raw: HighlightRect[] = [];
	for (
		let node = ancestor.nodeType === Node.TEXT_NODE ? ancestor : walker.nextNode();
		node;
		node = walker.nextNode()
	) {
		const text = node as Text;
		if (!range.intersectsNode(text)) continue;
		const start = range.startContainer === text ? range.startOffset : 0;
		const end = range.endContainer === text ? range.endOffset : text.length;
		if (end <= start) continue;
		const textRange = document.createRange();
		textRange.setStart(text, start);
		textRange.setEnd(text, end);
		const fragments = Array.from(textRange.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
		const parent = text.parentElement;
		const style = parent?.matches("a,code,strong") ? getComputedStyle(parent) : null;
		const leftPadding = start === 0 && style ? Number.parseFloat(style.paddingLeft) || 0 : 0;
		const rightPadding = end === text.length && style ? Number.parseFloat(style.paddingRight) || 0 : 0;
		const fullText = start === 0 && end === text.length;
		for (let index = 0; index < fragments.length; index++) {
			const rect = fragments[index];
			const left = fullText || index === 0 ? leftPadding : 0;
			const right = fullText || index === fragments.length - 1 ? rightPadding : 0;
			raw.push({
				left: rect.left - rootRect.left + root.scrollLeft - left,
				top: rect.top - rootRect.top + root.scrollTop,
				width: rect.width + left + right,
				height: rect.height,
			});
		}
	}
	return mergeHighlightRects(raw);
}

export function RangeHighlightOverlay({
    rootRef,
    ranges,
    tone,
}: {
    rootRef: RefObject<HTMLElement | null>;
    ranges: readonly Range[];
    tone: "native" | "pending" | "saved";
}) {
    const [rects, setRects] = useState<HighlightRect[]>([]);
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const measure = () => setRects(ranges.flatMap((range) => rangeHighlightRects(range, root)));
        measure();
        const resize = new ResizeObserver(measure);
        resize.observe(root);
        const onScroll = () => measure();
        root.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            resize.disconnect();
            root.removeEventListener("scroll", onScroll);
        };
    }, [rootRef, ranges]);
    if (rects.length === 0) return null;
    const backgroundColor =
        tone === "native"
            ? "rgba(56, 189, 248, 0.32)"
            : tone === "pending"
                ? "rgba(56, 189, 248, 0.32)"
                : "rgba(251, 191, 36, 0.3)";
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
            {rects.map((rect, index) => (
                <span
                    key={`${rect.left}:${rect.top}:${rect.width}:${rect.height}:${index}`}
                    style={{
                        position: "absolute",
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                        backgroundColor,
                    }}
                />
            ))}
        </div>
    );
}
