/**
 * Side-chat actions shared by the panel, the tab context menu and `/btw`.
 *
 * Send flow (nothing ever starts without a user-typed message):
 *   blank tab: pending bubble -> create (once) -> first ask -> echo + bind.
 *   Failed asks keep the blank composer and created session for a first-ask retry.
 *   Bound tab, later messages: echo + `sendPrompt` (done by the thread view).
 */

import type { ComposerImage } from "../../stores/composer";
import { createSideChat, sideChatAsk } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";
import { type Annotation, formatWithAnnotations, sideChatAnnKey, useComposer } from "../../stores/composer";
import { QUOTE_ONLY_QUESTION, sideChatEchoText } from "../chat/sideChatView";
import { expandImagesForSend } from "../chat/imageTokens";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { sideChatDefaultModelArg } from "./modelDefault";
import { HANDBACK_ACTION_KEY, appendToDraft, handbackAnnotation } from "./handbackLogic";
import { isSideChatBusy, startHandback, useHandback } from "./handbackRun";
import { sideChatImageAttachments } from "./sideChatAttachments";
import { openNewSideChat, useSideChatView } from "./viewStore";

export interface FirstMessageInput {
	parentId: string;
	/** Blank tab the message is typed in. */
	tabId: string;
	/** Trimmed user text; may be empty when annotations or images are staged. */
	text: string;
	annotations?: readonly Annotation[];
	images?: ComposerImage[];
	/** `provider/id[:thinking]` model argument; `null` inherits the parent's. */
	model?: string | null;
}

/** The question + quote selection that `sideChatAsk` renders into the first prompt. */
export function firstMessageParts(
	text: string,
	annotations: readonly Annotation[] = [],
	imageCount = 0,
): { question: string; selection: string | undefined } {
	const selection = formatWithAnnotations("", [...annotations]) || undefined;
	const hasQuestion = text.replace(/🖼️\s*#\d+/gu, "").trim().length > 0;
	const question = hasQuestion
		? text.trim()
		: selection
			? QUOTE_ONLY_QUESTION
			: imageCount > 0
				? tNow("sidechat.imageOnlyQuestion")
				: QUOTE_ONLY_QUESTION;
	return { question, selection };
}

// A created session is not a bound thread until its first ask is accepted.
// Keep it across failures so retrying does not create another side chat or use
// the ordinary send path, which would omit the first-question boundary prompt.
const firstQuestionSessions = new Map<string, string>();
useSideChatView.subscribe(({ openTabs }) => {
	for (const tabId of firstQuestionSessions.keys()) {
		if (!Object.values(openTabs).some((tabs) => tabs.includes(tabId))) firstQuestionSessions.delete(tabId);
	}
});

/** Send a blank tab's first question; failures leave all staged input intact. */
export async function sendFirstMessage(input: FirstMessageInput): Promise<void> {
	const { parentId, tabId, annotations, images = [] } = input;
	const imageAttachments = sideChatImageAttachments(images);
	const { question, selection } = firstMessageParts(input.text, annotations, images.length);
	const promptQuestion = expandImagesForSend(
		question,
		imageAttachments.flatMap((image) =>
			typeof image.path === "string" && image.path
				? [{
						path: image.path,
						...(typeof image.width === "number" ? { width: image.width } : {}),
						...(typeof image.height === "number" ? { height: image.height } : {}),
					}]
				: [],
		),
		"suffix",
	);
	const view = useSideChatView.getState();
	const shown = sideChatEchoText(question, selection);
	view.setPending(tabId, shown);
	try {
		let sessionId = firstQuestionSessions.get(tabId);
		if (!sessionId) {
			const info = await createSideChat(parentId, input.model ?? undefined);
			sessionId = info.sessionId;
			firstQuestionSessions.set(tabId, sessionId);
		}
		await sideChatAsk(sessionId, promptQuestion, selection);
		// Only accepted messages become user echoes or consume staged attachments.
		useLive.getState().addUserEcho(sessionId, shown, imageAttachments);
		await useSessions.getState().load().catch(() => {});
		view.bindTab(parentId, tabId, sessionId);
		firstQuestionSessions.delete(tabId);
		if (annotations?.length) useComposer.getState().clearAnnotations(sideChatAnnKey(parentId));
		if (images.length > 0) useComposer.getState().clearImages(tabId);
	} finally {
		view.setPending(tabId, null);
	}
}

/**
 * Open a blank side-chat tab for `parentId` (revealing the panel). With
 * `question` the message is sent at once through the normal first-message flow.
 */
export async function openSideChatTab(
	parentId: string,
	opts: { question?: string; draft?: string } = {},
): Promise<string> {
	const tabId = openNewSideChat(parentId);
	const question = opts.question?.trim();
	if (opts.draft) useComposer.getState().setSideChatDraft(tabId, opts.draft);
	if (question) {
		try {
			await sendFirstMessage({
				parentId,
				tabId,
				text: question,
				annotations: useComposer.getState().annotations[sideChatAnnKey(parentId)],
				model: sideChatDefaultModelArg(),
			});

		} catch (err) {
			const composer = useComposer.getState();
			if (!composer.sideChatDrafts[tabId]) composer.setSideChatDraft(tabId, question);
			throw err;
		}
	}
	return tabId;
}

export const HANDBACK_MODAL = "side-chat-handback";

/**
 * 「回传给父会话」 (summary mode), user click only: open the dialog and have the
 * side chat write its settled conclusions. Refuses while the side chat is
 * mid-turn (the instruction would queue behind that turn).
 */
export async function openHandback(childId: string): Promise<void> {
	if (!useSessions.getState().sessions[childId]?.parentId) {
		toast.error(tNow("sidechat.parentNotFound"));
		return;
	}
	const running = useHandback.getState().runs[childId]?.phase === "running";
	if (!running && isSideChatBusy(childId)) {
		toast.info(tNow("sidechat.sideChatBusyWait"));
		return;
	}
	useUi.getState().openModal(HANDBACK_MODAL, { childId });
	await startHandback(childId);
}

/** Stage `text` as a quote chip in the parent's main composer, show the parent and focus its composer. Never sends. */
export function stageInParent(childId: string, text: string): boolean {
	const child = useSessions.getState().sessions[childId];
	if (!child?.parentId || !text.trim()) return false;
	const composer = useComposer.getState();
	composer.addAnnotation(child.parentId, handbackAnnotation(text, child.title));
	useUi.getState().selectSession(child.parentId);
	composer.focusComposer(child.parentId);
	return true;
}

/** Put `text` straight into the parent's main composer input (appended to what is already typed), show the parent and focus its composer. Never sends. */
export function insertInParentComposer(childId: string, text: string): boolean {
	const child = useSessions.getState().sessions[childId];
	if (!child?.parentId || !text.trim()) return false;
	const composer = useComposer.getState();
	composer.setDraft(child.parentId, appendToDraft(composer.drafts[child.parentId], text));
	useUi.getState().selectSession(child.parentId);
	composer.focusComposer(child.parentId);
	return true;
}

/** Extra actions of one side chat: tab context menu and the panel's 更多 menu. */
export const SIDE_CHAT_TAB_ACTIONS: readonly {
	key: string;
	label: string;
	run: (childId: string) => void | Promise<void>;
}[] = [
	{ key: "main", get label() { return tNow("sidechat.openInMain"); }, run: (id) => useUi.getState().selectSession(id) },
	{ key: HANDBACK_ACTION_KEY, get label() { return tNow("sidechat.handbackToParent"); }, run: openHandback },
];
