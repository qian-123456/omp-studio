import { backlogUpdate } from "../../lib/ipc";
import type { BacklogItem } from "../../lib/contracts";
import { useComposer } from "../../stores/composer";
import { onPromptSend, type PromptSendPhase } from "../../stores/promptSendEvents";
import { useBacklog } from "./backlogStore";
import { refImagePaths, storedImagePaths, toComposerText } from "./ideaTokens";
import { appendToDraft, buildBatchFillText } from "./ideasLogic";

/**
 * 「放进输入框」: filling never changes an item's status. A pending fill (in memory only, so a
 * reload leaves the item in the inbox) turns the item `dispatched` once that session's composer
 * actually sends text containing the filled body. If the draft no longer contains the body
 * before a send, the pending entry is dropped and the item stays inbox.
 */
interface PendingFill {
	itemId: string;
	/** Body text fragments between composer image tokens; all must appear in the draft / sent text. */
	fragments: string[];
	/** A send that contains this body is in flight (the draft is cleared on echo, before success). */
	inflight: boolean;
}

const COMPOSER_IMAGE_TOKEN = /🖼️#\d+/g;
const pending = new Map<string, PendingFill[]>();
let unsubs: Array<() => void> = [];

const fragmentsOf = (body: string): string[] =>
	body
		.split(COMPOSER_IMAGE_TOKEN)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

const containsBody = (text: string, p: PendingFill): boolean =>
	p.fragments.length > 0 ? p.fragments.every((f) => text.includes(f)) : text.trim().length > 0;

function setPending(sessionId: string, list: PendingFill[]): void {
	if (list.length > 0) pending.set(sessionId, list);
	else pending.delete(sessionId);
	if (pending.size === 0) detach();
}

function onDraftsChanged(sessionId: string, draft: string): void {
	const list = pending.get(sessionId);
	if (!list) return;
	const kept = list.filter((p) => p.inflight || containsBody(draft, p));
	if (kept.length !== list.length) setPending(sessionId, kept);
}

function onSend(phase: PromptSendPhase, sessionId: string, text: string): void {
	const list = pending.get(sessionId);
	if (!list) return;
	if (phase === "echoed") {
		for (const p of list) if (containsBody(text, p)) p.inflight = true;
		return;
	}
	const flying = list.filter((p) => p.inflight);
	if (flying.length === 0) return;
	if (phase === "failed") {
		// The composer restores the draft; keep tracking and let draft edits decide.
		for (const p of flying) p.inflight = false;
		return;
	}
	setPending(sessionId, list.filter((p) => !p.inflight));
	void markDispatched(
		flying.map((p) => p.itemId),
		sessionId,
	);
}

async function markDispatched(ids: string[], sessionId: string): Promise<void> {
	try {
		await Promise.all(ids.map((id) => backlogUpdate(id, { status: "dispatched", targetSessionId: sessionId })));
	} catch {
		// Best effort: the items simply stay inbox.
	}
	await useBacklog.getState().load();
}

function attach(): void {
	if (unsubs.length > 0) return;
	let prev = useComposer.getState().drafts;
	unsubs = [
		onPromptSend(onSend),
		useComposer.subscribe((s) => {
			const drafts = s.drafts;
			if (drafts === prev) return;
			const before = prev;
			prev = drafts;
			for (const sessionId of pending.keys()) {
				if (drafts[sessionId] !== before[sessionId]) onDraftsChanged(sessionId, drafts[sessionId] ?? "");
			}
		}),
	];
}

function detach(): void {
	for (const u of unsubs) u();
	unsubs = [];
}

/** Drop all pending fills (tests, store resets). */
export function resetPendingFills(): void {
	pending.clear();
	detach();
}

/**
 * Append items to the session's composer draft (images become composer attachments), focus the
 * composer and register a pending fill. Never sets status itself.
 */
export function fillIdeasIntoComposer(sessionId: string, items: BacklogItem[]): void {
	if (items.length === 0) return;
	const composer = useComposer.getState();
	const paths = items.flatMap((it) => storedImagePaths(it.text, refImagePaths(it.refs)));
	const numbers = composer.attachImages(sessionId, paths);
	const numberByPath = new Map(paths.map((p, i) => [p, numbers[i]]));
	const numberOf = (p: string) => numberByPath.get(p) ?? 0;
	const bodies = items.map((it) => ({ kind: it.kind, body: toComposerText(it.text, refImagePaths(it.refs), numberOf) }));
	const text = items.length === 1 ? bodies[0].body : buildBatchFillText(bodies);

	const known = pending.get(sessionId) ?? [];
	const fresh: PendingFill[] = items
		.map((it, i) => ({ itemId: it.id, fragments: fragmentsOf(bodies[i].body), inflight: false }))
		.filter((p) => !known.some((k) => k.itemId === p.itemId));
	pending.set(sessionId, [...known, ...fresh]);
	attach();

	composer.setDraft(sessionId, appendToDraft(composer.drafts[sessionId] ?? "", text));
	composer.focusComposer(sessionId);
}
