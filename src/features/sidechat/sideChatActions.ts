/**
 * Side-chat actions shared by the panel, the tab context menu and `/btw`.
 *
 * Send flow (nothing ever starts without a user-typed message):
 *   blank tab, first message: pending bubble now -> `createSideChat` (fork, no
 *   prompt) -> echo into the new session -> bind the tab -> `sideChatAsk`.
 *   Bound tab, later messages: echo + `sendPrompt` (done by the thread view).
 */

import { createSideChat, sideChatAsk } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { type Annotation, formatWithAnnotations, sideChatAnnKey, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { sideChatDefaultModelArg } from "./modelDefault";
import { HANDBACK_ACTION_KEY, appendToDraft, handbackAnnotation } from "./handbackLogic";
import { isSideChatBusy, startHandback, useHandback } from "./handbackRun";
import { openNewSideChat, useSideChatView } from "./viewStore";

/** Question text used when the user only staged quotes. */
export const QUOTE_ONLY_QUESTION = "请结合引用内容回答";

export interface FirstMessageInput {
	parentId: string;
	/** Blank tab the message is typed in. */
	tabId: string;
	/** Trimmed user text; may be empty when annotations are staged. */
	text: string;
	annotations?: readonly Annotation[];
	/** `provider/id[:thinking]` model argument; `null` inherits the parent's. */
	model?: string | null;
}

/** The question + quote selection that `sideChatAsk` renders into the first prompt. */
export function firstMessageParts(
	text: string,
	annotations: readonly Annotation[] = [],
): { question: string; selection: string | undefined } {
	return {
		question: text || QUOTE_ONLY_QUESTION,
		selection: formatWithAnnotations("", [...annotations]) || undefined,
	};
}

/**
 * Send the first message of a blank tab. The pending bubble appears before any
 * backend call. Rejects only if the session could not be created (nothing was
 * started); a failed ask after creation is reported by a toast and keeps the
 * tab bound to the new session.
 */
export async function sendFirstMessage(input: FirstMessageInput): Promise<void> {
	const { parentId, tabId, annotations } = input;
	const { question, selection } = firstMessageParts(input.text, annotations);
	const view = useSideChatView.getState();
	view.setPending(tabId, question);
	let sessionId: string;
	try {
		const info = await createSideChat(parentId, input.model ?? undefined);
		sessionId = info.sessionId;
		// Echo first so the bubble is there the moment the thread view mounts.
		useLive.getState().addUserEcho(sessionId, question);
		await useSessions.getState().load().catch(() => {});
		view.bindTab(parentId, tabId, sessionId);
		// The quotes were consumed into the first prompt.
		if (annotations?.length) useComposer.getState().clearAnnotations(sideChatAnnKey(parentId));
	} catch (err) {
		view.setPending(tabId, null);
		throw err;
	}
	view.setPending(tabId, null);
	try {
		await sideChatAsk(sessionId, question, selection);
	} catch (err) {
		toast.error(`发送侧聊消息失败: ${err instanceof Error ? err.message : String(err)}`);
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
			useComposer.getState().setSideChatDraft(tabId, question);
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
		toast.error("未找到父会话");
		return;
	}
	const running = useHandback.getState().runs[childId]?.phase === "running";
	if (!running && isSideChatBusy(childId)) {
		toast.info("辅助对话正在回复，等它结束后再回传");
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
	{ key: "main", label: "在主视图打开", run: (id) => useUi.getState().selectSession(id) },
	{ key: HANDBACK_ACTION_KEY, label: "回传给父会话", run: openHandback },
];
