/**
 * 「整理成结论」 run state per side chat. `startHandback` is only ever called from
 * an explicit user click: it sends ONE instruction into the side chat through the
 * normal send path (so it shows up in that transcript as the user's message),
 * waits for the turn to end and extracts the answer as the draft. Nothing is
 * sent to the parent here. Closing the dialog never aborts the run.
 */

import { create } from "zustand";
import { errMsg } from "../../lib/dialogs";
import { getTranscript } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import { sendPrompt } from "../chat/send";
import { extractHandbackDraft, HANDBACK_PROMPT, transcriptText } from "./handbackLogic";

export type HandbackPhase = "running" | "ready" | "error";

export interface HandbackRun {
	phase: HandbackPhase;
	/** Edited note while `ready`. */
	draft: string;
	/** Side-chat conversation before the instruction (for 「同时附上完整对话」). */
	transcript: string;
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

/**
 * Ask the side chat to write its settled conclusions. No-op when a run is already
 * going (the dialog just re-attaches to it).
 */
export async function startHandback(childId: string): Promise<void> {
	const store = useHandback.getState();
	if (store.runs[childId]?.phase === "running") return;
	store.set(childId, { phase: "running", draft: "", transcript: "", error: null });
	try {
		const turn = watchTurn(childId);
		try {
			await sendPrompt(childId, HANDBACK_PROMPT);
		} catch (err) {
			turn.stop();
			throw err;
		}
		turn.armStartTimeout();
		await turn.done;
		for (let i = 0; i < RETRIES; i++) {
			const items = await loadItems(childId);
			const res = extractHandbackDraft(items);
			if (res.ok) {
				useHandback.getState().set(childId, {
					phase: "ready",
					draft: res.text,
					transcript: transcriptText(items),
					error: null,
				});
				return;
			}
			if (!res.pending) throw new Error(res.error);
			await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
		}
		throw new Error("没有收到辅助对话的回复");
	} catch (err) {
		const msg = errMsg(err);
		useHandback.getState().set(childId, { phase: "error", error: msg });
		toast.error(`整理结论失败: ${msg}`);
	}
}
