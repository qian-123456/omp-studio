// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogItem, SpaceMode, Workspace } from "../../lib/contracts";

const ipc = vi.hoisted(() => ({
	listWorkspaces: vi.fn<() => Promise<Workspace[]>>(),
	backlogUpdate: vi.fn(), backlogList: vi.fn(),
	rpcStart: vi.fn(), rpcSend: vi.fn(), dispatchPrompt: vi.fn(), backlogBuildPrompt: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ipc);
vi.mock("../../lib/events", () => ({ onBacklogChanged: async () => () => {} }));

import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { tNow } from "../../stores/language";
import { usePendingSession } from "../sessions/pendingSession";
import { useSidebarStore } from "../sessions/sidebarStore";
import { useBacklog } from "./backlogStore";
import { resetPendingFills } from "./fillComposer";
import { openIdeasInDrafts } from "./openIdeasInDrafts";

const idea = (id: string, projectDir: string | null, text = id, patch: Partial<BacklogItem> = {}): BacklogItem => ({
	id, text, projectDir, kind: "idea", status: "inbox", refs: [], targetSessionId: null,
	createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", deletedAt: null, ...patch,
});
const globalWorkspace = { id: "global", path: "/global", kind: "global", mode: "chat", name: "Global", sort: 0 } as Workspace;
const composerMethods = {
	setDraft: useComposer.getState().setDraft,
	focusComposer: useComposer.getState().focusComposer,
};

beforeEach(() => {
	vi.clearAllMocks();
	ipc.listWorkspaces.mockReset().mockResolvedValue([globalWorkspace]);
	localStorage.clear();
	resetPendingFills();
	useComposer.setState({ ...composerMethods, drafts: {}, images: {}, files: {}, annotations: {}, focusNonce: {}, history: [] });
	usePendingSession.setState({ drafts: {}, selectedId: null });
	useSessions.setState({ sessions: {}, workspaces: [] });
	useUi.setState({ selectedSessionId: "source", selectedIds: new Set(["source"]), centerView: "session" });
	useSidebarStore.setState({ activeMode: "code" });
	useBacklog.setState({ items: [], editBuffer: null });
});

afterEach(() => {
	vi.restoreAllMocks();
	useComposer.setState(composerMethods);
	resetPendingFills();
	// Preparing drafts must never start/send or write delivery state, including failure paths.
	for (const forbidden of [ipc.rpcStart, ipc.rpcSend, ipc.dispatchPrompt, ipc.backlogBuildPrompt, ipc.backlogUpdate]) {
		expect(forbidden).not.toHaveBeenCalled();
	}
});

describe("openIdeasInDrafts", () => {
	it("does nothing for an empty selection", async () => {
		expect(await openIdeasInDrafts([], null)).toEqual({ draftIds: [], error: null });
		expect(usePendingSession.getState().drafts).toEqual({});
		expect(useUi.getState().selectedSessionId).toBe("source");
		expect(ipc.listWorkspaces).not.toHaveBeenCalled();
	});

	it("combines a project's ideas into a real editable batch draft without updating the source", async () => {
		const items = [idea("first", "/alpha", "Improve search"), idea("second", "/alpha", "Fix focus", { kind: "bug" })];
		useBacklog.setState({ items });
		const result = await openIdeasInDrafts(items, "/current");
		expect(result.error).toBeNull();
		expect(result.draftIds).toHaveLength(1);
		const [id] = result.draftIds;
		expect(usePendingSession.getState().drafts[id]).toMatchObject({ cwd: "/alpha", mode: "code", groupId: null });
		expect(useComposer.getState().drafts[id]).toBe("以下是 2 个待处理问题（缺陷/想法），请逐条处理：\n\n1. 【想法】Improve search\n2. 【缺陷】Fix focus");
		expect(usePendingSession.getState().selectedId).toBe(id);
		expect(useUi.getState()).toMatchObject({ selectedSessionId: null, centerView: "session", highlightId: id });
		expect(useUi.getState().selectedIds).toEqual(new Set([id]));
		expect(useComposer.getState().focusNonce[id]).toBeGreaterThan(0);
		expect(useBacklog.getState().items).toEqual(items);
		expect(ipc.listWorkspaces).not.toHaveBeenCalled();
	});

	it("prepares every project in first-appearance order, isolates text/images, and focuses the first last", async () => {
		const focus = vi.spyOn(useComposer.getState(), "focusComposer");
		const result = await openIdeasInDrafts([
			idea("b1", "/beta", "Beta [图片: /beta.png]"),
			idea("a1", "/alpha", "Alpha", { refs: [{ kind: "image", path: "/alpha.png", sessionId: null, text: null, lines: null }] }),
			idea("b2", "/beta", "More beta"),
		], null);
		expect(result.error).toBeNull();
		expect(result.draftIds).toHaveLength(2);
		const [beta, alpha] = result.draftIds;
		expect(result.draftIds.map((id) => usePendingSession.getState().drafts[id].cwd)).toEqual(["/beta", "/alpha"]);
		expect(useComposer.getState().drafts[beta]).toContain("1. 【想法】Beta 🖼️#1");
		expect(useComposer.getState().drafts[beta]).toContain("2. 【想法】More beta");
		expect(useComposer.getState().drafts[beta]).not.toContain("Alpha");
		expect(useComposer.getState().drafts[alpha]).toBe("Alpha 🖼️#1");
		expect(useComposer.getState().images[beta].map((image) => image.path)).toEqual(["/beta.png"]);
		expect(useComposer.getState().images[alpha].map((image) => image.path)).toEqual(["/alpha.png"]);
		expect(usePendingSession.getState().selectedId).toBe(beta);
		expect(focus).toHaveBeenLastCalledWith(beta);
	});

	it("preserves existing real and local drafts and attachments, including attachment-only local drafts", async () => {
		useComposer.getState().setDraft("source", "Unsent current text");
		useComposer.getState().addImage("source", "/source.png");
		const old = usePendingSession.getState().open({ cwd: "/alpha", mode: "code" });
		useComposer.getState().setDraft(old, "Unsent local text");
		useComposer.getState().addImage(old, "/old.png");
		const attachmentOnly = usePendingSession.getState().open({ cwd: "/alpha", mode: "code" });
		useComposer.getState().addFile(attachmentOnly, "/notes.txt");
		const result = await openIdeasInDrafts([idea("new", "/alpha", "New [图片: /new.png]")], null);
		const [id] = result.draftIds;
		expect(id).not.toBe(old);
		expect(id).not.toBe(attachmentOnly);
		expect(useComposer.getState().drafts.source).toBe("Unsent current text");
		expect(useComposer.getState().images.source.map((image) => image.path)).toEqual(["/source.png"]);
		expect(useComposer.getState().drafts[old]).toBe("Unsent local text");
		expect(useComposer.getState().images[old].map((image) => image.path)).toEqual(["/old.png"]);
		expect(useComposer.getState().files[attachmentOnly].map((file) => file.path)).toEqual(["/notes.txt"]);
		expect(useComposer.getState().drafts[id]).toBe("New 🖼️#1");
		expect(useComposer.getState().images[id].map((image) => image.path)).toEqual(["/new.png"]);
	});

	it("reuses image slots for repeated inline/ref images without expanding non-image references", async () => {
		const result = await openIdeasInDrafts([idea("one", "/alpha", "Review [图片: /same.png] [图片: /same.png]", {
			refs: [
				{ kind: "image", path: "/same.png", sessionId: null, text: null, lines: null },
				{ kind: "file", path: "/secret.ts", sessionId: null, text: "Do not expand this reference", lines: "1-20" },
			],
		})], null);
		const [id] = result.draftIds;
		expect(result.error).toBeNull();
		expect(useComposer.getState().drafts[id]).toBe("Review 🖼️#1 🖼️#1");
		expect(useComposer.getState().images[id].map((image) => image.path)).toEqual(["/same.png"]);
		expect(useComposer.getState().files[id]).toBeUndefined();
	});

	it("never substitutes an arbitrary workspace when chat has no global directory", async () => {
		useSidebarStore.setState({ activeMode: "chat" });
		ipc.listWorkspaces.mockResolvedValueOnce([{ ...globalWorkspace, id: "other", path: "/other", kind: "project" }]);
		const result = await openIdeasInDrafts([idea("global", null)], null);
		expect(result).toEqual({ draftIds: [], error: tNow("backlog.noProjectDirInMode") });
		expect(usePendingSession.getState().drafts).toEqual({});
		expect(ipc.listWorkspaces).toHaveBeenCalledTimes(1);
	});

	it("reuses a blank matching draft but never one with a different mode", async () => {
		const differentMode = usePendingSession.getState().open({ cwd: "/alpha", mode: "work" });
		const blank = usePendingSession.getState().open({ cwd: "/alpha", mode: "code" });
		const result = await openIdeasInDrafts([idea("one", "/alpha")], null);
		expect(result).toEqual({ draftIds: [blank], error: null });
		expect(useComposer.getState().drafts[blank]).toBe("one");
		expect(useComposer.getState().drafts[differentMode]).toBeUndefined();
	});

	it("resolves current/global directories once in chat mode and uses code for project directories", async () => {
		useSidebarStore.setState({ activeMode: "chat" });
		const result = await openIdeasInDrafts([idea("global", null), idea("project", "/project")], null);
		expect(result.error).toBeNull();
		expect(result.draftIds.map((id) => {
			const { cwd, mode } = usePendingSession.getState().drafts[id];
			return { cwd, mode };
		})).toEqual([{ cwd: "/global", mode: "chat" }, { cwd: "/project", mode: "code" }]);
		expect(ipc.listWorkspaces).toHaveBeenCalledTimes(1);
	});

	it.each<SpaceMode>(["code", "work", "study", "research", "chat"])("uses the current project fallback in %s mode", async (mode) => {
		useSidebarStore.setState({ activeMode: mode });
		const result = await openIdeasInDrafts([idea("global", null)], "/current");
		expect(usePendingSession.getState().drafts[result.draftIds[0]]).toMatchObject({ cwd: "/current", mode: mode === "chat" ? "code" : mode });
	});

	it.each([null, "", "   "])("resolves all groups before creating any draft when the current directory is %j", async (current) => {
		const result = await openIdeasInDrafts([idea("valid", "/alpha"), idea("missing", null)], current);
		expect(result).toEqual({ draftIds: [], error: tNow("backlog.noProjectDirInMode") });
		expect(usePendingSession.getState().drafts).toEqual({});
		expect(useUi.getState().selectedSessionId).toBe("source");
	});

	it("rejects a blank item directory rather than silently choosing the current project", async () => {
		const result = await openIdeasInDrafts([idea("blank", "  ")], "/current");
		expect(result.error).toBe(tNow("backlog.noProjectDirInMode"));
		expect(usePendingSession.getState().drafts).toEqual({});
	});

	it("keeps the complete workspace-read error and creates nothing", async () => {
		useSidebarStore.setState({ activeMode: "chat" });
		ipc.listWorkspaces.mockRejectedValueOnce(new Error("Workspace read failed\npermission denied: /private/workspaces"));
		const result = await openIdeasInDrafts([idea("one", "/alpha")], null);
		expect(result).toEqual({ draftIds: [], error: "Workspace read failed\npermission denied: /private/workspaces" });
		expect(usePendingSession.getState().drafts).toEqual({});
		expect(useUi.getState().selectedSessionId).toBe("source");
	});

	it("stops on a partial prefill failure, preserves prepared content and source selection, and never retries", async () => {
		const previous = usePendingSession.getState().open({ cwd: "/source", mode: "code" });
		useComposer.getState().setDraft(previous, "Keep source input");
		useUi.setState({ selectedSessionId: null, highlightId: previous });
		const items = [idea("a", "/alpha"), idea("b", "/beta"), idea("c", "/gamma")];
		useBacklog.setState({ items });
		const original = useComposer.getState().setDraft;
		const setDraft = vi.spyOn(useComposer.getState(), "setDraft").mockImplementation((id, text) => {
			original(id, text);
			if (text === "b") throw new Error("Prefill failed\nfull detail");
		});
		const result = await openIdeasInDrafts(items, null);
		expect(result.draftIds).toHaveLength(1);
		expect(useComposer.getState().drafts[result.draftIds[0]]).toBe("a");
		expect(Object.values(usePendingSession.getState().drafts).map((draft) => draft.cwd)).toEqual(["/source", "/alpha", "/beta"]);
		expect(Object.values(useComposer.getState().drafts)).toContain("b");
		expect(result.error).toContain("1");
		expect(result.error).toContain("Prefill failed\nfull detail");
		expect(setDraft).toHaveBeenCalledTimes(2);
		expect(usePendingSession.getState().selectedId).toBe(previous);
		expect(useUi.getState().highlightId).toBe(previous);
		expect(useComposer.getState().drafts[previous]).toBe("Keep source input");
		expect(useBacklog.getState().items).toEqual(items);
	});
});
