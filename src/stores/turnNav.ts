/**
 * Cross-feature jumps between chat turns and git history (§10).
 * Chat sets `revealCommit`; the Git panel consumes it. The Git timeline sets
 * `revealTurn`; the chat consumes it. Consumers call the matching `clear*`
 * once handled. `nonce` makes repeated clicks on the same target re-fire.
 */
import { create } from "zustand";

export interface RevealCommit {
	/** Worktree path the commit belongs to. */
	cwd: string;
	sha: string;
	nonce: number;
}

export interface RevealTurn {
	sessionId: string;
	/** Transcript item id of the user message that started the turn. */
	userItemId: string;
	nonce: number;
}

let seq = 0;

export const useTurnNav = create<{
	revealCommit: RevealCommit | null;
	revealTurn: RevealTurn | null;
	showCommit(cwd: string, sha: string): void;
	showTurn(sessionId: string, userItemId: string): void;
	clearCommit(): void;
	clearTurn(): void;
}>((set) => ({
	revealCommit: null,
	revealTurn: null,
	showCommit: (cwd, sha) => set({ revealCommit: { cwd, sha, nonce: ++seq } }),
	showTurn: (sessionId, userItemId) =>
		set({ revealTurn: { sessionId, userItemId, nonce: ++seq } }),
	clearCommit: () => set({ revealCommit: null }),
	clearTurn: () => set({ revealTurn: null }),
}));
