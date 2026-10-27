import { describe, expect, it } from "vitest";
import {
	buildCreatePayload,
	buildDispatch,
	buildEditPatch,
	captureError,
	commonProjectDir,
	filterIdeas,
	groupIdeas,
	mergeItems,
	tabCounts,
} from "./ideas";
import type { Idea } from "./ideas";

const mk = (id: string, status: Idea["status"], projectDir: string | null = null): Idea => ({
	id,
	text: id,
	kind: "idea",
	refs: [],
	status,
	targetSessionId: null,
	projectDir,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
});
const items = [mk("a", "inbox", "/p/zed"), mk("b", "dispatched", "/p/alpha"), mk("c", "done"), mk("d", "closed", "/p/alpha")];

describe("ideas filter", () => {
	it("splits active / done / all and counts them", () => {
		expect(filterIdeas(items, "active").map((i) => i.id)).toEqual(["a", "b"]);
		expect(filterIdeas(items, "done").map((i) => i.id)).toEqual(["c", "d"]);
		expect(filterIdeas(items, "all")).toHaveLength(4);
		expect(tabCounts(items)).toEqual({ active: 2, done: 2, all: 4 });
	});

	it("groups current project first, others by name, global last", () => {
		const g = groupIdeas(items, "/p/zed");
		expect(g.map((x) => x.label)).toEqual(["zed", "alpha", "全局"]);
		expect(g[0]?.current).toBe(true);
	});
});

describe("ideas payloads", () => {
	it("builds create payload with optional project and session link", () => {
		expect(buildCreatePayload({ text: " hi ", kind: "bug", imagePaths: ["/i/1.png"] })).toEqual({
			text: "hi",
			kind: "bug",
			imagePaths: ["/i/1.png"],
		});
		expect(buildCreatePayload({ text: "x", kind: "idea", imagePaths: [], projectDir: "/p", linkSessionId: "s" })).toEqual({
			text: "x",
			kind: "idea",
			imagePaths: [],
			projectDir: "/p",
			sessionIds: ["s"],
		});
	});

	it("requires text or an image", () => {
		expect(captureError("  ", 0)).not.toBeNull();
		expect(captureError("", 1)).toBeNull();
	});

	it("patches only changed fields", () => {
		const it = mk("a", "inbox");
		expect(buildEditPatch(it, " a ", "idea")).toEqual({});
		expect(buildEditPatch(it, "b", "bug")).toEqual({ text: "b", kind: "bug" });
	});

	it("dispatches singles and batches to new or existing sessions", () => {
		expect(buildDispatch(["a b"], "", "/p")).toEqual({ path: "/ideas/a%20b/dispatch", body: { cwd: "/p" } });
		expect(buildDispatch(["a"], "s1", "/p")).toEqual({ path: "/ideas/a/dispatch", body: { sessionId: "s1" } });
		expect(buildDispatch(["a", "b"], "", null)).toEqual({ path: "/ideas/dispatch", body: { ids: ["a", "b"] } });
	});

	it("uses a cwd only when all selected ideas share one project", () => {
		expect(commonProjectDir(items, ["b", "d"])).toBe("/p/alpha");
		expect(commonProjectDir(items, ["a", "b"])).toBeNull();
		expect(commonProjectDir(items, ["c"])).toBeNull();
	});

	it("merges server copies by id", () => {
		const merged = mergeItems(items, [{ ...mk("a", "dispatched", "/p/zed"), text: "new" }]);
		expect(merged[0]?.status).toBe("dispatched");
		expect(merged).toHaveLength(4);
	});
});
