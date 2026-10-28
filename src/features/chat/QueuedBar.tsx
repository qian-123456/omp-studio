/** [B] Held-queue sending: merge every ready item at turn end, plus send-now
 * for one item. Queued items appear as grey bubbles in the thread. */

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { errMsg } from "../../lib/dialogs";
import { rpcSend } from "../../lib/ipc";
import { isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";
import { useSettings } from "../settings/store";
import { dropEchoesForTexts, isFlowBusy, restoreTextsToDraft, useLive } from "../../stores/live";
import { type HeldItem, heldQueueItems, mergeHeldItems, useHeldQueue } from "./heldQueue";
import { sendPrompt } from "./send";

const EMPTY_LIST: HeldItem[] = [];
/** Sessions with an auto-send in flight (guards concurrent drains). */
const draining = new Set<string>();

export interface ReadyHeldBatch {
	items: HeldItem[];
	originalItems: HeldItem[];
}

/** Reserve the currently ready messages so a user send and drain cannot duplicate them. */
export function takeReadyHeldBatch(sid: string, allowStreaming = false): ReadyHeldBatch | null {
	if (draining.has(sid)) return null;
	const live = useLive.getState().sessions[sid];
	if (live && (isFlowBusy(live) || (!allowStreaming && live.streaming))) return null;
	const originalItems = heldQueueItems(sid);
	const busy = useQueuedBusy.getState().busy;
	const items = originalItems.filter((item) => item.text.trim() && !(item.id in busy));
	if (items.length === 0) return null;
	draining.add(sid);
	const ids = new Set(items.map((item) => item.id));
	const queue = useHeldQueue.getState();
	for (let i = (queue.queues[sid]?.length ?? 0) - 1; i >= 0; i--) {
		if (ids.has(queue.queues[sid][i].id)) queue.remove(sid, i);
	}
	return { items, originalItems };
}

/** Restore exactly the reserved snapshot after a failed or cancelled send. */
export function restoreReadyHeldBatch(sid: string, batch: ReadyHeldBatch): void {
	useHeldQueue.getState().restore(sid, batch.items, batch.originalItems);
}

export function releaseReadyHeldBatch(sid: string): void {
	draining.delete(sid);
}

/** Send all ready queued items for `sid` as one prompt. */
export async function drainNext(sid: string): Promise<boolean> {
	const batch = takeReadyHeldBatch(sid);
	if (!batch) return false;
	const { text, images } = mergeHeldItems(batch.items);
	try {
		await sendPrompt(sid, text, images.length ? { images } : undefined);
		return true;
	} catch (err) {
		restoreReadyHeldBatch(sid, batch);
		if (!isResumeCancelled(err)) toast.error(tNow("chatView.queue.sendFailed", { error: errMsg(err) }));
		return false;
	} finally {
		releaseReadyHeldBatch(sid);
	}
}

const autoSendEnabled = (): boolean => useSettings.getState().settings?.queueAutoSend !== false;

/** Drain on every session's turn end (streaming true→false), mounted or not.
 * Installed once at module load. */
useLive.subscribe((state, prev) => {
	if (state.sessions === prev.sessions) return;
	for (const sid of Object.keys(state.sessions)) {
		const cur = state.sessions[sid];
		const was = prev.sessions[sid];
		if (!cur || !was || !autoSendEnabled()) continue;
		const turnEnded = was.streaming && cur.streaming === false;
		// A compaction/handoff that ended while idle releases held items too.
		const flowCleared = isFlowBusy(was) && !isFlowBusy(cur) && !cur.streaming && cur.alive === true;
		// A session brought alive while idle (resume, start-on-type) releases
		// items queued before it was running.
		const becameAlive = was.alive !== true && cur.alive === true && !cur.streaming && !isFlowBusy(cur);
		if (turnEnded || flowCleared || becameAlive) void drainNext(sid);
	}
});

/** Returns the effective `queueAutoSend` setting (undefined = enabled). Turn-end
 * draining is global (above); on mount, an idle session that still has queued
 * items (e.g. after a reload or a switch) is drained too. */
export function useQueueAutoSend(sid: string, streaming: boolean): boolean {
	const autoSend = useSettings((s) => s.settings?.queueAutoSend) !== false;
	const streamingRef = useRef(streaming);
	streamingRef.current = streaming;
	useEffect(() => {
		if (!autoSend || streamingRef.current || useLive.getState().sessions[sid]?.alive !== true) return;
		if (heldQueueItems(sid).length > 0) void drainNext(sid);
	}, [sid, autoSend]);
	return autoSend;
}

/** Per-item in-flight state of the queue actions (send-now / remove / promote). */
export const useQueuedBusy = create<{ busy: Record<string, true> }>(() => ({ busy: {} }));
const setBusy = (id: string, on: boolean) =>
	useQueuedBusy.setState((s) => {
		if (on === (id in s.busy)) return s;
		const busy = { ...s.busy };
		if (on) busy[id] = true;
		else delete busy[id];
		return { busy };
	});

/** Send queued item `i` now (steer or normal follow-up); removed only on success.
 * A second call while one is in flight, or for an item the turn-end drain
 * already took, sends nothing. */
export async function sendQueuedNow(sid: string, item: HeldItem, steer: boolean): Promise<void> {
	if (draining.has(sid) || item.id in useQueuedBusy.getState().busy) return;
	if (!(useHeldQueue.getState().queues[sid] ?? EMPTY_LIST).some((x) => x.id === item.id)) return;
	setBusy(item.id, true);
	try {
		await sendPrompt(sid, item.text, { steer, ...(item.images?.length ? { images: item.images } : {}) });
		const q = useHeldQueue.getState();
		const idx = (q.queues[sid] ?? EMPTY_LIST).findIndex((x) => x.id === item.id);
		if (idx >= 0) q.remove(sid, idx);
	} catch (err) {
		if (!isResumeCancelled(err)) toast.error(tNow("chatView.queue.sendFailed", { error: errMsg(err) }));
	} finally {
		setBusy(item.id, false);
	}
}

/** Take an omp-side queued echo back out of omp's queue and into the composer draft. */
export async function removeOmpQueued(
	sid: string,
	echo: { id: string; text?: string | null },
	queue: "steering" | "followUp",
): Promise<void> {
	if (echo.id in useQueuedBusy.getState().busy) return;
	const text = echo.text ?? "";
	setBusy(echo.id, true);
	try {
		await rpcSend(sid, { type: "remove_queued_message", message: text, queue });
		dropEchoesForTexts(sid, [text]);
		restoreTextsToDraft(sid, [text]);
	} catch (err) {
		toast.error(tNow("chatView.queue.removeFailed", { error: errMsg(err) }));
	} finally {
		setBusy(echo.id, false);
	}
}

/** Move an omp-side queued follow-up to the steering queue (插队). */
export async function promoteOmpQueued(sid: string, echo: { id: string; text?: string | null }): Promise<void> {
	if (echo.id in useQueuedBusy.getState().busy) return;
	setBusy(echo.id, true);
	try {
		await rpcSend(sid, { type: "promote_queued_message", message: echo.text ?? "" });
	} catch (err) {
		toast.error(tNow("chatView.queue.promoteFailed", { error: errMsg(err) }));
	} finally {
		setBusy(echo.id, false);
	}
}
