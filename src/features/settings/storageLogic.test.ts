import { describe, expect, it } from "vitest";
import type { StorageProjectRow } from "../../lib/contracts";
import {
	calculateStorageBreakdown,
	collectDraftTexts,
	describeStorageError,
	parseStaleDays,
	selectableSessions,
	selectedBytes,
	sortProjects,
} from "./storageLogic";

const project: StorageProjectRow = {
	dir: "/s/p",
	name: "p",
	cwd: null,
	bytes: 600,
	sessions: [
		{ id: "a", title: "a", updatedAt: "", bytes: 300, pinned: false, skipReason: null },
		{ id: "b", title: "b", updatedAt: "", bytes: 200, pinned: true, skipReason: "已置顶" },
		{ id: "c", title: "c", updatedAt: "", bytes: 100, pinned: false, skipReason: null },
	],
};

describe("storageLogic", () => {
	it("parses the stale-days input", () => {
		expect(parseStaleDays("30")).toBe(30);
		expect(parseStaleDays("")).toBe(90);
		expect(parseStaleDays("0")).toBe(90);
		expect(parseStaleDays("99999")).toBe(3650);
	});
	it("only offers deletable sessions and sums the selection", () => {
		expect(selectableSessions(project).map((s) => s.id)).toEqual(["a", "c"]);
		expect(selectedBytes(project, new Set(["a", "c"]))).toBe(400);
	});
	it("explains a missing backend command", () => {
		expect(describeStorageError("Command storage_overview not found")).toBe("此功能需要重启应用后才能使用");
		expect(describeStorageError(new Error("boom"))).toBe("boom");
	});
	it("collects composer state and localStorage values as draft texts", () => {
		const store = new Map([["k", "draft with x.png"]]);
		const storage = {
			length: store.size,
			key: (i: number) => [...store.keys()][i] ?? null,
			getItem: (k: string) => store.get(k) ?? null,
		};
		const texts = collectDraftTexts({ drafts: { s: "hi" }, images: { s: [{ path: "/a/b.png" }] } }, storage);
		const all = texts.join("\n");
		expect(all).toContain("hi");
		expect(all).toContain("/a/b.png");
		expect(all).toContain("x.png");
	});
	it("calculates storage breakdown percentages correctly", () => {
		const breakdown = calculateStorageBreakdown(
			{ images: { bytes: 200 }, webCacheBytes: 100, dbBytes: 100, status: { bytes: 100 } },
			{ totalBytes: 500 },
		);
		expect(breakdown).not.toBeNull();
		expect(breakdown?.totalBytes).toBe(1000);
		expect(breakdown?.categories.find((c) => c.key === "sessions")?.percent).toBe(50);
		expect(breakdown?.categories.find((c) => c.key === "images")?.percent).toBe(20);
	});
	it("sorts projects by bytes descending or name", () => {
		const p1 = { ...project, bytes: 100, name: "b" };
		const p2 = { ...project, bytes: 500, name: "a" };
		const sortedBytes = sortProjects([p1, p2], "bytesDesc");
		expect(sortedBytes[0].name).toBe("a");
		const sortedName = sortProjects([p1, p2], "nameAsc");
		expect(sortedName[0].name).toBe("a");
	});
});
