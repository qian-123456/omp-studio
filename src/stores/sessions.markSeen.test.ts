// @vitest-environment jsdom
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../lib/contracts";
import { markSeen } from "../lib/ipc";
import { useSessions } from "./sessions";
import { useUi } from "./ui";

vi.mock("../lib/events", () => ({
	onSessionsUpdated: vi.fn(),
	onSessionsRemoved: vi.fn(),
	onSessionForked: vi.fn(async () => vi.fn()),
}));

vi.mock("../lib/ipc", () => ({
	listSessions: vi.fn(),
	listWorkspaces: vi.fn(),
	markSeen: vi.fn(async () => undefined),
}));

function make(id: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		id,
		tool: "omp",
		file: `/tmp/${id}.jsonl`,
		cwd: "/t",
		title: id,
		label: id,
		createdAt: "2026-09-24T00:00:00.000Z",
		updatedAt: "2026-09-24T00:00:00.000Z",
		parentId: null,
		forkDepth: 0,
		status: "idle",
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		pinned: false,
		archived: false,
		workspaceId: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention: null,
		mode: "code",
		groupId: null,
		...overrides,
	} as SessionMeta;
}

function setForeground(on: boolean) {
	vi.spyOn(document, "hasFocus").mockReturnValue(on);
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => (on ? "visible" : "hidden"),
	});
}

const markSeenMock = markSeen as unknown as Mock;

describe("mark session seen", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		markSeenMock.mockClear();
		setForeground(true);
		useUi.setState({ selectedSessionId: null, centerView: "home" });
		useSessions.setState({ sessions: {} });
	});
	afterEach(() => {
		useUi.setState({ selectedSessionId: null, centerView: "home" });
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("clears unread and review immediately after selecting (no 2s dwell)", async () => {
		useSessions.getState().upsert([
			make("a", { unread: true }),
			make("b", { status: "review", pending: "review", unread: true }),
		]);
		useUi.getState().selectSession("a");
		await vi.advanceTimersByTimeAsync(60);
		expect(useSessions.getState().sessions.a.unread).toBe(false);
		useUi.getState().selectSession("b");
		await vi.advanceTimersByTimeAsync(60);
		const b = useSessions.getState().sessions.b;
		expect(b.unread).toBe(false);
		expect(b.status).toBe("idle");
		expect(b.pending).toBeNull();
		expect(markSeenMock).toHaveBeenCalledTimes(2);
	});

	it("keeps non-review pending (error) when clearing unread", async () => {
		useSessions.getState().upsert([make("e", { status: "error", pending: "error", unread: true })]);
		useUi.getState().selectSession("e");
		await vi.advanceTimersByTimeAsync(60);
		const e = useSessions.getState().sessions.e;
		expect(e.unread).toBe(false);
		expect(e.status).toBe("error");
		expect(e.pending).toBe("error");
	});

	it("clears a cue that arrives while the session is already selected (foreground)", async () => {
		useSessions.getState().upsert([make("a")]);
		useUi.getState().selectSession("a");
		await vi.advanceTimersByTimeAsync(60);
		markSeenMock.mockClear();
		useSessions.getState().upsert([make("a", { status: "review", pending: "review", unread: true })]);
		await vi.advanceTimersByTimeAsync(60);
		const a = useSessions.getState().sessions.a;
		expect(a.unread).toBe(false);
		expect(a.pending).toBeNull();
		expect(markSeenMock).toHaveBeenCalledTimes(1);
	});

	it("retains the cue when a reply lands while the window is in the background", async () => {
		useSessions.getState().upsert([make("a")]);
		useUi.getState().selectSession("a");
		await vi.advanceTimersByTimeAsync(60);
		markSeenMock.mockClear();
		setForeground(false);
		useSessions.getState().upsert([make("a", { status: "review", pending: "review", unread: true })]);
		await vi.advanceTimersByTimeAsync(500);
		const a = useSessions.getState().sessions.a;
		expect(a.unread).toBe(true);
		expect(a.pending).toBe("review");
		expect(markSeenMock).not.toHaveBeenCalled();
		// Returning to the window clears it.
		setForeground(true);
		window.dispatchEvent(new Event("focus"));
		await vi.advanceTimersByTimeAsync(60);
		expect(useSessions.getState().sessions.a.unread).toBe(false);
		expect(markSeenMock).toHaveBeenCalledTimes(1);
	});

	it("only marks the final session during rapid selection changes", async () => {
		useSessions.getState().upsert([
			make("a", { unread: true }),
			make("b", { unread: true }),
			make("c", { unread: true }),
		]);
		useUi.getState().selectSession("a");
		useUi.getState().selectSession("b");
		useUi.getState().selectSession("c");
		await vi.advanceTimersByTimeAsync(60);
		const s = useSessions.getState().sessions;
		expect(s.a.unread).toBe(true);
		expect(s.b.unread).toBe(true);
		expect(s.c.unread).toBe(false);
		expect(markSeenMock).toHaveBeenCalledTimes(1);
		expect(markSeenMock).toHaveBeenCalledWith("c");
	});
});
