// Mutations shared by the ideas panel rows and selection dock. Each reloads the store and toasts failures.
import type { BacklogStatus } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { backlogDelete, backlogPurge, backlogRestore, backlogUpdate } from "../../lib/ipc";
import { toast } from "../../lib/toast";
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
	if (failed > 0) toast.error(`${failed} 条操作失败`);
	return failed === 0;
}

export async function restoreIdeas(ids: string[]): Promise<void> {
	try {
		await backlogRestore(ids);
		await useBacklog.getState().load();
	} catch (err) {
		toast.error(`恢复失败: ${errMsg(err)}`);
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
		toast.info("已移到废纸篓", UNDO_TTL_MS, { label: "撤销", onClick: () => void restoreIdeas(ids) });
	} catch (err) {
		toast.error(`删除失败: ${errMsg(err)}`);
	}
}

/** Permanent delete after confirmation. Returns true when purged. */
export async function purgeIdeas(ids: string[], title: string, message: string): Promise<boolean> {
	if (ids.length === 0) return false;
	const ok = await confirmDialog(message, { danger: true, title, okLabel: "彻底删除" });
	if (!ok) return false;
	try {
		await backlogPurge(ids);
		await useBacklog.getState().load();
		return true;
	} catch (err) {
		toast.error(`彻底删除失败: ${errMsg(err)}`);
		return false;
	}
}
