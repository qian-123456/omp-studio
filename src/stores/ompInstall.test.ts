import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmpInfo, OmpInstallResult } from "../lib/contracts";

const h = vi.hoisted(() => ({
	run: vi.fn(),
	cancel: vi.fn(),
	listener: null as null | ((p: { line: string | null; downloadedBytes: number | null }) => void),
	loadInfo: vi.fn(),
	refresh: vi.fn(),
	updateSettings: vi.fn(),
	omp: { info: null as OmpInfo | null },
	settings: { value: { ompBinary: "omp" } as { ompBinary: string } | null },
}));

vi.mock("../lib/ipc", () => ({ ompInstallRun: h.run, ompInstallCancel: h.cancel }));
vi.mock("../lib/events", () => ({
	onOmpInstall: async (cb: typeof h.listener) => {
		h.listener = cb;
		return () => {};
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

beforeEach(() => {
	vi.clearAllMocks();
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
