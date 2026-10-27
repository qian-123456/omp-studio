/**
 * Pure helpers behind the subagent capsule and pages: wire types, status
 * bucketing, terminal-status stickiness, tree building and row text.
 * Ported from the desktop `chat/subagents/{counts,subagentTree}.ts`.
 */

/** `SubagentSummary` (contracts.rs) as served by `GET /sessions/{id}/subagents`. */
export interface SubagentSummary {
	id: string;
	status: string;
	model?: string | null;
	thinkingLevel?: string | null;
	agent?: string | null;
	prompt?: string | null;
	messageCount?: number;
	toolCallCount?: number;
	requestCount?: number;
	tokens?: number;
	cost?: number;
	startedAt?: string | null;
	endedAt?: string | null;
	outputPath?: string | null;
	filePath?: string;
}

export type Bucket = "running" | "queued" | "done" | "failed";

export interface Counts {
	running: number;
	queued: number;
	done: number;
	failed: number;
}

/** Bucket a free-form status string. Order matters: "pending" contains "end". */
export function statusBucket(status: string | null | undefined): Bucket {
	const s = String(status ?? "").toLowerCase();
	if (/(fail|error|abort|cancel|kill)/.test(s)) return "failed";
	if (/(pending|queue|waiting)/.test(s)) return "queued";
	if (/(done|complete|finish|success|succeed|exit|end)/.test(s)) return "done";
	return "running";
}

export const isTerminal = (status: string | null | undefined): boolean => {
	const b = statusBucket(status);
	return b === "done" || b === "failed";
};

/** True while the subagent still does (or is about to do) work. */
export const isActive = (status: string | null | undefined): boolean => !isTerminal(status);

export function countRows(rows: readonly { status: string }[]): Counts {
	const c: Counts = { running: 0, queued: 0, done: 0, failed: 0 };
	for (const r of rows) c[statusBucket(r.status)] += 1;
	return c;
}

export function anyActive(rows: readonly { status: string }[]): boolean {
	return rows.some((r) => isActive(r.status));
}

/**
 * Merge a fresh list over the previous one. A terminal row is never revived by
 * stale non-terminal data (a slow response or an older poll): it keeps its
 * terminal status and end time. A failed row also never flips to done and
 * vice versa while the new status is terminal — the latest terminal wins.
 */
export function mergeSubagents(prev: readonly SubagentSummary[], next: readonly SubagentSummary[]): SubagentSummary[] {
	const old = new Map(prev.map((r) => [r.id, r]));
	return next.map((row) => {
		const before = old.get(row.id);
		if (before && isTerminal(before.status) && isActive(row.status)) {
			return { ...row, status: before.status, endedAt: before.endedAt ?? row.endedAt };
		}
		return row;
	});
}

/* ----------------------------------------------------------------- tree */

export interface TreeNode {
	id: string;
	row: SubagentSummary;
	bucket: Bucket;
	children: TreeNode[];
}

/**
 * Build the dispatch tree. Ancestry lives in the id (`Parent.Child`, matching
 * omp's nested `<Parent>/<Parent>.<Child>.jsonl` layout): the longest tracked
 * dotted prefix is the parent. A child whose parent is not tracked (orphan)
 * becomes a root. Siblings keep list order, running siblings first.
 */
export function buildTree(rows: readonly SubagentSummary[]): TreeNode[] {
	const nodes = new Map<string, TreeNode>();
	for (const row of rows) {
		if (!nodes.has(row.id)) nodes.set(row.id, { id: row.id, row, bucket: statusBucket(row.status), children: [] });
	}
	const roots: TreeNode[] = [];
	for (const node of nodes.values()) {
		let parent: TreeNode | undefined;
		for (let dot = node.id.lastIndexOf("."); dot > 0; dot = node.id.lastIndexOf(".", dot - 1)) {
			parent = nodes.get(node.id.slice(0, dot));
			if (parent) break;
		}
		(parent ? parent.children : roots).push(node);
	}
	return sortRunningFirst(roots);
}

const isRunningLike = (n: TreeNode): boolean => n.bucket === "running" || n.bucket === "queued";

/** Stable: running/queued siblings first; recurses. */
export function sortRunningFirst(nodes: TreeNode[]): TreeNode[] {
	for (const n of nodes) n.children = sortRunningFirst(n.children);
	const active = nodes.filter(isRunningLike);
	return active.length === 0 || active.length === nodes.length ? nodes : [...active, ...nodes.filter((n) => !isRunningLike(n))];
}

export type Filter = "all" | "running" | "done" | "failed";

export const FILTERS: readonly { key: Filter; label: string }[] = [
	{ key: "all", label: "全部" },
	{ key: "running", label: "运行中" },
	{ key: "done", label: "完成" },
	{ key: "failed", label: "失败" },
];

export function matchesFilter(bucket: Bucket, filter: Filter): boolean {
	if (filter === "all") return true;
	if (filter === "running") return bucket === "running" || bucket === "queued";
	return bucket === filter;
}

/** Keep nodes matching the filter plus the ancestors needed to reach them. Copies. */
export function filterTree(roots: TreeNode[], filter: Filter): TreeNode[] {
	if (filter === "all") return roots;
	const walk = (list: TreeNode[]): TreeNode[] => {
		const out: TreeNode[] = [];
		for (const n of list) {
			const children = walk(n.children);
			if (matchesFilter(n.bucket, filter) || children.length) out.push({ ...n, children });
		}
		return out;
	};
	return walk(roots);
}

export interface FlatRow {
	node: TreeNode;
	depth: number;
	/** Per ancestor level 1..depth-1: does that ancestor have later siblings (draw a vertical guide)? */
	guides: boolean[];
	isLast: boolean;
	/** The row only appears as an ancestor of a filter match. */
	dim: boolean;
}

/** DFS order with the connector info the page needs. */
export function flattenTree(roots: TreeNode[], filter: Filter = "all"): FlatRow[] {
	const out: FlatRow[] = [];
	const walk = (list: TreeNode[], depth: number, guides: boolean[]) => {
		list.forEach((node, i) => {
			const isLast = i === list.length - 1;
			out.push({ node, depth, guides, isLast, dim: !matchesFilter(node.bucket, filter) });
			walk(node.children, depth + 1, depth === 0 ? guides : [...guides, !isLast]);
		});
	};
	walk(roots, 0, []);
	return out;
}

/* ----------------------------------------------------------------- text */

/** Dispatcher-assigned job name from the id leaf ("0-Foo" / "A.Foo" -> "Foo"); "" for placeholders or bare role ids. */
export function subagentName(id: string, role?: string | null): string {
	const leaf = id.slice(id.lastIndexOf(".") + 1);
	const name = leaf.replace(/^\d+-/, "").trim();
	if (!name || /^#?\d+$/.test(name)) return "";
	if (role && name.toLowerCase() === role.trim().toLowerCase()) return "";
	return name;
}

/** First meaningful line of the prompt preview, without markdown header noise. */
export function describe(prompt: string | null | undefined): string {
	if (!prompt) return "";
	const line = prompt
		.replace(/^Complete assignment thoroughly:\s*/, "")
		.split("\n")
		.map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
		.find((l) => l && !/^(Target|Goal|Task|Context)\s*[:：]?$/i.test(l));
	return (line ?? "").replace(/^(Target|Goal|Task|Context)\s*[:：]?\s+/i, "").replace(/`/g, "");
}

export interface RowLabel {
	/** Primary line: job name, else the description, else the id. */
	primary: string;
	/** Wrapped second line (only when a name is the primary label). */
	description: string;
	role: string;
}

export function rowLabel(row: SubagentSummary): RowLabel {
	const role = (row.agent ?? "").trim();
	const name = subagentName(row.id, role);
	const desc = describe(row.prompt);
	if (name) return { primary: name, description: desc, role };
	return { primary: desc || row.id, description: "", role };
}

export const STATUS_TEXT: Record<Bucket, string> = {
	running: "运行中",
	queued: "等待中",
	done: "完成",
	failed: "失败",
};

/** Failure rows distinguish an abort from an error in the label. */
export function statusText(status: string): string {
	return /abort|cancel|kill/i.test(status) ? "已中止" : STATUS_TEXT[statusBucket(status)];
}

/** Elapsed ms: finished rows use their recorded span, running rows tick from the start. */
export function elapsedMs(row: Pick<SubagentSummary, "status" | "startedAt" | "endedAt">, now: number): number | undefined {
	const start = row.startedAt ? Date.parse(row.startedAt) : Number.NaN;
	if (!Number.isFinite(start)) return undefined;
	const bucket = statusBucket(row.status);
	if (bucket === "queued") return undefined;
	if (bucket === "running") return Math.max(0, now - start);
	const end = row.endedAt ? Date.parse(row.endedAt) : Number.NaN;
	return Number.isFinite(end) ? Math.max(0, end - start) : undefined;
}

/** "9分15秒" / "21秒" / "1小时2分5秒"; "" when unknown. */
export function formatElapsed(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}小时${m}分${s}秒`;
	if (m > 0) return `${m}分${s}秒`;
	return `${s}秒`;
}

/** Whether an SSE rpc frame can change the subagent list. */
export function isSubagentFrame(frame: { type?: string; toolName?: string } | null | undefined): boolean {
	if (!frame) return false;
	const type = String(frame.type ?? "");
	if (type.startsWith("subagent")) return true;
	if (type === "tool_execution_start" || type === "tool_execution_end") {
		return frame.toolName === "task" || frame.toolName === "agent";
	}
	return false;
}
