/** [B] Keeps the composer focused so the first keystroke reaches an editable
 * field (and with it the IME) instead of relying on type-to-focus. Focus is
 * restored only when nothing else holds it: after entering a session, after a
 * menu/popover/dialog closes, and after a click on blank thread area. Never
 * while another input is focused, a floating layer is open, or text is
 * selected (copy workflows). */

import { useEffect, type RefObject } from "react";
import { otherSurfaceOwnsFocus, ownsTarget, SESSION_VIEW_ATTR } from "./useTypeToFocus";

/** Closing any of these hands focus back. */
const LAYER = '[data-layer], [role="dialog"], [role="menu"], [role="listbox"]';
/** Clicks on these keep their own focus behaviour. */
const INTERACTIVE =
	'button, a[href], input, textarea, select, summary, label, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="option"], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), iframe, video, audio, [data-no-composer-focus]';

/** Focus `ta` iff nothing else wants focus. `clickTarget` = the blank element
 * the user clicked (must sit in the composer's own session view). */
export function restoreComposerFocus(
	ta: HTMLTextAreaElement | null,
	compact: boolean,
	clickTarget: Element | null = null,
): boolean {
	if (!ta || !ta.isConnected || ta.disabled || ta.readOnly) return false;
	if (typeof ta.checkVisibility === "function" && !ta.checkVisibility()) return false;
	const active = document.activeElement;
	if (active && active !== document.body && active !== document.documentElement) return false;
	if (otherSurfaceOwnsFocus(ta)) return false;
	if (window.getSelection()?.isCollapsed === false) return false;
	if (clickTarget) {
		const view = clickTarget.closest(`[${SESSION_VIEW_ATTR}]`);
		if (!view || view !== ta.closest(`[${SESSION_VIEW_ATTR}]`)) return false;
	} else if (!ownsTarget(null, ta, compact)) {
		return false;
	}
	ta.focus({ preventScroll: true });
	ta.setSelectionRange(ta.value.length, ta.value.length);
	return true;
}

export function useRestoreComposerFocus(
	taRef: RefObject<HTMLTextAreaElement | null>,
	compact: boolean | undefined,
	sessionId: string,
): void {
	const isCompact = compact === true;

	// Entering / switching to this session.
	useEffect(() => {
		const id = requestAnimationFrame(() => restoreComposerFocus(taRef.current, isCompact));
		return () => cancelAnimationFrame(id);
	}, [taRef, isCompact, sessionId]);

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const schedule = (delay: number, clickTarget: Element | null) => {
			clearTimeout(timer);
			timer = setTimeout(() => restoreComposerFocus(taRef.current, isCompact, clickTarget), delay);
		};
		// Blank click: the selection a drag leaves behind settles after pointerup.
		const onPointerUp = (e: PointerEvent) => {
			const t = e.target instanceof Element ? e.target : null;
			if (t && !t.closest(INTERACTIVE)) schedule(0, t);
		};
		// A menu / popover / dialog left the DOM: focus fell back to <body>.
		const mo = new MutationObserver((records) => {
			for (const r of records) {
				for (const n of r.removedNodes) {
					if (n instanceof Element && (n.matches(LAYER) || n.querySelector(LAYER))) {
						schedule(30, null);
						return;
					}
				}
			}
		});
		mo.observe(document.body, { childList: true });
		window.addEventListener("pointerup", onPointerUp, true);
		return () => {
			clearTimeout(timer);
			mo.disconnect();
			window.removeEventListener("pointerup", onPointerUp, true);
		};
	}, [taRef, isCompact]);
}
