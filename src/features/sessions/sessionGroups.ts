/**
 * SessionGroup state: named categories inside a mode's 无项目 area.
 * Loaded once with the sidebar data and kept fresh via `session_groups:changed`.
 * Sessions carry `groupId`; ungrouped global-area sessions render directly
 * under the area's own list.
 */

import { create } from "zustand";
import type { SessionGroup, SessionMeta, SpaceMode } from "../../lib/contracts";
import { onSessionGroupsChanged } from "../../lib/events";
import { listSessionGroups } from "../../lib/ipc";

export interface SessionGroupsState {
	groups: SessionGroup[];
	hasLoaded: boolean;
	load(): Promise<void>;
}

let eventsUnlisten: Promise<(() => void) | null> | null = null;

/** Subscribe to `session_groups:changed` once; safe to call repeatedly. */
function ensureEventListener(reload: () => Promise<void>): void {
	if (eventsUnlisten) return;
	eventsUnlisten = onSessionGroupsChanged(() => {
		void reload();
	}).catch(() => null);
}

export const useSessionGroups = create<SessionGroupsState>((set) => ({
	groups: [],
	hasLoaded: false,
	load: async () => {
		ensureEventListener(async () => {
			try {
				set({ groups: await listSessionGroups() });
			} catch {
				/* transient backend failure: keep last-known groups */
			}
		});
		try {
			const groups = await listSessionGroups();
			set({ groups, hasLoaded: true });
		} catch {
			set({ hasLoaded: true });
		}
	},
}));

/** Groups belonging to one mode, in user sort order. */
export function groupsForMode(
	groups: readonly SessionGroup[],
	mode: SpaceMode,
): SessionGroup[] {
	return groups
		.filter((g) => g.mode === mode)
		.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/**
 * Split a mode's 无项目 sessions into per-group buckets plus the ungrouped
 * tail (order preserved). A session pointing at a group that no longer
 * exists — or belongs to another mode — falls back to ungrouped.
 */
export function splitSessionsByGroup(
	sessions: readonly SessionMeta[],
	groups: readonly SessionGroup[],
): { byGroup: Record<string, SessionMeta[]>; ungrouped: SessionMeta[] } {
	const known = new Set(groups.map((g) => g.id));
	const byGroup: Record<string, SessionMeta[]> = {};
	const ungrouped: SessionMeta[] = [];
	for (const s of sessions) {
		if (s.groupId && known.has(s.groupId)) {
			(byGroup[s.groupId] ??= []).push(s);
		} else {
			ungrouped.push(s);
		}
	}
	return { byGroup, ungrouped };
}
