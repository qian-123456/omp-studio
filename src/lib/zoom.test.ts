import { beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_ZOOM,
	MAX_ZOOM,
	MIN_ZOOM,
	ZOOM_STEP,
	ZOOM_STORAGE_KEY,
	applyZoom,
	readStoredZoom,
} from "./zoom";

describe("zoom utilities", () => {
	let store: Record<string, string> = {};

	beforeEach(() => {
		store = {};
		// Mock localStorage
		(globalThis as unknown as { localStorage: Storage }).localStorage = {
			getItem: (key: string) => store[key] ?? null,
			setItem: (key: string, value: string) => {
				store[key] = value;
			},
			removeItem: (key: string) => {
				delete store[key];
			},
			clear: () => {
				store = {};
			},
			key: () => null,
			length: 0,
		};

		// Mock document.documentElement.style
		(globalThis as unknown as { document: { documentElement: { style: { zoom: string } } } }).document = {
			documentElement: {
				style: { zoom: "" },
			},
		};
	});

	it("returns DEFAULT_ZOOM when storage is empty", () => {
		expect(readStoredZoom()).toBe(DEFAULT_ZOOM);
	});

	it("reads valid stored zoom within MIN_ZOOM and MAX_ZOOM", () => {
		localStorage.setItem(ZOOM_STORAGE_KEY, "115");
		expect(readStoredZoom()).toBe(115);
	});

	it("falls back to DEFAULT_ZOOM on out-of-range or malformed values", () => {
		localStorage.setItem(ZOOM_STORAGE_KEY, "250");
		expect(readStoredZoom()).toBe(DEFAULT_ZOOM);

		localStorage.setItem(ZOOM_STORAGE_KEY, "10");
		expect(readStoredZoom()).toBe(DEFAULT_ZOOM);

		localStorage.setItem(ZOOM_STORAGE_KEY, "invalid");
		expect(readStoredZoom()).toBe(DEFAULT_ZOOM);
	});

	it("applies zoom to document and localStorage", () => {
		applyZoom(110);
		expect(localStorage.getItem(ZOOM_STORAGE_KEY)).toBe("110");
		expect(document.documentElement.style.zoom).toBe("110%");
	});

	it("has expected step and boundary constants", () => {
		expect(MIN_ZOOM).toBe(80);
		expect(MAX_ZOOM).toBe(140);
		expect(ZOOM_STEP).toBe(5);
		expect(DEFAULT_ZOOM).toBe(100);
	});
});
