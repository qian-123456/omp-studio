/** App (omp-workspace) update state powered by @tauri-apps/plugin-updater and GitHub Releases. */
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { errMsg } from "../lib/dialogs";
import { toast } from "../lib/toast";
import { tNow } from "./language";

const APP_UPDATE_LAST_CHECK_KEY = "ompws:app-update-last-check";

export interface AppUpdateInfo {
	version: string;
	currentVersion: string;
	date?: string;
	notes?: string;
}

export interface AppDownloadProgress {
	downloaded: number;
	total: number;
	percent: number;
}

interface AppUpdateState {
	appVersion: string | null;
	updateInfo: AppUpdateInfo | null;
	checking: boolean;
	downloading: boolean;
	downloadProgress: AppDownloadProgress | null;
	readyToRestart: boolean;
	lastCheckedAt: number | null;
	error: string | null;
	updateHandle: Update | null;

	loadVersion: () => Promise<void>;
	check: (silent?: boolean) => Promise<void>;
	downloadAndInstall: () => Promise<void>;
	relaunchApp: () => Promise<void>;
	dismissUpdate: () => Promise<void>;
}

function storedLastCheck(): number | null {
	if (typeof localStorage === "undefined") return null;
	const n = Number(localStorage.getItem(APP_UPDATE_LAST_CHECK_KEY));
	return Number.isFinite(n) && n > 0 ? n : null;
}

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
	appVersion: null,
	updateInfo: null,
	checking: false,
	downloading: false,
	downloadProgress: null,
	readyToRestart: false,
	lastCheckedAt: storedLastCheck(),
	error: null,
	updateHandle: null,

	loadVersion: async () => {
		try {
			const version = await getVersion();
			set({ appVersion: version });
		} catch {
			// In web or tests without Tauri runtime
		}
	},

	check: async (silent = false) => {
		if (get().checking || get().downloading) return;
		set({ checking: true, error: null });
		try {
			await get().loadVersion();
			const update = await check();
			if (update) {
				const info: AppUpdateInfo = {
					version: update.version,
					currentVersion: update.currentVersion,
					date: update.date,
					notes: update.body,
				};
				set({
					updateInfo: info,
					updateHandle: update,
					readyToRestart: false,
				});
				if (!silent) {
					toast.info(tNow("settingsSections.about.appUpdateAvailable", { version: update.version }));
				}
			} else {
				set({ updateInfo: null, updateHandle: null });
				if (!silent) {
					toast.success(tNow("settingsSections.about.appAlreadyLatest"));
				}
			}
		} catch (e) {
			const msg = errMsg(e);
			set({ error: msg });
			if (!silent) {
				toast.error(tNow("settingsSections.about.appCheckFailed") + `: ${msg}`);
			}
		} finally {
			const now = Date.now();
			if (typeof localStorage !== "undefined") {
				localStorage.setItem(APP_UPDATE_LAST_CHECK_KEY, String(now));
			}
			set({ checking: false, lastCheckedAt: now });
		}
	},

	downloadAndInstall: async () => {
		const update = get().updateHandle;
		if (!update || get().downloading) return;

		set({ downloading: true, error: null, readyToRestart: false });
		let total = 0;
		let downloaded = 0;

		try {
			await update.downloadAndInstall((event) => {
				if (event.event === "Started") {
					total = event.data.contentLength ?? 0;
					set({
						downloadProgress: {
							downloaded: 0,
							total,
							percent: 0,
						},
					});
				} else if (event.event === "Progress") {
					downloaded += event.data.chunkLength;
					const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
					set({
						downloadProgress: {
							downloaded,
							total,
							percent,
						},
					});
				} else if (event.event === "Finished") {
					set({
						downloadProgress: {
							downloaded: total,
							total,
							percent: 100,
						},
						readyToRestart: true,
						downloading: false,
					});
				}
			});
			set({ readyToRestart: true, downloading: false });
			toast.success(tNow("settingsSections.about.appReadyToRestart"));
		} catch (e) {
			const msg = errMsg(e);
			set({ downloading: false, error: msg });
			toast.error(msg);
		}
	},

	relaunchApp: async () => {
		try {
			await relaunch();
		} catch (e) {
			toast.error(errMsg(e));
		}
	},

	dismissUpdate: async () => {
		const handle = get().updateHandle;
		if (handle) {
			try {
				await handle.close();
			} catch {
				// ignore
			}
		}
		set({ updateInfo: null, updateHandle: null, downloadProgress: null, readyToRestart: false });
	},
}));
