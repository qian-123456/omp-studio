// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmpInfo, OmpUpdateStatus } from "../lib/contracts";

const h = vi.hoisted(() => ({
	check: vi.fn(),
	run: vi.fn(),
	info: vi.fn(),
	refresh: vi.fn(),
	sync: vi.fn(),
	autoUpdate: false,
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.0.0" }));
vi.mock("../lib/ipc", () => ({ ompInfo: h.info, ompUpdateCheck: h.check, ompUpdateRun: h.run }));
vi.mock("../lib/dialogs", () => ({ errMsg: (e: unknown) => String(e) }));
vi.mock("../lib/toast", () => ({ toast: { error: h.error, success: h.success, info: vi.fn() } }));
vi.mock("../features/settings/store", () => ({
	useSettings: { getState: () => ({ settings: { ompAutoUpdate: h.autoUpdate } }) },
}));
vi.mock("./modelCatalog", () => ({ useModelCatalog: { getState: () => ({ refresh: h.refresh }) } }));
vi.mock("./ompUpdateSessions", () => ({ setExternalUpdateHandler: vi.fn(), syncStaleness: h.sync }));

import { useOmpUpdate } from "./ompUpdate";

function deferred<T>() {
	// The project's ES2021 lib does not expose Promise.withResolvers.
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

const OLD: OmpUpdateStatus = { current: "1.0.0", latest: "2.0.0", updateAvailable: true, output: "old check" };
const FRESH: OmpUpdateStatus = { current: "2.0.0", latest: "2.0.0", updateAvailable: false, output: "fresh check" };
const INFO: OmpInfo = {
	found: true, resolvedPath: "/bin/omp", version: "omp/2.0.0", agentDir: "/agent", configPath: "/agent/config.yml", configExists: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	h.autoUpdate = false;
	h.check.mockReset();
	h.run.mockReset().mockResolvedValue({ success: true, output: "updated", versionAfter: "2.0.0" });
	h.info.mockResolvedValue(INFO);
	h.sync.mockResolvedValue(undefined);
	localStorage.clear();
	useOmpUpdate.setState({ appVersion: null, info: null, status: null, checking: false, updating: false, lastCheckedAt: null, error: null, lastOutput: null });
});

describe("OMP update check ownership", () => {
	it("rechecks after successful update even while a pre-update check is pending", async () => {
		const old = deferred<OmpUpdateStatus>();
		h.check.mockReturnValueOnce(old.promise).mockResolvedValueOnce(FRESH);
		const pending = useOmpUpdate.getState().check();
		await useOmpUpdate.getState().runUpdate();
		expect(h.check).toHaveBeenCalledTimes(2);
		expect(useOmpUpdate.getState()).toMatchObject({ status: FRESH, checking: false, updating: false });
		const checkedAt = useOmpUpdate.getState().lastCheckedAt;
		old.resolve(OLD);
		await pending;
		expect(useOmpUpdate.getState()).toMatchObject({ status: FRESH, lastOutput: FRESH.output, lastCheckedAt: checkedAt, error: null });
	});

	it("ignores stale errors without clearing the new post-update check's busy state", async () => {
		const old = deferred<OmpUpdateStatus>();
		const fresh = deferred<OmpUpdateStatus>();
		h.check.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
		const pending = useOmpUpdate.getState().check();
		const updating = useOmpUpdate.getState().runUpdate();
		await vi.waitFor(() => expect(h.check).toHaveBeenCalledTimes(2));
		expect(useOmpUpdate.getState()).toMatchObject({ status: null, checking: true });
		old.reject("old error");
		await pending;
		expect(useOmpUpdate.getState()).toMatchObject({ status: null, checking: true, error: null, lastOutput: "updated", lastCheckedAt: null });
		expect(h.error).not.toHaveBeenCalled();
		expect(localStorage.getItem("ompws:omp-update-last-check")).toBeNull();
		fresh.resolve(FRESH);
		await updating;
		expect(useOmpUpdate.getState()).toMatchObject({ status: FRESH, checking: false, updating: false });
	});

	it("does not auto-update again when a superseded check reports an old available version", async () => {
		const old = deferred<OmpUpdateStatus>();
		h.autoUpdate = true;
		h.check.mockReturnValueOnce(old.promise).mockResolvedValueOnce(FRESH);
		const pending = useOmpUpdate.getState().check();
		await useOmpUpdate.getState().runUpdate();
		old.resolve(OLD);
		await pending;
		expect(h.run).toHaveBeenCalledTimes(1);
		expect(useOmpUpdate.getState().status).toEqual(FRESH);
	});

	it("keeps a pending check valid when the attempted update fails", async () => {
		const old = deferred<OmpUpdateStatus>();
		h.check.mockReturnValueOnce(old.promise);
		h.run.mockResolvedValueOnce({ success: false, output: "update failed", versionAfter: null });
		const pending = useOmpUpdate.getState().check();
		await useOmpUpdate.getState().runUpdate();
		expect(h.check).toHaveBeenCalledTimes(1);
		expect(useOmpUpdate.getState().checking).toBe(true);
		old.resolve(OLD);
		await pending;
		expect(useOmpUpdate.getState()).toMatchObject({ status: OLD, checking: false });
	});
});
