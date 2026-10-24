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

vi.mock("@tauri-apps/plugin-process", () => ({
	relaunch: () => mockRelaunch(),
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

	it("triggers app relaunch", async () => {
		await useAppUpdate.getState().relaunchApp();
		expect(mockRelaunch).toHaveBeenCalled();
	});
});
