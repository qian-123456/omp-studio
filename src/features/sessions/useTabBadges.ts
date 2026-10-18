import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onServicesChanged } from "../../lib/events";
import { gitSummary, servicesList } from "../../lib/ipc";
import { type SessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import type { SessionMeta } from "../../lib/contracts";
import type { RightTab } from "../../stores/ui";
import { useDrawerStore, countLiveCommandTabs } from "../terminal/drawerStore";

export function computeSidechatBadge(
	sessions: Record<string, SessionMeta>,
	selectedSessionId: string | null,
): number {
	if (!selectedSessionId) return 0;
	let count = 0;
	for (const id in sessions) {
		if (sessions[id]?.parentId === selectedSessionId && sessions[id]?.kind !== "fork") {
			count++;
		}
	}
	return count;
}

export function computeHeatmapBadge(
	liveSession: SessionLive | undefined,
): number {
	return liveSession?.items.length ?? 0;
}

/**
 * Git dirty badge calculation.
 * Crucial performance fix: does NOT subscribe to activeSession.updatedAt.
 * Triggers gitSummary only on session switch, turn end (streaming stops),
 * or initial dirty flag change, debounced at 300ms.
 */
export function useGitDirtyBadge(sessionId: string | null): number {
	const cwd = useSessions(
		useCallback(
			(s) => (sessionId ? (s.sessions[sessionId]?.cwd ?? null) : null),
			[sessionId],
		),
	);
	const initialDirty = useSessions(
		useCallback(
			(s) => (sessionId ? (s.sessions[sessionId]?.git?.dirty ?? 0) : 0),
			[sessionId],
		),
	);
	const isStreaming = useLive(
		useCallback(
			(s) => (sessionId ? s.sessions[sessionId]?.streaming === true : false),
			[sessionId],
		),
	);

	const [count, setCount] = useState<number>(initialDirty);
	const prevStreamingRef = useRef(isStreaming);

	useEffect(() => {
		setCount(initialDirty);
	}, [initialDirty]);

	useEffect(() => {
		if (!cwd) {
			setCount(0);
			return;
		}

		prevStreamingRef.current = isStreaming;

		// While actively streaming, never invoke child Git processes
		if (isStreaming) {
			return;
		}

		let cancelled = false;
		const timer = setTimeout(() => {
			gitSummary(cwd)
				.then((summary) => {
					if (!cancelled && summary && Array.isArray(summary.files)) {
						setCount(summary.files.length);
					}
				})
				.catch(() => {});
		}, 300);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [cwd, isStreaming]);

	return count;
}

export function useServicesBadge(): number {
	const [count, setCount] = useState<number>(0);
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		servicesList(false)
			.then((list) => setCount(list.length))
			.catch(() => {});
		onServicesChanged((list) => setCount(list.length))
			.then((u) => {
				unlisten = u;
			})
			.catch(() => {});
		return () => {
			unlisten?.();
		};
	}, []);
	return count;
}

export function useSidechatBadge(sessionId: string | null): number {
	return useSessions(
		useCallback(
			(s) => computeSidechatBadge(s.sessions, sessionId),
			[sessionId],
		),
	);
}

export function useHeatmapBadge(sessionId: string | null): number {
	return useLive(
		useCallback(
			(s) => computeHeatmapBadge(sessionId ? s.sessions[sessionId] : undefined),
			[sessionId],
		),
	);
}

export function useTabBadges(
	selectedSessionId: string | null,
): Record<RightTab, number> {
	const gitDirtyCount = useGitDirtyBadge(selectedSessionId);
	const servicesCount = useServicesBadge();
	const sidechatCount = useSidechatBadge(selectedSessionId);
	const heatmapCount = useHeatmapBadge(selectedSessionId);
	const terminalCount = useDrawerStore((s) => countLiveCommandTabs(s.tabs));

	return useMemo(
		() => ({
			explorer: 0,
			sidechat: sidechatCount,
			heatmap: heatmapCount,
			git: gitDirtyCount,
			services: servicesCount,
			terminal: terminalCount,
			plan: 0,
		}),
		[gitDirtyCount, servicesCount, sidechatCount, heatmapCount, terminalCount],
	);
}
