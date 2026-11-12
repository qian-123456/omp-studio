/**
 * Side-chat actions shared by the panel, the tab context menu and `/btw`.
 *
 * Send flow (nothing ever starts without a user-typed message):
 *   blank tab: pending bubble -> create (once) -> echo + first ask -> bind.
 *   Failed asks keep the blank composer and created session for a first-ask retry.
 *   Bound tab, later messages: echo + `sendPrompt` (done by the thread view).
 */

import type { ComposerImage } from "../../stores/composer";
import { createSideChat, deleteSession, rpcStop, sideChatAsk } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";
import { type Annotation, annotationImageAttachments, formatWithAnnotations, sideChatAnnKey, useComposer } from "../../stores/composer";
import { QUOTE_ONLY_QUESTION, sideChatEchoText } from "../chat/sideChatView";
import { expandImagesForSend } from "../chat/imageTokens";
import * as Send from "../chat/send";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { prepareSideChatFirstPrompt } from "../../stores/transcript";
import { useUi } from "../../stores/ui";
import { sideChatDefaultModelArg } from "./modelDefault";
import { HANDBACK_ACTION_KEY, appendToDraft, handbackAnnotation } from "./handbackLogic";
import { ensureHandbackStarted, isSideChatBusy, useHandback } from "./handbackRun";
import { removeSideChatImageToken, sideChatImageAttachments } from "./sideChatAttachments";
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

const FIRST_MESSAGE_CANCELLED = "FIRST_MESSAGE_CANCELLED";

export function isFirstMessageCancelled(err: unknown): boolean {
	return err instanceof Error && err.message === FIRST_MESSAGE_CANCELLED;
}

function cleanupOrphanSideChat(sessionId: string): void {
	void Promise.resolve(rpcStop?.(sessionId))
		.catch(() => {})
		.then(() => Promise.resolve(deleteSession?.(sessionId)).catch(() => {}));
}

// Keep it across failures so retrying does not create another side chat or use
// the ordinary send path, which would omit the first-question boundary prompt.
const firstQuestionSessions = new Map<string, string>();
const firstMessagesInFlight = new Map<
	string,
	{ promise: Promise<void>; cancel: () => void; cancelled: boolean; originalDraft: string }
>();
useSideChatView.subscribe(({ openTabs }) => {
	for (const [tabId, sessionId] of firstQuestionSessions.entries()) {
		const stillOpen = Object.values(openTabs).some((tabs) => tabs.includes(tabId));
		if (!stillOpen && !firstMessagesInFlight.has(tabId)) {
			firstQuestionSessions.delete(tabId);
			cleanupOrphanSideChat(sessionId);
		}
	}
});

/** Cancel an in-flight blank-tab first message, restoring its draft and cleaning up any unbound child. */
export function cancelFirstMessage(tabId: string): void {
	const entry = firstMessagesInFlight.get(tabId);
	if (entry) {
		entry.cancelled = true;
		entry.cancel();
		firstMessagesInFlight.delete(tabId);
		const composer = useComposer.getState();
		if (!composer.sideChatDrafts[tabId] && entry.originalDraft) {
			composer.setSideChatDraft(tabId, entry.originalDraft);
		}
	}
	useSideChatView.getState().setPending(tabId, null);
	const orphanId = firstQuestionSessions.get(tabId);
	if (orphanId) {
		firstQuestionSessions.delete(tabId);
		cleanupOrphanSideChat(orphanId);
	}
}

/** A tab owns one first-message delivery, even across panel unmounts and remounts. */
export function sendFirstMessage(input: FirstMessageInput): Promise<void> {
	const existing = firstMessagesInFlight.get(input.tabId);
	if (existing) return existing.promise;
	const originalDraft = useComposer.getState().sideChatDrafts[input.tabId] ?? input.text;
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((done, failed) => {
		resolve = done;
		reject = failed;
	});
	const entry = {
		promise,
		cancelled: false,
		originalDraft,
		cancel: () => reject(new Error(FIRST_MESSAGE_CANCELLED)),
	};
	firstMessagesInFlight.set(input.tabId, entry);
	void deliverFirstMessage(input, entry).then(
		() => {
			if (firstMessagesInFlight.get(input.tabId) === entry) {
				firstMessagesInFlight.delete(input.tabId);
			}
			resolve();
		},
		(error: unknown) => {
			if (firstMessagesInFlight.get(input.tabId) === entry) {
				firstMessagesInFlight.delete(input.tabId);
			}
			reject(error);
		},
	);
	return promise;
}

/** Failed deliveries leave staged input intact and remove only their own optimistic echo. */
async function deliverFirstMessage(
	input: FirstMessageInput,
	flight: { cancelled: boolean; originalDraft: string },
): Promise<void> {
	const { parentId, tabId, annotations = [], images = [] } = input;
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
	const allAttachments = [
		...imageAttachments,
		...annotationImageAttachments(annotations, imageAttachments),
	];
	const context = liveTurnContext(parentId);
	const originalDraft = flight.originalDraft;
	useComposer.getState().clearSideChatDraft(tabId);
	view.setPending(tabId, shown, allAttachments);
	try {
		let sessionId = firstQuestionSessions.get(tabId);
		if (!sessionId) {
			const info = await createSideChat(parentId, input.model ?? undefined);
			if (flight.cancelled) {
				cleanupOrphanSideChat(info.sessionId);
				throw new Error(FIRST_MESSAGE_CANCELLED);
			}
			sessionId = info.sessionId;
			firstQuestionSessions.set(tabId, sessionId);
		}
		if (flight.cancelled) throw new Error(FIRST_MESSAGE_CANCELLED);
		useSideChatView.getState().setPendingStage(tabId, "asking");
		await prepareSideChatFirstPrompt(sessionId);
		if (flight.cancelled) throw new Error(FIRST_MESSAGE_CANCELLED);
		// Register before IPC can emit agent_start or the first transcript page.
		// Otherwise the already-delivered first question is mistaken for queued input.
		const echoId = useLive.getState().addUserEcho(sessionId, shown, allAttachments);
		// Real image bytes go with the prompt (backend builds native ImageContent);
		// a failure rejects here, keeps the draft and never downgrades to text-only.
		const imagePaths = allAttachments.flatMap((a) => (typeof a.path === "string" && a.path ? [a.path] : []));
		try {
			await sideChatAsk(sessionId, promptQuestion, selection, context, imagePaths);
		} catch (error) {
			if (echoId) useLive.getState().removeUserEcho(sessionId, echoId);
			throw error;
		}
		if (flight.cancelled) {
			if (echoId) useLive.getState().removeUserEcho(sessionId, echoId);
			throw new Error(FIRST_MESSAGE_CANCELLED);
		}
		await useSessions.getState().load().catch(() => {});
		const composer = useComposer.getState();
		let newerDraft = composer.sideChatDrafts[tabId] ?? "";
		const currentImages = composer.images[tabId] ?? [];
		const remainingImages = currentImages.filter((image) => !images.includes(image));
		// Consume only the sent immutable snapshots. Renumber surviving tokens from
		// their current attachment positions so a newer image never inherits a sent token.
		for (let index = currentImages.length - 1; index >= 0; index--) {
			if (images.includes(currentImages[index]) && /🖼️\s*#\d+/u.test(newerDraft)) {
				newerDraft = removeSideChatImageToken(newerDraft, index + 1);
			}
		}
		if (newerDraft) composer.setDraft(sessionId, newerDraft);
		if (remainingImages.length) composer.setImages(sessionId, remainingImages);
		composer.clearSideChatDraft(tabId);
		composer.clearImages(tabId);
		for (const annotation of annotations) {
			if (composer.annotations[sideChatAnnKey(parentId)]?.includes(annotation)) {
				composer.removeAnnotation(sideChatAnnKey(parentId), annotation.id);
			}
		}
		view.bindTab(parentId, tabId, sessionId);
		firstQuestionSessions.delete(tabId);
	} catch (error) {
		const composer = useComposer.getState();
		if (!composer.sideChatDrafts[tabId]) composer.setSideChatDraft(tabId, originalDraft);
		const openTabs = useSideChatView.getState().openTabs;
		const stillOpen = Object.values(openTabs).some((tabs) => tabs.includes(tabId));
		if (!stillOpen) {
			const orphanId = firstQuestionSessions.get(tabId);
			if (orphanId) {
				firstQuestionSessions.delete(tabId);
				cleanupOrphanSideChat(orphanId);
			}
		}
		throw error;
	} finally {
		useSideChatView.getState().setPending(tabId, null);
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
 * 「回传给父会话」 (summary mode), user click only: open the dialog immediately and
 * automatically summarize settled conclusions (unless an up-to-date summary already
 * covers the latest side-chat message). Refuses while the side chat is mid-turn.
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
	await ensureHandbackStarted(childId);
}

/** Send `text` directly as a user message in the parent session and select the parent session. */
export async function sendToParentSession(childId: string, text: string): Promise<boolean> {
	const child = useSessions.getState().sessions[childId];
	const body = text.trim();
	if (!child?.parentId || !body) return false;
	useUi.getState().selectSession(child.parentId);
	await Send.sendPrompt(child.parentId, body);
	return true;
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
