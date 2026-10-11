/**
 * Privacy placeholder library (§4 [P]): entries, placeholder lookup, native
 * secrets.yml status. Refreshes on `privacy_changed`.
 */

import { create } from "zustand";
import type { PrivacyNativeStatus, SecretEntry } from "../lib/contracts";
import { onPrivacyChanged } from "../lib/events";
import { privacyList, privacySessionEntryIds } from "../lib/ipc";

export interface PrivacyState {
	entries: SecretEntry[];
	/** Current placeholders and aliases → entry. */
	byPlaceholder: Map<string, SecretEntry>;
	nativeStatus: PrivacyNativeStatus;
	nativeError: string | null;
	loaded: boolean;
	load(): Promise<void>;
	sessionEntryIds(sessionId: string): Promise<string[]>;
}

let subscribed = false;

export const usePrivacy = create<PrivacyState>((set, get) => ({
	entries: [],
	byPlaceholder: new Map(),
	nativeStatus: "ok",
	nativeError: null,
	loaded: false,
	async load() {
		if (!subscribed) {
			subscribed = true;
			void onPrivacyChanged(() => {
				void get().load();
			});
		}
		const snap = await privacyList();
		const byPlaceholder = new Map<string, SecretEntry>();
		for (const e of snap.entries) {
			byPlaceholder.set(e.placeholder, e);
			for (const a of e.aliases) byPlaceholder.set(a, e);
		}
		set({
			entries: snap.entries,
			byPlaceholder,
			nativeStatus: snap.nativeStatus,
			nativeError: snap.nativeError,
			loaded: true,
		});
	},
	sessionEntryIds: (sessionId) => privacySessionEntryIds(sessionId),
}));
