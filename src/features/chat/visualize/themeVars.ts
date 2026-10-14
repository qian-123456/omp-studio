/**
 * Maps the app's live theme tokens (index.css custom properties on <html>)
 * onto the variable names fragments are told to consume (--background,
 * --foreground, --card, --viz-series-*, …). Resolution happens in the host
 * document, so color-mix() and theme-aware values arrive pre-computed.
 */

import { themeById } from "../../../lib/theme";

/** Token contract handed to fragments, in SKILL-compatible names. */
const TOKEN_MAP: Record<string, string> = {
	"--background": "--bg",
	"--foreground": "--text",
	"--card": "--bg-panel",
	"--card-foreground": "--text",
	"--popover": "--bg-panel",
	"--popover-foreground": "--text",
	"--primary": "--accent",
	"--secondary": "--bg-hover",
	"--secondary-foreground": "--text",
	"--muted": "--ghost-hover",
	"--muted-foreground": "--text-muted",
	"--accent-foreground": "--accent",
	"--destructive": "--status-error",
	"--border": "--line",
	"--input": "--hairline-strong",
	"--ring": "--accent",
};

/** Chart palette derived from the active theme's accent/status colors. */
const SERIES_MAP: Record<string, string> = {
	"--viz-series-1": "--accent",
	"--viz-series-2": "--accent-strong",
	"--viz-series-3": "--status-success",
	"--viz-series-4": "--status-warning",
	"--viz-series-5": "--status-renamed",
	"--viz-series-6": "--status-error",
};

/**
 * Read the host's computed theme tokens and produce the variable map that is
 * inlined into the iframe document (and re-pushed on theme changes).
 */
export function collectVizThemeVars(): Record<string, string> {
	const computed = getComputedStyle(document.documentElement);
	const out: Record<string, string> = {};
	const pull = (target: string, source: string) => {
		const value = computed.getPropertyValue(source).trim();
		if (value) out[target] = value;
	};
	for (const [target, source] of Object.entries(TOKEN_MAP)) pull(target, source);
	for (const [target, source] of Object.entries(SERIES_MAP)) pull(target, source);

	const primary = out["--primary"];
	if (primary) {
		// A tinted accent surface (info tint, not the accent itself).
		out["--accent"] = `color-mix(in srgb, ${primary} 14%, transparent)`;
	}
	out["--primary-foreground"] =
		resolvedIsDark() ? "rgb(13 13 13)" : "rgb(255 255 255)";
	return out;
}

function resolvedIsDark(): boolean {
	const id = document.documentElement.dataset.theme;
	return themeById(id ?? "")?.dark ?? true;
}
