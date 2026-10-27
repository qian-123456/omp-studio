import { useEffect } from "react";
import { resolveScheme, usePrefs, type Scheme, type Skin } from "../core/stores/prefs";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Write `data-skin` / `data-scheme` on <html> and sync the browser chrome colour. */
export function applyTheme(skin: Skin, scheme: Scheme): void {
	const root = document.documentElement;
	root.dataset.skin = skin;
	root.dataset.scheme = scheme;
	// Theme colour comes from the freshly applied token, so skins stay the single source of truth.
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

/** Keeps the document attributes in step with prefs and the system colour scheme. */
export function useTheme(): void {
	const skin = usePrefs((s) => s.skin);
	const pref = usePrefs((s) => s.scheme);
	useEffect(() => {
		const mq = window.matchMedia(DARK_QUERY);
		const apply = () => applyTheme(skin, resolveScheme(pref, mq.matches));
		apply();
		if (pref !== "system") return;
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, [skin, pref]);
}
