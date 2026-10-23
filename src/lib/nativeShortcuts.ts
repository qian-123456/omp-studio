/**
 * Native macOS key handling that must be decided by the webview:
 *
 *  - Esc: WKWebView forwards an Esc keydown that no page handler called
 *    preventDefault() on to the responder chain (cancelOperation:), where the
 *    NSWindow exits native fullscreen. Closing a popover with Esc therefore
 *    also left fullscreen. `installEscapeGuard` cancels the default action of
 *    every Esc keydown; handlers signal "I consumed this Esc" through
 *    `claimEscape` / `isEscapeClaimed` (escapeClaim.ts).
 *  - Cmd+W: the native "Close Window" menu item is replaced by a custom item
 *    (src-tauri/src/lib.rs) that emits `native:close-tab`; the decision of
 *    what to close lives here (`resolveCloseTarget`).
 */
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CENTER_WITHOUT_RIGHT_PANEL } from "../components/CenterHeader";
import { useFilePreview } from "../stores/filePreview";
import { resolveActiveTab, useSideChatView } from "../features/sidechat/viewStore";
import { useUi } from "../stores/ui";

export type CloseTarget = "layer" | "tab" | "hide";

/** Floating surfaces that Esc dismisses; hover cards, toasts and scroll pills are not closable. */
export const CLOSABLE_LAYER_SELECTOR =
	'[data-layer="drawer"], [data-layer="popover"], [data-layer="menu"], [data-layer="modal"], [data-layer="lightbox"], [aria-modal="true"]';

/** What Cmd+W acts on: an open floating layer first, then the active right-panel tab, else hide the window. */
export function resolveCloseTarget(s: {
	layerOpen: boolean;
	rightOpen: boolean;
	rightTab: string | null;
}): CloseTarget {
	if (s.layerOpen) return "layer";
	if (s.rightOpen && s.rightTab) return "tab";
	return "hide";
}

function onEscapeKeydown(e: KeyboardEvent): void {
	if (e.key !== "Escape" || e.isComposing || e.keyCode === 229) return;
	e.preventDefault();
}

/** Never let an unclaimed Esc reach the NSWindow (it would exit fullscreen). Returns an uninstaller. */
export function installEscapeGuard(): () => void {
	window.addEventListener("keydown", onEscapeKeydown, true);
	return () => window.removeEventListener("keydown", onEscapeKeydown, true);
}

/** One Cmd+W press must act once: a duplicate native event must not fall through to "hide" after the tab just closed. */
const CLOSE_DEBOUNCE_MS = 250;
let lastCloseAt = 0;

function closeActive(): void {
	const now = Date.now();
	if (now - lastCloseAt < CLOSE_DEBOUNCE_MS) return;
	lastCloseAt = now;
	const ui = useUi.getState();
	const { rightTab, closeRightTab } = ui;
	// Mirrors App's `rightVisible`: full-width views hide the dock, so there is no tab to close.
	const view = ui.centerView === "settings" ? ui.previousCenterView ?? "home" : ui.centerView;
	const rightOpen = ui.rightOpen && !CENTER_WITHOUT_RIGHT_PANEL.has(view);
	const target = resolveCloseTarget({
		layerOpen: document.querySelector(CLOSABLE_LAYER_SELECTOR) !== null,
		rightOpen,
		rightTab,
	});
	if (target === "layer") {
		const host = document.activeElement ?? document.body;
		host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
	} else if (target === "tab" && rightTab) {
		// Instance groups close one instance (the group goes with the last one);
		// closing the whole group would leave its instances to resurrect the tab.
		if (rightTab === "files") {
			const { activePath, tabs, closeFile } = useFilePreview.getState();
			const path = activePath ?? tabs[0]?.path;
			if (path) closeFile(path);
			else closeRightTab("files");
		} else if (rightTab === "sidechat" && ui.selectedSessionId) {
			const view = useSideChatView.getState();
			const tabs = view.openTabs[ui.selectedSessionId];
			const id = resolveActiveTab(tabs, view.openChild[ui.selectedSessionId]);
			if (id) view.closeTab(ui.selectedSessionId, id);
			else closeRightTab("sidechat");
		} else {
			closeRightTab(rightTab);
		}
	} else {
		void getCurrentWindow().hide();
	}
}

/** Mount once: Esc guard + Cmd+W (native menu event). Returns a cleanup. */
export function installNativeShortcuts(): () => void {
	const uninstallEsc = installEscapeGuard();
	const unlisten = listen("native:close-tab", closeActive);
	return () => {
		uninstallEsc();
		void unlisten.then((f) => f());
	};
}
