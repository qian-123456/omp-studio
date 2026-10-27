/**
 * Resolves mobile app CSS tokens to standard visualize variables:
 * --background, --foreground, --card, --primary, --border, --viz-series-*, etc.
 * Resolution runs in the host document so computed values arrive in the iframe.
 */

const TOKEN_MAP: Record<string, string> = {
	"--background": "--m-bg",
	"--foreground": "--m-text",
	"--card": "--m-surface",
	"--card-foreground": "--m-text",
	"--popover": "--m-surface",
	"--popover-foreground": "--m-text",
	"--primary": "--m-accent",
	"--secondary": "--m-surface-2",
	"--secondary-foreground": "--m-text",
	"--muted": "--m-surface-hover",
	"--muted-foreground": "--m-text-3",
	"--accent-foreground": "--m-accent-text",
	"--destructive": "--m-danger",
	"--border": "--m-border",
	"--input": "--m-border",
	"--ring": "--m-accent",
};

const SERIES_MAP: Record<string, string> = {
	"--viz-series-1": "--m-accent",
	"--viz-series-2": "--m-accent-text",
	"--viz-series-3": "--m-success",
	"--viz-series-4": "--m-warn",
	"--viz-series-5": "--m-accent",
	"--viz-series-6": "--m-danger",
};

export function collectVizThemeVars(): Record<string, string> {
	if (typeof document === "undefined") return {};
	const root = document.documentElement;
	const computed = getComputedStyle(root);
	const out: Record<string, string> = {};

	for (const [target, source] of Object.entries(TOKEN_MAP)) {
		const val = computed.getPropertyValue(source).trim();
		if (val) out[target] = val;
	}
	for (const [target, source] of Object.entries(SERIES_MAP)) {
		const val = computed.getPropertyValue(source).trim();
		if (val) out[target] = val;
	}

	const primary = out["--primary"];
	if (primary) {
		out["--accent"] = `color-mix(in srgb, ${primary} 14%, transparent)`;
	}
	const isDark =
		root.dataset.scheme === "dark" ||
		root.dataset.mode === "dark" ||
		(!root.dataset.scheme && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
	out["--primary-foreground"] = isDark ? "#0d0d0d" : "#ffffff";

	return out;
}
