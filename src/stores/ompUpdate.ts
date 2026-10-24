/** omp version / `omp update` state shared by Settings ▸ 版本与更新 and the BottomBar chip. */
import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import type { OmpInfo, OmpUpdateStatus } from "../lib/contracts";
import { errMsg } from "../lib/dialogs";
import { ompInfo, ompUpdateCheck, ompUpdateRun } from "../lib/ipc";
import { toast } from "../lib/toast";
import { tNow } from "./language";
import { useSettings } from "../features/settings/store";
import { useModelCatalog } from "./modelCatalog";
import { setExternalUpdateHandler, syncStaleness } from "./ompUpdateSessions";
import { isCheckDue } from "./ompUpdateSchedule";

const LAST_CHECK_KEY = "ompws:omp-update-last-check";
const STALENESS_POLL_MS = 60 * 1000;
const UPDATE_CHECK_TICK_MS = 60 * 1000;
const DEFAULT_CHECK_INTERVAL_HOURS = 24;

interface OmpUpdateState {
	appVersion: string | null;
	info: OmpInfo | null;
	status: OmpUpdateStatus | null;
	checking: boolean;
	updating: boolean;
	/** epoch ms of the last completed check (success or failure). */
	lastCheckedAt: number | null;
	error: string | null;
	/** Output of the last check or update run. */
	lastOutput: string | null;
	loadInfo: () => Promise<void>;
	/** Manual check; toasts on failure when `silent` is false. */
	check: (silent?: boolean) => Promise<void>;
	/** App startup hook: loads versions and auto-checks when the configured interval has elapsed. */
	checkOnStartup: () => Promise<void>;
	runUpdate: () => Promise<void>;
}

function storedLastCheck(): number | null {
	const n = Number(localStorage.getItem(LAST_CHECK_KEY));
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** Bare version from `omp --version` output like "omp/18.4.4" or "18.4.4". */
export function ompVersionLabel(info: OmpInfo | null, status: OmpUpdateStatus | null): string | null {
	return status?.current ?? info?.version?.replace(/^omp[/\s]+v?/i, "") ?? null;
}

let startupDone = false;

export const useOmpUpdate = create<OmpUpdateState>((set, get) => ({
	appVersion: null,
	info: null,
	status: null,
	checking: false,
	updating: false,
	lastCheckedAt: storedLastCheck(),
	error: null,
	lastOutput: null,

	loadInfo: async () => {
		const [app, info] = await Promise.allSettled([getVersion(), ompInfo()]);
		set({
			appVersion: app.status === "fulfilled" ? app.value : get().appVersion,
			info: info.status === "fulfilled" ? info.value : get().info,
		});
	},

	check: async (silent = false) => {
		if (get().checking) return;
		set({ checking: true, error: null });
		try {
			const status = await ompUpdateCheck();
			set({ status, lastOutput: status.output });
			if (status.updateAvailable && useSettings.getState().settings?.ompAutoUpdate === true && !get().updating) {
				void get().runUpdate();
			}
		} catch (e) {
			const msg = errMsg(e);
			set({ error: msg, lastOutput: msg });
			if (!silent) toast.error(tNow("shell.checkOmpUpdateFailed", { error: msg }));
		} finally {
			const now = Date.now();
			localStorage.setItem(LAST_CHECK_KEY, String(now));
			set({ checking: false, lastCheckedAt: now });
		}
	},

	checkOnStartup: async () => {
		if (startupDone) return;
		startupDone = true;
		// Auto-update decision reads useSettings; make sure it is loaded first.
		if (!useSettings.getState().settings) await useSettings.getState().load();
		await get().loadInfo();
		const hours = useSettings.getState().settings?.ompCheckIntervalHours ?? DEFAULT_CHECK_INTERVAL_HOURS;
		if (isCheckDue(storedLastCheck(), hours, Date.now())) await get().check(true);
	},

	runUpdate: async () => {
		if (get().updating) return;
		set({ updating: true, error: null });
		try {
			const res = await ompUpdateRun();
			set({ lastOutput: res.output });
			if (!res.success) {
				set({ error: res.output });
				toast.error(tNow("shell.ompUpdateFailedInSettings"));
				return;
			}
			await get().loadInfo();
			await get().check(true);
			void useModelCatalog.getState().refresh();
			const ver = ompVersionLabel(get().info, get().status) ?? res.versionAfter ?? tNow("shell.latestVersion");
			toast.success(tNow("shell.ompUpdatedSuccess", { version: ver }));
			void syncStaleness({ selfUpdate: true, version: ver }).catch(() => {});
		} catch (e) {
			const msg = errMsg(e);
			set({ error: msg, lastOutput: msg });
			toast.error(tNow("shell.ompUpdateFailed", { error: msg }));
		} finally {
			set({ updating: false });
		}
	},
}));

// omp replaced outside the app (e.g. `omp update` in a terminal): refresh versions, then let the switch proceed.
setExternalUpdateHandler(async (staleCount) => {
	const s = useOmpUpdate.getState();
	if (s.updating) return null; // in-app update in flight; runUpdate syncs with selfUpdate.
	await s.loadInfo();
	await s.check(true);
	void useModelCatalog.getState().refresh();
	const st = useOmpUpdate.getState();
	const ver = ompVersionLabel(st.info, st.status);
	if (staleCount > 0) toast.info(tNow("shell.ompExternalUpdateNotice", { version: ver ?? tNow("shell.newVersion") }));
	return ver;
});

/**
 * App-lifetime watcher: syncs omp session staleness now, on window focus and
 * every minute, so sessions follow omp binary replacements. Returns a disposer.
 */
export function watchOmpStaleness(): () => void {
	const sync = () => void syncStaleness().catch(() => {});
	sync();
	window.addEventListener("focus", sync);
	const timer = setInterval(sync, STALENESS_POLL_MS);
	return () => {
		window.removeEventListener("focus", sync);
		clearInterval(timer);
	};
}

/** App-lifetime watcher: every minute, runs a silent check once the configured interval has elapsed. Returns a disposer. */
export function watchOmpUpdateChecks(): () => void {
	const timer = setInterval(() => {
		const s = useOmpUpdate.getState();
		if (s.checking) return;
		const hours = useSettings.getState().settings?.ompCheckIntervalHours ?? DEFAULT_CHECK_INTERVAL_HOURS;
		if (isCheckDue(s.lastCheckedAt, hours, Date.now())) void s.check(true);
	}, UPDATE_CHECK_TICK_MS);
	return () => clearInterval(timer);
}
