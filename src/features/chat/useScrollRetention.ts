import { useLayoutEffect, useRef, type RefObject } from "react";

type ReadingAnchor = {
	node: Text | Element;
	offset: number;
	/** Distance from the viewport midpoint before reflow. */
	dy: number;
};

type CaretDocument = Document & {
	caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
	caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function anchorTop(anchor: ReadingAnchor): number | null {
	if (!anchor.node.isConnected) return null;
	if (anchor.node.nodeType !== Node.TEXT_NODE) {
		return (anchor.node as Element).getBoundingClientRect().top;
	}
	const text = anchor.node as Text;
	if (text.length === 0) return null;
	const range = document.createRange();
	const offset = Math.min(anchor.offset, text.length - 1);
	range.setStart(text, offset);
	range.setEnd(text, offset + 1);
	return range.getClientRects()[0]?.top ?? null;
}

/** Preserve the character being read, not the message top or scroll percentage. */
export function useScrollRetention(
	scrollRef: RefObject<HTMLDivElement | null>,
	sessionId: string,
	shouldPreserve: () => boolean,
): void {
	const preserveRef = useRef(shouldPreserve);
	preserveRef.current = shouldPreserve;
	useLayoutEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		let width = scroller.clientWidth;
		let height = scroller.clientHeight;
		let anchor: ReadingAnchor | null = null;
		let settlingFrame = 0;

		const capture = () => {
			if (!preserveRef.current()) {
				anchor = null;
				return;
			}
			// A resize-triggered scroll is not a new reading position. Keep the
			// pre-reflow character until ResizeObserver has restored it.
			if (settlingFrame || scroller.clientWidth !== width || scroller.clientHeight !== height) return;
			const rect = scroller.getBoundingClientRect();
			const x = rect.left + rect.width / 2;
			const y = rect.top + rect.height / 2;
			const doc = document as CaretDocument;
			const caret = doc.caretPositionFromPoint?.(x, y);
			const range = caret ? null : doc.caretRangeFromPoint?.(x, y);
			const node = caret?.offsetNode ?? range?.startContainer;
			const offset = caret?.offset ?? range?.startOffset ?? 0;
			let next: ReadingAnchor | null = null;
			if (node?.nodeType === Node.TEXT_NODE && scroller.contains(node)) {
				next = { node: node as Text, offset, dy: 0 };
			} else {
				const element = document.elementFromPoint?.(x, y);
				if (element && element !== scroller && scroller.contains(element)) {
					next = { node: element, offset: 0, dy: 0 };
				}
			}
			const top = next && anchorTop(next);
			anchor = next && top !== null ? { ...next, dy: top - y } : null;
		};
		const restore = () => {
			if (!anchor || !preserveRef.current()) return;
			const top = anchorTop(anchor);
			if (top === null) return;
			const rect = scroller.getBoundingClientRect();
			const delta = top - (rect.top + rect.height / 2 + anchor.dy);
			if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
		};
		const observer = new ResizeObserver(() => {
			const nextWidth = scroller.clientWidth;
			const nextHeight = scroller.clientHeight;
			if (nextWidth === width && nextHeight === height) return;
			width = nextWidth;
			height = nextHeight;
			restore();
			cancelAnimationFrame(settlingFrame);
			// Virtualized rows can measure in the next frame; reapply the same
			// character anchor after that compensation, then resume normal capture.
			settlingFrame = requestAnimationFrame(() => {
				restore();
				settlingFrame = 0;
				capture();
			});
		});
		const onInput = () => {
			cancelAnimationFrame(settlingFrame);
			settlingFrame = 0;
			capture();
		};
		capture();
		observer.observe(scroller);
		scroller.addEventListener("scroll", capture, { passive: true });
		window.addEventListener("pointerdown", onInput, true);
		window.addEventListener("keydown", onInput, true);
		scroller.addEventListener("wheel", onInput, { passive: true });
		scroller.addEventListener("touchstart", onInput, { passive: true });
		return () => {
			observer.disconnect();
			cancelAnimationFrame(settlingFrame);
			scroller.removeEventListener("scroll", capture);
			window.removeEventListener("pointerdown", onInput, true);
			window.removeEventListener("keydown", onInput, true);
			scroller.removeEventListener("wheel", onInput);
			scroller.removeEventListener("touchstart", onInput);
		};
	}, [scrollRef, sessionId]);
}
