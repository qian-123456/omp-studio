/**
 * Subagents outlive their parent prompt turn: the main agent's turn ends when
 * it stops calling tools (e.g. after "Waiting for scouts"), while the
 * subagents it dispatched keep running. The transcript only knows the parent's
 * own items, so `TurnBlock.durationMs` stops at the last parent item. These
 * helpers extend a turn's span to cover the subagents it spawned.
 */

import type { AgentRow } from "./subagents/merge";
import type { SubagentInfo, SubagentStatus } from "./subagents/types";

export interface SubagentFacts {
	status: SubagentStatus;
	/** The `task` tool call that dispatched it (live frames only). */
	parentToolCallId?: string;
	/** Epoch ms of the first transcript line (disk rows only). */
	startedAt?: number;
	/** Epoch ms of the last known activity; meaningful once not running. */
	endedAt?: number;
}

export interface TurnSubagentSpan {
	/** At least one subagent of the turn is still running. */
	running: boolean;
	/** Latest end among the turn's finished subagents. */
	endedAt?: number;
}

const ms = (iso: string | undefined): number | undefined => {
	if (!iso) return undefined;
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : undefined;
};

/** Flatten the merged live+disk subagent maps into per-agent timing facts. */
export function collectSubagentFacts(
	subagents: Record<string, SubagentInfo>,
	rows: Record<string, AgentRow>,
): SubagentFacts[] {
	return Object.entries(subagents).map(([id, info]) => {
		const row = rows[id];
		const ends = [ms(row?.endedAt), info.lastUpdate].filter(
			(v): v is number => v !== undefined,
		);
		return {
			status: info.status,
			parentToolCallId: info.parentToolCallId,
			startedAt: ms(row?.startedAt),
			endedAt: ends.length > 0 ? Math.max(...ends) : undefined,
		};
	});
}

/**
 * Which subagents belong to a turn and where they stand. A subagent belongs to
 * the turn whose `task` call dispatched it, else (disk rows carry no parent
 * call id) to the turn whose [start, nextStart) window contains its start.
 * Only `running` counts as running: queued/stale-pending rows must not pin a
 * finished turn in its live state.
 */
export function turnSubagentSpan({
	turnStart,
	nextTurnStart,
	toolCallIds,
	subagents,
}: {
	turnStart: number;
	nextTurnStart?: number;
	toolCallIds: ReadonlySet<string>;
	subagents: readonly SubagentFacts[];
}): TurnSubagentSpan {
	let running = false;
	let endedAt: number | undefined;
	for (const s of subagents) {
		const byCall = s.parentToolCallId !== undefined && toolCallIds.has(s.parentToolCallId);
		const byWindow =
			s.startedAt !== undefined &&
			s.startedAt >= turnStart &&
			(nextTurnStart === undefined || s.startedAt < nextTurnStart);
		if (!byCall && !byWindow) continue;
		if (s.status === "running") running = true;
		else if (s.status !== "pending" && s.endedAt !== undefined) {
			endedAt = endedAt === undefined ? s.endedAt : Math.max(endedAt, s.endedAt);
		}
	}
	return { running, endedAt };
}

/**
 * Final turn duration: the parent's own active time, plus however long the
 * turn's subagents kept going after the parent's last item (`turnEndedAt`).
 * Unchanged when there is no such tail, so idle wake-up gaps stay excluded.
 */
export function durationWithSubagents(
	durationMs: number | undefined,
	turnEndedAt: number | undefined,
	subagentEndedAt: number | undefined,
): number | undefined {
	if (subagentEndedAt === undefined || turnEndedAt === undefined) return durationMs;
	const tail = subagentEndedAt - turnEndedAt;
	return tail > 0 ? (durationMs ?? 0) + tail : durationMs;
}
