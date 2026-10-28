/**
 * Draft sessions (`mobile-draft-*`): process-free until the first prompt hands off to a real session id.
 * Semantics ported from the vanilla chat.js: per-draft stash of unsent text + attachments, debounced
 * `draft-activity`, first-prompt handoff carrying the optimistic text to the real session page.
 */
import { isDraftId } from "../../../core/types";

export { isDraftId };

export const DRAFT_ACTIVITY_DEBOUNCE_MS = 600;

export interface DraftStashEntry<A = unknown> {
	text: string;
	atts: A[];
}

export interface Handoff {
	id: string;
	text: string;
}

export interface DraftBook<A = unknown> {
	/** Unmount: keep a meaningful draft, drop a blank one. Returns whether it was meaningful. */
	stash(id: string, text: string, atts: A[]): boolean;
	/** Mount: unsent content of this draft, if any. */
	restore(id: string): DraftStashEntry<A> | null;
	/** First prompt accepted: forget the old id, remember the optimistic text for the real id. */
	handoff(from: string, to: string, text: string): void;
	/** Mount of the real session page: consumes the handoff if it targets `id` (only once). */
	takeHandoff(id: string): Handoff | null;
	forget(id: string): void;
}

export function createDraftBook<A = unknown>(): DraftBook<A> {
	const stash = new Map<string, DraftStashEntry<A>>();
	let handoff: Handoff | null = null;
	return {
		stash(id, text, atts) {
			const meaningful = text.trim() !== "" || atts.length > 0;
			if (meaningful) stash.set(id, { text, atts });
			else stash.delete(id);
			return meaningful;
		},
		restore: (id) => stash.get(id) ?? null,
		handoff(from, to, text) {
			stash.delete(from);
			handoff = { id: to, text };
		},
		takeHandoff(id) {
			if (!handoff || handoff.id !== id) {
				handoff = null;
				return null;
			}
			const h = handoff;
			handoff = null;
			return h;
		},
		forget: (id) => void stash.delete(id),
	};
}

/** Module singleton: survives page unmount/mount while the app is open. */
export const draftBook = createDraftBook<unknown>();

/**
 * Home composer → chat page: the first message of a session created on home. The chat page sends
 * it through its controller on mount, so the bubble shows at once and failures restore the text
 * into the chat composer.
 */
let queuedSend: Handoff | null = null;
export function queueFirstSend(id: string, text: string): void {
	queuedSend = { id, text };
}
/** Consumes the queued message if it targets `id` (only once). */
export function takeFirstSend(id: string): string | null {
	if (!queuedSend || queuedSend.id !== id) return null;
	const t = queuedSend.text;
	queuedSend = null;
	return t;
}

export type ComposerAction = "goal" | "finder" | "workspace" | "sketch" | "plan";
interface ComposerHandoff { id: string; action?: ComposerAction; files?: File[] }
let composerHandoff: ComposerHandoff | null = null;
export function queueComposerAction(id: string, action?: ComposerAction, files?: File[]): void {
	composerHandoff = { id, action, files };
}
export function takeComposerAction(id: string): Omit<ComposerHandoff, "id"> | null {
	if (!composerHandoff || composerHandoff.id !== id) return null;
	const { action, files } = composerHandoff;
	composerHandoff = null;
	return { action, files };
}

/** Body of `POST /sessions/{draftId}/draft-activity`. */
export function draftActivityBody(active: boolean, meaningful: boolean): { active: boolean; meaningful: boolean } {
	return { active, meaningful };
}

/**
 * Debounced trailing call (first meaningful edit prewarms omp). Timer functions are injectable for tests.
 */
export function createDebounce(fn: () => void, ms: number, timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }) {
	let t: ReturnType<typeof setTimeout> | null = null;
	return {
		call() {
			if (t !== null) timers.clear(t);
			t = timers.set(() => {
				t = null;
				fn();
			}, ms);
		},
		cancel() {
			if (t !== null) timers.clear(t);
			t = null;
		},
	};
}
