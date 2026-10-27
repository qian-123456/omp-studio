import { describe, expect, it } from "vitest";
import {
	buildTree,
	countRows,
	elapsedMs,
	filterTree,
	flattenTree,
	formatElapsed,
	isSubagentFrame,
	mergeSubagents,
	rowLabel,
	statusBucket,
	subagentName,
} from "./model";
import type { SubagentSummary } from "./model";

const row = (id: string, status = "running", extra: Partial<SubagentSummary> = {}): SubagentSummary => ({ id, status, ...extra });

describe("statusBucket", () => {
	it("buckets wire statuses; pending is queued, not done", () => {
		expect(statusBucket("pending")).toBe("queued");
		expect(statusBucket("running")).toBe("running");
		expect(statusBucket("completed")).toBe("done");
		expect(statusBucket("failed")).toBe("failed");
		expect(statusBucket("aborted")).toBe("failed");
		expect(statusBucket(undefined)).toBe("running");
	});
	it("counts rows", () => {
		expect(countRows([row("a", "running"), row("b", "completed"), row("c", "failed"), row("d", "pending"), row("e", "done")])).toEqual({
			running: 1,
			queued: 1,
			done: 2,
			failed: 1,
		});
	});
});

describe("mergeSubagents", () => {
	it("never revives a terminal row from stale running data", () => {
		const prev = [row("a", "completed", { endedAt: "2026-01-01T00:00:10Z" })];
		const next = [row("a", "running", { endedAt: null })];
		const merged = mergeSubagents(prev, next);
		expect(merged[0].status).toBe("completed");
		expect(merged[0].endedAt).toBe("2026-01-01T00:00:10Z");
	});
	it("lets running advance to terminal and new rows appear", () => {
		const merged = mergeSubagents([row("a", "running")], [row("a", "failed"), row("b", "pending")]);
		expect(merged.map((r) => r.status)).toEqual(["failed", "pending"]);
	});
});

describe("buildTree", () => {
	it("nests A > B > C by dotted id prefix", () => {
		const tree = buildTree([row("A", "completed"), row("A.B", "completed"), row("A.B.C", "completed")]);
		expect(tree).toHaveLength(1);
		expect(tree[0].children[0].id).toBe("A.B");
		expect(tree[0].children[0].children[0].id).toBe("A.B.C");
	});
	it("attaches an orphan to its nearest tracked ancestor, else makes it a root", () => {
		const tree = buildTree([row("A"), row("A.X.C"), row("Z.Q")]);
		expect(tree.map((n) => n.id).sort()).toEqual(["A", "Z.Q"]);
		expect(tree.find((n) => n.id === "A")?.children.map((n) => n.id)).toEqual(["A.X.C"]);
	});
	it("puts running siblings first, keeping order otherwise", () => {
		const tree = buildTree([row("a", "completed"), row("b", "running"), row("c", "failed"), row("d", "pending")]);
		expect(tree.map((n) => n.id)).toEqual(["b", "d", "a", "c"]);
	});
	it("flatten reports depth, guides and last flags for connectors", () => {
		const flat = flattenTree(buildTree([row("A", "completed"), row("A.B", "completed"), row("A.B.C", "completed"), row("A.D", "completed")]));
		expect(flat.map((f) => [f.node.id, f.depth, f.isLast, f.guides])).toEqual([
			["A", 0, true, []],
			["A.B", 1, false, []],
			["A.B.C", 2, true, [true]],
			["A.D", 1, true, []],
		]);
	});
	it("filter keeps ancestors of matches and marks them dim", () => {
		const roots = buildTree([row("A", "completed"), row("A.B", "failed"), row("Z", "completed")]);
		const flat = flattenTree(filterTree(roots, "failed"), "failed");
		expect(flat.map((f) => [f.node.id, f.dim])).toEqual([
			["A", true],
			["A.B", false],
		]);
	});
});

describe("labels and elapsed", () => {
	it("derives job name and keeps the role as separate badge text", () => {
		expect(subagentName("0-I18nCore", "task")).toBe("I18nCore");
		expect(subagentName("0-Explore", "explore")).toBe("");
		expect(subagentName("#3")).toBe("");
		const l = rowLabel(row("P.0-Builder", "running", { agent: "task", prompt: "## Target\nBuild the thing" }));
		expect(l).toEqual({ primary: "Builder", description: "Build the thing", role: "task" });
		expect(rowLabel(row("0-Explore", "running", { agent: "explore", prompt: "Find it. Then more" })).primary).toBe("Find it. Then more");
	});
	it("elapsed ticks only for running rows", () => {
		const start = "2026-01-01T00:00:00Z";
		const t = Date.parse(start);
		expect(elapsedMs(row("a", "running", { startedAt: start }), t + 5000)).toBe(5000);
		expect(elapsedMs(row("a", "completed", { startedAt: start, endedAt: "2026-01-01T00:01:00Z" }), t + 999999)).toBe(60000);
		expect(elapsedMs(row("a", "pending", { startedAt: start }), t)).toBeUndefined();
		expect(formatElapsed(555_000)).toBe("9分15秒");
		expect(formatElapsed(21_000)).toBe("21秒");
		expect(formatElapsed(3_725_000)).toBe("1小时2分5秒");
		expect(formatElapsed(undefined)).toBe("");
	});
	it("recognises subagent related rpc frames", () => {
		expect(isSubagentFrame({ type: "subagent_lifecycle" })).toBe(true);
		expect(isSubagentFrame({ type: "tool_execution_end", toolName: "task" })).toBe(true);
		expect(isSubagentFrame({ type: "tool_execution_end", toolName: "bash" })).toBe(false);
		expect(isSubagentFrame({ type: "message_update" })).toBe(false);
	});
});
