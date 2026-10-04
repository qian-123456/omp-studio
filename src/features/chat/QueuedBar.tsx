/** [B] Codex-style queue: popover list above the composer while a turn streams,
 * plus the turn-end auto-send drain (one item per turn end). */

import { CornerDownLeft, CornerDownRight, ImageIcon, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errMsg } from "../../lib/dialogs";
import { isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useSettings } from "../settings/store";
import { type HeldItem, useHeldQueue } from "./heldQueue";
import { stripImageMarkers } from "./MessageList";
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
async function sendQueuedNow(sid: string, item: HeldItem, steer: boolean): Promise<void> {
	try {
		await sendPrompt(sid, item.text, { steer, ...(item.images?.length ? { images: item.images } : {}) });
		const q = useHeldQueue.getState();
		const idx = (q.queues[sid] ?? EMPTY_LIST).findIndex((x) => x.id === item.id);
		if (idx >= 0) q.remove(sid, idx);
	} catch (err) {
		if (!isResumeCancelled(err)) toast.error(`排队消息发送失败: ${errMsg(err)}`);
	}
}

function QueuedRow({ sid, item, index }: { sid: string; item: HeldItem; index: number }) {
	const remove = useHeldQueue((s) => s.remove);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (e: MouseEvent) => {
			if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [menuOpen]);
	const text = stripImageMarkers(item.text).trim() || "（图片）";
	const iconBtn =
		"shrink-0 rounded p-1 text-[var(--text-40)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] transition-colors";
	return (
		<div className="flex items-center gap-2 px-3 py-2">
			<CornerDownRight size={13} className="shrink-0 text-[var(--text-40)]" />
			<span className="min-w-0 flex-1 truncate text-[var(--text-60)]" title={text}>
				{text}
			</span>
			{item.images?.length ? (
				<span className="flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--ghost-hover)] px-1.5 text-[10px] text-[var(--text-40)]">
					<ImageIcon size={10} />#{item.images.length}
				</span>
			) : null}
			<button
				type="button"
				title="立即插队发送打断"
				aria-label="插队"
				onClick={() => void sendQueuedNow(sid, item, true)}
				className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[var(--text-40)] hover:text-[var(--text)] transition-colors"
			>
				<CornerDownLeft size={12} />
				<span>插队</span>
			</button>
			<button type="button" aria-label="移出队列" title="移出队列" onClick={() => remove(sid, index)} className={iconBtn}>
				<Trash2 size={13} />
			</button>
			<div ref={menuRef} className="relative shrink-0">
				<button
					type="button"
					aria-label="更多"
					title="更多"
					aria-expanded={menuOpen}
					onClick={() => setMenuOpen((v) => !v)}
					className={iconBtn}
				>
					<MoreHorizontal size={13} />
				</button>
				{menuOpen && (
					<div className="absolute top-1/2 right-full z-50 mr-1 min-w-[72px] -translate-y-1/2 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] py-0.5 shadow-lg">
						<button
							type="button"
							onClick={() => {
								setMenuOpen(false);
								void sendQueuedNow(sid, item, false);
							}}
							className="block w-full px-3 py-1 text-left text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						>
							发送
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

export function QueuedBar({ sessionId }: { sessionId: string }) {
	const items = useHeldQueue((s) => s.queues[sessionId] ?? EMPTY_LIST);
	if (items.length === 0) return null;
	return (
		<div className="mx-3 mb-1.5 rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] text-[12px] shadow-[0_1px_0_var(--line)]">
			<div className="max-h-40 divide-y divide-[var(--line)] overflow-y-auto">
				{items.map((item, i) => (
					<QueuedRow key={item.id} sid={sessionId} item={item} index={i} />
				))}
			</div>
		</div>
	);
}
