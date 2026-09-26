/**
 * Theme engine, modeled on omp-web's theme feature.
 *
 * A theme is applied via attributes on <html> (data-theme / data-mode /
 * data-font-size / data-ui-scale); index.css maps the Tailwind color tokens
 * used across the app onto per-theme CSS variables. Choices persist in
 * localStorage under the `ompws:` prefix, same convention as stores/ui.ts —
 * this is a view preference, not part of the Rust Settings contract.
 */

import { useSyncExternalStore } from "react";

export interface ThemeDef {
	id: string;
	name: string;
	dark: boolean;
	/** Mini preview colors for picker swatches. */
	swatch: { bg: string; panel: string; accent: string; text: string };
}

/** "system" follows prefers-color-scheme and resolves to defaultTheme / lightTheme. */
export type ThemeChoice = "system" | (typeof THEMES)[number]["id"];

export type FontSize = "sm" | "md" | "lg" | "xl";
export type UiScale = "compact" | "standard" | "comfortable" | "large";

export const THEMES: ThemeDef[] = [
	{
		id: "ompws",
		name: "默认",
		dark: true,
		swatch: { bg: "#0a0a0a", panel: "#171717", accent: "#f59e0b", text: "#f5f5f5" },
	},
	{
		id: "omp",
		name: "OMP",
		dark: true,
		swatch: { bg: "#000000", panel: "#0a0a0c", accent: "#ec5bab", text: "#f5f5f5" },
	},
	{
		id: "dark",
		name: "Dark",
		dark: true,
		swatch: { bg: "#1b1916", panel: "#231f1b", accent: "#e07b54", text: "#ebe6dc" },
	},
	{
		id: "dracula",
		name: "Dracula",
		dark: true,
		swatch: { bg: "#282a36", panel: "#21222c", accent: "#ff79c6", text: "#f8f8f2" },
	},
	{
		id: "harbor",
		name: "Harbor",
		dark: true,
		swatch: { bg: "#1b1b1b", panel: "#242424", accent: "#e75a50", text: "#efebdc" },
	},
	{
		id: "one-dark-pro",
		name: "One Dark Pro",
		dark: true,
		swatch: { bg: "#282c34", panel: "#21252b", accent: "#61afef", text: "#abb2bf" },
	},
	{
		id: "rose-pine",
		name: "Rosé Pine",
		dark: true,
		swatch: { bg: "#191724", panel: "#1f1d2e", accent: "#ebbcba", text: "#e0def4" },
	},
	{
		id: "catppuccin-mocha",
		name: "Catppuccin Mocha",
		dark: true,
		swatch: { bg: "#1e1e2e", panel: "#181825", accent: "#cba6f7", text: "#cdd6f4" },
	},
	{
		id: "gruvbox-dark",
		name: "Gruvbox Dark",
		dark: true,
		swatch: { bg: "#282828", panel: "#1d2021", accent: "#fe8019", text: "#ebdbb2" },
	},
	{
		id: "nord",
		name: "Nord",
		dark: true,
		swatch: { bg: "#2e3440", panel: "#272c36", accent: "#88c0d0", text: "#eceff4" },
	},
	{
		id: "tokyo-night",
		name: "Tokyo Night",
		dark: true,
		swatch: { bg: "#1a1b26", panel: "#16161e", accent: "#7aa2f7", text: "#c0caf5" },
	},
	{
		id: "light",
		name: "Light",
		dark: false,
		swatch: { bg: "#faf9f6", panel: "#f2f0ea", accent: "#b03e22", text: "#2b2823" },
	},
	{
		id: "one-light",
		name: "One Light",
		dark: false,
		swatch: { bg: "#fafafa", panel: "#f0f0f0", accent: "#2f65d9", text: "#383a42" },
	},
	{
		id: "catppuccin-latte",
		name: "Catppuccin Latte",
		dark: false,
		swatch: { bg: "#eff1f5", panel: "#e6e9ef", accent: "#1e66f5", text: "#4c4f69" },
	},
	{
		id: "rose-pine-dawn",
		name: "Rosé Pine Dawn",
		dark: false,
		swatch: { bg: "#faf4ed", panel: "#fffaf3", accent: "#286983", text: "#575279" },
	},
];

export const DEFAULT_THEME: ThemeDef["id"] = "ompws";
const SYSTEM_DARK_THEME = "ompws";
const SYSTEM_LIGHT_THEME = "light";

export const FONT_SIZES: { id: FontSize; name: string }[] = [
	{ id: "sm", name: "小" },
	{ id: "md", name: "标准" },
	{ id: "lg", name: "大" },
	{ id: "xl", name: "特大" },
];

export const UI_SCALES: { id: UiScale; name: string }[] = [
	{ id: "compact", name: "紧凑" },
	{ id: "standard", name: "标准" },
	{ id: "comfortable", name: "宽松" },
	{ id: "large", name: "大" },
];

const KEYS = {
	theme: "ompws:theme",
	fontSize: "ompws:font-size",
	uiScale: "ompws:ui-scale",
} as const;

const VALID_FONT_SIZES = new Set<string>(FONT_SIZES.map((f) => f.id));
const VALID_UI_SCALES = new Set<string>(UI_SCALES.map((s) => s.id));

function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* storage unavailable */
	}
}

let themeChoice: ThemeChoice = DEFAULT_THEME;
let fontSize: FontSize = "md";
let uiScale: UiScale = "standard";

/** The resolved concrete theme id when choice is "system". */
export function resolvedThemeId(choice: ThemeChoice = themeChoice): string {
	if (choice !== "system") return choice;
	try {
		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? SYSTEM_DARK_THEME
			: SYSTEM_LIGHT_THEME;
	} catch {
		return SYSTEM_DARK_THEME;
	}
}

export function getThemeChoice(): ThemeChoice {
	return themeChoice;
}

export function getFontSize(): FontSize {
	return fontSize;
}

export function getUiScale(): UiScale {
	return uiScale;
}

function apply(): void {
	if (typeof document === "undefined") return;
	const id = resolvedThemeId();
	const def = THEMES.find((t) => t.id === id) ?? THEMES[0];
	const root = document.documentElement;
	root.dataset.theme = def.id;
	root.dataset.mode = def.dark ? "dark" : "light";
	root.dataset.fontSize = fontSize;
	root.dataset.uiScale = uiScale;
}

const CHANGE_EVENT = "ompws:theme-change";

function emitChange(): void {
	try {
		window.dispatchEvent(new Event(CHANGE_EVENT));
	} catch {
		/* non-DOM environment */
	}
}

function subscribe(callback: () => void): () => void {
	window.addEventListener(CHANGE_EVENT, callback);
	window.addEventListener("storage", callback);
	return () => {
		window.removeEventListener(CHANGE_EVENT, callback);
		window.removeEventListener("storage", callback);
	};
}

/**
 * Apply the persisted choices to <html> and follow system light/dark while
 * the choice is "system". Called once from main.tsx before first render so
 * the initial paint already has the right palette.
 */
export function initTheme(): void {
	const storedTheme = readStorage(KEYS.theme);
	if (storedTheme === "system" || THEMES.some((t) => t.id === storedTheme)) {
		themeChoice = storedTheme as ThemeChoice;
	}
	const storedFont = readStorage(KEYS.fontSize);
	if (storedFont && VALID_FONT_SIZES.has(storedFont)) fontSize = storedFont as FontSize;
	const storedScale = readStorage(KEYS.uiScale);
	if (storedScale && VALID_UI_SCALES.has(storedScale)) uiScale = storedScale as UiScale;

	apply();

	try {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		mq.addEventListener("change", () => {
			if (themeChoice === "system") {
				apply();
				emitChange();
			}
		});
	} catch {
		/* matchMedia unavailable */
	}
}

export function setTheme(choice: ThemeChoice): void {
	themeChoice = choice;
	writeStorage(KEYS.theme, choice);
	apply();
	emitChange();
}

export function setFontSize(size: FontSize): void {
	fontSize = size;
	writeStorage(KEYS.fontSize, size);
	apply();
	emitChange();
}

export function setUiScale(scale: UiScale): void {
	uiScale = scale;
	writeStorage(KEYS.uiScale, scale);
	apply();
	emitChange();
}

function useThemeSync<T>(get: () => T): T {
	return useSyncExternalStore(subscribe, get, get);
}

/** Reactive theme choice ("system" included), for pickers. */
export function useThemeChoice(): ThemeChoice {
	return useThemeSync(getThemeChoice);
}

/** Reactive resolved theme id, for UI that needs the concrete theme. */
export function useResolvedThemeId(): string {
	return useThemeSync(() => resolvedThemeId());
}

export function useFontSize(): FontSize {
	return useThemeSync(getFontSize);
}

export function useUiScale(): UiScale {
	return useThemeSync(getUiScale);
}
