/** Pure helpers bucketing subagent statuses for the TopCapsule (unit-tested). */

import type { SubagentInfo } from "../../../stores/live";

export interface SubagentCounts {
	running: number;
	/** Dispatched but not started yet (pending / queued). */
	queued: number;
	done: number;
	failed: number;
}

/** Bucket subagent statuses (free-form strings from RPC frames). */
export function subagentBucket(status: string): keyof SubagentCounts {
	const s = status.toLowerCase();
	if (/(fail|error|abort|cancel|kill)/.test(s)) return "failed";
	if (/(pending|queue|waiting)/.test(s)) return "queued";
	if (/(done|complete|finish|success|succeed|exit|end)/.test(s)) return "done";
	return "running";
}

export function subagentCounts(
	subagents: Record<string, SubagentInfo>,
): SubagentCounts {
	const c: SubagentCounts = { running: 0, queued: 0, done: 0, failed: 0 };
	for (const s of Object.values(subagents)) c[subagentBucket(String(s.status ?? ""))] += 1;
	return c;
}
