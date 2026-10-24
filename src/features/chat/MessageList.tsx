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
import { confirmDialog, copyTextWithImages, errMsg } from "../../lib/dialogs";
import { isResumeCancelled } from "../../lib/ensureLive";
import { isComposing } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
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
import { Markdown } from "../../components/Markdown";
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
	latestRequestAnchor,
	liveAnswerCandidate,
	noticeLabel,
	noticeSummary,
	splitAroundSteers,
	splitInterimProseBySteer,
	splitLiveTurn,
	turnRequestItems,
	type TurnBlock,
} from "./turnGrouping";
import {
	canDetachByGesture,
	detach,
	NEAR_BOTTOM_PX,
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
/** Safety net: longest the live row outlives its stream when the post-stream
 *  transcript page never lands (failed refresh). */
const LIVE_HOLD_MS = 10_000;
/** Window after the live row was last painted in which the committed turn's
 *  first measurement counts as the live→committed hand-off. */
const HANDOFF_MEASURE_MS = 5000;
/** Gap kept above the parked request so it clears the scroller's 1rem top fade. */
const PARK_TOP_GAP = 12;
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

/** Open inline-edit drafts by transcript item id (outlive the virtualized row). */
const editDrafts = new Map<string, string>();

/** Drop inline-edit drafts of the given transcript item ids (their session was removed). */
export function pruneEditDrafts(itemIds: readonly string[]): void {
	for (const id of itemIds) editDrafts.delete(id);
}

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
	const { t } = useT();
	const rawText = item.text ?? "";
	const messageTime = formatMessageTimestamp(item.ts);
	const userText = useMemo(() => stripImageMarkers(rawText), [rawText]);
	const [expanded, setExpanded] = useState(false);
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const textRef = useRef<HTMLDivElement>(null);
	// Edit state survives the row being virtualized away (keyed by item id).
	const [editing, setEditing] = useState(() => editDrafts.has(item.id));
	const [draft, setDraft] = useState(() => editDrafts.get(item.id) ?? "");
	const [resending, setResending] = useState(false);
	const updateDraft = (v: string) => {
		setDraft(v);
		editDrafts.set(item.id, v);
	};
	const closeEditor = () => {
		editDrafts.delete(item.id);
		setEditing(false);
	};

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
			closeEditor();
		} catch (e) {
			if (!isResumeCancelled(e)) toast.error(t("chat.message.resendFailed", { error: errMsg(e) }));
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
						marker: img.marker ?? t("chat.execution.imageMarker", { num: idx + 1 }),
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
						onChange={(e) => updateDraft(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Escape") {
								claimEscape(e);
								e.stopPropagation();
								closeEditor();
							} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								void resendEdited();
							}
						}}
						className="w-full resize-none bg-transparent text-[length:var(--chat-user-font-size)] leading-6 text-[var(--text)] outline-none"
					/>
					<div className="flex justify-end gap-1.5 text-[12px]">
						<button
							type="button"
							onClick={closeEditor}
							className="rounded-md px-2.5 py-1 text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							disabled={resending || !draft.trim()}
							onClick={() => void resendEdited()}
							className="rounded-md bg-[var(--text)] px-2.5 py-1 text-[var(--bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
						>
							{resending ? t("chat.message.resending") : t("chat.message.resend")}
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
							className="mt-1 rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						>
							{expanded ? t("common.collapse") : t("chat.message.viewMore")}
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
							updateDraft(userText);
							setEditing(true);
						}}
						className={USER_ACTION_BTN}
						title={t("chat.message.editAndResend")}
						aria-label={t("chat.message.editAndResend")}
					>
						<Pencil size={12} />
					</button>
					<button
						type="button"
						onClick={async () => {
							if (!userText.trim()) return;
							const ok = await confirmDialog(
								t("chat.message.confirmResend", { text: `${userText.slice(0, 100)}${userText.length > 100 ? "…" : ""}` }),
								{ okLabel: t("chat.message.resend") },
							);
							if (!ok) return;
							try {
								await sendPrompt(sessionId, userText);
								toast.success(t("chat.message.resendingToast"));
							} catch (e) {
								if (!isResumeCancelled(e))
									toast.error(t("chat.message.resendFailed", { error: errMsg(e) }));
							}
						}}
						className={USER_ACTION_BTN}
						title={t("chat.message.resendThisMessage")}
						aria-label={t("chat.message.resendThisMessage")}
					>
						<RotateCcw size={12} />
					</button>
					<button
						type="button"
						onClick={async () => {
							try {
								await copyTextWithImages(
									userText,
									validImages.map((i) => i.path),
									rawText,
								);
								toast.success(
									validImages.length > 0
										? t("chat.message.copiedWithImages", { count: validImages.length })
										: t("chat.message.copiedUserMessage"),
								);
							} catch (e) {
								toast.error(t("chat.message.copyFailed", { error: errMsg(e) }));
							}
						}}
						className={USER_ACTION_BTN}
						title={t("chat.message.copyMessage")}
						aria-label={t("chat.message.copyMessage")}
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
	const { t } = useT();
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
				className="flex min-w-0 max-w-[80%] flex-wrap items-center justify-center gap-1 whitespace-pre-wrap break-words px-1 text-center text-[11px] text-[var(--text-30)]"
				title={text}
			>
				{text}
				{running && <Loader2 size={11} className="animate-spin" aria-label={t("chat.message.inProgress")} />}
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
	const { t } = useT();
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
	const segments = useMemo(
		() => splitInterimProseBySteer(block.intermediateSteps),
		[block.intermediateSteps],
	);
	// Segments that carry a fold own the header (first) and the live state (last).
	const firstStepsSeg = segments.findIndex((s) => s.type === "steps" && s.folded.length > 0);
	const lastStepsSeg = segments.reduce(
		(acc, s, i) => (s.type === "steps" && s.folded.length > 0 ? i : acc),
		-1,
	);
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
			{segments.map((seg, si) => {
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
					<React.Fragment key={`seg-${seg.folded[0]?.id ?? seg.prose[0]?.id ?? si}`}>
						{seg.folded.length > 0 && (
							<ExecutionDisclosure
								sessionId={sessionId}
								steps={seg.folded}
								durationMs={isFirst ? turnDurationMs : undefined}
								isStreaming={inProgress ? isFirst : isLast && streamingThisTurn && !block.answerItem}
								awaitingSubagents={isFirst && awaitingSubagents}
								liveOpen={inProgress}
								hideHeader={inProgress && !isFirst}
								startedAt={turnStartedAt}
								forceExpanded={hasHighlightedStep ? true : null}
								toolResultsByCallId={toolResultsByCallId}
								highlightedStepId={hasHighlightedStep ? highlightedId : null}
								statsPlan={statsPlan}
								turnStats={isFirst ? turnStats : undefined}
							/>
						)}
						{/* Interim assistant prose stays on the thread column right after
						    its own fold: it was readable while streaming and must not
						    vanish into the fold, nor land after the steer it preceded. */}
						{seg.prose.map((step) =>
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
					</React.Fragment>
				);
			})}
			{/* Assistant answer — plain prose on the thread column */}
			{block.answerItem && (
				block.answerItem.stopReason === "aborted" ? (
					<div
						id={`msg-${block.answerItem.id}`}
						className="py-1 text-[length:var(--chat-font-size)] text-[var(--text-30)]"
					>
						{block.durationMs ? t("chat.message.stoppedWithTime", { time: formatDurationCompact(block.durationMs) }) : t("chat.message.stopped")}
						{answerTime && (
							<span className="ml-2 tabular-nums text-[11px] text-[var(--text-30)]" title={t("chat.message.responseTime")}>
								{answerTime}
							</span>
						)}
						{/* Stopped turns still need undo / changed files / fork. */}
						{!selecting && !isForkDraftId(sessionId) && (
							<AnswerFooter
								compact
								sessionId={sessionId}
								cwd={sessionCwd}
								sessionFile={sessionFile}
								turnCheckpoint={turnCheckpoint}
								turns={turns}
								sessionWorking={sessionWorking}
								onDoneUndo={onTurnsChange}
								answerItemId={block.answerItem.id}
							/>
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
							<span className="italic text-[var(--text-40)]">{t("chat.message.emptyReply")}</span>
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
	const { t } = useT();
	const onClick = () => {
		const ref = splitModelRef(modelRef);
		if (ref) openContextWindowForModel(ref.providerId, ref.modelId);
		else useUi.getState().openSettings("context-window");
	};
	return (
		<div className="mt-1 text-[12px] text-[var(--text-60)]">
			{t("chat.message.contextTooLargeHint")}
			<button
				type="button"
				onClick={onClick}
				className="cursor-pointer text-[var(--accent)] hover:underline"
			>
				{t("chat.message.goToAdjust")}
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
	persistedCallIds,
}: {
	sessionId: string;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	onScrollRequest?: () => void;
	/** False when the latest turn's disclosure already shows the live timer. */
	showTimer: boolean;
	/** The stream ended; the row paints its last snapshot until the committed
	 * turn replaces it. */
	holding: boolean;
	/** Tool-call ids the committed latest turn already shows (dedupe). */
	persistedCallIds: ReadonlySet<string>;
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
		new Map<string, { at: number }>(),
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
		// Same ids the finished request will give these rows (`r<finished>-<n>`,
		// n counting kept parts only) so message_end does not remount them.
		let keptIdx = -1;
		for (let ci = 0; ci < content.length; ci++) {
			const o = asObj(content[ci]);
			const t = o.type;
			const partIdx = ci + 1;
			if (t === "thinking" || t === "thought") {
				const thinking = String(o.thinking ?? o.text ?? "");
				if (!thinking) continue;
				keptIdx += 1;
				const isLast = partIdx - 1 === lastThinkingIdx;
				const running = isLast && !thinkingEndedAt;
				out.push({
					id: `live-thinking-r${finished}-${keptIdx}`,
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
				if (!id) continue;
				keptIdx += 1;
				if (seen.has(id)) continue;
				pushTool(id, o.input ?? o.arguments, String(o.name ?? ""));
			} else if (t === "text") {
				const txt = String(o.text ?? "");
				if (!txt.trim()) continue;
				keptIdx += 1;
				out.push({
					id: `live-text-r${finished}-${keptIdx}`,
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
				anchor = { at: out.length };
				anchors.set(echo.id, anchor);
			}
			// Rows of finished requests keep their order, so the anchor stays
			// valid across message boundaries (a delivered steer must not jump).
			return { at: anchor.at, step: steerStep(echo) };
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

	// Requests whose tool calls the committed turn already shows: their live
	// rows (and stats lines) would repeat those steps, so they are dropped.
	const liveVisible = useMemo(() => {
		const plan = liveRequests.length > 0 ? statsPlan : undefined;
		if (persistedCallIds.size === 0) return { visibleSteps: steps, visiblePlan: plan };
		const covered = new Set(
			liveRequests
				.filter((r) => r.toolCallIds.some((id) => persistedCallIds.has(id)))
				.map((r) => r.id),
		);
		const visibleSteps = steps.filter((s) => {
			if (s.kind === "tool" && persistedCallIds.has(s.call.id)) return false;
			return !("requestId" in s && s.requestId && covered.has(s.requestId));
		});
		const visiblePlan = plan
			? { ...plan, requests: plan.requests.filter((r) => !covered.has(r.id)) }
			: undefined;
		return { visibleSteps, visiblePlan };
	}, [steps, statsPlan, persistedCallIds, liveRequests]);

	// While `holding` (the stream ended, the transcript has not caught up) the
	// store is already cleared: keep painting the last live snapshot (already
	// deduped against the committed turn) so the turn does not blank out nor
	// repeat committed steps before the committed block replaces it.
	const frozenRef = useRef(liveVisible);
	if (!holding) frozenRef.current = liveVisible;
	const { visibleSteps, visiblePlan } = holding ? frozenRef.current : liveVisible;
	const endedAtRef = useRef<number | null>(null);
	if (!holding) endedAtRef.current = null;
	else if (endedAtRef.current === null) endedAtRef.current = Date.now();

	// Final answer start: the activity folds into the disclosure and the turn
	// takes the committed layout (disclosure, interim prose, answer), so the
	// commit itself changes nothing but the title and the footer.
	const foldEnabled = showTimer;
	const candidate = foldEnabled ? liveAnswerCandidate(visibleSteps) : null;
	const answerStarted = useAnswerStarted(candidate !== null, holding);
	const { activity, answer } = useMemo(
		() => splitLiveTurn(visibleSteps, answerStarted),
		[visibleSteps, answerStarted],
	);
	const answerRequestId = answer?.kind === "text" ? answer.requestId : undefined;
	const stepsPlan = useMemo<TurnStatsPlan | undefined>(
		() =>
			visiblePlan && answerRequestId ? { ...visiblePlan, answerRequestId } : visiblePlan,
		[visiblePlan, answerRequestId],
	);
	const answerStat = answerRequestId
		? visiblePlan?.requests.find((r) => r.id === answerRequestId)?.stat
		: undefined;
	const heldDurationMs =
		holding && endedAtRef.current !== null
			? Math.max(0, endedAtRef.current - streamStartedAt)
			: undefined;

	// Throttle scroll request to rAF
	useEffect(() => {
		onScrollRequest?.();
	}, [visibleSteps.length, answerStarted, onScrollRequest]);

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
		// A tool counts as running when omp says so, or when it is the trailing
		// call still being written (no live entry, no result yet). Older
		// result-less rows are finished history and must not hide the wait row.
		const busy =
			Object.values(liveTools).some((t) => t.status === "running") ||
			activity.some(
			(s, i) =>
				(s.kind === "thinking" && s.running) ||
				(s.kind === "text" && s.streaming) ||
				(s.kind === "tool" &&
					!s.result &&
					(liveTools[s.call.id]?.status === "running" ||
						(i === activity.length - 1 && !liveTools[s.call.id]))),
		);
		if (!busy && !holding) nodes.push(<LiveWaitingRow key="live-waiting" />);
	} else {
		// Per steer-delimited segment: fold, then that stretch's interim prose,
		// then the steer (same order the committed turn renders).
		const rest = visibleSteps.filter((s) => s !== answer);
		const segments = splitAroundSteers(rest).map((seg) =>
			seg.type === "steer"
				? seg
				: {
						type: "steps" as const,
						folded: seg.steps.filter((s) => s.kind !== "text"),
						prose: seg.steps.filter((s) => s.kind === "text"),
					},
		);
		const firstSteps = segments.findIndex((s) => s.type === "steps" && s.folded.length > 0);
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
				return;
			}
			if (seg.folded.length > 0) {
				if (si === firstSteps) {
					nodes.push(
						<LiveDisclosure
							key="live-disclosure"
							sessionId={sessionId}
							steps={seg.folded}
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
							key={`fold-${seg.folded[0]?.id ?? si}`}
							sessionId={sessionId}
							steps={seg.folded}
							toolResultsByCallId={toolResultsByCallId}
							statsPlan={stepsPlan}
						/>,
					);
				}
			}
			for (const step of seg.prose) {
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
		});
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
	const { t } = useT();
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
	// Hand-off from the live row to the committed block. The transcript is
	// fetched only after the stream ends, so for a moment neither the streamed
	// turn nor its committed twin exists: the live row stays mounted (painting
	// its last snapshot) until that transcript page lands, then both swap in
	// one render. Keyed on the page itself (every applied page is a new items
	// array), not on its content: a page that commits nothing new ends the hold
	// too, and a slow page never leaves a gap where the finished answer has
	// vanished and the previous reply sits at the bottom. The timeout only
	// covers a refresh that never lands.
	const blocksKey = `${items.length}:${items[items.length - 1]?.id ?? ""}`;
	const [hold, setHold] = useState<{ page: TranscriptItem[] } | null>(null);
	const [wasStreaming, setWasStreaming] = useState(isStreamingActive);
	const [holdSessionId, setHoldSessionId] = useState(sessionId);
	if (holdSessionId !== sessionId) {
		// A session switch is not a stream ending: never hold another session's frame.
		setHoldSessionId(sessionId);
		setWasStreaming(isStreamingActive);
		setHold(null);
	} else if (wasStreaming !== isStreamingActive) {
		setWasStreaming(isStreamingActive);
		setHold(isStreamingActive ? null : { page: rawItems });
	}
	const holding =
		holdSessionId === sessionId && !isStreamingActive && hold !== null && hold.page === rawItems;
	useEffect(() => {
		if (!hold) return;
		if (hold.page !== rawItems) {
			setHold(null);
			return;
		}
		const timer = window.setTimeout(() => setHold(null), LIVE_HOLD_MS);
		return () => window.clearTimeout(timer);
	}, [hold, rawItems]);
	// In-turn steers render inside StreamingRow at their step position; only
	// next-turn echoes (or steers orphaned after the stream ends) sit here.
	const bottomEchoes = useMemo(() => {
		// Queued echoes are drawn by QueuedBubbles (grey, "排队中").
		const queued = ompQueue
			? queuedEchoIds({ pendingUserEchoes: pendingEchoes, ompQueue })
			: new Set<string>();
		const sent = pendingEchoes.filter((e) => !queued.has(e.id));
		// The held live row still paints delivered steers: do not repeat them.
		return isStreamingActive || holding ? sent.filter((e) => !e.steer) : sent;
	}, [pendingEchoes, ompQueue, isStreamingActive, holding]);
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

	const lastTurnIdRef = useRef<unknown>(null);
	const liveSeenAtRef = useRef(0);
	const jumpTimerRef = useRef(0);
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
	) => {
		const viewportTop = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
		const firstMeasure = !instance.itemSizeCache.has(item.key);
		// The committed turn replacing the live row is measured for the first
		// time here; the text the user may be reading sits inside it, so a
		// bigger-than-estimated height must not shift scrollTop under them.
		if (
			firstMeasure &&
			item.key === lastTurnIdRef.current &&
			Date.now() - liveSeenAtRef.current < HANDOFF_MEASURE_MS &&
			item.end > viewportTop
		) {
			return false;
		}
		return shouldCompensateResize(item, viewportTop, firstMeasure, shouldFollow(followRef.current));
	};

	// Last turn block — its footer stays visible even without hover.
	const lastTurnId = useMemo(() => {
		for (let i = blocks.length - 1; i >= 0; i--) {
			if (blocks[i].type === "turn") return blocks[i].id;
		}
		return null;
	}, [blocks]);
	lastTurnIdRef.current = lastTurnId;

	// The latest turn already shows a live "正在处理" disclosure (persisted
	// steps, no answer yet); StreamingRow must not add a second timer under it.
	const latestDisclosureLiveNow = useLive((s) => {
		if (s.sessions[sessionId]?.streaming !== true) return false;
		for (let i = blocks.length - 1; i >= 0; i--) {
			const b = blocks[i];
			if (b.type === "turn") return b.intermediateSteps.length > 0 && !b.answerItem;
		}
		return false;
	});
	// While the held row waits for the committed turn the store is already
	// cleared; keep the pre-hold layout so the held row does not switch to a
	// second disclosure that repeats the committed steps.
	// (Updated in a layout effect, not during render: React discards the first
	// render pass of a hold-start, and a render-time write would survive it.)
	const frozenDisclosureLive = useRef(latestDisclosureLiveNow);
	useLayoutEffect(() => {
		if (!holding) frozenDisclosureLive.current = latestDisclosureLiveNow;
	});
	const latestDisclosureLive = holding ? frozenDisclosureLive.current : latestDisclosureLiveNow;

	// Tool-call ids the committed latest turn already renders. While that turn
	// shows its own live disclosure, StreamingRow drops whatever these cover.
	const persistedCallIds = useMemo(() => {
		const ids = new Set<string>();
		if (!latestDisclosureLive) return ids;
		for (let i = blocks.length - 1; i >= 0; i--) {
			const b = blocks[i];
			if (b.type !== "turn") continue;
			for (const st of b.intermediateSteps) if (st.kind === "tool") ids.add(st.call.id);
			break;
		}
		return ids;
	}, [blocks, latestDisclosureLive]);

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
			if (e.deltaY < 0 && canDetachByGesture(el, e.deltaX, e.deltaY)) gestureDetach();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			markInput();
			// Keys typed into an inline editor move its caret, not the scroller.
			const t = e.target as HTMLElement | null;
			if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
			if (
				(e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") &&
				canDetachByGesture(el)
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
			if (y - touchY > 2 && canDetachByGesture(el)) gestureDetach(); // finger down = scroll toward top
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
			} else if (el2) {
				// Detached: no scroll event follows content growth, so report the
				// real distance (shows the scroll-to-bottom pill as the answer grows).
				const dist = el2.scrollHeight - el2.scrollTop - el2.clientHeight;
				emitScrollState({ nearBottom: dist < NEAR_BOTTOM_PX });
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

	const liveVisible = isStreamingActive || holding;
	if (liveVisible) liveSeenAtRef.current = Date.now();

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

	// A finished answer taller than the viewport: park the view on the request
	// that produced it (answer right below) instead of leaving the user at the
	// tail of a long reply. Armed when the stream ends, fired by the first
	// transcript delivery after that. Never by the live row merely going away
	// (hold timeout before the transcript lands): the blocks then still end at
	// the previous turn, and parking there showed the previous reply. Only when
	// still pinned — a user who scrolled away mid-stream keeps their position.
	// Declared after the pin effect so it overrides that write in the same commit.
	const parkArmedRef = useRef<{ page: TranscriptItem[]; key: string } | null>(null);
	const prevStreamRef = useRef({ sessionId, isStreamingActive });
	useLayoutEffect(() => {
		const prev = prevStreamRef.current;
		prevStreamRef.current = { sessionId, isStreamingActive };
		if (prev.sessionId !== sessionId || isStreamingActive) parkArmedRef.current = null;
		else if (prev.isStreamingActive) parkArmedRef.current = { page: rawItems, key: blocksKey };
	}, [sessionId, isStreamingActive, rawItems, blocksKey]);
	useLayoutEffect(() => {
		const armed = parkArmedRef.current;
		if (armed === null || liveVisible || armed.page === rawItems) return;
		parkArmedRef.current = null;
		// The refresh committed nothing new: there is no new answer to show.
		if (armed.key === blocksKey) return;
		const el = scrollRef.current;
		const anchor = latestRequestAnchor(blocks);
		if (!el || anchor === null || !shouldFollow(followRef.current)) return;
		const node = containerRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`msg-${anchor}`)}`);
		const list = node?.closest("[data-index]")?.parentElement;
		if (!node || !list) return;
		const contentTop = el.getBoundingClientRect().top - el.scrollTop;
		const target = Math.max(0, node.getBoundingClientRect().top - contentTop - PARK_TOP_GAP);
		// The new row was measured on mount, so the virtualizer's total is
		// already exact while the DOM list height still holds the estimate.
		const listTop = list.getBoundingClientRect().top - contentTop;
		const afterList = el.scrollHeight - (listTop + list.offsetHeight);
		const contentEnd = listTop + virtualizer.getTotalSize() + afterList;
		if (contentEnd - target <= el.clientHeight) return;
		followRef.current = detach(followRef.current);
		el.scrollTop = target;
		emitScrollState({ nearBottom: false });
	}, [liveVisible, rawItems, blocksKey, blocks, virtualizer, scrollRef]);

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
			// Align the block's top: centering a turn taller than the viewport
			// would leave its question off-screen. A step target is refined below.
			virtualizer.scrollToIndex(targetIndex, {
				align: "start",
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
			if (quote) {
				// Highlight only the quoted text; whole-message flash is the fallback.
				void flashQuote(targetId, quote, 3000).then((found) => {
					if (found) return;
					flashHighlight(targetId, 3000);
					scrollToMessage();
				});
			} else {
				flashHighlight(targetId, 3000);
				// Not cleared by this effect's cleanup: it consumes its own request
				// below, which re-runs the effect and would cancel a bound timer.
				window.clearTimeout(jumpTimerRef.current);
				jumpTimerRef.current = window.setTimeout(scrollToMessage, 120);
			}
			useLive.getState().clearScrollRequest(sessionId);
		}
	}, [scrollRequest, blocks, virtualizer, sessionId, flashHighlight]);
	useEffect(() => () => window.clearTimeout(jumpTimerRef.current), []);

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
		// Transcript not materialised yet (load not started): keep the target
		// pending instead of consuming it against an empty list.
		if (idx < 0 && blocks.length === 0) return;
		lastHandledReveal.current = revealTurn.nonce;
		useTurnNav.getState().clearTurn();
		if (idx < 0) return;
		// Jump wins over follow-bottom for the duration of the smooth scroll.
		followRef.current = detach(followRef.current);
		virtualizer.scrollToIndex(idx, { align: "start", behavior: "smooth" });
		flashHighlight(revealTurn.userItemId, 2500);
		// A target deeper inside the turn (an assistant reply from a search hit):
		// refine to the message itself once its row has mounted.
		const blk = blocks[idx];
		if (blk.type === "turn" && blk.userItem?.id !== revealTurn.userItemId) {
			const targetId = revealTurn.userItemId;
			for (const delay of [150, 450, 900]) {
				window.setTimeout(() => {
					document
						.getElementById(`msg-${targetId}`)
						?.scrollIntoView({ behavior: "smooth", block: "center" });
				}, delay);
			}
		}
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
			toast.info(t("chat.message.callNotFoundInChat"));
			return;
		}
		followRef.current = detach(followRef.current);
		virtualizer.scrollToIndex(idx, { align: "start", behavior: "smooth" });
		flashHighlight(callId, 2000);
		for (const delay of [150, 450, 900]) {
			window.setTimeout(() => {
				document
					.querySelector(`[data-tool-id="${CSS.escape(callId)}"]`)
					?.scrollIntoView({ behavior: "smooth", block: "center" });
			}, delay);
		}
	}, [locateTarget, blocks, virtualizer, isLoadingTranscript, flashHighlight, t]);
	// Anchor the pill to the (non-scrolling) scroll container, not the list root
	// that moves with scrollTop.
	const [locateHost, setLocateHost] = useState<HTMLElement | null>(null);
	useEffect(() => setLocateHost(scrollRef.current), [scrollRef]);
	return (
		<div className="relative flex h-full flex-col">
			<LocatePill sessionId={sessionId} host={locateHost} />

			{/* Loading transcript affordance */}
			{isLoadingTranscript && !hasContent && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center">
					<span className="shimmer-text text-[13px]">{t("chat.message.loadingTranscript")}</span>
				</div>
			)}

			{/* Error state with retry affordance — plain status text, no tile */}
			{!isLoadingTranscript && transcriptError && !hasContent && (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center">
					<p className="text-[13px] font-medium text-[var(--text-60)]">
						{t("chat.message.loadTranscriptFailed")}
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
							<span>{t("chat.message.retryLoading")}</span>
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
										data-turn-id={block.id}
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
								latestDisclosureLive ? "w-full pb-1" : "w-full py-1",
								traceGutter ? TRACE_GUTTER_PAD : "px-3",
							)}
						>
							<StreamingRow
								sessionId={sessionId}
								toolResultsByCallId={toolResultsByCallId}
								onScrollRequest={scrollToBottomThrottled}
								showTimer={!latestDisclosureLive}
								holding={holding}
								persistedCallIds={persistedCallIds}
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
