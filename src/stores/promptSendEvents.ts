/**
 * Tiny pub/sub for the outcome of a chat prompt send, so feature code (e.g. the idea
 * backlog) can react to "this text was really sent" without chat importing it.
 *  - "echoed": the message is visible in the thread (the composer may now clear its draft)
 *  - "sent":   the RPC accepted the prompt
 *  - "failed": the send failed and the composer restores its draft
 */
export type PromptSendPhase = "echoed" | "sent" | "failed";
export type PromptSendListener = (phase: PromptSendPhase, sessionId: string, text: string) => void;

const listeners = new Set<PromptSendListener>();

export function onPromptSend(listener: PromptSendListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function emitPromptSend(phase: PromptSendPhase, sessionId: string, text: string): void {
	if (listeners.size === 0) return;
	for (const l of [...listeners]) {
		try {
			l(phase, sessionId, text);
		} catch {
			// A listener must never affect the send path.
		}
	}
}
