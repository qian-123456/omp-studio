import { openImageOrExplain } from "./imageAvailability";
import { renderUserTextWithChips, stripImageMarkers } from "./userTextChips";
import { trimSideChatItems } from "./sideChatView";
/** [B] Virtualized message stream: turns + in-flight assistant
 * message + live tool cards. Every turn and step carries `id="msg-<itemId>"` so the
 * heatmap and jump navigators can scroll to it. */

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
	Check,
	Copy,
	Loader2,
	Pencil,
	RotateCcw,
} from "lucide-react";
import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
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
import { isFlowItem, withFlowNotices } from "./flowNotice";
import { QueuedBubbles } from "./QueuedBubbles";
import { collectUserImages, queuedEchoIds, useLive, type CommandOutputEntry, type LiveRequest, type LiveTool, type UserEcho } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useTurnNav } from "../../stores/turnNav";
import { currentLocateId, useLocate } from "../../stores/locate";
import { LocatePill } from "./LocatePill";
import { useUi } from "../../stores/ui";
import { StartHero } from "../../components/StartHero";
import { openContextWindowForModel } from "../settings/settingsTargets";
import { AnswerFooter } from "./AnswerFooter";
import { isForkDraftId } from "../sessions/forkDraft";
import { ClampedProse } from "./ClampedProse";
import { isShareableAnswer, isShareableUser } from "./share/shareEntries";
import { useShareSelection } from "./share/shareStore";
import { useLineClampOverflow } from "../../lib/useLineClamp";
import { normalizeThinkContent } from "../../lib/thinkTags";
import { AttachmentThumb, FileChip } from "./ImageChips";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { ImagePreviewModal } from "../../components/ImagePreviewModal";
import {
	ANSWER_TEXT_CLASS,
	ANSWER_WRAP_CLASS,
	ExecutionDisclosure,
	LiveDisclosure,
	TurnSteps,
	type StepShape,
	type TurnStatsPlan,
	USER_BUBBLE_CLASS,
	UserMessageBubble,
	LiveWaitingRow,
} from "./ExecutionDisclosure";
import type { ImageAttachment } from "../../lib/contracts";
import { parseInlineFiles } from "./fileAttach";
import { Markdown } from "./markdown";
import { isContextOverflowError, splitModelRef } from "./contextOverflow";
import {
	buildToolResultsMap,
	filterVisibleItems,
} from "./messageTrace";
import { abortTurn, sendPrompt } from "./send";
import { CommandOutputRow } from "./slash/CommandOutputRow";
import { RetryEpisodeRow, RetryNoticeList } from "./RetryNoticeList";
import type { RetryNotice } from "../../stores/retryNotice";
import { isRetryItem, withRetryEpisodes } from "./retryEpisodes";
import { isLocalRowItem, withLocalRows } from "./localRows";
import { RequestStatsLine } from "./RequestStatsLine";
import { type RequestStat, requestStatFromItem } from "./requestStats";
import {
	formatDurationCompact,
	formatMessageTimestamp,
	groupTurnBlocks,
	liveAnswerCandidate,
	noticeLabel,
	noticeSummary,
	splitAroundSteers,
	splitInterimProse,
	splitLiveTurn,
	turnRequestItems,
	type TurnBlock,
} from "./turnGrouping";
import {
	detach,
	initialFollowScroll,
	onScrollPosition,
	USER_INPUT_WINDOW_MS,
	onWroteBottom,
	shouldFollow,
	shouldCompensateResize,
	type FollowScrollState,
} from "./followScroll";
import { estimateBlockHeight } from "./blockEstimate";
import { claimEscape } from "../../lib/escapeClaim";
import { flashQuote } from "./annotationLocate";
import { useSessionSubagents } from "./subagents/useSessionSubagents";
import {
	collectSubagentFacts,
	durationWithSubagents,
	turnSubagentSpan,
} from "./turnSubagents";
import { useAnswerStarted } from "./useAnswerStarted";

const EMPTY_ITEMS: TranscriptItem[] = [];
/** Longest the live row outlives its stream while waiting for the committed turn. */
const LIVE_HOLD_MS = 2500;
const EMPTY_ECHOES: UserEcho[] = [];
const EMPTY_OUTPUTS: CommandOutputEntry[] = [];

/** In-flight steer echo as an activity step (same shape as persisted). */
function steerStep(echo: UserEcho): StepShape {
	return {
		id: `steer-${echo.id}`,
		kind: "steer",
		item: echo,
		text: stripImageMarkers(echo.text ?? ""),
	};
}
const EMPTY_REQUESTS: LiveRequest[] = [];
const EMPTY_TOOLS: Record<string, LiveTool> = {};

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/**
 * Row padding that clears the ChatTrace gutter. The dash strip sits at the
 * pane's left edge (≈28px), so the narrow layout uses an equal 2rem inset on
 * both sides; once the column is centered with side margins the padding is
 * the regular symmetric one.
 */
const TRACE_GUTTER_PAD = "px-8 @min-[864px]:px-3";

/** 20px-square ghost icon button, matching the AnswerFooter actions. */
const USER_ACTION_BTN =
	"flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]";

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
			collectUserImages(rawText, item.images).filter(
				(img): img is ImageAttachment & { path: string } => Boolean(img.path),
			),
		[rawText, item.images],
	);

	const collapsible = useLineClampOverflow(textRef, "line-clamp-4", 4, [userText, editing]);

	const fileAttachments = useMemo(() => {
		const seen = new Set<string>();
		const out: Array<{ index: number; path: string }> = [];
		for (const t of parseInlineFiles(rawText)) {
			if (!t.path || seen.has(t.path)) continue;
			seen.add(t.path);
			out.push({ index: t.index, path: t.path });
		}
		return out;
	}, [rawText]);
	// File-attachment markers render as chips even when they're the only content.
	const hasFileMarkers = useMemo(() => parseInlineFiles(rawText).length > 0, [rawText]);
	const showBubble = userText.trim().length > 0 || hasFileMarkers;
	return (
		<div
			id={`msg-${item.id}`}
			className="group/user-row relative flex w-full flex-col items-end gap-1.5 py-1"
		>
			{(validImages.length > 0 || fileAttachments.length > 0) && (
				<div className="flex max-w-[70%] flex-wrap items-start justify-end gap-1.5">
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
					{fileAttachments.map((f) => (
						<FileChip key={`file-${f.path}`} path={f.path} index={f.index} variant="bubble" />
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
					<AutoGrowTextarea
						autoFocus
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								claimEscape(e);
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
						className="w-full resize-none bg-transparent text-[length:var(--chat-user-font-size)] leading-6 text-[var(--text)] outline-none"
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
							{resending ? "发送中" : "重新发送"}
						</button>
					</div>
				</div>
			) : showBubble ? (
				<div className={USER_BUBBLE_CLASS}>
					<div
						ref={textRef}
						className={clsx(
							"whitespace-pre-wrap break-words",
							!expanded && collapsible && "line-clamp-4",
						)}
					>
						{renderUserTextWithChips(rawText, (num) => {
							void openImageOrExplain(
								validImages.map((i) => i.path),
								num,
								setPreviewIndex,
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
			<div className="flex items-center justify-end gap-1">
				<div
					className={clsx(
						"flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/user-row:opacity-100",
						(editing || isForkDraftId(sessionId)) && "hidden",
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
				{messageTime && (
					<span className="px-1 text-[11px] leading-5 tabular-nums text-[var(--text-30)]">{messageTime}</span>
				)}
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
	sessionId,
	item,
}: {
	sessionId: string;
	item: TranscriptItem;
}) {
	if (isLocalRowItem(item)) {
		const row = item.localRow;
		return row.type === "echo" ? (
			<div id={`msg-${row.echo.id}`} className="opacity-90">
				<UserRow sessionId={sessionId} item={row.echo} />
			</div>
		) : (
			<div id={`msg-${item.id}`}>
				<CommandOutputRow sessionId={sessionId} entry={row.entry} />
			</div>
		);
	}
	if (isRetryItem(item)) return <RetryEpisodeRow sessionId={sessionId} episode={item.retry} />;
	const label = noticeLabel(item);
	const summary = noticeSummary(item);
	const text = summary ? `${label} · ${summary}` : label;
	const running = isFlowItem(item) && item.flow.status === "running";

	return (
		<div
			id={`msg-${item.id}`}
			className="my-1.5 flex items-center gap-2 py-0.5"
		>
			<div className="h-px flex-1 bg-[var(--line)]" />
			<span
				className="flex shrink-0 items-center gap-1 truncate px-1 text-[11px] text-[var(--text-30)]"
				title={text}
			>
				{text}
				{running && <Loader2 size={11} className="animate-spin" aria-label="进行中" />}
			</span>
			<div className="h-px flex-1 bg-[var(--line)]" />
		</div>
	);
});

/**
 * Share-selection wrapper: while selection mode is active it adds a left
 * checkbox gutter, makes the whole message a single click target and mutes the
 * message's own interactive content.
 */
function ShareSelectable({
	active,
	selected,
	onToggle,
	children,
}: {
	active: boolean;
	selected: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	if (!active) return <>{children}</>;
	return (
		<div
			role="checkbox"
			aria-checked={selected}
			tabIndex={0}
			onClick={onToggle}
			onKeyDown={(e) => {
				if (e.key === " " || e.key === "Enter") {
					e.preventDefault();
					onToggle();
				}
			}}
			className={clsx(
				"relative -mx-2 cursor-pointer select-none rounded-xl py-0.5 pl-9 pr-2 transition-colors focus-visible:outline-none",
				selected ? "bg-[var(--bg-active-fill)]" : "hover:bg-[var(--ghost-hover)]",
			)}
		>
			<span
				aria-hidden
				className={clsx(
					"absolute left-2.5 top-3 flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
					selected
						? "border-[var(--text)] bg-[var(--text)] text-[var(--bg-panel)]"
						: "border-[var(--text-30)] text-transparent",
				)}
			>
				<Check size={11} strokeWidth={3} />
			</span>
			<div className="pointer-events-none">{children}</div>
		</div>
	);
}

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
	toolResultsByCallId,
	sessionCwd,
	sessionFile,
	subagentsRunning,
	subagentEndedAt,
	turnCheckpoint,
	turns,
	sessionWorking,
	onTurnsChange,
	highlightedId,
}: {
	sessionId: string;
	block: TurnBlock;
	isLatestTurn?: boolean;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	sessionCwd: string;
	sessionFile: string;
	turnCheckpoint?: TurnCheckpoint;
	turns?: TurnCheckpoint[];
	sessionWorking?: boolean;
	onTurnsChange?: () => void;
	highlightedId?: string | null;
	/** A subagent this turn dispatched is still running after the parent finished. */
	subagentsRunning?: boolean;
	/** Latest end among the turn's finished subagents (epoch ms). */
	subagentEndedAt?: number;
}) {
	const streamingThisTurn = useLive(
		(s) => isLatestTurn === true && s.sessions[sessionId]?.streaming === true,
	);
	const selecting = useShareSelection((s) => s.sessionId === sessionId);
	const userSelected = useShareSelection(
		(s) => !!block.userItem && s.selectedIds.includes(block.userItem.id),
	);
	const answerSelected = useShareSelection(
		(s) => !!block.answerItem && s.selectedIds.includes(block.answerItem.id),
	);
	const toggleShare = useShareSelection((s) => s.toggle);
	const userStartedAt = useMemo(() => {
		const ts = block.userItem?.ts ? Date.parse(block.userItem.ts) : Number.NaN;
		return Number.isNaN(ts) ? undefined : ts;
	}, [block.userItem?.ts]);
	// The parent's turn can end while its subagents keep going; then the title
	// stays live and the final duration covers the subagents' span.
	const awaitingSubagents = subagentsRunning === true && !streamingThisTurn;
	// The in-flight turn ticks on the live store's clock, the same one the
	// streaming row used before this header took over.
	const liveTurnStartedAt = useLive((s) =>
		streamingThisTurn || (isLatestTurn === true && awaitingSubagents)
			? (s.sessions[sessionId]?.turnStartedAt ?? null)
			: null,
	);
	const turnStartedAt = liveTurnStartedAt ?? userStartedAt;
	const turnDurationMs = durationWithSubagents(
		block.durationMs,
		block.endedAtMs,
		subagentEndedAt,
	);
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
	const { folded, prose } = useMemo(
		() => splitInterimProse(block.intermediateSteps),
		[block.intermediateSteps],
	);
	const foldedSegments = useMemo(() => splitAroundSteers(folded), [folded]);
	const firstStepsSeg = foldedSegments.findIndex((s) => s.type === "steps");
	const lastStepsSeg = foldedSegments.reduce((acc, s, i) => (s.type === "steps" ? i : acc), -1);
	const inProgress = streamingThisTurn && !block.answerItem && block.intermediateSteps.length > 0;

	// One model request per assistant message in the turn; the answer's own
	// request renders under the answer body instead of inside the steps.
	const requests = useMemo(() => {
		const out: TurnStatsPlan["requests"] = [];
		const push = (item: TranscriptItem | null | undefined) => {
			const stat = item ? requestStatFromItem(item) : null;
			if (!stat || !item) return;
			out.push({
				id: item.id,
				stat,
				toolCallIds: (item.toolCalls ?? []).map((c) => c.id),
			});
		};
		for (const item of turnRequestItems(block.intermediateSteps)) push(item);
		push(block.answerItem);
		return out;
	}, [block.intermediateSteps, block.answerItem]);
	const answerRequestId = block.answerItem?.id;
	const statsPlan = useMemo<TurnStatsPlan | undefined>(
		() =>
			requests.length > 0 ? { requests, answerRequestId } : undefined,
		[requests, answerRequestId],
	);
	const turnStats = useMemo<RequestStat[]>(
		() => requests.map((r) => r.stat),
		[requests],
	);
	const answerStat = useMemo(() => {
		if (!answerRequestId) return null;
		return requests.find((r) => r.id === answerRequestId)?.stat ?? null;
	}, [requests, answerRequestId]);

	return (
		<div className="flex flex-col py-1">
			{/* User query bubble (absent when the turn has no visible user message) */}
			{block.userItem && (
				<ShareSelectable
					active={selecting && isShareableUser(block.userItem)}
					selected={userSelected}
					onToggle={() => block.userItem && toggleShare(block.userItem.id)}
				>
					<UserRow sessionId={sessionId} item={block.userItem} />
				</ShareSelectable>
			)}

			{/* Collapsed intermediate steps under the worked-for divider; user
			    messages delivered mid-turn stay visible between the groups. */}
			{foldedSegments.map((seg, si) => {
				if (seg.type === "steer") {
					return (
						<div
							key={seg.step.id}
							id={`msg-${seg.step.id}`}
							className="flex flex-col items-end gap-1.5 py-1"
						>
							<UserMessageBubble
								text={seg.step.kind === "steer" ? (seg.step.item.text ?? seg.step.text) : ""}
								images={seg.step.kind === "steer" ? seg.step.item.images : undefined}
							/>
						</div>
					);
				}
				const isFirst = si === firstStepsSeg;
				const isLast = si === lastStepsSeg;
				return (
					<ExecutionDisclosure
						key={`fold-${seg.steps[0]?.id ?? si}`}
						sessionId={sessionId}
						steps={seg.steps}
						durationMs={isFirst ? turnDurationMs : undefined}
						isStreaming={inProgress ? isFirst : isLast && streamingThisTurn && !block.answerItem}
						awaitingSubagents={isFirst && awaitingSubagents}
						liveOpen={inProgress}
						hideHeader={inProgress && !isFirst}
						startedAt={turnStartedAt}
						forceExpanded={hasHighlightedStep}
						toolResultsByCallId={toolResultsByCallId}
						highlightedStepId={hasHighlightedStep ? highlightedId : null}
						statsPlan={statsPlan}
						turnStats={isFirst ? turnStats : undefined}
					/>
				);
			})}
			{/* Interim assistant prose stays on the thread column: it was readable
			    while streaming and must not vanish into the fold. */}
			{prose.map((step) =>
				step.kind === "text" ? (
					<div
						key={step.id}
						id={`msg-${step.id}`}
						className="py-1 text-[length:var(--chat-font-size)] text-[var(--text)]"
					>
						<ClampedProse>
							<Markdown text={stripImageMarkers(step.text)} sessionId={sessionId} />
						</ClampedProse>
					</div>
				) : null,
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
				<ShareSelectable
					active={selecting && isShareableAnswer(block.answerItem)}
					selected={answerSelected}
					onToggle={() => block.answerItem && toggleShare(block.answerItem.id)}
				>
				<div
					id={`msg-${block.answerItem.id}`}
					className={ANSWER_WRAP_CLASS}
				>
					<div className={ANSWER_TEXT_CLASS}>
						{answerText ? (
							<Markdown text={answerText} sessionId={sessionId} />
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

					{/* The answer request's stats line sits above the footer and is
					    always visible, even when the steps above stay collapsed. */}
					{answerStat && !answerStat.error && (
						<RequestStatsLine stat={answerStat} className="mt-0.5" omitTime />
					)}
					{/* Hover-only ghost footer */}
					{!selecting && !isForkDraftId(sessionId) && (
						<AnswerFooter
							sessionId={sessionId}
							cwd={sessionCwd}
							sessionFile={sessionFile}
							turnCheckpoint={turnCheckpoint}
							turns={turns}
							sessionWorking={sessionWorking}
							answerTime={answerTime}
							onDoneUndo={onTurnsChange}
							answerText={answerText}
							answerItemId={block.answerItem.id}
						/>
					)}
				</div>
				</ShareSelectable>
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
	toolResultsByCallId,
	onScrollRequest,
	showTimer,
	holding,
	persistedThinking,
}: {
	sessionId: string;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	onScrollRequest?: () => void;
	/** False when the latest turn's disclosure already shows the live timer. */
	showTimer: boolean;
	/** The stream ended; the row paints its last snapshot until the committed
	 * turn replaces it. */
	holding: boolean;
	/** Newest reasoning text already persisted in the latest turn (preview fallback). */
	persistedThinking: string;
}) {
	const streamingMessage = useLive(
		(s) => s.sessions[sessionId]?.streamingMessage ?? null,
	);
	const echoes = useLive(
		(s) => s.sessions[sessionId]?.pendingUserEchoes ?? EMPTY_ECHOES,
	);
	const ompQueue = useLive((s) => s.sessions[sessionId]?.ompQueue);
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
	const liveRequests = useLive(
		(s) => s.sessions[sessionId]?.liveRequests ?? EMPTY_REQUESTS,
	);
	const retryNotices = useLive((s) => s.sessions[sessionId]?.retryNotices);
	const retryFallback = useLive((s) => s.sessions[sessionId]?.retryFallback);
	/** Which completed request each rendered tool call belongs to. */
	const requestOfCall = useMemo(() => {
		const byCall = new Map<string, string>();
		for (const req of liveRequests) {
			for (const callId of req.toolCallIds) byCall.set(callId, req.id);
		}
		return byCall;
	}, [liveRequests]);
	const statsPlan = useMemo<TurnStatsPlan>(
		() => ({
			requests: liveRequests.map((r) => ({
				id: r.id,
				stat: r.stat,
				toolCallIds: r.toolCallIds,
			})),
		}),
		[liveRequests],
	);
	// One clock per turn (live store), so leaving and reopening the session or
	// the hand-off to the committed turn's header never restarts the timer.
	// Mount time only when the turn began before this app saw it start.
	const [mountedAt] = useState(() => Date.now());
	const liveTurnStartedAt = useLive((s) => s.sessions[sessionId]?.turnStartedAt ?? null);
	const streamStartedAt = liveTurnStartedAt ?? mountedAt;

	// Build interleaved pseudo-steps from the streaming message content:
	// thinking parts → thinking steps, tool_use parts → tool steps, text parts
	// → plain markdown text. Live tools without a matching call are appended.
	const steps = useMemo<LivePseudoStep[]>(() => {
		const out: LivePseudoStep[] = [];
		const content = normalizeThinkContent(
			Array.isArray(streamingMessage?.content)
				? (streamingMessage.content as unknown[])
				: [],
			{ streaming: true },
		);
		const seen = new Set<string>();
		const pushTool = (id: string, args: unknown, name: string | undefined) => {
			seen.add(id);
			const live = liveTools[id];
			out.push({
				id: `live-tool-${id}`,
				kind: "tool",
				call: {
					id,
					name: live?.toolName ?? name ?? "",
					args: live?.args ?? args ?? {},
					intent: live?.intent ?? null,
				},
				result: toolResultsByCallId?.get(id),
				requestId: requestOfCall.get(id),
			});
		};
		// Retry rows sit where they were raised: after the requests finished
		// by then, before whatever the retried request produces.
		const finished = liveRequests.length;
		const noticeGroups = new Map<number, RetryNotice[]>();
		for (const n of retryNotices ?? []) {
			const at = Math.min(n.anchor ?? finished, finished);
			noticeGroups.set(at, [...(noticeGroups.get(at) ?? []), n]);
		}
		const lastFallbackAt = [...noticeGroups.entries()]
			.filter(([, g]) => g.some((n) => n.kind === "fallback"))
			.map(([at]) => at)
			.pop();
		const pushRetry = (at: number) => {
			const group = noticeGroups.get(at);
			if (!group) return;
			out.push({
				id: `live-retry-${group[0].id}`,
				kind: "retry",
				notices: group,
				...(at === lastFallbackAt && retryFallback ? { fallback: retryFallback } : {}),
			});
		};
		// Finished requests first, in arrival order: their thinking / prose /
		// tool rows stay where they happened instead of collapsing to the top.
		pushRetry(0);
		liveRequests.forEach((req, reqIdx) => {
			// A failed request (retried by omp) produced nothing: show its
			// failure line right here, before the later requests' rows.
			if (req.stat.error && req.parts.length === 0 && req.toolCallIds.length === 0) {
				out.push({
					id: `live-failed-${req.id}`,
					kind: "request-failed",
					requestId: req.id,
				});
			}
			req.parts.forEach((part, partIdx) => {
				if (part.kind === "thinking") {
					out.push({
						id: `live-thinking-r${reqIdx}-${partIdx}`,
						kind: "thinking",
						thinking: part.text,
						durationMs: part.durationMs,
						requestId: req.id,
					});
				} else if (part.kind === "text") {
					out.push({
						id: `live-text-r${reqIdx}-${partIdx}`,
						kind: "text",
						text: part.text,
						requestId: req.id,
					});
				} else if (!seen.has(part.id)) {
					pushTool(part.id, undefined, undefined);
				}
			});
			pushRetry(reqIdx + 1);
		});
		// The in-flight message comes last; only its newest thinking part can
		// still be running, and it is the final row of the block.
		let lastThinkingIdx = -1;
		content.forEach((part, i) => {
			const t = asObj(part).type;
			if (t === "thinking" || t === "thought") lastThinkingIdx = i;
		});
		let partIdx = 0;
		for (const part of content) {
			const o = asObj(part);
			const t = o.type;
			partIdx += 1;
			if (t === "thinking" || t === "thought") {
				const thinking = String(o.thinking ?? o.text ?? "");
				if (!thinking) continue;
				const isLast = partIdx - 1 === lastThinkingIdx;
				const running = isLast && !thinkingEndedAt;
				out.push({
					id: `live-thinking-${partIdx}`,
					kind: "thinking",
					thinking,
					running,
					durationMs:
						isLast && thinkingStartedAt && thinkingEndedAt
							? thinkingEndedAt - thinkingStartedAt
							: undefined,
				});
			} else if (t === "tool_use" || t === "toolCall") {
				const id = String(o.id ?? "");
				if (!id || seen.has(id)) continue;
				pushTool(id, o.input ?? o.arguments, String(o.name ?? ""));
			} else if (t === "text") {
				const txt = String(o.text ?? "");
				if (!txt.trim()) continue;
				out.push({
					id: `live-text-${partIdx}`,
					kind: "text",
					text: txt,
					// Only the part the model is writing right now is unfinished.
					streaming: partIdx === content.length,
				});
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
				requestId: requestOfCall.get(id),
			});
		}
		const msgKey = streamingMessage?.timestamp;
		const anchors = steerAnchors.current;
		const queued = ompQueue
			? queuedEchoIds({ pendingUserEchoes: echoes, ompQueue })
			: new Set<string>();
		// A queued steer is not part of the running request yet: it shows as a
		// grey queued bubble below and joins the steps once delivered.
		const steers = echoes.filter((e) => e.steer && !queued.has(e.id));
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
		ompQueue,
		liveTools,
		liveRequests,
		retryNotices,
		retryFallback,
		toolResultsByCallId,
		requestOfCall,
		thinkingStartedAt,
		thinkingEndedAt,
	]);

	// While `holding` (the stream ended, the transcript has not caught up) the
	// store is already cleared: keep painting the last live snapshot so the turn
	// does not blank out before the committed block replaces it.
	const liveSnapshot = {
		steps,
		statsPlan: liveRequests.length > 0 ? statsPlan : undefined,
	};
	const frozenRef = useRef(liveSnapshot);
	if (!holding) frozenRef.current = liveSnapshot;
	const shown = holding ? frozenRef.current : liveSnapshot;
	const endedAtRef = useRef<number | null>(null);
	if (!holding) endedAtRef.current = null;
	else if (endedAtRef.current === null) endedAtRef.current = Date.now();

	// Final answer start: the activity folds into the disclosure and the turn
	// takes the committed layout (disclosure, interim prose, answer), so the
	// commit itself changes nothing but the title and the footer.
	const foldEnabled = showTimer;
	const candidate = foldEnabled ? liveAnswerCandidate(shown.steps) : null;
	const answerStarted = useAnswerStarted(candidate !== null, holding);
	const { activity, prose, answer } = useMemo(
		() => splitLiveTurn(shown.steps, answerStarted),
		[shown.steps, answerStarted],
	);
	const answerRequestId = answer?.kind === "text" ? answer.requestId : undefined;
	const stepsPlan = useMemo<TurnStatsPlan | undefined>(
		() =>
			shown.statsPlan && answerRequestId
				? { ...shown.statsPlan, answerRequestId }
				: shown.statsPlan,
		[shown.statsPlan, answerRequestId],
	);
	const answerStat = answerRequestId
		? shown.statsPlan?.requests.find((r) => r.id === answerRequestId)?.stat
		: undefined;
	const heldDurationMs =
		holding && endedAtRef.current !== null
			? Math.max(0, endedAtRef.current - streamStartedAt)
			: undefined;

	// Throttle scroll request to rAF
	useEffect(() => {
		onScrollRequest?.();
	}, [shown.steps.length, answerStarted, onScrollRequest]);

	const nodes: React.ReactNode[] = [];
	if (!answer) {
		if (showTimer) {
			nodes.push(
				<LiveDisclosure
					key="live-disclosure"
					sessionId={sessionId}
					steps={activity}
					folded={false}
					live={!holding}
					startedAt={streamStartedAt}
					durationMs={heldDurationMs}
					toolResultsByCallId={toolResultsByCallId}
					statsPlan={stepsPlan}
				/>,
			);
		} else {
			nodes.push(
				<TurnSteps
					key="live-steps"
					sessionId={sessionId}
					steps={activity}
					toolResultsByCallId={toolResultsByCallId}
					statsPlan={stepsPlan}
				/>,
			);
		}
		// Between model moves nothing is running: keep a 「正在思考」 row at the
		// bottom, like Codex, so the turn never looks stalled.
		const busy = activity.some(
			(s) =>
				(s.kind === "thinking" && s.running) ||
				(s.kind === "text" && s.streaming) ||
				(s.kind === "tool" && !s.result && liveTools[s.call.id]?.status === "running"),
		);
		if (!busy && !holding) {
			const lastThinking =
				[...activity].reverse().find((s) => s.kind === "thinking" && s.thinking.trim() !== "");
			nodes.push(
				<LiveWaitingRow
					key="live-waiting"
					thinking={
						lastThinking?.kind === "thinking" ? lastThinking.thinking : persistedThinking
					}
				/>,
			);
		}
	} else {
		const segments = splitAroundSteers(activity);
		const firstSteps = segments.findIndex((s) => s.type === "steps");
		segments.forEach((seg, si) => {
			if (seg.type === "steer") {
				nodes.push(
					<div
						key={seg.step.id}
						id={`msg-${seg.step.id}`}
						className="flex flex-col items-end gap-1.5 py-1"
					>
						<UserMessageBubble
							text={seg.step.kind === "steer" ? (seg.step.item?.text ?? seg.step.text) : ""}
							images={seg.step.kind === "steer" ? seg.step.item?.images : undefined}
						/>
					</div>,
				);
			} else if (si === firstSteps) {
				nodes.push(
					<LiveDisclosure
						key="live-disclosure"
						sessionId={sessionId}
						steps={seg.steps}
						folded
						live={!holding}
						startedAt={streamStartedAt}
						durationMs={heldDurationMs}
						toolResultsByCallId={toolResultsByCallId}
						statsPlan={stepsPlan}
					/>,
				);
			} else {
				nodes.push(
					<ExecutionDisclosure
						key={`fold-${seg.steps[0]?.id ?? si}`}
						sessionId={sessionId}
						steps={seg.steps}
						toolResultsByCallId={toolResultsByCallId}
						statsPlan={stepsPlan}
					/>,
				);
			}
		});
		for (const step of prose) {
			if (step.kind !== "text") continue;
			nodes.push(
				<div
					key={step.id}
					id={`msg-${step.id}`}
					className="py-1 text-[length:var(--chat-font-size)] text-[var(--text)]"
				>
					<ClampedProse>
						<Markdown text={stripImageMarkers(step.text)} sessionId={sessionId} />
					</ClampedProse>
				</div>,
			);
		}
		if (answer.kind === "text") {
			nodes.push(
				<div key="live-answer" id="msg-live-answer" className={ANSWER_WRAP_CLASS}>
					<div className={ANSWER_TEXT_CLASS}>
						<Markdown
							text={stripImageMarkers(answer.text)}
							sessionId={sessionId}
							streaming={!holding && answer.streaming}
						/>
					</div>
					{answerStat && !answerStat.error && (
						<RequestStatsLine stat={answerStat} className="mt-0.5" omitTime />
					)}
				</div>,
			);
		}
	}

	return <div className="flex flex-col py-1">{nodes}</div>;
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
	onEmptyChange,
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
	/** Fires when the "nothing to show yet" state toggles, so the parent can
	 * center the composer under the empty-state hero. */
	onEmptyChange?: (empty: boolean) => void;
}) {
	// Narrow subscriptions — NOT subscribing to whole session object!
	const rawItems = useLive((s) => s.sessions[sessionId]?.items ?? EMPTY_ITEMS);
	// Side chats inherit the parent's history; show only their own turns.
	const isSideChat = useSessions((s) => (s.sessions[sessionId]?.forkDepth ?? 0) > 0);
	const items = useMemo(() => trimSideChatItems(rawItems, isSideChat), [rawItems, isSideChat]);
	const pendingEchoes = useLive(
		(s) => s.sessions[sessionId]?.pendingUserEchoes ?? EMPTY_ECHOES,
	);
	const ompQueue = useLive((s) => s.sessions[sessionId]?.ompQueue);
	const flowNotices = useLive((s) => s.sessions[sessionId]?.flowNotices);
	const isStreamingActive = useLive(
		(s) =>
			Boolean(
				s.sessions[sessionId]?.streaming ||
					s.sessions[sessionId]?.streamingMessage,
			),
	);
	// In-turn steers render inside StreamingRow at their step position; only
	// next-turn echoes (or steers orphaned after the stream ends) sit here.
	const bottomEchoes = useMemo(() => {
		// Queued echoes are drawn by QueuedBubbles (grey, "排队中").
		const queued = ompQueue
			? queuedEchoIds({ pendingUserEchoes: pendingEchoes, ompQueue })
			: new Set<string>();
		const sent = pendingEchoes.filter((e) => !queued.has(e.id));
		return isStreamingActive ? sent.filter((e) => !e.steer) : sent;
	}, [pendingEchoes, ompQueue, isStreamingActive]);
	const scrollRequest = useLive((s) => s.sessions[sessionId]?.scrollRequest);

	const [highlightedId, setHighlightedId] = useState<string | null>(null);
	// The clear timer must outlive effect re-runs: the jump effects consume their
	// own request (re-triggering themselves), and a cleanup-bound timer would be
	// cancelled before it fires, leaving the row highlighted forever.
	const highlightTimerRef = useRef(0);
	const flashHighlight = useCallback((id: string, ms: number) => {
		window.clearTimeout(highlightTimerRef.current);
		setHighlightedId(id);
		highlightTimerRef.current = window.setTimeout(() => setHighlightedId(null), ms);
	}, []);
	useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);

	const followRef = useRef<FollowScrollState>(initialFollowScroll(Date.now()));
	const scrollTimerRef = useRef(0);
	const lastHandledScrollReq = useRef<number>(0);
	const containerRef = useRef<HTMLDivElement>(null);

	// Throttled scroll to bottom. Deliberately NOT requestAnimationFrame: an
	// off-screen/occluded WKWebView suspends rAF indefinitely, and a single
	// wedged callback used to leave scrollTimerRef non-zero forever — every
	// later bottom write silently dropped, so reopened sessions stayed at the
	// top. setTimeout(0) is never suspended and still coalesces bursts.
	const scrollToBottomThrottled = useCallback(() => {
		if (scrollTimerRef.current) return;
		scrollTimerRef.current = window.setTimeout(() => {
			scrollTimerRef.current = 0;
			const el = scrollRef.current;
			if (el && shouldFollow(followRef.current)) {
				el.scrollTop = el.scrollHeight;
				followRef.current = onWroteBottom(followRef.current, Date.now());
			}
		}, 0);
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

	// Viewport pin state is emitted from the scroll handler; the reopen
	// re-arm lives in a layout effect below (must run before paint).

	// Map of tool results by toolCallId
	const toolResultsByCallId = useMemo(
		() => buildToolResultsMap(items),
		[items],
	);

	// Compaction / handoff dividers sit in the flow right after the item that
	// was last when they started.
	const retryHistory = useLive((s) => s.sessions[sessionId]?.retryHistory);
	const hydrateRetryHistory = useLive((s) => s.hydrateRetryHistory);
	useEffect(() => hydrateRetryHistory(sessionId), [hydrateRetryHistory, sessionId]);
	const localEchoes = useLive((s) => s.sessions[sessionId]?.localEchoes);
	const commandOutputs = useLive((s) => s.sessions[sessionId]?.commandOutputs);
	const hydrateLocalRows = useLive((s) => s.hydrateLocalRows);
	useEffect(() => hydrateLocalRows(sessionId), [hydrateLocalRows, sessionId]);
	const withNotices = useMemo(
		() =>
			withLocalRows(
				withRetryEpisodes(withFlowNotices(items, flowNotices ?? []), retryHistory ?? []),
				localEchoes ?? EMPTY_ECHOES,
				commandOutputs ?? EMPTY_OUTPUTS,
			),
		[items, flowNotices, retryHistory, localEchoes, commandOutputs],
	);
	const visible = useMemo(() => filterVisibleItems(withNotices, false), [withNotices]);

	// Group visible items into TurnBlocks and ProtocolBlocks
	const blocks = useMemo(() => groupTurnBlocks(visible), [visible]);

	// Subagents outlive the parent prompt turn: extend each turn's span to the
	// subagents it dispatched (running ones keep its title live).
	const { subagents: sessionSubagents, rows: subagentRows } = useSessionSubagents(sessionId);
	const subagentSpans = useMemo(() => {
		const facts = collectSubagentFacts(sessionSubagents, subagentRows);
		const spans = new Map<string, { running: boolean; endedAt?: number }>();
		if (facts.length === 0) return spans;
		const turns = blocks.filter((b): b is TurnBlock => b.type === "turn");
		turns.forEach((b, i) => {
			const start = b.userItem?.ts ? Date.parse(b.userItem.ts) : Number.NaN;
			if (Number.isNaN(start)) return;
			const next = turns[i + 1]?.userItem?.ts ? Date.parse(turns[i + 1].userItem?.ts ?? "") : Number.NaN;
			const toolCallIds = new Set<string>();
			for (const s of b.intermediateSteps) if (s.kind === "tool") toolCallIds.add(s.call.id);
			const span = turnSubagentSpan({
				turnStart: start,
				nextTurnStart: Number.isNaN(next) ? undefined : next,
				toolCallIds,
				subagents: facts,
			});
			if (span.running || span.endedAt !== undefined) spans.set(b.id, span);
		});
		return spans;
	}, [blocks, sessionSubagents, subagentRows]);

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

	const hasContent =
		blocks.length > 0 || pendingEchoes.length > 0 || isStreamingActive;
	const isEmptyState = !isLoadingTranscript && !transcriptError && !hasContent;
	useEffect(() => {
		onEmptyChange?.(isEmptyState);
	}, [isEmptyState, onEmptyChange]);

	const virtualizer = useVirtualizer({
		count: blocks.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) => estimateBlockHeight(blocks[index]),
		overscan: 4,
		getItemKey: (index) => blocks[index]?.id ?? index,
	});
	// Above-fold size changes must be compensated in every scroll direction.
	// TanStack's default skips re-measurements during backward scroll, so a
	// row above the viewport that grows after mount (visualize iframe 240px →
	// real height) shifts the visible content. See shouldCompensateResize.
	virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
		item,
		_delta,
		instance,
	) =>
		shouldCompensateResize(
			item,
			(instance.scrollOffset ?? 0) + instance.scrollAdjustments,
			!instance.itemSizeCache.has(item.key),
			shouldFollow(followRef.current),
		);

	// Last turn block — its footer stays visible even without hover.
	const lastTurnId = useMemo(() => {
		for (let i = blocks.length - 1; i >= 0; i--) {
			if (blocks[i].type === "turn") return blocks[i].id;
		}
		return null;
	}, [blocks]);

	// The latest turn already shows a live "正在处理" disclosure (persisted
	// steps, no answer yet); StreamingRow must not add a second timer under it.
	const latestDisclosureLive = useLive((s) => {
		if (s.sessions[sessionId]?.streaming !== true) return false;
		for (let i = blocks.length - 1; i >= 0; i--) {
			const b = blocks[i];
			if (b.type === "turn") return b.intermediateSteps.length > 0 && !b.answerItem;
		}
		return false;
	});

	// Newest reasoning text of the latest turn, so the waiting row can preview it.
	const persistedThinking = useMemo(() => {
		for (let i = blocks.length - 1; i >= 0; i--) {
			const b = blocks[i];
			if (b.type !== "turn") continue;
			for (let j = b.intermediateSteps.length - 1; j >= 0; j--) {
				const st = b.intermediateSteps[j];
				if (st.kind === "thinking" && st.thinking.trim() !== "") return st.thinking;
			}
			return "";
		}
		return "";
	}, [blocks]);

	// Listen to scroll/gesture activity to maintain the follow-bottom state
	// machine. `scroll` events are only trusted outside the opening/settle
	// windows — clamp events from collapsing content and the virtualizer's
	// scrollTop adjustments are involuntary and must never detach. Upward
	// wheel/key/touch gestures detach immediately so a user can interrupt the
	// initial stick or live following at any time.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		let prevTop = el.scrollTop;
		// A scroll event with no user input behind it (virtualizer measurement
		// adjustments, clamps, late content growth) must never detach following:
		// at dispatch time the grown content makes it read as "far from bottom".
		let lastInputAt = 0;
		let pointerDown = false;
		const markInput = () => {
			lastInputAt = Date.now();
		};
		const handleScroll = () => {
			const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
			const movedUp = el.scrollTop < prevTop;
			prevTop = el.scrollTop;
			const now = Date.now();
			const userActive = pointerDown || now - lastInputAt < USER_INPUT_WINDOW_MS;
			const r = onScrollPosition(followRef.current, dist, now, movedUp, userActive);
			followRef.current = r.state;
			if (r.trusted) {
				emitScrollState({
					nearBottom: r.state.phase === "following",
					hasNewMessages: r.state.phase === "following" ? false : undefined,
				});
			}
		};
		const gestureDetach = () => {
			followRef.current = detach(followRef.current);
		};
		const onWheel = (e: WheelEvent) => {
			markInput();
			if (e.deltaY < 0) gestureDetach();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			markInput();
			if (
				e.key === "ArrowUp" ||
				e.key === "PageUp" ||
				e.key === "Home"
			) {
				gestureDetach();
			}
		};
		let touchY = 0;
		const onTouchStart = (e: TouchEvent) => {
			markInput();
			touchY = e.touches[0]?.clientY ?? 0;
		};
		const onTouchMove = (e: TouchEvent) => {
			markInput();
			const y = e.touches[0]?.clientY ?? touchY;
			if (y - touchY > 2) gestureDetach(); // finger up = scroll toward top
			touchY = y;
		};
		// Scrollbar-pill drags and text-selection autoscroll hold a pointer down.
		const onPointerDown = () => {
			pointerDown = true;
			markInput();
		};
		const onPointerUp = () => {
			pointerDown = false;
			markInput();
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		el.addEventListener("wheel", onWheel, { passive: true });
		el.addEventListener("keydown", onKeyDown);
		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchmove", onTouchMove, { passive: true });
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("pointerup", onPointerUp, true);
		window.addEventListener("pointercancel", onPointerUp, true);
		return () => {
			el.removeEventListener("scroll", handleScroll);
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("keydown", onKeyDown);
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchmove", onTouchMove);
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("pointerup", onPointerUp, true);
			window.removeEventListener("pointercancel", onPointerUp, true);
		};
	}, [scrollRef]);

	// ResizeObserver for dynamic content expansion during streaming
	useEffect(() => {
		const el = scrollRef.current;
		const target = containerRef.current;
		if (!el || !target) return;
		const ro = new ResizeObserver(() => {
			const el2 = scrollRef.current;
			// Pin in the same frame the content grew (before paint). A deferred
			// write lets one frame paint at the old offset, which reads as the
			// output block jittering on every streamed line.
			if (el2 && shouldFollow(followRef.current)) {
				el2.scrollTop = el2.scrollHeight;
				followRef.current = onWroteBottom(followRef.current, Date.now());
			}
		});
		ro.observe(target);
		return () => {
			ro.disconnect();
			if (scrollTimerRef.current) {
				clearTimeout(scrollTimerRef.current);
				scrollTimerRef.current = 0;
			}
		};
	}, [scrollRef, scrollToBottomThrottled]);

	// Reopen = follow-bottom, no matter how the previous session was left:
	// switching sessions reuses this component (and the scroll element), so
	// the machine must be re-armed before the stale clamp `scroll` event —
	// queued when the previous transcript collapses — can be processed.
	// This is a LAYOUT effect: it pins pre-paint (no flash of the top) and
	// cannot be wedged the way a requestAnimationFrame or timer callback can.
	// Declared after useVirtualizer so it runs after its layout effects.
	useLayoutEffect(() => {
		followRef.current = initialFollowScroll(Date.now());
		emitScrollState({ nearBottom: true, hasNewMessages: false });
	}, [sessionId]);

	// Hand-off from the live row to the committed block. The transcript is
	// fetched only after the stream ends, so for a moment neither the streamed
	// turn nor its committed twin exists: the live row stays mounted (painting
	// its last snapshot) until the transcript delivers a new block, then both
	// swap in one render. The timeout covers turns that commit nothing.
	const blocksKey = `${blocks.length}:${blocks[blocks.length - 1]?.id ?? ""}`;
	const [hold, setHold] = useState<{ key: string } | null>(null);
	const [wasStreaming, setWasStreaming] = useState(isStreamingActive);
	const [holdSessionId, setHoldSessionId] = useState(sessionId);
	if (holdSessionId !== sessionId) {
		// A session switch is not a stream ending: never hold another session's frame.
		setHoldSessionId(sessionId);
		setWasStreaming(isStreamingActive);
		setHold(null);
	} else if (wasStreaming !== isStreamingActive) {
		setWasStreaming(isStreamingActive);
		setHold(isStreamingActive ? null : { key: blocksKey });
	}
	const holding =
		holdSessionId === sessionId && !isStreamingActive && hold !== null && hold.key === blocksKey;
	useEffect(() => {
		if (!hold) return;
		if (hold.key !== blocksKey) {
			setHold(null);
			return;
		}
		const timer = window.setTimeout(() => setHold(null), LIVE_HOLD_MS);
		return () => window.clearTimeout(timer);
	}, [hold, blocksKey]);
	const liveVisible = isStreamingActive || holding;

	// Pin to the bottom whenever content appears or grows while following.
	// Runs synchronously post-commit (before paint), covering first mount,
	// the sessionId switch commit, the clear→load commits, pending echoes,
	// and the streaming row mounting/unmounting — without timers. The commit
	// of a streamed turn does not re-anchor: the viewport keeps its position.
	const totalSize = virtualizer.getTotalSize();
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && shouldFollow(followRef.current)) {
			el.scrollTop = el.scrollHeight;
			followRef.current = onWroteBottom(followRef.current, Date.now());
		}
	}, [sessionId, blocks.length, pendingEchoes.length, liveVisible, totalSize, scrollRef]);

	// Sending a message re-arms follow-bottom even after the viewport was left
	// above the stream (the user scrolling away).
	const echoCountRef = useRef(0);
	useLayoutEffect(() => {
		const n = pendingEchoes.length;
		if (n > echoCountRef.current && !shouldFollow(followRef.current)) {
			followRef.current = initialFollowScroll(Date.now());
			emitScrollState({ nearBottom: true, hasNewMessages: false });
		}
		echoCountRef.current = n;
	}, [pendingEchoes.length]);

	// Auto-scroll when new blocks arrive: the pin already ran pre-paint; this
	// passive pass coalesces the trailing write (handles heights that settle
	// after commit) and flags "new messages" while detached.
	useEffect(() => {
		if (shouldFollow(followRef.current)) {
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
			// Jump wins over follow-bottom for the duration of the smooth scroll.
			followRef.current = detach(followRef.current);
			virtualizer.scrollToIndex(targetIndex, {
				align: "center",
				behavior: "smooth",
			});
			const quote = scrollRequest.quote;
			const scrollToMessage = () => {
				const el =
					document.getElementById(`msg-${targetId}`) ||
					document.querySelector(`[data-tool-id="${targetId}"]`);
				if (el) {
					el.scrollIntoView({ behavior: "smooth", block: "center" });
				}
			};
			let scrollTimer: number | undefined;
			if (quote) {
				// Highlight only the quoted text; whole-message flash is the fallback.
				void flashQuote(targetId, quote, 3000).then((found) => {
					if (found) return;
					flashHighlight(targetId, 3000);
					scrollToMessage();
				});
			} else {
				flashHighlight(targetId, 3000);
				scrollTimer = window.setTimeout(scrollToMessage, 120);
			}
			useLive.getState().clearScrollRequest(sessionId);
			return () => clearTimeout(scrollTimer);
		}
	}, [scrollRequest, blocks, virtualizer, sessionId, flashHighlight]);

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
		// Jump wins over follow-bottom for the duration of the smooth scroll.
		followRef.current = detach(followRef.current);
		virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
		flashHighlight(revealTurn.userItemId, 2500);
	}, [revealTurn, blocks, virtualizer, sessionId, isLoadingTranscript, flashHighlight]);

	// Consume Token-panel "locate this tool call" targets: scroll to the call's
	// turn, flash it (the turn's fold / group / card mount or force open while
	// the flash is active), and retry the precise scroll as the rows grow open.
	const locateTarget = useLocate((s) => (s.target?.sessionId === sessionId ? s.target : null));
	const lastHandledLocate = useRef(0);
	useEffect(() => {
		if (!locateTarget || locateTarget.nonce === lastHandledLocate.current) return;
		if (isLoadingTranscript) return;
		const callId = currentLocateId(locateTarget);
		if (!callId) return;
		lastHandledLocate.current = locateTarget.nonce;
		const idx = blocks.findIndex(
			(b) =>
				b.type === "turn" &&
				b.intermediateSteps.some(
					(s) =>
						s.kind === "tool" &&
						(s.call.id === callId || s.result?.toolCallId === callId),
				),
		);
		if (idx < 0) {
			toast.info("没有在当前对话里找到这次调用");
			return;
		}
		followRef.current = detach(followRef.current);
		virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
		flashHighlight(callId, 2000);
		for (const delay of [150, 450, 900]) {
			window.setTimeout(() => {
				document
					.querySelector(`[data-tool-id="${CSS.escape(callId)}"]`)
					?.scrollIntoView({ behavior: "smooth", block: "center" });
			}, delay);
		}
	}, [locateTarget, blocks, virtualizer, isLoadingTranscript, flashHighlight]);
	const [locateHost, setLocateHost] = useState<HTMLDivElement | null>(null);
	return (
		<div ref={setLocateHost} className="relative flex h-full flex-col">
			<LocatePill sessionId={sessionId} host={locateHost} />

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

			{/* Empty state hero — the parent centers the composer right under it.
			    Side chats never show it: their stream stays empty while the first
			    prompt is in flight, and a "good evening" headline there is noise. */}
			{isEmptyState && !isSideChat && <StartHero />}

			{/* Stream list */}
			<div className="relative min-h-0 flex-1">
				<div
					ref={containerRef}
					className="relative mx-auto w-full pb-8 @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-3xl"
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
												toolResultsByCallId={toolResultsByCallId}
												sessionCwd={sessionCwd}
												sessionFile={sessionFile}
												turnCheckpoint={cp}
												turns={turns}
												sessionWorking={sessionWorking}
												subagentsRunning={subagentSpans.get(block.id)?.running}
												subagentEndedAt={subagentSpans.get(block.id)?.endedAt}
												onTurnsChange={onTurnsChange}
												highlightedId={highlightedId}
											/>
										) : (
											<ProtocolRow sessionId={sessionId} item={block.item} />
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
					{liveVisible && (
						<div
							id="msg-live"
							className={clsx(
								"w-full py-1",
								traceGutter ? TRACE_GUTTER_PAD : "px-3",
							)}
						>
							<StreamingRow
								sessionId={sessionId}
								toolResultsByCallId={toolResultsByCallId}
								onScrollRequest={scrollToBottomThrottled}
								showTimer={!latestDisclosureLive}
								holding={holding}
								persistedThinking={persistedThinking}
							/>
						</div>
					)}

					{/* Queued user messages: not yet sent into a model request */}
					<QueuedBubbles
						sessionId={sessionId}
						className={clsx("w-full", traceGutter ? TRACE_GUTTER_PAD : "px-3")}
					/>

					{/* Inline slash-command output (omp command_output / app-local results) */}
					<div
						className={clsx(
							"w-full",
							traceGutter ? TRACE_GUTTER_PAD : "px-3",
						)}
					>
						{!liveVisible && <RetryNoticeList sessionId={sessionId} />}
					</div>
				</div>
			</div>
		</div>
	);
}
