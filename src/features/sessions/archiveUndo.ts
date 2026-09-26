/**
 * Archive-undo bar state + shared archive helpers (§交互约定: 破坏性操作给
 * Undo 路径). The undo bar is rendered once at the sidebar bottom; any row
 * or bucket action archives through `archiveSession` and pushes an undo item.
 */
import { create } from "zustand";
import type { SessionMeta } from "../../lib/contracts";
import { updateSessionMeta } from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { sessionDisplayName } from "../../lib/sessionName";

export interface ArchiveUndoItem {
	sessionId: string;
	title: string;
}

interface ArchiveUndoState {
	item: ArchiveUndoItem | null;
	show(item: ArchiveUndoItem): void;
	clear(): void;
}

let undoTimer: number | null = null;

export const useArchiveUndo = create<ArchiveUndoState>((set) => ({
	item: null,
	show: (item) => {
		if (undoTimer) clearTimeout(undoTimer);
		set({ item });
		undoTimer = window.setTimeout(() => {
			useArchiveUndo.getState().clear();
		}, 8000);
	},
	clear: () => {
		if (undoTimer) clearTimeout(undoTimer);
		undoTimer = null;
		set({ item: null });
	},
}));

/** Archive a session and offer an undo path via the sidebar bar. */
export async function archiveSession(session: SessionMeta): Promise<void> {
	const updated = await updateSessionMeta(session.id, { archived: true });
	useSessions.getState().upsert([updated]);
	useArchiveUndo.getState().show({
		sessionId: session.id,
		title: sessionDisplayName(session),
	});
}

/** Undo path used by the bar: unarchive the session again. */
export async function undoArchive(sessionId: string): Promise<void> {
	const updated = await updateSessionMeta(sessionId, { archived: false });
	useSessions.getState().upsert([updated]);
	useArchiveUndo.getState().clear();
}
