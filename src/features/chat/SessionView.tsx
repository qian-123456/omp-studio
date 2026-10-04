/** [B] Center session view: message stream + pending dialogs +
 * held-queue bar + composer. `compact` = embedded side-chat mode. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import type {
	PendingUiRequest,
	SessionStatus,
	TurnCheckpoint,
} from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import {
	getTranscript,
	gitSessionTurns,
	rpcPendingUi,
	rpcSend,
} from "../../lib/ipc";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { toast } from "../../lib/toast";
import { abortTurn } from "./send";
import { ChatTrace } from "./ChatTrace";
import { Composer } from "./Composer";
import { HeldQueueBar } from "./HeldQueueBar";
import { QueuedBar, useQueueAutoSend } from "./QueuedBar";
import { MessageList } from "./MessageList";
import { PendingUiCard } from "./PendingUiCard";
import { AskPanel, useAskRouting } from "./ask/AskPanel";
import { SelectionToolbar } from "./SelectionToolbar";

const EMPTY_PENDING_UI: PendingUiRequest[] = [];

export function SessionView({
	sessionId,
	compact,
}: {
	sessionId: string;
	compact?: boolean;
}) {
	const meta = useSessions((s) => s.sessions[sessionId]);
	const streaming = useLive((s) => s.sessions[sessionId]?.streaming === true);
	useQueueAutoSend(sessionId, streaming);
	const alive = useLive((s) => s.sessions[sessionId]?.alive === true);
	const pendingUi = useLive((s) => s.sessions[sessionId]?.pendingUi ?? EMPTY_PENDING_UI);
	const setItems = useLive((s) => s.setItems);
	const appendItems = useLive((s) => s.appendItems);
	const setPendingUi = useLive((s) => s.setPendingUi);
	const ask = useAskRouting(sessionId, pendingUi);
	const askReq = ask.route?.req;
	const otherPendingUi = askReq ? pendingUi.filter((r) => r !== askReq) : pendingUi;
	const askActive = Boolean(ask.route) || ask.awaiting;

	const scrollRef = useRef<HTMLDivElement>(null);
	const [scrollPill, setScrollPill] = useState({
		nearBottom: true,
		hasNewMessages: false,
	});
	const status: SessionStatus =
		streaming
			? "working"
			: (meta?.status ?? (alive ? "working" : "idle"));
	const external = status === "external";
	// Per-turn checkpoint chips (empty outside git worktrees / when the
	// checkpoints extension is disabled; fetch failures are silent).
	const [turns, setTurns] = useState<TurnCheckpoint[]>([]);
	const sessionFile = meta?.file ?? "";
	const loadTurns = useCallback(() => {
		if (!sessionFile) {
			setTurns([]);
			return;
		}
		gitSessionTurns(sessionFile)
			.then((list) => setTurns(list))
			.catch(() => setTurns([]));
	}, [sessionFile]);
	useEffect(loadTurns, [loadTurns]);

	const [isLoadingTranscript, setIsLoadingTranscript] = useState(true);
	const [transcriptError, setTranscriptError] = useState<string | null>(null);

	const loadTranscript = useCallback(async () => {
		setIsLoadingTranscript(true);
		setTranscriptError(null);
		try {
			const page = await getTranscript(sessionId);
			setItems(sessionId, page.items, page.nextOffset);
		} catch (err) {
			setTranscriptError(errMsg(err));
		} finally {
			setIsLoadingTranscript(false);
		}
	}, [sessionId, setItems]);

	// Initial transcript + pending UI load.
	useEffect(() => {
		let cancelled = false;
		setIsLoadingTranscript(true);
		setTranscriptError(null);
		setItems(sessionId, [], 0);

		getTranscript(sessionId)
			.then((page) => {
				if (!cancelled) {
					setItems(sessionId, page.items, page.nextOffset);
					setIsLoadingTranscript(false);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setTranscriptError(errMsg(err));
					setIsLoadingTranscript(false);
				}
			});

		rpcPendingUi(sessionId)
			.then((list) => {
				if (!cancelled && list.length) setPendingUi(sessionId, list);
			})
			.catch(() => {});
		if (useLive.getState().sessions[sessionId]?.alive) {
			rpcSend(sessionId, { type: "get_state" }).catch(() => {});
		}
		return () => {
			cancelled = true;
		};
	}, [sessionId, setItems, setPendingUi]);

	// Incremental transcript refresh and usage update when a turn finishes.
	const wasStreaming = useRef(false);
	useEffect(() => {
		const finished = wasStreaming.current && !streaming;
		wasStreaming.current = streaming;
		if (!finished) return;
		const offset = useLive.getState().sessions[sessionId]?.nextOffset ?? 0;
		getTranscript(sessionId, offset)
			.then((page) => {
				if (page.reset) setItems(sessionId, page.items, page.nextOffset);
				else appendItems(sessionId, page.items, page.nextOffset);
			})
			.catch((err) => toast.error(`刷新会话记录失败: ${errMsg(err)}`))
			.finally(() => {
				loadTurns();
			});
	}, [streaming, sessionId, setItems, appendItems, loadTurns]);

	// Esc while generating aborts the turn. Capture phase + preventDefault so
	// macOS WKWebView doesn't treat the key as "exit fullscreen". Only the main
	// (non-compact) view owns the shortcut to avoid double-aborting.
	useEffect(() => {
		if (!streaming || compact) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.isComposing) return;
			e.preventDefault();
			e.stopPropagation();
			abortTurn(sessionId)
				.then(() => toast.info("已终止对话生成"))
				.catch((err) => toast.error(`终止失败: ${errMsg(err)}`));
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [streaming, compact, sessionId]);

	return (
		<div className="flex h-full flex-col">
					<div className="relative min-h-0 flex-1 @container">
						{!compact && (
							<ChatTrace sessionId={sessionId} scrollRef={scrollRef} />
						)}
						<div
							ref={scrollRef}
							className="thread-fade-mask relative h-full overflow-y-auto"
						>
							<MessageList
								sessionId={sessionId}
								scrollRef={scrollRef}
								traceGutter={!compact}
								onScrollState={setScrollPill}
								isLoadingTranscript={isLoadingTranscript}
								transcriptError={transcriptError}
								onRetryTranscript={loadTranscript}
								turns={turns}
								sessionCwd={meta?.cwd ?? ""}
								sessionFile={sessionFile}
								sessionWorking={status === "working"}
								onTurnsChange={loadTurns}
							/>
							<SelectionToolbar
								sessionId={sessionId}
								containerRef={scrollRef}
							/>
						</div>
						{/* Viewport-pinned scroll-to-bottom (ZCode DWt: circular
							icon button anchored outside the scrolled content). */}
						{!scrollPill.nearBottom && (
							<button
								type="button"
								aria-label="滚动到底部"
								title="滚动到底部"
								onClick={() => {
									const el = scrollRef.current;
									if (el)
										el.scrollTo({
											top: el.scrollHeight,
											behavior: "smooth",
										});
								}}
								className="absolute bottom-3 left-1/2 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--bg-panel)] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							>
								<ArrowDown size={16} />
								{scrollPill.hasNewMessages && (
									<span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-[var(--bg-panel)] bg-[var(--text-40)]" />
								)}
							</button>
						)}
					</div>

					{/* Pending dialogs at the stream bottom. */}
					<div className="mx-auto w-full @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-3xl">
						{otherPendingUi.length > 0 && (
							<div className="shrink-0 border-t border-[var(--line)] px-3 pb-1">
								{otherPendingUi.map((req, i) => (
									<PendingUiCard
										key={`${(req.request as { id?: string }).id ?? i}`}
										sessionId={sessionId}
										req={req}
									/>
								))}
							</div>
						)}
						{ask.route ? (
							<div className="shrink-0 px-3">
								<AskPanel
									key={ask.route.spec.toolCallId}
									spec={ask.route.spec}
									startIndex={ask.route.match.qIndex}
									busy={ask.route.resolution.kind === "auto"}
									onSubmit={ask.submit}
									onCancel={ask.cancel}
								/>
							</div>
						) : (
							ask.awaiting && (
								<div className="flex shrink-0 items-center gap-2 px-5 py-3 text-[12px] text-[var(--text-40)]">
									<Loader2 size={12} className="animate-spin" />
									正在提交回答…
								</div>
							)
						)}

						{/* Streaming → Codex popover list. Post-turn → manual bar; with auto-send on
						    the queue is already drained (a failed send restores its item here). */}
						{streaming ? (
							<QueuedBar sessionId={sessionId} />
						) : (
							<HeldQueueBar sessionId={sessionId} streaming={false} />
						)}
						<div className={askActive ? "hidden" : undefined}>
							<Composer
								sessionId={sessionId}
								readonly={external}
								compact={compact}
							/>
						</div>
					</div>

		</div>
	);
}
