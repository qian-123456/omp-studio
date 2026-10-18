/** [B] Type-to-focus: printable keys typed while nothing editable has focus
 * (after clicking the message stream, a sidebar row, …) land in the composer,
 * like ChatGPT. No extra click needed. */

import { useEffect, type RefObject } from "react";
import { MODAL_SELECTOR } from "../../components/FloatingLayer";

/** Marks a SessionView root so each composer only claims keys typed in its own view. */
export const SESSION_VIEW_ATTR = "data-session-view";

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** Floating menus/popovers/dialogs own their keystrokes (type-ahead, shortcuts). */
const OWNS_KEYS = '[data-layer], [role="dialog"], [role="menu"], [role="listbox"], [role="tree"], [role="grid"]';

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

/** Whether `e` should be redirected into the composer textarea `ta`. */
export function shouldRedirectKey(e: KeyboardEvent, ta: HTMLTextAreaElement, compact: boolean): boolean {
	if (!isTextKey(e) || ta.disabled || ta.readOnly || !ta.isConnected) return false;
	if (typeof ta.checkVisibility === "function" && !ta.checkVisibility()) return false;
	const target = e.target instanceof Element ? e.target : null;
	if (target === ta) return false;
	if (target?.closest(EDITABLE) || (target as HTMLElement | null)?.isContentEditable) return false;
	if (target?.closest(OWNS_KEYS) || document.querySelector(MODAL_SELECTOR)) return false;
	// A key typed inside some session view belongs to that view's composer;
	// anywhere else belongs to the main (non-compact) composer.
	const targetView = target?.closest(`[${SESSION_VIEW_ATTR}]`) ?? null;
	if (targetView) return targetView === ta.closest(`[${SESSION_VIEW_ATTR}]`);
	return !compact;
}

export function useTypeToFocus(taRef: RefObject<HTMLTextAreaElement | null>, compact: boolean | undefined): void {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const ta = taRef.current;
			if (!ta || !shouldRedirectKey(e, ta, compact === true)) return;
			// Not preventDefault: the key's default action then inserts into the
			// textarea that now has focus.
			ta.focus();
			ta.setSelectionRange(ta.value.length, ta.value.length);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [taRef, compact]);
}
