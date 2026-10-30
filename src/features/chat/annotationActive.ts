/** Shared "user is annotating" probe for the transcript.
 *
 * True while the selection bubble / comment draft is open (the bubble marks
 * itself `data-selection-toolbar-active="true"`) or a non-collapsed browser
 * selection sits inside the transcript. Automatic scroll-to-bottom and
 * layout-shifting presentation changes defer while this holds. */

import { useEffect, useState } from "react";

const MARKER = '[data-selection-toolbar-active="true"]';

export function isAnnotating(scrollEl?: HTMLElement | null): boolean {
	if (typeof document === "undefined") return false;
	if (document.querySelector(MARKER)) return true;
	const s = window.getSelection();
	if (!s || s.isCollapsed || !s.anchorNode) return false;
	if (scrollEl?.contains(s.anchorNode)) return true;
	const el = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode.parentElement;
	return Boolean(el?.closest('[id^="msg-"]'));
}

const RELEASE_POLL_MS = 250;

/**
 * Returns `value`, except while the user is annotating: then the value last
 * seen before the annotation began stays in effect, so the disclosure DOM under
 * the selection does not change (header text, divider, height). Releases to the
 * live value once the annotation is submitted or dismissed.
 */
export function useValueFrozenWhileAnnotating<T>(value: T): T {
	const [held, setHeld] = useState(value);
	const annotating = isAnnotating();
	const frozen = annotating && held !== value;
	useEffect(() => {
		if (!annotating) {
			if (held !== value) setHeld(value);
			return;
		}
		// Annotating with a pending change: wait for the marker/selection to go.
		const id = window.setInterval(() => {
			if (!isAnnotating()) setHeld(value);
		}, RELEASE_POLL_MS);
		return () => window.clearInterval(id);
	}, [annotating, held, value]);
	return frozen ? held : value;
}
