import { useLayoutEffect, useState, type RefObject } from "react";

export interface HighlightRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

const LINE_EPSILON = 2;
const INLINE_GAP = 12;

/** Merge glyph/padding rectangles into only the selected visual line segments. */
export function mergeHighlightRects(rects: readonly HighlightRect[]): HighlightRect[] {
	const sorted = rects
		.filter((r) => r.width > 0 && r.height > 0)
		.slice()
		.sort((a, b) => a.top - b.top || a.left - b.left);
	const out: HighlightRect[] = [];
	for (const rect of sorted) {
		const previous = out[out.length - 1];
		if (
			previous &&
			Math.abs(previous.top - rect.top) <= LINE_EPSILON &&
			rect.left <= previous.left + previous.width + INLINE_GAP
		) {
			const right = Math.max(previous.left + previous.width, rect.left + rect.width);
			const bottom = Math.max(previous.top + previous.height, rect.top + rect.height);
			previous.left = Math.min(previous.left, rect.left);
			previous.top = Math.min(previous.top, rect.top);
			previous.width = right - previous.left;
			previous.height = bottom - previous.top;
		} else {
			out.push({ ...rect });
		}
	}
	return out;
}

function boundaryPadding(node: Node, offset: number, side: "left" | "right"): number {
	if (node.nodeType !== Node.TEXT_NODE) return 0;
	const text = node as Text;
	if (side === "left" ? offset !== 0 : offset !== text.data.length) return 0;
	const parent = text.parentElement;
	if (!parent || !parent.matches("a,code,strong")) return 0;
	const style = getComputedStyle(parent);
	return Number.parseFloat(side === "left" ? style.paddingLeft : style.paddingRight) || 0;
}

function selectedInlinePaddingRects(range: Range, root: HTMLElement): HighlightRect[] {
    const ancestor = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    if (!ancestor) return [];
    const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
    const out: HighlightRect[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (!range.intersectsNode(text)) continue;
        const start = range.startContainer === text ? range.startOffset : 0;
        const end = range.endContainer === text ? range.endOffset : text.data.length;
        const parent = text.parentElement;
        if (start !== 0 || end !== text.data.length || !parent?.matches("a,code,strong")) continue;
        const style = getComputedStyle(parent);
        const left = Number.parseFloat(style.paddingLeft) || 0;
        const right = Number.parseFloat(style.paddingRight) || 0;
        if (left === 0 && right === 0) continue;
        const textRange = document.createRange();
        textRange.selectNodeContents(text);
        for (const rect of Array.from(textRange.getClientRects())) {
            const rootRect = root.getBoundingClientRect();
            out.push({
                left: rect.left - rootRect.left + root.scrollLeft - left,
                top: rect.top - rootRect.top + root.scrollTop,
                width: rect.width + left + right,
                height: rect.height,
            });
        }
    }
    return out;
}

/** Convert a DOM range to root-relative rects, including selected inline padding only. */
export function rangeHighlightRects(range: Range, root: HTMLElement): HighlightRect[] {
    const rootRect = root.getBoundingClientRect();
    const raw = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
            left: rect.left - rootRect.left + root.scrollLeft,
            top: rect.top - rootRect.top + root.scrollTop,
            width: rect.width,
            height: rect.height,
        }));
    raw.push(...selectedInlinePaddingRects(range, root));
    if (raw.length === 0) return [];
    const left = boundaryPadding(range.startContainer, range.startOffset, "left");
    const right = boundaryPadding(range.endContainer, range.endOffset, "right");
    if (left > 0) {
        raw[0].left -= left;
        raw[0].width += left;
    }
    if (right > 0) raw[raw.length - 1].width += right;
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
