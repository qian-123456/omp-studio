import { homeDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useState } from "react";
import { claimEscape } from "./escapeClaim";
import { shortPath } from "./paths";

/** Call `onEscape` when the Escape key is pressed. Attach once per open modal/popover. */
export function useEscapeKey(onEscape: () => void, active = true): void {
	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (isComposing({ nativeEvent: e, key: e.key })) return;
				e.stopPropagation();
				claimEscape(e);
				onEscape();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onEscape, active]);
}

let composingTarget: EventTarget | null = null;
let lastCompositionEnd = 0;

if (typeof document !== "undefined") {
	document.addEventListener(
		"compositionstart",
		(e) => {
			composingTarget = e.target;
		},
		true,
	);
	document.addEventListener(
		"compositionend",
		() => {
			composingTarget = null;
			lastCompositionEnd = Date.now();
		},
		true,
	);
	// A composition can be orphaned (editor re-rendered or blurred mid-IME, so compositionend never
	// fires). Drop the stale state on focus loss, and on any real key (not the IME's keyCode 229).
	document.addEventListener(
		"focusout",
		(e) => {
			if (e.target === composingTarget) composingTarget = null;
		},
		true,
	);
	document.addEventListener(
		"keydown",
		(e) => {
			if (composingTarget && !e.isComposing && e.keyCode !== 229) composingTarget = null;
		},
		true,
	);
}

/**
 * IME composition guard for Enter-to-submit handlers: skip while composing (拼音选词).
 * On macOS WKWebView, the Enter keydown committing an IME candidate can arrive
 * just after compositionend or with isComposing === false due to event dispatch ordering.
 */
export function isComposing(e: { nativeEvent?: unknown; key?: string }): boolean {
	if (Boolean((e.nativeEvent as { isComposing?: boolean } | undefined)?.isComposing)) return true;
	if (composingTarget) {
		if ((composingTarget as Node).isConnected === false) composingTarget = null;
		else return true;
	}
	// Enter that committed the last candidate can arrive just after compositionend
	if (e.key === "Enter" && Date.now() - lastCompositionEnd < 60) return true;
	return false;
}


let homeCache: string | null = null;
let homePromise: Promise<string | null> | null = null;

/** User home directory (cached), for `~` path shortening. */
export function useHomeDir(): string | null {
	const [home, setHome] = useState<string | null>(homeCache);
	useEffect(() => {
		if (homeCache) return;
		homePromise ??= homeDir()
			.then((h) => {
				homeCache = h;
				return h;
			})
			.catch(() => null);
		homePromise.then((h) => setHome(h));
	}, []);
	return home;
}

/** `(path) => path with ~ for home`. */
export function useShortPath(): (path: string) => string {
	const home = useHomeDir();
	return useCallback((path: string) => shortPath(path, home), [home]);
}
