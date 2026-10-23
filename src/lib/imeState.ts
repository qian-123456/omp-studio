/** [B] Cached "is the current input source an IME?" (macOS TIS, see
 * src-tauri/src/ime.rs). A webview only learns about IME composition once a
 * key reaches an editable field, so type-to-focus needs the answer *before*
 * the first keydown. Seeded from `ime_active`, kept fresh by the `ime:changed`
 * event and re-read whenever the window regains focus. When the backend lacks
 * the command (app not restarted after an update) the cache stays `false`
 * and type-to-focus keeps its plain behaviour. */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

let active = false;
let started = false;
let warned = false;

/** Last known IME state of the current input source. */
export function isImeActive(): boolean {
	return active;
}

/** Test hook: force the cached value. */
export function setImeActiveForTest(value: boolean): void {
	active = value;
}

async function refresh(): Promise<void> {
	try {
		active = await invoke<boolean>("ime_active");
	} catch (err) {
		if (!warned) {
			warned = true;
			console.warn("[ime] ime_active unavailable (restart the app to enable IME-safe type-to-focus):", err);
		}
	}
}

/** Idempotent: seed the cache and subscribe to input-source changes. */
export function startImeWatch(): void {
	if (started || typeof window === "undefined") return;
	started = true;
	void refresh();
	window.addEventListener("focus", () => void refresh());
	listen<boolean>("ime:changed", (e) => {
		active = e.payload === true;
	}).catch(() => {
		/* no Tauri event bus (tests / plain browser) */
	});
}
