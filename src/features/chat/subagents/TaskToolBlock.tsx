/**
 * Codex-style `task`/`agent` tool block: header row + omp-TUI-like agent tree.
 * Each agent row opens SubagentSheet (assignment, prompt, process, output).
 * Contract C2: mounted by the turn pipeline wherever a tool step renders.
 */

import clsx from "clsx";
import { Bot, Check, Clock, Loader2, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SubagentSummary } from "../../../lib/contracts";
import { type DiskSubscription, subscribeDiskSubagents } from "./diskPoller";
import { useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import { ActivityHeader } from "../ActivityHeader";
import { asTaskDetails, mergeAgents, type AgentRow } from "./merge";
import { SubagentSheet } from "./SubagentSheet";
import type { AgentProgress, SubagentStatus } from "./types";
import {
	formatDurationCompact,
	formatShortModel,
} from "../turnGrouping";

export function isTaskTool(name: string): boolean {
	return name === "task" || name === "agent";
}

export interface TaskToolBlockProps {
	sessionId: string;
	toolCallId: string;
	/** task tool args (batch {context,tasks[]} or flat). */
	args: unknown;
	status: "running" | "done" | "error" | "called";
	/** TaskToolDetails from tool result / live tool (may be null). */
	details: unknown | null;
	resultText?: string;
	startedAt?: number | null;
	endedAt?: number | null;
	/** Expand-all override; undefined leaves the user's toggle alone. */
	expanded?: boolean;
}

/** Cap for the collapsed agent tree (TUI COLLAPSED_AGENT_LIMIT). */
const COLLAPSED_LIMIT = 4;

const STATUS_ICON: Record<
	SubagentStatus,
	{ Icon: typeof Check; color: string; spin?: boolean }
> = {
	running: { Icon: Loader2, color: "var(--status-info)", spin: true },
	completed: { Icon: Check, color: "var(--status-success)" },
	failed: { Icon: X, color: "var(--status-error)" },
	pending: { Icon: Clock, color: "var(--status-warning)" },
	aborted: { Icon: Square, color: "var(--status-warning)" },
};

export const SUBAGENT_STATUS_TEXT: Record<SubagentStatus, string> = {
	pending: "排队中",
	running: "运行中",
	completed: "已完成",
	failed: "失败",
	aborted: "已中止",
};

/** `A.B` ids render as an `A > B` breadcrumb (TUI formatTaskId). */
export function formatTaskId(id: string): string {
	return id.includes(".") ? id.split(".").join(" > ") : id;
}

function formatTokensShort(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return `${tokens}`;
}

/** Trailing meta run: model · thinking · tools · tokens · duration · cost. */
function metaParts(row: AgentRow): string[] {
	const parts: string[] = [];
	const model = formatShortModel(row.model);
	if (model) parts.push(model);
	if (row.thinkingLevel) parts.push(row.thinkingLevel);
	if (row.toolCount) parts.push(`${row.toolCount} 工具`);
	if (row.tokens) parts.push(formatTokensShort(row.tokens));
	if (row.durationMs && row.status !== "pending") {
		parts.push(formatDurationCompact(row.durationMs));
	}
	if (typeof row.cost === "number" && Number.isFinite(row.cost)) {
		parts.push(`$${row.cost.toFixed(2)}`);
	}
	return parts;
}

/** One level of sub-subagents from inflightTaskDetails, rendered dimmer. */
function NestedRow({ p }: { p: AgentProgress }) {
	const status: SubagentStatus = p.status ?? "pending";
	const { Icon, color, spin } = STATUS_ICON[status];
	return (
		<div className="flex items-center gap-1.5 ps-[52px] py-0.5">
			<Icon
				size={11}
				className={clsx("shrink-0", spin && "animate-spin")}
				style={{ color }}
			/>
			<span className="truncate text-[11px] text-[var(--text-40)]">
				{formatTaskId(p.id)}
				{p.currentTool ? ` · ${p.currentTool}` : ""}
			</span>
		</div>
	);
}

function AgentRowView({
	row,
	last,
	onOpen,
}: {
	row: AgentRow;
	last: boolean;
	onOpen: (row: AgentRow) => void;
}) {
	const { Icon, color, spin } = STATUS_ICON[row.status];
	const meta = metaParts(row);
	const showBadge = Boolean(row.agent && row.agent !== "task");
	const nested =
		row.status === "running" && row.inflightTaskDetails?.progress?.length
			? row.inflightTaskDetails.progress
			: null;
	return (
		<div>
			<button
				type="button"
				onClick={() => onOpen(row)}
				title={[
					formatTaskId(row.id),
					showBadge ? `⟦${row.agent}⟧` : "",
					row.line ?? "",
					meta.join(" · "),
				]
					.filter(Boolean)
					.join(" ")}
				className="group/row flex w-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded px-1 py-0.5 text-left hover:bg-[var(--ghost-hover)]"
			>
				<span className="w-4 shrink-0 select-none text-center font-mono text-[11px] text-[var(--text-30)]">
					{last ? "└─" : "├─"}
				</span>
				<Icon
					size={12}
					className={clsx("shrink-0", spin && "animate-spin")}
					style={{ color }}
					aria-label={SUBAGENT_STATUS_TEXT[row.status]}
				/>
				<span className="shrink-0 font-medium text-[length:var(--chat-font-size)] text-[var(--text)]">
					{formatTaskId(row.id)}
				</span>
				{showBadge && (
					<span className="shrink-0 font-mono text-[11px] text-[var(--text-30)]">
						⟦{row.agent}⟧
					</span>
				)}
				<span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-40)]">
					{row.line ?? ""}
				</span>
				{meta.length > 0 && (
					<span className="min-w-0 truncate tabular-nums text-[11px] text-[var(--text-30)]">
						{meta.join(" · ")}
					</span>
				)}
			</button>
			{row.status === "running" && row.currentTool && (
				<div className="flex items-center gap-1.5 ps-[52px] font-mono text-[11px] text-[var(--text-30)]">
					<span className="shrink-0">↳ {row.currentTool}</span>
					{row.currentToolDetail && (
						<span className="truncate">{row.currentToolDetail}</span>
					)}
				</div>
			)}
			{nested?.map((p, i) => (
				<NestedRow key={p.id || i} p={p} />
			))}
		</div>
	);
}

export function TaskToolBlock({
	sessionId,
	toolCallId,
	args,
	status,
	details,
	resultText,
	expanded,
}: TaskToolBlockProps) {
	// Collapsed by default like every activity row; running/error show via the
	// header tone. A click or expand-all opens it.
	const [open, setOpen] = useState(expanded === true);
	useEffect(() => {
		if (expanded !== undefined) setOpen(expanded);
	}, [expanded]);
	const [expandedAll, setExpandedAll] = useState(false);
	const [sheetId, setSheetId] = useState<string | null>(null);
	const [fileList, setFileList] = useState<SubagentSummary[] | null>(null);

	const liveSubagents = useLive((s) => s.sessions[sessionId]?.subagents);
	const liveSessionFile = useLive((s) => {
		const f = s.sessions[sessionId]?.state?.sessionFile;
		return typeof f === "string" ? f : undefined;
	});
	const parentFile =
		useSessions((s) => s.sessions[sessionId]?.file) ?? liveSessionFile;

	const taskDetails = asTaskDetails(details);
	const finished = status === "done" || status === "error";

	// History / async-resume: pull summaries from the on-disk session dir so
	// pending spawn receipts resolve to real statuses and outputs.
	const watching = useSessions((s) => {
		const st = s.sessions[sessionId]?.status;
		return st === "external" || st === "working";
	});
	// Shared per-parent-file poll (diskPoller): one timer for every consumer;
	// it keeps polling while the parent turn is active or a subagent runs.
	const parentActive = watching && !finished;
	const subRef = useRef<DiskSubscription | null>(null);
	useEffect(() => {
		if (!parentFile) return;
		const sub = subscribeDiskSubagents(parentFile, setFileList, parentActive);
		subRef.current = sub;
		return () => {
			subRef.current = null;
			sub.unsubscribe();
		};
		// parentActive changes go through setParentActive below, not a resubscribe.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [parentFile]);
	useEffect(() => {
		subRef.current?.setParentActive(parentActive);
	}, [parentActive]);

	const { context, rows } = useMemo(
		() =>
			mergeAgents({
				args,
				details: taskDetails,
				fileList,
				liveSubagents,
				toolCallId,
			}),
		[args, taskDetails, fileList, liveSubagents, toolCallId],
	);

	const running = rows.filter(
		(r) => r.status === "running" || r.status === "pending",
	).length;
	const done = rows.filter((r) => r.status === "completed").length;
	const failed = rows.filter(
		(r) => r.status === "failed" || r.status === "aborted",
	).length;
	const total = rows.length;

	const isActive = status === "running" || status === "called";
	const header = isActive
		? total > 0
			? `子代理运行中 · ${done}/${total} 完成`
			: "派发子代理"
		: `派发 ${total} 个子代理`;

	const visible = expandedAll ? rows : rows.slice(0, COLLAPSED_LIMIT);
	// Re-derive the sheet row each render so live progress frames update the
	// open sheet (status, current tool, counters) without reopening it.
	const sheetRow = sheetId ? (rows.find((r) => r.id === sheetId) ?? null) : null;
	const hidden = total - visible.length;

	return (
		<div className="my-px">
			<ActivityHeader
				icon={Bot}
				label={header}
				running={isActive}
				error={status === "error"}
				expandable
				open={open}
				onToggle={() => setOpen(!open)}
				accessory={
					isActive && running > 0 ? (
						<span className="shrink-0 text-[12px] text-[var(--text-40)]">
							{running} 运行中
						</span>
					) : !isActive && failed > 0 ? (
						<span className="shrink-0 text-[12px] text-[var(--status-error)]">
							{failed} 失败
						</span>
					) : null
				}
			/>

			{open && (
				<div className="flex flex-col gap-0.5 ps-5 pb-1 pt-0.5">
					{visible.map((row, i) => (
						<AgentRowView
							key={row.id}
							row={row}
							last={i === visible.length - 1 && hidden <= 0}
							onOpen={(r) => setSheetId(r.id)}
						/>
					))}
					{hidden > 0 && (
						<button
							type="button"
							onClick={() => setExpandedAll(true)}
							className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-[var(--text-30)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text-60)]"
						>
							<span className="w-4 shrink-0 text-center font-mono">└─</span>
							还有 {hidden} 个
						</button>
					)}
					{total === 0 && (
						<div className="px-1 py-0.5 text-[11px] text-[var(--text-30)]">
							{resultText?.trim() || "无子代理记录"}
						</div>
					)}
				</div>
			)}

			{sheetRow && (
				<SubagentSheet
					parentFile={parentFile}
					row={sheetRow}
					context={context}
					onClose={() => setSheetId(null)}
				/>
			)}
		</div>
	);
}
