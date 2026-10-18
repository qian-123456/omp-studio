/** [B] Held-queue sending: the turn-end auto-send drain (one item per turn
 * end) and send-now for one item. The queued items themselves are shown as
 * grey "排队中" bubbles in the thread (QueuedBubbles). */

import { useEffect, useRef } from "react";
import { errMsg } from "../../lib/dialogs";
import { isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useSettings } from "../settings/store";
import { type HeldItem, useHeldQueue } from "./heldQueue";
import { sendPrompt } from "./send";

const EMPTY_LIST: HeldItem[] = [];
/** Sessions with an auto-send in flight (guards concurrent drains). */
const draining = new Set<string>();

/** Send the first queued item for `sid`. Returns false when nothing was sent. */
export async function drainNext(sid: string): Promise<boolean> {
	if (draining.has(sid)) return false;
	const item = useHeldQueue.getState().shift(sid);
	if (!item) return false;
	draining.add(sid);
	try {
		await sendPrompt(sid, item.text, item.images?.length ? { images: item.images } : undefined);
		return true;
	} catch (err) {
		useHeldQueue.getState().unshift(sid, item);
		if (!isResumeCancelled(err)) toast.error(`排队消息发送失败: ${errMsg(err)}`);
		return false;
	} finally {
		draining.delete(sid);
	}
}

/** On streaming true→false, auto-send the next queued item when `queueAutoSend`
 * is enabled (undefined = enabled). Returns the effective setting. */
export function useQueueAutoSend(sid: string, streaming: boolean): boolean {
	const autoSend = useSettings((s) => s.settings?.queueAutoSend) !== false;
	const prev = useRef(streaming);
	useEffect(() => {
		const was = prev.current;
		prev.current = streaming;
		if (was && !streaming && autoSend) void drainNext(sid);
	}, [sid, streaming, autoSend]);
	return autoSend;
}

/** Send queued item `i` now (steer or normal follow-up); removed only on success. */
export async function sendQueuedNow(sid: string, item: HeldItem, steer: boolean): Promise<void> {
	try {
		await sendPrompt(sid, item.text, { steer, ...(item.images?.length ? { images: item.images } : {}) });
		const q = useHeldQueue.getState();
		const idx = (q.queues[sid] ?? EMPTY_LIST).findIndex((x) => x.id === item.id);
		if (idx >= 0) q.remove(sid, idx);
	} catch (err) {
		if (!isResumeCancelled(err)) toast.error(`排队消息发送失败: ${errMsg(err)}`);
	}
}
