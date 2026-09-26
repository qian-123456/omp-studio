/** [D] Settings store shared by SettingsPage, TodoHome switches and TopCapsule. */

import { create } from "zustand";
import type { Settings } from "../../lib/contracts";
import { getSettings, saveSettings } from "../../lib/ipc";

/** Mirror of `Settings::default()` in contracts.rs (used by import / restore). */
export const DEFAULT_SETTINGS: Settings = {
	systemDetection: true,
	supervisorEnabled: false,
	supervisorModel: "smol",
	smartContextRouting: false,
	idleSuspendMinutes: 15,
	defaultApprovalMode: "yolo",
	ompBinary: "omp",
	notifyTurnEnd: true,
	notifyApproval: true,
	notifyExit: true,
	notifySound: false,
	capsuleVisible: true,
	mobileEnabled: false,
	mobilePort: 7788,
	tunnelMode: "off",
	tunnelName: null,
	tunnelHostname: null,
	quickCaptureShortcut: "CommandOrControl+Shift+I",
	supervisorIntervalMinutes: 30,
	notifyQuietFrom: null,
	notifyQuietTo: null,
	newSessionModel: null,
	homeShowCompletedTodos: false,
	dockBadgeEnabled: true,
	sessionTurnAutoRefresh: true,
};

export interface SettingsState {
	settings: Settings | null;
	error: string | null;
	load(): Promise<void>;
	/** Merge a patch and persist; reverts on failure. */
	update(patch: Partial<Settings>): Promise<void>;
}

let loading: Promise<void> | null = null;
let lastConfirmed: Settings | null = null;
let saveQueue: Promise<void> = Promise.resolve();

export const useSettings = create<SettingsState>((set, get) => ({
	settings: null,
	error: null,
	load: () => {
		loading ??= getSettings()
			.then((settings) => {
				lastConfirmed = settings;
				set({ settings, error: null });
			})
			.catch((e) => set({ error: String(e) }))
			.finally(() => {
				loading = null;
			});
		return loading;
	},
	update: async (patch) => {
		const current = get().settings;
		if (!current) return;
		if (!lastConfirmed) {
			lastConfirmed = current;
		}
		const next = { ...current, ...patch };
		set({ settings: next });

		const queued = saveQueue.then(async () => {
			// Persist this request's patch, rebased on the last successful save.
			const target = { ...(lastConfirmed ?? current), ...patch };
			try {
				const saved = await saveSettings(target);
				lastConfirmed = saved;
				set((state) => ({
					settings: state.settings === next ? saved : state.settings,
					error: null,
				}));
			} catch (e) {
				set((state) => ({
					settings: state.settings === next ? lastConfirmed : state.settings,
					error: String(e),
				}));
				throw e;
			}
		});

		saveQueue = queued.catch(() => {
			// keep queue running for subsequent updates
		});

		await queued;
	},
}));

/** Load settings once (idempotent) and return them. */
export function ensureSettings(): void {
	const s = useSettings.getState();
	if (!s.settings) void s.load();
}
