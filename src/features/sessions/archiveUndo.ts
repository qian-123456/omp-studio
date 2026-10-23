/**
 * Archive-undo bar state + shared archive helpers (§交互约定: 破坏性操作给
 * Undo 路径). The undo bar is rendered once at the sidebar bottom; any row
 * or batch action archives through `archiveSessions` and pushes an undo item.
 */
import { create } from "zustand";
import type { SessionMeta } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isSessionBusy } from "../../lib/createSession";
import { updateSessionMeta } from "../../lib/ipc";
import { sessionDisplayName } from "../../lib/sessionName";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSidebarStore } from "./sidebarStore";
import { switchSpaceMode } from "./switchMode";
import { neighborAfterRemoval } from "./visibleRows";

export interface ArchiveUndoItem {
	id: number;
	sessionIds: string[];
	title: string;
	previousSelectedSessionId: string | null;
	autoSelectedNeighborId: string | null;
}

interface ArchiveUndoState {
	item: ArchiveUndoItem | null;
	show(item: Omit<ArchiveUndoItem, "id">): void;
	clear(id?: number): void;
}

/**
 * Session ids archived during this app run, oldest first. Unlike the timed
 * undo item it survives the bar timing out, so "reopen last archived" can walk
 * back through them. Entries are validated lazily (restored/deleted are skipped).
 */
const archivedStack: string[] = [];

/** Test hook: forget the archive history. */
export function resetArchivedStack(): void {
	archivedStack.length = 0;
}

let undoTimer: number | null = null;
let itemSeq = 0;

export const useArchiveUndo = create<ArchiveUndoState>((set, get) => ({
	item: null,
	show: (newItem) => {
		if (undoTimer !== null) {
			clearTimeout(undoTimer);
			undoTimer = null;
		}
		const prev = get().item;
		const id = ++itemSeq;

		let finalItem: ArchiveUndoItem;
		if (prev) {
			// Merge consecutive archives within the undo window (Q10)
			const mergedIds = Array.from(
				new Set([...prev.sessionIds, ...newItem.sessionIds]),
			);
			const title =
				mergedIds.length === 1
					? newItem.title
					: `已归档 ${mergedIds.length} 个会话`;
			finalItem = {
				id,
				sessionIds: mergedIds,
				title,
				previousSelectedSessionId:
					prev.previousSelectedSessionId ?? newItem.previousSelectedSessionId,
				autoSelectedNeighborId:
					newItem.autoSelectedNeighborId ?? prev.autoSelectedNeighborId,
			};
		} else {
			finalItem = { ...newItem, id };
		}

		set({ item: finalItem });
		undoTimer = setTimeout(() => {
			get().clear(id);
		}, 8000) as unknown as number;
	},
	clear: (id) => {
		const current = get().item;
		if (id !== undefined && current?.id !== id) {
			// A newer archive item replaced this slot — do not clear
			return;
		}
		if (undoTimer !== null) {
			clearTimeout(undoTimer);
			undoTimer = null;
		}
		set({ item: null });
	},
}));

/**
 * Archive 1..N sessions in parallel with an undo path via the sidebar bar.
 * Updates metadata with Promise.allSettled, performs ONE upsert of successes,
 * preserves neighboring selection if the current session was archived,
 * drops archived ids from multi-selection, and toasts failures with counts.
 */
export async function archiveSessions(
	ids: string[],
	opts?: { title?: string },
): Promise<void> {
	if (ids.length === 0) return;

	const sessions = useSessions.getState().sessions;
	const busyCount = ids.filter((id) => {
		const s = sessions[id];
		if (!s) return false;
		return (
			isSessionBusy(s) ||
			s.status === "awaiting_approval" ||
			s.status === "awaiting_answer"
		);
	}).length;

	if (busyCount > 0) {
		const ok = await confirmDialog(
			`有 ${busyCount} 个会话仍在运行或等待回复，归档后将不再提醒，确定归档？`,
			{
				title: "归档会话",
				okLabel: "归档",
				danger: true,
			},
		);
		if (!ok) return;
	}

	const prevSelectedId = useUi.getState().selectedSessionId;
	const isSelectedArchived =
		prevSelectedId !== null && ids.includes(prevSelectedId);
	const nextSelectionId = isSelectedArchived
		? neighborAfterRemoval(ids)
		: null;

	const results = await Promise.allSettled(
		ids.map((id) => updateSessionMeta(id, { archived: true })),
	);

	const successes: SessionMeta[] = [];
	let failed = 0;
	results.forEach((res) => {
		if (res.status === "fulfilled") {
			successes.push(res.value);
		} else {
			failed++;
		}
	});

	if (successes.length > 0) {
		for (const s of successes) {
			const at = archivedStack.indexOf(s.id);
			if (at >= 0) archivedStack.splice(at, 1);
			archivedStack.push(s.id);
		}
		useSessions.getState().upsert(successes);

		if (isSelectedArchived) {
			useUi.getState().selectSession(nextSelectionId);
		}

		// Drop archived ids from multi-selection
		const curSelected = new Set(useUi.getState().selectedIds);
		for (const s of successes) {
			curSelected.delete(s.id);
		}
		useUi.getState().setSelectedIds(curSelected);

		const label =
			successes.length === 1
				? `已归档「${sessionDisplayName(successes[0])}」`
				: (opts?.title ?? `已归档 ${successes.length} 个会话`);

		useArchiveUndo.getState().show({
			sessionIds: successes.map((s) => s.id),
			title: label,
			previousSelectedSessionId: prevSelectedId,
			autoSelectedNeighborId: nextSelectionId,
		});
	}

	if (failed > 0) {
		toast.error(`归档失败: ${failed} 个会话未能归档`);
	}
}

/** Undo path used by the bar: unarchive the sessions again. */
export async function undoArchive(): Promise<void> {
	const item = useArchiveUndo.getState().item;
	if (!item) return;
	const targetItemId = item.id;

	try {
		const results = await Promise.allSettled(
			item.sessionIds.map((id) =>
				updateSessionMeta(id, { archived: false }),
			),
		);

		const restored: SessionMeta[] = [];
		let failed = 0;
		results.forEach((res) => {
			if (res.status === "fulfilled") {
				restored.push(res.value);
			} else {
				failed++;
			}
		});

		if (restored.length > 0) {
			useSessions.getState().upsert(restored);
			const currentSelected = useUi.getState().selectedSessionId;
			const shouldRestoreSelection =
				item.previousSelectedSessionId &&
				item.sessionIds.includes(item.previousSelectedSessionId) &&
				(currentSelected === null ||
					currentSelected === item.autoSelectedNeighborId);

			if (shouldRestoreSelection) {
				useUi.getState().selectSession(item.previousSelectedSessionId);
			}
		}

		if (failed > 0) {
			toast.error(`撤销归档失败: ${failed} 个会话未能恢复`);
		} else {
			toast.success("已撤销归档");
		}
	} catch (err) {
		toast.error(`撤销归档失败: ${errMsg(err)}`);
	} finally {
		useArchiveUndo.getState().clear(targetItemId);
	}
}

/**
 * Restore the most recently archived session of this app run and select it;
 * repeated calls walk back through earlier ones. Ids already restored or
 * deleted are skipped. Switches space mode when the session lives elsewhere
 * (same as openSearchRow). Returns false (with a toast) when nothing is left.
 */
export async function reopenArchivedSession(): Promise<boolean> {
	while (archivedStack.length > 0) {
		const id = archivedStack[archivedStack.length - 1];
		const meta = useSessions.getState().sessions[id];
		if (!meta || !meta.archived) {
			// Already restored or deleted: drop the stale entry and try the next one.
			archivedStack.pop();
			continue;
		}
		try {
			const updated = await updateSessionMeta(id, { archived: false });
			// Only now is the restore durable; a failure keeps the entry so the
			// shortcut retries the same session instead of silently skipping it.
			archivedStack.pop();
			useSessions.getState().upsert([updated]);
			if (useSidebarStore.getState().activeMode !== updated.mode) {
				switchSpaceMode(updated.mode);
			}
			// The timed undo bar may still offer to undo this very archive.
			const undo = useArchiveUndo.getState().item;
			if (undo?.sessionIds.includes(id)) {
				const left = undo.sessionIds.filter(
					(sid) => sid !== id && useSessions.getState().sessions[sid]?.archived,
				);
				if (left.length === 0) useArchiveUndo.getState().clear(undo.id);
			}
			useUi.getState().selectSession(id);
			toast.success(`已恢复「${sessionDisplayName(updated)}」`);
			return true;
		} catch (err) {
			toast.error(`恢复归档失败: ${errMsg(err)}`);
			return false;
		}
	}
	toast.info("没有可恢复的归档会话");
	return false;
}
