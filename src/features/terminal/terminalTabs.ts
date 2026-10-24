/**
 * [E] Terminal instance tab actions used by RightPanelHeader, which renders
 * each visible terminal as its own Chrome-style tab while the "terminal"
 * panel tab is active. Operates on drawerStore/drawerRegistry only;
 * CommandTerminalPanel mounts xterm hosts for whatever tabs the store holds.
 */
import { confirmDialog } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { destroyDrawerTerminal, drawerRegistry } from "./drawerRegistry";
import { type DrawerTab, useDrawerStore } from "./drawerStore";
export const STATUS_DOT: Record<DrawerTab["status"], string> = {
	opening: "bg-sky-400 animate-pulse",
	ready: "bg-emerald-400",
	exited: "bg-neutral-600",
	error: "bg-red-500",
};

export const STATUS_LABEL: Record<DrawerTab["status"], string> = {
	get opening() { return tNow("terminal.statusOpening"); },
	get ready() { return tNow("terminal.statusReady"); },
	get exited() { return tNow("terminal.statusExited"); },
	get error() { return tNow("terminal.statusError"); },
};

/** Upper bound on visible terminals; each one is a live shell process. */
const MAX_VISIBLE_TERMINALS = 10;

/**
 * Add a tab synchronously so it renders and activates immediately, titled
 * "终端 N" (lowest unused N). Like a browser, "new" always creates a new tab;
 * past MAX_VISIBLE_TERMINALS it refuses and points the user at closing or
 * folding one, so idle shells can't pile up without bound.
 * The cwd is the selected session's when known; otherwise left empty and
 * resolved by the panel while spawning the PTY.
 */
export function addTerminalTab(): string | null {
	const visible = useDrawerStore.getState().tabs.filter((t) => !t.detached);
	if (visible.length >= MAX_VISIBLE_TERMINALS) {
		toast.info(tNow("terminal.maxLimitReached", { max: MAX_VISIBLE_TERMINALS }));
		return null;
	}
	const sessionId = useUi.getState().selectedSessionId;
	const cwd = (sessionId && useSessions.getState().sessions[sessionId]?.cwd) || "";
	const titles = new Set(useDrawerStore.getState().tabs.map((t) => t.title));
	const prefix = tNow("terminal.tabTitlePrefix");
	let n = 1;
	while (titles.has(`${prefix} ${n}`)) n++;
	return useDrawerStore.getState().addTab(cwd, `${prefix} ${n}`);
}

/**
 * Open a terminal tab rooted at an explicit directory (e.g. a worktree), so
 * dev servers run in-place there. Same visible-tab cap as addTerminalTab.
 */
export function addTerminalTabWithCwd(cwd: string, title?: string): string | null {
	const visible = useDrawerStore.getState().tabs.filter((t) => !t.detached);
	if (visible.length >= MAX_VISIBLE_TERMINALS) {
		toast.info(tNow("terminal.maxLimitReached", { max: MAX_VISIBLE_TERMINALS }));
		return null;
	}
	const titles = new Set(useDrawerStore.getState().tabs.map((t) => t.title));
	const base = title?.trim() || tNow("terminal.tabTitlePrefix");
	let label = base;
	for (let n = 2; titles.has(label); n++) label = `${base} ${n}`;
	return useDrawerStore.getState().addTab(cwd, label);
}

/** Fold a terminal into a background service; closes the panel tab when none stay visible. */
export function detachTerminalTab(tabId: string): void {
	drawerRegistry.get(tabId)?.term.element?.remove();
	useDrawerStore.getState().detachTab(tabId);
	if (!useDrawerStore.getState().tabs.some((t) => !t.detached)) {
		useUi.getState().closeRightTab("terminal");
	}
	toast.success(tNow("terminal.detachedToast"));
}

/** Kill a terminal (confirming when it ran something); closes the panel tab with the last one. */
export async function closeTerminalTab(tabId: string): Promise<void> {
	const entry = drawerRegistry.get(tabId);
	if (entry && entry.phase === "ready" && entry.used) {
		const ok = await confirmDialog(tNow("terminal.confirmKillMessage"), {
			danger: true,
			title: tNow("terminal.confirmKillTitle"),
			okLabel: tNow("terminal.confirmKillOk"),
		});
		if (!ok) return;
	}
	destroyDrawerTerminal(tabId);
	const remainingVisible = useDrawerStore
		.getState()
		.tabs.filter((t) => !t.detached && t.id !== tabId).length;
	useDrawerStore.getState().removeTab(tabId);
	if (remainingVisible === 0) useUi.getState().closeRightTab("terminal");
}
