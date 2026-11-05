import { getTranscript } from "../lib/ipc";
import { useLive } from "./live";

const requests = new Map<string, number>();

/** Every writer of a real session's transcript cache shares request ordering. */
export async function refreshTranscriptCache(sessionId: string, incremental = false): Promise<boolean> {
	const request = (requests.get(sessionId) ?? 0) + 1;
	requests.set(sessionId, request);
	const live = useLive.getState().sessions[sessionId];
	const from = incremental ? (live?.nextOffset ?? 0) : 0;
	try {
		const page = await getTranscript(sessionId, incremental ? from : undefined, incremental ? live?.tailId : undefined);
		if (requests.get(sessionId) !== request) return false;
		const store = useLive.getState();
		if (!incremental || from === 0 || page.reset) {
			store.setItems(sessionId, page.items, page.nextOffset, page.tailId);
		} else {
			store.appendItems(sessionId, page.items, page.nextOffset, page.tailId);
		}
		return true;
	} catch (error) {
		if (requests.get(sessionId) !== request) return false;
		throw error;
	}
}
