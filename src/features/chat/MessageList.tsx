/** [B] Virtualized message stream: turns + in-flight assistant
 * message + live tool cards. Every turn and step carries `id="msg-<itemId>"` so the
 * heatmap and jump navigators can scroll to it. */

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
	AlertCircle,
	Copy,
	Loader2,
	RotateCcw,
	Sparkles,
	Wrench,
} from "lucide-react";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	ToolCall,
	ToolResultInfo,
	TranscriptItem,
	TurnCheckpoint,
} from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useLive, type LiveTool } from "../../stores/live";
import { useTurnNav } from "../../stores/turnNav";
import { AnswerFooter } from "./AnswerFooter";
import { ExecutionDisclosure } from "./ExecutionDisclosure";
import { ImageChipsList } from "./ImageChips";
import { Markdown } from "./markdown";
import {
	buildToolResultsMap,
	filterVisibleItems,
	resolveToolStatus,
} from "./messageTrace";
import { sendPrompt } from "./send";
import { ToolCard } from "./ToolCard";
import {
	groupTurnBlocks,
	noticeLabel,
	noticeSummary,
	type TurnBlock,
} from "./turnGrouping";
import { undoableTurn } from "./turnChips";

const EMPTY_ITEMS: TranscriptItem[] = [];
const EMPTY_ECHOES: TranscriptItem[] = [];
const EMPTY_TOOLS: Record<string, LiveTool> = {};

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** Extract text parts from an AgentMessage content (string | parts array). */
export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((p) => asObj(p).type === "text")
		.map((p) => String(asObj(p).text ?? ""))
		.join("\n");
}

export function messageThinking(content: unknown): string | null {
	if (!Array.isArray(content)) return null;
	const parts = content
		.filter((p) => asObj(p).type === "thinking")
		.map((p) => String(asObj(p).thinking ?? ""));
	return parts.length ? parts.join("\n") : null;
}

export function messageToolCalls(content: unknown): ToolCall[] {
	if (!Array.isArray(content)) return [];
	return content
		.filter((p) => asObj(p).type === "tool_use" || asObj(p).type === "toolCall")
		.map((p) => {
			const o = asObj(p);
			return {
				id: String(o.id ?? ""),
				name: String(o.name ?? ""),
				args: o.input ?? o.arguments ?? {},
				intent: null,
			};
		});
}

function stripImageMarkers(text: string): string {
	return text
		.replace(/\[Image #\d+(?:,\s*\d+x\d+)?\]|\[图片(?::\s*[^\]]+)?\]/g, "")
		.trim();
}

/**
 * User message bubble with compact image chips and retry/copy actions.
 */
const UserRow = React.memo(function UserRow({
	sessionId,
	item,
}: {
	sessionId: string;
	item: TranscriptItem;
}) {
	const rawText = item.text ?? "";
	const userText = useMemo(() => stripImageMarkers(rawText), [rawText]);

	return (
		<div
			id={`msg-${item.id}`}
			className="group/user-row relative flex flex-col items-end py-1"
		>
			<div className="max-w-full rounded-2xl rounded-tr-sm hairline bg-[var(--bg-hover)] shadow-sm px-4 py-2.5 text-[length:var(--chat-user-font-size)] text-[var(--text)] @min-[624px]:max-w-xl">
				<ImageChipsList images={item.images} />
				{userText ? (
					<Markdown text={userText} />
				) : (
					!item.images?.length && (
						<span className="text-neutral-500 italic">空消息</span>
					)
				)}
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
							if (!isResumeCancelled(e))
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
});

/**
 * Protocol row for system events like model change or compaction.
 */
const ProtocolRow = React.memo(function ProtocolRow({
	item,
}: {
	item: TranscriptItem;
}) {
	const label = noticeLabel(item);
	const summary = noticeSummary(item);

	return (
		<div
			id={`msg-${item.id}`}
			className="py-1.5 text-center text-[10px] text-neutral-500"
		>
			<span
				className="inline-block max-w-full truncate rounded-full hairline bg-[var(--bg-panel)] px-2.5 py-0.5 shadow-xs"
				title={summary || label}
			>
				{summary ? (
					<>
						{label}
						<span className="text-neutral-600"> · {summary}</span>
					</>
				) : (
					label
				)}
			</span>
		</div>
	);
});

/**
 * A full Turn Block in Codex style:
 * 1. User message bubble
 * 2. Execution disclosure (collapsed single row: 已处理 X 分 Y 秒 · N 步 ›)
 * 3. Final assistant answer
 * 4. Subtle one-line answer footer
 */
const TurnBlockRow = React.memo(function TurnBlockRow({
	sessionId,
	block,
	toolsExpanded,
	toolResultsByCallId,
	sessionCwd,
	sessionFile,
	turnCheckpoint,
	canUndo,
	onTurnsChange,
}: {
	sessionId: string;
	block: TurnBlock;
	toolsExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	sessionCwd: string;
	sessionFile: string;
	turnCheckpoint?: TurnCheckpoint;
	canUndo?: boolean;
	onTurnsChange?: () => void;
}) {
	const answerText = useMemo(() => {
		if (!block.answerItem?.text) return "";
		return stripImageMarkers(block.answerItem.text);
	}, [block.answerItem?.text]);

	return (
		<div className="flex flex-col py-1">
			{/* User query bubble (absent when the turn has no visible user message) */}
			{block.userItem && <UserRow sessionId={sessionId} item={block.userItem} />}

			{/* Collapsed intermediate execution disclosure */}
			{block.intermediateSteps.length > 0 && (
				<ExecutionDisclosure
					sessionId={sessionId}
					steps={block.intermediateSteps}
					durationMs={block.durationMs}
					forceExpanded={toolsExpanded}
					toolResultsByCallId={toolResultsByCallId}
				/>
			)}

			{/* Assistant answer bubble */}
			{block.answerItem && (
				<div
					id={`msg-${block.answerItem.id}`}
					className="group/answer relative flex flex-col items-start py-1"
				>
					<div className="max-w-full text-[length:var(--chat-font-size)] text-neutral-200 @min-[864px]:max-w-3xl">
						{answerText ? (
							<Markdown text={answerText} />
						) : (
							<span className="text-neutral-500 italic">空回复</span>
						)}
					</div>

					{/* Subtle Answer Footer */}
					<AnswerFooter
						sessionId={sessionId}
						cwd={sessionCwd}
						sessionFile={sessionFile}
						turnCheckpoint={turnCheckpoint}
						canUndo={canUndo}
						onDoneUndo={onTurnsChange}
						completionTime={block.answerItem.ts ?? block.userItem?.ts}
						durationMs={block.durationMs}
						model={block.answerItem.model ?? block.userItem?.model}
						answerText={answerText}
					/>
				</div>
			)}
		</div>
	);
});

/**
 * Isolated StreamingRow: subscribes to streamingMessage directly so MessageList
 * does NOT re-render on every token!
 */
const StreamingRow = React.memo(function StreamingRow({
	sessionId,
	toolsExpanded,
	toolResultsByCallId,
	onScrollRequest,
}: {
	sessionId: string;
	toolsExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	onScrollRequest?: () => void;
}) {
	const streamingMessage = useLive(
		(s) => s.sessions[sessionId]?.streamingMessage ?? null,
	);
	const liveTools = useLive(
		(s) => s.sessions[sessionId]?.tools ?? EMPTY_TOOLS,
	);

	const text = messageText(streamingMessage?.content);
	const thinking = messageThinking(streamingMessage?.content);
	const toolCalls = messageToolCalls(streamingMessage?.content);

	// Throttle scroll request to rAF
	useEffect(() => {
		onScrollRequest?.();
	}, [text, thinking, toolCalls.length, onScrollRequest]);

	return (
		<div className="space-y-2 py-1">
			{/* Thinking block if actively thinking */}
			{thinking && (
				<div className="rounded-xl hairline bg-[var(--bg-panel)] p-3 text-neutral-300">
					<div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-amber-400">
						<Sparkles size={11} className="animate-pulse" />
						<span>正在深度思考…</span>
					</div>
					<div className="text-[12px] leading-relaxed text-neutral-400 italic">
						<Markdown text={thinking} />
					</div>
				</div>
			)}

			{/* Active tool calls */}
			{toolCalls.length > 0 && (
				<div className="space-y-1">
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
								intent={live?.intent ?? null}
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

			{/* Streaming text answer */}
			{text && (
				<div className="relative max-w-full text-[length:var(--chat-font-size)] text-neutral-200 @min-[864px]:max-w-3xl">
					<Markdown text={text} />
					<span
						className="inline-block h-3.5 w-1.5 ml-0.5 translate-y-0.5 rounded-xs bg-[#0A84FF] animate-pulse"
						aria-hidden="true"
					/>
				</div>
			)}
		</div>
	);
});

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
	onScrollState?: (s: { nearBottom: boolean; hasNewMessages: boolean }) => void;
	isLoadingTranscript?: boolean;
	transcriptError?: string | null;
	onRetryTranscript?: () => void;
	turns?: TurnCheckpoint[];
	sessionCwd?: string;
	sessionFile?: string;
	sessionWorking?: boolean;
	onTurnsChange?: () => void;
}) {
	// Narrow subscriptions — NOT subscribing to whole session object!
	const items = useLive((s) => s.sessions[sessionId]?.items ?? EMPTY_ITEMS);
	const pendingEchoes = useLive(
		(s) => s.sessions[sessionId]?.pendingUserEchoes ?? EMPTY_ECHOES,
	);
	const isStreamingActive = useLive(
		(s) =>
			Boolean(
				s.sessions[sessionId]?.streaming ||
					s.sessions[sessionId]?.streamingMessage,
			),
	);
	const scrollRequest = useLive((s) => s.sessions[sessionId]?.scrollRequest);

	const [showHidden, setShowHidden] = useState(false);
	const [toolsExpanded, setToolsExpanded] = useState<boolean | null>(null);
	const [highlightedId, setHighlightedId] = useState<string | null>(null);

	const isPinnedRef = useRef(true);
	const scrollRafRef = useRef(0);
	const lastHandledScrollReq = useRef<number>(0);
	const containerRef = useRef<HTMLDivElement>(null);

	// Throttled scroll to bottom using requestAnimationFrame
	const scrollToBottomThrottled = useCallback(() => {
		if (scrollRafRef.current) return;
		scrollRafRef.current = requestAnimationFrame(() => {
			scrollRafRef.current = 0;
			const el = scrollRef.current;
			if (el && isPinnedRef.current) {
				el.scrollTop = el.scrollHeight;
			}
		});
	}, [scrollRef]);

	// Viewport pin state, mirrored to the host for the scroll-to-bottom pill.
	const scrollStateRef = useRef({ nearBottom: true, hasNewMessages: false });
	const onScrollStateRef = useRef(onScrollState);
	onScrollStateRef.current = onScrollState;
	const emitScrollState = (patch: {
		nearBottom?: boolean;
		hasNewMessages?: boolean;
	}) => {
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

	// Group visible items into TurnBlocks and ProtocolBlocks
	const blocks = useMemo(() => groupTurnBlocks(visible), [visible]);

	// Map checkpoints by userItemId
	const checkpointByUserItem = useMemo(() => {
		const m = new Map<string, TurnCheckpoint>();
		for (const t of turns) {
			if (t.userItemId) {
				m.set(t.userItemId, t);
			}
		}
		return m;
	}, [turns]);

	const undoable = useMemo(
		() => undoableTurn(turns, sessionWorking),
		[turns, sessionWorking],
	);

	const hiddenCount = items.length - visible.length;
	const hasContent =
		blocks.length > 0 || pendingEchoes.length > 0 || isStreamingActive;

	const virtualizer = useVirtualizer({
		count: blocks.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 100,
		overscan: 4,
		getItemKey: (index) => blocks[index]?.id ?? index,
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

	// ResizeObserver for dynamic content expansion during streaming
	useEffect(() => {
		const el = scrollRef.current;
		const target = containerRef.current;
		if (!el || !target) return;
		const ro = new ResizeObserver(() => {
			scrollToBottomThrottled();
		});
		ro.observe(target);
		return () => {
			ro.disconnect();
			if (scrollRafRef.current) {
				cancelAnimationFrame(scrollRafRef.current);
			}
		};
	}, [scrollRef, scrollToBottomThrottled]);

	// Auto-scroll when new blocks arrive
	useEffect(() => {
		if (isPinnedRef.current) {
			scrollToBottomThrottled();
		} else if (blocks.length > 0 || pendingEchoes.length > 0) {
			emitScrollState({ hasNewMessages: true });
		}
	}, [blocks.length, pendingEchoes.length, scrollToBottomThrottled]);

	// Handle scrollToIndex and highlight from live.scrollRequest
	useEffect(() => {
		if (!scrollRequest || scrollRequest.timestamp === lastHandledScrollReq.current)
			return;
		lastHandledScrollReq.current = scrollRequest.timestamp;

		const targetId = scrollRequest.itemId;
		const targetIndex = blocks.findIndex((b) => {
			if (b.allItemIds.includes(targetId)) return true;
			if (
				b.type === "turn" &&
				b.intermediateSteps.some(
					(s) =>
						s.id === targetId ||
						(s.kind === "tool" &&
							(s.call.id === targetId || s.result?.toolCallId === targetId)),
				)
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
			setHighlightedId(targetId);
			const timer = setTimeout(() => {
				setHighlightedId(null);
			}, 2500);
			useLive.getState().clearScrollRequest(sessionId);
			return () => clearTimeout(timer);
		}
	}, [scrollRequest, blocks, virtualizer, sessionId]);

	// Consume cross-feature "jump to chat turn" requests (git timeline → chat)
	const revealTurn = useTurnNav((s) => s.revealTurn);
	const lastHandledReveal = useRef(0);
	useEffect(() => {
		if (!revealTurn || revealTurn.sessionId !== sessionId) return;
		if (revealTurn.nonce === lastHandledReveal.current) return;
		if (isLoadingTranscript) return;

		const idx = blocks.findIndex((b) =>
			b.allItemIds.includes(revealTurn.userItemId),
		);
		lastHandledReveal.current = revealTurn.nonce;
		useTurnNav.getState().clearTurn();
		if (idx < 0) return;

		virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
		setHighlightedId(revealTurn.userItemId);
		const timer = setTimeout(() => {
			setHighlightedId(null);
		}, 2500);
		return () => clearTimeout(timer);
	}, [revealTurn, blocks, virtualizer, sessionId, isLoadingTranscript]);

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
						title={toolsExpanded ? "折叠所有工具步骤" : "展开所有工具步骤"}
					>
						<Wrench size={10} />
						<span>{toolsExpanded ? "全部折叠步骤" : "全部展开步骤"}</span>
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
									try {
										await sendPrompt(sessionId, prompt);
										toast.info("已发送指令");
									} catch (e) {
										if (!isResumeCancelled(e))
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
					{blocks.length > 0 && (
						<div
							style={{ height: virtualizer.getTotalSize() }}
							className="relative w-full"
						>
							{virtualizer.getVirtualItems().map((row) => {
								const block = blocks[row.index];
								if (!block) return null;
								const isHighlighted = block.allItemIds.includes(
									highlightedId ?? "",
								);

								const cp =
									block.type === "turn" && block.userItem
										? checkpointByUserItem.get(block.userItem.id)
										: undefined;

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
									>
										{block.type === "turn" ? (
											<TurnBlockRow
												sessionId={sessionId}
												block={block}
												toolsExpanded={toolsExpanded}
												toolResultsByCallId={toolResultsByCallId}
												sessionCwd={sessionCwd}
												sessionFile={sessionFile}
												turnCheckpoint={cp}
												canUndo={cp !== undefined && cp === undoable}
												onTurnsChange={onTurnsChange}
											/>
										) : (
											<ProtocolRow item={block.item} />
										)}
									</div>
								);
							})}
						</div>
					)}

					{/* In-flight / pending user bubbles */}
					{pendingEchoes.length > 0 && (
						<div className="w-full">
							{pendingEchoes.map((echo) => (
								<div
									key={echo.id}
									id={`msg-${echo.id}`}
									className={clsx(
										"w-full py-1 opacity-90",
										traceGutter ? "pl-12 pr-3" : "px-3",
									)}
								>
									<UserRow sessionId={sessionId} item={echo} />
								</div>
							))}
						</div>
					)}

					{/* In-flight assistant streaming row */}
					{isStreamingActive && (
						<div
							id="msg-live"
							className={clsx(
								"w-full py-1",
								traceGutter ? "pl-12 pr-3" : "px-3",
							)}
						>
							<StreamingRow
								sessionId={sessionId}
								toolsExpanded={toolsExpanded}
								toolResultsByCallId={toolResultsByCallId}
								onScrollRequest={scrollToBottomThrottled}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
