/** [B] Virtualized message stream: turns + in-flight assistant
 * message + live tool cards. Every turn and step carries `id="msg-<itemId>"` so the
 * heatmap and jump navigators can scroll to it. */

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
	ChevronsDownUp,
	ChevronsUpDown,
	Copy,
	Eye,
	EyeOff,
	Pencil,
	RotateCcw,
} from "lucide-react";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	ToolResultInfo,
	TranscriptItem,
	TurnCheckpoint,
} from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useLive, type LiveTool, type UserEcho } from "../../stores/live";
import { useTurnNav } from "../../stores/turnNav";
import { useUi } from "../../stores/ui";
import { openContextWindowForModel } from "../settings/settingsTargets";
import { PrivacyText } from "../privacy/SecretChip";
import { AnswerFooter } from "./AnswerFooter";
import { AttachmentThumb } from "./ImageChips";
import { ImagePreviewModal } from "../../components/ImagePreviewModal";
import {
	ExecutionDisclosure,
	ProcessingTimer,
	TurnSteps,
	type StepShape,
	USER_BUBBLE_CLASS,
} from "./ExecutionDisclosure";
import type { ImageAttachment } from "../../lib/contracts";
import { getImageTokenPalette } from "./Composer";
import { Markdown } from "./markdown";
import { isContextOverflowError, splitModelRef } from "./contextOverflow";
import {
	buildToolResultsMap,
	filterVisibleItems,
} from "./messageTrace";
import { abortTurn, sendPrompt } from "./send";
import { CommandOutputList } from "./slash/CommandOutputList";
import {
	formatDurationCompact,
	formatMessageTimestamp,
	groupTurnBlocks,
	noticeLabel,
	noticeSummary,
	type TurnBlock,
} from "./turnGrouping";
const EMPTY_ITEMS: TranscriptItem[] = [];
const EMPTY_ECHOES: UserEcho[] = [];

/** In-flight steer echo as an activity step (same shape as persisted). */
function steerStep(echo: UserEcho): StepShape {
	return {
		id: `steer-${echo.id}`,
		kind: "steer",
		item: echo,
		text: stripImageMarkers(echo.text ?? ""),
	};
}
const EMPTY_TOOLS: Record<string, LiveTool> = {};

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

export function stripImageMarkers(text: string): string {
	return text
		.replace(
			/\[\d+\]\s*\([^)]*?\.(?:png|jpe?g|gif|webp|svg|bmp)[^)]*\)\s*\n?>?\s*(?:\[图片:[^\]]+\])?/gi,
			"",
		)
		.replace(
			/\[(?:Image|图片)\s*#\d+(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|\[图片(?::\s*[^\]]+)?\]|🖼️\s*#\d+/gu,
			"",
		)
		.trim();
}

const USER_MARKER_RE =
	/\[(?:Image|图片)\s*#(\d+)(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|🖼️\s*#(\d+)/gu;

/** User bubble text with image markers kept in place as clickable `#n`
 *  chips (Composer palette). Annotation-header noise is still stripped. */
function renderUserTextWithChips(
	text: string,
	onOpen: (markerNum: number) => void,
): React.ReactNode[] {
	const cleaned = text
		.replace(
			/\[\d+\]\s*\([^)]*?\.(?:png|jpe?g|gif|webp|svg|bmp)[^)]*\)\s*\n?>?\s*(?:\[图片:[^\]]+\])?/gi,
			"",
		)
		.trim();
	const parts: React.ReactNode[] = [];
	let last = 0;
	for (const m of cleaned.matchAll(USER_MARKER_RE)) {
		const at = m.index ?? 0;
		if (at > last) parts.push(<PrivacyText key={`t-${last}`} text={cleaned.slice(last, at)} />);
		const num = Number.parseInt(m[1] ?? m[2] ?? "1", 10) || 1;
		const palette = getImageTokenPalette(num);
		parts.push(
			<button
				key={`img-${at}`}
				type="button"
				onClick={() => onOpen(num)}
				title={`查看图片 #${num}`}
				className="mx-0.5 inline cursor-pointer align-baseline hover:opacity-80"
				style={{ color: palette.hex }}
			>
				<span
					className="underline decoration-2 underline-offset-[3px]"
					style={{ color: palette.hex, textDecorationColor: palette.hex }}
				>
					{`🖼️#${num}`}
				</span>
			</button>,
		);
		last = at + m[0].length;
	}
	if (last < cleaned.length) parts.push(<PrivacyText key={`t-${last}`} text={cleaned.slice(last)} />);
	return parts;
}

/** 20px-square ghost icon button, matching the AnswerFooter actions. */
const USER_ACTION_BTN =
	"flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]";

/**
 * Row padding next to the ChatTrace rail. Symmetric at every width: when the
 * column is centered the rail sits in the side margin, and when the column
 * spans the pane the rail collapses into the left padding and only peeks
 * open (as an overlay) on hover.
 */
const TRACE_GUTTER_PAD = "px-3";


/**
 * User message: right-aligned Codex bubble (70% max width, 22px radius,
 * --chat-user-bg). Long text collapses to a few lines behind 查看更多.
 * Image chips sit right-aligned above the bubble.
 */
const UserRow = React.memo(function UserRow({
	sessionId,
	item,
}: {
	sessionId: string;
	item: TranscriptItem;
}) {
	const rawText = item.text ?? "";
	const messageTime = formatMessageTimestamp(item.ts);
	const userText = useMemo(() => stripImageMarkers(rawText), [rawText]);
	const [expanded, setExpanded] = useState(false);
	const [collapsible, setCollapsible] = useState(false);
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const textRef = useRef<HTMLDivElement>(null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [resending, setResending] = useState(false);

	const resendEdited = async () => {
		const text = draft.trim();
		if (!text || resending) return;
		setResending(true);
		try {
			// Stop the in-flight turn first so the edited prompt starts fresh
			// instead of queueing behind the current generation.
			if (useLive.getState().sessions[sessionId]?.streaming) {
				await abortTurn(sessionId);
				await waitForIdle(sessionId);
			}
			await sendPrompt(sessionId, text);
			setEditing(false);
		} catch (e) {
			if (!isResumeCancelled(e)) toast.error(`重新发送失败: ${errMsg(e)}`);
		} finally {
			setResending(false);
		}
	};

	const validImages = useMemo(
		() =>
			(item.images ?? []).filter(
				(img): img is ImageAttachment & { path: string } => Boolean(img.path),
			),
		[item.images],
	);

	useEffect(() => {
		const el = textRef.current;
		if (!el) return;
		setCollapsible(el.scrollHeight > el.clientHeight + 1);
	}, [userText]);

	const showBubble = userText.trim().length > 0;
	return (
		<div
			id={`msg-${item.id}`}
			className="group/user-row relative flex w-full flex-col items-end gap-1.5 py-1"
		>
			{validImages.length > 0 && (
				<div className="flex max-w-[70%] flex-wrap justify-end gap-1.5">
					{validImages.map((img, i) => (
						<AttachmentThumb
							key={img.id}
							path={img.path}
							index={i + 1}
							showIndex={validImages.length > 1}
							variant="bubble"
							onOpen={() => setPreviewIndex(i)}
						/>
					))}
				</div>
			)}
			{previewIndex !== null && validImages.length > 0 && (
				<ImagePreviewModal
					images={validImages.map((img, idx) => ({
						path: img.path,
						marker: img.marker ?? `图片 #${idx + 1}`,
					}))}
					initialIndex={previewIndex}
					onClose={() => setPreviewIndex(null)}
				/>
			)}
			{editing ? (
				<div className="flex w-full max-w-[70%] flex-col gap-2 rounded-[22px] bg-[var(--chat-user-bg)] px-4 py-2.5">
					<textarea
						autoFocus
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								e.stopPropagation();
								setEditing(false);
							} else if (
								e.key === "Enter" &&
								(e.metaKey || e.ctrlKey) &&
								!e.nativeEvent.isComposing
							) {
								e.preventDefault();
								void resendEdited();
							}
						}}
						rows={Math.min(10, Math.max(2, draft.split("\n").length))}
						className="w-full resize-y bg-transparent text-[length:var(--chat-user-font-size)] leading-6 text-[var(--text)] outline-none"
					/>
					<div className="flex justify-end gap-1.5 text-[12px]">
						<button
							type="button"
							onClick={() => setEditing(false)}
							className="rounded-md px-2.5 py-1 text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						>
							取消
						</button>
						<button
							type="button"
							disabled={resending || !draft.trim()}
							onClick={() => void resendEdited()}
							className="rounded-md bg-[var(--text)] px-2.5 py-1 text-[var(--bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
						>
							{resending ? "发送中…" : "重新发送"}
						</button>
					</div>
				</div>
			) : showBubble ? (
				<div className={USER_BUBBLE_CLASS}>
					<div
						ref={textRef}
						className={clsx(
							"whitespace-pre-wrap break-words",
							!expanded && "line-clamp-4",
						)}
					>
						{renderUserTextWithChips(rawText, (num) => {
							if (validImages.length === 0) return;
							setPreviewIndex(
								Math.min(Math.max(num - 1, 0), validImages.length - 1),
							);
						})}
					</div>
					{collapsible && (
						<button
							type="button"
							onClick={() => setExpanded((v) => !v)}
							className="mt-0.5 text-[11px] text-[var(--text-40)] transition-colors hover:text-[var(--text-60)]"
						>
							{expanded ? "收起" : "查看更多"}
						</button>
					)}
				</div>
			) : null}
			{messageTime && (
				<span className="px-1 tabular-nums text-[var(--text-30)]">{messageTime}</span>
			)}
			<div
				className={clsx(
					"flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/user-row:opacity-100",
					editing && "hidden",
				)}
			>
				<button
					type="button"
					onClick={() => {
						setDraft(userText);
						setEditing(true);
					}}
					className={USER_ACTION_BTN}
					title="编辑并重新发送"
					aria-label="编辑并重新发送"
				>
					<Pencil size={12} />
				</button>
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
					className={USER_ACTION_BTN}
					title="重新发送此消息"
					aria-label="重新发送此消息"
				>
					<RotateCcw size={12} />
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
					className={USER_ACTION_BTN}
					title="复制消息"
					aria-label="复制消息"
				>
					<Copy size={12} />
				</button>
			</div>
		</div>
	);
});

/** Resolve once the session's turn has stopped streaming (or after a timeout). */
function waitForIdle(sessionId: string, timeoutMs = 5000): Promise<void> {
	return new Promise((resolve) => {
		if (!useLive.getState().sessions[sessionId]?.streaming) return resolve();
		const timer = window.setTimeout(done, timeoutMs);
		const unsub = useLive.subscribe((s) => {
			if (!s.sessions[sessionId]?.streaming) done();
		});
		function done() {
			window.clearTimeout(timer);
			unsub();
			resolve();
		}
	});
}

/**
 * Protocol row for system events (model change, compaction, …): centered
 * small tertiary text between hairlines — no pill, no icon tile.
 */
const ProtocolRow = React.memo(function ProtocolRow({
	item,
}: {
	item: TranscriptItem;
}) {
	const label = noticeLabel(item);
	const summary = noticeSummary(item);
	const text = summary ? `${label} · ${summary}` : label;

	return (
		<div
			id={`msg-${item.id}`}
			className="my-1.5 flex items-center gap-2 py-0.5"
		>
			<div className="h-px flex-1 bg-[var(--line)]" />
			<span
				className="shrink-0 truncate px-1 text-[11px] text-[var(--text-30)]"
				title={text}
			>
				{text}
			</span>
			<div className="h-px flex-1 bg-[var(--line)]" />
		</div>
	);
});

/**
 * A full turn in Codex style:
 * 1. Right-aligned user bubble
 * 2. Collapsed "已处理 …" divider over intermediate activity rows
 * 3. Plain assistant markdown answer (no bubble, no avatar)
 * 4. Hover-only ghost footer (copy/fork/meta)
 */
const TurnBlockRow = React.memo(function TurnBlockRow({
	sessionId,
	block,
	isLatestTurn,
	toolsExpanded,
	toolResultsByCallId,
	sessionCwd,
	sessionFile,
	turnCheckpoint,
	turns,
	sessionWorking = false,
	onTurnsChange,
	highlightedId,
}: {
	sessionId: string;
	block: TurnBlock;
	isLatestTurn?: boolean;
	toolsExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	sessionCwd: string;
	sessionFile: string;
	turnCheckpoint?: TurnCheckpoint;
	turns?: TurnCheckpoint[];
	sessionWorking?: boolean;
	onTurnsChange?: () => void;
	highlightedId?: string | null;
}) {
	const streamingThisTurn = useLive(
		(s) => isLatestTurn === true && s.sessions[sessionId]?.streaming === true,
	);
	const turnStartedAt = useMemo(() => {
		const ts = block.userItem?.ts ? Date.parse(block.userItem.ts) : Number.NaN;
		return Number.isNaN(ts) ? undefined : ts;
	}, [block.userItem?.ts]);
	const answerText = useMemo(() => {
		if (!block.answerItem?.text) return "";
		return stripImageMarkers(block.answerItem.text);
	}, [block.answerItem?.text]);
	const answerTime = formatMessageTimestamp(block.answerItem?.ts);
	const hasHighlightedStep = useMemo(() => {
		if (!highlightedId || block.intermediateSteps.length === 0) return false;
		return block.intermediateSteps.some(
			(s) =>
				s.id === highlightedId ||
				(s.kind === "tool" &&
					(s.call.id === highlightedId || s.result?.toolCallId === highlightedId)),
		);
	}, [highlightedId, block.intermediateSteps]);

	return (
		<div className="flex flex-col py-1">
			{/* User query bubble (absent when the turn has no visible user message) */}
			{block.userItem && <UserRow sessionId={sessionId} item={block.userItem} />}

			{/* Collapsed intermediate steps under the worked-for divider */}
			{block.intermediateSteps.length > 0 && (
				<ExecutionDisclosure
					sessionId={sessionId}
					steps={block.intermediateSteps}
					durationMs={block.durationMs}
					isStreaming={streamingThisTurn && !block.answerItem}
					startedAt={turnStartedAt}
					forceExpanded={toolsExpanded || hasHighlightedStep}
					toolResultsByCallId={toolResultsByCallId}
					highlightedStepId={hasHighlightedStep ? highlightedId : null}
				/>
			)}
			{/* Assistant answer — plain prose on the thread column */}
			{block.answerItem && (
				block.answerItem.stopReason === "aborted" ? (
					<div
						id={`msg-${block.answerItem.id}`}
						className="py-1 text-[length:var(--chat-font-size)] text-[var(--text-30)]"
					>
						已停止{block.durationMs ? ` · ${formatDurationCompact(block.durationMs)}` : ""}
						{answerTime && (
							<span className="ml-2 tabular-nums text-[11px] text-[var(--text-30)]" title="回复时间">
								{answerTime}
							</span>
						)}
					</div>
				) : (
				<div
					id={`msg-${block.answerItem.id}`}
					className="group/answer relative flex flex-col items-start py-1"
				>
					<div className="max-w-full text-[length:var(--chat-font-size)] text-[var(--text)]">
						{answerText ? (
							<Markdown text={answerText} />
						) : (
							<span className="italic text-[var(--text-40)]">空回复</span>
						)}
					</div>
					{block.answerItem.stopReason === "error" &&
						isContextOverflowError(block.answerItem.text) && (
							<ContextOverflowHint
								modelRef={block.answerItem.model ?? block.userItem?.model}
							/>
						)}

					{answerTime && (
						<span className="mt-1 tabular-nums text-[11px] text-[var(--text-30)]" title="回复时间">
							{answerTime}
						</span>
					)}
					{/* Hover-only ghost footer */}
					<AnswerFooter
						sessionId={sessionId}
						cwd={sessionCwd}
						sessionFile={sessionFile}
						turnCheckpoint={turnCheckpoint}
						turns={turns}
						sessionWorking={sessionWorking}
						onDoneUndo={onTurnsChange}
						answerText={answerText}
						answerTime={answerTime}
						answerItemId={block.answerItem?.id}
					/>
				</div>
				)
			)}
		</div>
	);
});

/** Hint under a context-overflow error: jump to the model's context-window row. */
function ContextOverflowHint({ modelRef }: { modelRef: string | null | undefined }) {
	const onClick = () => {
		const ref = splitModelRef(modelRef);
		if (ref) openContextWindowForModel(ref.providerId, ref.modelId);
		else useUi.getState().openSettings("context-window");
	};
	return (
		<div className="mt-1 text-[12px] text-[var(--text-60)]">
			可能是该模型的上下文窗口设得过大 →{" "}
			<button
				type="button"
				onClick={onClick}
				className="cursor-pointer text-[var(--accent)] hover:underline"
			>
				去调整
			</button>
		</div>
	);
}

/**
 * Isolated StreamingRow: subscribes to streamingMessage directly so MessageList
 * does NOT re-render on every token. Renders the in-flight turn as Codex
 * activity rows (thinking / tools / text) via the shared TurnSteps list.
 */
type LivePseudoStep = StepShape;

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
	const echoes = useLive(
		(s) => s.sessions[sessionId]?.pendingUserEchoes ?? EMPTY_ECHOES,
	);
	// Step index each in-flight steer was sent at, scoped to the streaming
	// message it interrupted: the steer stays where persisted grouping will
	// later place it (after the steps already emitted when it was sent).
	const steerAnchors = useRef(
		new Map<string, { msgKey: unknown; at: number }>(),
	);
	const liveTools = useLive(
		(s) => s.sessions[sessionId]?.tools ?? EMPTY_TOOLS,
	);
	const thinkingStartedAt = useLive(
		(s) => s.sessions[sessionId]?.thinkingStartedAt ?? null,
	);
	const thinkingEndedAt = useLive(
		(s) => s.sessions[sessionId]?.thinkingEndedAt ?? null,
	);
	// The row mounts when the turn starts streaming; tick from that moment.
	const [streamStartedAt] = useState(() => Date.now());

	// Build interleaved pseudo-steps from the streaming message content:
	// thinking parts → thinking steps, tool_use parts → tool steps, text parts
	// → plain markdown text. Live tools without a matching call are appended.
	const steps = useMemo<LivePseudoStep[]>(() => {
		const out: LivePseudoStep[] = [];
		const content = Array.isArray(streamingMessage?.content)
			? (streamingMessage.content as unknown[])
			: [];
		const seen = new Set<string>();
		let partIdx = 0;
		for (const part of content) {
			const o = asObj(part);
			const t = o.type;
			partIdx += 1;
			if (t === "thinking" || t === "thought") {
				const thinking = String(o.thinking ?? o.text ?? "");
				if (!thinking) continue;
				out.push({
					id: `live-thinking-${partIdx}`,
					kind: "thinking",
					thinking,
					running: !thinkingEndedAt,
					durationMs:
						thinkingStartedAt && thinkingEndedAt
							? thinkingEndedAt - thinkingStartedAt
							: undefined,
				});
			} else if (t === "tool_use" || t === "toolCall") {
				const id = String(o.id ?? "");
				if (!id) continue;
				seen.add(id);
				const live = liveTools[id];
				const hist = toolResultsByCallId?.get(id);
				out.push({
					id: `live-tool-${id}`,
					kind: "tool",
					call: {
						id,
						name: live?.toolName ?? String(o.name ?? ""),
						args: live?.args ?? o.input ?? o.arguments ?? {},
						intent: live?.intent ?? null,
					},
					result: hist,
				});
			} else if (t === "text") {
				const txt = String(o.text ?? "");
				if (!txt.trim()) continue;
				out.push({ id: `live-text-${partIdx}`, kind: "text", text: txt });
			}
		}
		// Live tools never declared in the streaming message still render.
		for (const [id, live] of Object.entries(liveTools)) {
			if (seen.has(id)) continue;
			out.push({
				id: `live-tool-${id}`,
				kind: "tool",
				call: {
					id,
					name: live.toolName,
					args: live.args,
					intent: live.intent,
				},
				result: toolResultsByCallId?.get(id),
			});
		}
		const msgKey = streamingMessage?.timestamp;
		const anchors = steerAnchors.current;
		const steers = echoes.filter((e) => e.steer);
		for (const id of anchors.keys()) {
			if (!steers.some((e) => e.id === id)) anchors.delete(id);
		}
		const placed = steers.map((echo) => {
			let anchor = anchors.get(echo.id);
			if (!anchor) {
				anchor = { msgKey, at: out.length };
				anchors.set(echo.id, anchor);
			}
			// A newer streaming message started after the steer: it sits first.
			const at = anchor.msgKey === msgKey ? anchor.at : 0;
			return { at, step: steerStep(echo) };
		});
		for (let i = placed.length - 1; i >= 0; i--) {
			const { at, step } = placed[i];
			out.splice(Math.min(at, out.length), 0, step);
		}
		return out;
	}, [
		streamingMessage,
		echoes,
		liveTools,
		toolResultsByCallId,
		thinkingStartedAt,
		thinkingEndedAt,
	]);

	// Throttle scroll request to rAF
	useEffect(() => {
		onScrollRequest?.();
	}, [steps.length, onScrollRequest]);

	return (
		<div className="flex flex-col py-1">
			<ProcessingTimer startedAt={streamStartedAt} />
			<TurnSteps
				sessionId={sessionId}
				steps={steps}
				forceExpanded={toolsExpanded}
				toolResultsByCallId={toolResultsByCallId}
			/>
			{/* Idle streaming state: session is working but nothing emitted yet */}
			{steps.length === 0 && (
				<div className="px-1 py-0.5 text-[length:var(--chat-font-size)] leading-6">
					<span className="shimmer-text">正在思考</span>
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
	// In-turn steers render inside StreamingRow at their step position; only
	// next-turn echoes (or steers orphaned after the stream ends) sit here.
	const bottomEchoes = useMemo(
		() =>
			isStreamingActive
				? pendingEchoes.filter((e) => !e.steer)
				: pendingEchoes,
		[pendingEchoes, isStreamingActive],
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

	// Last turn block — its footer stays visible even without hover.
	const lastTurnId = useMemo(() => {
		for (let i = blocks.length - 1; i >= 0; i--) {
			if (blocks[i].type === "turn") return blocks[i].id;
		}
		return null;
	}, [blocks]);

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
			const scrollTimer = setTimeout(() => {
				const el =
					document.getElementById(`msg-${targetId}`) ||
					document.querySelector(`[data-tool-id="${targetId}"]`);
				if (el) {
					el.scrollIntoView({ behavior: "smooth", block: "center" });
				}
			}, 120);
			const timer = setTimeout(() => {
				setHighlightedId(null);
			}, 3000);
			useLive.getState().clearScrollRequest(sessionId);
			return () => {
				clearTimeout(scrollTimer);
				clearTimeout(timer);
			};
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
					"mx-auto flex w-full shrink-0 items-center justify-between py-1 text-[11px] text-[var(--text-30)] @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-3xl",
					traceGutter ? TRACE_GUTTER_PAD : "px-3",
				)}
			>
				{hiddenCount > 0 ? (
					<button
						type="button"
						onClick={() => setShowHidden((v) => !v)}
						className="flex h-5 items-center gap-1 rounded px-1 text-[11px] tabular-nums text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text-60)]"
						title={showHidden ? "隐藏系统消息" : `显示 ${hiddenCount} 条隐藏消息`}
						aria-label={showHidden ? "隐藏系统消息" : `显示 ${hiddenCount} 条隐藏消息`}
					>
						{showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
						{hiddenCount}
					</button>
				) : (
					<div />
				)}
				<button
					type="button"
					onClick={() => setToolsExpanded((v) => !v)}
					className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text-60)]"
					title={toolsExpanded ? "折叠所有工具步骤" : "展开所有工具步骤"}
					aria-label={toolsExpanded ? "折叠所有工具步骤" : "展开所有工具步骤"}
				>
					{toolsExpanded ? (
						<ChevronsDownUp size={12} />
					) : (
						<ChevronsUpDown size={12} />
					)}
				</button>
			</div>

			{/* Loading transcript affordance */}
			{isLoadingTranscript && !hasContent && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center">
					<span className="shimmer-text text-[13px]">正在加载会话记录…</span>
				</div>
			)}

			{/* Error state with retry affordance — plain status text, no tile */}
			{!isLoadingTranscript && transcriptError && !hasContent && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center">
					<p className="text-[13px] font-medium text-[var(--text-60)]">
						加载会话记录失败
					</p>
					<p className="mt-1 max-w-sm text-[12px] leading-normal text-[var(--status-error)]">
						{transcriptError}
					</p>
					{onRetryTranscript && (
						<button
							type="button"
							onClick={onRetryTranscript}
							className="mt-3 flex items-center gap-1 rounded px-2 py-1 text-[12px] text-[var(--text-40)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						>
							<RotateCcw size={12} />
							<span>重试加载</span>
						</button>
					)}
				</div>
			)}

			{/* Empty state guidance — plain centered tertiary text, no icon tile */}
			{!isLoadingTranscript && !transcriptError && !hasContent && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center">
					<p className="text-[14px] font-medium text-[var(--text-60)]">
						准备就绪，随时提问
					</p>
					<p className="mt-1 mb-5 max-w-sm text-[12px] leading-normal text-[var(--text-30)]">
						在下方输入框描述你的任务，或者点击以下快捷指令开始
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
								className="cursor-pointer rounded-[10px] border border-[var(--line)] bg-transparent p-3 text-[11px] leading-5 text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
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
					className="relative mx-auto w-[calc(100%-4rem)] pb-8 @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-3xl"
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
											"absolute left-0 top-0 w-full py-1 transition-colors duration-300",
											traceGutter ? TRACE_GUTTER_PAD : "px-3",
											isHighlighted &&
												"rounded-[10px] bg-[var(--ghost-hover)]",
										)}
									>
										{block.type === "turn" ? (
											<TurnBlockRow
												sessionId={sessionId}
												block={block}
												isLatestTurn={block.id === lastTurnId}
												toolsExpanded={toolsExpanded}
												toolResultsByCallId={toolResultsByCallId}
												sessionCwd={sessionCwd}
												sessionFile={sessionFile}
												turnCheckpoint={cp}
												turns={turns}
												sessionWorking={sessionWorking}
												onTurnsChange={onTurnsChange}
												highlightedId={highlightedId}
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
					{bottomEchoes.length > 0 && (
						<div className="w-full">
							{bottomEchoes.map((echo) => (
								<div
									key={echo.id}
									id={`msg-${echo.id}`}
									className={clsx(
										"w-full py-1 opacity-90",
										traceGutter ? TRACE_GUTTER_PAD : "px-3",
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
								traceGutter ? TRACE_GUTTER_PAD : "px-3",
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

					{/* Inline slash-command output (omp command_output / app-local results) */}
					<div
						className={clsx(
							"w-full",
							traceGutter ? TRACE_GUTTER_PAD : "px-3",
						)}
					>
						<CommandOutputList sessionId={sessionId} />
					</div>
				</div>
			</div>
		</div>
	);
}
