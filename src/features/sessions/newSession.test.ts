import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { installDraftAutoCleanup, startSessionInDir } from "./newSession";
import { usePendingSession } from "./pendingSession";
import { resolveNewSessionTargetWorkspace } from "./modes";
import { useSidebarStore } from "./sidebarStore";
import { useSessionGroups } from "./sessionGroups";
import { toast } from "../../lib/toast";

vi.mock("../../lib/ipc", () => ({
	deleteSession: vi.fn().mockResolvedValue(undefined),
	gitSummary: vi.fn().mockResolvedValue({ isRepo: false }),
	gitCreateWorktree: vi.fn(),
	setSessionGroup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/toast", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

function makeSession(partial: Partial<SessionMeta>): SessionMeta {
	return {
		id: partial.id || "test-id",
		tool: "omp",
		file: "/tmp/s1.jsonl",
		cwd: partial.cwd || "/repo/my-proj",
		title: partial.title ?? "",
		label: partial.label ?? "",
		createdAt: "2026-09-28T12:00:00Z",
		updatedAt: "2026-09-28T12:00:00Z",
		archived: false,
		pinned: false,
		workspaceId: null,
		parentId: null,
		forkDepth: 0,
		status: "idle",
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention: null,
		mode: partial.mode ?? "code",
		groupId: partial.groupId ?? null,
		...partial,
	};
}

function makeWs(partial: Partial<Workspace> & { id: string }): Workspace {
	return {
		path: `/repo/${partial.id}`,
		name: partial.id,
		kind: "project",
		sort: 0,
		mode: partial.mode ?? "code",
		...partial,
	};
}

describe("resolveNewSessionTargetWorkspace", () => {
	const chatGlobal = makeWs({
		id: "global",
		name: "全局",
		kind: "global",
		sort: 9,
		mode: "chat",
	});
	const alpha = makeWs({ id: "alpha", name: "Alpha", sort: 2 });
	const beta = makeWs({ id: "beta", name: "Beta", sort: 1 });
	const workProj = makeWs({ id: "wproj", name: "Work Proj", sort: 0, mode: "work" });
	const workspaces = [alpha, chatGlobal, beta, workProj];

	it("targets the project of the selected session within the active mode", () => {
		const sessions = [makeSession({ id: "s1", workspaceId: "alpha" })];
		expect(
			resolveNewSessionTargetWorkspace("code", "s1", sessions, workspaces),
		).toBe(alpha);
	});

	it("targets the most recently updated session's project when nothing is selected", () => {
		const sessions = [
			makeSession({
				id: "old",
				workspaceId: "alpha",
				updatedAt: "2026-09-27T00:00:00Z",
			}),
			makeSession({
				id: "new",
				workspaceId: "beta",
				updatedAt: "2026-09-29T00:00:00Z",
			}),
		];
		expect(resolveNewSessionTargetWorkspace("code", null, sessions, workspaces)).toBe(
			beta,
		);
	});

	it("falls back to an in-mode project that has no sessions yet, never another mode's", () => {
		const sessions = [makeSession({ id: "w1", workspaceId: "wproj", mode: "work" })];
		const picked = resolveNewSessionTargetWorkspace("code", null, sessions, workspaces);
		expect(picked?.mode).toBe("code");
		expect(picked?.kind).toBe("project");
	});

	it("returns null in a project mode with no project at all (no global fallback)", () => {
		expect(resolveNewSessionTargetWorkspace("code", null, [], [chatGlobal, workProj])).toBeNull();
	});

	it("never leaks sessions or workspaces across modes", () => {
		const sessions = [
			makeSession({ id: "c1", workspaceId: "alpha", mode: "code" }),
			makeSession({ id: "w1", workspaceId: "wproj", mode: "work" }),
		];
		// Selected session belongs to another mode → ignored.
		expect(
			resolveNewSessionTargetWorkspace("work", "c1", sessions, workspaces),
		).toBe(workProj);
		expect(resolveNewSessionTargetWorkspace("work", null, sessions, workspaces)).toBe(
			workProj,
		);
		// Work sessions are invisible to the code space.
		expect(resolveNewSessionTargetWorkspace("code", "w1", sessions, workspaces)).toBe(
			alpha,
		);
	});

	it("通用对话 targets the global row; project modes never fall back to it", () => {
		expect(resolveNewSessionTargetWorkspace("chat", null, [], workspaces)).toBe(
			chatGlobal,
		);
		// Even with a selected project session, chat ignores projects.
		const sessions = [makeSession({ id: "s1", workspaceId: "alpha" })];
		expect(resolveNewSessionTargetWorkspace("chat", "s1", sessions, workspaces)).toBe(
			chatGlobal,
		);
		expect(resolveNewSessionTargetWorkspace("study", null, [], workspaces)).toBeNull();
	});

	it("returns null when the mode has no workspaces at all", () => {
		expect(resolveNewSessionTargetWorkspace("code", null, [], [])).toBeNull();
	});
});

describe("installDraftAutoCleanup", () => {
	let cleanup: () => void;

	beforeEach(() => {
		vi.clearAllMocks();
		useSessions.setState({ sessions: {}, workspaces: [] });
		useLive.setState({ sessions: {} });
		useComposer.setState({ drafts: {}, images: {} });
		useUi.setState({ selectedSessionId: null });
		cleanup = installDraftAutoCleanup();
	});

	afterEach(() => {
		cleanup();
	});

	it("removes a completely empty draft when switching away", () => {
		const draftId = "draft-empty";
		const otherId = "other-sess";

		useSessions.setState({
			sessions: {
				[draftId]: makeSession({ id: draftId, title: "", label: "" }),
				[otherId]: makeSession({ id: otherId, title: "Other", label: "#1" }),
			},
		});

		useUi.setState({ selectedSessionId: draftId });
		expect(useSessions.getState().sessions[draftId]).toBeDefined();

		// Switch to another session
		useUi.setState({ selectedSessionId: otherId });

		// Empty draft should have been purged
		expect(useSessions.getState().sessions[draftId]).toBeUndefined();
		expect(ipc.deleteSession).toHaveBeenCalledWith(draftId);
	});

	it("preserves a draft that has typed text when switching away", () => {
		const draftId = "draft-with-text";
		const otherId = "other-sess";

		useSessions.setState({
			sessions: {
				[draftId]: makeSession({ id: draftId, title: "", label: "" }),
				[otherId]: makeSession({ id: otherId, title: "Other", label: "#1" }),
			},
		});

		useComposer.getState().setDraft(draftId, "Here is some drafted prompt");
		useUi.setState({ selectedSessionId: draftId });

		// Switch away
		useUi.setState({ selectedSessionId: otherId });

		// Draft with text must survive
		expect(useSessions.getState().sessions[draftId]).toBeDefined();
		expect(ipc.deleteSession).not.toHaveBeenCalledWith(draftId);
	});

	it("preserves a draft that has attached images when switching away", () => {
		const draftId = "draft-with-img";
		const otherId = "other-sess";

		useSessions.setState({
			sessions: {
				[draftId]: makeSession({ id: draftId, title: "", label: "" }),
				[otherId]: makeSession({ id: otherId, title: "Other", label: "#1" }),
			},
		});

		useComposer.getState().addImage(draftId, "/path/to/img.png", "img.png");
		useUi.setState({ selectedSessionId: draftId });

		// Switch away
		useUi.setState({ selectedSessionId: otherId });

		// Draft with image must survive
		expect(useSessions.getState().sessions[draftId]).toBeDefined();
		expect(ipc.deleteSession).not.toHaveBeenCalledWith(draftId);
	});

	it("never deletes normal sessions with titles", () => {
		const regularId = "regular-sess";
		const otherId = "other-sess";

		useSessions.setState({
			sessions: {
				[regularId]: makeSession({ id: regularId, title: "Existing Session", label: "#1" }),
				[otherId]: makeSession({ id: otherId, title: "Other", label: "#2" }),
			},
		});

		useUi.setState({ selectedSessionId: regularId });
		useUi.setState({ selectedSessionId: otherId });

		expect(useSessions.getState().sessions[regularId]).toBeDefined();
		expect(ipc.deleteSession).not.toHaveBeenCalled();
	});
});

describe("startSessionInDir with groupId", () => {
	const chatGlobal = makeWs({
		id: "global",
		name: "全局",
		kind: "global",
		sort: 9,
		mode: "chat",
		path: "/global",
	});

	beforeEach(() => {
		vi.clearAllMocks();
		useSessions.setState({ sessions: {}, workspaces: [chatGlobal] });
		useLive.setState({ sessions: {} });
		useComposer.setState({ drafts: {}, images: {} });
		useSidebarStore.setState({ groupOpen: {} });
		useSessionGroups.setState({
			groups: [{ id: "g_omp", name: "omp相关", mode: "chat", sort: 0 }],
		});
	});

	it("adopts an existing empty draft into the target group, expands group and shows toast", async () => {
		const draft = makeSession({
			id: "draft-1",
			cwd: "/global",
			mode: "chat",
			status: "idle",
			live: true,
			title: "",
			label: "",
			groupId: null,
		});
		useSessions.setState({ sessions: { [draft.id]: draft } });

		await startSessionInDir(chatGlobal, false, "g_omp");

		expect(ipc.setSessionGroup).toHaveBeenCalledWith("draft-1", "g_omp");
		expect(useSessions.getState().sessions["draft-1"].groupId).toBe("g_omp");
		expect(useSidebarStore.getState().groupOpen["grp:g_omp"]).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe("draft-1");
		expect(toast.success).toHaveBeenCalledWith("已在分组「omp相关」新建会话");
	});
});

describe("startSessionInDir local drafts", () => {
	const ws = makeWs({ id: "p1", name: "proj", kind: "project", mode: "code", path: "/repo/proj" });

	beforeEach(() => {
		vi.clearAllMocks();
		useSessions.setState({ sessions: {}, workspaces: [ws] });
		useLive.setState({ sessions: {} });
		useComposer.setState({ drafts: {}, images: {}, files: {}, annotations: {} });
		usePendingSession.setState({ drafts: {}, selectedId: null });
		useUi.setState({ selectedSessionId: null, centerView: "home" });
	});

	it("opens one local draft and reuses it for repeated new-session clicks", async () => {
		await startSessionInDir(ws, false);
		await startSessionInDir(ws, false);
		await startSessionInDir(ws, false);
		const { drafts, selectedId } = usePendingSession.getState();
		expect(Object.keys(drafts)).toHaveLength(1);
		expect(selectedId).toBe(Object.keys(drafts)[0]);
		expect(drafts[selectedId as string].sessionId).toBeNull();
		expect(useUi.getState().selectedSessionId).toBeNull();
		expect(useUi.getState().centerView).toBe("session");
	});

	it("starts a second draft once the first one holds input", async () => {
		await startSessionInDir(ws, false);
		const first = usePendingSession.getState().selectedId as string;
		useComposer.getState().setDraft(first, "typed");
		await startSessionInDir(ws, false);
		expect(Object.keys(usePendingSession.getState().drafts)).toHaveLength(2);
		expect(usePendingSession.getState().selectedId).not.toBe(first);
	});

	it("reuses an existing empty real session instead of creating a draft", async () => {
		const empty = makeSession({ id: "empty-1", cwd: "/repo/proj", mode: "code", live: true });
		useSessions.setState({ sessions: { [empty.id]: empty } });
		await startSessionInDir(ws, false);
		expect(useUi.getState().selectedSessionId).toBe("empty-1");
		expect(Object.keys(usePendingSession.getState().drafts)).toHaveLength(0);
	});
});
