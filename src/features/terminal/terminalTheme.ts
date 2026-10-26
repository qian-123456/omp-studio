/**
 * Shared xterm theme objects matching the app's light/dark chrome.
 * Both the drawer command terminal and any other xterm instances
 * consume these so terminals follow the resolved app theme live.
 */
import type { ITheme } from "@xterm/xterm";
import { themeById } from "../../lib/theme";

/** Dark terminal — close to the app's dark panel tokens. */
export const XTERM_DARK: ITheme = {
	background: "#1c1c1e",
	foreground: "#e5e5ea",
	cursor: "#0a84ff",
	cursorAccent: "#1c1c1e",
	selectionBackground: "rgba(10, 132, 255, 0.35)",
	selectionForeground: "#ffffff",
	black: "#1c1c1e",
	red: "#ff453a",
	green: "#30d158",
	yellow: "#ffd60a",
	blue: "#0a84ff",
	magenta: "#bf5af2",
	cyan: "#64d2ff",
	white: "#e5e5ea",
	brightBlack: "#636366",
	brightRed: "#ff6961",
	brightGreen: "#4bdb71",
	brightYellow: "#ffe14d",
	brightBlue: "#40a4ff",
	brightMagenta: "#d38cff",
	brightCyan: "#8ae2ff",
	brightWhite: "#f5f5f7",
};

/**
 * Light terminal — matches the app's light well/panel surfaces.
 * All ANSI colors (including white and bright yellow) are tuned for high contrast
 * and readability against light/white backgrounds.
 */
export const XTERM_LIGHT: ITheme = {
	background: "#fbfbfd",
	foreground: "#1d1d1f",
	cursor: "#0066cc",
	cursorAccent: "#fbfbfd",
	selectionBackground: "rgba(0, 102, 204, 0.25)",
	selectionForeground: "#1d1d1f",
	black: "#1f2328",
	red: "#cf222e",
	green: "#1a7f37",
	yellow: "#8c5800",
	blue: "#0969da",
	magenta: "#8250df",
	cyan: "#1b7c83",
	white: "#57606a",
	brightBlack: "#6e7781",
	brightRed: "#a40e26",
	brightGreen: "#116329",
	brightYellow: "#7d4e00",
	brightBlue: "#0550ae",
	brightMagenta: "#6639ba",
	brightCyan: "#056270",
	brightWhite: "#24292f",
};
export const SEARCH_DECORATIONS_DARK = {
	matchBackground: "#3b4252",
	activeMatchBackground: "#4f46e5",
	matchOverviewRuler: "#434c5e",
	activeMatchColorOverviewRuler: "#6366f1",
};

export const SEARCH_DECORATIONS_LIGHT = {
	matchBackground: "#e2e8f0",
	activeMatchBackground: "#93c5fd",
	matchOverviewRuler: "#cbd5e1",
	activeMatchColorOverviewRuler: "#3b82f6",
};

export function getSearchDecorations(
	el: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
) {
	return isDarkTheme(el) ? SEARCH_DECORATIONS_DARK : SEARCH_DECORATIONS_LIGHT;
}


export interface ThemeVarsReader {
	getPropertyValue(prop: string): string;
}

/** Determine whether the app is currently in dark mode. */
export function isDarkTheme(
	el: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): boolean {
	if (!el) {
		if (typeof window !== "undefined" && window.matchMedia) {
			try {
				return window.matchMedia("(prefers-color-scheme: dark)").matches;
			} catch {}
		}
		return true;
	}
	const mode = el.dataset?.mode;
	if (mode === "light") return false;
	if (mode === "dark") return true;

	const themeId = el.dataset?.theme;
	if (themeId) {
		const def = themeById(themeId);
		if (def) return def.dark;
	}

	if (el.classList?.contains("dark")) return true;

	if (typeof window !== "undefined" && window.matchMedia) {
		try {
			return window.matchMedia("(prefers-color-scheme: dark)").matches;
		} catch {}
	}
	return true;
}

/**
 * Pure palette resolution function: builds an xterm ITheme based on theme mode
 * and CSS variables, falling back to predefined accessible light/dark palettes.
 */
export function resolveXtermTheme(options: {
	isDark?: boolean;
	styles?: ThemeVarsReader;
} = {}): ITheme {
	const dark = options.isDark ?? true;
	const base = dark ? XTERM_DARK : XTERM_LIGHT;
	const styles = options.styles;
	if (!styles) return { ...base };

	const bg = styles.getPropertyValue("--bg-panel").trim() || styles.getPropertyValue("--bg").trim() || undefined;
	const fg = styles.getPropertyValue("--text").trim() || undefined;
	const accent = styles.getPropertyValue("--accent").trim() || undefined;
	const err = styles.getPropertyValue("--status-error").trim() || undefined;
	const succ = styles.getPropertyValue("--status-success").trim() || undefined;
	const warn = styles.getPropertyValue("--status-warning").trim() || undefined;
	const renamed = styles.getPropertyValue("--status-renamed").trim() || undefined;
	if (dark) {
		return {
			...base,
			...(bg ? { background: bg, cursorAccent: bg, black: bg } : {}),
			...(fg ? { foreground: fg, white: fg } : {}),
			...(accent ? { cursor: accent, blue: accent } : {}),
			...(err ? { red: err } : {}),
			...(succ ? { green: succ } : {}),
			...(warn ? { yellow: warn } : {}),
			...(renamed ? { cyan: renamed } : {}),
		};
	}

	// Light mode: prioritize contrast for ANSI text, but match app background,
	// text foreground, and cursor accent exactly to CSS variables.
	return {
		...base,
		...(bg ? { background: bg, cursorAccent: bg } : {}),
		...(fg ? { foreground: fg, selectionForeground: fg } : {}),
		...(accent ? { cursor: accent } : {}),
	};
}

/** Read the app's current theme and derive the matching xterm ITheme. */
export function currentXtermTheme(
	el: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): ITheme {
	const dark = isDarkTheme(el);
	const styles = el && typeof window !== "undefined" ? getComputedStyle(el) : undefined;
	return resolveXtermTheme({ isDark: dark, styles });
}

/**
 * Subscribe a terminal to live app theme changes (MutationObserver on <html>,
 * custom event "ompws:theme-change", and mediaQuery for OS theme changes).
 */
export function bindXtermTheme(term: {
	options: { theme?: ITheme };
}): () => void {
	const apply = () => {
		term.options.theme = currentXtermTheme();
	};
	apply();

	const cleanups: (() => void)[] = [];

	if (typeof document !== "undefined") {
		const obs = new MutationObserver(apply);
		obs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "data-mode", "class", "style"],
		});
		cleanups.push(() => obs.disconnect());
	}

	if (typeof window !== "undefined") {
		window.addEventListener("ompws:theme-change", apply);
		cleanups.push(() => window.removeEventListener("ompws:theme-change", apply));

		try {
			const mq = window.matchMedia("(prefers-color-scheme: dark)");
			mq.addEventListener("change", apply);
			cleanups.push(() => mq.removeEventListener("change", apply));
		} catch {}
	}

	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}
