import { useUi } from "../../../stores/ui";
import { useThreadFind } from "./threadFindStore";

function selectedTranscriptText(): string {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed) return "";
	const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
	if (!anchor?.closest("[data-session-view]") || anchor.closest("[data-own-find], textarea, input")) {
		return "";
	}
	const text = sel.toString().trim();
	return text.length > 0 && text.length <= 200 && !text.includes("\n") ? text : "";
}

/**
 * Open the in-thread find bar (or re-focus it). Returns false when no chat
 * transcript is visible so callers can fall back to cross-session search.
 */
export function openThreadFind(): boolean {
	const ui = useUi.getState();
	const id = ui.selectedSessionId;
	if (ui.centerView !== "session" || !id || ui.sessionViewMode[id] === "terminal") return false;
	useThreadFind.getState().show(id, selectedTranscriptText() || undefined);
	return true;
}
