/**
 * Pure helpers behind the subagent status panel: tree building, the visible
 * row cap, auto-expand and row text. Unit-tested in
 * subagentTree.test.ts.
 */

import type { SubagentInfo } from "../../../stores/live";
import { subagentBucket } from "./counts";
import type { AgentRow } from "./merge";

export type RowState = "running" | "done" | "failed" | "waiting";

/** Rows shown before the rest folds into the "还有 N 个" expander. */
export const MAX_VISIBLE_ROWS = 6;

export function rowState(status: string | undefined): RowState {
	const s = String(status ?? "").toLowerCase();
	if (s === "pending") return "waiting";
	const b = subagentBucket(s);
	return b === "done" ? "done" : b === "failed" ? "failed" : "running";
}

export interface TreeNode {
	id: string;
	state: RowState;
	children: TreeNode[];
}

/**
 * Build the dispatch tree. The only parent signal in the data is a running
 * subagent's `progress.inflightTaskDetails.progress[]` (the subagents it
 * dispatched); children listed there that are also tracked become nested under
 * it. Everything else is a root. Siblings keep `index` order.
 */
export function buildSubagentTree(
	subagents: Record<string, SubagentInfo>,
): TreeNode[] {
	const ids = Object.keys(subagents)
		.map((id, i) => ({ id, i, index: subagents[id].index ?? Number.POSITIVE_INFINITY }))
		.sort((a, b) => a.index - b.index || a.i - b.i)
		.map((x) => x.id);

	const parentOf = new Map<string, string>();
	const isAncestor = (anc: string, of: string): boolean => {
		for (let cur: string | undefined = of; cur; cur = parentOf.get(cur)) {
			if (cur === anc) return true;
		}
		return false;
	};
	for (const parent of ids) {
		const nested = subagents[parent].progress?.inflightTaskDetails?.progress;
		if (!Array.isArray(nested)) continue;
		for (const p of nested) {
			const child = p?.id;
			if (!child || child === parent || !subagents[child]) continue;
			if (parentOf.has(child)) continue;
			// Never create a cycle: the child must not already be an ancestor of the parent.
			if (isAncestor(child, parent)) continue;
			parentOf.set(child, parent);
		}
	}

	const nodes = new Map<string, TreeNode>(
		ids.map((id) => [id, { id, state: rowState(subagents[id].status), children: [] }]),
	);
	const roots: TreeNode[] = [];
	for (const id of ids) {
		const node = nodes.get(id)!;
		const parent = parentOf.get(id);
		(parent ? nodes.get(parent)!.children : roots).push(node);
	}
	return sortRunningFirst(roots);
}

/** Stable sort, running siblings first; recurses into children. */
export function sortRunningFirst(nodes: TreeNode[]): TreeNode[] {
	for (const n of nodes) n.children = sortRunningFirst(n.children);
	const running = nodes.filter((n) => n.state === "running");
	return running.length === 0 || running.length === nodes.length
		? nodes
		: [...running, ...nodes.filter((n) => n.state !== "running")];
}

/** DFS order of every node id in the forest. */
export function flattenTree(roots: TreeNode[]): TreeNode[] {
	const out: TreeNode[] = [];
	const walk = (list: TreeNode[]) => {
		for (const n of list) {
			out.push(n);
			walk(n.children);
		}
	};
	walk(roots);
	return out;
}

export interface CappedTree {
	roots: TreeNode[];
	/** Rows folded away. */
	hidden: number;
	/** Every folded row is finished successfully (label reads "已完成"). */
	hiddenAllDone: boolean;
}

/**
 * Keep at most `max` rows. Unfinished and failed rows win over finished ones;
 * a kept row always brings its ancestors so the tree stays connected. The tree
 * is returned pruned (copies), original order preserved.
 */
export function capTree(roots: TreeNode[], max: number): CappedTree {
	const all = flattenTree(roots);
	if (all.length <= max) return { roots, hidden: 0, hiddenAllDone: true };

	const parentOf = new Map<string, TreeNode>();
	const link = (list: TreeNode[], parent?: TreeNode) => {
		for (const n of list) {
			if (parent) parentOf.set(n.id, parent);
			link(n.children, n);
		}
	};
	link(roots);

	const priority = [
		...all.filter((n) => n.state !== "done"),
		...all.filter((n) => n.state === "done"),
	];
	const kept = new Set<string>();
	for (const n of priority) {
		if (kept.has(n.id)) continue;
		const need: string[] = [];
		for (let cur: TreeNode | undefined = n; cur && !kept.has(cur.id); cur = parentOf.get(cur.id)) {
			need.push(cur.id);
		}
		if (kept.size + need.length > max) continue;
		for (const id of need) kept.add(id);
	}

	const prune = (list: TreeNode[]): TreeNode[] =>
		list
			.filter((n) => kept.has(n.id))
			.map((n) => ({ ...n, children: prune(n.children) }));
	const hiddenNodes = all.filter((n) => !kept.has(n.id));
	return {
		roots: prune(roots),
		hidden: hiddenNodes.length,
		hiddenAllDone: hiddenNodes.every((n) => n.state === "done"),
	};
}

export function moreLabel(hidden: number, allDone: boolean): string {
	return allDone ? `还有 ${hidden} 个已完成` : `还有 ${hidden} 个`;
}

/** True when a not-yet-seen subagent is unfinished (panel should (re)expand). */
export function shouldAutoExpand(
	seen: ReadonlySet<string>,
	subagents: Record<string, SubagentInfo>,
): boolean {
	return Object.entries(subagents).some(
		([id, s]) => !seen.has(id) && rowState(s.status) === "running",
	);
}

/** "9分15秒" / "21秒" / "1小时2分5秒"; "—" when unknown. */
export function formatElapsed(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}小时${m}分${s}秒`;
	if (m > 0) return `${m}分${s}秒`;
	return `${s}秒`;
}

/** Elapsed ms: finished rows use their recorded duration, running rows tick from the start time. */
export function elapsedMs(
	info: SubagentInfo,
	row: AgentRow | undefined,
	state: RowState,
	now: number,
): number | undefined {
	if (state === "waiting") return undefined;
	const recorded = row?.durationMs ?? info.progress?.durationMs;
	if (state !== "running") return recorded;
	const start = row?.startedAt ? Date.parse(row.startedAt) : Number.NaN;
	if (Number.isFinite(start)) return Math.max(0, now - start);
	return recorded;
}

const firstLine = (t: string | undefined): string | undefined =>
	t
		?.replace(/^Complete assignment thoroughly:\s*/, "")
		.split("\n")
		.map((l) => l.trim())
		.find(Boolean);

/** Task blurb that is not tied to the live activity. */
export function taskLine(info: SubagentInfo, row: AgentRow | undefined): string {
	return info.description || row?.line || firstLine(info.task) || firstLine(row?.task) || "";
}

/** Failure reason, when the row failed and any is known. */
export function failureReason(info: SubagentInfo, row: AgentRow | undefined): string | undefined {
	return (
		info.progress?.retryFailure?.errorMessage ||
		row?.error ||
		row?.abortReason ||
		undefined
	);
}

/** Row's second column: failure reason, live activity, wait hint or task blurb. */
export function activityText(
	info: SubagentInfo,
	row: AgentRow | undefined,
	state: RowState,
): { text: string; error: boolean } {
	if (state === "failed") {
		const why = failureReason(info, row);
		return { text: why ?? (String(info.status).toLowerCase() === "aborted" ? "已中止" : "执行失败"), error: true };
	}
	if (state === "running") {
		const p = info.progress;
		const live =
			p?.currentToolIntent || p?.lastIntent || p?.currentTool || row?.currentTool || undefined;
		return { text: live ?? taskLine(info, row), error: false };
	}
	if (state === "waiting") return { text: taskLine(info, row) || "等待中", error: false };
	return { text: taskLine(info, row), error: false };
}

/** Human title from a raw prompt: first meaningful sentence, no markdown header noise. */
export function cleanTitle(raw: string | undefined): string {
	if (!raw) return "";
	const line = raw
		.replace(/^Complete assignment thoroughly:\s*/, "")
		.split("\n")
		.map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
		.find((l) => l && !/^(Target|Goal|Task|Context)\s*[:：]?$/i.test(l));
	if (!line) return "";
	const cleaned = line
		.replace(/^(Target|Goal|Task|Context)\s*[:：]?\s+/i, "")
		.replace(/`/g, "")
		// Absolute paths make poor titles: keep the last segment only.
		.replace(/(?:\/[^\s/]+){2,}\/?/g, (p) => `…/${p.replace(/\/$/, "").split("/").pop()}`.replace("…/", ""));
	const m = cleaned.match(/^.*?[。！？!?;；]|^.*?\.(?=\s|$)/);
	return (m ? m[0] : cleaned).replace(/[。.;；\s]+$/, "").trim();
}

/** Row title: description, else a cleaned prompt sentence, else the id. */
export function subagentTitle(id: string, info: SubagentInfo, row: AgentRow | undefined): string {
	return (
		cleanTitle(info.description) ||
		cleanTitle(row?.line) ||
		cleanTitle(info.task) ||
		cleanTitle(row?.task) ||
		id
	);
}

export type RoleTone = "scout" | "task" | "reviewer" | "other";

export function roleTone(agent: string | undefined): RoleTone {
	const a = (agent ?? "").toLowerCase();
	if (a === "scout" || a === "explore" || a === "explorer") return "scout";
	if (a === "task" || a === "sonic" || a === "tester") return "task";
	if (/review/.test(a)) return "reviewer";
	return "other";
}

export type StatusSummary =
	| { mode: "running"; running: number; progress: string }
	| { mode: "done"; count: number }
	| { mode: "mixed"; done: number; failed: number };

/** One non-redundant status summary for the capsule / panel header. */
export function statusSummary(c: { running: number; done: number; failed: number }): StatusSummary {
	const total = c.running + c.done + c.failed;
	if (c.running > 0) return { mode: "running", running: c.running, progress: `${c.done + c.failed}/${total}` };
	if (c.failed === 0) return { mode: "done", count: c.done };
	return { mode: "mixed", done: c.done, failed: c.failed };
}
