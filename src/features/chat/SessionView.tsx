/** [B] Center session view: message stream + pending dialogs +
 * held-queue bar + composer. `compact` = embedded side-chat mode. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { SessionStatus, TurnCheckpoint } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import {
	getTranscript,
	gitSessionTurns,
	rpcEnsureLive,
	rpcPendingUi,
	rpcSend,
} from "../../lib/ipc";
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

export function SessionView({
	sessionId,
	compact,
}: {
	sessionId: string;
	compact?: boolean;
}) {
	const meta = useSessions((s) => s.sessions[sessionId]);
	const live = useLive((s) => s.sessions[sessionId]);
	const { setItems, appendItems, setPendingUi } = useLive();
	const viewMode = useUi(
		(s) => s.sessionViewMode[sessionId] ?? "chat",
	);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [scrollPill, setScrollPill] = useState({
		nearBottom: true,
		hasNewMessages: false,
	});

	const streaming = live?.streaming === true;
	const status: SessionStatus =
		streaming
			? "working"
			: (meta?.status ?? (live?.alive ? "working" : "idle"));
	const external = status === "external";
	const pendingUi = live?.pendingUi ?? [];

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
		if (external) return;
		if (!live?.alive || status === "interrupted" || status === "suspended") {
			rpcEnsureLive(sessionId).catch((err) => {
				console.warn(`[SessionView] auto-resume ${sessionId} failed:`, err);
				toast.error("会话自动恢复失败: " + errMsg(err));
			});
		}
	}, [sessionId, external, live?.alive, status]);

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
							className="relative h-full overflow-y-auto"
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
								className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-neutral-700 bg-neutral-900 p-2 text-neutral-300 shadow-lg transition-colors hover:bg-neutral-800 hover:text-white"
							>
								<ArrowDown size={16} />
								{scrollPill.hasNewMessages && (
									<span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-neutral-900 bg-indigo-500" />
								)}
							</button>
						)}
					</div>

					{/* Pending dialogs at the stream bottom. */}
					<div className="mx-auto w-full @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-4xl">
						{pendingUi.length > 0 && (
							<div className="shrink-0 border-t border-neutral-800 px-3 pb-1">
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
