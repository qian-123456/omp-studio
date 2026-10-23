/**
 * Where a staged annotation lives, and how it moves between the main composer
 * and the side-chat composer of the same parent session.
 *
 * Side-chat staging key: the active side-chat thread's own session id when a real
 * thread is showing (its composer renders the chip natively), otherwise
 * `sideChatAnnKey(parent)` for blank new-side-chat tabs.
 */

import { type AnnotationTarget, sideChatAnnKey, useComposer } from "../../stores/composer";
import { isBlankTab, openNewSideChat, revealSideChat, useSideChatView } from "./viewStore";

/** Minimal slice of the side-chat view store needed to resolve a key. */
export interface SideChatViewSlice {
	openChild: Record<string, string>;
}

/** The side-chat composer key annotations for `parentId` currently stage into. */
export function sideChatStageKey(parentId: string, view: SideChatViewSlice): string {
	const active = view.openChild[parentId];
	return active && !isBlankTab(active) ? active : sideChatAnnKey(parentId);
}

/**
 * Destination store key for a new annotation made in `sessionId`.
 * Inside a side chat there is no choice: always its own composer.
 */
export function resolveAnnotationKey(opts: {
	sessionId: string;
	inSideChat: boolean;
	target: AnnotationTarget;
	view: SideChatViewSlice;
}): string {
	const { sessionId, inSideChat, target, view } = opts;
	if (inSideChat || target === "main") return sessionId;
	return sideChatStageKey(sessionId, view);
}

/**
 * Make the side chat of `parentId` visible: reuse the active side-chat tab
 * (real or blank) when one exists, otherwise open a blank new side-chat tab.
 */
export function revealSideChatFor(parentId: string): void {
	const view = useSideChatView.getState();
	const child = view.openChild[parentId];
	if (child) {
		view.setOpenChild(parentId, child);
		revealSideChat();
	} else {
		openNewSideChat(parentId);
	}
}

/** Stage-key of a side-chat composer back to its main (parent) session id. */
export function mainKeyOfSideChat(key: string, parentIdOfSession: string | null | undefined): string | null {
	if (key.startsWith("sidechat:")) return key.slice("sidechat:".length);
	return parentIdOfSession ?? null;
}

/** Move main → side chat of `parentId` and reveal the panel. */
export function moveToSideChat(parentId: string, annotationId: string): void {
	const key = sideChatStageKey(parentId, useSideChatView.getState());
	useComposer.getState().moveAnnotation(parentId, key, annotationId);
	revealSideChatFor(parentId);
	useComposer.getState().focusComposer(key);
}

/** Move side chat (store key `fromKey`) → its parent's main composer. */
export function moveToMain(fromKey: string, mainId: string, annotationId: string): void {
	useComposer.getState().moveAnnotation(fromKey, mainId, annotationId);
	useComposer.getState().focusComposer(mainId);
}
