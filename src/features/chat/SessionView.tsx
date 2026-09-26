/** [B] Center session view: message stream + pending dialogs +
 * held-queue bar + composer. `compact` = embedded side-chat mode. */

import { useEffect, useRef } from "react";
import type { SessionStatus } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import {
	getTranscript,
	rpcEnsureLive,
	rpcPendingUi,
	rpcSend,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { TerminalView } from "../terminal/TerminalView";
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

	const streaming = live?.streaming === true;
	const status: SessionStatus =
		streaming
			? "working"
			: (meta?.status ?? (live?.alive ? "working" : "idle"));
	const external = status === "external";
	const pendingUi = live?.pendingUi ?? [];

	// Initial transcript + pending UI load.
	useEffect(() => {
		let cancelled = false;
		setItems(sessionId, [], 0);
		getTranscript(sessionId)
			.then((page) => {
				if (!cancelled) setItems(sessionId, page.items, page.nextOffset);
			})
			.catch(() => {});
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
			.catch(() => {});
	}, [streaming, sessionId, setItems, appendItems]);

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
					<div
						ref={scrollRef}
						className="relative min-h-0 flex-1 overflow-y-auto"
					>
						<MessageList sessionId={sessionId} scrollRef={scrollRef} />
						<SelectionToolbar
							sessionId={sessionId}
							containerRef={scrollRef}
						/>
					</div>

					{/* Pending dialogs at the stream bottom. */}
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
				</>
			)}
		</div>
	);
}
