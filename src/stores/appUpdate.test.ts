import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppUpdate } from "./appUpdate";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

vi.mock("@tauri-apps/api/app", () => ({
	getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));

const mockCheck = vi.fn();
const mockRelaunch = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
	check: () => mockCheck(),
}));

vi.mock("../lib/ipc", () => ({
	appRelaunch: () => mockRelaunch(),
}));

describe("useAppUpdate store", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useAppUpdate.setState({
			appVersion: null,
			updateInfo: null,
			checking: false,
			downloading: false,
			downloadProgress: null,
			readyToRestart: false,
			restarting: false,
			error: null,
			updateHandle: null,
		});
	});

	it("loads current application version", async () => {
		await useAppUpdate.getState().loadVersion();
		expect(useAppUpdate.getState().appVersion).toBe("0.1.0");
	});

	it("checks for updates and sets updateInfo when available", async () => {
		const mockUpdate = {
			version: "0.2.0",
			currentVersion: "0.1.0",
			date: "2026-10-25",
			body: "Bug fixes and improvements",
			downloadAndInstall: vi.fn(),
			close: vi.fn(),
		};
		mockCheck.mockResolvedValueOnce(mockUpdate);

		await useAppUpdate.getState().check(true);

		const state = useAppUpdate.getState();
		expect(state.checking).toBe(false);
		expect(state.updateInfo?.version).toBe("0.2.0");
		expect(state.updateInfo?.notes).toBe("Bug fixes and improvements");
		expect(state.updateHandle).toBe(mockUpdate);
		expect(state.error).toBeNull();
	});

	it("handles check when no update is found", async () => {
		mockCheck.mockResolvedValueOnce(null);

		await useAppUpdate.getState().check(true);

		const state = useAppUpdate.getState();
		expect(state.checking).toBe(false);
		expect(state.updateInfo).toBeNull();
		expect(state.updateHandle).toBeNull();
	});

	it("handles check error gracefully", async () => {
		mockCheck.mockRejectedValueOnce(new Error("Network connection failed"));

		await useAppUpdate.getState().check(true);

		const state = useAppUpdate.getState();
		expect(state.checking).toBe(false);
		expect(state.error).toContain("Network connection failed");
	});

	it("downloads and installs update with progress tracking", async () => {
		const mockUpdate = {
			version: "0.2.0",
			currentVersion: "0.1.0",
			downloadAndInstall: vi.fn().mockImplementation(async (cb: (event: DownloadEvent) => void) => {
				cb({ event: "Started", data: { contentLength: 1000 } });
				cb({ event: "Progress", data: { chunkLength: 500 } });
				cb({ event: "Finished" });
			}),
			close: vi.fn(),
		};

		useAppUpdate.setState({
			updateHandle: mockUpdate as unknown as Update,
			updateInfo: { version: "0.2.0", currentVersion: "0.1.0" },
		});
		await useAppUpdate.getState().downloadAndInstall();

		const state = useAppUpdate.getState();
		expect(state.downloading).toBe(false);
		expect(state.readyToRestart).toBe(true);
		expect(state.downloadProgress?.percent).toBe(100);
	});

	it("keeps installation exclusive after download finishes until install succeeds", async () => {
		// The project's ES2021 library target does not expose Promise.withResolvers.
		let finishInstall!: () => void;
		const installed = new Promise<void>((resolve) => { finishInstall = resolve; });
		const downloadAndInstall = vi.fn((cb: (event: DownloadEvent) => void) => {
			cb({ event: "Started", data: { contentLength: 1000 } });
			cb({ event: "Finished" });
			return installed;
		});
		const close = vi.fn();
		const update = { downloadAndInstall, close } as unknown as Update;
		useAppUpdate.setState({ updateHandle: update });

		const installing = useAppUpdate.getState().downloadAndInstall();
		expect(useAppUpdate.getState().downloadProgress?.percent).toBe(100);
		expect(useAppUpdate.getState().readyToRestart).toBe(false);
		expect(useAppUpdate.getState().downloading).toBe(true);
		await useAppUpdate.getState().relaunchApp();
		await useAppUpdate.getState().check(true);
		await useAppUpdate.getState().dismissUpdate();
		await useAppUpdate.getState().downloadAndInstall();
		expect(mockRelaunch).not.toHaveBeenCalled();
		expect(mockCheck).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(downloadAndInstall).toHaveBeenCalledTimes(1);
		expect(useAppUpdate.getState().updateHandle).toBe(update);

		finishInstall();
		await installing;
		expect(useAppUpdate.getState().readyToRestart).toBe(true);
		expect(useAppUpdate.getState().downloading).toBe(false);
		await useAppUpdate.getState().check(true);
		await useAppUpdate.getState().dismissUpdate();
		await useAppUpdate.getState().downloadAndInstall();
		expect(mockCheck).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(downloadAndInstall).toHaveBeenCalledTimes(1);
		expect(useAppUpdate.getState().readyToRestart).toBe(true);
	});

	it("does not offer restart when verification or installation fails after download", async () => {
		const downloadAndInstall = vi.fn(async (cb: (event: DownloadEvent) => void) => {
			cb({ event: "Finished" });
			throw new Error("Update signature verification failed");
		});
		useAppUpdate.setState({ updateHandle: { downloadAndInstall } as unknown as Update });

		await useAppUpdate.getState().downloadAndInstall();
		expect(useAppUpdate.getState().readyToRestart).toBe(false);
		expect(useAppUpdate.getState().downloading).toBe(false);
		expect(useAppUpdate.getState().error).toContain("signature verification failed");
		await useAppUpdate.getState().relaunchApp();
		expect(mockRelaunch).not.toHaveBeenCalled();
	});

	it("dismisses update and closes update resource handle", async () => {
		const mockClose = vi.fn().mockResolvedValue(undefined);
		useAppUpdate.setState({
			updateHandle: { close: mockClose } as unknown as Update,
			updateInfo: { version: "0.2.0", currentVersion: "0.1.0" },
		});
		await useAppUpdate.getState().dismissUpdate();

		expect(mockClose).toHaveBeenCalled();
		expect(useAppUpdate.getState().updateInfo).toBeNull();
		expect(useAppUpdate.getState().updateHandle).toBeNull();
	});

	it("allows only one restart request and permits retry after a restart failure", async () => {
		// The project's ES2021 library target does not expose Promise.withResolvers.
		let failRestart!: (error: Error) => void;
		mockRelaunch.mockImplementationOnce(() => new Promise<void>((_, reject) => {
			failRestart = reject;
		}));
		await useAppUpdate.getState().relaunchApp();
		expect(mockRelaunch).not.toHaveBeenCalled();
		useAppUpdate.setState({ readyToRestart: true });

		const restarting = useAppUpdate.getState().relaunchApp();
		await useAppUpdate.getState().relaunchApp();
		expect(mockRelaunch).toHaveBeenCalledTimes(1);
		expect(useAppUpdate.getState().restarting).toBe(true);
		failRestart(new Error("Unable to relaunch"));
		await restarting;
		expect(useAppUpdate.getState().restarting).toBe(false);
		expect(useAppUpdate.getState().readyToRestart).toBe(true);
		mockRelaunch.mockResolvedValueOnce(undefined);
		await useAppUpdate.getState().relaunchApp();
		expect(mockRelaunch).toHaveBeenCalledTimes(2);
	});

	it("updates autoCheck preference and interval hours", () => {
		useAppUpdate.getState().setAutoCheck(false);
		expect(useAppUpdate.getState().autoCheck).toBe(false);
		useAppUpdate.getState().setAutoCheck(true);
		expect(useAppUpdate.getState().autoCheck).toBe(true);

		useAppUpdate.getState().setCheckIntervalHours(12);
		expect(useAppUpdate.getState().checkIntervalHours).toBe(12);

		// clamps within [1, 720]; <= 0 falls back to 24 (same as normalizeHours)
		useAppUpdate.getState().setCheckIntervalHours(0);
		expect(useAppUpdate.getState().checkIntervalHours).toBe(24);
		useAppUpdate.getState().setCheckIntervalHours(1000);
		expect(useAppUpdate.getState().checkIntervalHours).toBe(720);
	});

	it("records lastSeenVersion when markUpdateSeen is called", () => {
		useAppUpdate.setState({
			updateInfo: { version: "0.2.0", currentVersion: "0.1.0" },
			lastSeenVersion: null,
		});
		useAppUpdate.getState().markUpdateSeen();
		expect(useAppUpdate.getState().lastSeenVersion).toBe("0.2.0");
	});
});
