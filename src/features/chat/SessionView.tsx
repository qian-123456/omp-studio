/** [B] Center session view: header + message stream + pending dialogs +
 * held-queue bar + composer. `compact` = embedded side-chat mode. */

import clsx from "clsx";
import { CheckCheck, MessageSquare, RefreshCw, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionStatus } from "../../lib/contracts";
import {
	acceptSession,
	getTranscript,
	rpcEnsureLive,
	rpcPendingUi,
	sessionUsage,
	takeoverExternal,
} from "../../lib/ipc";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { TerminalView } from "../terminal/TerminalView";
import { Composer } from "./Composer";
import { HeldQueueBar } from "./HeldQueueBar";
import { MessageList } from "./MessageList";
import { PendingUiCard } from "./PendingUiCard";
import { SelectionToolbar } from "./SelectionToolbar";

const STATUS_LABEL: Record<SessionStatus, string> = {
	working: "运行中",
	awaiting_approval: "待批准",
	awaiting_answer: "待回答",
	review: "待验收",
	idle: "空闲",
	error: "出错",
	interrupted: "已中断",
	suspended: "已挂起",
	external: "外部",
};

const STATUS_DOT: Record<SessionStatus, string> = {
	working: "bg-emerald-400 animate-pulse",
	awaiting_approval: "bg-amber-400",
	awaiting_answer: "bg-sky-400",
	review: "bg-orange-400",
	idle: "bg-neutral-500",
	error: "bg-red-500",
	interrupted: "bg-red-800",
	suspended: "bg-neutral-600",
	external: "bg-purple-500",
};

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
	const setSessionViewMode = useUi((s) => s.setSessionViewMode);
	const viewMode = useUi(
		(s) => s.sessionViewMode[sessionId] ?? "chat",
	);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [usage, setUsage] = useState<string | null>(null);
	const [busyAction, setBusyAction] = useState(false);

	const status: SessionStatus =
		meta?.status ?? (live?.alive ? "working" : "idle");
	const streaming = live?.streaming === true;
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
		sessionUsage(sessionId)
			.then((u) => {
				if (!cancelled && u.available)
					setUsage(`${(u.tokens / 1000).toFixed(1)}k tok`);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [sessionId, setItems, setPendingUi]);

	// Incremental transcript refresh when a turn finishes.
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

	const resume = async () => {
		setBusyAction(true);
		try {
			await rpcEnsureLive(sessionId);
		} catch (err) {
			console.error("resume failed", err);
		} finally {
			setBusyAction(false);
		}
	};

	const takeover = async () => {
		if (!window.confirm("接管外部会话可能丢失其未落盘状态，确认接管？")) return;
		setBusyAction(true);
		try {
			await takeoverExternal(sessionId);
		} catch (err) {
			console.error("takeover failed", err);
		} finally {
			setBusyAction(false);
		}
	};

	const accept = async (archive: boolean) => {
		setBusyAction(true);
		try {
			await acceptSession(sessionId, archive);
		} finally {
			setBusyAction(false);
		}
	};

	const contextPct = (live?.state?.contextUsage as { percent?: number } | undefined)
		?.percent;
	const modelId =
		(live?.state?.model as { id?: string } | undefined)?.id ?? meta?.model;

	const headerBtn =
		"rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
				<span
					className={clsx("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[status])}
					title={STATUS_LABEL[status]}
				/>
				<span className="shrink-0 font-mono text-[11px] text-indigo-400">
					{meta?.label ?? ""}
				</span>
				<span className="min-w-0 truncate text-[13px] font-medium text-neutral-200">
					{meta?.title ?? sessionId.slice(0, 8)}
				</span>
				{modelId && (
					<span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
						{modelId}
					</span>
				)}
				{typeof contextPct === "number" && (
					<span className="shrink-0 text-[10px] text-neutral-500">
						ctx {(contextPct * 100).toFixed(0)}%
					</span>
				)}
				{usage && (
					<span className="shrink-0 text-[10px] text-neutral-500">{usage}</span>
				)}
				<div className="flex-1" />
				{meta?.pending === "review" && (
					<>
						<button
							type="button"
							disabled={busyAction}
							onClick={() => void accept(false)}
							className={headerBtn}
						>
							<CheckCheck size={11} className="mr-0.5 inline" /> 验收
						</button>
						<button
							type="button"
							disabled={busyAction}
							onClick={() => void accept(true)}
							className={headerBtn}
						>
							验收并归档
						</button>
					</>
				)}
				{(status === "interrupted" || status === "suspended" || !live?.alive) &&
					!external && (
						<button
							type="button"
							disabled={busyAction}
							onClick={() => void resume()}
							className={headerBtn}
						>
							<RefreshCw size={11} className="mr-0.5 inline" /> 恢复
						</button>
					)}
				{external && (
					<button
						type="button"
						disabled={busyAction}
						onClick={() => void takeover()}
						className="rounded border border-purple-700 px-2 py-0.5 text-[11px] text-purple-300 hover:bg-purple-950/40 disabled:opacity-50"
					>
						接管
					</button>
				)}
				{!compact && (
					<button
						type="button"
						onClick={() =>
							setSessionViewMode(
								sessionId,
								viewMode === "chat" ? "terminal" : "chat",
							)
						}
						className={headerBtn}
						title={viewMode === "chat" ? "切换到终端" : "切换到聊天"}
					>
						{viewMode === "chat" ? (
							<>
								<TerminalSquare size={11} className="mr-0.5 inline" /> 终端
							</>
						) : (
							<>
								<MessageSquare size={11} className="mr-0.5 inline" /> 聊天
							</>
						)}
					</button>
				)}
			</div>

			{viewMode === "terminal" && !compact ? (
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
