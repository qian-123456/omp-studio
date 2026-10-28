/**
 * The one in-window keyboard dispatcher. Every editable shortcut in registry.ts is
 * resolved here via `matchShortcut` (so Settings ▸ 快捷键 rebinding applies at once)
 * and run from the ACTIONS table.
 *
 * Capture phase is required: the settings overlay stops propagation of every
 * modified key, so ⌘, could never close it from a bubble-phase listener.
 * ⌘W/Esc stay in lib/nativeShortcuts.ts, zoom keys in lib/zoom.ts (non-editable).
 */
import { isComposing } from "../../lib/hooks";
import { CENTER_WITHOUT_RIGHT_PANEL } from "../../components/CenterHeader";
import { useUi, type CenterView } from "../../stores/ui";
import { useSearchDialog } from "../sessions/search/searchStore";
import { openThreadFind } from "../chat/find/openThreadFind";
import { startNewSession } from "../sessions/newSession";
import { reopenArchivedSession } from "../sessions/archiveUndo";
import { focusSidebarSearch } from "../sessions/sidebarShortcuts";
import { navBack, navForward, selectAdjacentSession, effectiveCenterViewOf } from "./actions/navigation";
import { matchShortcut } from "./bindingsStore";
import type { ShortcutId } from "./registry";

const MODAL_OPEN = '[data-layer="modal"], [aria-modal="true"]';
/** Editors/terminals run their own ⌘F. */
const OWN_FIND_EDITORS = ".cm-editor, .monaco-editor, .xterm";
/** The thread find bar marks itself `data-own-find`; ⌘F inside it re-focuses it. */
const THREAD_FIND_BAR = "[data-own-find]";

/** Allowed while the settings overlay is open. */
const SETTINGS_OPEN_ALLOWED: Partial<Record<ShortcutId, true>> = {
	"settings.toggle": true,
	"shortcuts.show": true,
};
/** Still run under a modal layer (as the old ⌘B/⌘J/⌘`/⌘N/⌘, handlers did). */
const MODAL_EXEMPT: Partial<Record<ShortcutId, true>> = {
	"settings.toggle": true,
	"session.new": true,
	"panel.sidebar": true,
	"panel.right": true,
	"panel.terminal": true,
};
/** Search shortcuts keep working while the session-search dialog (its own modal) is open. */
const SEARCH_OWNED: Partial<Record<ShortcutId, true>> = {
	"search.sessions": true,
	"find.thread": true,
};

/**
 * Events this dispatcher handled. Downstream listeners (the composer's send
 * handler, editors, …) check it so one keypress never runs two actions: e.g.
 * a panel toggle bound to ⌘Enter must not also submit the draft.
 */
const consumed = new WeakSet<Event>();

export function isShortcutConsumed(e: Event): boolean {
	return consumed.has(e);
}

function togglePage(page: CenterView): boolean {
	const ui = useUi.getState();
	if (ui.centerView === page) ui.returnToSession();
	else ui.setCenter(page);
	return true;
}

function findThread(e: KeyboardEvent): boolean {
	const target = e.target instanceof Element ? e.target : null;
	if (target?.closest(OWN_FIND_EDITORS)) return false;
	if (target?.closest(THREAD_FIND_BAR)) return openThreadFind();
	return openThreadFind() || (focusSidebarSearch(), true);
}

const ACTIONS: Record<ShortcutId, ((e: KeyboardEvent) => boolean) | undefined> = {
	"settings.toggle": () => {
		const ui = useUi.getState();
		if (ui.centerView === "settings") ui.closeSettings();
		else ui.openSettings();
		return true;
	},
	"shortcuts.show": () => {
		useUi.getState().openSettings("shortcuts");
		return true;
	},
	"search.sessions": () => (focusSidebarSearch(), true),
	"nav.back": () => navBack(),
	"nav.forward": () => navForward(),
	"view.inbox": () => togglePage("inbox"),
	"view.schedules": () => togglePage("schedules"),
	"view.skills": () => togglePage("skills"),
	"session.new": () => {
		void startNewSession();
		return true;
	},
	"session.prev": () => selectAdjacentSession(-1),
	"session.next": () => selectAdjacentSession(1),
	"session.reopen": () => {
		void reopenArchivedSession();
		return true;
	},
	"panel.sidebar": () => {
		useUi.getState().toggleSidebar();
		return true;
	},
	"panel.right": () => {
		const ui = useUi.getState();
		if (CENTER_WITHOUT_RIGHT_PANEL.has(effectiveCenterViewOf(ui.centerView, ui.previousCenterView))) return false;
		ui.toggleRight();
		return true;
	},
	"panel.terminal": () => {
		const ui = useUi.getState();
		if (ui.rightOpen && ui.rightTab === "terminal") ui.setRightOpen(false);
		else ui.setRightTab("terminal");
		return true;
	},
	"find.thread": findThread,
	// Fixed entries are never matched (matchShortcut only returns editable ones).
	"tab.close": undefined,
	"zoom.in": undefined,
	"zoom.out": undefined,
	"zoom.reset": undefined,
};

/** Resolve and run the shortcut `e` triggers. Returns true when an action handled it. */
export function dispatchShortcut(e: KeyboardEvent): boolean {
	if (e.isComposing || isComposing({ nativeEvent: e, key: e.key })) return false;
	// Settings ▸ 快捷键 is recording a combo: it must not fire an already-bound action.
	if (document.querySelector("[data-shortcut-recording]")) return false;
	const id = matchShortcut(e);
	if (!id) return false;
	const action = ACTIONS[id];
	if (!action) return false;
	const searchDialogOpen = useSearchDialog.getState().open;
	if (useUi.getState().centerView === "settings") {
		if (!SETTINGS_OPEN_ALLOWED[id]) return false;
	} else if (!MODAL_EXEMPT[id] && !(searchDialogOpen && SEARCH_OWNED[id]) && document.querySelector(MODAL_OPEN)) {
		// Session search is itself a modal; ⌘K/⌘F inside it must still re-focus its input.
		return false;
	}
	return action(e);
}

/** Mount once. Returns the uninstaller. */
export function installShortcutDispatcher(): () => void {
	const onKeyDown = (e: KeyboardEvent) => {
		if (!dispatchShortcut(e)) return;
		consumed.add(e);
		// `preventDefault` alone leaves the event reaching focused controls'
		// own handlers (React onKeyDown, xterm, CodeMirror) that run on bubble.
		e.preventDefault();
		e.stopImmediatePropagation();
	};
	window.addEventListener("keydown", onKeyDown, true);
	return () => window.removeEventListener("keydown", onKeyDown, true);
}
