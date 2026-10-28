import { useLive } from "../../stores/live";
import { useCompaction } from "./slash/compaction";

export type ApplyThinkingLevel = (sessionId: string, level: string) => void | Promise<void>;

export function createThinkingLevelDeferrer(
	isCompacting: (sessionId: string) => boolean,
	subscribe: (listener: () => void) => () => void,
) {
	const pending = new Map<string, { level: string; apply: ApplyThinkingLevel }>();
	let unsubscribe: (() => void) | null = null;

	const stopWatchingWhenIdle = () => {
		if (pending.size > 0 || !unsubscribe) return;
		const stop = unsubscribe;
		unsubscribe = null;
		stop();
	};

	const flush = () => {
		for (const [sessionId, selection] of pending) {
			if (isCompacting(sessionId)) continue;
			pending.delete(sessionId);
			void selection.apply(sessionId, selection.level);
		}
		stopWatchingWhenIdle();
	};

	return (sessionId: string, level: string, apply: ApplyThinkingLevel): void => {
		if (!isCompacting(sessionId) && !pending.has(sessionId)) {
			void apply(sessionId, level);
			return;
		}

		pending.set(sessionId, { level, apply });
		if (!unsubscribe) unsubscribe = subscribe(flush);
		// Compaction may finish between the initial check and listener setup.
		flush();
	};
}

export function isSessionCompacting(sessionId: string): boolean {
	const live = useLive.getState().sessions[sessionId];
	return (
		useCompaction.getState().active[sessionId] === true ||
		live?.state?.isCompacting === true ||
		(live?.flowNotices?.some((notice) => notice.kind === "compaction" && notice.status === "running") ?? false)
	);
}

const subscribeToCompactionChanges = (listener: () => void): (() => void) => {
	const unsubscribeLive = useLive.subscribe(listener);
	const unsubscribeManual = useCompaction.subscribe(listener);
	return () => {
		unsubscribeLive();
		unsubscribeManual();
	};
};

export const runOrDeferThinkingLevel = createThinkingLevelDeferrer(
	isSessionCompacting,
	subscribeToCompactionChanges,
);
