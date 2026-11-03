// @vitest-environment jsdom
/** Mobile conversation-tree: pure sibling grouping + the controller actions
 * (edit-&-resend draft flow, version switching, cancel, busy refusal). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
vi.mock("../../core/api", async (orig) => {
	const real = await orig<typeof import("../../core/api")>();
	return { ...real, api: (...a: unknown[]) => apiMock(...a), upload: vi.fn() };
});
const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../../ui", async (orig) => {
	const real = await orig<typeof import("../../ui")>();
	return { ...real, toast: h.toast };
});

import type { Item } from "../../core/types";
import { ChatController } from "./chatStore";
import { filterToLeafPath, treeVersions } from "./lib/tree";

function row(id: string, parentId: string | null, kind: string): Item {
	return { id, parentId, role: kind === "user" ? "user" : kind === "assistant" ? "assistant" : "system", kind, text: id, thinking: "", tools: [], images: [], ts: null, streaming: false };
}

/** u1 → a1; sibling branch u2 → a2; both under root. */
function branched(): Item[] {
	return [row("root", null, "custom"), row("u1", "root", "user"), row("a1", "u1", "assistant"), row("u2", "root", "user"), row("a2", "u2", "assistant")];
}

beforeEach(() => {
	apiMock.mockReset();
	apiMock.mockResolvedValue({});
	h.toast.mockReset();
});

describe("filterToLeafPath (mobile Items)", () => {
	it("keeps only the root→leaf path", () => {
		expect(filterToLeafPath(branched(), "a2").map((i) => i.id)).toEqual(["root", "u2", "a2"]);
	});
	it("renders unfiltered without a known leaf", () => {
		expect(filterToLeafPath(branched(), null)).toHaveLength(5);
	});
});

describe("treeVersions", () => {
	it("groups same-kind siblings and locates the on-path one", () => {
		// The user entries are the sibling group here; assistants have no siblings.
		expect(treeVersions(branched(), "a1", "u1")).toEqual({ index: 0, total: 2, ids: ["u1", "u2"] });
		expect(treeVersions(branched(), "a2", "u2")).toEqual({ index: 1, total: 2, ids: ["u1", "u2"] });
		expect(treeVersions(branched(), "a1", "a1")).toBeNull();
	});
	it("returns null without siblings or when rewound past the entry", () => {
		expect(treeVersions(branched(), "a1", "root")).toBeNull();
		expect(treeVersions(branched(), "root", "u1")).toBeNull();
	});
});

describe("ChatController tree actions", () => {
	it("editResendFromTree fills the composer, arms the banner and refetches", async () => {
		const c = new ChatController("s1");
		apiMock.mockImplementation(async (_m: string, path: string) =>
			path.endsWith("/navigate-tree") ? { cancelled: true, editorText: "原话" } : path.endsWith("/tree") ? { leafId: "root" } : {},
		);
		c.store.setState({ working: false, transcript: { ...c.state.transcript, items: branched() } });
		c.composer = { get: () => "", set: vi.fn(), focus: vi.fn() };
		await c.editResendFromTree("u1", "fallback");
		// A user target rewinds past itself: optimistic leaf = its parent.
		expect(c.state.treeEdit).toEqual({ entryId: "u1", prevLeafId: null });
		expect(c.state.leafId).toBe("root");
		expect(c.composer?.set).toHaveBeenCalledWith("原话", true);
		// Composer banner renders the restart wording.
	});

	it("refuses with a toast while the session is working", async () => {
		const c = new ChatController("s1");
		c.store.setState({ working: true });
		await c.editResendFromTree("u1", "x");
		await c.switchTreeVersion("a2");
		expect(apiMock).not.toHaveBeenCalled();
		expect(h.toast).toHaveBeenCalledTimes(2);
		expect(h.toast.mock.calls[0][0]).toContain("当前正在回答");
	});

	it("switchTreeVersion navigates and clears the banner", async () => {
		const c = new ChatController("s1");
		apiMock.mockResolvedValue({});
		c.store.setState({ treeEdit: { entryId: "u1", prevLeafId: "root" } });
		await c.switchTreeVersion("a2");
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/navigate-tree", { entryId: "a2" });
		expect(c.state.treeEdit).toBeNull();
		expect(c.state.leafId).toBe("a2");
	});

	it("cancelTreeEdit walks the leaf back", async () => {
		const c = new ChatController("s1");
		apiMock.mockResolvedValue({});
		c.store.setState({ treeEdit: { entryId: "u1", prevLeafId: "old-leaf" } });
		await c.cancelTreeEdit();
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/navigate-tree", { entryId: "old-leaf" });
		expect(c.state.treeEdit).toBeNull();
		expect(c.state.leafId).toBe("old-leaf");
	});

	it("a send clears the banner without extra navigation", async () => {
		const c = new ChatController("s1");
		apiMock.mockImplementation(async (_m: string, path: string) =>
			path.endsWith("/prompt-ex") ? {} : path.endsWith("/composer-state") ? { streaming: false } : {},
		);
		c.store.setState({ treeEdit: { entryId: "u1", prevLeafId: "root" }, atts: [] });
		c.composer = { get: () => "edited", set: vi.fn(), focus: vi.fn(), clear: vi.fn() };
		await c.send("edited", "followUp");
		expect(c.state.treeEdit).toBeNull();
	});
});
