/**
 * Merge all data sources for one `task` tool call into display rows:
 * args (batch items) < details.progress/results < subagent_list summaries
 * < live subagent frames (newest wins). Pure + tested via live.test coverage
 * of the reducer; kept out of the component for clarity.
 */

import type { SubagentSummary } from "../../../lib/contracts";
import type { SubagentInfo } from "../../../stores/live";
import type {
	AgentProgress,
	SingleResult,
	SubagentStatus,
	TaskToolDetails,
} from "./types";

export interface TaskArgItem {
	id: string;
	agent?: string;
	task?: string;
	assignment?: string;
	description?: string;
	solutionSpace?: string;
}

export interface AgentRow {
	id: string;
	index: number;
	agent?: string;
	agentSource?: string;
	status: SubagentStatus;
	/** One-line label: description or first task line. */
	line?: string;
	assignment?: string;
	/** Verbatim prompt (progress.task / arg.task / file summary preview). */
	task?: string;
	/** provider/id from live progress or the jsonl model_change. */
	model?: string;
	modelRole?: string;
	thinkingLevel?: string;
	toolCount?: number;
	requests?: number;
	tokens?: number;
	contextTokens?: number;
	contextWindow?: number;
	cost?: number;
	durationMs?: number;
	startedAt?: string;
	endedAt?: string;
	currentTool?: string;
	currentToolDetail?: string;
	recentTools?: AgentProgress["recentTools"];
	output?: string;
	outputPath?: string;
	/** Absolute path of the `<id>.jsonl` session file (for the transcript tab). */
	filePath?: string;
	error?: string;
	abortReason?: string;
	/** Nested task details (sub-subagents) from live progress. */
	inflightTaskDetails?: TaskToolDetails | null;
	/** Free-form description of the solution space the dispatcher gave this task. */
	solutionSpace?: string;
	/** Shared `context` of the parent `task` call. */
	sharedContext?: string;
}

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

const asStr = (v: unknown): string | undefined =>
	typeof v === "string" && v.trim() ? v : undefined;

const asNum = (v: unknown): number | undefined => {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string") {
		const n = Number.parseFloat(v);
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
};

export function asTaskDetails(v: unknown): TaskToolDetails | null {
	const o = asObj(v);
	if (!Array.isArray(o.results) && !Array.isArray(o.progress) && !o.async) {
		return null;
	}
	return o as unknown as TaskToolDetails;
}

/** Parse `task` args: batch `{context, tasks[]}` or flat `{agent, task}`. */
export function parseTaskArgs(args: unknown): {
	context?: string;
	items: TaskArgItem[];
} {
	const o = asObj(args);
	const context = asStr(o.context);
	const raw = Array.isArray(o.tasks) ? o.tasks : null;
	if (raw) {
		return {
			context,
			items: raw.map((t, i) => {
				const it = asObj(t);
				return {
					id:
						asStr(it.id) ??
						asStr(it.name) ??
						`#${i + 1}`,
					agent: asStr(it.agent),
					task: asStr(it.task),
					assignment: asStr(it.assignment),
					description: asStr(it.description),
					solutionSpace: asStr(it.solutionSpace),
				};
			}),
		};
	}
	// Flat form: one implicit agent.
	if (asStr(o.task) || asStr(o.agent)) {
		return {
			context,
			items: [
				{
					id: asStr(o.id) ?? asStr(o.name) ?? "#1",
					agent: asStr(o.agent),
					task: asStr(o.task),
					assignment: asStr(o.assignment),
					description: asStr(o.description),
					solutionSpace: asStr(o.solutionSpace),
				},
			],
		};
	}
	return { context, items: [] };
}

export const normStatus = (s: unknown): SubagentStatus | undefined => {
	switch (s) {
		case "pending":
		case "running":
		case "completed":
		case "failed":
		case "aborted":
			return s;
		case "started":
			return "running";
		default:
			return undefined;
	}
};

/** First non-empty line, used as the row label fallback (omp's fixed prompt prefix dropped). */
const firstLine = (t?: string): string | undefined =>
	t
		?.replace(/^Complete assignment thoroughly:\s*/, "")
		.split("\n")
		.map((l) => l.trim())
		.find(Boolean);

export const isTerminalStatus = (s: SubagentStatus | undefined): boolean =>
	s === "completed" || s === "failed" || s === "aborted";

/** Terminal results are final: a later non-terminal source cannot revive them. */
function setStatus(row: AgentRow, next: SubagentStatus | undefined) {
	if (!next) return;
	if (isTerminalStatus(row.status) && !isTerminalStatus(next)) return;
	row.status = next;
}

function applyProgress(row: AgentRow, p: AgentProgress | SingleResult) {
	setStatus(row, normStatus(p.status));
	row.agent ??= asStr(p.agent);
	row.agentSource ??= asStr(p.agentSource);
	row.assignment ??= asStr(p.assignment);
	row.task ??= asStr(p.task);
	row.line ??= asStr(p.description) ?? firstLine(row.task ?? row.assignment);
	row.model ??=
		asStr(p.resolvedModelIdentity) ?? asStr(p.resolvedModel);
	row.modelRole ??= asStr(p.modelRole);
	row.thinkingLevel ??= asStr(p.resolvedThinkingLevel);
	row.toolCount ??= asNum(p.toolCount);
	row.requests ??= asNum(p.requests);
	row.tokens ??= asNum(p.tokens);
	row.contextTokens ??= asNum(p.contextTokens);
	row.contextWindow ??= asNum(p.contextWindow);
	const cost = asNum(p.cost);
	if (cost !== undefined && cost > 0) row.cost = cost;
	const dur = asNum(p.durationMs);
	if (dur !== undefined && dur > 0) row.durationMs = dur;
	row.currentTool = asStr(p.currentTool);
	row.currentToolDetail =
		asStr(p.currentToolIntent) ??
		asStr(p.currentToolArgsKey) ??
		(typeof p.currentToolArgs === "string" ? p.currentToolArgs : undefined);
	row.recentTools = Array.isArray(p.recentTools) ? p.recentTools : [];
	if (p.inflightTaskDetails) row.inflightTaskDetails = p.inflightTaskDetails;
	const r = p as SingleResult;
	row.output ??= asStr(r.output);
	row.outputPath ??= asStr(r.outputPath);
	row.error ??= asStr(r.error);
	row.abortReason ??= asStr(r.abortReason);
}

function applySummary(row: AgentRow, s: SubagentSummary) {
	// File summaries win only when they add information: pending rows get the
	// real status, terminal file results resolve stale pending/running rows.
	// A stale file must NOT downgrade a live/details "running" to "pending".
	if (row.status === "pending" || s.status !== "pending") {
		setStatus(row, s.status);
	}
	row.model ??= s.model ?? undefined;
	row.thinkingLevel ??= s.thinkingLevel ?? undefined;
	row.line ??= firstLine(s.prompt ?? undefined);
	if (s.toolCallCount) row.toolCount = s.toolCallCount;
	if (s.requestCount) row.requests = s.requestCount;
	if (s.tokens) row.tokens = s.tokens;
	if (typeof s.cost === "number" && s.cost > 0) row.cost = s.cost;
	if (s.startedAt) row.startedAt = s.startedAt;
	if (s.endedAt) row.endedAt = s.endedAt;
	row.outputPath ??= s.outputPath ?? undefined;
	row.filePath ??= s.filePath;
	if (s.startedAt && s.endedAt) {
		const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
		if (Number.isFinite(ms) && ms > 0) row.durationMs = ms;
	}
}

const normPrompt = (t?: string | null): string =>
	(t ?? "")
		.replace(/^Complete assignment thoroughly:\s*/, "")
		.replace(/\s+/g, " ")
		.trim();

/** True when a file summary's prompt is the same task text as this row's. */
function promptMatches(row: AgentRow, prompt: string | null): boolean {
	const p = normPrompt(prompt);
	if (!p) return false;
	for (const t of [row.task, row.assignment]) {
		const n = normPrompt(t);
		if (n && (n === p || p.startsWith(n) || n.startsWith(p))) return true;
	}
	return false;
}

function applyLive(row: AgentRow, s: SubagentInfo) {
	if (!isTerminalStatus(row.status)) {
		setStatus(row, normStatus(s.status));
	}
	row.agent ??= s.agent;
	row.agentSource ??= s.agentSource;
	row.assignment ??= s.assignment;
	row.task ??= s.task;
	row.line ??= s.description ?? firstLine(s.task);
	if (s.progress) applyProgress(row, s.progress);
	if (!isTerminalStatus(row.status)) {
		setStatus(row, normStatus(s.status));
	}
	row.filePath ??= s.sessionFile;
}

/**
 * `liveSubagents`: `useLive` subagent map; only entries whose
 * `parentToolCallId` equals `toolCallId` are merged.
 */
export function mergeAgents(input: {
	args: unknown;
	details: TaskToolDetails | null;
	fileList?: SubagentSummary[] | null;
	liveSubagents?: Record<string, SubagentInfo>;
	toolCallId: string;
	/**
	 * Outcome of the dispatching tool call. An `error` call started nothing
	 * beyond what its own details/live entries prove: file summaries (matched
	 * by id or prompt, so they can belong to a later re-dispatch) never enrich
	 * its rows, and rows nothing confirms as running end up failed.
	 */
	callStatus?: "running" | "done" | "error" | "called";
	/** Tool result text, used as the failure reason of settled rows. */
	resultText?: string;
}): { context?: string; rows: AgentRow[] } {
	const { context, items } = parseTaskArgs(input.args);
	const rows = new Map<string, AgentRow>();
	const byIndex = new Map<number, AgentRow>();
	const get = (id: string, index?: number): AgentRow => {
		let r = rows.get(id);
		if (!r && index !== undefined && byIndex.has(index)) {
			// Positional placeholder (#1, #2) re-keyed by the real omp agent id
			// that arrived with matching index.
			const placeholder = byIndex.get(index)!;
			if (placeholder.id.startsWith("#")) {
				rows.delete(placeholder.id);
				placeholder.id = id;
				rows.set(id, placeholder);
				return placeholder;
			}
		}
		if (!r) {
			r = { id, index: index ?? rows.size, status: "pending" };
			rows.set(id, r);
			if (index !== undefined && !byIndex.has(index)) {
				byIndex.set(index, r);
			}
		}
		return r;
	};

	items.forEach((it, i) => {
		const r = get(it.id, i);
		r.index = i;
		r.agent = it.agent;
		r.assignment = it.assignment;
		r.task = it.task ?? it.assignment;
		r.line = it.description ?? firstLine(r.task);
		r.solutionSpace = it.solutionSpace;
	});

	const owned = new Set<string>();
	const progress = input.details?.progress;
	if (Array.isArray(progress)) {
		for (const p of progress) {
			const id = asStr(p.id);
			if (!id) continue;
			const idx = asNum(p.index);
			const r = get(id, idx);
			owned.add(r.id);
			if (idx !== undefined) r.index = idx;
			applyProgress(r, p);
		}
	}
	const results = input.details?.results;
	if (Array.isArray(results)) {
		for (const res of results) {
			const id = asStr(res.id);
			if (!id) continue;
			const idx = asNum(res.index);
			const r = get(id, idx);
			owned.add(r.id);
			if (idx !== undefined) r.index = idx;
			applyProgress(r, res);
		}
	}
	// The file list holds every subagent of the whole session; it only enriches
	// rows that already belong to this tool call, never adds rows.
	const failedCall = input.callStatus === "error";
	const unmatched = [...rows.values()].filter(
		(r) => !failedCall || owned.has(r.id),
	);
	for (const s of input.fileList ?? []) {
		const byId = rows.get(s.id);
		const target =
			(byId && (!failedCall || owned.has(s.id)) ? byId : undefined) ??
			unmatched.find((r) => !r.filePath && promptMatches(r, s.prompt));
		if (target) applySummary(target, s);
	}
	const confirmedLive = new Set<string>();
	for (const [id, s] of Object.entries(input.liveSubagents ?? {})) {
		if (s.parentToolCallId !== input.toolCallId) continue;
		const r = get(id, s.index);
		applyLive(r, s);
		if (!isTerminalStatus(normStatus(s.status))) confirmedLive.add(r.id);
	}
	// Only the child's own timestamps/durations are trusted. The parent call's
	// start/end spans the whole batch and must not be used as a per-agent time;
	// unknown stays unknown.
	for (const r of rows.values()) {
		if (isTerminalStatus(r.status) && r.startedAt && r.endedAt && (!r.durationMs || r.durationMs <= 0)) {
			const ms = Date.parse(r.endedAt) - Date.parse(r.startedAt);
			if (Number.isFinite(ms) && ms > 0) r.durationMs = ms;
		}
	}
	if (failedCall) {
		const why = asStr(input.resultText);
		for (const r of rows.values()) {
			if (isTerminalStatus(r.status) || confirmedLive.has(r.id)) continue;
			r.status = "failed";
			r.error ??= why;
			r.currentTool = undefined;
			r.currentToolDetail = undefined;
		}
	}

	const rowsOut = [...rows.values()].sort(
		(a, b) => a.index - b.index || a.id.localeCompare(b.id),
	);
	for (const r of rowsOut) {
		if (context) r.sharedContext = context;
	}
	return { context, rows: rowsOut };
}
