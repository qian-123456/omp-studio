import { useEffect } from "react";
import type { RefObject } from "react";

/** Keep native dragging and scrolling, correcting only a drag begun in the left gutter. */
export function useGutterSelection(containerRef: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let anchor: { node: Node; offset: number } | null = null;
		let dragging = false;
		let correcting = false;
		let clearTimer = 0;
		const down = (event: MouseEvent) => {
			window.clearTimeout(clearTimer);
			anchor = null;
			dragging = false;
			if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target;
			if (!(target instanceof HTMLElement) || target.closest("a,button,input,textarea,select,[contenteditable=true]")) return;
			// Only empty layout surfaces qualify, not a press on rich text itself.
			if (target.tagName !== "DIV") return;
			let left = Infinity;
			let row: HTMLElement | null = null;
			for (const candidate of container.querySelectorAll<HTMLElement>("[data-index]")) {
				const box = candidate.getBoundingClientRect();
				if (event.clientY < box.top || event.clientY > box.bottom) continue;
				const walker = document.createTreeWalker(candidate, NodeFilter.SHOW_TEXT);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					if (!node.textContent?.trim() || node.parentElement?.closest("button,a,input,textarea,select,[contenteditable=true]")) continue;
					const range = document.createRange();
					range.selectNodeContents(node);
					for (const rect of range.getClientRects()) {
						if (event.clientY >= rect.top && event.clientY <= rect.bottom && rect.width > 0 && rect.left < left) {
							left = rect.left;
							row = candidate;
						}
					}
				}
			}
			if (!row || event.clientX >= left || event.clientX < container.getBoundingClientRect().left) return;
			const range = document.caretRangeFromPoint?.(left + 1, event.clientY);
			if (range && row.contains(range.startContainer)) anchor = { node: range.startContainer, offset: range.startOffset };
		};
		const move = (event: MouseEvent) => { if (anchor && (event.buttons & 1)) dragging = true; };
		const change = () => {
			if (!anchor || !dragging || correcting || !anchor.node.isConnected) return;
			const selection = window.getSelection();
			if (!selection?.focusNode || !container.contains(selection.focusNode)) return;
			const focusElement = selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode.parentElement;
			if (!focusElement?.closest("[data-index]")) return;
			if (selection.anchorNode === anchor.node && selection.anchorOffset === anchor.offset) return;
			correcting = true;
			selection.setBaseAndExtent(anchor.node, anchor.offset, selection.focusNode, selection.focusOffset);
			correcting = false;
		};
		const up = () => { clearTimer = window.setTimeout(() => { anchor = null; dragging = false; }, 0); };
		const blur = () => { window.clearTimeout(clearTimer); anchor = null; dragging = false; };
		container.addEventListener("mousedown", down);
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
		window.addEventListener("blur", blur);
		document.addEventListener("selectionchange", change);
		return () => {
			window.clearTimeout(clearTimer);
			container.removeEventListener("mousedown", down);
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
			window.removeEventListener("blur", blur);
			document.removeEventListener("selectionchange", change);
		};
	}, [containerRef]);
}
