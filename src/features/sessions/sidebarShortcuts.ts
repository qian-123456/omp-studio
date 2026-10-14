/**
 * Global keyboard shortcuts registered at module scope (S6, S19).
 * Active even when SessionSidebar is collapsed or unmounted (Cmd+B).
 */

import { isComposing } from "../../lib/hooks";
import { useUi } from "../../stores/ui";
import { startNewSession } from "./newSession";

/** Checks if the event target is inside an editor, terminal, or component managing its own find (C5) */
function isTargetOwningFind(target: HTMLElement | null): boolean {
	if (!target) return false;
	return Boolean(
		target.closest(
			".cm-editor, .monaco-editor, .xterm, [data-own-find]",
		),
	);
}

/** Window event asking the sidebar to reveal its (collapsed) search row. */
export const SIDEBAR_SEARCH_OPEN_EVENT = "sidebar-search-open";

/** Opens the sidebar if collapsed, reveals the search row, then focuses + selects the input (S19) */
export function focusSidebarSearch(): void {
	useUi.getState().setSidebarOpen(true);
	window.dispatchEvent(new Event(SIDEBAR_SEARCH_OPEN_EVENT));
	const tryFocus = () => {
		const input = document.querySelector<HTMLInputElement>(
			'input[data-sidebar-search="true"]',
		);
		if (input) {
			input.focus();
			input.select();
			return true;
		}
		return false;
	};

	if (!tryFocus()) {
		// Sidebar may be mounting, retry on next frame
		requestAnimationFrame(() => {
			if (!tryFocus()) {
				setTimeout(tryFocus, 50);
			}
		});
	}
}

let unregisterShortcuts: (() => void) | null = null;

export function registerSidebarShortcuts(): void {
	if (unregisterShortcuts || typeof window === "undefined") return;

	const handleKeyDown = (e: KeyboardEvent) => {
		if (isComposing(e)) return;

		const isModifier = e.metaKey || e.ctrlKey;
		if (!isModifier) return;

		const key = e.key.toLowerCase();

		// Cmd+N: start a new session in the active space (works from input/composer too, S6)
		if (key === "n" && !e.shiftKey && !e.altKey) {
			e.preventDefault();
			void startNewSession();
			return;
		}

		// Cmd+Shift+K: quick ask modal (S6)
		if (key === "k" && e.shiftKey && !e.altKey) {
			e.preventDefault();
			useUi.getState().openModal("quick-ask");
			return;
		}

		// Cmd+F: focus and select sidebar search input (S19)
		if (key === "f" && !e.shiftKey && !e.altKey) {
			if (e.defaultPrevented) return;
			const target = e.target as HTMLElement | null;
			if (isTargetOwningFind(target)) return;
			e.preventDefault();
			focusSidebarSearch();
			return;
		}
	};

	window.addEventListener("keydown", handleKeyDown);
	unregisterShortcuts = () => {
		window.removeEventListener("keydown", handleKeyDown);
		unregisterShortcuts = null;
	};
}

// Auto-wire on import
if (typeof window !== "undefined") {
	registerSidebarShortcuts();
}

// Clean up previous registration on Vite HMR
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		unregisterShortcuts?.();
	});
}
