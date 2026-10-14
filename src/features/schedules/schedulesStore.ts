import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { Schedule, ScheduleDraft, ScheduleRun } from "../../lib/contracts";
import { onSchedulesChanged } from "../../lib/events";
import {
	deleteSchedule as ipcDeleteSchedule,
	listScheduleRuns,
	listSchedules,
	runScheduleNow,
	saveSchedule as ipcSaveSchedule,
	setScheduleEnabled,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";

export type EditorTab = "settings" | "history";

const SEEN_KEY = "omp:schedules:seenRuns";
/** Cap the seen list so localStorage never grows unboundedly. */
const SEEN_CAP = 400;

function readSeenRuns(): Record<string, true> {
	try {
		const raw = localStorage.getItem(SEEN_KEY);
		if (!raw) return {};
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return {};
		const out: Record<string, true> = {};
		for (const id of arr.slice(-SEEN_CAP)) {
			if (typeof id === "string") out[id] = true;
		}
		return out;
	} catch {
		return {};
	}
}

function persistSeenRuns(seen: Record<string, true>): void {
	try {
		localStorage.setItem(SEEN_KEY, JSON.stringify(Object.keys(seen)));
	} catch {
		// Storage unavailable (private mode); seen state is best-effort.
	}
}

export interface SchedulesState {
	schedules: Schedule[];
	runs: Record<string, ScheduleRun[]>;
	loading: boolean;
	runningScheduleIds: Record<string, boolean>;
	/** Run ids the user has already seen (opened history/session for). */
	seenRuns: Record<string, true>;
	isEditorOpen: boolean;
	editingSchedule: Schedule | null;
	draftTemplate: Partial<ScheduleDraft> | null;
	/** Which tab the editor opens on (history when a run just failed). */
	editorTab: EditorTab;

	load: () => Promise<void>;
	loadRuns: (scheduleId: string, limit?: number) => Promise<void>;
	markRunSeen: (runId: string) => void;
	toggleEnabled: (id: string, enabled: boolean) => Promise<void>;
	runNow: (id: string) => Promise<void>;
	removeSchedule: (id: string) => Promise<void>;
	saveSchedule: (draft: ScheduleDraft) => Promise<Schedule | null>;
	openCreate: (template?: Partial<ScheduleDraft>) => void;
	openEdit: (schedule: Schedule, tab?: EditorTab) => void;
	closeEditor: () => void;
}

let unlisten: UnlistenFn | null = null;

export const useSchedulesStore = create<SchedulesState>((set, get) => ({
	schedules: [],
	runs: {},
	loading: false,
	runningScheduleIds: {},
	seenRuns: readSeenRuns(),
	isEditorOpen: false,
	editingSchedule: null,
	draftTemplate: null,
	editorTab: "settings",

	load: async () => {
		set({ loading: true });
		try {
			// Start listening to schedules:changed once
			if (!unlisten) {
				unlisten = await onSchedulesChanged(() => {
					// Refresh schedules and every run list currently loaded
					void get().load();
					for (const sid of Object.keys(get().runs)) {
						void get().loadRuns(sid);
					}
				});
			}

			const list = await listSchedules();
			set({ schedules: list, loading: false });
		} catch (e) {
			console.error("Failed to load schedules:", e);
			set({ loading: false });
		}
	},

	loadRuns: async (scheduleId: string, limit = 20) => {
		try {
			const runs = await listScheduleRuns(scheduleId, limit);
			set((state) => ({
				runs: { ...state.runs, [scheduleId]: runs },
			}));
		} catch (e) {
			console.error(`Failed to load runs for schedule ${scheduleId}:`, e);
		}
	},

	markRunSeen: (runId: string) => {
		const seen = get().seenRuns;
		if (seen[runId]) return;
		const next: Record<string, true> = { ...seen, [runId]: true };
		set({ seenRuns: next });
		persistSeenRuns(next);
	},

	toggleEnabled: async (id: string, enabled: boolean) => {
		try {
			const updated = await setScheduleEnabled(id, enabled);
			set((state) => ({
				schedules: state.schedules.map((s) => (s.id === id ? updated : s)),
			}));
		} catch (e) {
			toast.error(`切换状态失败：${e}`);
		}
	},

	runNow: async (id: string) => {
		set((state) => ({
			runningScheduleIds: { ...state.runningScheduleIds, [id]: true },
		}));
		try {
			await runScheduleNow(id);
			toast.success("定时任务已触发运行");
			void get().load();
			void get().loadRuns(id);
		} catch (e) {
			toast.error(`触发失败：${e}`);
		} finally {
			set((state) => ({
				runningScheduleIds: { ...state.runningScheduleIds, [id]: false },
			}));
		}
	},

	removeSchedule: async (id: string) => {
		try {
			await ipcDeleteSchedule(id);
			set((state) => ({
				schedules: state.schedules.filter((s) => s.id !== id),
			}));
			toast.success("定时任务已删除");
		} catch (e) {
			toast.error(`删除失败：${e}`);
		}
	},

	saveSchedule: async (draft: ScheduleDraft) => {
		try {
			const saved = await ipcSaveSchedule(draft);
			toast.success(draft.id ? "任务已更新" : "定时任务已创建");
			set((state) => {
				const idx = state.schedules.findIndex((s) => s.id === saved.id);
				const nextList =
					idx >= 0
						? state.schedules.map((s) => (s.id === saved.id ? saved : s))
						: [saved, ...state.schedules];
				return {
					schedules: nextList,
					isEditorOpen: false,
					editingSchedule: null,
					draftTemplate: null,
				};
			});
			return saved;
		} catch (e) {
			toast.error(`保存失败：${e}`);
			return null;
		}
	},

	openCreate: (template?: Partial<ScheduleDraft>) => {
		set({
			isEditorOpen: true,
			editingSchedule: null,
			draftTemplate: template ?? null,
			editorTab: "settings",
		});
	},

	openEdit: (schedule: Schedule, tab: EditorTab = "settings") => {
		set({
			isEditorOpen: true,
			editingSchedule: schedule,
			draftTemplate: null,
			editorTab: tab,
		});
	},

	closeEditor: () => {
		set({
			isEditorOpen: false,
			editingSchedule: null,
			draftTemplate: null,
			editorTab: "settings",
		});
	},
}));
