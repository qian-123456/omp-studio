import { homeDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useState } from "react";
import { shortPath } from "./paths";

/** Call `onEscape` when the Escape key is pressed. Attach once per open modal/popover. */
export function useEscapeKey(onEscape: () => void, active = true): void {
	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (isComposing({ nativeEvent: e, key: e.key })) return;
				e.stopPropagation();
				onEscape();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onEscape, active]);
}

let composingDepth = 0;
let lastCompositionEnd = 0;

if (typeof document !== "undefined") {
	document.addEventListener(
		"compositionstart",
		() => {
			composingDepth++;
		},
		true,
	);
	document.addEventListener(
		"compositionend",
		() => {
			composingDepth = Math.max(0, composingDepth - 1);
			lastCompositionEnd = Date.now();
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
	if (composingDepth > 0) return true;
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
