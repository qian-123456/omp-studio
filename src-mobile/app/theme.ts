import { useEffect } from "react";
import { resolveScheme, usePrefs, type Scheme } from "../core/stores/prefs";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Write `data-scheme` on <html> and sync the browser chrome colour. */
export function applyTheme(scheme: Scheme): void {
	const root = document.documentElement;
	root.dataset.scheme = scheme;
	// Theme colour comes from the freshly applied token, so tokens.css stays the single source of truth.
	const bg = getComputedStyle(root).getPropertyValue("--m-bg").trim();
	if (!bg) return;
	let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (!meta) {
		meta = document.createElement("meta");
		meta.name = "theme-color";
		document.head.appendChild(meta);
	}
	meta.content = bg;
}

/** Keeps the document attribute in step with prefs and the system colour scheme. */
export function useTheme(): void {
	const pref = usePrefs((s) => s.scheme);
	useEffect(() => {
		const mq = window.matchMedia(DARK_QUERY);
		const apply = () => applyTheme(resolveScheme(pref, mq.matches));
		apply();
		if (pref !== "system") return;
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, [pref]);
}
