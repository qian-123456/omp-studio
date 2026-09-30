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

export interface SchedulesState {
	schedules: Schedule[];
	runs: Record<string, ScheduleRun[]>;
	loading: boolean;
	runningScheduleIds: Record<string, boolean>;
	expandedRuns: Record<string, boolean>;
	isEditorOpen: boolean;
	editingSchedule: Schedule | null;
	draftTemplate: Partial<ScheduleDraft> | null;

	load: () => Promise<void>;
	loadRuns: (scheduleId: string) => Promise<void>;
	toggleExpanded: (scheduleId: string) => void;
	toggleEnabled: (id: string, enabled: boolean) => Promise<void>;
	runNow: (id: string) => Promise<void>;
	removeSchedule: (id: string) => Promise<void>;
	saveSchedule: (draft: ScheduleDraft) => Promise<Schedule | null>;
	openCreate: (template?: Partial<ScheduleDraft>) => void;
	openEdit: (schedule: Schedule) => void;
	closeEditor: () => void;
}

let unlisten: UnlistenFn | null = null;

export const useSchedulesStore = create<SchedulesState>((set, get) => ({
	schedules: [],
	runs: {},
	loading: false,
	runningScheduleIds: {},
	expandedRuns: {},
	isEditorOpen: false,
	editingSchedule: null,
	draftTemplate: null,

	load: async () => {
		set({ loading: true });
		try {
			// Start listening to schedules:changed once
			if (!unlisten) {
				unlisten = await onSchedulesChanged(() => {
					// Refresh schedules and any open runs lists
					void get().load();
					const expanded = get().expandedRuns;
					for (const [sid, isExp] of Object.entries(expanded)) {
						if (isExp) {
							void get().loadRuns(sid);
						}
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

	loadRuns: async (scheduleId: string) => {
		try {
			const runs = await listScheduleRuns(scheduleId, 10);
			set((state) => ({
				runs: { ...state.runs, [scheduleId]: runs },
			}));
		} catch (e) {
			console.error(`Failed to load runs for schedule ${scheduleId}:`, e);
		}
	},

	toggleExpanded: (scheduleId: string) => {
		const isExp = !!get().expandedRuns[scheduleId];
		set((state) => ({
			expandedRuns: {
				...state.expandedRuns,
				[scheduleId]: !isExp,
			},
		}));
		if (!isExp) {
			void get().loadRuns(scheduleId);
		}
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
		});
	},

	openEdit: (schedule: Schedule) => {
		set({
			isEditorOpen: true,
			editingSchedule: schedule,
			draftTemplate: null,
		});
	},

	closeEditor: () => {
		set({
			isEditorOpen: false,
			editingSchedule: null,
			draftTemplate: null,
		});
	},
}));
