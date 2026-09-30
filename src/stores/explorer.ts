/**
 * File-explorer workspace override (§10). Cross-feature entry point: other
 * panels (e.g. the Git worktree graph) can pin which directory the explorer
 * shows without touching session/center state.
 */
import { create } from "zustand";

export const useExplorer = create<{
	/** Manually pinned workspace id; null = auto-follow the active session. */
	workspaceId: string | null;
	setWorkspaceId(id: string | null): void;
}>((set) => ({
	workspaceId: null,
	setWorkspaceId: (id) => set({ workspaceId: id }),
}));
