import { describe, expect, it } from "vitest";
import type { StorageProjectRow } from "../../lib/contracts";
import {
	collectDraftTexts,
	describeStorageError,
	parseStaleDays,
	selectableSessions,
	selectedBytes,
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
});
