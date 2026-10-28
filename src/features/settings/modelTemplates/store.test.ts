import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwitchStatus, TemplateStoreSnapshot } from "../../../lib/contracts";
import { useModelTemplatesStore as store } from "./store";

const { readSnapshot, readStatus } = vi.hoisted(() => ({
	readSnapshot: vi.fn<() => Promise<TemplateStoreSnapshot>>(),
	readStatus: vi.fn<(force?: boolean) => Promise<SwitchStatus>>(),
}));

vi.mock("../../../lib/ipc", () => ({
	modelTemplatesSnapshot: readSnapshot,
	modelSwitchStatus: readStatus,
}));
vi.mock("../../../lib/events", () => ({ onModelSwitchChanged: vi.fn() }));
vi.mock("../../../lib/dialogs", () => ({
	errMsg: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

function deferred<T>() {
	// The project's ES2021 lib does not expose Promise.withResolvers.
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function snapshot(name: string): TemplateStoreSnapshot {
	return {
		templates: [{
			id: name,
			name,
			scope: "global",
			roles: { default: "openai/gpt-5" },
			isBottomLine: false,
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
		}],
		rules: [],
		log: [],
		settings: { pollIntervalSecs: 600 },
		currents: [],
		conflicts: [],
	};
}

function status(lastCheckAt: number): SwitchStatus {
	return {
		lastCheckAt,
		lastError: null,
		checking: false,
		pollIntervalSecs: 600,
		nextCheckAt: null,
		providers: [],
		blocked: null,
	};
}

beforeEach(() => {
	readSnapshot.mockReset();
	readStatus.mockReset();
	store.setState({ snapshot: null, status: null, loading: false, error: null, statusError: null });
});

describe("model template snapshot ownership", () => {
	it.each(["success", "failure"] as const)("keeps a confirmed mutation after a pre-mutation read's late %s", async (outcome) => {
		const oldRead = deferred<TemplateStoreSnapshot>();
		readSnapshot.mockReturnValueOnce(oldRead.promise);
		const loading = store.getState().load(true);
		expect(store.getState().loading).toBe(true);

		const saved = snapshot("saved-template");
		store.getState().setSnapshot(saved);
		expect(store.getState()).toMatchObject({ snapshot: saved, loading: false, error: null });

		if (outcome === "success") oldRead.resolve(snapshot("before-save"));
		else oldRead.reject(new Error("stale read failed"));
		await loading;

		expect(store.getState().snapshot).toBe(saved);
		expect(store.getState()).toMatchObject({ loading: false, error: null });
	});

	it("detaches a superseded read so a normal read starts fresh and owns its loading lifecycle", async () => {
		const oldRead = deferred<TemplateStoreSnapshot>();
		const freshRead = deferred<TemplateStoreSnapshot>();
		readSnapshot.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(freshRead.promise);
		const oldLoading = store.getState().load();
		store.getState().setSnapshot(snapshot("saved-template"));
		const freshLoading = store.getState().load();
		expect(readSnapshot).toHaveBeenCalledTimes(2);
		expect(freshLoading).not.toBe(oldLoading);

		oldRead.resolve(snapshot("before-save"));
		await oldLoading;
		expect(store.getState().snapshot?.templates[0].name).toBe("saved-template");
		expect(store.getState().loading).toBe(true);
		// The old request's finalizer must not clear the new single-flight handle.
		expect(store.getState().load()).toBe(freshLoading);
		expect(readSnapshot).toHaveBeenCalledTimes(2);

		const fresh = snapshot("after-save");
		freshRead.resolve(fresh);
		await freshLoading;
		expect(store.getState().snapshot).toBe(fresh);
		expect(store.getState().loading).toBe(false);
	});

	it.each(["success", "failure"] as const)("preserves forced-read supersession after the older read's %s", async (outcome) => {
		const oldRead = deferred<TemplateStoreSnapshot>();
		const forcedRead = deferred<TemplateStoreSnapshot>();
		readSnapshot.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(forcedRead.promise);
		const oldLoading = store.getState().load();
		expect(store.getState().load()).toBe(oldLoading);
		const forcedLoading = store.getState().load(true);

		const newest = snapshot("newest-read");
		forcedRead.resolve(newest);
		await forcedLoading;
		if (outcome === "success") oldRead.resolve(snapshot("old-read"));
		else oldRead.reject(new Error("old read failed"));
		await oldLoading;

		expect(readSnapshot).toHaveBeenCalledTimes(2);
		expect(store.getState().snapshot).toBe(newest);
		expect(store.getState()).toMatchObject({ loading: false, error: null });
	});

	it("clears an existing read error on confirmed mutation but still reports a later read failure", async () => {
		readSnapshot.mockRejectedValueOnce(new Error("initial read failed"));
		await store.getState().load();
		expect(store.getState().error).toBe("initial read failed");

		const saved = snapshot("saved-template");
		store.getState().setSnapshot(saved);
		expect(store.getState().error).toBeNull();
		readSnapshot.mockRejectedValueOnce(new Error("fresh read failed"));
		await store.getState().load();
		expect(store.getState().snapshot).toBe(saved);
		expect(store.getState()).toMatchObject({ error: "fresh read failed", loading: false });
	});
});

describe("model template status ownership", () => {
	it("does not supersede or duplicate an independent status read when publishing a mutation", async () => {
		const pending = deferred<SwitchStatus>();
		readStatus.mockReturnValueOnce(pending.promise);
		const loading = store.getState().loadStatus();
		store.getState().setSnapshot(snapshot("saved-template"));
		expect(store.getState().loadStatus()).toBe(loading);
		expect(readStatus).toHaveBeenCalledTimes(1);

		const liveStatus = status(1);
		pending.resolve(liveStatus);
		await loading;
		expect(store.getState().status).toBe(liveStatus);
		expect(store.getState().statusError).toBeNull();
	});

	it.each(["success", "failure"] as const)("keeps the newest forced status result after the old read's %s", async (outcome) => {
		const oldRead = deferred<SwitchStatus>();
		const freshRead = deferred<SwitchStatus>();
		readStatus.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(freshRead.promise);
		const oldLoading = store.getState().loadStatus();
		const freshLoading = store.getState().loadStatus(true);
		expect(readStatus.mock.calls).toEqual([[false], [true]]);

		const newest = status(2);
		freshRead.resolve(newest);
		await freshLoading;
		if (outcome === "success") oldRead.resolve(status(1));
		else oldRead.reject(new Error("old status failed"));
		await oldLoading;

		expect(store.getState().status).toBe(newest);
		expect(store.getState().statusError).toBeNull();
	});
});
