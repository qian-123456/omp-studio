import { useEffect, useMemo, useState } from "react";
import { startTodos, useTodos } from "../todos/store";
import { useSessions } from "../../stores/sessions";
import { useSettings } from "../settings/store";
import type { SessionMeta, SpaceMode } from "../../lib/contracts";
import { SPACE_MODES } from "../sessions/modes";
import { type InboxGroups, groupInbox } from "./attention";

const TICK_MS = 60_000;

/** Shared minute-tick clock + inbox window setting; entries age out without a session change. */
export function useInboxWindow(): { now: number; windowHours: number } {
	const windowHours = useSettings((s) => s.settings?.inboxWindowHours ?? 24);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
		return () => window.clearInterval(id);
	}, []);
	return { now, windowHours };
}

/** Live inbox groups across ALL space modes (code/work/study share one inbox);
 * re-evaluated every minute so entries age out of the time window without a
 * session change. */
export function useInboxGroups(): InboxGroups {
	const sessions = useSessions((s) => s.sessions);
	const todos = useTodos((s) => s.todos);
	const { now, windowHours } = useInboxWindow();
	useEffect(() => {
		void startTodos();
	}, []);
	return useMemo(
		() =>
			groupInbox(Object.values(sessions), now, windowHours, todos),
		[sessions, now, windowHours, todos],
	);
}

/** Sidebar 收件箱 badge: attention sessions within the window + open schedule todos. */
export function useInboxBadge(): number {
	return useInboxGroups().badge;
}

export interface ModeActivity {
	/** Session badge only (approval/question/error/interrupted/unread within the window). */
	badge: number;
	/** Sessions currently running. */
	running: number;
}

/** Per-mode activity, used to hint at changes in modes other than the active one. */
export function useModeActivity(): Record<SpaceMode, ModeActivity> {
	const sessions = useSessions((s) => s.sessions);
	const { now, windowHours } = useInboxWindow();
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
