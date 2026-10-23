import { beforeEach, describe, expect, it } from "vitest";

const mem = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
	key: (i: number) => Array.from(mem.keys())[i] ?? null,
	length: 0,
} as unknown as Storage;

import {
	DEFAULT_WALLPAPER_STATE,
	addCustomWallpaper,
	getCustomWallpapers,
	getWallpaperState,
	removeCustomWallpaper,
	setWallpaper,
	type CustomWallpaperItem,
} from "./theme";

describe("theme wallpaper state", () => {
	beforeEach(() => {
		localStorage.clear();
		setWallpaper({ ...DEFAULT_WALLPAPER_STATE });
		for (const w of getCustomWallpapers()) {
			removeCustomWallpaper(w.id);
		}
	});

	it("initializes with default wallpaper state", () => {
		const state = getWallpaperState();
		expect(state.enabled).toBe(false);
		expect(state.id).toBe("none");
		expect(state.effect).toBe("clear");
	});

	it("updates and persists wallpaper state", () => {
		setWallpaper({
			enabled: true,
			id: "preset-lakewood",
			url: "/wallpapers/misty-forest.jpg",
			effect: "overlay",
			accentColor: "#146b27",
			variant: "rich",
		});

		const state = getWallpaperState();
		expect(state.enabled).toBe(true);
		expect(state.id).toBe("preset-lakewood");
		expect(state.effect).toBe("overlay");
		expect(state.accentColor).toBe("#146b27");
		expect(state.variant).toBe("rich");
		expect(state.appearance).toBe("dark");
	});

	it("updates appearance and switches to light when requested", () => {
		setWallpaper({
			enabled: true,
			id: "preset-palm-shore",
			url: "/wallpapers/palm-shore.jpg",
			appearance: "light",
		});
		const state = getWallpaperState();
		expect(state.enabled).toBe(true);
		expect(state.appearance).toBe("light");
	});
	it("manages custom wallpapers and resets active wallpaper on delete", () => {
		const item: CustomWallpaperItem = {
			id: "custom-test-1",
			name: "Test Wallpaper",
			url: "blob:http://localhost/test",
			palette: {
				mono: "#555555",
				neutral: "#777777",
				soft: "#336699",
				rich: "#0088ff",
			},
			appearance: "light",
			createdAt: Date.now(),
		};

		addCustomWallpaper(item);
		expect(getCustomWallpapers()).toHaveLength(1);
		expect(getCustomWallpapers()[0].id).toBe("custom-test-1");

		setWallpaper({
			enabled: true,
			id: item.id,
			url: item.url,
			accentColor: item.palette.rich,
			variant: "rich",
		});
		expect(getWallpaperState().enabled).toBe(true);

		removeCustomWallpaper(item.id);
		expect(getCustomWallpapers()).toHaveLength(0);
		// Deleting active wallpaper should reset to default
		expect(getWallpaperState().enabled).toBe(false);
		expect(getWallpaperState().id).toBe("none");
	});
});
