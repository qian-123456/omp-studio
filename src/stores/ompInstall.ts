/** omp 内核 install flow: startup detection, installer progress and the dialog's open/phase state. */
import { create } from "zustand";
import { useSettings } from "../features/settings/store";
import type { OmpInfo, OmpInstallResult } from "../lib/contracts";
import { errMsg } from "../lib/dialogs";
import { onOmpInstall } from "../lib/events";
import { ompInstallCancel, ompInstallRun } from "../lib/ipc";
import { useModelCatalog } from "./modelCatalog";
import { useOmpUpdate } from "./ompUpdate";

export type OmpInstallPhase = "idle" | "running" | "success" | "failed";

/** What the startup probe should do about a missing omp. */
export type StartupInstallDecision = "none" | "install" | "custom-path";

const MAX_LOG_LINES = 2000;

/** Pure startup decision: install directly for the default binary, ask when a custom path is set. */
export function decideStartupInstall(info: OmpInfo | null, ompBinary: string | undefined): StartupInstallDecision {
	if (!info || info.found) return "none";
	return (ompBinary ?? "omp") === "omp" ? "install" : "custom-path";
}

interface OmpInstallState {
	open: boolean;
	phase: OmpInstallPhase;
	/** Dialog opened because a custom omp path does not resolve (no install running yet). */
	customPathMissing: boolean;
	lines: string[];
	downloadedBytes: number | null;
	startedAt: number | null;
	result: OmpInstallResult | null;
	/** Failure text when the run could not even start (invoke rejected). */
	error: string | null;
	cancelled: boolean;
	/** Open the dialog and start installing. */
	openAndInstall: () => Promise<void>;
	/** Start the installer; a no-op while one is running. Reopens the dialog when it finishes. */
	start: () => Promise<void>;
	cancel: () => Promise<void>;
	/** Hiding the dialog while running keeps the install going; the store keeps tracking it. */
	close: () => void;
	/** App startup hook: call after omp info has loaded. Acts at most once per launch. */
	checkOnStartup: () => Promise<void>;
	/** Custom path not found → reset to the default `omp` and install. */
	switchToAutoInstall: () => Promise<void>;
	/** Re-probe omp; closes the dialog when found. Returns whether omp was found. */
	recheck: () => Promise<boolean>;
}

let startupHandled = false;

export function _resetOmpInstallStartup(): void {
	startupHandled = false;
}

export const useOmpInstall = create<OmpInstallState>((set, get) => ({
	open: false,
	phase: "idle",
	customPathMissing: false,
	lines: [],
	downloadedBytes: null,
	startedAt: null,
	result: null,
	error: null,
	cancelled: false,

	openAndInstall: async () => {
		set({ open: true });
		await get().start();
	},

	start: async () => {
		if (get().phase === "running") return;
		set({
			open: true,
			phase: "running",
			customPathMissing: false,
			lines: [],
			downloadedBytes: null,
			startedAt: Date.now(),
			result: null,
			error: null,
			cancelled: false,
		});
		let unlisten: (() => void) | null = null;
		try {
			unlisten = await onOmpInstall((p) => {
				set((s) => ({
					lines: p.line ? [...s.lines, p.line].slice(-MAX_LOG_LINES) : s.lines,
					downloadedBytes: p.downloadedBytes ?? s.downloadedBytes,
				}));
			});
		} catch {
			/* no event bus: the final result still carries the full log */
		}
		try {
			const res = await ompInstallRun();
			if (!res.success) {
				set({ open: true, phase: "failed", result: res, cancelled: res.output.includes("已取消") });
				return;
			}
			await useOmpUpdate.getState().loadInfo();
			void useModelCatalog.getState().refresh();
			set({ open: true, phase: "success", result: res });
		} catch (e) {
			set({ open: true, phase: "failed", error: errMsg(e) });
		} finally {
			unlisten?.();
		}
	},

	cancel: async () => {
		if (get().phase !== "running") return;
		try {
			await ompInstallCancel();
		} catch (e) {
			set({ error: errMsg(e) });
		}
	},

	close: () => set({ open: false }),

	checkOnStartup: async () => {
		if (startupHandled) return;
		const info = useOmpUpdate.getState().info;
		if (!info) return;
		if (!useSettings.getState().settings) await useSettings.getState().load();
		startupHandled = true;
		const decision = decideStartupInstall(info, useSettings.getState().settings?.ompBinary);
		if (decision === "install") await get().openAndInstall();
		else if (decision === "custom-path") set({ open: true, phase: "idle", customPathMissing: true });
	},

	switchToAutoInstall: async () => {
		await useSettings.getState().update({ ompBinary: "omp" });
		await get().start();
	},

	recheck: async () => {
		await useOmpUpdate.getState().loadInfo();
		const found = useOmpUpdate.getState().info?.found === true;
		if (found) {
			void useModelCatalog.getState().refresh();
			set({ open: false, customPathMissing: false });
		}
		return found;
	},
}));
