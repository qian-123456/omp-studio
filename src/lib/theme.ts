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
		id: "kanagawa",
		name: "Kanagawa",
		dark: true,
		swatch: { bg: "#1f1f28", panel: "#16161d", accent: "#7aa89f", text: "#dcd7ba" },
	},
	{
		id: "everforest",
		name: "Everforest",
		dark: true,
		swatch: { bg: "#2b3339", panel: "#1e2327", accent: "#a7c080", text: "#d3c6aa" },
	},
	{
		id: "night-owl",
		name: "Night Owl",
		dark: true,
		swatch: { bg: "#011627", panel: "#01111d", accent: "#c792ea", text: "#d6deeb" },
	},
	{
		id: "ayu-dark",
		name: "Ayu Dark",
		dark: true,
		swatch: { bg: "#0b0e14", panel: "#0d1017", accent: "#ff9940", text: "#bfbdb6" },
	},
	{
		id: "solarized-dark",
		name: "Solarized Dark",
		dark: true,
		swatch: { bg: "#002b36", panel: "#073642", accent: "#2aa198", text: "#93a1a1" },
	},
	{
		id: "sakura",
		name: "樱花",
		dark: false,
		swatch: { bg: "#fdf4f6", panel: "#f9eaee", accent: "#d6336c", text: "#472b36" },
	},
	{
		id: "glacier",
		name: "冰川",
		dark: false,
		swatch: { bg: "#f6fafc", panel: "#ecf3f8", accent: "#0d94bd", text: "#1f3a4d" },
	},
	{
		id: "lavender",
		name: "薰衣草",
		dark: false,
		swatch: { bg: "#f8f6fc", panel: "#f0ecf8", accent: "#7c5cd6", text: "#38304f" },
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
	{
		id: "solarized-light",
		name: "Solarized Light",
		dark: false,
		swatch: { bg: "#fdf6e3", panel: "#eee8d5", accent: "#268bd2", text: "#4f5d66" },
	},
	{
		id: "github-light",
		name: "GitHub Light",
		dark: false,
		swatch: { bg: "#ffffff", panel: "#f6f8fa", accent: "#0969da", text: "#25292e" },
	},
	{
		id: "nord-light",
		name: "Nord Light",
		dark: false,
		swatch: { bg: "#eceff4", panel: "#e5e9f0", accent: "#5e81ac", text: "#2e3440" },
	},
	{
		id: "tokyo-night-light",
		name: "Tokyo Night Light",
		dark: false,
		swatch: { bg: "#e1e2e7", panel: "#d4d6e4", accent: "#2e7de9", text: "#3760bf" },
	},
	{
		id: "ayu-light",
		name: "Ayu Light",
		dark: false,
		swatch: { bg: "#fafafa", panel: "#f3f4f6", accent: "#f0821e", text: "#5c6166" },
	},
	{
		id: "gruvbox-light",
		name: "Gruvbox Light",
		dark: false,
		swatch: { bg: "#fbf1c7", panel: "#ebdbb2", accent: "#d65d0e", text: "#3c3836" },
	},
	{
		id: "everforest-light",
		name: "Everforest Light",
		dark: false,
		swatch: { bg: "#fdf6e3", panel: "#f4f0d5", accent: "#8da101", text: "#5c6a72" },
	},
];

export const DEFAULT_THEME: ThemeDef["id"] = "ompws";

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
	systemDark: "ompws:system-dark-theme",
	systemLight: "ompws:system-light-theme",
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
/** Themes used while the choice is "system": one for OS dark, one for OS light. */
let systemDarkTheme: string = DEFAULT_THEME;
let systemLightTheme: string = "light";

export function themeById(id: string): ThemeDef | undefined {
	return THEMES.find((t) => t.id === id);
}

/** The resolved concrete theme id when choice is "system". */
export function resolvedThemeId(choice: ThemeChoice = themeChoice): string {
	if (choice !== "system") return choice;
	try {
		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? systemDarkTheme
			: systemLightTheme;
	} catch {
		return systemDarkTheme;
	}
}

export function getThemeChoice(): ThemeChoice {
	return themeChoice;
}

export function getSystemDarkTheme(): string {
	return systemDarkTheme;
}

export function getSystemLightTheme(): string {
	return systemLightTheme;
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
	const storedDark = readStorage(KEYS.systemDark);
	if (themeById(storedDark ?? "")?.dark) systemDarkTheme = storedDark as string;
	const storedLight = readStorage(KEYS.systemLight);
	if (themeById(storedLight ?? "") && !themeById(storedLight ?? "")?.dark) {
		systemLightTheme = storedLight as string;
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

/** Theme used while following the system in OS dark mode. */
export function setSystemDarkTheme(id: string): void {
	const def = themeById(id);
	if (!def || !def.dark || id === systemDarkTheme) return;
	systemDarkTheme = id;
	writeStorage(KEYS.systemDark, id);
	apply();
	emitChange();
}

/** Theme used while following the system in OS light mode. */
export function setSystemLightTheme(id: string): void {
	const def = themeById(id);
	if (!def || def.dark || id === systemLightTheme) return;
	systemLightTheme = id;
	writeStorage(KEYS.systemLight, id);
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

export function useSystemDarkTheme(): string {
	return useThemeSync(getSystemDarkTheme);
}

export function useSystemLightTheme(): string {
	return useThemeSync(getSystemLightTheme);
}

export function useFontSize(): FontSize {
	return useThemeSync(getFontSize);
}

export function useUiScale(): UiScale {
	return useThemeSync(getUiScale);
}
