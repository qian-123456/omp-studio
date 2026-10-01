/** [B] Center session view: message stream + pending dialogs +
 * held-queue bar + composer. `compact` = embedded side-chat mode. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type {
	PendingUiRequest,
	SessionStatus,
	TurnCheckpoint,
} from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import {
	getTranscript,
	gitSessionTurns,
	rpcEnsureLive,
	rpcPendingUi,
	rpcSend,
} from "../../lib/ipc";
import { isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { TerminalView } from "../terminal/TerminalView";
import { ChatTrace } from "./ChatTrace";
import { Composer } from "./Composer";
import { HeldQueueBar } from "./HeldQueueBar";
import { MessageList } from "./MessageList";
import { PendingUiCard } from "./PendingUiCard";
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
	const alive = useLive((s) => s.sessions[sessionId]?.alive === true);
	const pendingUi = useLive((s) => s.sessions[sessionId]?.pendingUi ?? EMPTY_PENDING_UI);
	const setItems = useLive((s) => s.setItems);
	const appendItems = useLive((s) => s.appendItems);
	const setPendingUi = useLive((s) => s.setPendingUi);
	const viewMode = useUi(
		(s) => s.sessionViewMode[sessionId] ?? "chat",
	);
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
			.catch(() => {})
			.finally(() => {
				loadTurns();
			});
	}, [streaming, sessionId, setItems, appendItems, loadTurns]);

	// Auto-resume / reconnect if the session is not alive and not external
	useEffect(() => {
		if (!alive || status === "interrupted" || status === "suspended") {
			rpcEnsureLive(sessionId).catch((err) => {
				// Deleted worktree: history stays readable; resume only happens
				// via the explicit resume dialog (Composer/row actions).
				if (!isResumeCancelled(err)) {
					toast.error(`自动重连失败: ${errMsg(err)}`);
				}
			});
		}
	}, [sessionId, external, alive, status]);

	return (
		<div className="flex h-full flex-col">
			{viewMode === "terminal" ? (
				<TerminalView sessionId={sessionId} />
			) : (
				<>
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
						{pendingUi.length > 0 && (
							<div className="shrink-0 border-t border-[var(--line)] px-3 pb-1">
								{pendingUi.map((req, i) => (
									<PendingUiCard
										key={`${(req.request as { id?: string }).id ?? i}`}
										sessionId={sessionId}
										req={req}
									/>
								))}
							</div>
						)}

						<HeldQueueBar sessionId={sessionId} streaming={streaming} />
						<Composer
							sessionId={sessionId}
							readonly={external}
							compact={compact}
						/>
					</div>
				</>
			)}
		</div>
	);
}
