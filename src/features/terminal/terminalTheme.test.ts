// @vitest-environment jsdom
import type { ITheme } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
	XTERM_DARK,
	XTERM_LIGHT,
	bindXtermTheme,
	isDarkTheme,
	resolveXtermTheme,
} from "./terminalTheme";

/**
 * Standard WCAG 2.1 relative luminance calculation.
 */
function srgbToLinear(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
	const clean = hex.replace("#", "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	return (
		0.2126 * srgbToLinear(r) +
		0.7152 * srgbToLinear(g) +
		0.0722 * srgbToLinear(b)
	);
}

function contrastRatio(hex1: string, hex2: string): number {
	const l1 = relativeLuminance(hex1);
	const l2 = relativeLuminance(hex2);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

describe("terminalTheme", () => {
	describe("isDarkTheme", () => {
		it("detects light and dark from dataset.mode", () => {
			const el = document.createElement("html");
			el.dataset.mode = "light";
			expect(isDarkTheme(el)).toBe(false);

			el.dataset.mode = "dark";
			expect(isDarkTheme(el)).toBe(true);
		});

		it("falls back to theme id when mode is missing", () => {
			const el = document.createElement("html");
			el.dataset.theme = "github-light";
			expect(isDarkTheme(el)).toBe(false);

			el.dataset.theme = "sakura";
			expect(isDarkTheme(el)).toBe(false);

			el.dataset.theme = "catppuccin-latte";
			expect(isDarkTheme(el)).toBe(false);

			el.dataset.theme = "ompws";
			expect(isDarkTheme(el)).toBe(true);

			el.dataset.theme = "dracula";
			expect(isDarkTheme(el)).toBe(true);
		});

		it("falls back to .dark class when dataset is empty", () => {
			const el = document.createElement("html");
			el.classList.add("dark");
			expect(isDarkTheme(el)).toBe(true);

			el.classList.remove("dark");
			// In jsdom without matchMedia dark match, defaults to true or media query
			window.matchMedia = vi.fn().mockImplementation((query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			}));
			expect(isDarkTheme(el)).toBe(false);
		});
	});

	describe("resolveXtermTheme", () => {
		it("returns pure default palettes when no CSS vars are supplied", () => {
			const dark = resolveXtermTheme({ isDark: true });
			expect(dark.background).toBe(XTERM_DARK.background);
			expect(dark.foreground).toBe(XTERM_DARK.foreground);

			const light = resolveXtermTheme({ isDark: false });
			expect(light.background).toBe(XTERM_LIGHT.background);
			expect(light.foreground).toBe(XTERM_LIGHT.foreground);
		});

		it("adopts CSS variables from the app chrome", () => {
			const vars: Record<string, string> = {
				"--bg-panel": "#f6f8fa",
				"--text": "#24292f",
				"--accent": "#0969da",
			};
			const reader = {
				getPropertyValue: (name: string) => vars[name] || "",
			};

			const theme = resolveXtermTheme({ isDark: false, styles: reader });
			expect(theme.background).toBe("#f6f8fa");
			expect(theme.foreground).toBe("#24292f");
			expect(theme.cursor).toBe("#0969da");
		});
	});

	describe("ANSI color contrast on light background", () => {
		const lightBackgrounds = ["#ffffff", "#fbfbfd", "#f2f0ea", "#f6f8fa"];

		it("guarantees white and brightWhite are readable on white/light background", () => {
			for (const bg of lightBackgrounds) {
				// Classic failure: ANSI white or brightWhite printed on a white terminal
				const whiteRatio = contrastRatio(bg, XTERM_LIGHT.white!);
				const brightWhiteRatio = contrastRatio(bg, XTERM_LIGHT.brightWhite!);

				expect(whiteRatio).toBeGreaterThanOrEqual(4.5);
				expect(brightWhiteRatio).toBeGreaterThanOrEqual(4.5);
			}
		});

		it("guarantees yellow and brightYellow are readable on white/light background", () => {
			for (const bg of lightBackgrounds) {
				// Classic failure: bright yellow printed on white background
				const yellowRatio = contrastRatio(bg, XTERM_LIGHT.yellow!);
				const brightYellowRatio = contrastRatio(bg, XTERM_LIGHT.brightYellow!);

				expect(yellowRatio).toBeGreaterThanOrEqual(4.5);
				expect(brightYellowRatio).toBeGreaterThanOrEqual(4.5);
			}
		});

		it("guarantees all 16 ANSI colors exceed readable contrast on light background", () => {
			const ansiKeys = [
				"black",
				"red",
				"green",
				"yellow",
				"blue",
				"magenta",
				"cyan",
				"white",
				"brightBlack",
				"brightRed",
				"brightGreen",
				"brightYellow",
				"brightBlue",
				"brightMagenta",
				"brightCyan",
				"brightWhite",
			] as const;

			const bg = "#fbfbfd";
			for (const key of ansiKeys) {
				const color = XTERM_LIGHT[key]!;
				const ratio = contrastRatio(bg, color);
				// Every ANSI color must maintain at least 3.9:1 contrast
				expect(
					ratio,
					`Color ${key} (${color}) failed contrast on ${bg} with ratio ${ratio}`,
				).toBeGreaterThanOrEqual(3.9);
			}
		});
	});

	describe("bindXtermTheme", () => {
		it("updates theme live on existing terminal without recreating it", () => {
			document.documentElement.dataset.mode = "dark";
			document.documentElement.dataset.theme = "ompws";

			const fakeTerm = {
				options: {
					theme: undefined as ITheme | undefined,
				},
			};

			const unbind = bindXtermTheme(fakeTerm);
			expect(fakeTerm.options.theme?.background).toBe(XTERM_DARK.background);

			// Switch to light mode via dataset.mode
			document.documentElement.dataset.mode = "light";
			document.documentElement.dataset.theme = "github-light";
			window.dispatchEvent(new Event("ompws:theme-change"));

			expect(fakeTerm.options.theme?.foreground).toBe(XTERM_LIGHT.foreground);
			expect(fakeTerm.options.theme?.background).toBe(XTERM_LIGHT.background);

			unbind();

			// Changes after unbind do not affect fakeTerm
			document.documentElement.dataset.mode = "dark";
			window.dispatchEvent(new Event("ompws:theme-change"));
			expect(fakeTerm.options.theme?.background).toBe(XTERM_LIGHT.background);
		});
	});
});
