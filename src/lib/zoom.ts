/**
 * Shared UI zoom state, persistence, and keyboard shortcuts (Cmd/Ctrl +/-, Cmd/Ctrl 0).
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useState } from "react";

export const ZOOM_STORAGE_KEY = "ompws:ui-zoom";
export const DEFAULT_ZOOM = 100;
export const MIN_ZOOM = 80;
export const MAX_ZOOM = 140;
export const ZOOM_STEP = 5;

export function readStoredZoom(): number {
	try {
		const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
		if (raw) {
			const n = Number.parseInt(raw, 10);
			if (Number.isFinite(n) && n >= MIN_ZOOM && n <= MAX_ZOOM) return n;
		}
	} catch {
		/* ignore */
	}
	return DEFAULT_ZOOM;
}

/**
 * Inside Tauri the zoom is the webview's native page zoom, NOT CSS `zoom` on
 * <html>: with CSS zoom, getBoundingClientRect()/clientX report zoomed viewport
 * px while `position: fixed` left/top/width are multiplied by the zoom again, so
 * every viewport-anchored overlay (popovers, scroll pills, context menus,
 * clamping against innerWidth) lands off by (zoom - 1) × its coordinate and
 * overflows the window edge. Native page zoom keeps one coordinate space.
 * Outside Tauri (plain browser) CSS zoom remains the only option.
 */
export function applyZoom(zoomPercent: number): void {
	try {
		const style = document.documentElement.style as unknown as { zoom: string };
		if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
			// Keep the inline override: it pins <html> to 100% so the density
			// presets' stylesheet `zoom` never stacks on top of native zoom.
			style.zoom = "100%";
			getCurrentWebview()
				.setZoom(zoomPercent / 100)
				.catch(() => {
					/* webview zoom unavailable; stay unzoomed rather than mis-place overlays */
				});
		} else {
			style.zoom = `${zoomPercent}%`;
		}
		localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomPercent));
	} catch {
		/* ignore */
	}
}

export function useZoom() {
	const [zoom, setZoomState] = useState<number>(readStoredZoom);

	const setZoom = useCallback((val: number | ((prev: number) => number)) => {
		setZoomState((prev) => {
			const next = typeof val === "function" ? val(prev) : val;
			const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
			applyZoom(clamped);
			return clamped;
		});
	}, []);

	const zoomIn = useCallback(() => {
		setZoom((prev) => prev + ZOOM_STEP);
	}, [setZoom]);

	const zoomOut = useCallback(() => {
		setZoom((prev) => prev - ZOOM_STEP);
	}, [setZoom]);

	const resetZoom = useCallback(() => {
		setZoom(DEFAULT_ZOOM);
	}, [setZoom]);

	useEffect(() => {
		applyZoom(zoom);
	}, [zoom]);

	// Global keyboard shortcuts: Cmd/Ctrl + '+', Cmd/Ctrl + '-', Cmd/Ctrl + '0'
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey)) return;
			if (e.key === "=" || e.key === "+") {
				e.preventDefault();
				zoomIn();
			} else if (e.key === "-") {
				e.preventDefault();
				zoomOut();
			} else if (e.key === "0") {
				e.preventDefault();
				resetZoom();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [zoomIn, zoomOut, resetZoom]);

	return {
		zoom,
		setZoom,
		zoomIn,
		zoomOut,
		resetZoom,
		minZoom: MIN_ZOOM,
		maxZoom: MAX_ZOOM,
		defaultZoom: DEFAULT_ZOOM,
		zoomStep: ZOOM_STEP,
	};
}
