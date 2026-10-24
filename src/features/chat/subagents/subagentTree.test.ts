import { describe, expect, it } from "vitest";
import type { SubagentInfo } from "../../../stores/live";
import {
	activityText,
	buildSubagentTree,
	capTree,
	elapsedMs,
	flattenTree,
	formatElapsed,
	moreLabel,
	rowState,
	shouldAutoExpand,
} from "./subagentTree";

const sub = (status: SubagentInfo["status"], extra: Partial<SubagentInfo> = {}): SubagentInfo => ({
	status,
	label: "x",
	...extra,
});

describe("rowState", () => {
	it("maps statuses", () => {
		expect(rowState("pending")).toBe("waiting");
		expect(rowState("running")).toBe("running");
		expect(rowState("completed")).toBe("done");
		expect(rowState("failed")).toBe("failed");
		expect(rowState("aborted")).toBe("failed");
	});
});

describe("buildSubagentTree", () => {
	it("nests on-disk agents under their dotted-id parent", () => {
		const roots = buildSubagentTree({
			"A.B.C": sub("running"),
			A: sub("running"),
			"A.B": sub("running"),
			"X.Y": sub("running"),
		});
		expect(roots.map((r) => r.id).sort()).toEqual(["A", "X.Y"]);
		const a = roots.find((r) => r.id === "A")!;
		expect(a.children.map((c) => c.id)).toEqual(["A.B"]);
		expect(a.children[0].children.map((c) => c.id)).toEqual(["A.B.C"]);
	});

	it("is flat without parent info; sorted by index within running/finished groups", () => {
		const roots = buildSubagentTree({
			b: sub("running", { index: 1 }),
			a: sub("completed", { index: 0 }),
		});
		expect(roots.map((n) => n.id)).toEqual(["b", "a"]);
		expect(roots.every((n) => n.children.length === 0)).toBe(true);
	});

	it("nests children dispatched by a running subagent", () => {
		const nested = (id: string) => ({ id }) as never;
		const roots = buildSubagentTree({
			p: sub("running", {
				index: 0,
				progress: { inflightTaskDetails: { progress: [nested("c1"), nested("c2")] } } as never,
			}),
			c1: sub("running", { index: 1 }),
			c2: sub("pending", { index: 2 }),
			other: sub("completed", { index: 3 }),
		});
		expect(roots.map((n) => n.id)).toEqual(["p", "other"]);
		expect(roots[0].children.map((n) => n.id)).toEqual(["c1", "c2"]);
		expect(roots[0].children[1].state).toBe("waiting");
	});

	it("ignores unknown children and breaks cycles", () => {
		const nested = (id: string) => ({ id }) as never;
		const roots = buildSubagentTree({
			a: sub("running", { index: 0, progress: { inflightTaskDetails: { progress: [nested("b"), nested("ghost")] } } as never }),
			b: sub("running", { index: 1, progress: { inflightTaskDetails: { progress: [nested("a")] } } as never }),
		});
		expect(roots.map((n) => n.id)).toEqual(["a"]);
		expect(roots[0].children.map((n) => n.id)).toEqual(["b"]);
		expect(roots[0].children[0].children).toEqual([]);
	});
});

describe("running-first order", () => {
	it("puts running first, stable within groups", () => {
		const roots = buildSubagentTree({
			a: sub("completed", { index: 0 }),
			b: sub("running", { index: 1 }),
			c: sub("failed", { index: 2 }),
			d: sub("running", { index: 3 }),
		});
		expect(roots.map((n) => n.id)).toEqual(["b", "d", "a", "c"]);
	});
});

describe("capTree", () => {
	const flat = (statuses: SubagentInfo["status"][]) =>
		buildSubagentTree(Object.fromEntries(statuses.map((s, i) => [`s${i}`, sub(s, { index: i })])));

	it("leaves small lists alone", () => {
		const r = capTree(flat(["running", "completed"]), 6);
		expect(r.hidden).toBe(0);
	});

	it("keeps at most 6 rows, preferring unfinished ones", () => {
		const r = capTree(
			flat(["completed", "completed", "completed", "completed", "completed", "completed", "running", "failed"]),
			6,
		);
		const ids = flattenTree(r.roots).map((n) => n.id);
		expect(ids).toHaveLength(6);
		expect(ids).toContain("s6");
		expect(ids).toContain("s7");
		expect(r.hidden).toBe(2);
		expect(r.hiddenAllDone).toBe(true);
		expect(moreLabel(r.hidden, r.hiddenAllDone)).toBe("还有 2 个已完成");
	});

	it("labels mixed hidden rows without 已完成", () => {
		const r = capTree(flat(Array(8).fill("running")), 6);
		expect(r.hidden).toBe(2);
		expect(r.hiddenAllDone).toBe(false);
		expect(moreLabel(2, false)).toBe("还有 2 个");
	});

	it("keeps ancestors of a kept child", () => {
		const nested = (id: string) => ({ id }) as never;
		const subs: Record<string, SubagentInfo> = {
			p: sub("completed", { index: 0, progress: { inflightTaskDetails: { progress: [nested("c")] } } as never }),
			c: sub("running", { index: 1 }),
		};
		for (let i = 0; i < 6; i++) subs[`d${i}`] = sub("completed", { index: 2 + i });
		const r = capTree(buildSubagentTree(subs), 3);
		const ids = flattenTree(r.roots).map((n) => n.id);
		expect(ids).toContain("c");
		expect(ids).toContain("p");
		expect(ids).toHaveLength(3);
	});
});

describe("auto-expand", () => {
	it("expands for a new unfinished subagent only", () => {
		const subs = { a: sub("completed"), b: sub("running") };
		expect(shouldAutoExpand(new Set(["a", "b"]), subs)).toBe(false);
		expect(shouldAutoExpand(new Set(["a"]), subs)).toBe(true);
		expect(shouldAutoExpand(new Set(["b"]), subs)).toBe(false);
	});
});

describe("row text", () => {
	it("formats elapsed", () => {
		expect(formatElapsed(72_000)).toBe("1分12秒");
		expect(formatElapsed(21_000)).toBe("21秒");
		expect(formatElapsed(3_725_000)).toBe("1小时2分5秒");
		expect(formatElapsed(undefined)).toBe("—");
	});

	it("uses start time for running rows and recorded duration when done", () => {
		const start = new Date(1_000_000).toISOString();
		const row = { id: "a", index: 0, status: "running", startedAt: start, durationMs: 5 } as never;
		expect(elapsedMs(sub("running"), row, "running", 1_021_000)).toBe(21_000);
		expect(elapsedMs(sub("completed"), row, "done", 9)).toBe(5);
		expect(elapsedMs(sub("pending"), undefined, "waiting", 9)).toBeUndefined();
	});

	it("shows failure reason in the activity column", () => {
		const info = sub("failed", { progress: { retryFailure: { attempt: 3, errorMessage: "429" } } as never });
		expect(activityText(info, undefined, "failed")).toEqual({ text: "429", error: true });
		expect(activityText(sub("failed"), undefined, "failed").text).toBe("执行失败");
	});
});

import { cleanTitle, roleTone, statusSummary, subagentTitle } from "./subagentTree";

describe("titles and summary", () => {
	it("cleans markdown header noise", () => {
		expect(cleanTitle("# Target 只读分析 `/Users/a/b/` 下的源码。 # Goal x")).toBe("只读分析 b 下的源码");
		expect(cleanTitle("Complete assignment thoroughly: ## Goal\nFind the bug. Then more")).toBe("Find the bug");
		expect(cleanTitle("")).toBe("");
	});
	it("prefers description, falls back to id", () => {
		expect(subagentTitle("A", { status: "running", label: "A", description: "做事" }, undefined)).toBe("做事");
		expect(subagentTitle("A", { status: "running", label: "A" }, undefined)).toBe("A");
	});
	it("tones roles", () => {
		expect(roleTone("scout")).toBe("scout");
		expect(roleTone("reviewer")).toBe("reviewer");
		expect(roleTone("task")).toBe("task");
		expect(roleTone("x")).toBe("other");
	});
	it("summarises without redundancy", () => {
		expect(statusSummary({ running: 3, done: 4, failed: 0 })).toEqual({ mode: "running", running: 3, queued: 0, progress: "4/7" });
		expect(statusSummary({ running: 1, queued: 1, done: 14, failed: 0 })).toEqual({ mode: "running", running: 1, queued: 1, progress: "14/16" });
		expect(statusSummary({ running: 0, queued: 2, done: 3, failed: 0 })).toEqual({ mode: "queued", queued: 2, progress: "3/5" });
		expect(statusSummary({ running: 0, done: 7, failed: 0 })).toEqual({ mode: "done", count: 7 });
		expect(statusSummary({ running: 0, done: 5, failed: 2 })).toEqual({ mode: "mixed", done: 5, failed: 2 });
	});
});
