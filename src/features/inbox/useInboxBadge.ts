import { useEffect, useMemo, useState } from "react";
import { useSessions } from "../../stores/sessions";
import { useSettings } from "../settings/store";
import type { SessionMeta, SpaceMode } from "../../lib/contracts";
import { SPACE_MODES } from "../sessions/modes";
import { useSidebarStore } from "../sessions/sidebarStore";
import { type InboxGroups, groupInbox } from "./attention";

const TICK_MS = 60_000;

/** Live inbox groups of the active space mode; re-evaluated every minute so
 * entries age out of the time window without a session change. */
export function useInboxGroups(): InboxGroups {
	const sessions = useSessions((s) => s.sessions);
	const mode = useSidebarStore((s) => s.activeMode);
	const windowHours = useSettings((s) => s.settings?.inboxWindowHours ?? 24);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
		return () => window.clearInterval(id);
	}, []);
	return useMemo(
		() =>
			groupInbox(
				Object.values(sessions).filter((s) => s.mode === mode),
				now,
				windowHours,
			),
		[sessions, mode, now, windowHours],
	);
}

/** Sidebar 收件箱 badge: awaiting + error + unread within the window. */
export function useInboxBadge(): number {
	return useInboxGroups().badge;
}

export interface ModeActivity {
	/** awaiting + error + unread within the window (same rule as the inbox badge). */
	badge: number;
	/** Sessions currently running. */
	running: number;
}

/** Per-mode activity, used to hint at changes in modes other than the active one. */
export function useModeActivity(): Record<SpaceMode, ModeActivity> {
	const sessions = useSessions((s) => s.sessions);
	const windowHours = useSettings((s) => s.settings?.inboxWindowHours ?? 24);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
		return () => window.clearInterval(id);
	}, []);
	return useMemo(() => {
		const byMode = {} as Record<SpaceMode, SessionMeta[]>;
		for (const mode of SPACE_MODES) byMode[mode] = [];
		for (const s of Object.values(sessions)) byMode[s.mode]?.push(s);
		const out = {} as Record<SpaceMode, ModeActivity>;
		for (const mode of SPACE_MODES) {
			const g = groupInbox(byMode[mode], now, windowHours);
			out[mode] = { badge: g.badge, running: g.byKind.running.length };
		}
		return out;
	}, [sessions, now, windowHours]);
}
