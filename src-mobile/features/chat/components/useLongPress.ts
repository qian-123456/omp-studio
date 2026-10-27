import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const HOLD_MS = 480;
const MOVE_TOLERANCE = 8;

/**
 * Long-press (touch/pen only) handlers. Presses that start on links, buttons, code blocks or form controls are
 * ignored so they keep their own behaviour. Cheap: no state, one timer per press.
 */
export function useLongPress(onLongPress: () => void) {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
	const cb = useRef(onLongPress);
	cb.current = onLongPress;
	const cancel = () => {
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = null;
		start.current = null;
	};
	return {
		onPointerDown(e: ReactPointerEvent<HTMLElement>) {
			if (e.pointerType === "mouse") return;
			if ((e.target as HTMLElement).closest("a,button,pre,input,textarea,img,[data-no-longpress]")) return;
			start.current = { x: e.clientX, y: e.clientY };
			timer.current = setTimeout(() => {
				timer.current = null;
				if (navigator.vibrate) navigator.vibrate(8);
				cb.current();
			}, HOLD_MS);
		},
		onPointerMove(e: ReactPointerEvent<HTMLElement>) {
			const s = start.current;
			if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel();
		},
		onPointerUp: cancel,
		onPointerCancel: cancel,
		onContextMenu(e: { preventDefault(): void }) {
			// Native context menu would fight the action sheet.
			e.preventDefault();
		},
	};
}
