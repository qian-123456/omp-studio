import { getTranscript } from "../lib/ipc";
import { useLive } from "./live";

const requests = new Map<string, symbol>();

/** A removed session must not be recreated by reads already in flight. */
export function invalidateTranscriptCache(sessionIds: readonly string[]): void {
	for (const sessionId of sessionIds) requests.delete(sessionId);
}

/** Every writer of a real session's transcript cache shares request ordering. */
export function refreshTranscriptCache(sessionId: string, incremental = false): Promise<boolean> {
	return readTranscriptCache(sessionId, incremental);
}

/** Read the child fork, never the parent's live cache, before its first prompt. */
export async function prepareSideChatFirstPrompt(sessionId: string): Promise<void> {
	if (useLive.getState().sessions[sessionId]?.sideChatBaselinePrepared) return;
	if (!await readTranscriptCache(sessionId, false, true)) throw new Error("Side-chat history changed before its first prompt");
}

async function readTranscriptCache(sessionId: string, incremental: boolean, prepareFirstPrompt = false): Promise<boolean> {
	const request = Symbol(sessionId);
	requests.set(sessionId, request);
	const live = useLive.getState().sessions[sessionId];
	const from = incremental ? (live?.nextOffset ?? 0) : 0;
	try {
		const page = await getTranscript(sessionId, incremental ? from : undefined, incremental ? live?.tailId : undefined);
		if (requests.get(sessionId) !== request) return false;
		if (prepareFirstPrompt && (!Array.isArray(page.items) || !Number.isSafeInteger(page.nextOffset) || page.nextOffset < 0)) {
			throw new Error("Invalid side-chat transcript baseline");
		}
		const store = useLive.getState();
		if (!incremental || from === 0 || page.reset) {
			store.setItems(sessionId, page.items, page.nextOffset, page.tailId);
		} else {
			store.appendItems(sessionId, page.items, page.nextOffset, page.tailId);
		}
		if (prepareFirstPrompt) {
			// read_page(from=0) returns every complete row, without a row limit.
			useLive.setState((state) => {
				const current = state.sessions[sessionId];
				if (!current || current.sideChatBaselinePrepared) return state;
				return { sessions: { ...state.sessions, [sessionId]: {
					...current,
					sideChatInheritedIds: page.items.map((item) => item.id),
					sideChatBaselinePrepared: true,
				} } };
			});
		}
		return true;
	} catch (error) {
		if (requests.get(sessionId) !== request) return false;
		throw error;
	} finally {
		if (requests.get(sessionId) === request) requests.delete(sessionId);
	}
}
