/**
 * Lazy full-session fork. Clicking "fork" only opens a DRAFT in the main area
 * that displays the parent's transcript read-only: no backend row, no session
 * file, no process. The real fork (`fork_session`) happens at the user's FIRST
 * SEND, computed at send time; the typed text is the only thing ever sent.
 *
 * The draft owns a synthetic id (`fork-draft:<uuid>`). The regular Composer and
 * MessageList run against it; `sendPrompt` routes sends for that id through
 * {@link sendFromForkDraft}, which forks, swaps the view to the real session and
 * then sends the user's text there.
 */

import { create } from "zustand";
import type { ImageAttachment, TranscriptItem } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { forkSession } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { tNow } from "../../stores/language";

const DRAFT_PREFIX = "fork-draft:";

export const isForkDraftId = (id: string): boolean => id.startsWith(DRAFT_PREFIX);

export interface ForkDraft {
	/** Synthetic session id used by the Composer / MessageList. */
	id: string;
	parentId: string;
	/** Pinned answer entry (cut exactly after it); null = parent as it stands at send time. */
	entryId: string | null;
	/** Parent transcript as displayed (cut at `entryId` when pinned); null until loaded. */
	items: TranscriptItem[] | null;
	/** First send in flight: fork is being created. */
	sending: boolean;
}

interface ForkDraftState {
	draft: ForkDraft | null;
	setItems(id: string, items: TranscriptItem[]): void;
}

export const useForkDraft = create<ForkDraftState>((set) => ({
	draft: null,
	setItems: (id, items) =>
		set((s) => (s.draft?.id === id ? { draft: { ...s.draft, items } } : s)),
}));

/** Items up to and including the entry with `entryId`; all items when none is pinned. */
export function cutItemsAtEntry(
	items: readonly TranscriptItem[],
	entryId: string | null,
): TranscriptItem[] {
	if (!entryId) return [...items];
	const at = items.findIndex((i) => i.id === entryId);
	return at < 0 ? [...items] : items.slice(0, at + 1);
}

function dropLive(id: string) {
	useLive.setState((s) => {
		if (!(id in s.sessions)) return s;
		const { [id]: _gone, ...rest } = s.sessions;
		return { sessions: rest };
	});
}

function clearComposer(id: string) {
	const c = useComposer.getState();
	c.clearDraft(id);
	c.clearImages(id);
	c.clearFiles(id);
	c.clearAnnotations(id);
}

/** Discard the draft (and its synthetic live/composer state). */
export function closeForkDraft(): void {
	const draft = useForkDraft.getState().draft;
	if (!draft) return;
	useForkDraft.setState({ draft: null });
	dropLive(draft.id);
	clearComposer(draft.id);
}

/**
 * Open a draft of `parentId` in the main area. With `entryId` the answer the
 * user clicked is pinned; otherwise the fork is cut at the last complete turn
 * when the user sends. Creates nothing on the backend. Returns the draft id.
 */
export function openForkDraft(parentId: string, entryId?: string | null): string {
	closeForkDraft();
	const id = `${DRAFT_PREFIX}${crypto.randomUUID()}`;
	// Same placement as the new-session placeholder: session pane, nothing selected.
	useUi.setState({ selectedSessionId: null, centerView: "session" });
	useForkDraft.setState({
		draft: { id, parentId, entryId: entryId || null, items: null, sending: false },
	});
	useComposer.getState().focusComposer(id);
	return id;
}

// Navigating away from the pane discards the draft (settings overlay keeps it).
useUi.subscribe((s) => {
	if (!useForkDraft.getState().draft) return;
	if (s.selectedSessionId !== null || (s.centerView !== "session" && s.centerView !== "settings")) {
		closeForkDraft();
	}
});

/**
 * First send from a draft: show the typed message at once, fork the parent now,
 * swap the view to the new session, then send ONLY the typed text there.
 * `send(newSessionId)` performs the ordinary prompt send. Rejects (after
 * unwinding the local echo) when the fork cannot be created, so the composer
 * can restore the text; a failed send after creation is toasted and the text
 * is put back into the new session's composer.
 */
export async function sendFromForkDraft(
	draftId: string,
	text: string,
	opts: { images?: ImageAttachment[]; onEchoed?: () => void },
	send: (sessionId: string) => Promise<void>,
): Promise<void> {
	const draft = useForkDraft.getState().draft;
	if (!draft || draft.id !== draftId) throw new Error(tNow("sessions.forkDraftClosedError"));
	if (draft.sending) throw new Error(tNow("sessions.forkDraftCreatingError"));
	useForkDraft.setState({ draft: { ...draft, sending: true } });
	useLive.getState().addUserEcho(draftId, text, opts.images);
	opts.onEchoed?.();

	let newId: string;
	try {
		const info = await forkSession(draft.parentId, draft.entryId ?? undefined);
		newId = info.sessionId;
		await useSessions.getState().load().catch(() => {});
	} catch (err) {
		// Nothing was created: remove the echo, keep the draft usable.
		const cur = useForkDraft.getState().draft;
		if (cur?.id === draftId) {
			useForkDraft.setState({ draft: { ...cur, sending: false } });
			dropLive(draftId);
			if (cur.items) useLive.getState().setItems(draftId, cur.items, 0);
		}
		throw err;
	}

	const ui = useUi.getState();
	const visible =
		useForkDraft.getState().draft?.id === draftId &&
		ui.selectedSessionId === null &&
		(ui.centerView === "session" || ui.centerView === "settings");
	closeForkDraft();
	if (visible) useUi.getState().selectSession(newId);
	try {
		await send(newId);
	} catch (err) {
		useComposer.getState().setDraft(newId, text);
		toast.error(tNow("sessions.sendFailed", { error: errMsg(err) }));
	}
}

/**
 * `/fork <text>`: the user already spoke, so fork now and send that text. The
 * draft is shown for the moment it takes; on failure it is discarded and the
 * view returns to the parent.
 */
export async function forkAndSend(
	parentId: string,
	text: string,
	send: (sessionId: string) => Promise<void>,
): Promise<void> {
	const id = openForkDraft(parentId);
	try {
		await sendFromForkDraft(id, text, {}, send);
	} catch (err) {
		closeForkDraft();
		useUi.getState().selectSession(parentId);
		throw err;
	}
}

/** Parent is mid-task: running, or waiting on a tool approval / question dialog. */
export function isParentBusy(parentId: string): boolean {
	const status = useSessions.getState().sessions[parentId]?.status;
	return (
		useLive.getState().sessions[parentId]?.streaming === true ||
		status === "working" ||
		status === "awaiting_approval" ||
		status === "awaiting_answer"
	);
}

/**
 * Fork entry point (answer-footer icon, `/fork` without text). Decided at click
 * time: an idle parent is forked IMMEDIATELY (no prompt is sent; the new real
 * session opens with an empty focused composer); a running parent opens the
 * lazy draft and forks at the user's first send. `entryId` pins an answer.
 */
export async function startFork(parentId: string, entryId?: string | null): Promise<void> {
	if (isParentBusy(parentId)) {
		openForkDraft(parentId, entryId);
		return;
	}
	try {
		const info = await forkSession(parentId, entryId || undefined);
		await useSessions.getState().load().catch(() => {});
		closeForkDraft();
		useUi.getState().selectSession(info.sessionId);
		useComposer.getState().focusComposer(info.sessionId);
	} catch (err) {
		toast.error(tNow("sessions.createForkFailed", { error: errMsg(err) }));
	}
}
