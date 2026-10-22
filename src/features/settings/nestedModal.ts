import { useEffect, useRef } from "react";
import { claimEscape, isEscapeClaimed } from "../../lib/escapeClaim";
import { isComposing } from "../../lib/hooks";

/**
 * True while a dialog or floating layer other than the settings window itself
 * is open. Settings-level Esc handlers must yield to it: the nested surface
 * owns Esc (and its own dirty-confirm), so one press never closes both.
 */
const NESTED_LAYER = '[data-layer]:not([data-layer="toast"], [data-layer="pill"], [data-layer="hovercard"], [role="status"])';

export function nestedModalOpen(): boolean {
	if (typeof document === "undefined") return false;
	for (const m of document.querySelectorAll('[aria-modal="true"]')) {
		// The settings dialog itself contains its own title; anything else is nested.
		if (!m.querySelector("#settings-dialog-title")) return true;
	}
	return document.querySelector(NESTED_LAYER) !== null;
}

/**
 * Settings-level Esc: leave settings unless the press belongs to something nested.
 * Independent of listener order: if a nested surface ran first it claimed the
 * event (and may already have unmounted, so `nestedModalOpen` alone would miss
 * it); if settings runs first the nested surface is still in the DOM.
 */
export function useSettingsEscape(onEscape: () => void): void {
	const latest = useRef(onEscape);
	latest.current = onEscape;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || isComposing(e)) return;
			if (isEscapeClaimed(e) || nestedModalOpen()) return;
			claimEscape(e);
			latest.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}
