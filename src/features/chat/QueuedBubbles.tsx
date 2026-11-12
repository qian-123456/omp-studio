/**
 * Queued user messages in the message flow: a grey bubble with "⏳ 排队中"
 * until the message is actually sent into a model request, then it becomes a
 * normal user bubble (the transcript confirms it).
 *
 * Two sources, both shown below the transcript in send order:
 *  - echoes omp holds back (steer/follow-up queue, or sent during
 *    compaction/handoff) — `queuedEchoIds`;
 *  - the app-side held queue (messages typed while a turn streams), which
 *    keeps its send-now / remove actions here.
 */
import { useMemo } from "react";
import type { ImageAttachment } from "../../lib/contracts";
import { useComposer } from "../../stores/composer";
import { type HeldItem, useHeldItems, useHeldQueue } from "./heldQueue";
import { drainNext, promoteOmpQueued, removeOmpQueued, sendQueuedNow, useQueuedBusy } from "./QueuedBar";
import { ompQueueSlot, queuedEchoIds, type UserEcho, useLive } from "../../stores/live";
import { useT } from "../../stores/language";
import { UserMessageBubble } from "./ExecutionDisclosure";

const EMPTY_ECHOES: UserEcho[] = [];

const BUBBLE_CLASS =
	"min-w-0 max-w-[70%] whitespace-pre-wrap break-words rounded-[22px] bg-[var(--ghost-hover)] px-4 py-2.5 text-[length:var(--chat-user-font-size)] leading-6 text-[var(--text-60)]";
const ACTION_CLASS =
	"rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";
const PRIMARY_ACTION_CLASS =
	"rounded-full bg-[var(--text)] px-3 py-0.5 text-[11px] font-medium text-[var(--bg-panel)] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50";

function restoreHeldItemToComposer(sessionId: string, index: number, item: HeldItem): void {
	useHeldQueue.getState().remove(sessionId, index);
	const composer = useComposer.getState();
	const existingImages = composer.images[sessionId] ?? [];
	const validImages = (item.images ?? []).filter(
		(img): img is ImageAttachment & { path: string } => Boolean(img.path),
	);
	const offset = existingImages.length;
	const referenced = new Set<number>();
	let restoredText = item.text.replace(
		/\[(?:Image|图片)\s*#(\d+)(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|\[图片:\s*([^\]]+)\]/gu,
		(_marker, number: string | undefined, path: string | undefined) => {
			const idx = validImages.findIndex((image, pos) =>
				number
					? (image.marker?.match(/#(\d+)/u)?.[1] ?? String(pos + 1)) === number
					: image.path === path?.trim(),
			);
			if (idx < 0) return "";
			referenced.add(idx);
			return `🖼️#${offset + idx + 1}`;
		},
	).trim();
	for (let i = 0; i < validImages.length; i++) {
		if (!referenced.has(i)) {
			restoredText = `${restoredText} 🖼️#${offset + i + 1}`.trim();
		}
	}
	if (validImages.length > 0) {
		composer.setImages(sessionId, [
			...existingImages,
			...validImages.map((img) => ({
				id: img.id,
				path: img.path,
				width: img.width ?? undefined,
				height: img.height ?? undefined,
			})),
		]);
	}
	const prevDraft = (composer.drafts[sessionId] ?? "").replace(/\s+$/, "");
	const nextDraft = prevDraft && restoredText ? `${prevDraft}\n\n${restoredText}` : prevDraft || restoredText;
	composer.setDraft(sessionId, nextDraft);
	composer.focusComposer(sessionId);
}

function QueuedBubble({
	text,
	images,
	actions,
}: {
	text: string;
	images?: ImageAttachment[];
	actions?: React.ReactNode;
}) {
	const { t } = useT();
	return (
		<div className="flex w-full flex-col items-end gap-1 py-1" data-queued-message>
			<UserMessageBubble
				text={text}
				images={images}
				bubbleClass={BUBBLE_CLASS}
				emptyText={t("chatView.queue.attachmentPlaceholder")}
			/>
			<div className="flex items-center gap-2 text-[11px] text-[var(--text-40)]">
				<span>{t("chatView.queue.queued")}</span>
				{actions}
			</div>
		</div>
	);
}

export function QueuedBubbles({
	sessionId,
	className,
}: {
	sessionId: string;
	/** Horizontal padding to match the transcript rows. */
	className?: string;
}) {
	const { t } = useT();
	const echoes = useLive((s) => s.sessions[sessionId]?.pendingUserEchoes ?? EMPTY_ECHOES);
	const ompQueue = useLive((s) => s.sessions[sessionId]?.ompQueue);
	const streaming = useLive((s) => s.sessions[sessionId]?.streaming === true);
	const held = useHeldItems(sessionId);
	const busy = useQueuedBusy((s) => s.busy);
	const preparing = useQueuedBusy((s) => s.preparing[sessionId]);
	const remove = useHeldQueue((s) => s.remove);
	const queuedEchoes = useMemo(() => {
		if (!ompQueue) return EMPTY_ECHOES;
		const ids = queuedEchoIds({ pendingUserEchoes: echoes, ompQueue });
		return echoes.filter((e) => ids.has(e.id));
	}, [echoes, ompQueue]);
	if (queuedEchoes.length === 0 && held.length === 0 && !preparing?.length) return null;
	return (
		<div className={className}>
			{queuedEchoes.map((e) => {
				const slot = ompQueue ? ompQueueSlot(ompQueue, e.text ?? "") : null;
				const disabled = e.id in busy;
				return (
					<QueuedBubble
						key={e.id}
						text={e.text ?? ""}
						images={e.images}
						actions={
							slot ? (
								<>
									{slot === "followUp" && streaming ? (
										<button
											type="button"
											className={ACTION_CLASS}
											disabled={disabled}
											title={t("chatView.queue.promoteTitle")}
											onClick={() => void promoteOmpQueued(sessionId, e)}
										>
											{t("chatView.queue.promote")}
										</button>
									) : null}
									<button
										type="button"
										className={ACTION_CLASS}
										disabled={disabled}
										title={t("chatView.queue.removeToDraftTitle")}
										onClick={() => void removeOmpQueued(sessionId, e, slot)}
									>
										{t("chatView.queue.removeFromQueue")}
									</button>
								</>
							) : undefined
						}
					/>
				);
			})}
			{preparing?.filter((item) => !held.some((current) => current.id === item.id)).map((item) => (
				<QueuedBubble key={`preparing-${item.id}`} text={item.text} images={item.images} />
			))}
			{held.length > 1 && !streaming && (
				<div className="flex justify-end py-1">
					<button
						type="button"
						className={PRIMARY_ACTION_CLASS}
						title={t("chatView.queue.sendAllMergedTitle")}
						onClick={() => void drainNext(sessionId)}
					>
						{t("chatView.queue.sendAllMerged")}
					</button>
				</div>
			)}
			{held.map((item, i) => (
				<QueuedBubble
					key={item.id}
					text={item.text}
					images={item.images}
					actions={
						<>
							<button
								type="button"
								className={ACTION_CLASS}
								disabled={item.id in busy}
								title={streaming ? t("chatView.queue.sendNowInterruptTitle") : t("chatView.queue.sendNowTitle")}
								onClick={() => void sendQueuedNow(sessionId, item, streaming)}
							>
								{streaming ? t("chatView.queue.promote") : t("chatView.queue.sendNow")}
							</button>
							<button
								type="button"
								className={ACTION_CLASS}
								disabled={item.id in busy}
								title={t("chatView.queue.editInComposerTitle")}
								onClick={() => restoreHeldItemToComposer(sessionId, i, item)}
							>
								{t("chatView.queue.editInComposer")}
							</button>
							<button
								type="button"
								className={ACTION_CLASS}
								disabled={item.id in busy}
								title={t("chatView.queue.removeTitle")}
								onClick={() => remove(sessionId, i)}
							>
								{t("chatView.queue.removeFromQueue")}
							</button>
						</>
					}
				/>
			))}
		</div>
	);
}
