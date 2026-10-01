/** [B] Codex-style turn activity: icon-led muted rows (tools/thinking/
 * notices), folded same-kind runs, and a "已处理 2分3秒" ghost divider that
 * collapses a finished turn's intermediate steps. */

import clsx from "clsx";
import {
	Bell,
	ChevronRight,
	type LucideIcon,
	Pencil,
	Search,
	Terminal,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ToolResultInfo, TranscriptItem } from "../../lib/contracts";
import { useLive } from "../../stores/live";
import { ActivityHeader } from "./ActivityHeader";
import { Markdown } from "./markdown";
import { isTaskTool, TaskToolBlock } from "./subagents/TaskToolBlock";
import { ToolCard, type ToolStatus } from "./ToolCard";
import {
	type ActivityGroupKind,
	activityGroupSummary,
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

type ToolStep = Extract<StepShape, { kind: "tool" }>;

/** Seconds label for reasoning rows ("5秒"). */
function elapsedLabel(ms: number): string {
	return `${Math.max(1, Math.round(ms / 1000))}秒`;
}

/** Local open state unless the "expand all" toggle forces it. */
function useDisclosure(forceExpanded?: boolean | null) {
	const [isOpen, setIsOpen] = useState(false);
	const open = forceExpanded ?? isOpen;
	return { open, toggle: () => setIsOpen((v) => !v) };
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
	const { open, toggle } = useDisclosure(forceExpanded);
	const expandable = thinking.trim() !== "";
	const label = running
		? "正在思考"
		: durationMs !== undefined
			? `思考了 ${elapsedLabel(durationMs)}`
			: "已思考";

	return (
		<div id={anchorId}>
			<ActivityHeader
				label={label}
				running={running}
				expandable={expandable}
				open={open}
				onToggle={toggle}
			/>
			{expandable && open && (
				<div className="pb-1 pt-0.5 text-[13px] leading-5 text-[var(--text-40)]">
					<Markdown text={thinking} />
				</div>
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
}: {
	group: ActivityGroupKind;
	steps: ToolStep[];
	statusFor: (step: ToolStep) => ToolStatus;
	forceExpanded?: boolean | null;
	renderTool: (step: ToolStep) => ReactNode;
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
					{steps.map(renderTool)}
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

	const statusFor = (step: ToolStep): ToolStatus => {
		const live = liveTools?.[step.call.id];
		if (live?.status === "running") return "running";
		if (live?.status === "error" || step.result?.isError) return "error";
		if (live?.status === "done" || step.result) return "done";
		// Transcript-backed calls without a result render as done; purely live
		// pseudo-steps with no result yet are pending ("called").
		return step.item ? "done" : "called";
	};

	const renderTool = (step: ToolStep) => {
		const call = step.call;
		const res = step.result ?? toolResultsByCallId?.get(call.id);
		const live = liveTools?.[call.id];
		const status = statusFor(step);
		return (
			<div key={step.id} id={`msg-${step.id}`}>
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

	const units = groupActivityUnits(steps);

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
						/>
					);
				}

				const step = unit.step;
				switch (step.kind) {
					case "thinking": {
						const recorded = step.item
							? thinkingDurations?.[step.item.id]
							: undefined;
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
								<Markdown text={step.text} />
							</div>
						);
					case "notice":
						return (
							<NoticeStep
								key={step.id}
								step={step}
								forceExpanded={forceExpanded}
							/>
						);
					case "tool":
						return renderTool(step);
				}
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
	const { open: expanded, toggle } = useDisclosure(forceExpanded);

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
				onClick={toggle}
				className="group/act inline-flex w-fit items-center gap-1 rounded py-0.5 text-left select-none"
				title={expanded ? "收起执行步骤" : "展开查看执行步骤"}
				aria-expanded={expanded}
			>
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
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-[var(--text-30)] transition-transform duration-150",
						expanded && "rotate-90",
					)}
				/>
			</button>

			{expanded && (
				<div className="pt-1.5 pb-1">
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
