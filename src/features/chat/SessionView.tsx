/** [B] Center session view: message stream + pending dialogs +
 * held-queue bar + composer. `compact` = embedded side-chat mode. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentVisible } from "./useDocumentVisible";
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
import { holdTranscript, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { toast } from "../../lib/toast";
import { useT, tNow } from "../../stores/language";
import { abortTurn } from "./send";
import { StartGlow } from "../../components/StartHero";
import { MODAL_SELECTOR } from "../../components/FloatingLayer";
import { ChatTrace } from "./ChatTrace";
import { AnnotationMarkers } from "./AnnotationMarkers";
import { Composer } from "./Composer";
import { HeldQueueBar } from "./HeldQueueBar";
import { useQueueAutoSend } from "./QueuedBar";
import { MessageList } from "./MessageList";
import { PendingUiCard } from "./PendingUiCard";
import { AskPanel, useAskRouting } from "./ask/AskPanel";
import { SelectionToolbar } from "./SelectionToolbar";
import { ShareSelectionBar } from "./share/ShareSelectionBar";
import { useShareSelection } from "./share/shareStore";
import { claimEscape, isEscapeClaimed } from "../../lib/escapeClaim";
import { ThreadFindBar } from "./find/ThreadFindBar";
import { useFindHighlights } from "./find/useFindHighlights";
import { useThreadFind } from "./find/threadFindStore";
import { TopCapsule } from "./subagents/TopCapsule";

const EMPTY_PENDING_UI: PendingUiRequest[] = [];
const NO_REF = { current: null };

/**
 * A fresh draft is only a client-side stub until omp writes its transcript. If its
 * RPC process is gone (app restart/crash) the backend has no meta, file or handle,
 * so "session not found" can never succeed on retry: drop the stub instead.
 */
function dropStaleDraft(sessionId: string, err: unknown): boolean {
	if (!errMsg(err).startsWith("session not found")) return false;
	const s = useSessions.getState().sessions[sessionId];
	if (!s || s.title?.trim() || s.label?.trim() || s.lastAssistant) return false;
	useSessions.getState().remove([sessionId]);
	if (useUi.getState().selectedSessionId === sessionId) {
		useUi.getState().selectSession(null);
	}
	toast.info(tNow("chatView.sessionView.draftExpired"));
	return true;
}

export function SessionView({
	sessionId,
	compact,
}: {
	sessionId: string;
	compact?: boolean;
}) {
	const { t } = useT();
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
	// Latest request wins: a slow fetch from a previous session file (or an
	// older call for the same file) must not overwrite newer chips.
	const turnsReq = useRef(0);
	const loadTurns = useCallback(() => {
		const req = ++turnsReq.current;
		if (!sessionFile) {
			setTurns([]);
			return;
		}
		gitSessionTurns(sessionFile)
			.then((list) => {
				if (req === turnsReq.current) setTurns(list);
			})
			.catch(() => {
				if (req === turnsReq.current) setTurns([]);
			});
	}, [sessionFile]);
	useEffect(() => {
		loadTurns();
		return () => {
			turnsReq.current++;
		};
	}, [loadTurns]);

	// Let the live store drop this transcript once the view is gone (compact
	// side chats are read by hand-back after they close, so they stay).
	useEffect(() => (compact ? undefined : holdTranscript(sessionId)), [sessionId, compact]);

	const [isLoadingTranscript, setIsLoadingTranscript] = useState(true);
	const [emptyState, setEmptyState] = useState(false);
	// Empty sessions get a centered composer + quick prompts (like the start page).
	const centered = emptyState && !compact;
	const [transcriptError, setTranscriptError] = useState<string | null>(null);

	const loadTranscript = useCallback(async () => {
		setIsLoadingTranscript(true);
		setTranscriptError(null);
		try {
			const page = await getTranscript(sessionId);
			setItems(sessionId, page.items, page.nextOffset, page.tailId);
		} catch (err) {
			if (dropStaleDraft(sessionId, err)) return;
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

		getTranscript(sessionId)
			.then((page) => {
				if (!cancelled) {
					setItems(sessionId, page.items, page.nextOffset, page.tailId);
					setIsLoadingTranscript(false);
				}
			})
			.catch((err) => {
				if (cancelled) return;
				if (dropStaleDraft(sessionId, err)) return;
				setTranscriptError(errMsg(err));
				setIsLoadingTranscript(false);
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
		// Switching sessions mid-refresh must not reload another session's turn chips.
		let cancelled = false;
		const live = useLive.getState().sessions[sessionId];
		getTranscript(sessionId, live?.nextOffset ?? 0, live?.tailId)
			.then((page) => {
				if (page.reset) setItems(sessionId, page.items, page.nextOffset, page.tailId);
				else appendItems(sessionId, page.items, page.nextOffset, page.tailId);
			})
			.catch((err) => toast.error(t("chatView.sessionView.refreshHistoryFailed", { error: errMsg(err) })))
			.finally(() => {
				if (!cancelled) loadTurns();
			});
		return () => {
			cancelled = true;
		};
	}, [streaming, sessionId, setItems, appendItems, loadTurns]);

	// A session driven by a terminal `omp` is observed read-only: nothing streams
	// into the live store, so re-read the appended transcript tail whenever the
	// catalog reports new activity (its updatedAt follows the last message).
	// SessionView is only ever mounted for the session being viewed (main pane
	// keyed by selectedSessionId, or the visible side chat); the one "mounted
	// but not looked at" case is a hidden app window, which skips the read and
	// catches up once when it becomes visible again (effect deps change).
	const docVisible = useDocumentVisible();
	const externalTick = external && docVisible ? meta?.updatedAt : undefined;
	useEffect(() => {
		if (externalTick === undefined) return;
		let cancelled = false;
		const live = useLive.getState().sessions[sessionId];
		const from = live?.nextOffset ?? 0;
		getTranscript(sessionId, from, live?.tailId)
			.then((page) => {
				if (cancelled) return;
				// Offset 0 means the initial load has not landed yet: replace, never append.
				if (page.reset || from === 0) setItems(sessionId, page.items, page.nextOffset, page.tailId);
				else appendItems(sessionId, page.items, page.nextOffset, page.tailId);
			})
			.catch((err) => console.warn("[session] external transcript refresh failed", err))
			.finally(() => {
				if (!cancelled) loadTurns();
			});
		return () => {
			cancelled = true;
		};
	}, [externalTick, sessionId, setItems, appendItems, loadTurns]);

	// Esc while generating aborts the turn — but only when nothing else claims
	// the key: the composer's slash/@ menus and the selection bubble call
	// claimEscape, floating layers stop propagation, modals and foreign text
	// fields own their Esc. Bubble phase so those handlers run first.
	// Only the main (non-compact) view owns the shortcut to avoid double-aborting.
	useEffect(() => {
		if (!streaming || compact) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.isComposing || isEscapeClaimed(e)) return;
			if (document.querySelector(MODAL_SELECTOR)) return;
			const el = e.target instanceof Element ? e.target : null;
			if (el?.closest('input, [contenteditable="true"]')) return;
			if (el?.tagName === "TEXTAREA" && !el.hasAttribute("data-composer")) return;
			claimEscape(e);
			abortTurn(sessionId)
				.then(() => toast.info(t("chatView.sessionView.generationAborted")))
				.catch((err) => toast.error(t("chatView.sessionView.abortFailed", { error: errMsg(err) })));
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [streaming, compact, sessionId]);

	// Share-as-image selection mode replaces the Composer; leaving the session ends it.
	const sharing = useShareSelection((s) => s.sessionId === sessionId);
	useEffect(
		() => () => {
			if (useShareSelection.getState().sessionId === sessionId) {
				useShareSelection.getState().cancel();
			}
		},
		[sessionId],
	);

	// Find is scoped to one session: leaving it clears the bar and highlights.
	useFindHighlights(compact ? NO_REF : scrollRef, sessionId);
	useEffect(
		() => () => {
			if (!compact && useThreadFind.getState().sessionId === sessionId) {
				useThreadFind.getState().close();
			}
		},
		[sessionId, compact],
	);

	return (
		<div
			data-session-view=""
			className={`relative @container flex h-full flex-col ${centered ? "justify-center pb-[6vh]" : ""}`}
		>
			{centered && <StartGlow />}
					<div className={`relative min-h-0 @container ${centered ? "flex-none" : "flex-1"}`}>
						{!compact && <TopCapsule />}
						{!compact && (
							<ChatTrace sessionId={sessionId} scrollRef={scrollRef} />
						)}
						{!compact && <ThreadFindBar sessionId={sessionId} />}
						<div
							ref={scrollRef}
							className="thread-fade-mask relative h-full overflow-y-auto overflow-x-clip"
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
								onEmptyChange={setEmptyState}
							/>
							<SelectionToolbar
								sessionId={sessionId}
								containerRef={scrollRef}
								compact={compact}
							/>
							<AnnotationMarkers sessionId={sessionId} containerRef={scrollRef} />
						</div>
						{/* Viewport-pinned scroll-to-bottom (ZCode DWt: circular
							icon button anchored outside the scrolled content). */}
						{!scrollPill.nearBottom && (
							<button
								type="button"
								aria-label={t("chatView.sessionView.scrollToBottom")}
								title={t("chatView.sessionView.scrollToBottom")}
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
					<div
						className={
							centered
								? "mx-auto w-full max-w-[880px] px-6"
								: "mx-auto w-full @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-3xl"
						}
					>
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
									{t("chatView.sessionView.submittingAnswer")}
								</div>
							)
						)}

						{/* Queued messages are grey "排队中" bubbles in the thread (QueuedBubbles).
						    Post-turn manual bar: edit/merge/reorder; with auto-send on the queue is
						    already drained (a failed send restores its item here). */}
						{!streaming && <HeldQueueBar sessionId={sessionId} streaming={false} />}
						{sharing ? (
							<ShareSelectionBar sessionId={sessionId} />
						) : (
							<div className={askActive ? "hidden" : centered ? "start-rise" : undefined}>
								<Composer
									key={sessionId}
									sessionId={sessionId}
									readonly={external}
									compact={compact}
								/>
							</div>
						)}

					</div>
		</div>
	);
}
