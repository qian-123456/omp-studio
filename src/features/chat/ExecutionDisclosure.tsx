/** [B] Codex-style turn activity: icon-led muted rows (tools/thinking/
 * notices), folded same-kind runs, and a "已处理 2分3秒" ghost divider that
 * collapses a finished turn's intermediate steps. */

import clsx from "clsx";
import {
	Bell,
	Brain,
	ChevronRight,
	type LucideIcon,
	Pencil,
	Search,
	Terminal,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ImageAttachment, ToolResultInfo, TranscriptItem } from "../../lib/contracts";
import { ImagePreviewModal } from "../../components/ImagePreviewModal";
import { AttachmentThumb } from "./ImageChips";
import { collectUserImages } from "../../stores/live";
import { openImageOrExplain } from "./imageAvailability";
import { renderUserTextWithChips, stripImageMarkers } from "./userTextChips";
import { useDisplayPrefs } from "../../stores/displayPrefs";
import { useLive } from "../../stores/live";
import { ActivityHeader } from "./ActivityHeader";
import { Markdown } from "./markdown";
import { isTaskTool, TaskToolBlock } from "./subagents/TaskToolBlock";
import { ToolCard, type ToolStatus } from "./ToolCard";
import { ThinkingPreview } from "./ThinkingPreview";
import { RequestStatsLine, TurnSummaryRows } from "./RequestStatsLine";
import { RetryNoticeRows } from "./RetryNoticeList";
import type { FallbackInfo, RetryNotice } from "../../stores/retryNotice";
import type { RequestStat } from "./requestStats";
import {
	type ActivityGroupKind,
	activityGroupSummary,
	formatDurationCompact,
	groupActivityUnits,
	noticeBody,
	noticeLabel,
	noticeSummary,
	type ParallelRunMark,
	type PlacedStep,
	parallelToolRuns,
	requestAnchors,
} from "./turnGrouping";

/**
 * Minimal renderable activity step. `TurnStep` satisfies this shape; the live
 * StreamingRow synthesizes the same shape from in-flight state.
 */
export type StepShape =
	| {
			id: string;
			kind: "thinking";
			thinking: string;
			item?: TranscriptItem;
			durationMs?: number;
			running?: boolean;
			/** Live rows: the completed request that produced this reasoning. */
			requestId?: string;
	  }
	| {
			id: string;
			kind: "text";
			text: string;
			item?: TranscriptItem;
			/** Prose still being generated (live row only). */
			streaming?: boolean;
			/** Live rows: the completed request that produced this prose. */
			requestId?: string;
	  }
	| { id: string; kind: "notice"; item: TranscriptItem }
	/** Live retry / fallback rows, placed where they happened in the step flow. */
	| { id: string; kind: "retry"; notices: RetryNotice[]; fallback?: FallbackInfo }
	| { id: string; kind: "steer"; text: string; item?: TranscriptItem }
	| {
			id: string;
			kind: "tool";
			call: { id: string; name: string; args: unknown; intent: string | null };
			result?: ToolResultInfo;
			item?: TranscriptItem;
			/** Live rows: the completed request that issued this call. */
			requestId?: string;
	  }
	/** A failed (retried) model request: renders only its failure stats line. */
	| {
			id: string;
			kind: "request-failed";
			item?: TranscriptItem;
			/** Live rows: the failed request's id. */
			requestId?: string;
	  };

type ToolStep = Extract<StepShape, { kind: "tool" }>;

/**
 * Per-request stats for one turn's step list: one model request per entry,
 * placed under the unit (standalone row or folded group) its last row is in.
 */
export interface TurnStatsPlan {
	requests: { id: string; stat: RequestStat; toolCallIds: string[] }[];
	/** The answer request: its line is rendered by the caller, not here. */
	answerRequestId?: string;
}

/** Row id → the stats lines that render directly under it. */
export type StatsRows = Map<string, RequestStat[]>;

/**
 * Thin hairline on the right edge joining the rows one request issued in
 * parallel; the run's ends stop short so the bracket reads as one group.
 */
function parallelBracketClass(mark: ParallelRunMark | undefined): string {
	if (!mark) return "";
	return clsx(
		"relative after:absolute after:right-0 after:w-px after:bg-[var(--line)] after:content-['']",
		mark.first ? "after:top-1" : "after:-top-1",
		mark.last ? "after:bottom-1" : "after:-bottom-1",
	);
}

/**
 * Turns a turn's stats plan into "row id → the lines to render right under it".
 * The answer request is left out: its line renders above the answer footer, so
 * it stays visible even when the steps above stay collapsed.
 */
function resolveStatsRows(
	unitSteps: PlacedStep[][],
	plan: TurnStatsPlan | undefined,
): StatsRows {
	const rows: StatsRows = new Map();
	if (!plan) return rows;
	const requests = plan.requests.filter((r) => r.id !== plan.answerRequestId);
	const anchors = requestAnchors(unitSteps.flat(), requests);
	for (const req of requests) {
		const anchor = anchors.get(req.id);
		// No tool row of its own (pure thinking / prose): the caller renders
		// this request's line after the whole list.
		if (!anchor) continue;
		const list = rows.get(anchor);
		if (list) list.push(req.stat);
		else rows.set(anchor, [req.stat]);
	}
	return rows;
}

/** Shared Codex user-bubble visual (user rows and in-turn steers). */
export const USER_BUBBLE_CLASS =
	"min-w-0 max-w-[70%] rounded-[22px] bg-[var(--chat-user-bg)] px-4 py-2.5 text-[length:var(--chat-user-font-size)] leading-6 text-[var(--text)]";

/**
 * User message outside a normal turn row (in-turn steer, queued message):
 * image thumbnails above, bubble text with inline `🖼️#N` tokens — the same
 * look as an ordinary sent bubble. Images come from the item plus any path
 * that only appears as an inline `[Image #N: path]` marker.
 */
export function UserMessageBubble({
	text,
	images: given,
	bubbleClass = USER_BUBBLE_CLASS,
	emptyText,
}: {
	text: string;
	images?: ImageAttachment[];
	bubbleClass?: string;
	/** Shown when the text is only markers. */
	emptyText?: string;
}) {
	const [preview, setPreview] = useState<number | null>(null);
	const images = useMemo(
		() =>
			collectUserImages(text, given).filter(
				(img): img is ImageAttachment & { path: string } => Boolean(img.path),
			),
		[text, given],
	);
	const hasBody = stripImageMarkers(text).length > 0 || /\[(?:File|文件)\s*#|📎\s*#/u.test(text);
	return (
		<>
			{images.length > 0 && (
				<div className="flex max-w-[70%] flex-wrap items-start justify-end gap-1.5">
					{images.map((img, i) => (
						<AttachmentThumb
							key={img.id}
							path={img.path}
							index={i + 1}
							showIndex={images.length > 1}
							variant="bubble"
							onOpen={() => setPreview(i)}
						/>
					))}
				</div>
			)}
			{preview !== null && images.length > 0 && (
				<ImagePreviewModal
					images={images.map((img, idx) => ({
						path: img.path,
						marker: img.marker ?? `图片 #${idx + 1}`,
					}))}
					initialIndex={preview}
					onClose={() => setPreview(null)}
				/>
			)}
			{hasBody ? (
				<div className={bubbleClass}>
					<div className="whitespace-pre-wrap break-words">
						{renderUserTextWithChips(text, (num) => {
							void openImageOrExplain(
								images.map((i) => i.path),
								num,
								setPreview,
							);
						})}
					</div>
				</div>
			) : emptyText ? (
				<div className={bubbleClass}>{emptyText}</div>
			) : null}
		</>
	);
}

/** Milliseconds since `startedAt`, re-rendering every second while `active`. */
export function useElapsedMs(startedAt: number | undefined, active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active || startedAt === undefined) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active, startedAt]);
	return startedAt === undefined ? 0 : Math.max(0, now - startedAt);
}

function processingLabel(elapsedMs: number): string {
	return elapsedMs >= 1000
		? `正在处理 ${formatDurationCompact(elapsedMs)}…`
		: "正在处理…";
}

/** Shimmering 「正在思考」 row shown while the live turn waits for the model's
 * next move (no tool or reasoning row is running right now). The rolling
 * reasoning preview belongs to the real, streaming reasoning row; a finished
 * thought would only show stale static text here. */
export function LiveWaitingRow() {
	return <ThinkingRow anchorId="live-waiting" thinking="" running />;
}

/** Seconds label for reasoning rows ("5秒"). */
function elapsedLabel(ms: number): string {
	return `${Math.max(1, Math.round(ms / 1000))}秒`;
}

/** Local open state; an "expand/collapse all" value seeds it until toggled. */
function useDisclosure(forceExpanded?: boolean | null) {
	const [isOpen, setIsOpen] = useState(Boolean(forceExpanded));
	useEffect(() => {
		if (forceExpanded != null) setIsOpen(forceExpanded);
	}, [forceExpanded]);
	return { open: isOpen, setOpen: setIsOpen, toggle: () => setIsOpen((v) => !v) };
}

/**
 * Reasoning row: one collapsed line 「思考 · N秒」 once done; click opens the
 * full text. While streaming it shimmers 「正在思考」 and, with 「思考时显示最新
 * 两行」 on, rolls the newest two lines underneath. It folds back to the
 * one-liner as soon as the reasoning ends (the reply starts).
 */
function ThinkingRow({
	anchorId,
	thinking,
	durationMs,
	running,
	forceExpanded,
}: {
	anchorId: string;
	thinking: string;
	durationMs?: number;
	running?: boolean;
	forceExpanded?: boolean | null;
}) {
	const { open, setOpen, toggle } = useDisclosure(forceExpanded);
	const peekOn = useDisplayPrefs((s) => s.thinkingPreview);
	const expandable = thinking.trim() !== "";
	const wasRunning = useRef(Boolean(running));
	useEffect(() => {
		if (wasRunning.current && !running && forceExpanded !== true) setOpen(false);
		wasRunning.current = Boolean(running);
	}, [running, forceExpanded, setOpen]);
	const label = running
		? "正在思考"
		: durationMs !== undefined
			? `思考 · ${elapsedLabel(durationMs)}`
			: "思考";

	return (
		<div id={anchorId}>
			<ActivityHeader
				icon={Brain}
				label={label}
				running={running}
				expandable={expandable}
				open={open}
				onToggle={toggle}
			/>
			{expandable && (open || (running && peekOn)) && (
				<ThinkingPreview
					thinking={thinking}
					running={running}
					open={open}
					onToggle={toggle}
				/>
			)}
		</div>
	);
}

/** Mid-run protocol notice (background job done, retry, …) as a muted row. */
function NoticeStep({
	step,
	forceExpanded,
}: {
	step: Extract<StepShape, { kind: "notice" }>;
	forceExpanded?: boolean | null;
}) {
	const { open, toggle } = useDisclosure(forceExpanded);
	const summary = noticeSummary(step.item);
	const body = noticeBody(step.item);
	const expandable = body !== "" && body !== summary;

	return (
		<div id={`msg-${step.id}`}>
			<ActivityHeader
				icon={Bell}
				label={noticeLabel(step.item)}
				object={summary || undefined}
				expandable={expandable}
				open={open}
				onToggle={toggle}
			/>
			{expandable && open && (
				<pre className="mb-1 ms-5 max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-40)]">
					{body}
				</pre>
			)}
		</div>
	);
}

const GROUP_ICON: Record<ActivityGroupKind, LucideIcon> = {
	exploration: Search,
	commands: Terminal,
	edits: Pencil,
};

/** Folded run of same-kind tools; expands to the individual tool rows. */
function ToolGroupRow({
	group,
	steps,
	statusFor,
	forceExpanded,
	renderTool,
	statsRows,
	parallel,
}: {
	group: ActivityGroupKind;
	steps: ToolStep[];
	statusFor: (step: ToolStep) => ToolStatus;
	forceExpanded?: boolean | null;
	renderTool: (step: ToolStep, mark?: ParallelRunMark) => ReactNode;
	/** Stats lines to render under the group's own rows. */
	statsRows: StatsRows;
	/** Parallel-run marks for the group's rows. */
	parallel: Map<string, ParallelRunMark>;
}) {
	const { open, toggle } = useDisclosure(forceExpanded);
	const statuses = steps.map(statusFor);
	const running = statuses.includes("running");
	const failed = statuses.filter((s) => s === "error").length;

	return (
		<div id={`msg-${steps[0]?.id ?? group}`}>
			<ActivityHeader
				icon={GROUP_ICON[group]}
				label={activityGroupSummary(group, steps, running)}
				running={running}
				expandable
				open={open}
				onToggle={toggle}
				accessory={
					failed > 0 && (
						<span className="shrink-0 text-[12px] text-[var(--status-error)]">
							{failed} 个失败
						</span>
					)
				}
			/>
			{open && (
				<div className="flex flex-col gap-0.5 ps-5 pb-1">
					{steps.map((step) => (
						<Fragment key={step.id}>
							{renderTool(step, parallel.get(step.id))}
							{statsRows.get(step.id)?.map((stat, i) => (
								<RequestStatsLine
									key={`${step.id}-${i}`}
									stat={stat}
									className="ms-5"
								/>
							))}
						</Fragment>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * Streams turn steps as Codex activity rows. Used both inside the collapsed
 * finished-turn disclosure and by the live StreamingRow.
 */
export function TurnSteps({
	sessionId,
	steps,
	forceExpanded,
	toolResultsByCallId,
	highlightedStepId,
	statsPlan,
}: {
	sessionId: string;
	steps: StepShape[];
	forceExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	highlightedStepId?: string | null;
	/** Per-request stats, placed under the row each request ends on. */
	statsPlan?: TurnStatsPlan;
}) {
	const units = useMemo(() => groupActivityUnits(steps), [steps]);
	const unitSteps = useMemo(
		() => units.map((unit) => (unit.kind === "group" ? unit.steps : [unit.step])),
		[units],
	);
	// Brackets are per unit: each unit is its own contiguous container, so a
	// parallel run never appears to span a folded group or a text row.
	const parallel = useMemo(() => parallelToolRuns(unitSteps), [unitSteps]);
	const statsRows = useMemo(
		() => resolveStatsRows(unitSteps, statsPlan),
		[unitSteps, statsPlan],
	);
	const thinkingDurations = useLive(
		(s) => s.sessions[sessionId]?.thinkingDurations,
	);
	const liveTools = useLive((s) => s.sessions[sessionId]?.tools);

	const statusFor = (step: ToolStep): ToolStatus => {
		const live = liveTools?.[step.call.id];
		if (live?.status === "running") return "running";
		if (live?.status === "error" || step.result?.isError) return "error";
		if (live?.status === "done" || step.result) return "done";
		// Transcript-backed calls without a result render as done; purely live
		// pseudo-steps with no result yet are pending ("called").
		return step.item ? "done" : "called";
	};

	const renderTool = (step: ToolStep, mark?: ParallelRunMark) => {
		const call = step.call;
		const res = step.result ?? toolResultsByCallId?.get(call.id);
		const live = liveTools?.[call.id];
		const status = statusFor(step);
		const isStepHighlighted = Boolean(
			highlightedStepId &&
				(step.id === highlightedStepId ||
					call.id === highlightedStepId ||
					res?.toolCallId === highlightedStepId),
		);
		return (
			<div
				key={step.id}
				id={`msg-${step.id}`}
				data-tool-id={call.id}
				data-parallel={mark ? (mark.first ? "first" : mark.last ? "last" : "mid") : undefined}
				className={clsx(
					"transition-all duration-300",
					parallelBracketClass(mark),
					isStepHighlighted &&
						"rounded-lg ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)] shadow-md",
				)}
			>
				{isTaskTool(call.name) ? (
					<TaskToolBlock
						sessionId={sessionId}
						toolCallId={call.id}
						args={call.args}
						status={status}
						details={res?.details ?? live?.details ?? null}
						resultText={res?.text}
						startedAt={live?.startedAt}
						endedAt={live?.endedAt}
						expanded={forceExpanded ?? undefined}
					/>
				) : (
					<ToolCard
						sessionId={sessionId}
						name={call.name}
						args={call.args}
						intent={call.intent}
						status={status}
						output={res?.text || live?.text || ""}
						details={res?.details ?? live?.details}
						expanded={forceExpanded ?? undefined}
						startedAt={live?.startedAt}
						endedAt={live?.endedAt}
					/>
				)}
			</div>
		);
	};

	const statsUnder = (step: StepShape) =>
		statsRows.get(step.id)?.map((stat, i) => (
			<RequestStatsLine key={`${step.id}-${i}`} stat={stat} className="ms-5" />
		));

	// Requests with no tool row of their own (pure thinking / prose) render
	// after the list, in arrival order.
	const failedRowRequests = new Set<string | undefined>();
	for (const s of unitSteps.flat()) {
		if (s.kind === "request-failed") failedRowRequests.add(s.requestId ?? s.item?.id);
	}
	const anchoredStats = new Set<RequestStat>();
	for (const list of statsRows.values()) for (const stat of list) anchoredStats.add(stat);
	const trailingStats = (statsPlan?.requests ?? [])
		.filter((r) => r.id !== statsPlan?.answerRequestId)
		.filter((r) => !r.toolCallIds.length)
		.filter((r) => !failedRowRequests.has(r.id) && !anchoredStats.has(r.stat))
		.map((r) => r.stat);

	const renderStep = (step: StepShape) => {
		switch (step.kind) {
			case "thinking": {
				const recorded = step.item ? thinkingDurations?.[step.item.id] : undefined;
				return (
					<ThinkingRow
						key={step.id}
						anchorId={`msg-${step.id}`}
						thinking={step.thinking}
						durationMs={
							step.durationMs ??
							(recorded ? recorded.endedAt - recorded.startedAt : undefined)
						}
						running={step.running}
						forceExpanded={forceExpanded}
					/>
				);
			}
			case "text":
				return (
					<div
						key={step.id}
						id={`msg-${step.id}`}
						className="py-1 text-[length:var(--chat-font-size)] text-[var(--text)]"
					>
						<Markdown text={step.text} sessionId={sessionId} streaming={step.streaming} />
					</div>
				);
			case "notice":
				return (
					<NoticeStep key={step.id} step={step} forceExpanded={forceExpanded} />
				);
			case "steer":
				return (
					<div key={step.id} id={`msg-${step.id}`} className="flex flex-col items-end gap-1.5 py-1">
						<UserMessageBubble text={step.item?.text ?? step.text} images={step.item?.images} />
					</div>
				);
			case "retry":
				return (
					<RetryNoticeRows
						key={step.id}
						sessionId={sessionId}
						notices={step.notices}
						fallback={step.fallback}
					/>
				);
			case "request-failed": {
				const id = step.requestId ?? step.item?.id;
				const stat = statsPlan?.requests.find((r) => r.id === id)?.stat;
				if (!stat) return null;
				return (
					<div key={step.id} id={`msg-${step.id}`}>
						<RequestStatsLine stat={stat} className="ms-5" />
					</div>
				);
			}
			case "tool":
				return renderTool(step, parallel.get(step.id));
		}
	};

	return (
		<div className="flex flex-col gap-1">
			{units.map((unit, i) => {
				if (unit.kind === "group") {
					return (
						<ToolGroupRow
							key={`grp-${unit.steps[0]?.id ?? i}`}
							group={unit.group}
							steps={unit.steps}
							statusFor={statusFor}
							forceExpanded={forceExpanded}
							renderTool={renderTool}
							statsRows={statsRows}
							parallel={parallel}
						/>
					);
				}
				const step = unit.step;
				return (
					<div key={step.id} className="flex flex-col gap-1">
						{renderStep(step)}
						{statsUnder(step)}
					</div>
				);
			})}
			{trailingStats.map((stat, i) => (
				<RequestStatsLine key={`trailing-${i}`} stat={stat} />
			))}
		</div>
	);
}

/**
 * Finished-turn disclosure: a ghost "已处理 2分3秒 · 4 步" text button with a
 * chevron, followed by a full-width hairline. Expanding reveals the steps.
 */
export function ExecutionDisclosure({
	sessionId,
	steps,
	durationMs,
	startedAt,
	isStreaming,
	forceExpanded,
	toolResultsByCallId,
	highlightedStepId,
	/** Per-request stats lines for the expanded steps. */
	statsPlan,
	/** Whole-turn totals shown as the first rows once expanded. */
	turnStats,
	liveOpen,
	hideHeader,
	awaitingSubagents,
}: {
	sessionId: string;
	steps: StepShape[];
	durationMs?: number;
	startedAt?: number;
	isStreaming?: boolean;
	forceExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	highlightedStepId?: string | null;
	statsPlan?: TurnStatsPlan;
	turnStats?: RequestStat[];
	/** The turn is still in progress: the body stays open and no divider is drawn. */
	liveOpen?: boolean;
	/** Continuation segment of an in-progress turn: body only, no title. */
	hideHeader?: boolean;
	/** The parent's turn ended but subagents it dispatched still run: the title
	 * stays live (counting from the turn start) instead of claiming a short run. */
	awaitingSubagents?: boolean;
}) {
	const { open: expanded, toggle } = useDisclosure(
		forceExpanded || liveOpen ? true : forceExpanded,
	);
	const live = Boolean(isStreaming) || Boolean(awaitingSubagents);
	const elapsed = useElapsedMs(startedAt, live);

	if (steps.length === 0) {
		return null;
	}

	const durationLabel = durationMs ? formatDurationCompact(durationMs) : "";
	const titleText = live
		? processingLabel(elapsed)
		: durationLabel
			? `已处理 ${durationLabel}`
			: `已处理 ${steps.length} 个步骤`;

	return (
		<div className="my-1 flex flex-col">
			{!hideHeader && (
				<DisclosureHeader
					title={titleText}
					shimmer={live}
					expanded={expanded}
					onToggle={toggle}
				/>
			)}

			{expanded && (
				<div className="pt-1.5 pb-1">
					<TurnSummaryRows stats={turnStats ?? []} durationMs={live ? undefined : durationMs} />
					<TurnSteps
						sessionId={sessionId}
						steps={steps}
						forceExpanded={forceExpanded}
						toolResultsByCallId={toolResultsByCallId}
						highlightedStepId={highlightedStepId}
						statsPlan={statsPlan}
					/>
				</div>
			)}

			{!liveOpen && <div className="mt-1 h-px w-full bg-[var(--line)]" />}
		</div>
	);
}

/** Answer block markup shared by the committed turn and the live turn, so the
 * streamed answer and the committed one occupy identical boxes. */
export const ANSWER_WRAP_CLASS = "group/answer relative flex flex-col items-start py-1";
export const ANSWER_TEXT_CLASS = "max-w-full text-[length:var(--chat-font-size)] text-[var(--text)]";

/** Ghost title button of a turn's activity fold: 「已处理 2分3秒 >」 / 「正在处理 5秒… >」. */
function DisclosureHeader({
	title,
	shimmer,
	expanded,
	onToggle,
}: {
	title: string;
	shimmer: boolean;
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="w-fit">
			<button
				type="button"
				onClick={onToggle}
				className="group/act inline-flex w-fit items-center gap-1 rounded py-0.5 text-left select-none"
				title={expanded ? "收起执行步骤" : "展开查看执行步骤"}
				aria-expanded={expanded}
			>
				<span
					className={clsx(
						"text-[length:var(--chat-font-size)] leading-6",
						shimmer
							? "shimmer-text"
							: "text-[var(--text-30)] transition-colors group-hover/act:text-[var(--text-60)]",
					)}
				>
					{title}
				</span>
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-[var(--text-30)] transition-transform duration-150",
						expanded && "rotate-90",
					)}
				/>
			</button>
		</div>
	);
}

/** Closing animation length; the body unmounts once it has finished. */
const FOLD_MS = 240;

/**
 * Height-animated body of a disclosure. Opening is instant; closing eases the
 * height to zero (grid-rows 1fr → 0fr) and unmounts the children afterwards.
 * Reduced motion collapses without the transition.
 */
function CollapsingRegion({ open, children }: { open: boolean; children: ReactNode }) {
	const [mounted, setMounted] = useState(open);
	// Overflow is clipped only while the height animates, so focus rings and
	// popovers of an open body are never cut off.
	const [clip, setClip] = useState(false);
	const wasOpen = useRef(open);
	useEffect(() => {
		if (open) {
			setMounted(true);
			setClip(false);
			wasOpen.current = true;
			return;
		}
		if (wasOpen.current) setClip(true);
		wasOpen.current = false;
		const timer = window.setTimeout(() => {
			setMounted(false);
			setClip(false);
		}, FOLD_MS);
		return () => window.clearTimeout(timer);
	}, [open]);
	if (!open && !mounted) return null;
	return (
		<div
			className={clsx(
				"grid transition-[grid-template-rows,opacity] ease-out motion-reduce:transition-none",
				open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
			)}
			style={{ transitionDuration: `${FOLD_MS}ms` }}
		>
			<div className={clsx("min-h-0", clip && "overflow-hidden")}>{children}</div>
		</div>
	);
}

/**
 * The in-flight turn's activity fold. While the agent works it is open: a
 * shimmering 「正在处理 5秒…」 title over the live steps. When the final answer
 * starts (`folded`) the steps fold away into the title and a hairline marks
 * the boundary — the exact shape the committed turn renders, so commit only
 * turns the title into 「已处理 …」.
 */
export function LiveDisclosure({
	sessionId,
	steps,
	folded,
	live,
	startedAt,
	durationMs,
	forceExpanded,
	toolResultsByCallId,
	statsPlan,
}: {
	sessionId: string;
	/** Steps the body shows: every live step while working, activity once folded. */
	steps: StepShape[];
	folded: boolean;
	/** The timer is running; false once the stream ended and the title is final. */
	live: boolean;
	startedAt: number;
	durationMs?: number;
	forceExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
	statsPlan?: TurnStatsPlan;
}) {
	// null = follow the phase (open while working, folded after); a click pins it.
	const [override, setOverride] = useState<boolean | null>(null);
	useEffect(() => setOverride(null), [folded]);
	const open = override ?? !folded;
	const elapsed = useElapsedMs(startedAt, live);
	const title = live
		? processingLabel(elapsed)
		: durationMs
			? `已处理 ${formatDurationCompact(durationMs)}`
			: `已处理 ${steps.length} 个步骤`;

	return (
		<div className="my-1 flex flex-col">
			<DisclosureHeader
				title={title}
				shimmer={live}
				expanded={open}
				onToggle={() => setOverride(!open)}
			/>
			<CollapsingRegion open={open && steps.length > 0}>
				<div className={folded ? "pt-1.5 pb-1" : "pt-0.5"}>
					<TurnSteps
						sessionId={sessionId}
						steps={steps}
						forceExpanded={forceExpanded}
						toolResultsByCallId={toolResultsByCallId}
						statsPlan={statsPlan}
					/>
				</div>
			</CollapsingRegion>
			{folded && <div className="mt-1 h-px w-full bg-[var(--line)]" />}
		</div>
	);
}
