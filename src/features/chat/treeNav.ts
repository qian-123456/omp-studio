/** Conversation-tree actions (desktop): version switching and edit-&-resend.
 * Every successful navigation refetches the whole transcript (the reset
 * channel) and re-reads the leaf, so the view re-filters to the new
 * root→leaf path. Busy sessions are refused up front with a friendly toast
 * and never change state. */

import { getTranscript, treeNavigate } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useTree } from "../../stores/tree";
import { tNow } from "../../stores/language";
import { errMsg } from "../../lib/dialogs";
import { isForkDraftId } from "../sessions/forkDraft";

/** True when a navigate/switch would be refused: mid-answer, waiting on a
 * dialog, or not backed by a live process (fork drafts, offline sessions). */
export function treeUnavailable(sessionId: string): boolean {
	if (isForkDraftId(sessionId)) return true;
	const status = useSessions.getState().sessions[sessionId]?.status;
	if (status === "working" || status === "awaiting_approval" || status === "awaiting_answer") {
		return true;
	}
	const live = useLive.getState().sessions[sessionId];
	return !live?.alive || live.streaming === true;
}

function busyToast(): void {
	toast.info(tNow("chatView.tree.busy"));
}

/** Whole-transcript refetch (same channel as the session view's initial load). */
export async function refetchTranscript(sessionId: string): Promise<void> {
	const page = await getTranscript(sessionId);
	useLive.getState().setItems(sessionId, page.items, page.nextOffset, page.tailId);
}

/**
 * Move the leaf to `entryId` (a sibling answer to switch to, or a user entry
 * to restart from). Returns the upstream data on success, null when refused
 * (busy toast shown, nothing changed). Refreshes the transcript + leaf so the
 * path filter re-renders immediately.
 */
export async function navigateTree(
	sessionId: string,
	entryId: string,
): Promise<{ cancelled: boolean; editorText?: string } | null> {
	if (treeUnavailable(sessionId)) {
		busyToast();
		return null;
	}
	try {
		const data = await treeNavigate(sessionId, entryId);
		// Other windows learn through `tree:navigated`; this one refetches now.
		await refetchTranscript(sessionId).catch(() => {});
		await useTree.getState().refreshLeaf(sessionId);
		return data;
	} catch (e) {
		if (errMsg(e) === "TREE_BUSY") busyToast();
		else toast.error(tNow("chatView.tree.navigateFailed", { error: errMsg(e) }));
		return null;
	}
}

/**
 * Edit-&-resend a user message: navigate past it (upstream hands the original
 * text back), fill the composer and raise the restart banner. The old branch
 * is preserved; the next send creates the sibling.
 */
export async function startTreeResend(
	sessionId: string,
	entryId: string,
	fallbackText: string,
): Promise<boolean> {
	if (treeUnavailable(sessionId)) {
		busyToast();
		return false;
	}
	const prevLeafId = currentLeafId(sessionId);
	const data = await navigateTree(sessionId, entryId);
	if (!data) return false;
	const text = data.editorText?.trim() ? data.editorText : fallbackText;
	useTree.getState().startResend(sessionId, { entryId, prevLeafId });
	useComposer.getState().setDraft(sessionId, text);
	useComposer.getState().focusComposer(sessionId);
	return true;
}

/** Current leaf id: the cached get_tree value, falling back to the transcript
 * tail (correct for sessions never navigated). */
export function currentLeafId(sessionId: string): string | null {
	const cached = useTree.getState().leaf[sessionId];
	if (cached !== undefined) return cached;
	const items = useLive.getState().sessions[sessionId]?.items ?? [];
	return items[items.length - 1]?.id ?? null;
}
