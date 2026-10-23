import { create } from "zustand";
import { stepIndex, type FindMatch } from "./findCore";

interface ThreadFindState {
	open: boolean;
	sessionId: string | null;
	query: string;
	matches: FindMatch[];
	/** Current match index, -1 when none. */
	index: number;
	/** Bumped on every navigation so the highlighter re-scrolls to the match. */
	navNonce: number;
	/** Bumped to re-focus + select the input. */
	focusNonce: number;
	show(sessionId: string, query?: string): void;
	setQuery(q: string): void;
	setMatches(m: FindMatch[]): void;
	step(dir: 1 | -1): void;
	close(): void;
}

const INITIAL = {
	open: false,
	sessionId: null,
	query: "",
	matches: [] as FindMatch[],
	index: -1,
};

/** Identity of one match; two different hits can share the same index. */
const matchKey = (m: FindMatch | undefined): string => (m ? `${m.itemId}:${m.occurrence}` : "");

export const useThreadFind = create<ThreadFindState>((set, get) => ({
	...INITIAL,
	navNonce: 0,
	focusNonce: 0,
	show: (sessionId, query) =>
		set((s) =>
			s.open && s.sessionId === sessionId
				? { focusNonce: s.focusNonce + 1, ...(query ? { query } : {}) }
				: {
						...INITIAL,
						open: true,
						sessionId,
						query: query ?? "",
						focusNonce: s.focusNonce + 1,
					},
		),
	// Drop stale hits immediately. When the recomputed list arrives, setMatches
	// selects its first hit even when its index matches the previous query.
	setQuery: (query) =>
		set((s) =>
			s.query === query
				? {}
				: { query, matches: [], index: -1, navNonce: s.navNonce + 1 },
		),
	setMatches: (matches) =>
		set((s) => {
			const index =
				matches.length === 0 ? -1 : s.index >= 0 && s.index < matches.length ? s.index : 0;
			const moved = matchKey(matches[index]) !== matchKey(s.matches[s.index]);
			return {
				matches,
				index,
				navNonce: moved || index !== s.index ? s.navNonce + 1 : s.navNonce,
			};
		}),
	step: (dir) => {
		const { index, matches, navNonce } = get();
		const next = stepIndex(index, matches.length, dir);
		if (next >= 0) set({ index: next, navNonce: navNonce + 1 });
	},
	close: () => set({ ...INITIAL }),
}));
