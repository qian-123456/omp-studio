import clsx from "clsx";
import {
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { type Anchor, anchorRect, usableViewport, Z_LAYER } from "./FloatingLayer";

/** Gap between the selection and the bubble: tail height plus breathing room. */
export const BUBBLE_GAP = 9;

/**
 * Chat-bubble style action pill: floats clear of the selected text and a tail
 * points at the selection's horizontal center. Flips below when there is no
 * room above. Positioned itself (not via FloatingLayer) because the tail must
 * overflow the box and track the clamped position.
 */
export function SelectionBubble({
	anchor,
	ref,
	children,
	className,
}: {
	anchor: Anchor;
	ref?: Ref<HTMLDivElement>;
	children: ReactNode;
	className?: string;
}) {
	const innerRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number; arrowX: number; above: boolean } | null>(null);

	const update = useCallback(() => {
		const el = innerRef.current;
		if (!el) return;
		const a = anchorRect(anchor);
		const vp = usableViewport();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const cx = a.left + a.width / 2;
		const left = Math.min(Math.max(cx - w / 2, vp.left), Math.max(vp.left, vp.right - w));
		const roomAbove = a.top - BUBBLE_GAP - vp.top;
		const roomBelow = vp.bottom - a.bottom - BUBBLE_GAP;
		const above = h <= roomAbove || roomAbove >= roomBelow;
		const top = above ? a.top - BUBBLE_GAP - h : a.bottom + BUBBLE_GAP;
		const arrowX = Math.min(Math.max(cx - left, 14), Math.max(14, w - 14));
		setPos((p) =>
			p && p.left === left && p.top === top && p.arrowX === arrowX && p.above === above
				? p
				: { left, top, arrowX, above },
		);
	}, [anchor]);

	// Every render: the selection may move inside the same anchor element.
	useLayoutEffect(update);
	useEffect(() => {
		const ro = new ResizeObserver(update);
		if (innerRef.current) ro.observe(innerRef.current);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [update]);

	return createPortal(
		<div
			ref={(el) => {
				innerRef.current = el;
				if (typeof ref === "function") ref(el);
				else if (ref) ref.current = el;
			}}
			data-layer="menu"
			// Keep the text selection alive when clicking the bubble padding/buttons;
			// inputs inside (annotation form) must still take focus and a caret.
			onMouseDown={(e) => {
				if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
			}}
			className={clsx(
				"fixed flex items-center gap-1 rounded-full border border-[var(--line,var(--border))] bg-[var(--bg-panel)] p-1 text-[11px] text-[var(--text-60,var(--text-muted))] shadow-lg",
				className,
			)}
			style={{
				zIndex: Z_LAYER.menu,
				left: pos?.left ?? -9999,
				top: pos?.top ?? -9999,
				visibility: pos ? "visible" : "hidden",
			}}
		>
			{children}
			{pos && (
				<span
					aria-hidden="true"
					className={clsx(
						"pointer-events-none absolute h-2 w-2 rotate-45 bg-[var(--bg-panel)]",
						pos.above
							? "-bottom-[5px] border-r border-b border-[var(--line,var(--border))]"
							: "-top-[5px] border-l border-t border-[var(--line,var(--border))]",
					)}
					style={{ left: pos.arrowX - 4 }}
				/>
			)}
		</div>,
		document.body,
	);
}
