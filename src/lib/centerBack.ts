import type { CenterView } from "../stores/ui";
import { tNow } from "../stores/language";

/** Where the main-area "back" control leads. */
export type BackTarget =
	| { kind: "session"; sessionId: string }
	| { kind: "home" };

export interface BackInput {
	/** Center view currently shown underneath any settings overlay. */
	view: CenterView;
	selectedSessionId: string | null;
	lastSessionId: string | null;
	/** True when the id still exists in the sessions store (not deleted/other mode). */
	sessionExists: (id: string) => boolean;
	/** A new-session placeholder is on its way; nothing to go back to. */
	placeholderShowing: boolean;
}

/**
 * Back target for full-page center views (doc / inbox / schedules / skills).
 * Returns null when no back control should be shown: on the session view itself,
 * on home, or while a new-session placeholder is pending. A remembered session
 * that no longer exists falls back to home instead of a dead session page.
 */
export function resolveBackTarget(input: BackInput): BackTarget | null {
	const { view, selectedSessionId, lastSessionId, sessionExists, placeholderShowing } = input;
	if (view === "session" || view === "home" || view === "settings") return null;
	if (placeholderShowing) return null;
	const id = selectedSessionId || lastSessionId;
	if (id && sessionExists(id)) return { kind: "session", sessionId: id };
	return { kind: "home" };
}

/** Short label for the back control: names where it goes. */
export function backLabel(target: BackTarget, sessionName: string | null): string {
	return target.kind === "session" ? sessionName || tNow("shell.sessionFallback") : tNow("shell.homeFallback");
}

/** Minimal shape of the Esc event target/doc state needed to decide. */
export interface EscapeContext {
	key: string;
	escapeClaimed: boolean;
	composing: boolean;
	/** Event target is an input, textarea, select or contenteditable. */
	targetEditable: boolean;
	/** A modal dialog / popover layer is open and owns Esc. */
	overlayOpen: boolean;
	hasBackTarget: boolean;
}

/** Esc leaves a full-page view only when nothing else could be consuming it. */
export function shouldEscapeGoBack(c: EscapeContext): boolean {
	return (
		c.key === "Escape" &&
		c.hasBackTarget &&
		!c.escapeClaimed &&
		!c.composing &&
		!c.targetEditable &&
		!c.overlayOpen
	);
}
