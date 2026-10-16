/** [D] Settings store shared by SettingsPage and TopCapsule. */

import { create } from "zustand";
import type { Settings } from "../../lib/contracts";
import { getSettings, saveSettings } from "../../lib/ipc";

/** Mirror of `Settings::default()` in contracts.rs (used by import / restore). */
export const DEFAULT_SETTINGS: Settings = {
	systemDetection: true,
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
	mobileIpv6Enabled: false,
	mobileIpv6Port: 7789,
	ddnsEnabled: false,
	ddnsZoneId: null,
	ddnsHostname: null,
	quickCaptureShortcut: "CommandOrControl+Shift+I",
	inboxWindowHours: 24,
	ompCheckIntervalHours: 24,
	notifyQuietFrom: null,
	notifyQuietTo: null,
	newSessionModel: null,
	dockBadgeEnabled: true,
	sessionTurnAutoRefresh: true,
	sessionGroupByWorktree: true,
	turnCheckpoints: null,
	queueAutoSend: null,
	ompAutoUpdate: null,
	gitDeliveryMode: "pr",
	doctorModel: "smol",
	doctorAutoMode: "manual",
	doctorIdleMinutes: 30,
	doctorScheduleTime: "23:00",
	privacyRevealDefault: null,
	windowWorktreeTitle: true,
	sideChatModel: null,
	visualizeEnabled: true,
	sendShortcut: "enter",
	followUpBehavior: "steer",
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
const keyRevisions = new Map<keyof Settings, number>();
let currentRev = 0;

export function _resetSettingsStore(): void {
	lastConfirmed = null;
	keyRevisions.clear();
	currentRev = 0;
	saveQueue = Promise.resolve();
}

export const useSettings = create<SettingsState>((set, get) => ({
	settings: null,
	error: null,
	load: () => {
		loading ??= getSettings()
			.then((settings) => {
				lastConfirmed = settings;
				keyRevisions.clear();
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
		const rev = ++currentRev;
		const prevSnapshot = { ...current };
		for (const k of Object.keys(patch) as (keyof Settings)[]) {
			keyRevisions.set(k, rev);
		}
		const next = { ...current, ...patch };
		set({ settings: next });

		const queued = saveQueue.then(async () => {
			// Persist this request's patch, rebased on the last successful save.
			const target = { ...(lastConfirmed ?? current), ...patch };
			try {
				const saved = await saveSettings(target);
				lastConfirmed = saved;
				const confirmedPatch: Partial<Settings> = {};
				for (const k of Object.keys(patch) as (keyof Settings)[]) {
					if (keyRevisions.get(k) === rev) {
						(confirmedPatch as Record<string, unknown>)[k] = saved[k];
					}
				}
				set((state) => ({
					settings: state.settings ? { ...state.settings, ...confirmedPatch } : saved,
					error: null,
				}));
			} catch (e) {
				const revertPatch: Partial<Settings> = {};
				for (const k of Object.keys(patch) as (keyof Settings)[]) {
					if (keyRevisions.get(k) === rev) {
						if (lastConfirmed && lastConfirmed[k] !== undefined) {
							(revertPatch as Record<string, unknown>)[k] = lastConfirmed[k];
						} else if (prevSnapshot[k] !== undefined) {
							(revertPatch as Record<string, unknown>)[k] = prevSnapshot[k];
						}
					}
				}
				set((state) => ({
					settings: state.settings ? { ...state.settings, ...revertPatch } : null,
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
