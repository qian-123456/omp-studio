/** [B] Virtualized message stream: transcript items + in-flight assistant
 * message + live tool cards. Every row carries `id="msg-<itemId>"` so the
 * heatmap can scroll to it. */

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
	AlertCircle,
	ChevronRight,
	Copy,
	Loader2,
	MessageSquareQuote,
	RotateCcw,
	Sparkles,
	Wrench,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ToolCall, ToolResultInfo, TranscriptItem } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useLive, type AgentMessage, type LiveTool } from "../../stores/live";
import { useComposer } from "../../stores/composer";
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

const REASONING_TICK_MS = 1000;
/** Edge fade for the streaming last-line marquee (ZCode ReasoningTrigger). */
const REASONING_MASK =
	"linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)";

/** Newest non-empty line of the in-flight thinking text. */
function lastNonEmptyLine(text: string): { key: string; text: string } | null {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim() ?? "";
		if (line) return { key: String(i), text: line };
	}
	return null;
}

function Thinking({
	text,
	startedAt,
	endedAt,
	isStreaming,
}: {
	text: string;
	startedAt?: number | null;
	endedAt?: number | null;
	isStreaming?: boolean;
}) {
	// ZCode Reasoning: collapsed unless the user opens it; duration ticks
	// whole seconds (min 1) while open+streaming and is finalized on turn end.
	const [open, setOpen] = useState(false);
	const [seconds, setSeconds] = useState<number | null>(null);
	const marqueeRef = useRef<HTMLSpanElement>(null);
	const [marqueeOverflow, setMarqueeOverflow] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const contentFollowRef = useRef(true);

	useEffect(() => {
		if (!isStreaming) {
			if (startedAt) {
				const end = endedAt ?? Date.now();
				setSeconds(Math.max(1, Math.ceil((end - startedAt) / REASONING_TICK_MS)));
			}
			return;
		}
		if (!startedAt || !open) return;
		const tick = () =>
			setSeconds(
				Math.max(1, Math.ceil((Date.now() - startedAt) / REASONING_TICK_MS)),
			);
		tick();
		const id = setInterval(tick, REASONING_TICK_MS);
		return () => clearInterval(id);
	}, [isStreaming, open, startedAt, endedAt]);

	const marquee = isStreaming && !open ? lastNonEmptyLine(text) : null;
	const marqueeKey = marquee ? `${marquee.key}:${marquee.text}` : "";
	useEffect(() => {
		const el = marqueeRef.current;
		if (!el || !marqueeKey) return;
		const update = () => {
			const over = el.scrollWidth > el.clientWidth + 1;
			setMarqueeOverflow(over);
			if (over) el.scrollLeft = el.scrollWidth;
		};
		update();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, [marqueeKey]);

	// Keep the open reasoning content pinned to its bottom while streaming
	// unless the user scrolled up inside it.
	useEffect(() => {
		contentFollowRef.current = true;
	}, [open]);
	useEffect(() => {
		const el = contentRef.current;
		if (!el || !open || !isStreaming || !contentFollowRef.current) return;
		el.scrollTop = el.scrollHeight;
	});

	if (!text) return null;

	return (
		<div className="my-0.5 text-[12px]">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="group/reasoning flex max-w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left transition-colors select-none hover:bg-neutral-800/40"
			>
				<Sparkles
					size={11}
					className={clsx(
						"shrink-0",
						isStreaming ? "animate-pulse text-indigo-400" : "text-neutral-500",
					)}
				/>
				{isStreaming && !open ? (
					<span className="shrink-0 animate-pulse font-medium text-neutral-300">
						正在思考
					</span>
				) : (
					<span className="shrink-0 whitespace-nowrap text-neutral-500">
						<span className="font-medium">思考</span>
						<span className="font-normal"> · </span>
						<span className="font-normal">
							{seconds == null ? "持续了几秒" : `持续了 ${seconds} 秒`}
						</span>
					</span>
				)}
				{marquee && (
					<span
						ref={marqueeRef}
						className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-neutral-500"
						style={
							marqueeOverflow
								? { maskImage: REASONING_MASK, WebkitMaskImage: REASONING_MASK }
								: undefined
						}
					>
						<span className="inline-block whitespace-nowrap">
							{marquee.text}
						</span>
					</span>
				)}
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-neutral-500 transition-all",
						open
							? "rotate-90 opacity-100"
							: "rotate-0 opacity-0 group-hover/reasoning:opacity-100",
					)}
				/>
			</button>
			{open && (
				<div className="group/th relative ml-2 mt-1 border-l border-neutral-800/80 py-1 pl-3">
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
						className="absolute right-1 top-0 rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] text-neutral-400 opacity-0 transition-opacity hover:text-white focus:opacity-100 group-hover/th:opacity-100"
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
						className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-500"
					>
						{text}
					</div>
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
	usage,
	toolsExpanded,
	onRetry,
	itemId,
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
	usage?: { totalTokens: number } | null;
	toolsExpanded?: boolean | null;
	onRetry?: () => void;
	itemId?: string;
	isStreaming?: boolean;
	thinkingStartedAt?: number | null;
	thinkingEndedAt?: number | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	isLastInTurn?: boolean;
}) {
	const liveTools = useLive(
		(s) => s.sessions[sessionId]?.tools ?? EMPTY_TOOLS,
	);
	const hasVisibleText = Boolean(text && text.trim().length > 0);
	const shouldShowFooter =
		!isStreaming && (hasVisibleText || (isLastInTurn && toolCalls.length > 0));

	return (
		<div className="group relative">
			{/* Execution trace: thinking + tool calls connected with Codex-style tree guide line */}
			{(thinking || toolCalls.length > 0) && (
				<div className="my-1 border-l-2 border-neutral-800/70 pl-2.5 py-0.5 space-y-0.5">
					{thinking && (
						<Thinking
							text={thinking}
							startedAt={thinkingStartedAt}
							endedAt={thinkingEndedAt}
							isStreaming={isStreaming}
						/>
					)}
					{toolCalls.length > 0 && (
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
			{shouldShowFooter && usage && (
				<div className="mt-1 text-[10px] text-neutral-600">
					{usage.totalTokens.toLocaleString()} tokens
				</div>
			)}
			{shouldShowFooter && (
				<div className="mt-1 flex items-center justify-end">
					<div className="flex items-center gap-1 rounded border border-neutral-700/80 bg-neutral-900/95 px-1.5 py-0.5 text-[11px] shadow opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
						{text && (
							<button
								type="button"
								onClick={() => {
									if (!text.trim()) return;
									useComposer.getState().addAnnotation(sessionId, {
										source: "message",
										text,
										itemId,
									});
									useComposer.getState().focusComposer(sessionId);
									toast.success("已添加引用");
								}}
								className="flex items-center gap-1 px-1 text-neutral-400 transition-colors hover:text-neutral-200 focus:opacity-100"
								title="引用全文到输入框"
							>
								<MessageSquareQuote size={11} /> 引用
							</button>
						)}
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
								className={clsx(
									"flex items-center gap-1 px-1 text-neutral-400 transition-colors hover:text-neutral-200 focus:opacity-100",
									text && "border-l border-neutral-800 pl-1.5",
								)}
								title="复制 Markdown"
							>
								<Copy size={11} /> 复制
							</button>
						)}
						{onRetry && (
							<button
								type="button"
								onClick={onRetry}
								className={clsx(
									"flex items-center gap-1 text-neutral-400 transition-colors hover:text-neutral-200 focus:opacity-100",
									text && "border-l border-neutral-800 pl-1.5 pr-1",
								)}
								title="重新生成此回合"
							>
								<RotateCcw size={11} /> 重试
							</button>
						)}
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
	prevUserPrompt,
	toolResultsByCallId,
	isLastInTurn,
}: {
	sessionId: string;
	item: TranscriptItem;
	toolsExpanded?: boolean | null;
	prevUserPrompt?: string | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	isLastInTurn?: boolean;
}) {
	switch (item.kind) {
		case "user": {
			const userText = item.text ?? "";
			return (
				<div className="group/user-row relative flex flex-col items-end">
					<div className="max-w-full rounded-xl rounded-tr-xs border border-neutral-800 bg-neutral-900/70 px-4 py-3 text-[length:var(--chat-user-font-size)] text-neutral-100 @min-[624px]:max-w-xl">
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
							className="flex items-center gap-1 px-1 text-neutral-500 transition-colors hover:text-neutral-300 focus:opacity-100"
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
							className="flex items-center gap-1 px-1 text-neutral-500 transition-colors hover:text-neutral-300 focus:opacity-100"
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
					usage={item.usage}
					toolsExpanded={toolsExpanded}
					itemId={item.id}
					thinkingStartedAt={thinkingTimes?.startedAt}
					thinkingEndedAt={thinkingTimes?.endedAt}
					toolResultsByCallId={toolResultsByCallId}
					isLastInTurn={isLastInTurn}
					onRetry={
						prevUserPrompt
							? async () => {
									const ok = await confirmDialog(
										`确认重新发送上一条提问并重试？\n\n"${prevUserPrompt.slice(0, 100)}${prevUserPrompt.length > 100 ? "…" : ""}"`,
										{ okLabel: "重试" },
									);
									if (!ok) return;
									try {
										await sendPrompt(sessionId, prevUserPrompt);
										toast.success("正在重新生成…");
									} catch (e) {
										toast.error(`重试失败: ${errMsg(e)}`);
									}
								}
							: undefined
					}
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
				<div className="my-1 border-l-2 border-neutral-800/70 pl-2.5 py-0.5">
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
	message: AgentMessage;
	toolsExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
}) {
	const live = useLive((s) => s.sessions[sessionId]);
	return (
		<div>
			<AssistantBody
				sessionId={sessionId}
				text={messageText(message.content)}
				thinking={messageThinking(message.content)}
				toolCalls={messageToolCalls(message.content)}
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

	// Optimistic user echoes ride at the tail until the transcript confirms
	// them; they already have kind "user" so ItemRow renders them as bubbles.
	const rows: (TranscriptItem | "live")[] = streamingMessage
		? [...visible, ...pendingEchoes, "live"]
		: [...visible, ...pendingEchoes];
	const hiddenCount = items.length - visible.length;

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 90,
		overscan: 8,
	});

	// Listen to user scroll in container to maintain pin-to-bottom state
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const handleScroll = () => {
			const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
			const pinned = dist < 150;
			isPinnedRef.current = pinned;
			emitScrollState({
				nearBottom: pinned,
				hasNewMessages: pinned ? false : undefined,
			});
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => el.removeEventListener("scroll", handleScroll);
	}, [scrollRef]);

	// Stream-following auto scroll: triggers when text or rows change
	const streamingText = messageText(streamingMessage?.content);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const itemsGrew = items.length > prevItemsLen.current;
		const textGrew = streamingText.length > prevStreamingTextLen.current;
		prevItemsLen.current = items.length;
		prevStreamingTextLen.current = streamingText.length;

		if (isPinnedRef.current) {
			el.scrollTop = el.scrollHeight;
		} else if (itemsGrew || textGrew) {
			emitScrollState({ hasNewMessages: true });
		}
	}, [rows.length, streamingText, items.length, scrollRef]);

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

		const targetIndex = rows.findIndex((r) => {
			if (r === "live") return false;
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
	}, [live?.scrollRequest, rows, virtualizer, sessionId]);

	// Find preceding user prompt for retry
	const findPrecedingUserPrompt = (currentIndex: number): string | null => {
		for (let i = currentIndex - 1; i >= 0; i--) {
			const item = visible[i];
			if (item && item.kind === "user" && item.text) {
				return item.text;
			}
		}
		return null;
	};
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
						className="rounded bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-500 hover:text-neutral-300"
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
						className="flex items-center gap-1 rounded bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
						title={toolsExpanded ? "折叠所有工具卡片" : "展开所有工具卡片"}
					>
						<Wrench size={10} />
						<span>{toolsExpanded ? "全部折叠工具" : "全部展开工具"}</span>
					</button>
				</div>
			</div>

			{/* Loading transcript affordance */}
			{isLoadingTranscript && visible.length === 0 && !streamingMessage && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center text-neutral-400">
					<Loader2 size={24} className="mb-2.5 animate-spin text-neutral-500" />
					<div className="text-[13px] text-neutral-400">正在加载会话记录…</div>
				</div>
			)}

			{/* Error state with retry affordance */}
			{!isLoadingTranscript && transcriptError && visible.length === 0 && !streamingMessage && (
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
							className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 transition-colors"
						>
							<RotateCcw size={13} />
							<span>重试加载</span>
						</button>
					)}
				</div>
			)}

			{/* Empty state guidance */}
			{!isLoadingTranscript && !transcriptError && visible.length === 0 && !streamingMessage && (
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
								className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5 text-[11px] text-neutral-300 transition-all hover:border-indigo-500/50 hover:bg-neutral-800/80"
							>
								{prompt}
							</button>
						))}
					</div>
				</div>
			)}

			{/* Virtualized stream list */}
			<div className="relative min-h-0 flex-1">
				<div
					ref={containerRef}
					style={{ height: virtualizer.getTotalSize() }}
					className="relative mx-auto w-full @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-4xl"
				>
					{virtualizer.getVirtualItems().map((row) => {
						const item = rows[row.index];
						const isHighlighted =
							item !== "live" && item.id === highlightedId;
						return (
							<div
								key={row.key}
								data-index={row.index}
								ref={virtualizer.measureElement}
								style={{ transform: `translateY(${row.start}px)` }}
								className={clsx(
									"absolute left-0 top-0 w-full py-1 transition-all duration-500",
									traceGutter ? "pl-12 pr-3" : "px-3",
									isHighlighted &&
										"rounded-lg bg-indigo-950/40 ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20",
									item === "live" && "opacity-90",
									item !== "live" &&
										item.id.startsWith("pending-echo-") &&
										"opacity-60",
								)}
								id={
									item === "live" ? "msg-live" : `msg-${item.id}`
								}
							>
								{item === "live" ? (
									<StreamingRow
										sessionId={sessionId}
										message={streamingMessage!}
										toolsExpanded={toolsExpanded}
										toolResultsByCallId={toolResultsByCallId}
									/>
								) : (
									<ItemRow
										sessionId={sessionId}
										item={item}
										toolsExpanded={toolsExpanded}
										prevUserPrompt={findPrecedingUserPrompt(row.index)}
										toolResultsByCallId={toolResultsByCallId}
										isLastInTurn={isLastInTurn(visible, row.index)}
									/>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
