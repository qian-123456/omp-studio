/** [B] Type-to-focus: printable keys typed while nothing editable has focus
 * (after clicking the message stream, a sidebar row, …) land in the composer,
 * like ChatGPT. No extra click needed. */

import { useEffect, type RefObject } from "react";
import { MODAL_SELECTOR } from "../../components/FloatingLayer";
import { isImeActive, startImeWatch } from "../../lib/imeState";

/** Marks a SessionView root so each composer only claims keys typed in its own view. */
export const SESSION_VIEW_ATTR = "data-session-view";

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** Floating menus/popovers/dialogs own their keystrokes (type-ahead, shortcuts). */
const OWNS_KEYS = '[data-layer], [role="dialog"], [role="menu"], [role="listbox"], [role="tree"], [role="grid"]';
/** Open surfaces that own the keyboard; toasts and pills never do. */
const OPEN_SURFACE = `${MODAL_SELECTOR}, [data-layer]:not([data-layer="toast"], [data-layer="pill"], [data-layer="hovercard"], [role="status"]), [role="dialog"], [role="menu"], [role="listbox"], [role="tree"], [role="grid"]`;

/** True while another editable element holds focus or any floating surface (popover,
 * menu, dialog, possibly portaled outside the composer tree) is open. The composer
 * must then neither steal focus nor redirect keystrokes: a transient blur of the
 * surface's own field (re-render, streaming update) would otherwise let the next
 * key land in the composer. `ta` itself holding focus does not count. */
export function otherSurfaceOwnsFocus(ta: HTMLTextAreaElement | null): boolean {
	const active = document.activeElement;
	if (active && active !== ta && active !== document.body && active !== document.documentElement) {
		if (active.closest(EDITABLE) || (active as HTMLElement).isContentEditable || active.closest(OWNS_KEYS)) {
			return true;
		}
	}
	return document.querySelector(OPEN_SURFACE) !== null;
}

/** True for keys that would have inserted text (or pasted it) had a field been focused. */
function isTextKey(e: KeyboardEvent): boolean {
	if (e.defaultPrevented || e.altKey) return false;
	const paste = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "v";
	if (paste) return true;
	if (e.metaKey || e.ctrlKey) return false;
	// IME start: WebKit/Chromium report "Process" / keyCode 229 for the first key.
	if (e.isComposing || e.key === "Process" || e.keyCode === 229) return true;
	// Single printable character; space/Enter keep their scroll/activate meaning.
	return e.key.length === 1 && e.key !== " ";
}

/** A plain character key (not a shortcut/paste/IME process key). */
function isPlainChar(e: KeyboardEvent): boolean {
	return !e.isComposing && e.key !== "Process" && e.keyCode !== 229 && !e.metaKey && !e.ctrlKey && e.key.length === 1;
}

/** Whether `e` should be redirected into the composer textarea `ta`. */
export function shouldRedirectKey(e: KeyboardEvent, ta: HTMLTextAreaElement, compact: boolean): boolean {
	if (!isTextKey(e) || ta.disabled || ta.readOnly || !ta.isConnected) return false;
	if (typeof ta.checkVisibility === "function" && !ta.checkVisibility()) return false;
	const target = e.target instanceof Element ? e.target : null;
	if (target === ta) return false;
	if (target?.closest(EDITABLE) || (target as HTMLElement | null)?.isContentEditable) return false;
	if (target?.closest(OWNS_KEYS) || otherSurfaceOwnsFocus(ta)) return false;
	return ownsTarget(target, ta, compact);
}

/** A key typed inside some session view belongs to that view's composer;
 * anywhere else belongs to the last-read view's, else the main (non-compact) one. */
export function ownsTarget(target: Element | null, ta: HTMLTextAreaElement, compact: boolean): boolean {
	const targetView = target?.closest(`[${SESSION_VIEW_ATTR}]`) ?? null;
	if (targetView) return targetView === ta.closest(`[${SESSION_VIEW_ATTR}]`);
	const lastView = lastReadView?.isConnected ? lastReadView : null;
	return lastView ? lastView === ta.closest(`[${SESSION_VIEW_ATTR}]`) : !compact;
}

/** Session view the user last clicked/scrolled in (null = outside any, e.g. sidebar).
 * Keys typed with no focus target belong to it, so reading the side chat then typing
 * lands in the side composer rather than the main one. */
let lastReadView: Element | null = null;

function trackReading(e: Event): void {
	const t = e.target instanceof Element ? e.target : null;
	lastReadView = t?.closest(`[${SESSION_VIEW_ATTR}]`) ?? null;
}

export function useTypeToFocus(taRef: RefObject<HTMLTextAreaElement | null>, compact: boolean | undefined): void {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const ta = taRef.current;
			if (!ta || !shouldRedirectKey(e, ta, compact === true)) return;
			// With an IME active the composer cannot attach to this keystroke any
			// more (the key is already past the input method), so the raw letter
			// would land as plain Latin text. Swallow it: focus moves, nothing is
			// inserted, and the user retypes that one key. Otherwise let the key's
			// default action insert into the textarea that now has focus.
			if (isImeActive() && isPlainChar(e)) e.preventDefault();
			ta.focus();
			ta.setSelectionRange(ta.value.length, ta.value.length);
		};
		startImeWatch();
		const opts = { capture: true, passive: true } as const;
		const reading = ["pointerdown", "wheel", "touchstart", "touchmove"] as const;
		for (const n of reading) window.addEventListener(n, trackReading, opts);
		window.addEventListener("keydown", onKey);
		return () => {
			for (const n of reading) window.removeEventListener(n, trackReading, opts);
			window.removeEventListener("keydown", onKey);
		};
	}, [taRef, compact]);
}
