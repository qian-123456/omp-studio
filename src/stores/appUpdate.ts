/** App (omp-workspace) update state powered by @tauri-apps/plugin-updater and GitHub Releases. */
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { errMsg } from "../lib/dialogs";
import { toast } from "../lib/toast";
import { tNow } from "./language";

const APP_UPDATE_LAST_CHECK_KEY = "ompws:app-update-last-check";
const APP_UPDATE_AUTO_CHECK_KEY = "ompws:app-update-auto-check";
const APP_UPDATE_INTERVAL_KEY = "ompws:app-update-check-interval-hours";
const APP_UPDATE_SEEN_KEY = "ompws:app-update-seen-version";
const DEFAULT_APP_CHECK_INTERVAL_HOURS = 24;
const UPDATE_CHECK_TICK_MS = 60 * 1000;
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
	restarting: boolean;
	lastCheckedAt: number | null;
	error: string | null;
	updateHandle: Update | null;
	lastSeenVersion: string | null;
	markUpdateSeen: () => void;

	autoCheck: boolean;
	checkIntervalHours: number;
	setAutoCheck: (enabled: boolean) => void;
	setCheckIntervalHours: (hours: number) => void;
	checkOnStartup: () => Promise<void>;
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
function storedAutoCheck(): boolean {
	if (typeof localStorage === "undefined") return true;
	const val = localStorage.getItem(APP_UPDATE_AUTO_CHECK_KEY);
	return val === null ? true : val === "true";
}

function storedIntervalHours(): number {
	if (typeof localStorage === "undefined") return DEFAULT_APP_CHECK_INTERVAL_HOURS;
	const n = Number(localStorage.getItem(APP_UPDATE_INTERVAL_KEY));
	return Number.isFinite(n) && n >= 1 && n <= 720 ? n : DEFAULT_APP_CHECK_INTERVAL_HOURS;
}
function storedSeenVersion(): string | null {
	if (typeof localStorage === "undefined") return null;
	return localStorage.getItem(APP_UPDATE_SEEN_KEY);
}

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
	appVersion: null,
	updateInfo: null,
	checking: false,
	downloading: false,
	downloadProgress: null,
	readyToRestart: false,
	restarting: false,
	lastCheckedAt: storedLastCheck(),
	error: null,
	updateHandle: null,
	autoCheck: storedAutoCheck(),
	checkIntervalHours: storedIntervalHours(),
	lastSeenVersion: storedSeenVersion(),
	markUpdateSeen: () => {
		const version = get().updateInfo?.version;
		if (!version) return;
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(APP_UPDATE_SEEN_KEY, version);
		}
		set({ lastSeenVersion: version });
	},
	setAutoCheck: (enabled: boolean) => {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(APP_UPDATE_AUTO_CHECK_KEY, String(enabled));
		}
		set({ autoCheck: enabled });
	},
	setCheckIntervalHours: (hours: number) => {
		const rounded = Math.round(hours);
		const clamped = Number.isFinite(rounded) && rounded > 0 ? Math.min(720, Math.max(1, rounded)) : DEFAULT_APP_CHECK_INTERVAL_HOURS;
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(APP_UPDATE_INTERVAL_KEY, String(clamped));
		}
		set({ checkIntervalHours: clamped });
	},
	checkOnStartup: async () => {
		const { autoCheck, checkIntervalHours, check } = get();
		if (!autoCheck) return;
		const last = storedLastCheck();
		const now = Date.now();
		const due = last === null || now < last || now - last >= checkIntervalHours * 3600 * 1000;
		if (due) await check(true);
	},

	loadVersion: async () => {
		try {
			const version = await getVersion();
			set({ appVersion: version });
		} catch {
			// In web or tests without Tauri runtime
		}
	},

	check: async (silent = false) => {
		if (get().checking || get().downloading || get().readyToRestart || get().restarting) return;
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
		if (!update || get().checking || get().downloading || get().readyToRestart || get().restarting) return;

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
					// Finished covers the download only; verification and installation still follow.
					set({
						downloadProgress: {
							downloaded: total,
							total,
							percent: 100,
						},
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
		if (!get().readyToRestart || get().downloading || get().restarting) return;
		set({ restarting: true, error: null });
		try {
			await relaunch();
		} catch (e) {
			const msg = errMsg(e);
			set({ restarting: false, error: msg });
			toast.error(msg);
		}
	},

	dismissUpdate: async () => {
		if (get().downloading || get().readyToRestart || get().restarting) return;
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

/** App-lifetime watcher: every minute, runs a silent app check once the configured interval has elapsed. Returns a disposer. */
export function watchAppUpdateChecks(): () => void {
	const timer = setInterval(() => {
		const s = useAppUpdate.getState();
		if (!s.autoCheck || s.checking || s.downloading) return;
		const last = s.lastCheckedAt;
		const now = Date.now();
		const due = last === null || now < last || now - last >= s.checkIntervalHours * 3600 * 1000;
		if (due) void s.check(true);
	}, UPDATE_CHECK_TICK_MS);
	return () => clearInterval(timer);
}
