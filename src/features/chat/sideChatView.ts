/**
 * Display-only transform for side-chat (forked) sessions.
 *
 * A side chat's transcript starts with a verbatim copy of the parent's history
 * (`fork_file`), followed by the app-rendered first prompt (prompts/side_chat.md).
 * Showing both makes the parent's earlier messages look like the user's side-chat
 * messages. We hide everything before the last side-chat prompt and show that
 * prompt as just the user's question (plus the quoted selection, if any).
 */

import type { TranscriptItem } from "../../lib/contracts";

const SIDE_CHAT_MARKERS = [
	"Side chat forked from main session",
	// Legacy template (sessions created before the boundary moved to the system prompt).
	"You are a **side chat** forked from main session",
];
const SELECTION_HEADER = "## Selected text the user is asking about\n";
const QUESTION_HEADER = "## User question\n";

export function isSideChatPrompt(text: string | null | undefined): boolean {
	return !!text && SIDE_CHAT_MARKERS.some((m) => text.startsWith(m));
}

/** The question (with quoted selection) the user actually typed in the side chat. */
export function sideChatPromptToDisplay(text: string): string {
	const qAt = text.lastIndexOf(QUESTION_HEADER);
	if (qAt < 0) return text;
	const question = text.slice(qAt + QUESTION_HEADER.length).trim();
	const sAt = text.indexOf(SELECTION_HEADER);
	if (sAt < 0 || sAt > qAt) return question;
	const selection = text.slice(sAt + SELECTION_HEADER.length, qAt).trim();
	return selection ? `${selection}\n\n${question}` : question;
}

/**
 * `isSideChat` (known from session metadata) makes the trim strict: until the
 * side-chat prompt is written to the transcript, everything present is
 * inherited parent history, so show nothing instead of leaking it.
 */
export function trimSideChatItems(items: TranscriptItem[], isSideChat = false): TranscriptItem[] {
	let start = -1;
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		if (it.kind === "user" && isSideChatPrompt(it.text)) {
			start = i;
			break;
		}
	}
	if (start < 0) return isSideChat ? [] : items;
	const out = items.slice(start);
	out[0] = { ...out[0], text: sideChatPromptToDisplay(out[0].text ?? "") };
	return out;
}
