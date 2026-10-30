/** Prewarming and atomic local-draft → real-session handoff. */

import { createSession } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { buildSetModelPayload, parseModels, resolveThinkingLevels, toModelKey } from "../../lib/models";
import { parseSelection } from "../../components/modelSelectLogic";
import { deleteSession, rpcRelease, rpcRetain, rpcSend, rpcTouch } from "../../lib/ipc";
import { hasLiveUserActivity, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useModelCatalog } from "../../stores/modelCatalog";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { loadChip, saveChip } from "../chat/slash/chip";
import { isBlankLocalDraft, usePendingSession, type LocalDraft } from "./pendingSession";

/** In-flight spawns, one per draft (single-flight). */
const starts = new Map<string, Promise<string>>();
/** In-flight handoffs, one per draft: a double Enter must send once. */
const handoffs = new Map<string, Promise<string>>();
const lastTouch = new Map<string, number>();
const TOUCH_INTERVAL_MS = 10_000;

/** Any user input worth keeping a process for (text, attachment, chip, plan, model/thinking). */
export function hasMeaningfulDraft(id: string): boolean {
	const draft = usePendingSession.getState().drafts[id];
	return draft ? !isBlankLocalDraft(draft) : false;
}

/** Keep the owned process fresh for the idle recycler; throttled per draft. */
export function touchDraft(id: string): void {
	const sessionId = usePendingSession.getState().drafts[id]?.sessionId;
	if (!sessionId) return;
	const now = Date.now();
	if (now - (lastTouch.get(id) ?? 0) < TOUCH_INTERVAL_MS) return;
	lastTouch.set(id, now);
	void rpcTouch(sessionId).catch(() => {});
}

/**
 * One process per draft; failed starts are retryable and never discard input.
 * The new process is retained so the idle recycler cannot close it mid-edit.
 */
export function prewarmDraft(id: string): Promise<string> {
	const existing = starts.get(id);
	if (existing) return existing;
	const draft = usePendingSession.getState().drafts[id];
	if (!draft) return Promise.reject(new Error("Draft no longer exists"));
	if (draft.sessionId) return Promise.resolve(draft.sessionId);
	const pending = (async () => {
		const { sessionId, stub } = await createSession(draft.opts);
		if (!usePendingSession.getState().drafts[id]) {
			// Discarded while spawning: nothing owns this process any more.
			await rpcRelease(sessionId).catch(() => {});
			await deleteSession(sessionId).catch(() => {});
			throw new Error("Draft no longer exists");
		}
		usePendingSession.getState().attach(id, sessionId);
		useSessions.getState().upsert([stub]);
		await rpcRetain(sessionId).catch((err) => console.warn("[draft] retain failed", id, err));
		return sessionId;
	})().catch((err) => {
		usePendingSession.getState().update(id, { startError: errMsg(err) });
		throw err;
	}).finally(() => starts.delete(id));
	starts.set(id, pending);
	return pending;
}

/**
 * Prewarm after meaningful input. A draft whose last start failed waits for an
 * explicit action (Enter, model/thinking change) instead of respawning per keystroke.
 */
export function warmDraft(id: string): void {
	const draft = usePendingSession.getState().drafts[id];
	if (!draft || isBlankLocalDraft(draft)) return;
	touchDraft(id);
	if (draft.sessionId || draft.startError) return;
	void prewarmDraft(id).catch(() => {});
}

export function setDraftModel(id: string, model: string): void {
	const draft = usePendingSession.getState().drafts[id];
	if (!draft) return;
	// Keep an explicit thinking choice unless the new model cannot honour it.
	let thinking = draft.thinking;
	if (thinking) {
		const selector = parseSelection(model).selector;
		const option = parseModels(useModelCatalog.getState().models ?? [])
			.find((m) => toModelKey(m.provider, m.id) === selector);
		if (!resolveThinkingLevels(null, option?.thinking).includes(thinking)) thinking = null;
	}
	usePendingSession.getState().update(id, { model, thinking, startError: null });
}

export function setDraftThinking(id: string, thinking: string): void {
	usePendingSession.getState().update(id, { thinking, startError: null });
}

/** Apply the user's model, then thinking level, to the freshly started process. */
async function applyLatestSettings(draft: LocalDraft, sessionId: string): Promise<void> {
	const modelChanged = draft.model !== (draft.opts.model ?? null);
	if (!modelChanged && draft.thinking === null) return;
	const parsed = parseSelection(draft.model);
	if (modelChanged && parsed.selector) {
		let models = parseModels(useModelCatalog.getState().models ?? []);
		if (models.length === 0) {
			await useModelCatalog.getState().refresh();
			models = parseModels(useModelCatalog.getState().models ?? []);
		}
		const payload = buildSetModelPayload(parsed.selector, models);
		if (!payload) throw new Error(`Unknown model: ${parsed.selector}`);
		await rpcSend(sessionId, payload);
	}
	const thinking = draft.thinking ?? (modelChanged ? parsed.level : null);
	if (thinking) await rpcSend(sessionId, { type: "set_thinking_level", level: thinking });
	await rpcSend(sessionId, { type: "get_state" });
}

/** Move all persisted composer state before the new view mounts. */
export function transferDraft(id: string, sessionId: string): void {
	const c = useComposer.getState();
	const text = c.drafts[id];
	if (text !== undefined) c.setDraft(sessionId, text);
	for (const a of c.annotations[id] ?? []) {
		const { id: _id, ...value } = a;
		c.addAnnotation(sessionId, value);
	}
	if (c.images[id]) c.setImages(sessionId, [...c.images[id]]);
	if (c.files[id]) c.setFiles(sessionId, [...c.files[id]]);
	saveChip(sessionId, loadChip(id));
	saveChip(id, null);
	c.pruneSessions([id]);
	lastTouch.delete(id);
}

/**
 * Wait for the process, apply model → thinking, move the composer state and
 * swap the view. Single-flight per draft; on failure the draft is untouched
 * and carries `startError`. The process stays retained; callers release it.
 */
function handoff(id: string): Promise<string> {
	const existing = handoffs.get(id);
	if (existing) return existing;
	const pending = (async () => {
		try {
			const sessionId = await prewarmDraft(id);
			const draft = usePendingSession.getState().drafts[id];
			if (!draft) throw new Error("Draft no longer exists");
			await applyLatestSettings(draft, sessionId);
			const ui = useUi.getState();
			const visible = usePendingSession.getState().selectedId === id &&
				ui.selectedSessionId === null &&
				(ui.centerView === "session" ||
					(ui.centerView === "settings" && ui.previousCenterView === "session"));
			transferDraft(id, sessionId);
			// Select before dropping the draft so the center pane never flashes empty.
			if (visible) {
				ui.selectSession(sessionId);
				if (ui.centerView === "settings") {
					useUi.setState({ centerView: "settings", previousCenterView: "session" });
				}
				useComposer.getState().focusComposer(sessionId);
			}
			usePendingSession.getState().discard(id);
			return sessionId;
		} catch (err) {
			usePendingSession.getState().update(id, { startError: errMsg(err) });
			throw err;
		}
	})().finally(() => handoffs.delete(id));
	handoffs.set(id, pending);
	return pending;
}

/** Turn a draft into its real session without sending (native slash actions). */
export async function materializeDraft(id: string): Promise<string> {
	const sessionId = await handoff(id);
	await rpcRelease(sessionId).catch(() => {});
	return sessionId;
}

/**
 * First send from a draft: spawn (or join the prewarm), apply the chosen
 * model and thinking level, move the composer state, then run `send(realId)`
 * exactly once. A second call while one is in flight is ignored. Rejects, with
 * the draft intact, when no session could be started.
 */
export async function sendFromDraft(
	id: string,
	send: (sessionId: string) => Promise<void>,
): Promise<void> {
	if (handoffs.has(id)) return;
	const sessionId = await handoff(id);
	try {
		await send(sessionId);
	} finally {
		await rpcRelease(sessionId).catch(() => {});
	}
}

function isIdleBlankSession(sessionId: string): boolean {
	const meta = useSessions.getState().sessions[sessionId];
	if (!meta) return true;
	return meta.status === "idle" && !meta.title.trim() && !meta.label.trim() &&
		!meta.lastAssistant && !hasLiveUserActivity(useLive.getState().sessions[sessionId]);
}

/** Stop the prewarmed process of a draft and forget its stub. */
async function dropProcess(sessionId: string): Promise<void> {
	useSessions.getState().remove([sessionId]);
	await rpcRelease(sessionId).catch(() => {});
	await deleteSession(sessionId).catch(() => {});
}

/** Blank and idle: release the prewarmed process but keep the (reusable) draft. */
export async function releaseBlankDraft(id: string): Promise<void> {
	const draft = usePendingSession.getState().drafts[id];
	if (!draft || !isBlankLocalDraft(draft) || !draft.sessionId) return;
	if (starts.has(id) || handoffs.has(id) || !isIdleBlankSession(draft.sessionId)) return;
	usePendingSession.getState().attach(id, null);
	await dropProcess(draft.sessionId);
}

/**
 * Provider config changed: prewarmed processes loaded an older models.yml.
 * Drop every idle, blank prewarmed process; drafts keep their input and respawn lazily.
 */
export async function invalidateWarmDrafts(): Promise<void> {
	const drafts = Object.entries(usePendingSession.getState().drafts);
	await Promise.all(drafts.map(async ([id, draft]) => {
		const sessionId = draft.sessionId;
		if (!sessionId || starts.has(id) || handoffs.has(id) || !isIdleBlankSession(sessionId)) return;
		usePendingSession.getState().attach(id, null);
		await dropProcess(sessionId);
	}));
}

/** Explicit user discard: input, draft and any prewarmed process are removed. */
export async function discardDraft(id: string): Promise<void> {
	const draft = usePendingSession.getState().drafts[id];
	if (!draft || handoffs.has(id)) return;
	usePendingSession.getState().discard(id);
	saveChip(id, null);
	useComposer.getState().pruneSessions([id]);
	lastTouch.delete(id);
	if (!draft.sessionId) return;
	if (isIdleBlankSession(draft.sessionId)) await dropProcess(draft.sessionId);
	else await rpcRelease(draft.sessionId).catch(() => {});
}
