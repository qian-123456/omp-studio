/**
 * Display-only transform for side-chat (forked) sessions.
 *
 * A side chat's transcript starts with a verbatim copy of the parent's history
 * (`fork_file`), followed by the app-rendered first prompt (prompts/side_chat.md).
 * Showing both makes the parent's earlier messages look like the user's side-chat
 * messages. We hide everything before the last side-chat prompt and show that
 * prompt as just the user's question (plus the quoted selection, if any).
 */

const SIDE_CHAT_MARKERS = [
	"Side chat forked from main session",
	// Legacy template (sessions created before the boundary moved to the system prompt).
	"You are a **side chat** forked from main session",
];
const SELECTION_HEADER = "## Selected text the user is asking about\n";
const QUESTION_HEADER = "## User question\n";

/** Question text sent to the model when the user only staged quotes; never shown. */
export const QUOTE_ONLY_QUESTION = "请结合引用内容回答";

/** First line of the internal handback summary prompt in a side-chat transcript. */
export const HANDBACK_MARKER = "【回传整理】";

export const isHandbackPrompt = (it: { kind: string; text?: string | null }): boolean =>
	it.kind === "user" && (it.text ?? "").trimStart().startsWith(HANDBACK_MARKER);

function composeDisplay(selection: string, question: string): string {
	if (!selection) return question;
	return question === QUOTE_ONLY_QUESTION ? selection : `${selection}\n\n${question}`;
}

/** The bubble text for a side chat's first message, identical to what `sideChatPromptToDisplay` yields once the prompt lands. */
export function sideChatEchoText(question: string, selection: string | undefined): string {
	return composeDisplay(selection ? `> ${selection}`.trim() : "", question.trim());
}

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
	return composeDisplay(selection, question);
}

/**
 * `isSideChat` (known from session metadata) makes the trim strict: until the
 * side-chat prompt is written to the transcript, everything present is
 * inherited parent history, so show nothing instead of leaking it.
 */
export function trimSideChatItems<T extends { kind: string; text?: string | null; hidden?: boolean }>(
	items: T[],
	isSideChat = false,
): T[] {
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
	// The boundary prompt is transport-hidden context, but its extracted
	// question is the user's real message. Other hidden rows stay hidden.
	out[0] = { ...out[0], text: sideChatPromptToDisplay(out[0].text ?? ""), hidden: false };
	return out;
}
