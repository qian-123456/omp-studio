import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { installDraftAutoCleanup } from "./newSession";

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
		...partial,
	};
}

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
