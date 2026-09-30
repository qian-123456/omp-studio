/** [B] Virtualized message stream: transcript items + in-flight assistant
 * message + live tool cards. Every row carries `id="msg-<itemId>"` so the
 * heatmap can scroll to it. */

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
	AlertCircle,
	ChevronRight,
	Copy,
	GitFork,
	Loader2,
	RotateCcw,
	Sparkles,
	Wrench,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ToolCall, ToolResultInfo, TranscriptItem, TurnCheckpoint } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { createSideChat } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useLive, type AgentMessage, type LiveTool } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useTurnNav } from "../../stores/turnNav";
import { useUi } from "../../stores/ui";
import { Markdown } from "./markdown";
import { sendPrompt } from "./send";
import { ToolCard } from "./ToolCard";
import {
	buildToolResultsMap,
	filterVisibleItems,
	isLastInTurn,
	resolveToolStatus,
} from "./messageTrace";
import { useHeldQueue } from "./heldQueue";
import { TurnChip } from "./TurnChip";
import { turnChipTargets, undoableTurn } from "./turnChips";
const EMPTY_TOOLS: Record<string, LiveTool> = {};

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** Extract text parts from an AgentMessage content (string | parts array). */
export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) => {
			const o = asObj(p);
			return o.type === "text" && typeof o.text === "string" ? o.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function messageThinking(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((p) => {
			const o = asObj(p);
			const t = o.type === "thinking" ? o.thinking : o.type === "thought" ? o.text : "";
			return typeof t === "string" ? t : "";
		})
		.filter(Boolean)
		.join("\n");
}

function messageToolCalls(content: unknown): ToolCall[] {
	if (!Array.isArray(content)) return [];
	return content
		.map((p) => {
			const o = asObj(p);
			if (o.type !== "toolCall") return null;
			return {
				id: typeof o.id === "string" ? o.id : "",
				name: typeof o.name === "string" ? o.name : "tool",
				args: o.arguments,
				intent:
					typeof o.intent === "string"
						? o.intent
						: typeof asObj(o.arguments).i === "string"
							? (asObj(o.arguments).i as string)
							: null,
			};
		})
		.filter((t): t is ToolCall => t !== null);
}


/** Newest non-empty line of the in-flight thinking text. */
function lastNonEmptyLine(text: string): { key: string; text: string } | null {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim() ?? "";
		if (line) return { key: String(i), text: line };
	}
	return null;
}

function formatTimestamp(ts?: string | number | null): string {
	if (!ts) return "";
	const date = new Date(ts);
	if (isNaN(date.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	const seconds = pad(date.getSeconds());
	return `${hours}:${minutes}:${seconds}`;
}

function ThinkingContent({
	text,
	isStreaming,
}: {
	text: string;
	isStreaming?: boolean;
}) {
	const contentRef = useRef<HTMLDivElement>(null);
	const contentFollowRef = useRef(true);

	useEffect(() => {
		contentFollowRef.current = true;
	}, []);

	useEffect(() => {
		const el = contentRef.current;
		if (!el || !isStreaming || !contentFollowRef.current) return;
		el.scrollTop = el.scrollHeight;
	});

	if (!text) return null;

	return (
		<div className="group/th relative ml-1 rounded-lg bg-[var(--bg-active-fill)]/50 p-2.5">
			<button
				type="button"
				onClick={async () => {
					try {
						await copyText(text);
						toast.success("思考过程已复制");
					} catch (e) {
						toast.error(`复制失败: ${errMsg(e)}`);
					}
				}}
				className="press-scale absolute right-2 top-2 rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-300 opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-neutral-100 focus:opacity-100 group-hover/th:opacity-100"
				title="复制思考过程"
			>
				复制
			</button>
			<div
				ref={contentRef}
				onScroll={() => {
					const el = contentRef.current;
					if (!el) return;
					contentFollowRef.current =
						el.scrollHeight - el.scrollTop - el.clientHeight < 8;
				}}
				className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-400 select-text"
			>
				{text}
			</div>
		</div>
	);
}

function TraceExecution({
	sessionId,
	thinking,
	toolCalls,
	isStreaming,
	thinkingStartedAt,
	thinkingEndedAt,
	toolsExpanded,
	toolResultsByCallId,
}: {
	sessionId: string;
	thinking: string | null;
	toolCalls: ToolCall[];
	isStreaming?: boolean;
	thinkingStartedAt?: number | null;
	thinkingEndedAt?: number | null;
	toolsExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
}) {
	const liveTools = useLive(
		(s) => s.sessions[sessionId]?.tools ?? EMPTY_TOOLS,
	);
	// Codex-style: during streaming, keep expanded. Once finished, default collapsed.
	const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

	const isOpen =
		toolsExpanded !== null && toolsExpanded !== undefined
			? toolsExpanded
			: userExpanded !== null
				? userExpanded
				: Boolean(isStreaming);

	const [seconds, setSeconds] = useState<number | null>(null);
	useEffect(() => {
		if (!isStreaming) {
			if (thinkingStartedAt) {
				const end = thinkingEndedAt ?? Date.now();
				setSeconds(Math.max(1, Math.ceil((end - thinkingStartedAt) / 1000)));
			}
			return;
		}
		if (!thinkingStartedAt) return;
		const tick = () =>
			setSeconds(
				Math.max(1, Math.ceil((Date.now() - thinkingStartedAt) / 1000)),
			);
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [isStreaming, thinkingStartedAt, thinkingEndedAt]);

	const stepCount = toolCalls.length;
	const durationText = seconds == null ? "持续了几秒" : `持续了 ${seconds} 秒`;

	let summaryText = "";
	if (isStreaming && !thinking && stepCount === 0) {
		summaryText = "正在思考…";
	} else if (thinking && stepCount > 0) {
		summaryText = isStreaming
			? (stepCount > 0 ? `正在思考 · ${stepCount} 步工具调用` : "正在思考…")
			: `思考 · ${durationText} · ${stepCount} 步`;
	} else if (thinking) {
		summaryText = isStreaming ? "正在思考…" : `思考 · ${durationText}`;
	} else if (stepCount > 0) {
		summaryText = isStreaming
			? `正在执行工具 (${stepCount} 步)`
			: `工具调用 · ${stepCount} 步`;
	}

	const marquee = isStreaming && !isOpen ? lastNonEmptyLine(thinking ?? "") : null;

	return (
		<div className="my-1 border-l-2 border-[var(--border)] pl-2.5 py-0.5 space-y-1">
			<button
				type="button"
				onClick={() => setUserExpanded(!isOpen)}
				className="group/trace press-scale flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left text-[12px] text-neutral-400 transition-colors select-none hover:bg-[var(--bg-active-fill)] hover:text-neutral-200"
			>
				<Sparkles
					size={11}
					className={clsx(
						"shrink-0",
						isStreaming ? "animate-pulse text-indigo-400" : "text-neutral-500",
					)}
				/>
				<span className="font-medium text-neutral-300">
					{summaryText}
				</span>
				{marquee && (
					<span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-neutral-500">
						<span className="inline-block whitespace-nowrap">
							{marquee.text}
						</span>
					</span>
				)}
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-neutral-500 transition-transform duration-150",
						isOpen ? "rotate-90" : "rotate-0",
					)}
				/>
			</button>

			{isOpen && (
				<div className="space-y-1.5 pt-0.5">
					{thinking && (
						<ThinkingContent
							text={thinking}
							isStreaming={isStreaming}
						/>
					)}
					{stepCount > 0 && (
						<div
							className={clsx(
								"space-y-0.5",
								isStreaming && "max-h-60 overflow-y-auto",
							)}
						>
							{toolCalls.map((tc) => {
								const live = liveTools[tc.id];
								const histResult = toolResultsByCallId?.get(tc.id);
								const status = resolveToolStatus(live?.status, histResult);

								return (
									<ToolCard
										key={tc.id}
										sessionId={sessionId}
										name={live?.toolName ?? tc.name}
										args={live?.args ?? tc.args}
										intent={tc.intent ?? live?.intent ?? null}
										status={status}
										output={histResult?.text || live?.text || ""}
										details={histResult?.details ?? live?.details}
										expanded={toolsExpanded ?? undefined}
										startedAt={live?.startedAt}
										endedAt={live?.endedAt}
									/>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function AssistantBody({
	sessionId,
	text,
	thinking,
	toolCalls,
	toolsExpanded,
	timestamp,
	isStreaming,
	thinkingStartedAt,
	thinkingEndedAt,
	toolResultsByCallId,
	isLastInTurn,
}: {
	sessionId: string;
	text: string;
	thinking: string | null;
	toolCalls: ToolCall[];
	toolsExpanded?: boolean | null;
	timestamp?: string | null;
	isStreaming?: boolean;
	thinkingStartedAt?: number | null;
	thinkingEndedAt?: number | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	isLastInTurn?: boolean;
}) {
	const hasVisibleText = Boolean(text && text.trim().length > 0);
	const shouldShowFooter =
		!isStreaming && (hasVisibleText || (isLastInTurn && toolCalls.length > 0));
	const timeStr = formatTimestamp(timestamp);

	return (
		<div className="group relative">
			{/* Execution trace: thinking + tool calls auto-collapsed when finished */}
			{(thinking || toolCalls.length > 0) && (
				<TraceExecution
					sessionId={sessionId}
					thinking={thinking}
					toolCalls={toolCalls}
					isStreaming={isStreaming}
					thinkingStartedAt={thinkingStartedAt}
					thinkingEndedAt={thinkingEndedAt}
					toolsExpanded={toolsExpanded}
					toolResultsByCallId={toolResultsByCallId}
				/>
			)}

			{/* When streaming but neither thinking text nor tool calls nor answer text have arrived yet */}
			{isStreaming && !text && !thinking && toolCalls.length === 0 && (
				<div className="my-1 border-l-2 border-[var(--border)] pl-2.5 py-0.5 space-y-1">
					<div className="flex items-center gap-2 py-0.5 text-[12px] text-neutral-400 select-none">
						<Sparkles size={11} className="shrink-0 animate-pulse text-indigo-400" />
						<span className="animate-pulse font-medium text-neutral-300">正在思考…</span>
					</div>
				</div>
			)}

			<div className="relative">
				{text && <Markdown text={text} />}
				{isStreaming && (
					<span
						className="inline-block animate-pulse font-mono text-[13px] text-indigo-400 select-none ml-0.5"
						title="生成中…"
					>
						▍
					</span>
				)}
			</div>

			{shouldShowFooter && (
				<div className="mt-1 flex items-center justify-start">
					<div
						className="flex items-center gap-0.5 rounded-xl hairline vibrancy-popover p-0.5 text-[11px] shadow-sm opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
						title={timeStr ? `完成时间 ${timeStr}` : undefined}
					>
						{text && (
							<button
								type="button"
								onClick={async () => {
									try {
										await copyText(text);
										toast.success("回复已复制");
									} catch (e) {
										toast.error(`复制失败: ${errMsg(e)}`);
									}
								}}
								className="press-scale flex h-6 w-6 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200 focus:opacity-100"
								title={timeStr ? `复制回复 · 完成时间 ${timeStr}` : "复制回复"}
								aria-label="复制回复"
							>
								<Copy size={12} />
							</button>
						)}
						<button
							type="button"
							onClick={async () => {
								try {
									const snippet = text.slice(0, 60);
									const prompt = snippet ? `基于回复继续：${snippet}…` : "分叉侧聊";
									const info = await createSideChat(sessionId, prompt, text || undefined);
									void useSessions.getState().load().catch(() => {});
									useUi.getState().setRightTab("sidechat");
									useUi.getState().selectSession(info.sessionId);
									toast.success("已分叉到侧聊");
								} catch (e) {
									toast.error(`分叉失败: ${errMsg(e)}`);
								}
							}}
							className="press-scale flex h-6 w-6 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200 focus:opacity-100"
							title={timeStr ? `分叉此回复到侧聊 · 完成时间 ${timeStr}` : "分叉此回复到侧聊"}
							aria-label="分叉此回复到侧聊"
						>
							<GitFork size={12} />
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function ItemRow({
	sessionId,
	item,
	toolsExpanded,
	toolResultsByCallId,
	isLastInTurn,
}: {
	sessionId: string;
	item: TranscriptItem;
	toolsExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	isLastInTurn?: boolean;
}) {
	switch (item.kind) {
		case "user": {
			const userText = item.text ?? "";
			return (
				<div className="group/user-row relative flex flex-col items-end">
					<div className="max-w-full rounded-2xl rounded-tr-sm hairline bg-[var(--bg-hover)] shadow-sm px-4 py-2.5 text-[length:var(--chat-user-font-size)] text-[var(--text)] @min-[624px]:max-w-xl">
						<Markdown text={userText} />
					</div>
					<div className="mt-1 flex items-center gap-1 text-[10px] opacity-0 transition-opacity focus-within:opacity-100 group-hover/user-row:opacity-100">
						<button
							type="button"
							onClick={async () => {
								if (!userText.trim()) return;
								const ok = await confirmDialog(
									`确认重新发送该消息？\n\n"${userText.slice(0, 100)}${userText.length > 100 ? "…" : ""}"`,
									{ okLabel: "重新发送" },
								);
								if (!ok) return;
								try {
									await sendPrompt(sessionId, userText);
									toast.success("正在重新发送…");
								} catch (e) {
									toast.error(`重新发送失败: ${errMsg(e)}`);
								}
							}}
							className="press-scale flex items-center gap-1 px-1 text-neutral-500 transition-colors hover:text-neutral-300 focus:opacity-100"
							title="重新发送此消息"
						>
							<RotateCcw size={10} /> 重新发送
						</button>
						<button
							type="button"
							onClick={async () => {
								try {
									await copyText(userText);
									toast.success("已复制用户消息");
								} catch (e) {
									toast.error(`复制失败: ${errMsg(e)}`);
								}
							}}
							className="press-scale flex items-center gap-1 px-1 text-neutral-500 transition-colors hover:text-neutral-300 focus:opacity-100"
							title="复制消息"
						>
							<Copy size={10} /> 复制
						</button>
					</div>
				</div>
			);
		}
		case "assistant": {
			const liveSession = useLive.getState().sessions[sessionId];
			const thinkingTimes = liveSession?.thinkingDurations?.[item.id];
			return (
				<AssistantBody
					sessionId={sessionId}
					text={item.text ?? ""}
					thinking={item.thinking}
					toolCalls={item.toolCalls}
					toolsExpanded={toolsExpanded}
					timestamp={item.ts}
					thinkingStartedAt={thinkingTimes?.startedAt}
					thinkingEndedAt={thinkingTimes?.endedAt}
					toolResultsByCallId={toolResultsByCallId}
					isLastInTurn={isLastInTurn}
				/>
			);
		}
		case "tool_result":
		case "bash": {
			// Orphan tool result that wasn't consumed by any assistant toolCall
			const r = item.toolResult;
			const liveSession = useLive.getState().sessions[sessionId];
			const liveTool = r?.toolCallId
				? liveSession?.tools?.[r.toolCallId]
				: undefined;
			return (
				<div className="my-1 border-l-2 border-[var(--border)] pl-2.5 py-0.5">
					<ToolCard
						sessionId={sessionId}
						name={r?.toolName ?? item.kind}
						status={r?.isError ? "error" : "done"}
						output={r?.text ?? item.text ?? ""}
						details={r?.details}
						expanded={toolsExpanded ?? undefined}
						startedAt={liveTool?.startedAt}
						endedAt={liveTool?.endedAt}
					/>
				</div>
			);
		}
		case "compaction":
		case "branch_summary":
		case "model_change":
		case "thinking_level_change":
		case "system":
		case "custom": {
			// Protocol/system events — quiet inline chips, not raw text. Codex
			// renders these as dim separators; ours keeps a tiny label so the
			// event is still discoverable on hover.
			const label =
				item.kind === "model_change"
					? `model → ${item.model ?? item.text ?? "?"}`
					: item.kind === "thinking_level_change"
						? `thinking → ${item.text ?? "?"}`
						: item.kind;
			return (
				<div className="py-0.5 text-center text-[10px] text-neutral-700">
					{label}
				</div>
			);
		}
		default:
			return item.text ? (
				<div className="text-[12px] text-neutral-500">{item.text}</div>
			) : null;
	}
}

function StreamingRow({
	sessionId,
	message,
	toolsExpanded,
	toolResultsByCallId,
}: {
	sessionId: string;
	message: AgentMessage | null;
	toolsExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
}) {
	const live = useLive((s) => s.sessions[sessionId]);
	return (
		<div>
			<AssistantBody
				sessionId={sessionId}
				text={messageText(message?.content)}
				thinking={messageThinking(message?.content)}
				toolCalls={messageToolCalls(message?.content)}
				toolsExpanded={toolsExpanded}
				isStreaming={true}
				thinkingStartedAt={live?.thinkingStartedAt}
				thinkingEndedAt={live?.thinkingEndedAt}
				toolResultsByCallId={toolResultsByCallId}
			/>
		</div>
	);
}

export function MessageList({
	sessionId,
	scrollRef,
	traceGutter,
	onScrollState,
	isLoadingTranscript = false,
	transcriptError = null,
	onRetryTranscript,
	turns = [],
	sessionCwd = "",
	sessionFile = "",
	sessionWorking = false,
	onTurnsChange,
}: {
	sessionId: string;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	/** Reserve the left gutter for the ChatTrace dash strip. */
	traceGutter?: boolean;
	/** Reports viewport pin state so the host can render a viewport-pinned
	 * "scroll to bottom" button (the scrolled content must not host it). */
	onScrollState?: (s: { nearBottom: boolean; hasNewMessages: boolean }) => void;
	isLoadingTranscript?: boolean;
	transcriptError?: string | null;
	onRetryTranscript?: () => void;
	/** Per-turn checkpoints (oldest first); chips render at each turn's end. */
	turns?: TurnCheckpoint[];
	/** Session worktree path (used by the 「已存档」 jump and undo). */
	sessionCwd?: string;
	/** Session .jsonl path (undo target). */
	sessionFile?: string;
	/** Session mid-turn → hide the undo action. */
	sessionWorking?: boolean;
	/** Re-fetch checkpoints after a state change (undo). */
	onTurnsChange?: () => void;
}) {
	const live = useLive((s) => s.sessions[sessionId]);
	const items = live?.items ?? [];
	const streamingMessage = live?.streamingMessage ?? null;
	const pendingEchoes = live?.pendingUserEchoes ?? [];
	const [showHidden, setShowHidden] = useState(false);
	const [toolsExpanded, setToolsExpanded] = useState<boolean | null>(null);
	const [highlightedId, setHighlightedId] = useState<string | null>(null);

	const isPinnedRef = useRef(true);
	const prevItemsLen = useRef(items.length);
	const prevStreamingTextLen = useRef(0);
	const prevStreamingThinkingLen = useRef(0);
	const lastHandledScrollReq = useRef<number>(0);
	const containerRef = useRef<HTMLDivElement>(null);

	// Viewport pin state, mirrored to the host for the scroll-to-bottom pill.
	const scrollStateRef = useRef({ nearBottom: true, hasNewMessages: false });
	const onScrollStateRef = useRef(onScrollState);
	onScrollStateRef.current = onScrollState;
	const emitScrollState = (
		patch: { nearBottom?: boolean; hasNewMessages?: boolean },
	) => {
		const cur = scrollStateRef.current;
		const next = {
			nearBottom: patch.nearBottom ?? cur.nearBottom,
			hasNewMessages: patch.hasNewMessages ?? cur.hasNewMessages,
		};
		if (
			next.nearBottom === cur.nearBottom &&
			next.hasNewMessages === cur.hasNewMessages
		) {
			return;
		}
		scrollStateRef.current = next;
		onScrollStateRef.current?.({ ...next });
	};

	// Map of tool results by toolCallId
	const toolResultsByCallId = useMemo(
		() => buildToolResultsMap(items),
		[items],
	);

	const visible = useMemo(
		() => filterVisibleItems(items, showHidden),
		[items, showHidden],
	);


	// Turn chips keyed by the visible-row index they render after.
	const chips = useMemo(() => turnChipTargets(visible, turns), [visible, turns]);
	const undoable = useMemo(
		() => undoableTurn(turns, sessionWorking),
		[turns, sessionWorking],
	);
	const hiddenCount = items.length - visible.length;
	const isStreamingActive = Boolean(live?.streaming || streamingMessage);
	const hasContent =
		visible.length > 0 || pendingEchoes.length > 0 || isStreamingActive;

	const virtualizer = useVirtualizer({
		count: visible.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 80,
		overscan: 6,
		getItemKey: (index) => visible[index]?.id ?? index,
	});

	// Listen to user scroll in container to maintain pin-to-bottom state
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const handleScroll = () => {
			const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
			const pinned = dist < 120;
			isPinnedRef.current = pinned;
			emitScrollState({
				nearBottom: pinned,
				hasNewMessages: pinned ? false : undefined,
			});
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => el.removeEventListener("scroll", handleScroll);
	}, [scrollRef]);

	// Stream-following auto scroll: triggers when text, thinking or rows change
	const streamingText = messageText(streamingMessage?.content);
	const streamingThinking = messageThinking(streamingMessage?.content);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const itemsGrew = visible.length > prevItemsLen.current;
		const echoesGrew = pendingEchoes.length > 0;
		const textGrew = streamingText.length > prevStreamingTextLen.current;
		const thinkingGrew =
			(streamingThinking?.length ?? 0) > prevStreamingThinkingLen.current;

		prevItemsLen.current = visible.length;
		prevStreamingTextLen.current = streamingText.length;
		prevStreamingThinkingLen.current = streamingThinking?.length ?? 0;

		if (isPinnedRef.current) {
			el.scrollTop = el.scrollHeight;
		} else if (itemsGrew || echoesGrew || textGrew || thinkingGrew) {
			emitScrollState({ hasNewMessages: true });
		}
	}, [
		visible.length,
		pendingEchoes.length,
		streamingText,
		streamingThinking,
		scrollRef,
	]);

	// ResizeObserver for dynamic content expansion during streaming
	useEffect(() => {
		const el = scrollRef.current;
		const target = containerRef.current;
		if (!el || !target) return;
		const ro = new ResizeObserver(() => {
			if (isPinnedRef.current) {
				el.scrollTop = el.scrollHeight;
			}
		});
		ro.observe(target);
		return () => ro.disconnect();
	}, [scrollRef]);

	// Handle scrollToIndex and highlight from live.scrollRequest
	useEffect(() => {
		const req = live?.scrollRequest;
		if (!req || req.timestamp === lastHandledScrollReq.current) return;
		lastHandledScrollReq.current = req.timestamp;

		const targetIndex = visible.findIndex((r) => {
			if (r.id === req.itemId) return true;
			if (
				r.kind === "assistant" &&
				r.toolCalls?.some((tc) => {
					const res = toolResultsByCallId.get(tc.id);
					return (
						tc.id === req.itemId ||
						(res && res.toolCallId === req.itemId)
					);
				})
			) {
				return true;
			}
			return false;
		});
		if (targetIndex >= 0) {
			virtualizer.scrollToIndex(targetIndex, {
				align: "center",
				behavior: "smooth",
			});
			setHighlightedId(req.itemId);
			const timer = setTimeout(() => {
				setHighlightedId(null);
			}, 2500);
			useLive.getState().clearScrollRequest(sessionId);
			return () => clearTimeout(timer);
		}
	}, [live?.scrollRequest, visible, virtualizer, sessionId, toolResultsByCallId]);

	// Consume cross-feature "jump to chat turn" requests (git timeline →
	// chat): scroll msg-<userItemId> into view + highlight, then clearTurn.
	const revealTurn = useTurnNav((s) => s.revealTurn);
	const lastHandledReveal = useRef(0);
	useEffect(() => {
		if (!revealTurn || revealTurn.sessionId !== sessionId) return;
		if (revealTurn.nonce === lastHandledReveal.current) return;
		// Still loading → wait; the item may arrive with the page.
		if (isLoadingTranscript) return;
		const idx = visible.findIndex((r) => r.id === revealTurn.userItemId);
		lastHandledReveal.current = revealTurn.nonce;
		useTurnNav.getState().clearTurn();
		if (idx < 0) return;
		virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
		setHighlightedId(revealTurn.userItemId);
		const timer = setTimeout(() => {
			setHighlightedId(null);
		}, 2500);
		return () => clearTimeout(timer);
	}, [revealTurn, visible, virtualizer, sessionId, isLoadingTranscript]);

	return (
		<div className="relative flex h-full flex-col">
			{/* Top toolbar */}
			<div
				className={clsx(
					"mx-auto flex w-full shrink-0 items-center justify-between py-1 text-[11px] text-neutral-500 @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-4xl",
					traceGutter ? "pl-12 pr-3" : "px-3",
				)}
			>
				{hiddenCount > 0 ? (
					<button
						type="button"
						onClick={() => setShowHidden((v) => !v)}
						className="press-scale rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
					>
						{showHidden ? "隐藏系统消息" : `显示 ${hiddenCount} 条隐藏消息`}
					</button>
				) : (
					<div />
				)}
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => setToolsExpanded((v) => !v)}
						className="press-scale flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
						title={toolsExpanded ? "折叠所有工具卡片" : "展开所有工具卡片"}
					>
						<Wrench size={10} />
						<span>{toolsExpanded ? "全部折叠工具" : "全部展开工具"}</span>
					</button>
				</div>
			</div>

			{/* Loading transcript affordance */}
			{isLoadingTranscript && !hasContent && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center text-neutral-400">
					<Loader2 size={24} className="mb-2.5 animate-spin text-neutral-500" />
					<div className="text-[13px] text-neutral-400">正在加载会话记录…</div>
				</div>
			)}

			{/* Error state with retry affordance */}
			{!isLoadingTranscript && transcriptError && !hasContent && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center">
					<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-400">
						<AlertCircle size={24} />
					</div>
					<h3 className="mb-1 text-[14px] font-medium text-neutral-200">
						加载会话记录失败
					</h3>
					<p className="mb-4 max-w-sm text-[12px] leading-normal text-rose-400/90">
						{transcriptError}
					</p>
					{onRetryTranscript && (
						<button
							type="button"
							onClick={onRetryTranscript}
							className="press-scale flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs text-neutral-200 hover:bg-[var(--bg-hover)] transition-colors"
						>
							<RotateCcw size={13} />
							<span>重试加载</span>
						</button>
					)}
				</div>
			)}

			{/* Empty state guidance */}
			{!isLoadingTranscript && !transcriptError && !hasContent && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center">
					<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
						<Sparkles size={24} />
					</div>
					<h3 className="mb-1 text-[14px] font-medium text-neutral-200">
						准备就绪，随时提问
					</h3>
					<p className="mb-4 max-w-sm text-[12px] leading-normal text-neutral-500">
						你可以直接在下方输入框描述你的任务，或者点击以下快捷指令开始：
					</p>
					<div className="grid w-full max-w-md grid-cols-2 gap-2 text-left">
						{[
							"分析当前工作区代码结构与架构",
							"检查 git 改动并总结变更点",
							"审查最近提交并排查潜在 Bug",
							"为当前项目运行测试并报告问题",
						].map((prompt) => (
							<button
								key={prompt}
								type="button"
								onClick={async () => {
									// Mirror Composer: while streaming, park the prompt in the
									// visible held queue instead of a silent followUp send.
									if (live?.streaming) {
										useHeldQueue.getState().push(sessionId, prompt);
										toast.info("已暂存消息，回合结束后可发送");
										return;
									}
									try {
										await sendPrompt(sessionId, prompt);
										toast.info("已发送指令");
									} catch (e) {
										toast.error(`发送失败: ${errMsg(e)}`);
									}
								}}
								className="press-scale cursor-pointer rounded-xl hairline bg-[var(--bg-panel)] p-3 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-100"
							>
								{prompt}
							</button>
						))}
					</div>
				</div>
			)}

			{/* Stream list */}
			<div className="relative min-h-0 flex-1">
				<div
					ref={containerRef}
					className="relative mx-auto w-full @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-4xl"
				>
					{/* Virtualized committed transcript */}
					{visible.length > 0 && (
						<div
							style={{ height: virtualizer.getTotalSize() }}
							className="relative w-full"
						>
							{virtualizer.getVirtualItems().map((row) => {
								const item = visible[row.index];
								if (!item) return null;
								const isHighlighted = item.id === highlightedId;
								return (
									<div
										key={row.key}
										data-index={row.index}
										ref={virtualizer.measureElement}
										style={{ transform: `translateY(${row.start}px)` }}
										className={clsx(
											"absolute left-0 top-0 w-full py-1",
											traceGutter ? "pl-12 pr-3" : "px-3",
											isHighlighted &&
												"rounded-xl bg-[#0A84FF]/10 ring-1 ring-[#0A84FF]/50 shadow-md shadow-[#0A84FF]/10 transition-[background-color,box-shadow] duration-300",
										)}
										id={`msg-${item.id}`}
									>
										<ItemRow
											sessionId={sessionId}
											item={item}
											toolsExpanded={toolsExpanded}
											toolResultsByCallId={toolResultsByCallId}
											isLastInTurn={isLastInTurn(visible, row.index)}
										/>
										{chips.get(row.index)?.map((turn) => (
											<TurnChip
												key={turn.turnId}
												turn={turn}
												cwd={sessionCwd}
												sessionFile={sessionFile}
												canUndo={turn === undoable}
												onDone={() => onTurnsChange?.()}
											/>
										))}
									</div>
								);
							})}
						</div>
					)}

					{/* In-flight / pending user bubbles in normal document flow */}
					{pendingEchoes.length > 0 && (
						<div className="w-full">
							{pendingEchoes.map((echo, i) => (
								<div
									key={echo.id}
									data-index={visible.length + i}
									id={`msg-${echo.id}`}
									className={clsx(
										"w-full py-1 opacity-90",
										traceGutter ? "pl-12 pr-3" : "px-3",
									)}
								>
									<ItemRow
										sessionId={sessionId}
										item={echo}
										toolsExpanded={toolsExpanded}
										toolResultsByCallId={toolResultsByCallId}
									/>
								</div>
							))}
						</div>
					)}

					{/* In-flight assistant streaming / thinking card in normal document flow */}
					{isStreamingActive && (
						<div
							id="msg-live"
							data-index={visible.length + pendingEchoes.length}
							className={clsx(
								"w-full py-1",
								traceGutter ? "pl-12 pr-3" : "px-3",
							)}
						>
							<StreamingRow
								sessionId={sessionId}
								message={streamingMessage}
								toolsExpanded={toolsExpanded}
								toolResultsByCallId={toolResultsByCallId}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
