/**
 * Navigation shortcut actions. Pure store logic, callable without React.
 * Each returns true when it did something, false when not applicable.
 */
import { useSessions } from "../../../stores/sessions";
import { type CenterView, useUi } from "../../../stores/ui";
import { useSidebarStore } from "../../sessions/sidebarStore";
import { switchSpaceMode } from "../../sessions/switchMode";
import { getVisibleSessionIds } from "../../sessions/visibleRows";

/** Parent session of the current (or last) session, for side chats. */
function currentParentId(): string | null {
	const { selectedSessionId, lastSessionId } = useUi.getState();
	const id = selectedSessionId || lastSessionId;
	if (!id) return null;
	const session = useSessions.getState().sessions[id] as unknown as
		| (Record<string, unknown> & { parentId?: string | null })
		| undefined;
	if (!session) return null;
	return (
		session.parentId ??
		(typeof session.parentSessionId === "string" ? session.parentSessionId : null)
	);
}

/**
 * The view actually shown underneath: settings is an overlay, so it resolves to
 * the view it was opened over. App.tsx may reuse this instead of its own copy
 * (pass its `lastNonSettings` fallback).
 */
export function effectiveCenterViewOf(
	centerView: CenterView,
	previousCenterView: CenterView | null,
	lastNonSettings: CenterView = "home",
): CenterView {
	return centerView === "settings" ? (previousCenterView ?? lastNonSettings) : centerView;
}

interface Location {
	view: CenterView;
	sessionId: string | null;
	docPath: string | null;
}

function here(): Location {
	const s = useUi.getState();
	return { view: s.centerView, sessionId: s.selectedSessionId, docPath: s.docPath };
}

let forwardTarget: Location | null = null;
/** True while navBack/navForward mutate the ui store (their changes keep the forward target). */
let internal = false;

// Any navigation not caused by back/forward drops the forward target.
useUi.subscribe((s, prev) => {
	if (internal || !forwardTarget) return;
	if (
		s.centerView !== prev.centerView ||
		s.selectedSessionId !== prev.selectedSessionId ||
		s.docPath !== prev.docPath
	) {
		forwardTarget = null;
	}
});

function withInternal(fn: () => void): void {
	internal = true;
	try {
		fn();
	} finally {
		internal = false;
	}
}

/**
 * ⌘[ — on a full-page view (doc/inbox/schedules/skills) leave it back to the
 * session; only on the session itself climb to the side-chat parent.
 * Ignored while the settings overlay is open (matches the old handler).
 */
export function navBack(): boolean {
	const ui = useUi.getState();
	if (ui.centerView === "settings") return false;
	const before = here();
	const parentId = currentParentId();
	withInternal(() => {
		if (parentId && ui.centerView === "session") ui.selectSession(parentId);
		else ui.returnToSession();
	});
	const after = here();
	if (before.view === after.view && before.sessionId === after.sessionId && before.docPath === after.docPath) {
		return false;
	}
	forwardTarget = before;
	return true;
}

/** Return to where the last navBack() left; false when there is nothing to go forward to. */
export function navForward(): boolean {
	const target = forwardTarget;
	if (!target) return false;
	forwardTarget = null;
	if (useUi.getState().centerView === "settings") return false;
	if (target.view === "session" || target.sessionId) {
		if (target.view === "session" && !target.sessionId) return false;
		if (target.sessionId && !useSessions.getState().sessions[target.sessionId]) return false;
	}
	const ui = useUi.getState();
	withInternal(() => {
		if (target.view === "session") {
			ui.selectSession(target.sessionId);
		} else if (target.view === "doc" && target.docPath) {
			ui.openDoc(target.docPath);
		} else {
			ui.setCenter(target.view);
		}
	});
	return true;
}

/**
 * Select the previous (-1) / next (+1) session as the sidebar currently shows
 * them. Only rendered rows count, so collapsed groups, paging and filters are
 * respected and no mode switch is ever needed. No wrap-around; with no (visible)
 * selection +1 picks the first row and -1 the last.
 */
export function selectAdjacentSession(delta: 1 | -1): boolean {
	const ids = getVisibleSessionIds();
	if (ids.length === 0) return false;
	const current = useUi.getState().selectedSessionId;
	const at = current ? ids.indexOf(current) : -1;
	const next = at < 0 ? (delta === 1 ? 0 : ids.length - 1) : at + delta;
	if (next < 0 || next >= ids.length) return false;
	const target = ids[next];
	const meta = useSessions.getState().sessions[target];
	if (meta && useSidebarStore.getState().activeMode !== meta.mode) switchSpaceMode(meta.mode);
	useUi.getState().selectSession(target);
	return true;
}
