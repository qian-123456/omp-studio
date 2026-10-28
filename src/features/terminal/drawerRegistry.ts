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

type EarlyEvent = { data: string } | { code: number | null };
const earlyEvents = new Map<string, EarlyEvent[]>();
let pendingStarts = 0;
let bridgeReady: Promise<void> | undefined;

function deliver(tabId: string, entry: DrawerTerminalEntry, event: EarlyEvent): void {
    if ("data" in event) entry.term.write(decodeBase64(event.data));
    else {
        entry.phase = "exited";
        entry.exitCode = event.code;
        useDrawerStore.getState().updateTab(tabId, { status: "exited", exitCode: event.code });
    }
}

function receive(termId: string, event: EarlyEvent): void {
    for (const [tabId, entry] of drawerRegistry) {
        if (entry.termId !== termId) continue;
        deliver(tabId, entry, event);
        return;
    }
    // Only retain unmatched events during a start handshake, never indefinitely.
    if (pendingStarts > 0) {
        const queued = earlyEvents.get(termId) ?? [];
        queued.push(event);
        earlyEvents.set(termId, queued);
    }
}

/** Await both subscriptions before spawning so even immediate output is observed. */
export function ensureDrawerEventBridge(): Promise<void> {
    if (!bridgeReady) {
        bridgeReady = (async () => {
            const subscriptions = await Promise.allSettled([
                onTerminalData((p) => receive(p.termId, { data: p.data })),
                onTerminalExit((p) => receive(p.termId, { code: p.code })),
            ]);
            const failure = subscriptions.find((s) => s.status === "rejected");
            if (failure?.status === "rejected") {
                for (const s of subscriptions) if (s.status === "fulfilled") s.value();
                bridgeReady = undefined;
                throw failure.reason;
            }
        })();
    }
    return bridgeReady;
}

/** Complete the response/event handshake without overwriting an early exit. */
export async function startDrawerTerminal(tabId: string, entry: DrawerTerminalEntry, open: () => Promise<string>): Promise<void> {
    await ensureDrawerEventBridge();
    if (drawerRegistry.get(tabId) !== entry) return;
    pendingStarts++;
    try {
        const id = await open();
        if (drawerRegistry.get(tabId) !== entry) {
            void termClose(id).catch(() => {});
            earlyEvents.delete(id);
            return;
        }
        entry.termId = id;
        entry.phase = "ready";
        useDrawerStore.getState().updateTab(tabId, { status: "ready", exitCode: null });
        for (const event of earlyEvents.get(id) ?? []) deliver(tabId, entry, event);
        earlyEvents.delete(id);
    } finally {
        if (--pendingStarts === 0) earlyEvents.clear();
    }
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
