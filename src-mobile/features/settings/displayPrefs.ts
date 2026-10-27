import { usePrefs } from "../../core/stores/prefs";
import { MSG_SIZE_KEY, msgSizeFromPref, msgSizePx } from "./settingsMap";

/**
 * Publish the message text size as `html[data-msg-size]` and `--m-msg-fs` (px) so the chat
 * can use `font-size: var(--m-msg-fs, 16px)`. Safe to call repeatedly.
 */
export function applyMsgSize(value: unknown): void {
	const size = msgSizeFromPref(value);
	const root = document.documentElement;
	root.dataset.msgSize = size;
	root.style.setProperty("--m-msg-fs", `${msgSizePx(size)}px`);
}

let started = false;

/** Apply the stored size now and keep it in sync with prefs. Call once at boot (idempotent). */
export function startDisplayPrefs(): void {
	if (started) return;
	started = true;
	applyMsgSize(usePrefs.getState().extra[MSG_SIZE_KEY]);
	usePrefs.subscribe((s, prev) => {
		if (s.extra[MSG_SIZE_KEY] !== prev.extra[MSG_SIZE_KEY]) applyMsgSize(s.extra[MSG_SIZE_KEY]);
	});
}
