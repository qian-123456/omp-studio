// Mutations shared by the ideas panel rows and selection dock. Each reloads the store and toasts failures.
import type { BacklogStatus } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { backlogDelete, backlogPurge, backlogRestore, backlogUpdate } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";
import { useBacklog } from "./backlogStore";

const UNDO_TTL_MS = 5000;

/** Set the status of every id; reports partial failure. Returns true when all succeeded. */
export async function setIdeasStatus(ids: string[], status: BacklogStatus): Promise<boolean> {
	let failed = 0;
	for (const id of ids) {
		try {
			await backlogUpdate(id, { status });
		} catch {
			failed++;
		}
	}
	await useBacklog.getState().load();
	if (failed > 0) toast.error(tNow("backlog.failedItemsCount", { count: failed }));
	return failed === 0;
}

export async function restoreIdeas(ids: string[]): Promise<void> {
	try {
		await backlogRestore(ids);
		await useBacklog.getState().load();
	} catch (err) {
		toast.error(tNow("backlog.restoreFailed", { error: errMsg(err) }));
	}
}

/** Move to the trash immediately; the toast offers a 5s undo. No confirm dialog. */
export async function deleteIdeas(ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	try {
		await backlogDelete(ids);
		const editId = useBacklog.getState().editBuffer?.id;
		if (editId && ids.includes(editId)) useBacklog.getState().clearEditBuffer();
		await useBacklog.getState().load();
		toast.info(tNow("backlog.movedToTrashToast"), UNDO_TTL_MS, { label: tNow("backlog.undoAction"), onClick: () => void restoreIdeas(ids) });
	} catch (err) {
		toast.error(tNow("backlog.deleteFailed", { error: errMsg(err) }));
	}
}

/** Permanent delete after confirmation. Returns true when purged. */
export async function purgeIdeas(ids: string[], title: string, message: string): Promise<boolean> {
	if (ids.length === 0) return false;
	const ok = await confirmDialog(message, { danger: true, title, okLabel: tNow("backlog.purge") });
	if (!ok) return false;
	try {
		await backlogPurge(ids);
		await useBacklog.getState().load();
		return true;
	} catch (err) {
		toast.error(tNow("backlog.purgeFailed", { error: errMsg(err) }));
		return false;
	}
}
