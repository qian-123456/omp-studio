import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta, Workspace } from "../lib/contracts";
import { onSessionsRemoved, onSessionsUpdated } from "../lib/events";
import { listSessions, listWorkspaces } from "../lib/ipc";
import {
	startSessionEvents,
	stopSessionEvents,
	useSessions,
} from "./sessions";

vi.mock("../lib/events", () => ({
	onSessionsUpdated: vi.fn(),
	onSessionsRemoved: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
	listSessions: vi.fn(),
	listWorkspaces: vi.fn(),
}));

function createSession(
	id: string,
	overrides: Partial<SessionMeta> = {},
): SessionMeta {
	return {
		id,
		tool: "omp",
		file: `/tmp/session-${id}.jsonl`,
		cwd: "/test",
		title: `Session ${id}`,
		label: `#${id}`,
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
	};
}

function createWorkspace(
	id: string,
	overrides: Partial<Workspace> = {},
): Workspace {
	return {
		id,
		path: `/workspaces/${id}`,
		name: `Workspace ${id}`,
		kind: "project",
		sort: 0,
		mode: "code",
		...overrides,
	};
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("useSessions store", () => {
	let updateCallback: ((sessions: SessionMeta[]) => void) | null = null;
	let removeCallback: ((ids: string[]) => void) | null = null;
	let unlistenUpdated: Mock;
	let unlistenRemoved: Mock;

	beforeEach(async () => {
		vi.clearAllMocks();
		await stopSessionEvents();
		useSessions.setState({ sessions: {}, workspaces: [] });

		unlistenUpdated = vi.fn();
		unlistenRemoved = vi.fn();
		updateCallback = null;
		removeCallback = null;

		vi.mocked(onSessionsUpdated).mockImplementation(async (cb) => {
			updateCallback = cb;
			return unlistenUpdated;
		});

		vi.mocked(onSessionsRemoved).mockImplementation(async (cb) => {
			removeCallback = cb;
			return unlistenRemoved;
		});

		vi.mocked(listSessions).mockResolvedValue([]);
		vi.mocked(listWorkspaces).mockResolvedValue([]);
	});

	afterEach(async () => {
		await stopSessionEvents();
		useSessions.setState({ sessions: {}, workspaces: [] });
	});

	it("loads sessions and workspaces into the store", async () => {
		const s1 = createSession("s1", { title: "Session 1" });
		const s2 = createSession("s2", { title: "Session 2" });
		const w1 = createWorkspace("w1");

		vi.mocked(listSessions).mockResolvedValue([s1, s2]);
		vi.mocked(listWorkspaces).mockResolvedValue([w1]);

		await useSessions.getState().load();

		const state = useSessions.getState();
		expect(state.sessions).toEqual({ s1, s2 });
		expect(state.workspaces).toEqual([w1]);
		expect(onSessionsUpdated).toHaveBeenCalledTimes(1);
		expect(onSessionsRemoved).toHaveBeenCalledTimes(1);
	});

	it("reconciles in-flight update events and does not overwrite with older snapshot", async () => {
		const deferred = createDeferred<SessionMeta[]>();
		vi.mocked(listSessions).mockImplementation(() => deferred.promise);

		const initialOld = createSession("s1", { title: "Old Title" });
		const inFlightNew = createSession("s1", { title: "New In-Flight Title" });

		const loadPromise = useSessions.getState().load();

		expect(onSessionsUpdated).toHaveBeenCalled();
		expect(updateCallback).toBeDefined();

		// Fire in-flight event while snapshot is still pending
		updateCallback!([inFlightNew]);
		expect(useSessions.getState().sessions.s1?.title).toBe(
			"New In-Flight Title",
		);

		// Now snapshot resolves with the older data
		deferred.resolve([initialOld]);
		await loadPromise;

		// In-flight update should win over older snapshot
		expect(useSessions.getState().sessions.s1?.title).toBe(
			"New In-Flight Title",
		);
	});

	it("journals events arriving while listener registration is in flight", async () => {
		const updateListenerDeferred = createDeferred<() => void>();
		vi.mocked(onSessionsUpdated).mockImplementation(async (cb) => {
			updateCallback = cb;
			return updateListenerDeferred.promise;
		});

		const deferred = createDeferred<SessionMeta[]>();
		vi.mocked(listSessions).mockImplementation(() => deferred.promise);

		const inFlightSession = createSession("s1", {
			title: "Event during startup",
		});
		const snapshotSession = createSession("s1", {
			title: "Old snapshot",
		});

		const loadPromise = useSessions.getState().load();

		// Event arrives before onSessionsUpdated finishes registering
		expect(updateCallback).toBeDefined();
		updateCallback!([inFlightSession]);

		// Now let listener registration complete
		updateListenerDeferred.resolve(unlistenUpdated);

		// Now resolve snapshot
		deferred.resolve([snapshotSession]);
		await loadPromise;

		expect(useSessions.getState().sessions.s1?.title).toBe(
			"Event during startup",
		);
	});

	it("preserves newly added sessions received via event during snapshot fetch", async () => {
		const deferred = createDeferred<SessionMeta[]>();
		vi.mocked(listSessions).mockImplementation(() => deferred.promise);

		const s1 = createSession("s1");
		const sNew = createSession("s-new", { title: "Created In-Flight" });

		const loadPromise = useSessions.getState().load();

		expect(updateCallback).toBeDefined();
		updateCallback!([sNew]);

		// Snapshot only knows about s1
		deferred.resolve([s1]);
		await loadPromise;

		const sessions = useSessions.getState().sessions;
		expect(sessions.s1).toEqual(s1);
		expect(sessions["s-new"]?.title).toBe("Created In-Flight");
	});

	it("does not resurrect sessions removed in flight", async () => {
		const deferred = createDeferred<SessionMeta[]>();
		vi.mocked(listSessions).mockImplementation(() => deferred.promise);

		const s1 = createSession("s1");
		const s2 = createSession("s2");

		const loadPromise = useSessions.getState().load();

		expect(removeCallback).toBeDefined();
		// Event removes s1 while snapshot is in flight
		removeCallback!(["s1"]);

		// Backend snapshot returns both s1 and s2
		deferred.resolve([s1, s2]);
		await loadPromise;

		const sessions = useSessions.getState().sessions;
		expect(sessions.s1).toBeUndefined();
		expect(sessions.s2).toEqual(s2);
	});

	it("removes stale sessions that are not in the new snapshot and not updated in flight", async () => {
		useSessions.getState().upsert([createSession("s-stale")]);
		expect(useSessions.getState().sessions["s-stale"]).toBeDefined();

		const sActive = createSession("s-active");
		vi.mocked(listSessions).mockResolvedValue([sActive]);

		await useSessions.getState().load();

		const sessions = useSessions.getState().sessions;
		expect(sessions["s-stale"]).toBeUndefined();
		expect(sessions["s-active"]).toEqual(sActive);
	});

	it("prevents older overlapping load from overwriting newer successful load", async () => {
		const load1Deferred = createDeferred<SessionMeta[]>();
		const load2Deferred = createDeferred<SessionMeta[]>();

		let callCount = 0;
		vi.mocked(listSessions).mockImplementation(() => {
			callCount++;
			return callCount === 1 ? load1Deferred.promise : load2Deferred.promise;
		});

		const p1 = useSessions.getState().load();
		const p2 = useSessions.getState().load();

		const sV1 = createSession("s1", { title: "Version 1 (old)" });
		const sV2 = createSession("s1", { title: "Version 2 (new)" });

		// Load 2 resolves first with newer state
		load2Deferred.resolve([sV2]);
		await p2;

		expect(useSessions.getState().sessions.s1?.title).toBe("Version 2 (new)");

		// Load 1 finishes later with older state
		load1Deferred.resolve([sV1]);
		await p1;

		// The newer state must not have been overwritten by Load 1
		expect(useSessions.getState().sessions.s1?.title).toBe("Version 2 (new)");
	});

	it("deduplicates concurrent listener registration", async () => {
		const [p1, p2, p3] = [
			startSessionEvents(),
			startSessionEvents(),
			startSessionEvents(),
		];
		await Promise.all([p1, p2, p3]);

		expect(onSessionsUpdated).toHaveBeenCalledTimes(1);
		expect(onSessionsRemoved).toHaveBeenCalledTimes(1);
	});

	it("cleans up on partial listener failure and allows retry", async () => {
		const unlistenUpdatedMock = vi.fn();
		vi.mocked(onSessionsUpdated).mockResolvedValueOnce(unlistenUpdatedMock);
		vi.mocked(onSessionsRemoved).mockRejectedValueOnce(
			new Error("Tauri event registration failure"),
		);

		// First attempt fails partially
		await expect(startSessionEvents()).rejects.toThrow(
			"Tauri event registration failure",
		);

		// The listener that succeeded should be cleaned up immediately
		expect(unlistenUpdatedMock).toHaveBeenCalledTimes(1);

		// Subsequent attempt (retry) should work if both succeed
		const unlistenUpdatedRetry = vi.fn();
		const unlistenRemovedRetry = vi.fn();
		vi.mocked(onSessionsUpdated).mockResolvedValueOnce(unlistenUpdatedRetry);
		vi.mocked(onSessionsRemoved).mockResolvedValueOnce(unlistenRemovedRetry);

		await expect(startSessionEvents()).resolves.toBeUndefined();
		expect(onSessionsUpdated).toHaveBeenCalledTimes(2);
		expect(onSessionsRemoved).toHaveBeenCalledTimes(2);
	});

	it("load() propagates listener failure without corrupting store", async () => {
		vi.mocked(onSessionsUpdated).mockRejectedValueOnce(
			new Error("listener failed"),
		);

		await expect(useSessions.getState().load()).rejects.toThrow(
			"listener failed",
		);

		expect(useSessions.getState().sessions).toEqual({});
		expect(listSessions).not.toHaveBeenCalled();
	});

	it("direct upsert and remove update store", () => {
		const s1 = createSession("s1");
		const s2 = createSession("s2");

		useSessions.getState().upsert([s1, s2]);
		expect(useSessions.getState().sessions).toEqual({ s1, s2 });

		useSessions.getState().remove(["s1"]);
		expect(useSessions.getState().sessions).toEqual({ s2 });
	});

	it("preserves structural sharing: unchanged sessions keep identity and identical upsert does not mutate map", () => {
		const s1 = createSession("s1");
		const s2 = createSession("s2");
		useSessions.getState().upsert([s1, s2]);

		const initialMap = useSessions.getState().sessions;
		const initialS1 = initialMap.s1;

		// 1. Identical upsert: map reference does NOT change
		useSessions.getState().upsert([s1, s2]);
		expect(useSessions.getState().sessions).toBe(initialMap);

		// 2. Partial update to s2: s1 keeps exact reference identity, only s2 updates
		const s2Updated = { ...s2, title: "New Title" };
		useSessions.getState().upsert([s2Updated]);

		const nextMap = useSessions.getState().sessions;
		expect(nextMap).not.toBe(initialMap);
		expect(nextMap.s1).toBe(initialS1);
		expect(nextMap.s2).toBe(s2Updated);
	});

	it("coalesces high-frequency updates from onSessionsUpdated", async () => {
		vi.useFakeTimers();
		try {
			let updateCallback: ((sessions: SessionMeta[]) => void) | undefined;
			vi.mocked(onSessionsUpdated).mockImplementation(async (cb) => {
				updateCallback = cb;
				return vi.fn();
			});
			vi.mocked(onSessionsRemoved).mockResolvedValue(vi.fn());

			await startSessionEvents();
			expect(updateCallback).toBeDefined();

			const s1 = createSession("s1");
			// First event fires leading-edge immediately
			updateCallback!([{ ...s1, title: "Title 1" }]);
			expect(useSessions.getState().sessions.s1?.title).toBe("Title 1");

			// Rapid follow-up events within 250ms are throttled
			updateCallback!([{ ...s1, title: "Title 2" }]);
			updateCallback!([{ ...s1, title: "Title 3" }]);
			expect(useSessions.getState().sessions.s1?.title).toBe("Title 1");

			// Advance past coalesce window
			vi.advanceTimersByTime(250);

			// Settled with latest state
			expect(useSessions.getState().sessions.s1?.title).toBe("Title 3");
		} finally {
			vi.useRealTimers();
		}
	});

});
