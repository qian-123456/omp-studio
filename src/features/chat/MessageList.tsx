import { trimSideChatItems } from "./sideChatView";
/** [B] Virtualized message stream: turns + in-flight assistant
 * message + live tool cards. Every turn and step carries `id="msg-<itemId>"` so the
 * heatmap and jump navigators can scroll to it. */

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
	Check,
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
import { useLive, type LiveTool, type UserEcho } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useTurnNav } from "../../stores/turnNav";
import { useUi } from "../../stores/ui";
import { StartHero } from "../../components/StartHero";
import { openContextWindowForModel } from "../settings/settingsTargets";
import { PrivacyText } from "../privacy/SecretChip";
import { AnswerFooter } from "./AnswerFooter";
import { isShareableAnswer, isShareableUser } from "./share/shareEntries";
import { useShareSelection } from "./share/shareStore";
import { AttachmentThumb, FileChip } from "./ImageChips";
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
import { openPath } from "@tauri-apps/plugin-opener";
import { parseInlineFiles } from "./fileAttach";
import { Markdown } from "./markdown";
import { isContextOverflowError, splitModelRef } from "./contextOverflow";
import {
	buildToolResultsMap,
	filterVisibleItems,
} from "./messageTrace";
import { abortTurn, sendPrompt } from "./send";
import { CommandOutputList } from "./slash/CommandOutputList";
import { parseLeadingCommand } from "./slash/chip";
import { CommandChipBadge } from "./slash/CommandChip";
import { RetryNoticeList } from "./RetryNoticeList";
import {
	formatDurationCompact,
	formatMessageTimestamp,
	groupTurnBlocks,
	noticeLabel,
	noticeSummary,
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
			/\[(?:Image|图片)\s*#\d+(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|\[图片(?::\s*[^\]]+)?\]|🖼️\s*#\d+|\[(?:File|文件)\s*#\d+(?::\s*[^\]]+)?\]|📎\s*#\d+/gu,
			"",
		)
		.trim();
}

const USER_MARKER_RE =
	/\[(?:Image|图片)\s*#(\d+)(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|🖼️\s*#(\d+)/gu;

/** File-attachment marker `[文件 #N: path]` / `[File #N: path]` / `📎#N`;
 * groups: 1=num 2=path, 3=num (emoji form). */
const USER_FILE_MARKER_RE =
	/\[(?:File|文件)\s*#(\d+)(?::\s*([^\]]+))?\]|📎\s*#(\d+)/gu;

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
	// Leading `/skill:x` (or known command) → same token the composer shows.
	const lead = parseLeadingCommand(cleaned);
	if (lead) {
		parts.push(
			<span key="lead-cmd" className="mr-1.5 inline-block align-baseline">
				<CommandChipBadge chip={lead.chip} />
			</span>,
		);
		return [...parts, ...renderUserTextWithChipsBody(lead.rest, onOpen)];
	}
	return renderUserTextWithChipsBody(cleaned, onOpen);
}

function renderUserTextWithChipsBody(
	cleaned: string,
	onOpen: (markerNum: number) => void,
): React.ReactNode[] {
	const parts: React.ReactNode[] = [];
	// Merge image + file markers, ordered by position.
	const markers: Array<{ at: number; len: number; kind: "img" | "file"; m: RegExpMatchArray }> = [];
	for (const m of cleaned.matchAll(USER_MARKER_RE)) {
		markers.push({ at: m.index ?? 0, len: m[0].length, kind: "img", m });
	}
	for (const m of cleaned.matchAll(USER_FILE_MARKER_RE)) {
		markers.push({ at: m.index ?? 0, len: m[0].length, kind: "file", m });
	}
	markers.sort((a, b) => a.at - b.at);
	let last = 0;
	for (const { at, len, kind, m } of markers) {
		if (at < last) continue; // overlapping alternative — keep the earlier one
		if (at > last) parts.push(<PrivacyText key={`t-${last}`} text={cleaned.slice(last, at)} />);
		const num = Number.parseInt(m[1] ?? m[2] ?? m[3] ?? "1", 10) || 1;
		const palette = getImageTokenPalette(num);
		if (kind === "file") {
			const path = m[2]?.trim();
			parts.push(
				<button
					key={`file-${at}`}
					type="button"
					onClick={() => {
						if (path) {
							void openPath(path).catch((e: unknown) =>
								toast.error(`打开文件失败: ${errMsg(e)}`),
							);
						}
					}}
					title={path ? `打开文件 #${num}：${path}` : `文件 #${num}`}
					className="mx-0.5 inline cursor-pointer align-baseline hover:opacity-80"
					style={{ color: palette.hex }}
				>
					<span
						className="underline decoration-2 underline-offset-[3px]"
						style={{ color: palette.hex, textDecorationColor: palette.hex }}
					>
						{`📎#${num}`}
					</span>
				</button>,
			);
		} else {
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
		}
		last = at + len;
	}
	if (last < cleaned.length) parts.push(<PrivacyText key={`t-${last}`} text={cleaned.slice(last)} />);
	return parts;
}

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
			<div className="flex items-center justify-end gap-1">
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
	toolsExpanded,
	toolResultsByCallId,
	sessionCwd,
	sessionFile,
	turnCheckpoint,
	turns,
	sessionWorking,
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
	const selecting = useShareSelection((s) => s.sessionId === sessionId);
	const userSelected = useShareSelection(
		(s) => !!block.userItem && s.selectedIds.includes(block.userItem.id),
	);
	const answerSelected = useShareSelection(
		(s) => !!block.answerItem && s.selectedIds.includes(block.answerItem.id),
	);
	const toggleShare = useShareSelection((s) => s.toggle);
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
			{block.userItem && (
				<ShareSelectable
					active={selecting && isShareableUser(block.userItem)}
					selected={userSelected}
					onToggle={() => block.userItem && toggleShare(block.userItem.id)}
				>
					<UserRow sessionId={sessionId} item={block.userItem} />
				</ShareSelectable>
			)}

			{/* Collapsed intermediate steps under the worked-for divider */}
			{block.intermediateSteps.length > 0 && (
				<ExecutionDisclosure
					sessionId={sessionId}
					steps={block.intermediateSteps}
					durationMs={block.durationMs}
					isStreaming={streamingThisTurn && !block.answerItem}
					startedAt={turnStartedAt}
					forceExpanded={hasHighlightedStep || toolsExpanded}
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
				<ShareSelectable
					active={selecting && isShareableAnswer(block.answerItem)}
					selected={answerSelected}
					onToggle={() => block.answerItem && toggleShare(block.answerItem.id)}
				>
				<div
					id={`msg-${block.answerItem.id}`}
					className="group/answer relative flex flex-col items-start py-1"
				>
					<div className="max-w-full text-[length:var(--chat-font-size)] text-[var(--text)]">
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

					{/* Hover-only ghost footer */}
					{!selecting && (
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
	toolsExpanded,
	toolResultsByCallId,
	onScrollRequest,
	showTimer,
}: {
	sessionId: string;
	toolsExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	onScrollRequest?: () => void;
	/** False when the latest turn's disclosure already shows the live timer. */
	showTimer: boolean;
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
			{showTimer && <ProcessingTimer startedAt={streamStartedAt} />}
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
			scrollToBottomThrottled();
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

	// Pin to the bottom whenever content appears or grows while following.
	// Runs synchronously post-commit (before paint), covering first mount,
	// the sessionId switch commit, the clear→load commits, pending echoes,
	// and the streaming row mounting/unmounting — without timers.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && shouldFollow(followRef.current)) {
			el.scrollTop = el.scrollHeight;
			followRef.current = onWroteBottom(followRef.current, Date.now());
		}
	}, [sessionId, blocks.length, pendingEchoes.length, isStreamingActive, showHidden, scrollRef]);

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
			flashHighlight(targetId, 3000);
			const scrollTimer = setTimeout(() => {
				const el =
					document.getElementById(`msg-${targetId}`) ||
					document.querySelector(`[data-tool-id="${targetId}"]`);
				if (el) {
					el.scrollIntoView({ behavior: "smooth", block: "center" });
				}
			}, 120);
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

			{/* Empty state hero — the parent centers the composer right under it. */}
			{isEmptyState && <StartHero />}

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
								showTimer={!latestDisclosureLive}
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
						<RetryNoticeList sessionId={sessionId} />
					</div>
				</div>
			</div>
		</div>
	);
}
