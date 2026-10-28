/**
 * Pure logic of 「回传给父会话」: the instruction sent to the side chat, draft
 * extraction from its transcript, the quote that lands in the parent composer
 * and which entry points the `sideChatHandback` preference shows.
 */

import type { TranscriptItem } from "../../lib/contracts";
import type { Annotation } from "../../stores/composer";
import type { SideChatHandbackMode } from "../../stores/displayPrefs";
import { tNow } from "../../stores/language";

/** First line of the instruction; marks the user message in the side-chat transcript. */
export const HANDBACK_MARKER = "【回传整理】";

/** Sent into the side chat only after the user clicked 「回传给父会话」. */
export const HANDBACK_PROMPT = `${HANDBACK_MARKER}请把我们在这个辅助对话里讨论并确定下来的内容，整理成一份可以交给主会话的结论。

要求：
- 写出：已经定下来的结论或决定、关键理由、还没解决的问题和待办。
- 只写讨论中确认过的内容，不要加入新的建议，也不要重复讨论过程。
- 写成简洁、自包含的一段说明，主会话没有看过这段对话，也能直接读懂。
- 直接输出正文，不要开场白，不要结束语，不要调用工具。`;

/** Tab-menu / 更多 action key that hands the conclusion back. */
export const HANDBACK_ACTION_KEY = "back";

/** Summary mode shows the 回传给父会话 button; select mode hides it. */
export const showHandbackButton = (mode: SideChatHandbackMode): boolean => mode === "summary";

/** Select mode adds 「发到主对话」 to the selection bubble, only inside a side chat. */
export const showSendToMainBubbleAction = (mode: SideChatHandbackMode, inSideChat: boolean): boolean =>
	mode === "select" && inSideChat;

/** Side-chat actions visible for `mode` (the handback action is summary-mode only). */
export function visibleSideChatActions<T extends { key: string }>(
	actions: readonly T[],
	mode: SideChatHandbackMode,
): T[] {
	return actions.filter((a) => a.key !== HANDBACK_ACTION_KEY || showHandbackButton(mode));
}

const isHandbackPrompt = (it: TranscriptItem): boolean =>
	it.kind === "user" && (it.text ?? "").trimStart().startsWith(HANDBACK_MARKER);

export type DraftResult = { ok: true; text: string } | { ok: false; pending: boolean; error?: string };

/**
 * The note written in answer to the LAST handback instruction: the last
 * assistant text after it. `pending` = the instruction or its answer is not in
 * the transcript yet (caller may retry); otherwise `error` explains the failure.
 */
export function extractHandbackDraft(
	items: readonly TranscriptItem[],
	previouslySeenIds?: ReadonlySet<string>,
): DraftResult {
	let start = -1;
	for (let i = items.length - 1; i >= 0; i--) {
		if (
			isHandbackPrompt(items[i]) &&
			(!previouslySeenIds || !previouslySeenIds.has(items[i].id))
		) {
			start = i;
			break;
		}
	}
	if (start < 0) return { ok: false, pending: true };
	const after = items.slice(start + 1).filter((it) => it.kind === "assistant");
	if (after.length === 0) return { ok: false, pending: true };
	const withText = after.filter((it) => it.text?.trim());
	const last = withText[withText.length - 1];
	if (last && last.stopReason !== "error" && last.stopReason !== "aborted") {
		return { ok: true, text: last.text!.trim() };
	}
	const tail = after[after.length - 1];
	if (tail.stopReason === "aborted") return { ok: false, pending: false, error: tNow("sidechat.handbackAborted") };
	if (tail.stopReason === "error") return { ok: false, pending: false, error: tNow("sidechat.handbackModelError") };
	return { ok: false, pending: false, error: tNow("sidechat.handbackNoText") };
}

/** Visible user/assistant text before the handback instruction, as `用户：…` / `助手：…` lines. */
export function transcriptText(items: readonly TranscriptItem[]): string {
	const out: string[] = [];
	for (const it of items) {
		if (isHandbackPrompt(it)) break;
		if (it.hidden) continue;
		const text = it.text?.trim();
		if (!text) continue;
		if (it.kind === "user") out.push(`用户：${text}`);
		else if (it.kind === "assistant") out.push(`助手：${text}`);
	}
	return out.join("\n\n");
}

/** Note + optional collapsed full conversation. */
export function buildHandbackText(note: string, transcript: string | null): string {
	const body = note.trim();
	if (!transcript?.trim()) return body;
	const quoted = transcript
		.trim()
		.split("\n")
		.map((l) => `> ${l}`)
		.join("\n");
	return `${body}\n\n<details>\n<summary>完整对话</summary>\n\n${quoted}\n\n</details>`;
}

/** Source label of the quote chip created in the parent composer. */
export const handbackLabel = (title: string | null | undefined): string =>
	`来自辅助对话：${title?.trim() || "未命名"}`;

/** The parent-composer quote chip (no comment; the note is its text). */
export function handbackAnnotation(text: string, title: string | null | undefined): Omit<Annotation, "id"> {
	return { source: "message", text: text.trim(), label: handbackLabel(title) };
}

/** Append `note` to an existing composer draft, separated by a blank line (no draft: the note alone). */
export function appendToDraft(draft: string | undefined, note: string): string {
	const add = note.trim();
	const cur = (draft ?? "").replace(/\s+$/, "");
	if (!add) return draft ?? "";
	return cur ? `${cur}\n\n${add}` : add;
}
