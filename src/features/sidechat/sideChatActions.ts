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
import { type Annotation, annotationImageAttachments, formatWithAnnotations, sideChatAnnKey, useComposer } from "../../stores/composer";
import { QUOTE_ONLY_QUESTION, sideChatEchoText } from "../chat/sideChatView";
import { expandImagesForSend } from "../chat/imageTokens";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { sideChatDefaultModelArg } from "./modelDefault";
import { HANDBACK_ACTION_KEY, appendToDraft, handbackAnnotation } from "./handbackLogic";
import { isSideChatBusy, prefillHandbackFromExisting, useHandback } from "./handbackRun";
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

/**
 * Snapshot of the parent's in-flight turn as the user sees it right now and
 * that may not be on disk yet: unflushed user prompts, streamed prose and
 * running tool calls. Reasoning is never included. `undefined` when idle.
 */
export function liveTurnContext(parentId: string): string | undefined {
	const live = useLive.getState().sessions[parentId];
	if (!live) return undefined;
	const lines: string[] = [];
	for (const echo of live.pendingUserEchoes ?? []) {
		if (echo.held || !echo.text?.trim()) continue;
		lines.push(`[用户] ${echo.text.trim()}`);
	}
	const content = live.streamingMessage?.content;
	if (Array.isArray(content)) {
		const prose = content
			.map((p) => (p && typeof p === "object" && "type" in p && p.type === "text" && "text" in p ? String(p.text ?? "") : ""))
			.join("")
			.trim();
		if (prose) lines.push(`[助手（正在输出）] ${prose}`);
	} else if (typeof content === "string" && content.trim()) {
		lines.push(`[助手（正在输出）] ${content.trim()}`);
	}
	// Tools already in the transcript cache are covered by the backend's disk digest.
	const cached = new Set((live.items ?? []).flatMap((it) => it.toolCalls.map((c) => c.id)));
	for (const tool of Object.values(live.tools ?? {})) {
		if (cached.has(tool.toolCallId)) continue;
		let args = "";
		try {
			args = JSON.stringify(tool.args) ?? "";
		} catch {
			args = "";
		}
		const out = tool.text?.trim() ?? "";
		if (tool.status === "running") {
			lines.push(`[工具调用进行中] ${tool.toolName} ${args}${out ? ` 已有输出：${out}` : ""} （尚无最终结果）`);
		} else {
			const tag = tool.status === "error" ? "工具失败" : "工具结果";
			lines.push(`[工具调用] ${tool.toolName} ${args}\n\n[${tag} ${tool.toolName}] ${out}`);
		}
	}
	return lines.length ? lines.join("\n\n") : undefined;
}

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
		const allAttachments = [
			...imageAttachments,
			...annotationImageAttachments(annotations ?? [], imageAttachments),
		];
		// Real image bytes go with the prompt (backend builds native ImageContent);
		// a failure rejects here, keeps the draft and never downgrades to text-only.
		const imagePaths = allAttachments.flatMap((a) => (typeof a.path === "string" && a.path ? [a.path] : []));
		await sideChatAsk(sessionId, promptQuestion, selection, liveTurnContext(parentId), imagePaths);
		// Only accepted messages become user echoes or consume staged attachments.
		useLive.getState().addUserEcho(sessionId, shown, allAttachments);
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
	// Fill from the side chat's latest reply; the summarize prompt is sent only
	// when the user presses 「重新生成」 in the dialog.
	await prefillHandbackFromExisting(childId);
	useUi.getState().openModal(HANDBACK_MODAL, { childId });
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
