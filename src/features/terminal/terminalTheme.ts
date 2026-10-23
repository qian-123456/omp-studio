/**
 * Shared xterm theme objects matching the app's light/dark chrome.
 * Both the drawer command terminal and the full-screen agent terminal
 * consume these so terminals stop looking like foreign black boxes.
 */
import type { ITheme } from "@xterm/xterm";

/** Dark terminal — close to the app's dark panel tokens. */
export const XTERM_DARK: ITheme = {
	background: "#1c1c1e",
	foreground: "#e5e5ea",
	cursor: "#0a84ff",
	cursorAccent: "#1c1c1e",
	selectionBackground: "rgba(10, 132, 255, 0.35)",
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

/** Light terminal — matches the app's light well/panel surfaces. */
export const XTERM_LIGHT: ITheme = {
	background: "#fbfbfd",
	foreground: "#1d1d1f",
	cursor: "#0066cc",
	cursorAccent: "#fbfbfd",
	selectionBackground: "rgba(0, 102, 204, 0.25)",
	black: "#1d1d1f",
	red: "#d70015",
	green: "#248a3d",
	yellow: "#a05a00",
	blue: "#0066cc",
	magenta: "#8944ab",
	cyan: "#0071a4",
	white: "#e8e8ed",
	brightBlack: "#6e6e73",
	brightRed: "#ff3b30",
	brightGreen: "#28c840",
	brightYellow: "#ffcc00",
	brightBlue: "#0a84ff",
	brightMagenta: "#bf5af2",
	brightCyan: "#32ade6",
	brightWhite: "#ffffff",
};

/** Read the app's current theme. The app stores light/dark via
 * `data-theme`/`data-mode` on <html>; default dark when unknown. */
export function currentXtermTheme(): ITheme {
	const el = document.documentElement;
	const mode = el.dataset.theme ?? el.dataset.mode ?? "dark";
	return mode === "light" ? XTERM_LIGHT : XTERM_DARK;
}

/** Subscribe a terminal to app theme changes (MutationObserver on <html>). */
export function bindXtermTheme(term: {
	options: { theme?: ITheme };
}): () => void {
	const apply = () => {
		term.options.theme = currentXtermTheme();
	};
	apply();
	const obs = new MutationObserver(apply);
	obs.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "data-mode"],
	});
	return () => obs.disconnect();
}
