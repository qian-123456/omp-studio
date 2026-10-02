/**
 * [E] Module-level registry for right-panel command terminals, keyed by tab
 * id. Keeps PTY/xterm instances alive while the panel body is unmounted
 * (right-panel tab switch, panel closed) or the user switches command tabs;
 * the panel re-attaches `term.element` to its new host on mount. A single
 * event bridge fans `terminal:data`/`terminal:exit` out to every entry and
 * mirrors exits into the command terminal store.
 */
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import { onTerminalData, onTerminalExit } from "../../lib/events";
import { termClose } from "../../lib/ipc";
import { useDrawerStore } from "./drawerStore";

export type DrawerTerminalPhase = "opening" | "ready" | "exited" | "error";

export interface DrawerTerminalEntry {
	/** Backend PTY id; null when the spawn itself failed. */
	termId: string | null;
	term: Terminal;
	fit: FitAddon;
	search: SearchAddon;
	observer: ResizeObserver;
	dataSub: { dispose: () => void };
	themeSub?: () => void;
	phase: DrawerTerminalPhase;
	exitCode: number | null;
	error: string | null;
	/** True once the user submitted a line (Enter) in this shell. */
	used?: boolean;
}

export const drawerRegistry = new Map<string, DrawerTerminalEntry>();

export function decodeBase64(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

let bridgeStarted = false;

/** Subscribe once to terminal:data/exit and fan events out to all entries. */
export function ensureDrawerEventBridge(): void {
	if (bridgeStarted) return;
	bridgeStarted = true;
	void onTerminalData((p) => {
		for (const entry of drawerRegistry.values()) {
			if (entry.termId === p.termId) {
				entry.term.write(decodeBase64(p.data));
			}
		}
	}).catch(() => {
		bridgeStarted = false;
	});
	void onTerminalExit((p) => {
		for (const [tabId, entry] of drawerRegistry) {
			if (entry.termId !== p.termId) continue;
			entry.phase = "exited";
			entry.exitCode = p.code;
			useDrawerStore.getState().updateTab(tabId, { status: "exited", exitCode: p.code });
		}
	}).catch(() => {
		bridgeStarted = false;
	});
}

/**
 * Destroy a command terminal: stop observing, close the backend PTY, dispose
 * xterm and remove from the registry. Called when a tab is closed explicitly
 * or reconnected — never on panel unmount (PTYs survive right-panel changes).
 */
export function destroyDrawerTerminal(tabId: string): void {
	const entry = drawerRegistry.get(tabId);
	if (!entry) return;
	entry.observer.disconnect();
	entry.dataSub.dispose();
	entry.themeSub?.();
	if (entry.termId) void termClose(entry.termId).catch(() => {});
	entry.term.dispose();
	drawerRegistry.delete(tabId);
}
