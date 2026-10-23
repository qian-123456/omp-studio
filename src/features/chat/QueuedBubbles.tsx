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
import { useHeldItems, useHeldQueue } from "./heldQueue";
import { promoteOmpQueued, removeOmpQueued, sendQueuedNow, useQueuedBusy } from "./QueuedBar";
import { ompQueueSlot, queuedEchoIds, type UserEcho, useLive } from "../../stores/live";
import { UserMessageBubble } from "./ExecutionDisclosure";

const EMPTY_ECHOES: UserEcho[] = [];

const BUBBLE_CLASS =
	"min-w-0 max-w-[70%] whitespace-pre-wrap break-words rounded-[22px] bg-[var(--ghost-hover)] px-4 py-2.5 text-[length:var(--chat-user-font-size)] leading-6 text-[var(--text-60)]";
const ACTION_CLASS =
	"rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

function QueuedBubble({
	text,
	images,
	actions,
}: {
	text: string;
	images?: ImageAttachment[];
	actions?: React.ReactNode;
}) {
	return (
		<div className="flex w-full flex-col items-end gap-1 py-1" data-queued-message>
			<UserMessageBubble
				text={text}
				images={images}
				bubbleClass={BUBBLE_CLASS}
				emptyText="（附件）"
			/>
			<div className="flex items-center gap-2 text-[11px] text-[var(--text-40)]">
				<span>⏳ 排队中</span>
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
	const echoes = useLive((s) => s.sessions[sessionId]?.pendingUserEchoes ?? EMPTY_ECHOES);
	const ompQueue = useLive((s) => s.sessions[sessionId]?.ompQueue);
	const streaming = useLive((s) => s.sessions[sessionId]?.streaming === true);
	const held = useHeldItems(sessionId);
	const busy = useQueuedBusy((s) => s.busy);
	const remove = useHeldQueue((s) => s.remove);
	const queuedEchoes = useMemo(() => {
		if (!ompQueue) return EMPTY_ECHOES;
		const ids = queuedEchoIds({ pendingUserEchoes: echoes, ompQueue });
		return echoes.filter((e) => ids.has(e.id));
	}, [echoes, ompQueue]);
	if (queuedEchoes.length === 0 && held.length === 0) return null;
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
											title="移到当前回复之前处理（打断）"
											onClick={() => void promoteOmpQueued(sessionId, e)}
										>
											插队
										</button>
									) : null}
									<button
										type="button"
										className={ACTION_CLASS}
										disabled={disabled}
										title="从队列移出这条消息，放回输入框"
										onClick={() => void removeOmpQueued(sessionId, e, slot)}
									>
										移出队列
									</button>
								</>
							) : undefined
						}
					/>
				);
			})}
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
								title={streaming ? "打断当前回复，立即发送这条" : "立即发送这条"}
								onClick={() => void sendQueuedNow(sessionId, item, streaming)}
							>
								{streaming ? "插队" : "立即发送"}
							</button>
							<button
								type="button"
								className={ACTION_CLASS}
								disabled={item.id in busy}
								title="从队列移除这条消息"
								onClick={() => remove(sessionId, i)}
							>
								移出队列
							</button>
						</>
					}
				/>
			))}
		</div>
	);
}
