/**
 * [D] Settings ▸ 模板与自动切换: shared snapshot/status store.
 *
 * Every mutating command returns the full `TemplateStoreSnapshot`, so the cards
 * publish that result here instead of re-reading. The backend also emits
 * `model_switch:changed` after automatic switches (and undos), which re-reads
 * both the snapshot and the live switch status.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { SwitchStatus, TemplateStoreSnapshot } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { onModelSwitchChanged } from "../../../lib/events";
import { modelSwitchStatus, modelTemplatesSnapshot } from "../../../lib/ipc";

export interface ModelTemplatesState {
	snapshot: TemplateStoreSnapshot | null;
	status: SwitchStatus | null;
	loading: boolean;
	error: string | null;
	statusError: string | null;
	/** Read the store snapshot; `force` bypasses a request already in flight. */
	load: (force?: boolean) => Promise<void>;
	/** Read the live quota/switch status; `force` bypasses an in-flight request. */
	loadStatus: (force?: boolean) => Promise<void>;
	/** Re-read both (mount, manual refresh, backend event). */
	refresh: () => Promise<void>;
	setSnapshot: (snapshot: TemplateStoreSnapshot) => void;
	/** Subscribe to backend-driven switches; resolves to the unlisten handle. */
	subscribe: () => Promise<UnlistenFn>;
}

let snapshotInflight: Promise<void> | null = null;
let statusInflight: Promise<void> | null = null;
/** A forced read supersedes earlier ones: only the newest generation publishes. */
let snapshotGeneration = 0;
let statusGeneration = 0;

export const useModelTemplatesStore = create<ModelTemplatesState>((set, get) => ({
	snapshot: null,
	status: null,
	loading: false,
	error: null,
	statusError: null,

	load: (force = false) => {
		if (!force && snapshotInflight) return snapshotInflight;
		const generation = ++snapshotGeneration;
		set({ loading: true, error: null });
		const request: Promise<void> = modelTemplatesSnapshot()
			.then((snapshot) => {
				if (generation === snapshotGeneration) set({ snapshot, error: null });
			})
			.catch((e) => {
				if (generation === snapshotGeneration) set({ error: errMsg(e) });
			})
			.finally(() => {
				if (snapshotInflight === request) snapshotInflight = null;
				if (generation === snapshotGeneration) set({ loading: false });
			});
		snapshotInflight = request;
		return request;
	},

	loadStatus: (force = false) => {
		if (!force && statusInflight) return statusInflight;
		const generation = ++statusGeneration;
		set({ statusError: null });
		const request: Promise<void> = modelSwitchStatus(force)
			.then((status) => {
				if (generation === statusGeneration) set({ status, statusError: null });
			})
			.catch((e) => {
				if (generation === statusGeneration) set({ statusError: errMsg(e) });
			})
			.finally(() => {
				if (statusInflight === request) statusInflight = null;
			});
		statusInflight = request;
		return request;
	},

	refresh: async () => {
		await Promise.all([get().load(true), get().loadStatus(true)]);
	},

	setSnapshot: (snapshot) => {
		// A confirmed mutation supersedes any read started before it completed.
		++snapshotGeneration;
		snapshotInflight = null;
		set({ snapshot, loading: false, error: null });
	},

	subscribe: () =>
		onModelSwitchChanged(() => {
			void get().refresh();
		}),
}));
