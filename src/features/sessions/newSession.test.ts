import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { installDraftAutoCleanup } from "./newSession";
import { resolveNewSessionTargetWorkspace } from "./modes";

vi.mock("../../lib/ipc", () => ({
	deleteSession: vi.fn().mockResolvedValue(undefined),
	gitSummary: vi.fn().mockResolvedValue({ isRepo: false }),
	gitCreateWorktree: vi.fn(),
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
