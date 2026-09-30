import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onServicesChanged } from "../../lib/events";
import { gitSummary, servicesList } from "../../lib/ipc";
import { type SessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import type { SessionMeta, Todo as TodoItem } from "../../lib/contracts";
import { useTodos } from "../todos/store";
import type { RightTab } from "../../stores/ui";

export function computeTodosBadge(
	counts: { open: number },
	todos: TodoItem[],
	selectedSessionId: string | null,
): number {
	if (!selectedSessionId) return counts.open;
	let sessionOpen = 0;
	for (const t of todos) {
		if (t.sessionId === selectedSessionId && t.status === "open") {
			sessionOpen++;
		}
	}
	return sessionOpen > 0 ? sessionOpen : counts.open;
}

export function computeSidechatBadge(
	sessions: Record<string, SessionMeta>,
	selectedSessionId: string | null,
): number {
	if (!selectedSessionId) return 0;
	let count = 0;
	for (const id in sessions) {
		if (sessions[id]?.parentId === selectedSessionId) {
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

export function useTodosBadge(selectedSessionId: string | null): number {
	return useTodos(
		useCallback(
			(s) => computeTodosBadge(s.counts, s.todos, selectedSessionId),
			[selectedSessionId],
		),
	);
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
	const todosBadge = useTodosBadge(selectedSessionId);
	const gitDirtyCount = useGitDirtyBadge(selectedSessionId);
	const servicesCount = useServicesBadge();
	const sidechatCount = useSidechatBadge(selectedSessionId);
	const heatmapCount = useHeatmapBadge(selectedSessionId);

	return useMemo(
		() => ({
			explorer: 0,
			sidechat: sidechatCount,
			heatmap: heatmapCount,
			todos: todosBadge,
			git: gitDirtyCount,
			services: servicesCount,
		}),
		[todosBadge, gitDirtyCount, servicesCount, sidechatCount, heatmapCount],
	);
}
