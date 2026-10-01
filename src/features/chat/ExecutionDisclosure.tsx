/** [B] Codex-style turn activity: muted text rows (tools/thinking/notices),
 * grouped exploration runs, and a "已处理 2分3秒" ghost divider that
 * collapses a finished turn's intermediate steps. */

import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ToolResultInfo, TranscriptItem } from "../../lib/contracts";
import { useLive } from "../../stores/live";
import { Markdown } from "./markdown";
import { isTaskTool, TaskToolBlock } from "./subagents/TaskToolBlock";
import { ToolCard, toolActivityLabel, type ToolStatus } from "./ToolCard";
import {
	explorationKind,
	explorationSummary,
	formatDurationCompact,
	groupActivityUnits,
	noticeBody,
	noticeLabel,
	noticeSummary,
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
	  }
	| { id: string; kind: "text"; text: string; item?: TranscriptItem }
	| { id: string; kind: "notice"; item: TranscriptItem }
	| {
			id: string;
			kind: "tool";
			call: { id: string; name: string; args: unknown; intent: string | null };
			result?: ToolResultInfo;
			item?: TranscriptItem;
	  };

/** Seconds label for reasoning rows ("5秒"). */
function elapsedLabel(ms: number): string {
	return `${Math.max(1, Math.round(ms / 1000))}秒`;
}

/** Single muted activity row: chevron (hover) + verb-first label + dimmer object. */
function ActivityRow({
	anchorId,
	running,
	error,
	label,
	object,
	expandable,
	onToggle,
	open,
	children,
}: {
	anchorId?: string;
	running?: boolean;
	error?: boolean;
	label: string;
	object?: string;
	expandable?: boolean;
	onToggle?: () => void;
	open?: boolean;
	children?: ReactNode;
}) {
	const inner = (
		<>
			<ChevronRight
				size={12}
				className={clsx(
					"shrink-0 text-[var(--text-30)] transition-all duration-150",
					expandable &&
						(open
							? "rotate-90 opacity-100"
							: "rotate-0 opacity-0 group-hover/act:opacity-100"),
					!expandable && "opacity-0",
				)}
			/>
			<span className="flex min-w-0 items-baseline gap-1.5">
				<span
					className={clsx(
						"shrink-0 text-[length:var(--chat-font-size)] leading-6",
						running && "shimmer-text",
						error && "text-[var(--status-error)]",
						!running &&
							!error &&
							"text-[var(--text-60)] group-hover/act:text-[var(--text)]",
					)}
				>
					{label}
				</span>
				{object && (
					<span
						className={clsx(
							"truncate font-mono text-[11px]",
							running ? "shimmer-text" : "text-[var(--text-40)]",
						)}
					>
						{object}
					</span>
				)}
			</span>
		</>
	);

	return (
		<div id={anchorId} className="group/act my-px">
			{expandable ? (
				<button
					type="button"
					onClick={onToggle}
					className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left select-none"
					aria-expanded={open}
				>
					{inner}
				</button>
			) : (
				<div className="flex w-full items-center gap-1 px-1 py-0.5">
					{inner}
				</div>
			)}
			{expandable && open && children}
		</div>
	);
}

/** Reasoning row: "正在思考" shimmer while running, "思考了 N 秒" once done. */
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
	const [isOpen, setIsOpen] = useState(false);
	const expanded =
		forceExpanded !== null && forceExpanded !== undefined
			? forceExpanded
			: isOpen;

	let label: string;
	if (running) {
		label = "正在思考";
	} else if (durationMs !== undefined) {
		label = `思考了 ${elapsedLabel(durationMs)}`;
	} else {
		label = "已思考";
	}

	return (
		<ActivityRow
			anchorId={anchorId}
			running={running}
			label={label}
			expandable
			open={expanded}
			onToggle={() => setIsOpen((v) => !v)}
		>
			<div className="ps-6 pb-1 pt-0.5 text-[12px] leading-5 text-[var(--text-40)]">
				<Markdown text={thinking} />
			</div>
		</ActivityRow>
	);
}

/** Mid-run protocol notice: centered small tertiary text between hairlines. */
function NoticeStep({
	step,
	forceExpanded,
}: {
	step: Extract<StepShape, { kind: "notice" }>;
	forceExpanded?: boolean | null;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const expanded =
		forceExpanded !== null && forceExpanded !== undefined
			? forceExpanded
			: isOpen;

	const label = noticeLabel(step.item);
	const summary = noticeSummary(step.item);
	const body = noticeBody(step.item);
	const expandable = body !== "" && body !== summary;
	const text = summary ? `${label} · ${summary}` : label;

	return (
		<div id={`msg-${step.id}`} className="my-1">
			<div className="flex items-center gap-2">
				<div className="h-px flex-1 bg-[var(--line)]" />
				{expandable ? (
					<button
						type="button"
						onClick={() => setIsOpen((v) => !v)}
						className="shrink-0 truncate px-1 text-[11px] text-[var(--text-30)] transition-colors hover:text-[var(--text-60)]"
						title={expanded ? "收起通知详情" : "展开通知详情"}
					>
						{text}
					</button>
				) : (
					<span
						className="shrink-0 truncate px-1 text-[11px] text-[var(--text-30)]"
						title={text}
					>
						{text}
					</span>
				)}
				<div className="h-px flex-1 bg-[var(--line)]" />
			</div>
			{expandable && expanded && (
				<pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-40)]">
					{body}
				</pre>
			)}
		</div>
	);
}

/** Collapsed "explored" group: one row for a run of read/search/list calls. */
function ExplorationGroupRow({
	steps,
	statusFor,
	forceExpanded,
	toolResultsByCallId,
}: {
	steps: Extract<StepShape, { kind: "tool" }>[];
	statusFor: (step: Extract<StepShape, { kind: "tool" }>) => ToolStatus;
	forceExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const expanded =
		forceExpanded !== null && forceExpanded !== undefined
			? forceExpanded
			: isOpen;

	let files = 0;
	let searches = 0;
	let running = false;
	for (const s of steps) {
		if (explorationKind(s.call.name) === "search") searches += 1;
		else files += 1;
		if (statusFor(s) === "running") running = true;
	}

	return (
		<ActivityRow
			anchorId={`msg-${steps[0]?.id ?? "explore"}`}
			running={running}
			label={explorationSummary(files, searches, running)}
			expandable
			open={expanded}
			onToggle={() => setIsOpen((v) => !v)}
		>
			<div className="ps-6 pb-1 pt-0.5">
				{steps.map((s) => {
					const res = s.result ?? toolResultsByCallId?.get(s.call.id);
					const status = statusFor(s);
					const { verb, object } = toolActivityLabel(
						s.call.name,
						s.call.args,
						s.call.intent,
						status,
					);
					return (
						<div
							key={s.id}
							id={`msg-${s.id}`}
							className="flex min-w-0 items-baseline gap-1.5 py-px"
						>
							<span
								className={clsx(
									"shrink-0 text-[12px] leading-5",
									status === "error"
										? "text-[var(--status-error)]"
										: "text-[var(--text-40)]",
								)}
								title={res?.text?.slice(0, 200) || undefined}
							>
								{verb}
							</span>
							{object && (
								<span className="truncate font-mono text-[11px] text-[var(--text-30)]">
									{object}
								</span>
							)}
						</div>
					);
				})}
			</div>
		</ActivityRow>
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
}: {
	sessionId: string;
	steps: StepShape[];
	forceExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
}) {
	const thinkingDurations = useLive(
		(s) => s.sessions[sessionId]?.thinkingDurations,
	);
	const liveTools = useLive((s) => s.sessions[sessionId]?.tools);

	const statusFor = (step: Extract<StepShape, { kind: "tool" }>): ToolStatus => {
		const live = liveTools?.[step.call.id];
		if (live?.status === "running") return "running";
		if (live?.status === "error" || step.result?.isError) return "error";
		if (live?.status === "done" || step.result) return "done";
		// Transcript-backed calls without a result render as done; purely live
		// pseudo-steps with no result yet are pending ("called").
		return step.item ? "done" : "called";
	};

	const units = groupActivityUnits(steps);

	return (
		<div className="flex flex-col">
			{units.map((unit, i) => {
				if (unit.kind === "exploration") {
					return (
						<ExplorationGroupRow
							key={`exp-${unit.steps[0]?.id ?? i}`}
							steps={unit.steps}
							statusFor={statusFor}
							forceExpanded={forceExpanded}
							toolResultsByCallId={toolResultsByCallId}
						/>
					);
				}

				const step = unit.step;
				if (step.kind === "thinking") {
					const recorded = step.item
						? thinkingDurations?.[step.item.id]
						: undefined;
					const durationMs =
						step.durationMs ??
						(recorded ? recorded.endedAt - recorded.startedAt : undefined);
					return (
						<ThinkingRow
							key={step.id}
							anchorId={`msg-${step.id}`}
							thinking={step.thinking}
							durationMs={durationMs}
							running={step.running}
							forceExpanded={forceExpanded}
						/>
					);
				}

				if (step.kind === "text") {
					return (
						<div
							key={step.id}
							id={`msg-${step.id}`}
							className="py-0.5 text-[length:var(--chat-font-size)] text-[var(--text)]"
						>
							<Markdown text={step.text} />
						</div>
					);
				}

				if (step.kind === "notice") {
					return (
						<NoticeStep
							key={step.id}
							step={step}
							forceExpanded={forceExpanded}
						/>
					);
				}

				if (step.kind === "tool") {
					const call = step.call;
					const res = step.result ?? toolResultsByCallId?.get(call.id);
					const live = liveTools?.[call.id];
					const status = statusFor(step);

					if (isTaskTool(call.name)) {
						return (
							<div key={step.id} id={`msg-${step.id}`}>
								<TaskToolBlock
									sessionId={sessionId}
									toolCallId={call.id}
									args={call.args}
									status={status}
									details={res?.details ?? live?.details ?? null}
									resultText={res?.text}
									startedAt={live?.startedAt}
									endedAt={live?.endedAt}
								/>
							</div>
						);
					}

					return (
						<div key={step.id} id={`msg-${step.id}`}>
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
						</div>
					);
				}

				return null;
			})}
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
	isStreaming,
	forceExpanded,
	toolResultsByCallId,
}: {
	sessionId: string;
	steps: StepShape[];
	durationMs?: number;
	isStreaming?: boolean;
	forceExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const expanded =
		forceExpanded !== null && forceExpanded !== undefined
			? forceExpanded
			: isOpen;

	if (steps.length === 0) {
		return null;
	}

	const durationLabel = durationMs ? formatDurationCompact(durationMs) : "";
	const titleText = isStreaming
		? `正在处理…`
		: durationLabel
			? `已处理 ${durationLabel}`
			: `已处理 ${steps.length} 个步骤`;

	return (
		<div className="my-1 flex flex-col">
			<button
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				className="group/act inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-left select-none"
				title={expanded ? "收起执行步骤" : "展开查看执行步骤"}
				aria-expanded={expanded}
			>
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-[var(--text-30)] transition-transform duration-150",
						expanded && "rotate-90",
					)}
				/>
				<span
					className={clsx(
						"text-[length:var(--chat-font-size)] leading-6",
						isStreaming
							? "shimmer-text"
							: "text-[var(--text-30)] transition-colors group-hover/act:text-[var(--text-60)]",
					)}
				>
					{titleText}
				</span>
			</button>

			{expanded && (
				<div className="pt-0.5 pb-1">
					<TurnSteps
						sessionId={sessionId}
						steps={steps}
						forceExpanded={forceExpanded}
						toolResultsByCallId={toolResultsByCallId}
					/>
				</div>
			)}

			<div className="mt-1 h-px w-full bg-[var(--line)]" />
		</div>
	);
}
