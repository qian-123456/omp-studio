import { useEffect, useMemo, useState } from "react";
import { useSessions } from "../../stores/sessions";
import { useSettings } from "../settings/store";
import { type InboxGroups, groupInbox } from "./attention";

const TICK_MS = 60_000;

/** Live inbox groups from the sessions store; re-evaluated every minute so
 * entries age out of the time window without a session change. */
export function useInboxGroups(): InboxGroups {
	const sessions = useSessions((s) => s.sessions);
	const windowHours = useSettings((s) => s.settings?.inboxWindowHours ?? 24);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
		return () => window.clearInterval(id);
	}, []);
	return useMemo(
		() => groupInbox(Object.values(sessions), now, windowHours),
		[sessions, now, windowHours],
	);
}

/** Sidebar 收件箱 badge: awaiting + error + unread within the window. */
export function useInboxBadge(): number {
	return useInboxGroups().badge;
}
