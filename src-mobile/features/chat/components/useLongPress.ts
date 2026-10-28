import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const HOLD_MS = 480;
const MOVE_TOLERANCE = 8;
/** After the hold fires, give the platform time to start a native text selection before opening the sheet. */
const SELECTION_SETTLE_MS = 260;

function hasSelectionIn(el: HTMLElement): boolean {
	const s = window.getSelection();
	if (!s || s.isCollapsed || !s.rangeCount) return false;
	return el.contains(s.getRangeAt(0).commonAncestorContainer);
}

/**
 * Long-press (touch/pen only) handlers. Presses that start on links, buttons, code blocks or form controls are
 * ignored so they keep their own behaviour. A press that turns into a native text selection keeps the system
 * selection menu (and the annotation toolbar) instead of opening the action sheet. Cheap: no state.
 */
export function useLongPress(onLongPress: () => void) {
	const timer = useRef<number | null>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
	const cb = useRef(onLongPress);
	cb.current = onLongPress;
	const cancel = () => {
		window.clearTimeout(timer.current ?? undefined);
		timer.current = null;
		start.current = null;
	};
	return {
		onPointerDown(e: ReactPointerEvent<HTMLElement>) {
			if (e.pointerType === "mouse") return;
			if ((e.target as HTMLElement).closest("a,button,pre,input,textarea,img,[data-no-longpress]")) return;
			const el = e.currentTarget;
			timer.current = window.setTimeout(() => {
				timer.current = null;
				setTimeout(() => {
					if (hasSelectionIn(el)) return;
					if (navigator.vibrate) navigator.vibrate(8);
					cb.current();
				}, SELECTION_SETTLE_MS);
			}, HOLD_MS);
		},
		onPointerMove(e: ReactPointerEvent<HTMLElement>) {
			const s = start.current;
			if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel();
		},
		onPointerUp: cancel,
		onPointerCancel: cancel,
	};
}
