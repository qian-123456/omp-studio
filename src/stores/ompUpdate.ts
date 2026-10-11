/** omp version / `omp update` state shared by Settings ▸ 版本与更新 and the BottomBar chip. */
import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import type { OmpInfo, OmpUpdateStatus } from "../lib/contracts";
import { errMsg } from "../lib/dialogs";
import { ompInfo, ompUpdateCheck, ompUpdateRun } from "../lib/ipc";
import { toast } from "../lib/toast";
import { useModelCatalog } from "./modelCatalog";

const LAST_CHECK_KEY = "ompws:omp-update-last-check";
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
	/** App startup hook: loads versions and auto-checks at most once per 6h. */
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
		} catch (e) {
			const msg = errMsg(e);
			set({ error: msg, lastOutput: msg });
			if (!silent) toast.error(`检查 omp 更新失败：${msg}`);
		} finally {
			const now = Date.now();
			localStorage.setItem(LAST_CHECK_KEY, String(now));
			set({ checking: false, lastCheckedAt: now });
		}
	},

	checkOnStartup: async () => {
		if (startupDone) return;
		startupDone = true;
		await get().loadInfo();
		const last = storedLastCheck();
		if (last === null || Date.now() - last >= AUTO_CHECK_INTERVAL_MS) await get().check(true);
	},

	runUpdate: async () => {
		if (get().updating) return;
		set({ updating: true, error: null });
		try {
			const res = await ompUpdateRun();
			set({ lastOutput: res.output });
			if (!res.success) {
				set({ error: res.output });
				toast.error("omp 更新失败，详见输出日志");
				return;
			}
			await get().loadInfo();
			await get().check(true);
			void useModelCatalog.getState().refresh();
			const ver = ompVersionLabel(get().info, get().status) ?? res.versionAfter ?? "最新版本";
			toast.success(`omp 已更新到 ${ver}；新会话生效，已运行的会话需重启`);
		} catch (e) {
			const msg = errMsg(e);
			set({ error: msg, lastOutput: msg });
			toast.error(`omp 更新失败：${msg}`);
		} finally {
			set({ updating: false });
		}
	},
}));
