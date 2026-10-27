import { useEffect, useRef, useState } from "react";
import { nav } from "../core/nav";

/**
 * Mount/unmount with a transition window: `mounted` stays true while the exit
 * transition plays, `visible` flips one frame after mount so CSS transitions run.
 */
export function usePresence(open: boolean, ms = 240): { mounted: boolean; visible: boolean } {
	const [mounted, setMounted] = useState(open);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (open) {
			setMounted(true);
			let inner = 0;
			const outer = requestAnimationFrame(() => {
				inner = requestAnimationFrame(() => setVisible(true));
			});
			return () => {
				cancelAnimationFrame(outer);
				cancelAnimationFrame(inner);
			};
		}
		setVisible(false);
		const t = setTimeout(() => setMounted(false), ms);
		return () => clearTimeout(t);
	}, [open, ms]);
	return { mounted, visible: visible && open };
}

let lockCount = 0;
let prevOverflow = "";

function lockScroll(): () => void {
	if (lockCount === 0) {
		prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
	}
	lockCount += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		lockCount -= 1;
		if (lockCount === 0) document.body.style.overflow = prevOverflow;
	};
}

/**
 * Shared overlay behaviour while `open`: back-gesture layer, Escape to close,
 * body scroll lock, and focus restore to the previously focused element.
 */
export function useOverlay(open: boolean, onClose: () => void): void {
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const disposeLayer = nav.pushLayer(() => closeRef.current());
		const unlock = lockScroll();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeRef.current();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			unlock();
			disposeLayer();
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	}, [open]);
}
