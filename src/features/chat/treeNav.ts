/** Conversation-tree actions (desktop): version switching and edit-&-resend.
 * Every successful navigation refetches the whole transcript (the reset
 * channel) and re-reads the leaf, so the view re-filters to the new
 * root→leaf path. Busy sessions are refused up front with a friendly toast
 * and never change state. */

import { create } from "zustand";
import { treeNavigate } from "../../lib/ipc";
import { ensureLive, isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { readEntrySnapshot, useTree } from "../../stores/tree";
import { refreshTranscriptCache } from "../../stores/transcript";
import { tNow } from "../../stores/language";
import { errMsg } from "../../lib/dialogs";
import { isForkDraftId } from "../sessions/forkDraft";

export const useTreeEditPending = create<{ entries: Record<string, string | undefined> }>(() => ({ entries: {} }));

/** True when a navigate/switch would be refused: mid-answer, waiting on a
 * dialog, or a fork draft. Suspended sessions can resume before navigation. */
export function treeUnavailable(sessionId: string): boolean {
	if (isForkDraftId(sessionId)) return true;
	const status = useSessions.getState().sessions[sessionId]?.status;
	if (status === "working" || status === "awaiting_approval" || status === "awaiting_answer") {
		return true;
	}
	const live = useLive.getState().sessions[sessionId];
	return live?.streaming === true || Boolean(live?.pendingUi.length);
}

function busyToast(): void {
	toast.info(tNow("chatView.tree.busy"));
}

/** Whole-transcript refetch (same channel as the session view's initial load). */
export async function refetchTranscript(sessionId: string): Promise<void> {
	await refreshTranscriptCache(sessionId);
}

/** Resume if needed, then request the canonical leaf move without sending a prompt. */
async function requestNavigation(
	sessionId: string,
	entryId: string,
	capturePreviousLeaf = false,
): Promise<{ cancelled: boolean; aborted?: boolean; editorText?: string; prevLeafId: string | null } | null> {
	if (treeUnavailable(sessionId)) {
		busyToast();
		return null;
	}
	try {
		if (!useLive.getState().sessions[sessionId]?.alive) await ensureLive(sessionId);
		// Recovery may have waited for a user decision while the session changed.
		if (treeUnavailable(sessionId)) {
			busyToast();
			return null;
		}
		const prevLeafId = capturePreviousLeaf ? (await readEntrySnapshot(sessionId)).leafId : null;
		if (treeUnavailable(sessionId)) {
			busyToast();
			return null;
		}
		const data = await treeNavigate(sessionId, entryId);
		return data.cancelled || data.aborted ? null : { ...data, prevLeafId };
	} catch (e) {
		if (isResumeCancelled(e)) return null;
		if (errMsg(e) === "TREE_BUSY") busyToast();
		else toast.error(tNow("chatView.tree.navigateFailed", { error: errMsg(e) }));
		return null;
	}
}

/** Switch an answer version and synchronize its transcript and leaf. */
export async function navigateTree(
	sessionId: string,
	entryId: string,
): Promise<{ cancelled: boolean; editorText?: string } | null> {
	const data = await requestNavigation(sessionId, entryId);
	if (!data) return null;
	await refreshNavigation(sessionId);
	const { prevLeafId: _previousLeaf, ...result } = data;
	return result;
}

async function refreshNavigation(sessionId: string): Promise<void> {
	await refetchTranscript(sessionId).catch(() => {});
	await useTree.getState().refreshLeaf(sessionId);
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
	if (useTreeEditPending.getState().entries[sessionId]) return false;
	if (treeUnavailable(sessionId)) {
		busyToast();
		return false;
	}
	useTreeEditPending.setState((s) => ({ entries: { ...s.entries, [sessionId]: entryId } }));
	let ready = false;
	try {
		const data = await requestNavigation(sessionId, entryId, true);
		if (!data) return false;
		const text = data.editorText?.trim() ? data.editorText : fallbackText;
		useTree.getState().startResend(sessionId, { entryId, prevLeafId: data.prevLeafId });
		useComposer.getState().setDraft(sessionId, text);
		ready = true;
		// Navigation already committed. History synchronization must not keep the
		// editor disabled after upstream has handed its original text back.
		void refreshNavigation(sessionId).catch(() => {});
	} finally {
		useTreeEditPending.setState((s) => {
			const { [sessionId]: _entry, ...entries } = s.entries;
			return { entries };
		});
	}
	if (ready) useComposer.getState().focusComposer(sessionId);
	return ready;
}

