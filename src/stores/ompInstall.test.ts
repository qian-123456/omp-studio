import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmpInfo, OmpInstallResult } from "../lib/contracts";

const h = vi.hoisted(() => ({
	run: vi.fn(),
	cancel: vi.fn(),
	listen: vi.fn(),
	unlisten: vi.fn(),
	listener: null as null | ((p: { line: string | null; downloadedBytes: number | null }) => void),
	loadInfo: vi.fn(),
	refresh: vi.fn(),
	updateSettings: vi.fn(),
	omp: { info: null as OmpInfo | null },
	settings: { value: { ompBinary: "omp" } as { ompBinary: string } | null },
}));

vi.mock("../lib/ipc", () => ({ ompInstallRun: h.run, ompInstallCancel: h.cancel }));
vi.mock("../lib/events", () => ({
	onOmpInstall: (cb: typeof h.listener) => {
		h.listener = cb;
		return h.listen();
	},
}));
vi.mock("./modelCatalog", () => ({ useModelCatalog: { getState: () => ({ refresh: h.refresh }) } }));
vi.mock("./ompUpdate", () => ({
	useOmpUpdate: { getState: () => ({ info: h.omp.info, loadInfo: h.loadInfo }) },
}));
vi.mock("../features/settings/store", () => ({
	useSettings: {
		getState: () => ({ settings: h.settings.value, load: async () => {}, update: h.updateSettings }),
	},
}));

import { _resetOmpInstallStartup, decideStartupInstall, useOmpInstall } from "./ompInstall";

const info = (found: boolean): OmpInfo => ({ found, resolvedPath: "/x/omp", version: null }) as unknown as OmpInfo;
const result = (success: boolean, output: string): OmpInstallResult => ({ success, output, info: info(success) });

function deferred<T>() {
	// The project's ES2021 lib does not expose Promise.withResolvers.
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	vi.clearAllMocks();
	h.run.mockReset();
	h.cancel.mockReset().mockResolvedValue(undefined);
	h.listen.mockReset().mockResolvedValue(h.unlisten);
	_resetOmpInstallStartup();
	useOmpInstall.setState({ open: false, phase: "idle", customPathMissing: false, lines: [], result: null, error: null, cancelled: false });
	h.omp.info = info(false);
	h.settings.value = { ompBinary: "omp" };
	h.listener = null;
});

describe("decideStartupInstall", () => {
	it("installs for the default binary, asks for a custom one, ignores found/unknown", () => {
		expect(decideStartupInstall(info(false), "omp")).toBe("install");
		expect(decideStartupInstall(info(false), "/opt/omp")).toBe("custom-path");
		expect(decideStartupInstall(info(true), "omp")).toBe("none");
		expect(decideStartupInstall(null, "omp")).toBe("none");
	});
});

describe("startup check", () => {
	it("default ompBinary: opens and installs once per launch", async () => {
		h.run.mockResolvedValue(result(true, "ok"));
		await useOmpInstall.getState().checkOnStartup();
		await useOmpInstall.getState().checkOnStartup();
		expect(h.run).toHaveBeenCalledTimes(1);
		expect(useOmpInstall.getState().open).toBe(true);
	});

	it("custom ompBinary: opens in custom-path state without installing", async () => {
		h.settings.value = { ompBinary: "/opt/omp" };
		await useOmpInstall.getState().checkOnStartup();
		expect(h.run).not.toHaveBeenCalled();
		expect(useOmpInstall.getState()).toMatchObject({ open: true, phase: "idle", customPathMissing: true });
	});

	it("found: does nothing", async () => {
		h.omp.info = info(true);
		await useOmpInstall.getState().checkOnStartup();
		expect(useOmpInstall.getState().open).toBe(false);
		expect(h.run).not.toHaveBeenCalled();
	});

	it("switchToAutoInstall resets ompBinary then installs", async () => {
		h.run.mockResolvedValue(result(true, "ok"));
		await useOmpInstall.getState().switchToAutoInstall();
		expect(h.updateSettings).toHaveBeenCalledWith({ ompBinary: "omp" });
		expect(h.run).toHaveBeenCalled();
	});
});

describe("install transitions", () => {
	it("success refreshes info and model catalog", async () => {
		h.run.mockImplementation(async () => {
			h.listener?.({ line: "Downloading omp", downloadedBytes: 1024 });
			return result(true, "done");
		});
		await useOmpInstall.getState().start();
		const s = useOmpInstall.getState();
		expect(s.phase).toBe("success");
		expect(s.lines).toEqual(["Downloading omp"]);
		expect(s.downloadedBytes).toBe(1024);
		expect(h.loadInfo).toHaveBeenCalled();
		expect(h.refresh).toHaveBeenCalled();
	});

	it("failure keeps the output and does not refresh", async () => {
		h.run.mockResolvedValue(result(false, "boom"));
		await useOmpInstall.getState().start();
		const s = useOmpInstall.getState();
		expect(s).toMatchObject({ phase: "failed", cancelled: false });
		expect(s.result?.output).toBe("boom");
		expect(h.refresh).not.toHaveBeenCalled();
	});

	it("cancelled output is flagged as cancelled", async () => {
		h.run.mockResolvedValue(result(false, "安装已取消"));
		await useOmpInstall.getState().start();
		expect(useOmpInstall.getState()).toMatchObject({ phase: "failed", cancelled: true });
	});

	it.each(["resolves", "rejects"] as const)("honors cancellation while the progress listener setup %s", async (setupOutcome) => {
		const setup = deferred<() => void>();
		h.listen.mockReturnValueOnce(setup.promise);
		h.run.mockResolvedValue(result(true, "must not install"));
		const installation = useOmpInstall.getState().start();
		const cancelledListener = h.listener;
		expect(useOmpInstall.getState().phase).toBe("running");
		expect(h.run).not.toHaveBeenCalled();

		await useOmpInstall.getState().cancel();
		await useOmpInstall.getState().cancel();
		await useOmpInstall.getState().start();
		expect(h.listen).toHaveBeenCalledTimes(1);
		expect(h.cancel).not.toHaveBeenCalled();
		cancelledListener?.({ line: "late setup progress", downloadedBytes: 10 });

		if (setupOutcome === "resolves") setup.resolve(h.unlisten);
		else setup.reject(new Error("event bus unavailable"));
		await installation;
		expect(useOmpInstall.getState()).toMatchObject({
			open: true,
			phase: "failed",
			cancelled: true,
			result: null,
			error: null,
			lines: [],
			downloadedBytes: null,
		});
		expect(h.run).not.toHaveBeenCalled();
		expect(h.cancel).not.toHaveBeenCalled();
		expect(h.loadInfo).not.toHaveBeenCalled();
		expect(h.refresh).not.toHaveBeenCalled();
		expect(h.unlisten).toHaveBeenCalledTimes(setupOutcome === "resolves" ? 1 : 0);

		// A new attempt owns its listener and must not inherit the skipped run's cancel.
		h.run.mockImplementation(async () => {
			cancelledListener?.({ line: "stale cancelled attempt", downloadedBytes: 20 });
			h.listener?.({ line: "retry progress", downloadedBytes: 30 });
			return result(true, "retry installed");
		});
		await useOmpInstall.getState().start();
		expect(h.run).toHaveBeenCalledTimes(1);
		expect(useOmpInstall.getState()).toMatchObject({
			phase: "success",
			cancelled: false,
			error: null,
			lines: ["retry progress"],
			downloadedBytes: 30,
			result: result(true, "retry installed"),
		});
		expect(h.loadInfo).toHaveBeenCalledTimes(1);
		expect(h.refresh).toHaveBeenCalledTimes(1);
		expect(h.unlisten).toHaveBeenCalledTimes(setupOutcome === "resolves" ? 2 : 1);
	});

	it("still installs without progress events when deferred listener setup fails without cancellation", async () => {
		const setup = deferred<() => void>();
		h.listen.mockReturnValueOnce(setup.promise);
		h.run.mockResolvedValue(result(true, "installed without events"));
		const installation = useOmpInstall.getState().start();
		expect(h.run).not.toHaveBeenCalled();
		setup.reject(new Error("event bus unavailable"));
		await installation;
		expect(h.run).toHaveBeenCalledTimes(1);
		expect(h.unlisten).not.toHaveBeenCalled();
		expect(useOmpInstall.getState()).toMatchObject({ phase: "success", cancelled: false });
	});

	it("forwards running cancellation after deferred setup and permits retry", async () => {
		const setup = deferred<() => void>();
		const outcome = deferred<OmpInstallResult>();
		h.listen.mockReturnValueOnce(setup.promise);
		h.run.mockReturnValueOnce(outcome.promise);
		const installation = useOmpInstall.getState().start();
		setup.resolve(h.unlisten);
		await Promise.resolve();
		expect(h.run).toHaveBeenCalledTimes(1);
		const runId = h.run.mock.calls[0]?.[0];
		expect(runId).toEqual(expect.any(String));
		h.cancel.mockImplementationOnce(async () => {
			outcome.resolve(result(false, "安装已取消"));
		});
		await useOmpInstall.getState().cancel();
		await installation;
		expect(h.cancel).toHaveBeenCalledTimes(1);
		expect(h.cancel).toHaveBeenCalledWith(runId);
		expect(h.unlisten).toHaveBeenCalledTimes(1);
		expect(useOmpInstall.getState()).toMatchObject({ phase: "failed", cancelled: true });
		expect(h.loadInfo).not.toHaveBeenCalled();
		expect(h.refresh).not.toHaveBeenCalled();

		h.run.mockResolvedValueOnce(result(true, "retry installed"));
		await useOmpInstall.getState().start();
		expect(h.run).toHaveBeenCalledTimes(2);
		expect(h.run.mock.calls[1]?.[0]).toEqual(expect.any(String));
		expect(h.run.mock.calls[1]?.[0]).not.toBe(runId);
		expect(h.cancel).toHaveBeenCalledTimes(1);
		expect(h.unlisten).toHaveBeenCalledTimes(2);
		expect(useOmpInstall.getState()).toMatchObject({ phase: "success", cancelled: false, error: null });
	});

	it("keeps a running install cancellable after a cancel invoke fails", async () => {
		const outcome = deferred<OmpInstallResult>();
		h.run.mockReturnValueOnce(outcome.promise);
		const installation = useOmpInstall.getState().start();
		await Promise.resolve();
		expect(h.run).toHaveBeenCalledTimes(1);
		h.cancel.mockRejectedValueOnce(new Error("cancel unavailable"));
		await useOmpInstall.getState().cancel();
		expect(useOmpInstall.getState()).toMatchObject({ phase: "running", cancelled: false, error: "cancel unavailable" });
		h.cancel.mockImplementationOnce(async () => {
			outcome.resolve(result(false, "安装已取消"));
		});
		await useOmpInstall.getState().cancel();
		await installation;
		expect(h.cancel).toHaveBeenCalledTimes(2);
		expect(h.cancel).toHaveBeenNthCalledWith(1, h.run.mock.calls[0]?.[0]);
		expect(h.cancel).toHaveBeenNthCalledWith(2, h.run.mock.calls[0]?.[0]);
		expect(useOmpInstall.getState()).toMatchObject({ phase: "failed", cancelled: true });
	});

	it("rejected run surfaces the error; running install is single-flight", async () => {
		h.run.mockRejectedValue("omp 正在安装中");
		await useOmpInstall.getState().start();
		expect(useOmpInstall.getState()).toMatchObject({ phase: "failed", error: "omp 正在安装中" });

		let release!: (r: OmpInstallResult) => void;
		h.run.mockReset();
		h.run.mockReturnValue(new Promise<OmpInstallResult>((r) => (release = r)));
		const first = useOmpInstall.getState().start();
		await useOmpInstall.getState().start();
		expect(h.run).toHaveBeenCalledTimes(1);
		useOmpInstall.getState().close();
		expect(useOmpInstall.getState().phase).toBe("running");
		release(result(true, "ok"));
		await first;
		expect(useOmpInstall.getState()).toMatchObject({ phase: "success", open: true });
	});
});
