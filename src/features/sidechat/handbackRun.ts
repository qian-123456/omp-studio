/**
 * 「整理成结论」 run state per side chat. `startHandback` is only ever called from
 * an explicit user click: it sends ONE instruction into the side chat through the
 * normal send path (so it shows up in that transcript as the user's message),
 * waits for the turn to end and extracts the answer as the draft. Nothing is
 * sent to the parent here. Closing the dialog never aborts the run.
 */

import { create } from "zustand";
import { errMsg } from "../../lib/dialogs";
import { getTranscript, rpcSend, setQuietTurn } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";
import { useLive } from "../../stores/live";
import * as Send from "../chat/send";
import {
	extractHandbackDraft,
	HANDBACK_PROMPT,
	latestSideChatDiscussionId,
	transcriptText,
} from "./handbackLogic";

export type HandbackPhase = "running" | "ready" | "error";

export interface HandbackRun {
	phase: HandbackPhase;
	/** Edited note while `ready`. */
	draft: string;
	/** Side-chat conversation before the instruction (for 「同时附上完整对话」). */
	transcript: string;
	/** Tail discussion item id covered by `draft`, so reopening reuses an up-to-date summary. */
	summarizedTailId?: string | null;
	error: string | null;
}

interface HandbackState {
	runs: Record<string, HandbackRun>;
	set(childId: string, patch: Partial<HandbackRun>): void;
}

export const useHandback = create<HandbackState>((set) => ({
	runs: {},
	set: (childId, patch) =>
		set((s) => ({
			runs: {
				...s.runs,
				[childId]: {
					...({ phase: "running", draft: "", transcript: "", error: null } as HandbackRun),
					...s.runs[childId],
					...patch,
				},
			},
		})),
}));

const RETRY_DELAY_MS = 400;
const RETRIES = 8;
/** How long the turn may fail to even start before the run is declared failed. */
const START_TIMEOUT_MS = 20_000;

/**
 * Watches `childId` for one turn: `done` resolves once streaming went true then false
 * (subscribed before the send so a fast turn is not missed). If no turn starts within
 * `START_TIMEOUT_MS` of `armStartTimeout`, it resolves anyway and the transcript decides.
 */
function watchTurn(childId: string) {
	let resolve!: () => void;
	const done = new Promise<void>((r) => {
		resolve = r;
	});
	let seen = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stop = () => {
		clearTimeout(timer);
		unsub();
		resolve();
	};
	const unsub = useLive.subscribe((state) => {
		const streaming = state.sessions[childId]?.streaming === true;
		if (streaming) seen = true;
		else if (seen) stop();
	});
	return {
		done,
		stop,
		armStartTimeout: () => {
			if (!seen) timer = setTimeout(() => !seen && stop(), START_TIMEOUT_MS);
		},
	};
}

/** The transcript to read: backend first, live cache as fallback. */
async function loadItems(childId: string) {
	try {
		const page = await getTranscript(childId);
		if (page.items?.length) return page.items;
	} catch (err) {
		console.error("handback: transcript fetch failed", err);
	}
	return useLive.getState().sessions[childId]?.items ?? [];
}

/** True while the side chat is mid-turn (the instruction would queue behind it). */
export const isSideChatBusy = (childId: string): boolean =>
	useLive.getState().sessions[childId]?.streaming === true;

/** Active turn watchers keyed by `childId` so `cancelHandback` can release immediately. */
const activeWatchers = new Map<string, { cancel: () => void; cancelled: boolean }>();

/**
 * Open the dialog on what the side chat ALREADY said: kept for direct draft prefill
 * callers; `openHandback` now uses `ensureHandbackStarted` so conclusions are summarized.
 */
export async function prefillHandbackFromExisting(childId: string): Promise<boolean> {
	if (useHandback.getState().runs[childId]?.phase === "running") return true;
	const items = await loadItems(childId);
	let last = "";
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		if (it.kind === "assistant" && !it.hidden && it.text?.trim()) {
			last = it.text.trim();
			break;
		}
	}
	useHandback.getState().set(childId, {
		phase: "ready",
		draft: last,
		transcript: transcriptText(items),
		error: null,
	});
	return last !== "";
}

/**
 * Ensure the handback summary for `childId` is up to date:
 * - Re-attaches if a summary turn is already running.
 * - Stays empty without sending a prompt if the side chat has no discussion yet.
 * - Reuses an existing `ready` summary if no new discussion messages arrived since it ran.
 * - Otherwise starts `startHandback(childId)` automatically.
 */
export async function ensureHandbackStarted(childId: string): Promise<void> {
	const existing = useHandback.getState().runs[childId];
	if (existing?.phase === "running") return;
	const items = await loadItems(childId);
	const tailId = latestSideChatDiscussionId(items);
	if (!tailId) {
		useHandback.getState().set(childId, {
			phase: "ready",
			draft: "",
			transcript: "",
			summarizedTailId: null,
			error: null,
		});
		return;
	}
	if (
		existing?.phase === "ready" &&
		existing.draft.trim() &&
		existing.summarizedTailId === tailId
	) {
		useHandback.getState().set(childId, { transcript: transcriptText(items), error: null });
		return;
	}
	await startHandback(childId);
}

/** Stop an in-flight handback summary turn at the user's request. */
export async function cancelHandback(childId: string): Promise<void> {
	const watcher = activeWatchers.get(childId);
	if (watcher) {
		watcher.cancelled = true;
		watcher.cancel();
		activeWatchers.delete(childId);
	}
	useHandback.getState().set(childId, {
		phase: "error",
		error: tNow("sidechat.handbackAborted"),
	});
	void setQuietTurn(childId, false).catch(() => {});
	try {
		if (typeof Send.abortTurn === "function") await Send.abortTurn(childId);
		else await rpcSend(childId, { type: "abort" });
	} catch {
		/* session may have already finished */
	}
}

/**
 * Ask the side chat to write its settled conclusions. No-op when a run is already
 * going (the dialog just re-attaches to it).
 */
export async function startHandback(childId: string): Promise<void> {
	const store = useHandback.getState();
	if (store.runs[childId]?.phase === "running") return;
	if (isSideChatBusy(childId)) {
		toast.info(tNow("sidechat.sideChatBusyWait"));
		return;
	}
	store.set(childId, { phase: "running", draft: "", transcript: "", error: null });
	const watcherEntry = { cancel: () => {}, cancelled: false };
	activeWatchers.set(childId, watcherEntry);
	try {
		const previousItems = await loadItems(childId);
		const previouslySeenIds = new Set(previousItems.map((item) => item.id));
		if (watcherEntry.cancelled) return;
		if (isSideChatBusy(childId)) {
			const error = tNow("sidechat.sideChatBusyWait");
			useHandback.getState().set(childId, { phase: "error", error });
			toast.info(error);
			return;
		}
		const turn = watchTurn(childId);
		watcherEntry.cancel = turn.stop;
		try {
			// The summary is handed to the parent, not read in the side chat: its
			// settle must not raise the unread dot.
			await setQuietTurn(childId, true);
			await Send.sendPrompt(childId, HANDBACK_PROMPT);
		} catch (err) {
			void setQuietTurn(childId, false).catch(() => {});
			turn.stop();
			throw err;
		}
		if (watcherEntry.cancelled) {
			turn.stop();
			return;
		}
		turn.armStartTimeout();
		await turn.done;
		if (watcherEntry.cancelled) return;
		for (let i = 0; i < RETRIES; i++) {
			if (watcherEntry.cancelled) return;
			const items = await loadItems(childId);
			const res = extractHandbackDraft(items, previouslySeenIds);
			if (res.ok) {
				useHandback.getState().set(childId, {
					phase: "ready",
					draft: res.text,
					transcript: transcriptText(items),
					summarizedTailId: latestSideChatDiscussionId(items),
					error: null,
				});
				return;
			}
			if (!res.pending) throw new Error(res.error);
			await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
		}
		throw new Error(tNow("sidechat.noResponseFromSideChat"));
	} catch (err) {
		if (watcherEntry.cancelled) return;
		const msg = errMsg(err);
		useHandback.getState().set(childId, { phase: "error", error: msg });
		toast.error(tNow("sidechat.handbackRunFailed", { error: msg }));
	} finally {
		if (activeWatchers.get(childId) === watcherEntry) {
			activeWatchers.delete(childId);
		}
	}
}
